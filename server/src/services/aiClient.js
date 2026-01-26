/**
 * input: AI_SERVICE_URL（环境变量）+ HTTP fetch + SQLite(getDB) + 进程内内存缓存 + 文件系统
 * output: 调用 ai-service 的推理结果（人脸检测/embedding、CLIP 文本/图片 embedding；text 支持缓存/并发去重/落盘）
 * pos: 服务端服务层：跨路由/任务复用的 AI 推理客户端（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs');
const { AI_SERVICE_URL, CLIP_MODEL_ID } = require('../config');

const CLIP_TEXT_EMBED_CACHE_MAX = Math.max(0, Math.trunc(Number(process.env.TIDY_CLIP_TEXT_EMBED_CACHE_MAX) || 200));
const CLIP_TEXT_EMBED_CACHE_TTL_MS = Math.max(
  0,
  Math.trunc(Number(process.env.TIDY_CLIP_TEXT_EMBED_CACHE_TTL_MS) || 5 * 60_000)
);
const CLIP_TEXT_EMBED_DB_CACHE_MAX = Math.max(0, Math.trunc(Number(process.env.TIDY_CLIP_TEXT_EMBED_DB_CACHE_MAX) || 20_000));

// LRU-ish cache: Map preserves insertion order; we refresh by delete+set on get.
const _clipTextCache = new Map(); // key -> { value, expiresAt, cachedAt }
const _clipTextInflight = new Map(); // key -> Promise<value>

function _cacheGet(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (e.expiresAt && Date.now() > e.expiresAt) {
    map.delete(key);
    return null;
  }
  // Refresh recency.
  map.delete(key);
  map.set(key, e);
  return e;
}

function _cacheSet(map, key, value, { ttlMs, max } = {}) {
  const now = Date.now();
  const ttl = Math.max(0, Math.trunc(Number(ttlMs) || 0));
  const e = { value, cachedAt: now, expiresAt: ttl ? now + ttl : null };
  if (map.has(key)) map.delete(key);
  map.set(key, e);
  const cap = Math.max(0, Math.trunc(Number(max) || 0));
  if (cap > 0) {
    while (map.size > cap) {
      const oldest = map.keys().next().value;
      map.delete(oldest);
    }
  }
  return e;
}

function packF32(arr) {
  const f = Float32Array.from((arr || []).map(Number));
  return Buffer.from(f.buffer);
}

function unpackF32(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const view = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
  return Array.from(view);
}

function getDBSafe() {
  try {
    // eslint-disable-next-line global-require
    const { getDB } = require('../db');
    return getDB();
  } catch {
    return null;
  }
}

function dbGetClipTextEmbedding({ model, normalized, text }) {
  const db = getDBSafe();
  if (!db) return null;
  try {
    const r = db
      .prepare(
        `
        SELECT dim, embedding
        FROM clip_text_embeddings
        WHERE model = ? AND normalized = ? AND text = ?
        LIMIT 1
        `
      )
      .get(String(model), normalized ? 1 : 0, String(text));
    if (!r) return null;
    const emb = unpackF32(r.embedding);
    if (!emb.length) return null;
    return { dim: Number(r.dim), embedding: emb };
  } catch {
    return null;
  }
}

function dbPutClipTextEmbedding({ model, normalized, text, embedding }) {
  const db = getDBSafe();
  if (!db) return;
  try {
    const emb = Array.isArray(embedding) ? embedding.map(Number) : [];
    if (!emb.length) return;
    const dim = emb.length;
    const ts = Date.now();
    db.prepare(
      `
      INSERT INTO clip_text_embeddings (model, normalized, text, dim, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(model, normalized, text) DO UPDATE SET
        dim=excluded.dim,
        embedding=excluded.embedding,
        updated_at=excluded.updated_at
      `
    ).run(String(model), normalized ? 1 : 0, String(text), dim, packF32(emb), ts);

    if (CLIP_TEXT_EMBED_DB_CACHE_MAX > 0) {
      // Keep newest N rows per model; delete older ones (best-effort).
      db.prepare(
        `
        DELETE FROM clip_text_embeddings
        WHERE model = ?
          AND rowid NOT IN (
            SELECT rowid
            FROM clip_text_embeddings
            WHERE model = ?
            ORDER BY updated_at DESC
            LIMIT ?
          )
        `
      ).run(String(model), String(model), CLIP_TEXT_EMBED_DB_CACHE_MAX);
    }
  } catch {
    // ignore cache write failures (should not break requests)
  }
}

function ensureUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!b) throw new Error('AI_SERVICE_URL not configured');
  if (!path) return b;
  if (path.startsWith('/')) return `${b}${path}`;
  return `${b}/${path}`;
}

function withQuery(url, key, value) {
  const u = String(url || '');
  const k = String(key || '').trim();
  if (!k) return u;
  const hasQ = u.includes('?');
  const sep = hasQ ? '&' : '?';
  return `${u}${sep}${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`;
}

async function postJson(url, body, { profile = null } = {}) {
  const wantsRemoteProfile = !!profile?.enabled;
  const u0 = String(url || '');
  const u = wantsRemoteProfile ? withQuery(u0, 'profile', '1') : u0;
  const startedAt = Date.now();
  const res = await fetch(u, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(wantsRemoteProfile ? { 'x-tidy-profile': '1' } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  profile?.mark('ai.http', { url: u, status: res.status, ms: Date.now() - startedAt });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ai-service error ${res.status}: ${text || res.statusText}`);
  }
  const out = await res.json();
  profile?.mark('ai.json', { url: u });
  return out;
}

async function clipTextEmbed({ query, normalize = true, profile = null } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query required');
  const url = ensureUrl(AI_SERVICE_URL, '/clip/text-embed');
  const payload = { text: q, normalize };

  const cacheKey = `${normalize ? 1 : 0}:${q}`;
  const modelKey = String(CLIP_MODEL_ID || '');

  // Persistent DB cache (cross-restart): deterministic per (model, normalize, text).
  if (modelKey && CLIP_TEXT_EMBED_DB_CACHE_MAX > 0) {
    const hit = dbGetClipTextEmbedding({ model: modelKey, normalized: normalize, text: q });
    if (hit?.embedding?.length) {
      profile?.mark?.('ai.clipTextEmbed.db.hit', { model: modelKey, key: cacheKey, dim: hit.dim });
      const v = { model: modelKey, dim: hit.dim, normalized: !!normalize, embedding: hit.embedding, profile: null };
      // Prime in-memory LRU to keep the hot path fast.
      if (CLIP_TEXT_EMBED_CACHE_MAX > 0 && CLIP_TEXT_EMBED_CACHE_TTL_MS > 0) {
        _cacheSet(_clipTextCache, cacheKey, { ...v, embedding: hit.embedding.slice() }, { ttlMs: CLIP_TEXT_EMBED_CACHE_TTL_MS, max: CLIP_TEXT_EMBED_CACHE_MAX });
      }
      return v;
    }
  }

  if (CLIP_TEXT_EMBED_CACHE_MAX > 0 && CLIP_TEXT_EMBED_CACHE_TTL_MS > 0) {
    const hit = _cacheGet(_clipTextCache, cacheKey);
    if (hit?.value) {
      profile?.mark?.('ai.clipTextEmbed.cache.hit', { key: cacheKey, cachedAt: hit.cachedAt, expiresAt: hit.expiresAt });
      // Return a defensive copy to avoid accidental mutation by callers.
      return { ...hit.value, embedding: Array.isArray(hit.value.embedding) ? hit.value.embedding.slice() : hit.value.embedding };
    }

    const inflight = _clipTextInflight.get(cacheKey);
    if (inflight) {
      profile?.mark?.('ai.clipTextEmbed.cache.inflight', { key: cacheKey });
      const v = await inflight;
      return { ...v, embedding: Array.isArray(v.embedding) ? v.embedding.slice() : v.embedding };
    }
  }

  const run = async () => {
    const out = await postJson(url, payload, { profile });
    const emb = Array.isArray(out?.embeddings) ? out.embeddings[0] : null;
    if (!Array.isArray(emb)) throw new Error('invalid clip/text-embed response');
    const v = {
      model: String(out.model || CLIP_MODEL_ID),
      dim: Number(out.dim),
      normalized: !!out.normalized,
      embedding: emb,
      profile: out?.profile || null,
    };
    if (modelKey && CLIP_TEXT_EMBED_DB_CACHE_MAX > 0) {
      dbPutClipTextEmbedding({ model: modelKey, normalized: !!normalize, text: q, embedding: emb });
      profile?.mark?.('ai.clipTextEmbed.db.store', { model: modelKey, max: CLIP_TEXT_EMBED_DB_CACHE_MAX });
    }
    if (CLIP_TEXT_EMBED_CACHE_MAX > 0 && CLIP_TEXT_EMBED_CACHE_TTL_MS > 0) {
      _cacheSet(_clipTextCache, cacheKey, { ...v, embedding: emb.slice() }, { ttlMs: CLIP_TEXT_EMBED_CACHE_TTL_MS, max: CLIP_TEXT_EMBED_CACHE_MAX });
      profile?.mark?.('ai.clipTextEmbed.cache.store', { key: cacheKey, max: CLIP_TEXT_EMBED_CACHE_MAX, ttlMs: CLIP_TEXT_EMBED_CACHE_TTL_MS });
    }
    return v;
  };

  // Note: CLIP model selection is handled inside ai-service via env (TIDY_CLIP_MODEL_ID).
  // We keep CLIP_MODEL_ID in server config for index/metadata consistency.
  if (CLIP_TEXT_EMBED_CACHE_MAX > 0 && CLIP_TEXT_EMBED_CACHE_TTL_MS > 0) {
    const p = run().finally(() => _clipTextInflight.delete(cacheKey));
    _clipTextInflight.set(cacheKey, p);
    return await p;
  }

  return await run();
}

async function clipImageEmbed({ imagePath, normalize = true, profile = null } = {}) {
  const p = String(imagePath || '').trim();
  if (!p) throw new Error('imagePath required');
  const url = ensureUrl(AI_SERVICE_URL, '/clip/image-embed');
  const out = await postJson(url, { image_path: p, normalize }, { profile });
  const emb = Array.isArray(out?.embeddings) ? out.embeddings[0] : null;
  if (!Array.isArray(emb)) throw new Error('invalid clip/image-embed response');
  return {
    model: String(out.model || CLIP_MODEL_ID),
    dim: Number(out.dim),
    normalized: !!out.normalized,
    embedding: emb,
    profile: out?.profile || null,
  };
}

async function detectFaces({ imagePath, profile = null } = {}) {
  const p = String(imagePath || '').trim();
  if (!p) throw new Error('imagePath required');
  if (!fs.existsSync(p)) throw new Error(`imagePath not found: ${p}`);

  // Read image file and convert to base64
  const imageBuffer = fs.readFileSync(p);
  const imageBase64 = imageBuffer.toString('base64');

  const url = ensureUrl(AI_SERVICE_URL, '/detect+embed');
  const out = await postJson(url, { image_base64: imageBase64 }, { profile });

  // Convert InsightFace format to internal format
  // InsightFace: {faces: [{box: [x1,y1,x2,y2], embedding: [...], score: number, kps?: [...]}]}
  // Internal: {detection: {box: {x,y,width,height}, score}, descriptor: [...]}
  const faces = Array.isArray(out?.faces) ? out.faces : [];
  return faces.map((f) => {
    const box = Array.isArray(f.box) && f.box.length === 4 ? f.box : [0, 0, 0, 0];
    const [x1, y1, x2, y2] = box.map(Number);
    return {
      detection: {
        box: {
          x: x1,
          y: y1,
          width: x2 - x1,
          height: y2 - y1,
        },
        score: Number(f.score || 0),
      },
      descriptor: Array.isArray(f.embedding) ? f.embedding : [],
    };
  });
}

module.exports = { clipTextEmbed, clipImageEmbed, detectFaces };


