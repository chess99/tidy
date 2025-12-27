const express = require('express');
const path = require('path');
const { getDB } = require('../db');

const router = express.Router();

function makeWhere(filter) {
  let where = '';
  const params = [];

  if (filter === 'media') {
    where = `
      WHERE (
        COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
        OR COALESCE(a.mime_type, f.mime_guess) LIKE 'video/%'
      )
    `;
  } else if (filter === 'camera') {
    where = `
      WHERE (
        a.is_camera = 1
        OR a.camera_make IS NOT NULL
        OR a.camera_model IS NOT NULL
      )
    `;
  } else if (filter !== 'all') {
    const err = new Error('Invalid filter');
    err.statusCode = 400;
    throw err;
  }

  return { where, params };
}

function parseBool01(v) {
  if (v == null) return null;
  const s = String(v);
  if (s === '1' || s === 'true') return 1;
  if (s === '0' || s === 'false') return 0;
  return null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toKey(ms, granularity) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  if (granularity === 'month') return `${y}-${m}`;
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

function parseCsvParam(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function makeInClause(values) {
  // returns: { clause: "(?,?,?)", params: [...] }
  const params = values.slice();
  const clause = `(${params.map(() => '?').join(',')})`;
  return { clause, params };
}

function toFileRow(r) {
  const fileName = r.path ? path.basename(r.path) : null;
  const ext = r.ext || (r.path ? path.extname(r.path).toLowerCase() : null);

  const displayTime =
    r.asset_taken_at ??
    r.mtime_ms ??
    r.discovered_at ??
    r.scanned_at ??
    null;

  return {
    id: r.id,
    path: r.path,
    file_name: fileName,
    ext,
    size: r.size,
    mtime_ms: r.mtime_ms,
    mime_guess: r.mime_guess,
    missing: r.missing,
    discovered_at: r.discovered_at,
    updated_at: r.updated_at,
    hash: r.hash,
    hash_status: r.hash_status,
    thumb_status: r.thumb_status,
    thumb_updated_at: r.thumb_updated_at,
    display_time: displayTime,

    // derived fields
    organized_to: r.organized_to ?? null,
    dup_count: r.dup_count ?? 0,

    // joined asset fields (nullable)
    asset_status: r.asset_status,
    asset_taken_at: r.asset_taken_at,
    asset_mime_type: r.asset_mime_type,
    asset_updated_at: r.asset_updated_at,
    asset_thumb_updated_at: r.asset_thumb_updated_at,
  };
}

// Date index: build quick lookup points for month/day -> start index in the sorted list
router.get('/date-index', (req, res) => {
  const db = getDB();
  const filter = String(req.query.filter || 'all');
  const granularity = String(req.query.granularity || 'month');

  if (granularity !== 'month' && granularity !== 'day') {
    return res.status(400).json({ error: 'Invalid granularity' });
  }

  let where = '';
  let whereParams = [];
  try {
    ({ where, params: whereParams } = makeWhere(filter));
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  const timeExpr = `COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at)`;

  const totalQuery = `
    SELECT COUNT(*) as count
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    ${where}
  `;
  const total = db.prepare(totalQuery).get(...whereParams).count;

  // Stream-like scan using LIMIT/OFFSET avoids loading all rows into memory (OK for ~50k anyway)
  const q = `
    SELECT ${timeExpr} AS t
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    ${where}
    ORDER BY t DESC
  `;

  const rows = db.prepare(q).all(...whereParams);
  const points = [];
  let lastKey = null;

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].t;
    const key = toKey(t, granularity);
    if (!key) continue;
    if (key !== lastKey) {
      points.push({ key, start: i });
      lastKey = key;
    }
  }

  res.json({ total, filter, granularity, points });
});

// List files (Tab1)
router.get('/', (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const filter = String(req.query.filter || 'all');
  const organized = parseBool01(req.query.organized);
  const hasDup = parseBool01(req.query.hasDup);
  const fromMs = req.query.from != null ? Number(req.query.from) : null;
  const toMs = req.query.to != null ? Number(req.query.to) : null;

  let where = '';
  let whereParams = [];
  try {
    ({ where, params: whereParams } = makeWhere(filter));
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  const timeExpr = `COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at)`;
  const organizedExistsExpr = `EXISTS (SELECT 1 FROM album_assets aa WHERE aa.hash = f.hash)`;
  const dupCountExpr = `(SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)`;

  // Extend WHERE with additional filters.
  if (!where) where = 'WHERE 1=1';

  if (organized === 1) {
    where += ` AND f.hash IS NOT NULL AND ${organizedExistsExpr}`;
  } else if (organized === 0) {
    where += ` AND (f.hash IS NULL OR NOT ${organizedExistsExpr})`;
  }

  if (hasDup === 1) {
    where += ` AND f.hash IS NOT NULL AND ${dupCountExpr} > 1`;
  } else if (hasDup === 0) {
    where += ` AND (f.hash IS NULL OR ${dupCountExpr} <= 1)`;
  }

  if (Number.isFinite(fromMs)) {
    where += ` AND ${timeExpr} >= ?`;
    whereParams.push(fromMs);
  }
  if (Number.isFinite(toMs)) {
    where += ` AND ${timeExpr} <= ?`;
    whereParams.push(toMs);
  }

  const query = `
    SELECT
      f.*,
      a.status AS asset_status,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.updated_at AS asset_updated_at,
      a.thumb_updated_at AS asset_thumb_updated_at,
      CASE WHEN f.hash IS NULL THEN 0 ELSE ${dupCountExpr} END AS dup_count,
      (
        SELECT al.name
        FROM album_assets aa2
        JOIN albums al ON al.id = aa2.album_id
        WHERE aa2.hash = f.hash
        ORDER BY COALESCE(aa2.added_at, 0) DESC, aa2.album_id DESC
        LIMIT 1
      ) AS organized_to
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    ${where}
    ORDER BY ${timeExpr} DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...whereParams, limit, offset);

  const totalQuery = `
    SELECT COUNT(*) as count
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    ${where}
  `;
  const total = db.prepare(totalQuery).get(...whereParams).count;

  res.json({
    data: rows.map(toFileRow),
    pagination: { page, limit, total },
    applied: { filter },
  });
});

// Batch fetch files by ids
router.get('/batch', (req, res) => {
  const db = getDB();
  const ids = parseCsvParam(req.query.ids).map(n => parseInt(n)).filter(n => Number.isFinite(n));
  const limited = ids.slice(0, 500);
  if (limited.length === 0) return res.json({ data: [] });

  const dupCountExpr = `(SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)`;

  const { clause, params } = makeInClause(limited);
  const query = `
    SELECT
      f.*,
      a.status AS asset_status,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.updated_at AS asset_updated_at,
      a.thumb_updated_at AS asset_thumb_updated_at,
      CASE WHEN f.hash IS NULL THEN 0 ELSE ${dupCountExpr} END AS dup_count,
      (
        SELECT al.name
        FROM album_assets aa2
        JOIN albums al ON al.id = aa2.album_id
        WHERE aa2.hash = f.hash
        ORDER BY COALESCE(aa2.added_at, 0) DESC, aa2.album_id DESC
        LIMIT 1
      ) AS organized_to
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    WHERE f.id IN ${clause}
  `;

  const rows = db.prepare(query).all(...params);
  res.json({ data: rows.map(toFileRow) });
});

module.exports = router;


