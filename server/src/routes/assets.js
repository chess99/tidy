/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const { getDB } = require('../db');
const path = require('path');
const sharp = require('sharp');
const { getThumbnailPath, RAW_EXTS, extractEmbeddedPreview } = require('../scanner/thumbnail');
const fs = require('fs-extra');
const mime = require('mime-types');
const { execFile } = require('child_process');
let ffmpegPath = null;
try {
  // Optional dependency, installed for video poster extraction.
  ffmpegPath = require('ffmpeg-static');
} catch {
  ffmpegPath = null;
}
const { PREVIEW_DIR, POSTER_DIR } = require('../config');
const { loadConfig } = require('../configStore');

const router = express.Router();

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent, child) {
  try {
    const p = stripTrailingSep(path.resolve(String(parent)));
    const c = stripTrailingSep(path.resolve(String(child)));
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

// Ensure preview dir exists
try {
  fs.ensureDirSync(PREVIEW_DIR);
} catch {
  // ignore
}
try {
  fs.ensureDirSync(POSTER_DIR);
} catch {
  // ignore
}

function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parseCsvParam(v) {
  if (!v) return [];
  return String(v)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function makeInClause(values) {
  const params = values.slice();
  const clause = `(${params.map(() => '?').join(',')})`;
  return { clause, params };
}

function insertChange(db, entity, entityId, type) {
  try {
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
      entity,
      String(entityId),
      type,
      Date.now()
    );
  } catch {
    // ignore
  }
}

async function uniquePath(destPath) {
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let candidate = destPath;
  for (let i = 1; i <= 9999; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fs.pathExists(candidate))) return candidate;
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

// List assets
router.get('/', (req, res) => {
  const db = getDB();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  // Filter by status (default: all except trash?)
  // For now return all
  const statusFilter = req.query.status;
  
  let query = 'SELECT * FROM assets';
  const params = [];

  if (statusFilter) {
    query += ' WHERE status = ?';
    params.push(statusFilter);
  }

  query += ' ORDER BY taken_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const assets = db.prepare(query).all(...params);
  const total = statusFilter
    ? db.prepare('SELECT COUNT(*) as count FROM assets WHERE status = ?').get(statusFilter).count
    : db.prepare('SELECT COUNT(*) as count FROM assets').get().count;

  // Parse metadata
  const results = assets.map(a => ({
    ...a,
    metadata: safeJsonParse(a.metadata)
  }));

  res.json({
    data: results,
    pagination: { page, limit, total }
  });
});

// Batch fetch assets by hashes
router.get('/batch', (req, res) => {
  const db = getDB();
  const hashes = parseCsvParam(req.query.hashes).slice(0, 500);
  if (hashes.length === 0) return res.json({ data: [] });

  const { clause, params } = makeInClause(hashes);
  const rows = db.prepare(`SELECT * FROM assets WHERE hash IN ${clause}`).all(...params);
  res.json({
    data: rows.map(a => ({
      ...a,
      metadata: safeJsonParse(a.metadata),
    }))
  });
});

// Get single asset details with files
router.get('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  
  const asset = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  // Return files in a stable "best representative first" order, so the UI can reliably
  // infer ext/path from files[0] when needed.
  const files = db
    .prepare(
      `
      SELECT *
      FROM files
      WHERE hash = ?
      ORDER BY COALESCE(mtime_ms, updated_at, discovered_at, scanned_at, 0) DESC, id DESC
      `
    )
    .all(hash);

  res.json({
    ...asset,
    metadata: safeJsonParse(asset.metadata),
    files
  });
});

// Update asset (e.g. trash it)
router.patch('/:hash', (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  const { status } = req.body;

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const result = db.prepare('UPDATE assets SET status = ? WHERE hash = ?').run(status, hash);
  
  if (result.changes === 0) return res.status(404).json({ error: 'Asset not found' });

  res.json({ success: true, hash, status });
});

// Batch update asset status (used by multi-select operations)
router.post('/batch-status', async (req, res) => {
  const db = getDB();
  const cfg = await loadConfig();
  const trashDir = cfg.workspace?.trashDir;
  if (!trashDir) return res.status(500).json({ error: 'workspace.trashDir not configured' });

  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.map(String).filter(Boolean) : [];
  const status = String(req.body?.status || '').trim();

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const limited = hashes.slice(0, 500);
  if (limited.length === 0) return res.status(400).json({ error: 'hashes is required' });

  const report = { updated: 0, deleted: 0, errors: 0, messages: [] };
  await fs.ensureDir(trashDir);

  for (const hash of limited) {
    try {
      const r = db.prepare('UPDATE assets SET status = ?, updated_at = ? WHERE hash = ?').run(status, Date.now(), hash);
      if (r.changes > 0) report.updated++;
      insertChange(db, 'asset', hash, `status:${status}`);

      if (status !== 'trash') continue;

      // New semantics:
      // - Keep exactly ONE physical copy for the asset under TRASH_DIR (last-copy keep).
      // - All other physical copies are deleted (do not go into TRASH_DIR).
      // - Keep the corresponding files row (now pointing to TRASH_DIR) so UI can render trash items.
      const rows = db
        .prepare(
          `
          SELECT id, path, mtime_ms, updated_at, discovered_at, scanned_at
          FROM files
          WHERE hash = ?
          ORDER BY COALESCE(mtime_ms, updated_at, discovered_at, scanned_at, 0) DESC, id DESC
          `
        )
        .all(hash);

      const existing = [];
      for (const f of rows) {
        if (!f?.path) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await fs.pathExists(f.path)) existing.push({ ...f, path: String(f.path) });
        else {
          // Cleanup DB rows for missing paths to keep DB consistent.
          try {
            db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
            insertChange(db, 'file', f.id, 'deleted');
          } catch {
            // ignore
          }
        }
      }

      const alreadyInTrash = existing.find((f) => isUnder(trashDir, f.path)) || null;
      const keep = alreadyInTrash || existing[0] || null;

      let keepPath = keep?.path || null;

      if (keep && keepPath && !isUnder(trashDir, keepPath)) {
        // Move the kept copy into trashDir.
        const fileName = path.basename(keepPath);
        const trashRaw = path.join(trashDir, `${hash}_${fileName}`);
        // eslint-disable-next-line no-await-in-loop
        const trashPath = await uniquePath(trashRaw);
        // eslint-disable-next-line no-await-in-loop
        await fs.ensureDir(path.dirname(trashPath));

        const tnow = Date.now();
        const info = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, status, created_at, updated_at)
          VALUES ('trash', ?, ?, ?, ?, 'pending', ?, ?)
        `).run(hash, keep.id, keepPath, trashPath, tnow, tnow);

        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.move(keepPath, trashPath, { overwrite: false });
          db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(trashPath, Date.now(), keep.id);
          db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', Date.now(), info.lastInsertRowid);
          insertChange(db, 'file', keep.id, 'trashed');
          keepPath = trashPath;
        } catch (e) {
          report.errors++;
          const msg = String(e.message || e);
          report.messages.push(`Failed to keep trash copy ${keepPath}: ${msg}`);
          try {
            db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', Date.now(), msg, info.lastInsertRowid);
          } catch {
            // ignore
          }
          // If we couldn't keep a copy, we still proceed to mark asset as trash (but target may be null).
          keepPath = null;
        }
      }

      // Delete all other existing copies.
      for (const f of existing) {
        if (!keep || f.id === keep.id) continue;
        if (!f.path) continue;

        const dnow = Date.now();
        const info = db.prepare(`
          INSERT INTO file_ops (op, hash, file_id, from_path, to_path, status, created_at, updated_at)
          VALUES ('delete', ?, ?, ?, NULL, 'pending', ?, ?)
        `).run(hash, f.id, f.path, dnow, dnow);

        try {
          // eslint-disable-next-line no-await-in-loop
          await fs.remove(f.path);
          db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
          db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', Date.now(), info.lastInsertRowid);
          insertChange(db, 'file', f.id, 'deleted');
          report.deleted++;
        } catch (e) {
          report.errors++;
          const msg = String(e.message || e);
          report.messages.push(`Failed to delete ${f.path}: ${msg}`);
          try {
            db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', Date.now(), msg, info.lastInsertRowid);
          } catch {
            // ignore
          }
        }
      }

      // Asset-level cleanup for trash.
      try {
        db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
      } catch {
        // ignore
      }
      try {
        db.prepare(`UPDATE assets SET target_path = ?, updated_at = ? WHERE hash = ?`).run(keepPath, Date.now(), hash);
      } catch {
        // ignore
      }
    } catch (e) {
      report.errors++;
      report.messages.push(`Failed to update ${hash}: ${String(e.message || e)}`);
    }
  }

  res.json(report);
});

// Serve thumbnail
router.get('/:hash/thumb', async (req, res) => {
  const { hash } = req.params;
  const thumbPath = getThumbnailPath(hash);
  
  if (await fs.pathExists(thumbPath)) {
    res.sendFile(thumbPath);
  } else {
    res.status(404).send('Not found');
  }
});

// Serve raw file (first available)
router.get('/:hash/raw', async (req, res) => {
  const { hash } = req.params;
  const db = getDB();
  const file = db.prepare('SELECT path FROM files WHERE hash = ? LIMIT 1').get(hash);
  
  if (file && await fs.pathExists(file.path)) {
    res.sendFile(file.path);
  } else {
    res.status(404).send('Not found');
  }
});

function parseIntSafe(v, { min, max, fallback }) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (Number.isFinite(min) && i < min) return fallback;
  if (Number.isFinite(max) && i > max) return fallback;
  return i;
}

async function pickFirstExistingFileByHash(db, hash) {
  // Prefer a file that actually exists, otherwise fall back to any.
  const rows = db
    .prepare(
      `SELECT path, ext, mime_guess
       FROM files
       WHERE hash = ?
       ORDER BY COALESCE(updated_at, 0) DESC, id DESC
       LIMIT 20`
    )
    .all(hash);

  for (const r of rows) {
    if (r?.path && (await fs.pathExists(r.path))) return r;
  }
  return rows?.[0] || null;
}

// Serve preview (large image or RAW embedded preview)
router.get('/:hash/preview', async (req, res) => {
  const { hash } = req.params;
  const db = getDB();

  const max = parseIntSafe(req.query.max, { min: 256, max: 16384, fallback: 4096 });
  const quality = parseIntSafe(req.query.q, { min: 40, max: 95, fallback: 85 });

  const cachePath = path.join(PREVIEW_DIR, `${hash}_${max}_${quality}.jpg`);
  try {
    if (await fs.pathExists(cachePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(cachePath);
    }
  } catch {
    // ignore cache errors
  }

  const file = await pickFirstExistingFileByHash(db, hash);
  if (!file?.path) return res.status(404).send('Not found');
  if (!(await fs.pathExists(file.path))) return res.status(404).send('Not found');

  const ext = String(file.ext || path.extname(file.path) || '').toLowerCase();
  const isRaw = RAW_EXTS.has(ext);

  try {
    let input = file.path;
    if (isRaw) {
      const embedded = await extractEmbeddedPreview(file.path);
      if (!embedded) return res.status(415).send('RAW preview not available');
      input = embedded; // Buffer
    }

    await sharp(input)
      .rotate()
      .resize(max, max, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toFile(cachePath);

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(cachePath);
  } catch (e) {
    // As a last resort, try serving the original file for normal images.
    try {
      if (!isRaw) return res.sendFile(file.path);
    } catch {
      // ignore
    }
    return res.status(500).send(String(e?.message || 'preview_failed'));
  }
});

function parseRangeHeader(range, size) {
  if (!range || typeof range !== 'string') return null;
  const m = range.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];

  let start = startRaw === '' ? null : Number(startRaw);
  let end = endRaw === '' ? null : Number(endRaw);
  if ((start != null && !Number.isFinite(start)) || (end != null && !Number.isFinite(end))) return null;

  // suffix-byte-range-spec: bytes=-500
  if (start == null && end != null) {
    const suffixLen = Math.trunc(end);
    if (suffixLen <= 0) return null;
    start = Math.max(0, size - suffixLen);
    end = size - 1;
  } else {
    start = Math.trunc(start ?? 0);
    end = Math.trunc(end ?? (size - 1));
  }

  if (start < 0 || start >= size) return null;
  if (end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

async function pickFirstExistingVideoFileByHash(db, hash) {
  const rows = db
    .prepare(
      `SELECT f.path, f.ext, f.mime_guess, a.mime_type AS asset_mime_type
       FROM files f
       LEFT JOIN assets a ON a.hash = f.hash
       WHERE f.hash = ?
       ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
       LIMIT 50`
    )
    .all(hash);

  const scored = rows
    .map((r) => {
      const mt = String(r.asset_mime_type || r.mime_guess || '').toLowerCase();
      const isVideo = mt.startsWith('video/');
      return { r, score: isVideo ? 2 : 0 };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r);

  for (const r of scored) {
    if (r?.path && (await fs.pathExists(r.path))) return r;
  }
  return scored?.[0] || null;
}

// Serve video stream (supports Range for in-app playback)
router.get('/:hash/video', async (req, res) => {
  const { hash } = req.params;
  const db = getDB();

  const file = await pickFirstExistingVideoFileByHash(db, hash);
  if (!file?.path) return res.status(404).send('Not found');
  if (!(await fs.pathExists(file.path))) return res.status(404).send('Not found');

  let stat;
  try {
    stat = await fs.stat(file.path);
  } catch {
    return res.status(404).send('Not found');
  }
  const size = stat.size;
  if (!Number.isFinite(size) || size <= 0) return res.status(404).send('Not found');

  const mt =
    (file.asset_mime_type && String(file.asset_mime_type)) ||
    (file.mime_guess && String(file.mime_guess)) ||
    mime.lookup(file.path) ||
    'application/octet-stream';

  res.setHeader('Content-Type', mt);
  res.setHeader('Accept-Ranges', 'bytes');

  const hasRangeHeader = req.headers.range != null;
  const range = parseRangeHeader(req.headers.range, size);
  if (!range && hasRangeHeader) {
    res.status(416);
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  if (!range) {
    res.setHeader('Content-Length', String(size));
    const stream = fs.createReadStream(file.path);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }

  const { start, end } = range;
  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(chunkSize));

  const stream = fs.createReadStream(file.path, { start, end });
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
});

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(String(stderr || err.message || 'exec failed'));
        e.code = err.code;
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

// Serve cached video poster frame (best-effort)
router.get('/:hash/poster', async (req, res) => {
  const { hash } = req.params;
  const db = getDB();

  const maxW = parseIntSafe(req.query.w, { min: 120, max: 3840, fallback: 640 });
  const quality = parseIntSafe(req.query.q, { min: 2, max: 31, fallback: 4 }); // ffmpeg q:v (lower is better)

  const cachePath = path.join(POSTER_DIR, `${hash}_${maxW}_q${quality}.jpg`);
  try {
    if (await fs.pathExists(cachePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(cachePath);
    }
  } catch {
    // ignore
  }

  if (!ffmpegPath) {
    return res.status(501).send('ffmpeg not available');
  }

  const file = await pickFirstExistingVideoFileByHash(db, hash);
  if (!file?.path) return res.status(404).send('Not found');
  if (!(await fs.pathExists(file.path))) return res.status(404).send('Not found');

  // Keep a .jpg extension so ffmpeg can infer muxer from output filename.
  const tmpPath = path.join(
    POSTER_DIR,
    `${hash}_${maxW}_q${quality}.tmp_${process.pid}_${Date.now()}.jpg`
  );
  try {
    // -ss before -i is faster for many formats.
    await execFileAsync(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', '1',
      '-i', file.path,
      '-frames:v', '1',
      // Note: do NOT include shell quotes in execFile args.
      // Escape comma in expressions (ffmpeg uses comma as filter separator).
      '-vf', `scale=min(${maxW}\\,iw):-2`,
      '-q:v', String(quality),
      '-y',
      tmpPath,
    ]);
    await fs.move(tmpPath, cachePath, { overwrite: true });
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.sendFile(cachePath);
  } catch (e) {
    try {
      await fs.remove(tmpPath);
    } catch {
      // ignore
    }
    return res.status(500).send(String(e?.message || 'poster_failed'));
  }
});

module.exports = router;

