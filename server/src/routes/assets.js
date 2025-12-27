const express = require('express');
const { getDB } = require('../db');
const path = require('path');
const { getThumbnailPath } = require('../scanner/thumbnail');
const fs = require('fs-extra');
const { TRASH_DIR } = require('../config');

const router = express.Router();

function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parseCsvParam(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function makeInClause(values) {
  const params = values.slice();
  const clause = `(${params.map(() => '?').join(',')})`;
  return { clause, params };
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

// List assets
router.get('/', (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  // Filter by status (default: all except trash?)
  // For now return all
  const statusFilter = req.query.status;
  
  let query = 'SELECT * FROM assets';
  const params = [];

  if (statusFilter) {
    query += ' WHERE status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY taken_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const assets = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM assets').get().count;

  // Parse metadata
  const results = assets.map(a => ({
    ...a,
    metadata: safeJsonParse(a.metadata)
  }));

  res.json({
    data: results,
    pagination: { page, limit, total }
  });
});

// Batch fetch assets by hashes
router.get('/batch', (req, res) => {
  const db = getDB();
  const hashes = parseCsvParam(req.query.hashes).slice(0, 500);
  if (hashes.length === 0) return res.json({ data: [] });

  const { clause, params } = makeInClause(hashes);
  const rows = db.prepare(`SELECT * FROM assets WHERE hash IN ${clause}`).all(...params);
  res.json({
    data: rows.map(a => ({
      ...a,
      metadata: safeJsonParse(a.metadata),
    }))
  });
});

// Get single asset details with files
router.get('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  
  const asset = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const files = db.prepare('SELECT * FROM files WHERE hash = ?').all(hash);

  res.json({
    ...asset,
    metadata: safeJsonParse(asset.metadata),
    files
  });
});

// Update asset (e.g. trash it)
router.patch('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  const { status } = req.body;

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = db.prepare('UPDATE assets SET status = ? WHERE hash = ?').run(status, hash);
  
  if (result.changes === 0) return res.status(404).json({ error: 'Asset not found' });

  res.json({ success: true, hash, status });
});

// Batch update asset status (used by multi-select operations)
router.post('/batch-status', async (req, res) => {
  const db = getDB();
  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.map(String).filter(Boolean) : [];
  const status = String(req.body?.status || '').trim();

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const limited = hashes.slice(0, 500);
  if (limited.length === 0) return res.status(400).json({ error: 'hashes is required' });

  const report = { updated: 0, deleted: 0, errors: 0, messages: [] };
  await fs.ensureDir(TRASH_DIR);

  for (const hash of limited) {
    try {
      const r = db.prepare('UPDATE assets SET status = ?, updated_at = ? WHERE hash = ?').run(status, Date.now(), hash);
      if (r.changes > 0) report.updated++;
      insertChange(db, 'asset', hash, `status:${status}`);

      if (status !== 'trash') continue;

      const files = db.prepare('SELECT id, path FROM files WHERE hash = ?').all(hash);
      for (const f of files) {
        if (!f.path) continue;
        if (!(await fs.pathExists(f.path))) {
          report.messages.push(`File missing: ${f.path}`);
          continue;
        }

        const fileName = path.basename(f.path);
        const trashRaw = path.join(TRASH_DIR, `${hash}_${fileName}`);
        // eslint-disable-next-line no-await-in-loop
        const trashPath = await uniquePath(trashRaw);
        // eslint-disable-next-line no-await-in-loop
        await fs.ensureDir(path.dirname(trashPath));

        const now = Date.now();
        const info = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, status, created_at, updated_at)
          VALUES ('trash', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(hash, f.id, f.path, trashPath, now, now);

        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.move(f.path, trashPath, { overwrite: false });
          db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
          db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', Date.now(), info.lastInsertRowid);
          insertChange(db, 'file', f.id, 'deleted');
          report.deleted++;
        } catch (e) {
          report.errors++;
          const msg = String(e.message || e);
          report.messages.push(`Failed to trash ${f.path}: ${msg}`);
          try {
            db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', Date.now(), msg, info.lastInsertRowid);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      report.errors++;
      report.messages.push(`Failed to update ${hash}: ${String(e.message || e)}`);
    }
  }

  res.json(report);
});

// Serve thumbnail
router.get('/:hash/thumb', async (req, res) => {
  const { hash } = req.params;
  const thumbPath = getThumbnailPath(hash);
  
  if (await fs.pathExists(thumbPath)) {
    res.sendFile(thumbPath);
  } else {
    res.status(404).send('Not found');
  }
});

module.exports = router;

