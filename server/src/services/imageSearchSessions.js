/**
 * input: 临时参考图生成的 CLIP embedding
 * output: 短期内存搜索会话（不写数据库、文件或索引）
 * pos: 服务端服务层：连接一次性图片上传与可分页的以图搜图请求
 */

const crypto = require('crypto');

const DEFAULT_TTL_MS = Math.max(60_000, Number(process.env.TIDY_IMAGE_SEARCH_TTL_MS) || 30 * 60_000);
const DEFAULT_MAX_SESSIONS = Math.max(1, Math.trunc(Number(process.env.TIDY_IMAGE_SEARCH_MAX_SESSIONS) || 20));

const sessions = new Map();

function removeExpired(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}

function createImageSearchSession({ embedding, model, normalized = true, ttlMs = DEFAULT_TTL_MS } = {}) {
  const vector = Array.isArray(embedding) ? embedding.map(Number) : [];
  if (!vector.length || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('invalid image search embedding');
  }

  const now = Date.now();
  removeExpired(now);
  while (sessions.size >= DEFAULT_MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value);
  }

  const id = crypto.randomBytes(18).toString('base64url');
  const expiresAt = now + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS);
  sessions.set(id, {
    embedding: vector,
    model: String(model || ''),
    normalized: !!normalized,
    createdAt: now,
    expiresAt,
  });
  return { id, expiresAt };
}

function getImageSearchSession(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  removeExpired();
  const session = sessions.get(key);
  if (!session) return null;
  return { ...session, embedding: session.embedding.slice() };
}

function deleteImageSearchSession(id) {
  return sessions.delete(String(id || '').trim());
}

function clearImageSearchSessions() {
  sessions.clear();
}

module.exports = {
  createImageSearchSession,
  getImageSearchSession,
  deleteImageSearchSession,
  clearImageSearchSessions,
};
