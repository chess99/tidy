/**
 * input: AI_SERVICE_URL（环境变量）+ HTTP fetch
 * output: 调用 ai-service 的推理结果（CLIP 文本/图片 embedding）
 * pos: 服务端服务层：跨路由/任务复用的 AI 推理客户端（变更需同步更新本头注释与所属目录 README）
 */

const { AI_SERVICE_URL, CLIP_MODEL_ID } = require('../config');

function ensureUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!b) throw new Error('AI_SERVICE_URL not configured');
  if (!path) return b;
  if (path.startsWith('/')) return `${b}${path}`;
  return `${b}/${path}`;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ai-service error ${res.status}: ${text || res.statusText}`);
  }
  return await res.json();
}

async function clipTextEmbed({ query, normalize = true } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('query required');
  const url = ensureUrl(AI_SERVICE_URL, '/clip/text-embed');
  const payload = { text: q, normalize };
  // Note: CLIP model selection is handled inside ai-service via env (TIDY_CLIP_MODEL_ID).
  // We keep CLIP_MODEL_ID in server config for index/metadata consistency.
  const out = await postJson(url, payload);
  const emb = Array.isArray(out?.embeddings) ? out.embeddings[0] : null;
  if (!Array.isArray(emb)) throw new Error('invalid clip/text-embed response');
  return { model: String(out.model || CLIP_MODEL_ID), dim: Number(out.dim), normalized: !!out.normalized, embedding: emb };
}

async function clipImageEmbed({ imagePath, normalize = true } = {}) {
  const p = String(imagePath || '').trim();
  if (!p) throw new Error('imagePath required');
  const url = ensureUrl(AI_SERVICE_URL, '/clip/image-embed');
  const out = await postJson(url, { image_path: p, normalize });
  const emb = Array.isArray(out?.embeddings) ? out.embeddings[0] : null;
  if (!Array.isArray(emb)) throw new Error('invalid clip/image-embed response');
  return { model: String(out.model || CLIP_MODEL_ID), dim: Number(out.dim), normalized: !!out.normalized, embedding: emb };
}

module.exports = { clipTextEmbed, clipImageEmbed };


