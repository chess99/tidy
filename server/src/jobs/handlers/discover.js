const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');
const picomatch = require('picomatch');
const { getDB } = require('../../db');
const { MANAGED_ROOT, TRASH_DIR } = require('../../config');
const { normalizePathForDb } = require('../../utils/normalizePath');
const { insertChange, now } = require('./_util');

function normGlobPath(p) {
  return String(p || '').replace(/\\/g, '/');
}

function shouldIncludeExt(filePath, scanType) {
  const ext = path.extname(filePath);
  const norm = ext ? String(ext).toLowerCase().replace(/^\./, '') : '';
  if (!norm) return !!scanType?.includeNoExt;
  const set = new Set((Array.isArray(scanType?.exts) ? scanType.exts : []).map((e) => String(e).toLowerCase()));
  return set.has(norm);
}

function isUnder(parent, child) {
  try {
    const p = path.resolve(String(parent));
    const c = path.resolve(String(child));
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

function upsertFileDiscovered(db, filePath, stat) {
  const ts = now();
  const ext = path.extname(filePath).toLowerCase() || null;
  const mimeGuess = mime.lookup(filePath) || null;
  const normPath = normalizePathForDb(filePath);

  // Existing row?
  const existing = db.prepare('SELECT id, scanned_at, hash FROM files WHERE path = ?').get(normPath);
  const changed = !existing?.scanned_at || (Number(stat.mtimeMs) > Number(existing.scanned_at || 0));

  if (existing) {
    const hashMaybe = changed ? null : existing.hash;
    db.prepare(`
      UPDATE files
      SET missing = 0,
          size = ?,
          mtime_ms = ?,
          ext = COALESCE(ext, ?),
          mime_guess = COALESCE(mime_guess, ?),
          updated_at = ?,
          discovered_at = COALESCE(discovered_at, ?),
          hash = ?,
          hash_status = CASE
            WHEN ? = 1 THEN 'pending'
            ELSE COALESCE(hash_status, 'pending')
          END,
          thumb_status = CASE
            WHEN ? = 1 THEN 'pending'
            ELSE COALESCE(thumb_status, 'pending')
          END
      WHERE id = ?
    `).run(stat.size, stat.mtimeMs, ext, mimeGuess, ts, ts, hashMaybe, changed ? 1 : 0, changed ? 1 : 0, existing.id);

    insertChange('file', existing.id, 'upsert');
    return { id: existing.id, changed };
  }

  const info = db.prepare(`
    INSERT INTO files (
      path, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash, hash_status, thumb_status
    ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, NULL, 'pending', 'pending')
  `).run(normPath, stat.size, stat.mtimeMs, ext, mimeGuess, ts, ts);

  const id = info.lastInsertRowid;
  insertChange('file', id, 'upsert');
  return { id, changed: true };
}

async function walkDir(ctx, root, onFile) {
  if (ctx.isCancelRequested()) return;
  let items;
  try {
    items = await fs.readdir(root);
  } catch {
    return;
  }

  for (const item of items) {
    if (ctx.isCancelRequested()) return;
    if (item.startsWith('.')) continue;

    const fullPath = path.join(root, item);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (isUnder(MANAGED_ROOT, fullPath) || isUnder(TRASH_DIR, fullPath)) continue;
      // eslint-disable-next-line no-await-in-loop
      await walkDir(ctx, fullPath, onFile);
    } else if (stat.isFile()) {
      // eslint-disable-next-line no-await-in-loop
      await onFile(fullPath, stat);
    }
  }
}

async function handleDiscover(ctx) {
  const cfg = await ctx.loadConfig();
  const roots = Array.isArray(ctx.job?.params?.roots) && ctx.job.params.roots.length
    ? ctx.job.params.roots.map(String)
    : await ctx.getEnabledRoots();

  if (!roots.length) return { ok: false, error: 'no_enabled_roots' };

  const excludeGlobs = Array.isArray(cfg?.scan?.excludeGlobs) ? cfg.scan.excludeGlobs : [];
  const minBytes = Number(cfg?.scan?.minFileSizeBytes || 0) || 0;
  const scanType = cfg?.scanType || { exts: [], includeNoExt: true };

  const isExcluded = excludeGlobs.length
    ? picomatch(excludeGlobs, { dot: true, nocase: process.platform === 'win32' })
    : () => false;

  const db = getDB();

  const stats = {
    roots: roots.slice(),
    walked: 0,
    insertedOrUpdated: 0,
    changed: 0,
    filtered: 0,
    excluded: 0,
    errors: 0,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'discover', roots: stats.roots, walked: 0 });

  for (const root of roots) {
    if (ctx.isCancelRequested()) break;
    const rootAbs = path.resolve(String(root));
    // eslint-disable-next-line no-await-in-loop
    await walkDir(ctx, rootAbs, async (filePath, stat) => {
      if (ctx.isCancelRequested()) return;

      const globPath = normGlobPath(filePath);
      if (isExcluded(globPath)) {
        stats.excluded++;
        return;
      }
      if (!shouldIncludeExt(filePath, scanType)) {
        stats.filtered++;
        return;
      }
      if (minBytes > 0 && Number(stat.size) < minBytes) {
        stats.filtered++;
        return;
      }

      stats.walked++;
      try {
        const r = upsertFileDiscovered(db, filePath, stat);
        stats.insertedOrUpdated++;
        if (r.changed) stats.changed++;
      } catch {
        stats.errors++;
      }

      if (stats.walked % 200 === 0) {
        ctx.heartbeat({ phase: 'discover', walked: stats.walked, changed: stats.changed, filtered: stats.filtered, excluded: stats.excluded, errors: stats.errors });
      }
    });
  }

  // Auto-trigger pipeline
  try {
    const after = Array.isArray(cfg?.tasks?.autoTrigger?.afterDiscover) ? cfg.tasks.autoTrigger.afterDiscover : [];
    for (const t of after) {
      if (ctx.isCancelRequested()) break;
      if (String(t) === 'enrich') {
        ctx.enqueue('enrich', 'missing', {});
      }
    }
  } catch {
    // ignore
  }

  ctx.heartbeat({ phase: 'discover_done', walked: stats.walked });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleDiscover };


