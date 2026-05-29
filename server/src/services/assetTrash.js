/**
 * input: asset hash + workspace trash policy
 * output: asset-level trash operation with one kept copy and optional extra-copy quarantine
 * pos: service layer for user-visible delete/trash semantics
 */

const fs = require('fs-extra');
const path = require('path');
const { createFileOp, applyFileOp } = require('./fileOps');
const { isUnder, uniquePath, makeQuarantinePath } = require('./fileSafety');

function scoreFileRow(r) {
  const t =
    (Number.isFinite(Number(r?.mtime_ms)) ? Number(r.mtime_ms) : null) ??
    (Number.isFinite(Number(r?.updated_at)) ? Number(r.updated_at) : null) ??
    (Number.isFinite(Number(r?.discovered_at)) ? Number(r.discovered_at) : null) ??
    (Number.isFinite(Number(r?.scanned_at)) ? Number(r.scanned_at) : null) ??
    0;
  const id = Number.isFinite(Number(r?.id)) ? Number(r.id) : 0;
  return (t * 10) + id;
}

function pickBest(rows) {
  let best = null;
  let bestScore = -Infinity;
  for (const r of Array.isArray(rows) ? rows : []) {
    const score = scoreFileRow(r);
    if (!best || score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

function insertChangeSafe(insertChange, entity, entityId, type) {
  if (typeof insertChange !== 'function') return;
  try {
    insertChange(entity, entityId, type);
  } catch {
    // ignore
  }
}

async function existingRowsForHash(db, hash, insertChange) {
  const rows = db.prepare(`
    SELECT id, path, mtime_ms, updated_at, discovered_at, scanned_at
    FROM files
    WHERE hash = ?
    ORDER BY COALESCE(mtime_ms, updated_at, discovered_at, scanned_at, 0) DESC, id DESC
  `).all(hash);

  const existing = [];
  for (const row of rows) {
    if (!row?.path) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await fs.pathExists(row.path)) {
      existing.push({ ...row, id: Number(row.id), path: String(row.path) });
    } else {
      try {
        db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
        insertChangeSafe(insertChange, 'file', row.id, 'deleted');
      } catch {
        // ignore cleanup
      }
    }
  }
  return existing;
}

function opSucceeded(db, opId) {
  const row = db.prepare('SELECT status FROM file_ops WHERE id = ?').get(opId);
  return row?.status === 'done';
}

async function trashAssetKeepOne(db, {
  hash,
  trashDir,
  allowedRoots = [],
  duplicatePolicy = 'quarantine-extra',
  insertChange,
} = {}) {
  if (!hash) return { ok: false, error: 'hash_required', quarantined: 0, preserved: 0, errors: 1, messages: ['hash_required'] };
  if (!trashDir) return { ok: false, error: 'trash_dir_required', quarantined: 0, preserved: 0, errors: 1, messages: ['trash_dir_required'] };

  const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
  await fs.ensureDir(trashDir);

  const existing = await existingRowsForHash(db, hash, insertChange);
  if (!existing.length) {
    return { ok: false, error: 'no_existing_files', quarantined: 0, preserved: 0, errors: 0, messages: [] };
  }

  const inTrash = existing.filter((f) => isUnder(trashDir, f.path));
  const keep = pickBest(inTrash) || pickBest(existing);
  let keepPath = keep.path;

  if (!isUnder(trashDir, keepPath)) {
    const trashRaw = path.join(trashDir, `${hash}_${path.basename(keepPath)}`);
    const trashPath = await uniquePath(trashRaw);
    const op = createFileOp(db, {
      op: 'trash',
      hash,
      fileId: keep.id,
      fromPath: keepPath,
      toPath: trashPath,
    });
    await applyFileOp(db, op, { allowedRoots, insertChange, report });
    if (!opSucceeded(db, op.id)) {
      return {
        ok: false,
        error: 'trash_keep_failed',
        keepPath: null,
        keptFileId: keep.id,
        quarantined: 0,
        preserved: existing.length - 1,
        errors: report.errors,
        messages: report.messages,
      };
    }
    keepPath = trashPath;
  } else {
    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(keepPath, Date.now(), hash);
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
    insertChangeSafe(insertChange, 'asset', hash, 'trash');
  }

  let quarantined = 0;
  let preserved = 0;
  const quarantineExtras = duplicatePolicy !== 'keep-all';
  for (const f of existing) {
    if (f.id === keep.id) continue;
    if (!quarantineExtras) {
      preserved++;
      continue;
    }

    const quarantinePath = await makeQuarantinePath({
      quarantineDir: path.join(trashDir, '.quarantine'),
      hash,
      fileId: f.id,
      sourcePath: f.path,
      reason: 'trash-extra',
    });
    const op = createFileOp(db, {
      op: 'quarantine',
      hash,
      fileId: f.id,
      fromPath: f.path,
      toPath: quarantinePath,
    });
    // eslint-disable-next-line no-await-in-loop
    await applyFileOp(db, op, { allowedRoots, insertChange, report });
    if (opSucceeded(db, op.id)) quarantined++;
  }

  try {
    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(keepPath, Date.now(), hash);
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
    insertChangeSafe(insertChange, 'asset', hash, 'trash');
  } catch {
    // ignore; FileOpService already performed the core trash DB update for the kept copy
  }

  return {
    ok: true,
    keepPath,
    keptFileId: keep.id,
    quarantined,
    preserved,
    errors: report.errors,
    messages: report.messages,
  };
}

module.exports = {
  trashAssetKeepOne,
};
