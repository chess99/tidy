/**
 * input: Express req/res + DB + CLIP/相似检索服务
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：列表/筛选/CLIP 智能检索入口（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const path = require('path');
const { getDB } = require('../db');
const { hamming64 } = require('../scanner/phash');
const { clipTextEmbed } = require('../services/aiClient');
const { queryTopKByFileId, queryTopKByVector } = require('../services/clipIndex');
const { createProfiler } = require('../utils/profiler');

const router = express.Router();
let smartSearchInflight = 0;

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

function clampIntParam(v, { min, max, fallback }) {
  const n = parseIntParam(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
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

function orderByCaseIds(ids) {
  const parts = [];
  for (let i = 0; i < ids.length; i++) parts.push(`WHEN ? THEN ${i}`);
  const sql = `CASE f.id ${parts.join(' ')} ELSE ${ids.length} END`;
  return { sql, params: ids.slice() };
}

function computeSimilarFileIdsByPhash(db, { seedFileId, threshold, maxIds = 2000 } = {}) {
  const seedId = Number(seedFileId);
  if (!Number.isFinite(seedId)) return [];
  const th = clampIntParam(threshold, { min: 0, max: 32, fallback: 10 });

  const seed = db
    .prepare(
      `
      SELECT phash
      FROM files
      WHERE id = ?
        AND missing = 0
        AND phash IS NOT NULL
        AND phash_status = 'done'
      LIMIT 1
      `
    )
    .get(seedId);
  const seedPhash = seed?.phash ? String(seed.phash) : '';
  if (!seedPhash) return [];

  const b1 = seedPhash.slice(0, 4);
  const b2 = seedPhash.slice(4, 8);
  const b3 = seedPhash.slice(8, 12);
  const b4 = seedPhash.slice(12, 16);

  const rows = db
    .prepare(
      `
      SELECT f.id, f.phash
      FROM files f
      LEFT JOIN assets a ON a.hash = f.hash
      WHERE f.missing = 0
        AND f.phash IS NOT NULL
        AND f.phash_status = 'done'
        AND (a.status IS NULL OR a.status != 'trash')
        AND COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
        AND (
          substr(f.phash, 1, 4) = ?
          OR substr(f.phash, 5, 4) = ?
          OR substr(f.phash, 9, 4) = ?
          OR substr(f.phash, 13, 4) = ?
        )
      LIMIT 5000
      `
    )
    .all(b1, b2, b3, b4);

  const out = [];
  for (const r of rows) {
    const id = Number(r?.id);
    if (!Number.isFinite(id)) continue;
    const ph = r?.phash ? String(r.phash) : '';
    if (!ph) continue;
    const d = hamming64(seedPhash, ph);
    if (d == null || d > th) continue;
    out.push(id);
    if (out.length >= maxIds) break;
  }
  return out;
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
    score: r.score != null ? Number(r.score) : null,
  };
}

// Date index: build quick lookup points for month/day -> start index in the sorted list
router.get('/date-index', async (req, res) => {
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
  const similarKind = req.query.similarKind != null ? String(req.query.similarKind) : null;
  const similarToFileId = parseIntParam(req.query.similarToFileId);
  const similarThreshold = clampIntParam(req.query.similarThreshold, { min: 0, max: 32, fallback: 10 });
  const similarTopK = clampIntParam(req.query.similarTopK, { min: 1, max: 5000, fallback: 500 });
  const similarMinScore = req.query.similarMinScore != null && req.query.similarMinScore !== '' ? Number(req.query.similarMinScore) : null;

  if (granularity !== 'month' && granularity !== 'day') {
    return res.status(400).json({ error: 'Invalid granularity' });
  }
  if (similarKind && similarKind !== 'phash' && similarKind !== 'clip') {
    return res.status(400).json({ error: 'Invalid similarKind' });
  }
  if ((similarKind === 'phash' || similarKind === 'clip') && !Number.isFinite(similarToFileId)) {
    return res.status(400).json({ error: 'similarToFileId is required for similarKind' });
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
  // Exclude deleted files (status = 'trash') from all file views
  where += ` AND (a.status IS NULL OR a.status != 'trash')`;
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

  if (similarKind === 'phash') {
    const ids = computeSimilarFileIdsByPhash(db, {
      seedFileId: similarToFileId,
      threshold: similarThreshold,
      maxIds: 2000,
    });
    if (ids.length === 0) {
      return res.json({ total: 0, filter, granularity, points: [] });
    }
    const { clause, params } = makeInClause(ids);
    where += ` AND f.id IN ${clause}`;
    whereParams.push(...params);
  }

  if (similarKind === 'clip') {
    try {
      const r = await queryTopKByFileId(similarToFileId, { topK: similarTopK, minScore: similarMinScore });
      const orderedIds = (r.matches || []).map((m) => Number(m.file_id)).filter(Number.isFinite);
      if (orderedIds.length === 0) {
        return res.json({ total: 0, filter, granularity, points: [] });
      }
      const { clause, params } = makeInClause(orderedIds);
      where += ` AND f.id IN ${clause}`;
      whereParams.push(...params);

      // Date index is not meaningful under similarity ordering; return empty points.
      const totalQuery = `
        SELECT COUNT(*) as count
        FROM files f
        LEFT JOIN assets a ON a.hash = f.hash
        ${where}
      `;
      const total = db.prepare(totalQuery).get(...whereParams).count;
      return res.json({ total, filter, granularity, points: [] });
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: String(e?.message || e) });
    }
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
async function handleFilesList(req, res) {
  const db = getDB();
  const source = req.method === 'POST' ? { ...(req.query || {}), ...(req.body || {}) } : (req.query || {});
  const page = parseInt(source.page) || 1;
  const limit = Math.min(parseInt(source.limit) || 50, 200);
  const offset = (page - 1) * limit;
  const filter = String(source.filter || 'all');
  const organized = parseBool01(source.organized);
  const hasDup = parseBool01(source.hasDup);
  const hasPeople = parseBool01(source.hasPeople);
  const personCountMin = parseIntParam(source.personCountMin);
  const personCountMax = parseIntParam(source.personCountMax);
  const exts = parseExtsParam(source.exts);
  const hash = source.hash != null ? String(source.hash) : null;
  const pathContains = source.pathContains != null ? String(source.pathContains) : null;
  const fromMs = source.from != null ? Number(source.from) : null;
  const toMs = source.to != null ? Number(source.to) : null;
  const people = parseCsvParam(source.people).map(n => parseInt(n)).filter(n => Number.isFinite(n));
  const similarKind = source.similarKind != null ? String(source.similarKind) : null;
  const similarToFileId = parseIntParam(source.similarToFileId);
  const similarThreshold = clampIntParam(source.similarThreshold, { min: 0, max: 32, fallback: 10 });
  const similarTopK = clampIntParam(source.similarTopK, { min: 1, max: 5000, fallback: 500 });
  const similarMinScore = source.similarMinScore != null && source.similarMinScore !== '' ? Number(source.similarMinScore) : null;
  const smartQueryRaw = source.smartQuery != null ? String(source.smartQuery) : '';
  const smartQuery = smartQueryRaw.trim();
  const smartTopK = clampIntParam(source.smartTopK, { min: 1, max: 5000, fallback: 1000 });
  const smartMinScore = source.smartMinScore != null && source.smartMinScore !== '' ? Number(source.smartMinScore) : null;
  if (similarKind && similarKind !== 'phash' && similarKind !== 'clip') {
    return res.status(400).json({ error: 'Invalid similarKind' });
  }
  if (smartQuery && similarKind) {
    return res.status(400).json({ error: 'smartQuery cannot be combined with similarKind' });
  }
  if ((similarKind === 'phash' || similarKind === 'clip') && !Number.isFinite(similarToFileId)) {
    return res.status(400).json({ error: 'similarToFileId is required for similarKind' });
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

  // Extend WHERE with additional filters.
  if (!where) where = 'WHERE 1=1';
  // Exclude deleted files (status = 'trash') from all file views
  where += ` AND (a.status IS NULL OR a.status != 'trash')`;

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

  if (smartQuery) {
    const wantProfile =
      String(req.query?.profile || '').trim() === '1' ||
      String(req.headers['x-tidy-profile'] || '').trim() === '1';
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const profiler = createProfiler({ enabled: wantProfile, name: `${req.method} /api/files`, requestId, eventLoop: true });
    profiler.mark('start');

    const minScore = smartMinScore != null && Number.isFinite(Number(smartMinScore)) ? Number(smartMinScore) : null;
    const maxTopK = 5000;
    let topK = Math.max(1, Math.min(maxTopK, Math.max(smartTopK, offset + limit)));

    smartSearchInflight += 1;
    const inflightAtStart = smartSearchInflight;
    profiler.mark('inflight', { smartSearchInflight: inflightAtStart });

    try {
      const embedOut = await clipTextEmbed({ query: smartQuery, normalize: true, profile: profiler });
      const embedding = embedOut?.embedding;
      const aiServiceProfile = embedOut?.profile || null;
      profiler.mark('clip.text.embed.done', { queryLen: smartQuery.length, minScore, topK });

      while (true) {
        const r = await queryTopKByVector(embedding, { topK, minScore, profile: profiler });
        const matches = Array.isArray(r.matches) ? r.matches : [];
        profiler.mark('clip.ann.done', { model: r.model, got: matches.length });

        const orderedIds = matches.map((m) => Number(m.file_id)).filter(Number.isFinite);
        if (!orderedIds.length) {
          const profile = profiler.end({ empty: true, total: 0, aiService: aiServiceProfile || undefined, smartSearchInflight: inflightAtStart });
          return res.json({
            data: [],
            pagination: { page, limit, total: 0 },
            applied: { filter, smartQuery, minScore, model: r.model },
            ...(profile ? { profile } : {}),
          });
        }

        const scoreById = new Map(matches.map((m) => [Number(m.file_id), Number(m.score)]));
        const { clause, params: idParams } = makeInClause(orderedIds);
        const whereWithIds = `${where} AND f.id IN ${clause}`;

        const totalQuery = `
          SELECT COUNT(*) as count
          FROM files f
          LEFT JOIN assets a ON a.hash = f.hash
          ${whereWithIds}
        `;
        const total = db.prepare(totalQuery).get(...whereParams, ...idParams).count;
        const needsMore = total < offset + limit && topK < maxTopK && matches.length >= topK;
        if (needsMore) {
          const nextTopK = Math.min(maxTopK, Math.max(topK * 2, offset + limit));
          if (nextTopK > topK) {
            topK = nextTopK;
            profiler.mark('clip.topk.expand', { topK });
            continue;
          }
        }

        const order = orderByCaseIds(orderedIds);
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
          ${whereWithIds}
          ORDER BY ${order.sql}
          LIMIT ? OFFSET ?
        `;

        const rows = db.prepare(query).all(...whereParams, ...idParams, ...order.params, limit, offset);
        rows.forEach((row) => {
          row.score = scoreById.get(Number(row.id)) ?? null;
        });

        const profile = profiler.end({ total, returned: rows.length, aiService: aiServiceProfile || undefined, smartSearchInflight: inflightAtStart });
        return res.json({
          data: rows.map(toFileRow),
          pagination: { page, limit, total },
          applied: { filter, smartQuery, minScore, model: r.model },
          ...(profile ? { profile } : {}),
        });
      }
    } catch (e) {
      const profile = profiler.end({ error: String(e?.message || e), smartSearchInflight: inflightAtStart });
      return res.status(e?.statusCode || 500).json({ error: String(e?.message || e), ...(profile ? { profile } : {}) });
    } finally {
      smartSearchInflight = Math.max(0, smartSearchInflight - 1);
    }
  }

  if (similarKind === 'phash') {
    const ids = computeSimilarFileIdsByPhash(db, {
      seedFileId: similarToFileId,
      threshold: similarThreshold,
      maxIds: 2000,
    });
    if (ids.length === 0) {
      return res.json({
        data: [],
        pagination: { page, limit, total: 0 },
        applied: { filter },
      });
    }
    const { clause, params } = makeInClause(ids);
    where += ` AND f.id IN ${clause}`;
    whereParams.push(...params);
  }

  let clipScoreById = null;
  let clipOrder = null;
  if (similarKind === 'clip') {
    try {
      const r = await queryTopKByFileId(similarToFileId, { topK: similarTopK, minScore: similarMinScore });
      const matches = Array.isArray(r.matches) ? r.matches : [];
      const orderedIds = matches.map((m) => Number(m.file_id)).filter(Number.isFinite);
      if (orderedIds.length === 0) {
        return res.json({
          data: [],
          pagination: { page, limit, total: 0 },
          applied: { filter },
        });
      }
      clipScoreById = new Map(matches.map((m) => [Number(m.file_id), Number(m.score)]));
      clipOrder = orderByCaseIds(orderedIds);

      const { clause, params } = makeInClause(orderedIds);
      where += ` AND f.id IN ${clause}`;
      whereParams.push(...params);
    } catch (e) {
      return res.status(e?.statusCode || 500).json({ error: String(e?.message || e) });
    }
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
    ORDER BY ${clipOrder ? clipOrder.sql : `${timeExpr} DESC`}
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(query).all(...(clipOrder ? [...whereParams, ...clipOrder.params] : whereParams), limit, offset);
  if (clipScoreById) {
    rows.forEach((r) => {
      r.score = clipScoreById.get(Number(r.id)) ?? null;
    });
  }

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
}

router.get('/', handleFilesList);
router.post('/', handleFilesList);

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


