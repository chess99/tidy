/**
 * input: AI_SERVICE_URL（环境变量）+ HTTP fetch + 进程内内存缓存
 * output: 调用 ai-service 的推理结果（CLIP 文本/图片 embedding；text 支持缓存/并发去重）
 * pos: 服务端服务层：跨路由/任务复用的 AI 推理客户端（变更需同步更新本头注释与所属目录 README）
 */

const { AI_SERVICE_URL, CLIP_MODEL_ID } = require('../config');

const CLIP_TEXT_EMBED_CACHE_MAX = Math.max(0, Math.trunc(Number(process.env.TIDY_CLIP_TEXT_EMBED_CACHE_MAX) || 200));
const CLIP_TEXT_EMBED_CACHE_TTL_MS = Math.max(
  0,
  Math.trunc(Number(process.env.TIDY_CLIP_TEXT_EMBED_CACHE_TTL_MS) || 5 * 60_000)
);

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

module.exports = { clipTextEmbed, clipImageEmbed };


