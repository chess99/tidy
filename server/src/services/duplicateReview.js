const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { THUMB_DIR } = require('../config');
const { RAW_EXTS } = require('../scanner/thumbnail');

const VERSION = 1;
const caches = new WeakMap();
const imageCaches = new WeakMap();
const basename = (p) => String(p).replace(/\\/g, '/').split('/').pop();
const stem = (p) => basename(p).replace(/\.[^.]+$/, '').toLowerCase();
const parent = (p) => String(p).replace(/\\/g, '/').replace(/\/[^/]+$/, '').toLowerCase();
const raw = (p) => RAW_EXTS.has(path.extname(p).toLowerCase());
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parseHash = (hex) => [parseInt(hex.slice(0, 8), 16), parseInt(hex.slice(8), 16)];
const bits32 = (v) => {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};
const popcount = (a, b) => bits32(a[0] ^ b[0]) + bits32(a[1] ^ b[1]);

// A metric tree finds every neighbour within the radius, unlike matching one
// identical 16-bit segment, which silently misses valid pairs.
class HashTree {
  add(item) {
    const hash = parseHash(item.phash);
    if (!this.root) { this.root = { hash, items: [item], children: new Map() }; return; }
    let node = this.root;
    while (node) {
      const distance = popcount(hash, node.hash);
      if (!distance) { node.items.push(item); return; }
      if (!node.children.has(distance)) {
        node.children.set(distance, { hash, items: [item], children: new Map() });
        return;
      }
      node = node.children.get(distance);
    }
  }
  find(item, radius = 6) {
    const hash = parseHash(item.phash);
    const stack = this.root ? [this.root] : [];
    const found = [];
    while (stack.length) {
      const node = stack.pop();
      const d = popcount(hash, node.hash);
      if (d <= radius) found.push(...node.items);
      for (const [edge, child] of node.children) {
        if (edge >= d - radius && edge <= d + radius) stack.push(child);
      }
    }
    return found;
  }
}

function comparePixels(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return false;
  let error = 0, sx = 0, sy = 0, xx = 0, yy = 0, xy = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] / 255, y = b[i] / 255;
    error += (x - y) ** 2;
    sx += x; sy += y; xx += x * x; yy += y * y; xy += x * y;
  }
  const n = a.length;
  const vx = xx - sx * sx / n, vy = yy - sy * sy / n;
  // Flat pictures have unstable perceptual hashes and no useful evidence.
  if (vx / n < 0.002 || vy / n < 0.002) return false;
  const correlation = (xy - sx * sy / n) / Math.sqrt(vx * vy);
  return Math.sqrt(error / n) <= 0.055 && correlation >= 0.99;
}

function cosine(a, b) {
  if (!a || !b || a.model !== b.model || a.dim !== b.dim) return undefined;
  if (a.embedding.length !== a.dim * 4 || b.embedding.length !== b.dim * 4) return undefined;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.dim; i++) {
    const x = a.embedding.readFloatLE(i * 4), y = b.embedding.readFloatLE(i * 4);
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : undefined;
}

function isCompanion(a, b) {
  return raw(a.path) !== raw(b.path) && stem(a.path) === stem(b.path) && parent(a.path) === parent(b.path);
}

function makeGroup(items, kind) {
  const sorted = [...items].sort((a, b) => a.file_id - b.file_id);
  const id = digest([VERSION, kind, sorted.map((i) => [i.file_id, i.hash, i.path, i.size, i.mtime_ms])]);
  const ranked = [...sorted].sort((a, b) =>
    (Boolean(b.organized_to) - Boolean(a.organized_to)) * (kind === 'hash' ? 1 : 0) ||
    (b.width * b.height || 0) - (a.width * a.height || 0) || b.size - a.size || a.file_id - b.file_id);
  const mixedFormats = new Set(sorted.map((i) => raw(i.path))).size > 1;
  return { id, kind, items: sorted, suggested_keep_file_id: mixedFormats ? null : ranked[0].file_id };
}

async function buildReview(items, { loadPixels, loadEmbedding = () => undefined } = {}) {
  const groups = [], exact = new Map(), representatives = [];
  const coverage = { images: 0, pending: 0, companions: 0, unreadable: 0 };
  for (const item of items) {
    const key = item.hash_algo === 'sha256' && item.hash ? `${item.hash}:${item.size}` : `file:${item.file_id}`;
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(item);
  }
  for (const same of exact.values()) {
    if (same.length > 1) groups.push(makeGroup(same, 'hash'));
    // Exact copies are reviewed separately, once per content in the visual pass.
    representatives.push(same[0]);
  }
  const tree = new HashTree(), edges = new Map(), pixelCache = new Map(), embeddingCache = new Map();
  const pixels = async (item) => {
    if (!pixelCache.has(item.file_id)) {
      try { pixelCache.set(item.file_id, await loadPixels(item)); }
      catch { pixelCache.set(item.file_id, null); coverage.unreadable++; }
    }
    return pixelCache.get(item.file_id);
  };
  const embedding = (item) => {
    if (!embeddingCache.has(item.file_id)) embeddingCache.set(item.file_id, loadEmbedding(item));
    return embeddingCache.get(item.file_id);
  };
  let processed = 0;
  for (const item of representatives) {
    if (!String(item.asset_mime_type || '').startsWith('image/')) continue;
    coverage.images++;
    if (!/^[a-f0-9]{16}$/i.test(item.phash || '') || !item.width || !item.height || !item.hash) {
      coverage.pending++; continue;
    }
    for (const other of tree.find(item)) {
      if (isCompanion(item, other)) { coverage.companions++; continue; }
      const ratio = (item.width / item.height) / (other.width / other.height);
      if (Math.abs(ratio - 1) > 0.02) continue;
      if (!comparePixels(await pixels(item), await pixels(other))) continue;
      const semantic = cosine(embedding(item), embedding(other));
      if (semantic !== undefined && (!Number.isFinite(semantic) || semantic < 0.98)) continue;
      if (!edges.has(item.file_id)) edges.set(item.file_id, new Set());
      if (!edges.has(other.file_id)) edges.set(other.file_id, new Set());
      edges.get(item.file_id).add(other.file_id);
      edges.get(other.file_id).add(item.file_id);
    }
    tree.add(item);
    if (++processed % 128 === 0) await new Promise(setImmediate);
  }
  // Complete-link groups: every member must match every other member. A~B and
  // B~C must never imply A~C. Stable ordering also prevents overlapping groups.
  const assigned = new Set();
  const byId = new Map(representatives.map((i) => [i.file_id, i]));
  for (const item of representatives) {
    if (assigned.has(item.file_id) || !edges.has(item.file_id)) continue;
    const group = [item];
    for (const id of [...edges.get(item.file_id)].sort((a, b) => a - b)) {
      if (assigned.has(id) || !group.every((member) => edges.get(member.file_id)?.has(id))) continue;
      group.push(byId.get(id));
    }
    if (group.length < 2) continue;
    group.forEach((i) => assigned.add(i.file_id));
    groups.push(makeGroup(group, 'similar'));
  }
  return { groups, coverage };
}

function readItems(db) {
  return db.prepare(`SELECT f.id file_id, f.path, f.size, f.mtime_ms, f.hash, f.hash_algo, f.phash,
    a.metadata, a.thumb_updated_at, a.mime_type asset_mime_type, a.captured_at asset_captured_at,
    (SELECT al.name FROM album_assets aa JOIN albums al ON al.id = aa.album_id
      WHERE aa.hash = f.hash ORDER BY aa.album_id DESC LIMIT 1) organized_to
    FROM files f JOIN assets a ON a.hash = f.hash
    WHERE f.missing = 0 AND a.status != 'trash' ORDER BY f.id`).all().map((row) => {
    let meta = {};
    try { meta = JSON.parse(row.metadata || '{}') || {}; } catch { /* A corrupt metadata row stays unclassified. */ }
    const { metadata, ...item } = row;
    return { ...item, file_name: basename(row.path), width: meta.width || null, height: meta.height || null };
  });
}

function invalidateReview(db) { caches.delete(db); }

async function getReview(db) {
  const stamp = JSON.stringify([
    db.prepare('SELECT count(*) n, max(updated_at) t, max(thumb_updated_at) th FROM files').get(),
    db.prepare('SELECT count(*) n, max(updated_at) t FROM assets').get(),
    db.prepare('SELECT count(*) n, max(updated_at) t FROM clip_embeddings').get(),
  ]);
  let cached = caches.get(db);
  if (!cached || (cached.done && (cached.stamp !== stamp || Date.now() - cached.time > 60000))) {
    if (!imageCaches.has(db)) imageCaches.set(db, new Map());
    const images = imageCaches.get(db);
    const items = readItems(db);
    const currentHashes = new Set(items.map((i) => i.hash));
    for (const key of images.keys()) if (!currentHashes.has(key)) images.delete(key);
    const embeddingQuery = db.prepare('SELECT model, dim, embedding FROM clip_embeddings WHERE file_id = ? AND hash = ?');
    const pending = buildReview(items, {
      loadPixels: async (item) => {
        const cachedImage = images.get(item.hash);
        if (cachedImage && cachedImage.time === item.thumb_updated_at) return cachedImage.pixels;
        const pixels = await sharp(path.join(THUMB_DIR, `${item.hash}.jpg`)).rotate()
          .resize(64, 64, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
        images.set(item.hash, { time: item.thumb_updated_at, pixels });
        return pixels;
      },
      loadEmbedding: (item) => embeddingQuery.get(item.file_id, item.hash),
    });
    cached = { stamp, time: Date.now(), pending, done: false };
    caches.set(db, cached);
    pending.then(() => { cached.done = true; cached.time = Date.now(); }, () => {});
    pending.catch(() => { if (caches.get(db) === cached) caches.delete(db); });
  }
  const result = await cached.pending;
  const dismissed = new Set(db.prepare('SELECT signature FROM duplicate_reviews').all().map((r) => r.signature));
  return { ...result, groups: result.groups.filter((g) => !dismissed.has(g.id)), dismissed: dismissed.size };
}

module.exports = { buildReview, comparePixels, cosine, HashTree, isCompanion, getReview, invalidateReview };
