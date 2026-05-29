/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');
const { loadConfig } = require('../configStore');
const { createFileOp, applyFileOp } = require('../services/fileOps');
const { makeQuarantinePath } = require('../services/fileSafety');
const { canTreatAsSameContentForDestructiveDedupe } = require('../services/hashPolicy');

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

function allowedRootsFromConfig(cfg) {
  const roots = [];
  for (const r of Array.isArray(cfg?.scanRoots) ? cfg.scanRoots : []) {
    if (r?.root) roots.push(r.root);
  }
  if (cfg?.workspace?.managedRoot) roots.push(cfg.workspace.managedRoot);
  if (cfg?.workspace?.trashDir) roots.push(cfg.workspace.trashDir);
  return Array.from(new Set(roots.filter(Boolean).map(String)));
}

function opSucceeded(db, opId) {
  const row = db.prepare('SELECT status, error FROM file_ops WHERE id = ?').get(opId);
  return row?.status === 'done' ? { ok: true } : { ok: false, error: row?.error || 'file_op_failed' };
}

function pickPrimaryFile(files, managedRoot) {
  // Prefer existing, non-missing file outside managed root (so we move from source),
  // otherwise any existing one.
  const existing = files.filter((f) => f.path && fs.existsSync(f.path));
  const outside = existing.filter((f) => !isUnderDir(f.path, managedRoot));
  return (outside[0] || existing[0] || null);
}

router.post('/', async (req, res) => {
  const db = getDB();
  const cfg = await loadConfig();
  const managedRoot = cfg.workspace?.managedRoot;
  if (!managedRoot) return res.status(500).json({ error: 'workspace.managedRoot not configured' });
  const trashDir = cfg.workspace?.trashDir;
  const allowedRoots = allowedRootsFromConfig(cfg);

  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.map(String) : [];
  const albumNameRaw = req.body?.albumName;
  const albumIdRaw = req.body?.albumId;
  const duplicatePolicy = ['keep-all', 'quarantine-extra'].includes(req.body?.duplicatePolicy)
    ? req.body.duplicatePolicy
    : 'keep-all';

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

  const albumDir = path.join(managedRoot, sanitizeSegment(albumName));
  await fs.ensureDir(albumDir);

  const report = { album: { id: albumId, name: albumName }, duplicatePolicy, moved: 0, deleted: 0, errors: 0, messages: [] };

  for (const hash of hashesLimited) {
    // eslint-disable-next-line no-await-in-loop
    await (async () => {
      try {
        const files = db.prepare('SELECT id, path, hash, hash_algo, size FROM files WHERE hash = ? ORDER BY path ASC').all(hash);
        if (!files || files.length === 0) {
          report.messages.push(`No files for hash: ${hash}`);
          return;
        }

        const primary = pickPrimaryFile(files, managedRoot);
        if (!primary) {
          report.messages.push(`No existing file on disk for hash: ${hash}`);
          return;
        }

        const fromPath = primary.path;
        const baseName = path.basename(fromPath);
        const targetPathRaw = path.join(albumDir, baseName);
        const targetPath = await uniquePath(targetPathRaw);

        const moveOp = createFileOp(db, {
          op: 'move',
          hash,
          fileId: primary.id,
          fromPath,
          toPath: targetPath,
          albumId,
        });
        await applyFileOp(db, moveOp, {
          allowedRoots,
          insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
          report,
        });
        const moveResult = opSucceeded(db, moveOp.id);
        if (!moveResult.ok) {
          report.messages.push(`Move failed for ${hash}: ${moveResult.error}`);
          return;
        }

        // Ensure single-folder semantics: remove from other albums, then add to this album.
        db.prepare('DELETE FROM album_assets WHERE hash = ? AND album_id <> ?').run(hash, albumId);
        db.prepare('INSERT OR REPLACE INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(albumId, hash, Date.now());
        db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(Date.now(), albumId);

        // By default, preserve extra same-content copies. Only explicit policy quarantines them.
        if (duplicatePolicy !== 'quarantine-extra') return;
        if (!trashDir) {
          report.errors++;
          report.messages.push(`Cannot quarantine extras for ${hash}: workspace.trashDir not configured`);
          return;
        }

        const dupFiles = files.filter((f) => f.id !== primary.id);
        const primaryAfterMove = { ...primary, path: targetPath };
        for (const dup of dupFiles) {
          if (!dup.path) continue;
          if (!fs.existsSync(dup.path)) {
            // If already missing, just delete db row.
            db.prepare('DELETE FROM files WHERE id = ?').run(dup.id);
            insertChange(db, 'file', dup.id, 'deleted');
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const sameContent = await canTreatAsSameContentForDestructiveDedupe(primaryAfterMove, dup);
          if (!sameContent) {
            report.errors++;
            report.messages.push(`Skipped quarantining ${dup.path}: hash_policy_mismatch`);
            continue;
          }

          const quarantinePath = await makeQuarantinePath({
            quarantineDir: path.join(trashDir, '.quarantine'),
            hash,
            fileId: dup.id,
            sourcePath: dup.path,
            reason: 'organize-extra',
          });
          const quarantineOp = createFileOp(db, {
            op: 'quarantine',
            hash,
            fileId: dup.id,
            fromPath: dup.path,
            toPath: quarantinePath,
            albumId,
          });
          // eslint-disable-next-line no-await-in-loop
          await applyFileOp(db, quarantineOp, {
            allowedRoots,
            insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
            report,
          });
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
