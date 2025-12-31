/**
 * input: DB 变更记录/文件系统状态
 * output: 增量变更/同步结果
 * pos: 服务端同步层：对账与增量更新（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');
const { TRASH_DIR } = require('../config');

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent, child) {
  try {
    const p = stripTrailingSep(path.resolve(String(parent)));
    const c = stripTrailingSep(path.resolve(String(child)));
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

function insertChange(db, entity, entityId, type) {
  try {
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
      entity,
      String(entityId),
      type,
      Date.now()
    );
  } catch {
    // ignore
  }
}

async function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);
}

async function uniquePath(destPath) {
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let candidate = destPath;
  for (let i = 1; i <= 9999; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fs.pathExists(candidate))) return candidate;
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

async function applyFileOp(db, op, report) {
  const now = Date.now();
  const id = op.id;
  const fromPath = op.from_path;
  const toPath = op.to_path;

  try {
    if (op.op === 'move') {
      if (!toPath) throw new Error('move op missing to_path');
      await ensureDirForFile(toPath);

      const toExists = await fs.pathExists(toPath);
      const fromExists = fromPath ? await fs.pathExists(fromPath) : false;

      if (!toExists && fromExists && fromPath !== toPath) {
        await fs.move(fromPath, toPath, { overwrite: false });
      }

      if (!(await fs.pathExists(toPath))) {
        throw new Error(`move target missing after attempt: ${toPath}`);
      }

      // Update DB pointers (best-effort: file_id may be missing if row already deleted)
      if (op.file_id != null) {
        db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(toPath, now, op.file_id);
        insertChange(db, 'file', op.file_id, 'moved');
      }
      if (op.hash) {
        db.prepare(`UPDATE assets SET status = 'sorted', target_path = ?, updated_at = ? WHERE hash = ?`).run(toPath, now, op.hash);
        insertChange(db, 'asset', op.hash, 'sorted');
      }
      if (op.album_id != null && op.hash) {
        db.prepare('INSERT OR REPLACE INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(op.album_id, op.hash, now);
        db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, op.album_id);
      }

      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', now, id);
      report.moved++;
      return;
    }

    if (op.op === 'trash') {
      if (!toPath) throw new Error('trash op missing to_path');
      await ensureDirForFile(toPath);

      const toExists = await fs.pathExists(toPath);
      const fromExists = fromPath ? await fs.pathExists(fromPath) : false;

      if (!toExists && fromExists) {
        await fs.move(fromPath, toPath, { overwrite: false });
      }

      // If toPath exists, consider it trashed even if from is already gone.
      if (!(await fs.pathExists(toPath))) {
        throw new Error(`trash target missing after attempt: ${toPath}`);
      }

      if (op.file_id != null) {
        // Keep the file row (now pointing to TRASH_DIR) so the trash UI can still render it.
        db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(toPath, now, op.file_id);
        insertChange(db, 'file', op.file_id, 'trashed');
      } else if (fromPath) {
        // Best-effort: update by from_path if file_id is missing.
        db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE path = ?').run(toPath, now, fromPath);
      }

      if (op.hash) {
        db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, updated_at = ? WHERE hash = ?`).run(toPath, now, op.hash);
        db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(op.hash);
        insertChange(db, 'asset', op.hash, 'trash');
      }

      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', now, id);
      report.deleted++;
      return;
    }

    if (op.op === 'delete') {
      if (!fromPath) throw new Error('delete op missing from_path');

      const fromExists = await fs.pathExists(fromPath);
      if (fromExists) {
        await fs.remove(fromPath);
      }

      // Consider delete successful even if file was already gone (idempotent).
      if (op.file_id != null) {
        db.prepare('DELETE FROM files WHERE id = ?').run(op.file_id);
        insertChange(db, 'file', op.file_id, 'deleted');
      } else {
        db.prepare('DELETE FROM files WHERE path = ?').run(fromPath);
      }

      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', now, id);
      report.deleted++;
      return;
    }

    throw new Error(`unknown op: ${op.op}`);
  } catch (e) {
    report.errors++;
    const msg = String(e.message || e);
    report.messages.push(`op#${id} failed: ${msg}`);
    try {
      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', now, msg, id);
    } catch {
      // ignore
    }
  }
}

async function syncChanges() {
  const db = getDB();
  const report = { moved: 0, deleted: 0, errors: 0, messages: [] };

  await fs.ensureDir(TRASH_DIR);

  // 1) Replay pending file ops (crash recovery / reconciliation)
  try {
    const pendingOps = db.prepare(`
      SELECT id, op, hash, file_id, from_path, to_path, album_id, status
      FROM file_ops
      WHERE status = 'pending'
      ORDER BY id ASC
      LIMIT 2000
    `).all();

    for (const op of pendingOps) {
      // eslint-disable-next-line no-await-in-loop
      await applyFileOp(db, op, report);
    }
  } catch (e) {
    report.errors++;
    report.messages.push(`pending ops replay failed: ${String(e.message || e)}`);
  }

  // 2) Handle assets explicitly marked as trash (reconcile to new semantics):
  // Keep exactly ONE physical file copy for the asset under TRASH_DIR; delete all other copies.
  const trashAssets = db.prepare("SELECT hash FROM assets WHERE status = 'trash'").all();

  for (const { hash } of trashAssets) {
    const files = db.prepare('SELECT id, path FROM files WHERE hash = ? ORDER BY id ASC').all(hash);
    const existing = [];
    for (const f of files) {
      if (!f?.path) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await fs.pathExists(f.path)) existing.push({ id: f.id, path: String(f.path) });
    }

    if (!existing.length) continue;

    const alreadyInTrash = existing.filter((f) => isUnder(TRASH_DIR, f.path));
    const keep = alreadyInTrash[0] || existing[0];

    // Ensure keep is under TRASH_DIR.
    if (!isUnder(TRASH_DIR, keep.path)) {
      try {
        const fileName = path.basename(keep.path);
        const trashRaw = path.join(TRASH_DIR, `${hash}_${fileName}`);
        // eslint-disable-next-line no-await-in-loop
        const trashPath = await uniquePath(trashRaw);
        await ensureDirForFile(trashPath);

        const tnow = Date.now();
        const info = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, status, created_at, updated_at)
          VALUES ('trash', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(hash, keep.id, keep.path, trashPath, tnow, tnow);

        // eslint-disable-next-line no-await-in-loop
        await applyFileOp(db, { id: info.lastInsertRowid, op: 'trash', hash, file_id: keep.id, from_path: keep.path, to_path: trashPath }, report);
        keep.path = trashPath;
      } catch (e) {
        report.errors++;
        report.messages.push(`Failed to keep trash copy for ${hash}: ${String(e.message || e)}`);
        continue;
      }
    } else {
      // Ensure assets points to kept file.
      try {
        db.prepare(`UPDATE assets SET target_path = COALESCE(target_path, ?), updated_at = ? WHERE hash = ?`).run(keep.path, Date.now(), hash);
      } catch {
        // ignore
      }
    }

    // Delete all other existing copies.
    for (const f of existing) {
      if (f.id === keep.id) continue;
      try {
        const dnow = Date.now();
        const info = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, status, created_at, updated_at)
          VALUES ('delete', ?, ?, ?, NULL, 'pending', ?, ?)
        `).run(hash, f.id, f.path, dnow, dnow);
        // eslint-disable-next-line no-await-in-loop
        await applyFileOp(db, { id: info.lastInsertRowid, op: 'delete', hash, file_id: f.id, from_path: f.path, to_path: null }, report);
      } catch (e) {
        report.errors++;
        report.messages.push(`Failed to delete extra copy ${f.path}: ${String(e.message || e)}`);
      }
    }
  }

  return report;
}

module.exports = { syncChanges };

