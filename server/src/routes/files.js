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

function parseIntParam(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
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

function normalizeExt(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('.')) s = s.slice(1);
  // conservative; supports mov/mp4/heic/jpeg/3gp...
  if (!/^[a-z0-9]{1,10}$/.test(s)) return null;
  return s;
}

function parseExtsParam(v) {
  const raw = parseCsvParam(v);
  const set = new Set();
  for (const r of raw) {
    const e = normalizeExt(r);
    if (!e) continue;
    // support either stored style: ".jpg" or "jpg"
    set.add(`.${e}`);
    set.add(e);
  }
  return Array.from(set).slice(0, 50);
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
  const organized = parseBool01(req.query.organized);
  const hasDup = parseBool01(req.query.hasDup);
  const hasPeople = parseBool01(req.query.hasPeople);
  const personCountMin = parseIntParam(req.query.personCountMin);
  const personCountMax = parseIntParam(req.query.personCountMax);
  const exts = parseExtsParam(req.query.exts);
  const hash = req.query.hash != null ? String(req.query.hash) : null;
  const pathContains = req.query.pathContains != null ? String(req.query.pathContains) : null;
  const fromMs = req.query.from != null ? Number(req.query.from) : null;
  const toMs = req.query.to != null ? Number(req.query.to) : null;
  const people = parseCsvParam(req.query.people).map(n => parseInt(n)).filter(n => Number.isFinite(n));

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
  // const organizedExistsExpr = `EXISTS (SELECT 1 FROM album_assets aa WHERE aa.hash = f.hash)`;
  const dupCountExpr = `(SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)`;
  const dupHashesQuery = `SELECT hash FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1`;
  const organizedHashesQuery = `SELECT hash FROM album_assets`;

  // Extend WHERE with additional filters (mirror /files list route)
  if (!where) where = 'WHERE 1=1';
  if (organized === 1) {
    where += ` AND f.hash IN (${organizedHashesQuery})`;
  } else if (organized === 0) {
    where += ` AND (f.hash IS NULL OR f.hash NOT IN (${organizedHashesQuery}))`;
  }

  if (hasDup === 1) {
    where += ` AND f.hash IN (${dupHashesQuery})`;
  }
  // If hasDup === 0 (false), user wants "All", so we don't add any filter.

  if (Number.isFinite(fromMs)) {
    where += ` AND ${timeExpr} >= ?`;
    whereParams.push(fromMs);
  }
  if (Number.isFinite(toMs)) {
    where += ` AND ${timeExpr} <= ?`;
    whereParams.push(toMs);
  }

  if (hash) {
    where += ` AND f.hash = ?`;
    whereParams.push(hash);
  }
  if (pathContains) {
    where += ` AND f.path LIKE ?`;
    whereParams.push(`%${pathContains}%`);
  }

  if (exts.length) {
    const { clause, params } = makeInClause(exts);
    where += ` AND LOWER(COALESCE(f.ext, '')) IN ${clause}`;
    whereParams.push(...params);
  }

  // Face/people filters: requires faces table to be populated (run face scan once).
  if (hasPeople === 1) {
    where += ` AND f.hash IS NOT NULL AND EXISTS (SELECT 1 FROM faces ff WHERE ff.hash = f.hash)`;
  }
  if (Number.isFinite(personCountMin) && personCountMin > 0) {
    where += ` AND f.hash IS NOT NULL AND f.hash IN (
      SELECT hash FROM faces
      GROUP BY hash
      HAVING COUNT(DISTINCT COALESCE(person_id, id)) >= ?
    )`;
    whereParams.push(personCountMin);
  }
  if (Number.isFinite(personCountMax) && personCountMax > 0) {
    where += ` AND f.hash IS NOT NULL AND f.hash IN (
      SELECT hash FROM faces
      GROUP BY hash
      HAVING COUNT(DISTINCT COALESCE(person_id, id)) <= ?
    )`;
    whereParams.push(personCountMax);
  }

  for (const pid of people) {
    where += ` AND f.hash IN (SELECT hash FROM faces WHERE person_id = ?)`;
    whereParams.push(pid);
  }

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
  const hasPeople = parseBool01(req.query.hasPeople);
  const personCountMin = parseIntParam(req.query.personCountMin);
  const personCountMax = parseIntParam(req.query.personCountMax);
  const exts = parseExtsParam(req.query.exts);
  const hash = req.query.hash != null ? String(req.query.hash) : null;
  const pathContains = req.query.pathContains != null ? String(req.query.pathContains) : null;
  const fromMs = req.query.from != null ? Number(req.query.from) : null;
  const toMs = req.query.to != null ? Number(req.query.to) : null;
  const people = parseCsvParam(req.query.people).map(n => parseInt(n)).filter(n => Number.isFinite(n));

  let where = '';
  let whereParams = [];
  try {
    ({ where, params: whereParams } = makeWhere(filter));
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  const timeExpr = `COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at)`;
  // const organizedExistsExpr = `EXISTS (SELECT 1 FROM album_assets aa WHERE aa.hash = f.hash)`;
  const dupCountExpr = `(SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)`;
  const dupHashesQuery = `SELECT hash FROM files WHERE hash IS NOT NULL GROUP BY hash HAVING COUNT(*) > 1`;
  const organizedHashesQuery = `SELECT hash FROM album_assets`;

  // Extend WHERE with additional filters.
  if (!where) where = 'WHERE 1=1';

  if (organized === 1) {
    where += ` AND f.hash IN (${organizedHashesQuery})`;
  } else if (organized === 0) {
    where += ` AND (f.hash IS NULL OR f.hash NOT IN (${organizedHashesQuery}))`;
  }

  if (hasDup === 1) {
    where += ` AND f.hash IN (${dupHashesQuery})`;
  } else if (hasDup === 0) {
    // If hasDup is explicit false/0, we only show unique files (count <= 1).
    // Note: The user mentioned "if not checked, show all".
    // But typically checkbox "Only Duplicates" means: checked -> only dupes; unchecked -> all files.
    // However, the frontend might be sending hasDup=false when unchecked.
    // Let's verify what "false" means. If the UI treats it as "Show All", then we should NOT filter.
    // But based on the code 'parseBool01', it seems to handle 1/0/null.
    // If the user wants "unchecked = show all", they should probably not send hasDup=0, or we should treat 0 as no-op.
    // WAITING FOR CONFIRMATION - but previous logic was: hasDup=0 => count <= 1.
    // User said: "unchecked should show all, checked filters duplicates".
    // So if hasDup is 0 (false), we should probably DO NOTHING (show all).
    // BUT the previous code explicitly filtered for `dupCount <= 1`.
    // Let's comment this out if hasDup is 0, or check if we need a specific 'unique' filter.
    // For now, I will assume hasDup=0 means "Show Unique" and hasDup=null means "Show All".
    // If the frontend sends hasDup=false when unchecked, we need to change this behavior.
    
    // User quote: "当时的设计应该是未勾选 '仅重复' 就展示所有, 勾选的话才筛选有重复项的."
    // So: 
    // - Checked (hasDup=true/1) -> Show only duplicates.
    // - Unchecked (hasDup=false/0) -> Show ALL files (do not filter).
    
    // Therefore, we should REMOVE the filter for hasDup === 0.
  }

  if (Number.isFinite(fromMs)) {
    where += ` AND ${timeExpr} >= ?`;
    whereParams.push(fromMs);
  }
  if (Number.isFinite(toMs)) {
    where += ` AND ${timeExpr} <= ?`;
    whereParams.push(toMs);
  }

  if (hash) {
    where += ` AND f.hash = ?`;
    whereParams.push(hash);
  }
  if (pathContains) {
    where += ` AND f.path LIKE ?`;
    whereParams.push(`%${pathContains}%`);
  }

  if (exts.length) {
    const { clause, params } = makeInClause(exts);
    where += ` AND LOWER(COALESCE(f.ext, '')) IN ${clause}`;
    whereParams.push(...params);
  }

  if (hasPeople === 1) {
    where += ` AND f.hash IS NOT NULL AND EXISTS (SELECT 1 FROM faces ff WHERE ff.hash = f.hash)`;
  }
  if (Number.isFinite(personCountMin) && personCountMin > 0) {
    where += ` AND f.hash IS NOT NULL AND f.hash IN (
      SELECT hash FROM faces
      GROUP BY hash
      HAVING COUNT(DISTINCT COALESCE(person_id, id)) >= ?
    )`;
    whereParams.push(personCountMin);
  }
  if (Number.isFinite(personCountMax) && personCountMax > 0) {
    where += ` AND f.hash IS NOT NULL AND f.hash IN (
      SELECT hash FROM faces
      GROUP BY hash
      HAVING COUNT(DISTINCT COALESCE(person_id, id)) <= ?
    )`;
    whereParams.push(personCountMax);
  }

  for (const pid of people) {
    where += ` AND f.hash IN (SELECT hash FROM faces WHERE person_id = ?)`;
    whereParams.push(pid);
  }

  // Optimize dup_count: if we are filtering by hasDup=1, we know dup_count > 1.
  // If we are showing all (hasDup=0 or null), we still need to calculate it.
  // The original correlated subquery is slow: (SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)
  // We can try to optimize it by pre-calculating or joining.
  // But for now, let's keep it as is unless it's the bottleneck for the SELECT list.
  // The bottleneck observed was likely the WHERE clause filtering or the ORDER BY on large result sets.

  const query = `
    SELECT
      f.*,
      a.status AS asset_status,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.updated_at AS asset_updated_at,
      a.thumb_updated_at AS asset_thumb_updated_at,
      -- Use a faster scalar subquery or just the raw count if possible.
      -- For display, we need the exact count.
      -- Optimization: If we already filtered by hasDup=1, we know it's > 1, but we still need the number.
      -- The correlated subquery is expensive. Let's try to join with a derived table of counts IF hasDup=1.
      -- Actually, for 50 rows, the correlated subquery in SELECT list is fast (50 lookups).
      -- The slowness comes from the WHERE clause or ORDER BY scanning many rows.
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


