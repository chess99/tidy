/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

const ALLOWED_TYPES = new Set(['place', 'subject', 'person', 'food', 'other']);

function toTagRow(r) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// List tags (optional filter by type)
router.get('/', (req, res) => {
  const db = getDB();
  const type = req.query.type != null ? String(req.query.type) : null;
  if (type && !ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });

  const rows = type
    ? db.prepare('SELECT * FROM tags WHERE type = ? ORDER BY name ASC').all(type)
    : db.prepare('SELECT * FROM tags ORDER BY type ASC, name ASC').all();

  res.json({ data: rows.map(toTagRow) });
});

// Create tag (idempotent by name+type)
router.post('/', (req, res) => {
  const db = getDB();
  const name = String(req.body?.name || '').trim();
  const type = String(req.body?.type || 'other').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!ALLOWED_TYPES.has(type)) return res.status(400).json({ error: 'invalid type' });

  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO tags (name, type, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, type, now, now);
  db.prepare('UPDATE tags SET updated_at = ? WHERE name = ? AND type = ?').run(now, name, type);
  const row = db.prepare('SELECT * FROM tags WHERE name = ? AND type = ?').get(name, type);
  res.json({ data: toTagRow(row) });
});

// List tags for an asset
router.get('/asset/:hash', (req, res) => {
  const db = getDB();
  const hash = String(req.params.hash || '').trim();
  if (!hash) return res.status(400).json({ error: 'invalid hash' });

  const rows = db.prepare(`
    SELECT t.*
    FROM asset_tags at
    JOIN tags t ON t.id = at.tag_id
    WHERE at.hash = ?
    ORDER BY t.type ASC, t.name ASC
  `).all(hash);

  res.json({ data: rows.map(toTagRow) });
});

// Add tag to asset
router.post('/asset/:hash', (req, res) => {
  const db = getDB();
  const hash = String(req.params.hash || '').trim();
  const tagId = Number(req.body?.tagId);
  if (!hash) return res.status(400).json({ error: 'invalid hash' });
  if (!Number.isFinite(tagId)) return res.status(400).json({ error: 'tagId is required' });

  const now = Date.now();
  db.prepare('INSERT OR IGNORE INTO asset_tags (hash, tag_id, added_at) VALUES (?, ?, ?)').run(hash, tagId, now);
  try {
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run('asset', hash, 'tags', now);
  } catch {
    // ignore
  }
  res.json({ success: true });
});

// Remove tag from asset
router.delete('/asset/:hash/:tagId', (req, res) => {
  const db = getDB();
  const hash = String(req.params.hash || '').trim();
  const tagId = Number(req.params.tagId);
  if (!hash) return res.status(400).json({ error: 'invalid hash' });
  if (!Number.isFinite(tagId)) return res.status(400).json({ error: 'invalid tagId' });

  db.prepare('DELETE FROM asset_tags WHERE hash = ? AND tag_id = ?').run(hash, tagId);
  const now = Date.now();
  try {
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run('asset', hash, 'tags', now);
  } catch {
    // ignore
  }
  res.json({ success: true });
});

module.exports = router;


