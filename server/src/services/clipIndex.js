/**
 * input: SQLite（clip_embeddings/clip_index_meta）+ DATA_DIR 文件系统 + hnswlib-node
 * output: CLIP 近邻检索（topK）与索引构建/加载能力
 * pos: 服务端服务层：为智能搜索/找相似提供向量检索（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');
const { DATA_DIR, CLIP_MODEL_ID } = require('../config');
const { clipImageEmbed } = require('./aiClient');

const INDEX_NAME = 'clip';

function getIndexDir() {
  return path.join(DATA_DIR, 'index');
}

function getIndexPath() {
  return path.join(getIndexDir(), 'clip_hnsw.bin');
}

function requireHnsw() {
  try {
    // eslint-disable-next-line global-require
    return require('hnswlib-node');
  } catch (e) {
    const msg = String(e?.message || e);
    throw new Error(`hnswlib-node not available: ${msg}. Run: cd server && npm i`);
  }
}

function packF32(arr) {
  const f = Float32Array.from(arr.map(Number));
  return Buffer.from(f.buffer);
}

function unpackF32(buf, dim) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  const view = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4));
  if (Number.isFinite(dim) && dim > 0 && view.length >= dim) return Array.from(view.slice(0, dim));
  return Array.from(view);
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

function l2Normalize(v) {
  const n = norm(v);
  if (!Number.isFinite(n) || n <= 0) return v;
  return v.map((x) => x / n);
}

function loadMeta(db) {
  return db.prepare('SELECT * FROM clip_index_meta WHERE name = ?').get(INDEX_NAME) || null;
}

function saveMeta(db, meta) {
  db.prepare(
    `
    INSERT INTO clip_index_meta (name, model, dim, normalized, built_at, file_count, params_json, index_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      model=excluded.model,
      dim=excluded.dim,
      normalized=excluded.normalized,
      built_at=excluded.built_at,
      file_count=excluded.file_count,
      params_json=excluded.params_json,
      index_path=excluded.index_path
    `
  ).run(
    INDEX_NAME,
    meta.model,
    meta.dim,
    meta.normalized ? 1 : 0,
    meta.built_at,
    meta.file_count,
    meta.params_json || null,
    meta.index_path || null
  );
}

function listEmbeddings(db, { model }) {
  const rows = db
    .prepare(
      `
      SELECT file_id, dim, normalized, embedding
      FROM clip_embeddings
      WHERE model = ?
      ORDER BY file_id ASC
      `
    )
    .all(model);
  return rows.map((r) => ({
    file_id: Number(r.file_id),
    dim: Number(r.dim),
    normalized: Number(r.normalized) === 1,
    embedding: r.embedding,
  }));
}

let _index = null; // hnsw index instance
let _indexInfo = null; // { model, dim, normalized, path, builtAt, fileCount }

async function rebuildIndex({ model = CLIP_MODEL_ID, m = 16, efConstruction = 200 } = {}) {
  const db = getDB();
  const rows = listEmbeddings(db, { model });
  if (!rows.length) {
    _index = null;
    _indexInfo = null;
    return { ok: false, reason: 'no_embeddings' };
  }

  const dim = rows[0].dim;
  const normalized = rows.every((r) => r.normalized);
  if (!Number.isFinite(dim) || dim <= 0) throw new Error('invalid clip_embeddings.dim');

  const H = requireHnsw();
  await fs.ensureDir(getIndexDir());
  const indexPath = getIndexPath();

  const index = new H.HierarchicalNSW('ip', dim);
  // Keep headroom for incremental additions (on-demand embeddings / new scans).
  const maxElements = rows.length + 20000;
  index.initIndex(maxElements, m, efConstruction, 123);

  for (const r of rows) {
    const id = Number(r.file_id);
    if (!Number.isFinite(id)) continue;
    const v = unpackF32(r.embedding, dim);
    index.addPoint(v, id);
  }

  index.writeIndexSync(indexPath);
  _index = index;
  _indexInfo = { model, dim, normalized, path: indexPath, builtAt: Date.now(), fileCount: rows.length };

  saveMeta(db, {
    model,
    dim,
    normalized: normalized ? 1 : 0,
    built_at: _indexInfo.builtAt,
    file_count: rows.length,
    params_json: JSON.stringify({ m, efConstruction, space: 'ip', maxElements }),
    index_path: indexPath,
  });

  return { ok: true, model, dim, normalized, fileCount: rows.length, indexPath };
}

async function ensureIndexLoaded({ model = CLIP_MODEL_ID } = {}) {
  if (_index && _indexInfo?.model === model) return _indexInfo;
  const db = getDB();
  const meta = loadMeta(db);
  const indexPath = meta?.index_path ? String(meta.index_path) : getIndexPath();

  const dim = meta?.dim != null ? Number(meta.dim) : null;
  const metaModel = meta?.model ? String(meta.model) : null;

  if (metaModel !== model || !Number.isFinite(dim) || dim <= 0) {
    // Model changed or no meta: rebuild.
    await rebuildIndex({ model });
    return _indexInfo;
  }

  const H = requireHnsw();
  if (!(await fs.pathExists(indexPath))) {
    await rebuildIndex({ model });
    return _indexInfo;
  }

  const index = new H.HierarchicalNSW('ip', dim);
  index.readIndexSync(indexPath, dim);
  _index = index;
  _indexInfo = {
    model,
    dim,
    normalized: Number(meta?.normalized) === 1,
    path: indexPath,
    builtAt: Number(meta?.built_at) || null,
    fileCount: Number(meta?.file_count) || null,
  };
  return _indexInfo;
}

function getEmbeddingByFileId(db, fileId) {
  const id = Number(fileId);
  if (!Number.isFinite(id)) return null;
  const r = db.prepare('SELECT model, dim, normalized, embedding FROM clip_embeddings WHERE file_id = ?').get(id);
  if (!r) return null;
  return {
    model: String(r.model),
    dim: Number(r.dim),
    normalized: Number(r.normalized) === 1,
    embedding: unpackF32(r.embedding, Number(r.dim)),
  };
}

async function ensureEmbeddingForFileId(fileId, { model = CLIP_MODEL_ID } = {}) {
  const db = getDB();
  const id = Number(fileId);
  if (!Number.isFinite(id)) return { ok: false, reason: 'invalid_file_id' };

  const exists = db.prepare('SELECT 1 AS ok FROM clip_embeddings WHERE file_id = ? AND model = ? LIMIT 1').get(id, model);
  if (exists) return { ok: true, existed: true };

  // Resolve file path + hash for inference.
  const row = db
    .prepare(
      `
      SELECT f.id, f.path, f.hash, COALESCE(a.mime_type, f.mime_guess) AS mime
      FROM files f
      LEFT JOIN assets a ON a.hash = f.hash
      WHERE f.id = ?
      LIMIT 1
      `
    )
    .get(id);
  const filePath = row?.path ? String(row.path) : null;
  const hash = row?.hash ? String(row.hash) : null;
  const mime = row?.mime ? String(row.mime) : '';
  if (!filePath) return { ok: false, reason: 'no_path' };
  if (!mime.startsWith('image/')) return { ok: false, reason: 'not_image' };

  const r = await clipImageEmbed({ imagePath: filePath, normalize: true });
  const emb = Array.isArray(r.embedding) ? r.embedding.map(Number) : [];
  const dim = emb.length;
  if (!dim) return { ok: false, reason: 'empty_embedding' };

  const ts = Date.now();
  db.prepare(
    `
    INSERT INTO clip_embeddings (file_id, hash, model, dim, normalized, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      hash=excluded.hash,
      model=excluded.model,
      dim=excluded.dim,
      normalized=excluded.normalized,
      embedding=excluded.embedding,
      updated_at=excluded.updated_at
    `
  ).run(id, hash, String(r.model || model), dim, r.normalized ? 1 : 0, packF32(emb), ts);

  // Best-effort: patch in-memory index (persistent index file will be refreshed by clip_index job).
  try {
    await ensureIndexLoaded({ model: String(r.model || model) });
    if (_index && _indexInfo?.dim === dim) {
      _index.addPoint(l2Normalize(emb), id);
      if (_indexInfo) _indexInfo.fileCount = (_indexInfo.fileCount || 0) + 1;
    }
  } catch {
    // ignore
  }

  return { ok: true, existed: false, dim };
}

async function queryTopKByVector(vec, { model = CLIP_MODEL_ID, topK = 50, minScore = null, efSearch = 128 } = {}) {
  const info = await ensureIndexLoaded({ model });
  if (!_index || !info) return { matches: [], model, dim: null, normalized: true };

  const k = Math.max(1, Math.min(Number(topK) || 50, 5000));
  const db = getDB();

  const q = Array.isArray(vec) ? vec.map(Number) : [];
  const qn = l2Normalize(q);
  _index.setEf(efSearch);
  const ids = _index.searchKnn(qn, k);
  // hnswlib-node returns { neighbors: number[], distances: number[] } in some versions,
  // or a tuple; normalize defensively.
  const neighbors = Array.isArray(ids?.neighbors) ? ids.neighbors : (Array.isArray(ids?.labels) ? ids.labels : ids[0]);
  const cand = Array.isArray(neighbors) ? neighbors.map(Number).filter(Number.isFinite) : [];
  if (!cand.length) return { matches: [], model, dim: info.dim, normalized: true };

  const rows = db
    .prepare(
      `
      SELECT file_id, dim, normalized, embedding
      FROM clip_embeddings
      WHERE file_id IN (${cand.map(() => '?').join(',')})
        AND model = ?
      `
    )
    .all(...cand, model);

  const map = new Map(rows.map((r) => [Number(r.file_id), r]));
  const matches = [];
  for (const fid of cand) {
    const r = map.get(fid);
    if (!r) continue;
    const v = unpackF32(r.embedding, info.dim);
    const vn = Number(r.normalized) === 1 ? v : l2Normalize(v);
    const score = dot(qn, vn);
    if (minScore != null && Number.isFinite(Number(minScore)) && score < Number(minScore)) continue;
    matches.push({ file_id: fid, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches, model, dim: info.dim, normalized: true };
}

async function queryTopKByFileId(seedFileId, { model = CLIP_MODEL_ID, topK = 50, minScore = null } = {}) {
  const db = getDB();
  const seed = getEmbeddingByFileId(db, seedFileId);
  if (!seed) {
    // Try to compute seed embedding on-demand (index still requires bulk embeddings to be useful).
    try {
      await ensureEmbeddingForFileId(seedFileId, { model });
    } catch {
      // ignore
    }
  }
  const seed2 = getEmbeddingByFileId(db, seedFileId);
  if (!seed2) return { matches: [], model, dim: null, normalized: true };
  const seedModel = seed2.model;
  return await queryTopKByVector(seed2.embedding, { model: seedModel || model, topK, minScore });
}

module.exports = {
  INDEX_NAME,
  packF32,
  rebuildIndex,
  ensureIndexLoaded,
  ensureEmbeddingForFileId,
  queryTopKByVector,
  queryTopKByFileId,
};


