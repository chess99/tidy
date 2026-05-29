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
const { spawn } = require('child_process');
const { findSystemCommand } = require('../utils/findSystemCommand');
const { PREVIEW_DIR, POSTER_DIR } = require('../config');
const { loadConfig } = require('../configStore');
const { trashAssetKeepOne } = require('../services/assetTrash');

// Lazy load ffmpeg path (system-installed)
let ffmpegPath = null;
async function getFfmpegPath() {
  if (ffmpegPath !== null) return ffmpegPath;
  ffmpegPath = await findSystemCommand('ffmpeg');
  return ffmpegPath;
}

const router = express.Router();

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

function allowedRootsFromConfig(cfg) {
  const roots = [];
  for (const r of Array.isArray(cfg?.scanRoots) ? cfg.scanRoots : []) {
    if (r?.root) roots.push(r.root);
  }
  if (cfg?.workspace?.managedRoot) roots.push(cfg.workspace.managedRoot);
  if (cfg?.workspace?.trashDir) roots.push(cfg.workspace.trashDir);
  return Array.from(new Set(roots.filter(Boolean).map(String)));
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

  // Get phash info from files (any file with phash_status='done')
  const phashInfo = db
    .prepare("SELECT phash, phash_status FROM files WHERE hash = ? AND phash_status = 'done' LIMIT 1")
    .get(hash);

  // Check if CLIP embedding exists
  const clipInfo = db
    .prepare('SELECT 1 as has_clip FROM clip_embeddings WHERE hash = ? LIMIT 1')
    .get(hash);

  res.json({
    ...asset,
    metadata: safeJsonParse(asset.metadata),
    files,
    phash: phashInfo?.phash || null,
    phash_status: phashInfo?.phash_status || null,
    clip_status: clipInfo?.has_clip ? 'ready' : null,
  });
});

// Update asset (e.g. trash it)
router.patch('/:hash', async (req, res) => {
  const db = getDB();
  const { hash } = req.params;
  const { status } = req.body;

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const asset = db.prepare('SELECT hash FROM assets WHERE hash = ?').get(hash);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  if (status === 'trash') {
    const cfg = await loadConfig();
    const trashDir = cfg.workspace?.trashDir;
    if (!trashDir) return res.status(500).json({ error: 'workspace.trashDir not configured' });

    const result = await trashAssetKeepOne(db, {
      hash,
      trashDir,
      allowedRoots: allowedRootsFromConfig(cfg),
      duplicatePolicy: 'quarantine-extra',
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });
    if (!result.ok) return res.status(409).json({ error: result.error || 'trash_failed', hash, result });
    return res.json({ success: true, hash, status, result });
  }

  db.prepare('UPDATE assets SET status = ?, updated_at = ? WHERE hash = ?').run(status, Date.now(), hash);
  insertChange(db, 'asset', hash, `status:${status}`);

  return res.json({ success: true, hash, status });
});

// Batch update asset status (used by multi-select operations)
router.post('/batch-status', async (req, res) => {
  const db = getDB();
  const cfg = await loadConfig();
  const trashDir = cfg.workspace?.trashDir;
  if (String(req.body?.status || '').trim() === 'trash' && !trashDir) {
    return res.status(500).json({ error: 'workspace.trashDir not configured' });
  }

  const hashes = Array.isArray(req.body?.hashes) ? req.body.hashes.map(String).filter(Boolean) : [];
  const status = String(req.body?.status || '').trim();

  if (!['inbox', 'sorted', 'trash', 'ignored'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const limited = hashes.slice(0, 500);
  if (limited.length === 0) return res.status(400).json({ error: 'hashes is required' });

  const report = { updated: 0, deleted: 0, errors: 0, messages: [] };
  if (status === 'trash') await fs.ensureDir(trashDir);
  const allowedRoots = allowedRootsFromConfig(cfg);

  for (const hash of limited) {
    try {
      if (status === 'trash') {
        const r = await trashAssetKeepOne(db, {
          hash,
          trashDir,
          allowedRoots,
          duplicatePolicy: 'quarantine-extra',
          insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
        });
        if (r.ok) {
          report.updated++;
          report.deleted += Number(r.quarantined || 0);
        } else {
          report.errors++;
          report.messages.push(`Failed to trash ${hash}: ${r.error || 'trash_failed'}`);
        }
        continue;
      }

      const r = db.prepare('UPDATE assets SET status = ?, updated_at = ? WHERE hash = ?').run(status, Date.now(), hash);
      if (r.changes > 0) report.updated++;
      insertChange(db, 'asset', hash, `status:${status}`);
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

// Open file location in system file manager
router.post('/:hash/open-location', async (req, res) => {
  const { hash } = req.params;
  const db = getDB();
  const file = db.prepare('SELECT path FROM files WHERE hash = ? LIMIT 1').get(hash);

  if (!file || !(await fs.pathExists(file.path))) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const dirPath = path.dirname(file.path);

    // Platform-specific commands to open file manager
    const platform = process.platform;
    let command;
    let args;

    if (platform === 'darwin') {
      // macOS: use open -R to reveal file in Finder
      command = 'open';
      args = ['-R', file.path];
    } else if (platform === 'win32') {
      // Windows: use explorer /select to highlight file
      command = 'explorer';
      args = ['/select,', file.path];
    } else {
      // Linux: use xdg-open on the directory (can't easily highlight specific file)
      command = 'xdg-open';
      args = [dirPath];
    }

    // Use spawn with detached and stdio ignore to avoid EBADF errors
    const child = spawn(command, args, {
      stdio: 'ignore',
      detached: true,
      shell: false,
    });
    child.unref();

    res.json({ success: true, path: file.path });
  } catch (error) {
    console.error('Error opening file location:', error);
    res.status(500).json({ error: 'Failed to open file location' });
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

  const ffmpeg = await getFfmpegPath();
  if (!ffmpeg) {
    const installHint = process.platform === 'darwin' 
      ? 'brew install ffmpeg'
      : process.platform === 'win32'
      ? 'choco install ffmpeg（或从 https://ffmpeg.org/download.html 下载）'
      : 'sudo apt-get install ffmpeg（或使用对应发行版的包管理器）';
    return res.status(501).json({
      error: 'ffmpeg_not_installed',
      message: '需要安装 ffmpeg 才能生成视频缩略图。请安装 ffmpeg：https://ffmpeg.org/download.html',
      messageEn: 'ffmpeg is required for video poster generation. Please install ffmpeg: https://ffmpeg.org/download.html',
      installHint,
    });
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
    await execFileAsync(ffmpeg, [
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
