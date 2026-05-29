/**
 * input: file_ops rows + DB + filesystem state
 * output: idempotent file operation execution and recovery reports
 * pos: service layer executor for all filesystem mutations tracked in file_ops
 */

const fs = require('fs-extra');
const path = require('path');
const {
  assertRegularFileForMutation,
  ensurePathInsideOneOf,
} = require('./fileSafety');

function now() {
  return Date.now();
}

function toReport(report) {
  return report || { moved: 0, deleted: 0, errors: 0, messages: [] };
}

function emitChange(insertChange, entity, entityId, type) {
  if (typeof insertChange !== 'function') return;
  try {
    insertChange(entity, entityId, type);
  } catch {
    // ignore change-feed failures; they must not corrupt file operation recovery
  }
}

function dbOpToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    op: row.op,
    hash: row.hash,
    file_id: row.file_id,
    from_path: row.from_path,
    to_path: row.to_path,
    album_id: row.album_id,
    status: row.status,
    attempts: row.attempts,
  };
}

function createFileOp(db, attrs = {}) {
  const ts = now();
  const info = db.prepare(`
    INSERT INTO file_ops (
      op, hash, file_id, from_path, to_path, album_id, status, attempts, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(
    attrs.op,
    attrs.hash || null,
    attrs.fileId ?? attrs.file_id ?? null,
    attrs.fromPath ?? attrs.from_path ?? null,
    attrs.toPath ?? attrs.to_path ?? null,
    attrs.albumId ?? attrs.album_id ?? null,
    ts,
    ts
  );
  return dbOpToObject(db.prepare('SELECT * FROM file_ops WHERE id = ?').get(info.lastInsertRowid));
}

function markAttempt(db, id, ts) {
  db.prepare(`
    UPDATE file_ops
    SET attempts = COALESCE(attempts, 0) + 1,
        last_attempt_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(ts, ts, id);
}

function markDone(db, id, ts) {
  db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', ts, id);
}

function markError(db, id, ts, error) {
  db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', ts, String(error), id);
}

function validatePathIfPresent(filePath, allowedRoots) {
  if (!filePath) return null;
  if (Array.isArray(allowedRoots) && allowedRoots.length) {
    return ensurePathInsideOneOf(filePath, allowedRoots);
  }
  return path.resolve(String(filePath));
}

async function pathExists(filePath) {
  if (!filePath) return false;
  return await fs.pathExists(filePath);
}

async function assertTargetIsRegularIfExists(toPath) {
  if (await pathExists(toPath)) {
    await assertRegularFileForMutation(toPath);
    return true;
  }
  return false;
}

async function moveTrackedFile({ fromPath, toPath }) {
  if (!toPath) throw new Error('to_path_required');
  await fs.ensureDir(path.dirname(toPath));

  const toExists = await assertTargetIsRegularIfExists(toPath);
  const fromExists = await pathExists(fromPath);

  if (!fromExists && toExists) return 'target_exists';
  if (!fromExists) throw new Error(`source_missing: ${fromPath}`);

  await assertRegularFileForMutation(fromPath);
  if (path.resolve(fromPath) !== path.resolve(toPath)) {
    await fs.move(fromPath, toPath, { overwrite: false });
  }
  await assertRegularFileForMutation(toPath);
  return 'moved';
}

async function unlinkTrackedFile(fromPath) {
  if (!fromPath) throw new Error('from_path_required');
  const exists = await pathExists(fromPath);
  if (!exists) return 'already_missing';
  await assertRegularFileForMutation(fromPath);
  await fs.unlink(fromPath);
  return 'unlinked';
}

function updateMoveDb(db, op, toPath, ts, insertChange) {
  if (op.file_id != null) {
    db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(toPath, ts, op.file_id);
    emitChange(insertChange, 'file', op.file_id, 'moved');
  }
  if (op.hash) {
    db.prepare(`UPDATE assets SET status = 'sorted', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(toPath, ts, op.hash);
    emitChange(insertChange, 'asset', op.hash, 'sorted');
  }
  if (op.album_id != null && op.hash) {
    db.prepare('INSERT OR REPLACE INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(op.album_id, op.hash, ts);
    db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(ts, op.album_id);
  }
}

function updateTrashDb(db, op, toPath, ts, insertChange) {
  if (op.file_id != null) {
    db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(toPath, ts, op.file_id);
    emitChange(insertChange, 'file', op.file_id, 'trashed');
  } else if (op.from_path) {
    db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE path = ?').run(toPath, ts, op.from_path);
  }
  if (op.hash) {
    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(toPath, ts, op.hash);
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(op.hash);
    emitChange(insertChange, 'asset', op.hash, 'trash');
  }
}

function updateQuarantineDb(db, op, ts, insertChange) {
  if (op.file_id != null) {
    db.prepare('DELETE FROM files WHERE id = ?').run(op.file_id);
    emitChange(insertChange, 'file', op.file_id, 'quarantined');
  } else if (op.from_path) {
    db.prepare('DELETE FROM files WHERE path = ?').run(op.from_path);
  }
}

function updateDeleteDb(db, op, ts, insertChange) {
  if (op.file_id != null) {
    db.prepare('DELETE FROM files WHERE id = ?').run(op.file_id);
    emitChange(insertChange, 'file', op.file_id, 'deleted');
  } else if (op.from_path) {
    db.prepare('DELETE FROM files WHERE path = ?').run(op.from_path);
  }
}

async function applyFileOp(db, rawOp, opts = {}) {
  const report = toReport(opts.report);
  const op = dbOpToObject(rawOp) || rawOp;
  const ts = now();

  try {
    if (!op?.id) throw new Error('file_op_id_required');
    markAttempt(db, op.id, ts);

    const fromPath = validatePathIfPresent(op.from_path, opts.allowedRoots);
    const toPath = validatePathIfPresent(op.to_path, opts.allowedRoots);

    if (op.op === 'move') {
      await moveTrackedFile({ fromPath, toPath });
      updateMoveDb(db, op, toPath, now(), opts.insertChange);
      markDone(db, op.id, now());
      report.moved++;
      return report;
    }

    if (op.op === 'trash') {
      await moveTrackedFile({ fromPath, toPath });
      updateTrashDb(db, op, toPath, now(), opts.insertChange);
      markDone(db, op.id, now());
      report.deleted++;
      return report;
    }

    if (op.op === 'quarantine') {
      await moveTrackedFile({ fromPath, toPath });
      updateQuarantineDb(db, op, now(), opts.insertChange);
      markDone(db, op.id, now());
      report.deleted++;
      return report;
    }

    if (op.op === 'delete') {
      await unlinkTrackedFile(fromPath);
      updateDeleteDb(db, op, now(), opts.insertChange);
      markDone(db, op.id, now());
      report.deleted++;
      return report;
    }

    throw new Error(`unknown_file_op: ${op.op}`);
  } catch (e) {
    const msg = String(e?.message || e);
    try {
      markError(db, op?.id, now(), msg);
    } catch {
      // ignore
    }
    report.errors++;
    report.messages.push(`op#${op?.id ?? 'unknown'} failed: ${msg}`);
    return report;
  }
}

async function retryPendingAndErrored(db, opts = {}) {
  const report = toReport(opts.report);
  const maxAttempts = Math.max(1, Number(opts.maxAttempts) || 5);
  const limit = Math.max(1, Math.min(10000, Number(opts.limit) || 2000));
  const rows = db.prepare(`
    SELECT *
    FROM file_ops
    WHERE status = 'pending'
       OR (status = 'error' AND COALESCE(attempts, 0) < ?)
    ORDER BY id ASC
    LIMIT ?
  `).all(maxAttempts, limit);

  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    await applyFileOp(db, row, { ...opts, report });
  }

  return report;
}

module.exports = {
  createFileOp,
  applyFileOp,
  retryPendingAndErrored,
};
