/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const { getDB } = require('../db');
const path = require('path');

function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

const router = express.Router();

function toAlbumRow(r) {
  return {
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    updated_at: r.updated_at,
    count: r.count || 0,
    cover_hash: r.cover_hash || null,
  };
}

// List albums with counts + cover hash
router.get('/', (req, res) => {
  const db = getDB();
  const rows = db.prepare(`
    SELECT
      al.*,
      (SELECT COUNT(*) FROM album_assets aa WHERE aa.album_id = al.id) AS count,
      (
        SELECT aa2.hash
        FROM album_assets aa2
        JOIN assets a2 ON a2.hash = aa2.hash
        WHERE aa2.album_id = al.id
        ORDER BY COALESCE(a2.taken_at, a2.updated_at, 0) DESC, COALESCE(aa2.added_at, 0) DESC
        LIMIT 1
      ) AS cover_hash
    FROM albums al
    ORDER BY COALESCE(al.updated_at, al.created_at, 0) DESC, al.id DESC
  `).all();

  res.json({ data: rows.map(toAlbumRow) });
});

// Create album (idempotent by name)
router.post('/', (req, res) => {
  const db = getDB();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });

  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO albums (name, created_at, updated_at)
    VALUES (?, ?, ?)
  `).run(name, now, now);

  db.prepare(`UPDATE albums SET updated_at = ? WHERE name = ?`).run(now, name);
  const album = db.prepare(`SELECT * FROM albums WHERE name = ?`).get(name);
  res.json({ data: toAlbumRow({ ...album, count: 0, cover_hash: null }) });
});

// List assets in album (paginated)
router.get('/:id/assets', (req, res) => {
  const db = getDB();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid album id' });

  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) AS count FROM album_assets WHERE album_id = ?`).get(id)?.count || 0;
  const rows = db.prepare(`
    SELECT
      a.*,
      a.target_path AS sample_path,
      (
        SELECT COUNT(*)
        FROM files f2
        WHERE f2.hash = a.hash
      ) AS file_count
    FROM album_assets aa
    JOIN assets a ON a.hash = aa.hash
    WHERE aa.album_id = ?
    ORDER BY COALESCE(a.taken_at, a.updated_at, 0) DESC, COALESCE(aa.added_at, 0) DESC
    LIMIT ? OFFSET ?
  `).all(id, limit, offset);

  // Enrich with files, parsed metadata, ext, and similarity fields for UI labels
  const out = rows.map((r) => {
    const samplePath = r?.sample_path ? String(r.sample_path) : '';
    const ext = samplePath ? path.extname(samplePath).toLowerCase() : null;

    // Get files for this asset
    const files = db
      .prepare(`
        SELECT *
        FROM files
        WHERE hash = ?
        ORDER BY COALESCE(mtime_ms, updated_at, discovered_at, scanned_at, 0) DESC, id DESC
      `)
      .all(r.hash);

    // Get phash info from files (any file with phash_status='done')
    const phashInfo = db
      .prepare("SELECT phash, phash_status FROM files WHERE hash = ? AND phash_status = 'done' LIMIT 1")
      .get(r.hash);

    // Check if CLIP embedding exists
    const clipInfo = db
      .prepare('SELECT 1 as has_clip FROM clip_embeddings WHERE hash = ? LIMIT 1')
      .get(r.hash);

    return {
      ...r,
      sample_ext: ext || null,
      metadata: safeJsonParse(r.metadata),
      files: files || [],
      phash: phashInfo?.phash || null,
      phash_status: phashInfo?.phash_status || null,
      clip_status: clipInfo?.has_clip ? 'ready' : null,
    };
  });

  res.json({ data: out, pagination: { page, limit, total } });
});

module.exports = router;


