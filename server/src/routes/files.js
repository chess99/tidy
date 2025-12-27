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

  let where = '';
  let whereParams = [];
  try {
    ({ where, params: whereParams } = makeWhere(filter));
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  const query = `
    SELECT
      f.*,
      a.status AS asset_status,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.updated_at AS asset_updated_at,
      a.thumb_updated_at AS asset_thumb_updated_at
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    ${where}
    ORDER BY COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at) DESC
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

  const { clause, params } = makeInClause(limited);
  const query = `
    SELECT
      f.*,
      a.status AS asset_status,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.updated_at AS asset_updated_at,
      a.thumb_updated_at AS asset_thumb_updated_at
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
    WHERE f.id IN ${clause}
  `;

  const rows = db.prepare(query).all(...params);
  res.json({ data: rows.map(toFileRow) });
});

module.exports = router;


