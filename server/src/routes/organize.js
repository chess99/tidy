/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');
const { MANAGED_ROOT, TRASH_DIR } = require('../config');

const router = express.Router();

function sanitizeSegment(name) {
  // Windows-safe-ish folder name: remove reserved chars and trim.
  const s = String(name || '').trim();
  const cleaned = s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ');
  return cleaned.slice(0, 120) || 'Untitled';
}

function isUnderDir(p, dir) {
  try {
    const abs = path.resolve(p).toLowerCase();
    const root = path.resolve(dir).toLowerCase();
    return abs === root || abs.startsWith(root + path.sep);
  } catch {
    return false;
  }
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
  // Fallback: give up and overwrite last
  return candidate;
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

function pickPrimaryFile(files) {
  // Prefer existing, non-missing file outside managed root (so we move from source),
  // otherwise any existing one.
  const existing = files.filter((f) => f.path && fs.existsSync(f.path));
  const outside = existing.filter((f) => !isUnderDir(f.path, MANAGED_ROOT));
  return (outside[0] || existing[0] || null);
}

router.post('/', async (req, res) => {
  const db = getDB();
  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.map(String) : [];
  const albumNameRaw = req.body?.albumName;
  const albumIdRaw = req.body?.albumId;

  const hashesLimited = hashes.filter(Boolean).slice(0, 500);
  if (hashesLimited.length === 0) return res.status(400).json({ error: 'hashes is required' });

  const now = Date.now();

  // Resolve album
  let albumId = null;
  let albumName = null;
  if (albumIdRaw != null) {
    const id = Number(albumIdRaw);
    const row = Number.isFinite(id) ? db.prepare('SELECT * FROM albums WHERE id = ?').get(id) : null;
    if (!row) return res.status(400).json({ error: 'invalid albumId' });
    albumId = row.id;
    albumName = row.name;
  } else {
    const name = sanitizeSegment(albumNameRaw);
    albumName = name;
    db.prepare('INSERT OR IGNORE INTO albums (name, created_at, updated_at) VALUES (?, ?, ?)').run(name, now, now);
    db.prepare('UPDATE albums SET updated_at = ? WHERE name = ?').run(now, name);
    albumId = db.prepare('SELECT id FROM albums WHERE name = ?').get(name).id;
  }

  const albumDir = path.join(MANAGED_ROOT, sanitizeSegment(albumName));
  await fs.ensureDir(albumDir);
  await fs.ensureDir(TRASH_DIR);

  const report = { album: { id: albumId, name: albumName }, moved: 0, trashed: 0, errors: 0, messages: [] };

  for (const hash of hashesLimited) {
    // eslint-disable-next-line no-await-in-loop
    await (async () => {
      try {
        const files = db.prepare('SELECT id, path FROM files WHERE hash = ? ORDER BY path ASC').all(hash);
        if (!files || files.length === 0) {
          report.messages.push(`No files for hash: ${hash}`);
          return;
        }

        const primary = pickPrimaryFile(files);
        if (!primary) {
          report.messages.push(`No existing file on disk for hash: ${hash}`);
          return;
        }

        const fromPath = primary.path;
        const baseName = path.basename(fromPath);
        const targetPathRaw = path.join(albumDir, baseName);
        const targetPath = await uniquePath(targetPathRaw);

        // Op log: pending move
        const opMove = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, album_id, status, created_at, updated_at)
          VALUES ('move', ?, ?, ?, ?, ?, 'pending', ?, ?)
        `).run(hash, primary.id, fromPath, targetPath, albumId, now, now);
        const opMoveId = opMove.lastInsertRowid;

        // Move primary
        if (fromPath !== targetPath) {
          await fs.move(fromPath, targetPath, { overwrite: false });
        }

        // Update DB for primary
        db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(targetPath, Date.now(), primary.id);
        db.prepare(`UPDATE assets SET status = 'sorted', target_path = ?, updated_at = ? WHERE hash = ?`).run(targetPath, Date.now(), hash);

        // Ensure single-folder semantics: remove from other albums, then add to this album.
        db.prepare('DELETE FROM album_assets WHERE hash = ? AND album_id <> ?').run(hash, albumId);
        db.prepare('INSERT OR REPLACE INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(albumId, hash, Date.now());
        db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(Date.now(), albumId);

        // Mark op done
        db.prepare('UPDATE file_ops SET status = ?, updated_at = ? WHERE id = ?').run('done', Date.now(), opMoveId);

        insertChange(db, 'file', primary.id, 'moved');
        insertChange(db, 'asset', hash, 'sorted');
        report.moved++;

        // Trash duplicates (including those already under managed root but not primary)
        const dupFiles = files.filter((f) => f.id !== primary.id);
        for (const dup of dupFiles) {
          if (!dup.path) continue;
          if (!fs.existsSync(dup.path)) {
            // If already missing, just delete db row.
            db.prepare('DELETE FROM files WHERE id = ?').run(dup.id);
            insertChange(db, 'file', dup.id, 'deleted');
            continue;
          }

          const dupBase = path.basename(dup.path);
          const trashRaw = path.join(TRASH_DIR, `${hash}_${dupBase}`);
          // eslint-disable-next-line no-await-in-loop
          const trashPath = await uniquePath(trashRaw);

          const opTrash = db.prepare(`
            INSERT INTO file_ops (op, hash, file_id, from_path, to_path, album_id, status, created_at, updated_at)
            VALUES ('trash', ?, ?, ?, ?, ?, 'pending', ?, ?)
          `).run(hash, dup.id, dup.path, trashPath, albumId, Date.now(), Date.now());
          const opTrashId = opTrash.lastInsertRowid;

          try {
            // eslint-disable-next-line no-await-in-loop
            await fs.move(dup.path, trashPath, { overwrite: false });
            db.prepare('DELETE FROM files WHERE id = ?').run(dup.id);
            db.prepare('UPDATE file_ops SET status = ?, updated_at = ? WHERE id = ?').run('done', Date.now(), opTrashId);
            insertChange(db, 'file', dup.id, 'deleted');
            report.trashed++;
          } catch (e) {
            db.prepare('UPDATE file_ops SET status = ?, error = ?, updated_at = ? WHERE id = ?').run('error', String(e.message || e), Date.now(), opTrashId);
            report.errors++;
            report.messages.push(`Failed to trash dup ${dup.path}: ${String(e.message || e)}`);
          }
        }
      } catch (e) {
        report.errors++;
        report.messages.push(`Organize failed for ${hash}: ${String(e.message || e)}`);
      }
    })();
  }

  res.json(report);
});

module.exports = router;


