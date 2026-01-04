/**
 * input: Express req/res + DB + ai-service(CLIP) + clipIndex(ANN)
 * output: 智能搜索 API（text→image，按相似度排序）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const path = require('path');
const { getDB } = require('../db');
const { clipTextEmbed } = require('../services/aiClient');
const { queryTopKByVector } = require('../services/clipIndex');
const { createProfiler } = require('../utils/profiler');

const router = express.Router();
let searchInflight = 0;

function parseIntSafe(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
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
    organized_to: r.organized_to ?? null,
    dup_count: r.dup_count ?? 0,
    asset_status: r.asset_status,
    asset_taken_at: r.asset_taken_at,
    asset_mime_type: r.asset_mime_type,
    asset_updated_at: r.asset_updated_at,
    asset_thumb_updated_at: r.asset_thumb_updated_at,
    score: r.score != null ? Number(r.score) : null,
  };
}

function orderByCaseIds(ids) {
  // ORDER BY CASE f.id WHEN id1 THEN 0 WHEN id2 THEN 1 ... END
  const parts = [];
  for (let i = 0; i < ids.length; i++) {
    parts.push(`WHEN ? THEN ${i}`);
  }
  const sql = `CASE f.id ${parts.join(' ')} ELSE ${ids.length} END`;
  return { sql, params: ids.slice() };
}

// POST /api/search
// body: { query: string, page?: number, limit?: number, topK?: number, minScore?: number }
router.post('/', async (req, res) => {
  const wantProfile =
    String(req.query?.profile || '').trim() === '1' ||
    String(req.headers['x-tidy-profile'] || '').trim() === '1';
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const profiler = createProfiler({ enabled: wantProfile, name: 'POST /api/search', requestId, eventLoop: true });
  profiler.mark('start');

  const q = String(req.body?.query || '').trim();
  if (!q) return res.status(400).json({ error: 'query required' });

  const page = Math.max(1, parseIntSafe(req.body?.page, 1));
  const limit = Math.max(1, Math.min(parseIntSafe(req.body?.limit, 50), 200));
  const offset = (page - 1) * limit;

  const minScoreRaw = req.body?.minScore;
  const minScore = minScoreRaw != null && Number.isFinite(Number(minScoreRaw)) ? Number(minScoreRaw) : null;

  const requestedTopK = parseIntSafe(req.body?.topK, 1000);
  const need = Math.max(offset + limit, 1);
  const topK = Math.max(need, Math.min(requestedTopK, 5000));
  profiler.mark('parsed', { page, limit, topK, offset, minScore, queryLen: q.length });

  searchInflight += 1;
  const inflightAtStart = searchInflight;
  profiler.mark('inflight', { searchInflight: inflightAtStart });

  try {
    const embedOut = await clipTextEmbed({ query: q, normalize: true, profile: profiler });
    const embedding = embedOut?.embedding;
    const aiServiceProfile = embedOut?.profile || null;
    profiler.mark('clip.text.embed.done');

    const r = await queryTopKByVector(embedding, { topK, minScore, profile: profiler });
    profiler.mark('clip.ann.done', { model: r.model, got: Array.isArray(r.matches) ? r.matches.length : 0 });
    const matches = Array.isArray(r.matches) ? r.matches : [];
    const total = matches.length;

    const slice = matches.slice(offset, offset + limit);
    const ids = slice.map((m) => Number(m.file_id)).filter(Number.isFinite);
    if (!ids.length) {
      const profile = profiler.end({ empty: true, total, aiService: aiServiceProfile || undefined, searchInflight: inflightAtStart });
      return res.json({
        data: [],
        pagination: { page, limit, total },
        applied: { query: q, minScore, model: r.model },
        ...(profile ? { profile } : {}),
      });
    }

    const scoreById = new Map(slice.map((m) => [Number(m.file_id), Number(m.score)]));
    const { sql: orderSql, params: orderParams } = orderByCaseIds(ids);

    const db = getDB();
    const dupCountExpr = `(SELECT COUNT(*) FROM files f2 WHERE f2.hash = f.hash)`;
    const timeExpr = `COALESCE(a.taken_at, f.mtime_ms, f.discovered_at, f.scanned_at)`;

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
        ) AS organized_to,
        ${timeExpr} AS _t
      FROM files f
      LEFT JOIN assets a ON a.hash = f.hash
      WHERE f.id IN (${ids.map(() => '?').join(',')})
      ORDER BY ${orderSql}
    `;

    const rows = profiler.wrap
      ? await profiler.wrap('db.files.batch', () => db.prepare(query).all(...ids, ...orderParams), { ids: ids.length })
      : db.prepare(query).all(...ids, ...orderParams);
    profiler.mark('db.files.batch.done', { rows: rows.length });
    const data = rows.map((row) => ({ ...row, score: scoreById.get(Number(row.id)) ?? null })).map(toFileRow);
    profiler.mark('serialized', { data: data.length });

    const profile = profiler.end({ total, returned: data.length, aiService: aiServiceProfile || undefined, searchInflight: inflightAtStart });
    return res.json({
      data,
      pagination: { page, limit, total },
      applied: { query: q, minScore, model: r.model },
      ...(profile ? { profile } : {}),
    });
  } catch (e) {
    const profile = profiler.end({ error: String(e?.message || e), searchInflight: inflightAtStart });
    return res.status(e?.statusCode || 500).json({ error: String(e?.message || e), ...(profile ? { profile } : {}) });
  } finally {
    searchInflight = Math.max(0, searchInflight - 1);
  }
});

module.exports = router;


