/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const mime = require('mime-types');
const { getDB } = require('../../db');
const { MANAGED_ROOT, TRASH_DIR } = require('../../config');
const { computeHash } = require('../../scanner/hasher');
const { extractMetadata } = require('../../scanner/metadata');
const { extractVideoMetadata } = require('../../scanner/videoMetadata');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('../../scanner/thumbnail');
const { computePHash } = require('../../scanner/phash');
const { insertChange, now } = require('./_util');

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v ?? {});
  } catch {
    return JSON.stringify({});
  }
}

function shouldTryThumb({ mimeType, filePath }) {
  const extLower = path.extname(filePath).toLowerCase();
  return (mimeType && String(mimeType).startsWith('image/')) || RAW_EXTS.has(extLower);
}

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

function shouldReconcileForPath(filePath) {
  return isUnder(TRASH_DIR, filePath) || isUnder(MANAGED_ROOT, filePath);
}

function scoreFileRow(r) {
  const t =
    (Number.isFinite(Number(r?.mtime_ms)) ? Number(r.mtime_ms) : null) ??
    (Number.isFinite(Number(r?.updated_at)) ? Number(r.updated_at) : null) ??
    (Number.isFinite(Number(r?.discovered_at)) ? Number(r.discovered_at) : null) ??
    (Number.isFinite(Number(r?.scanned_at)) ? Number(r.scanned_at) : null) ??
    0;
  const id = Number.isFinite(Number(r?.id)) ? Number(r.id) : 0;
  return (t * 10) + id;
}

function pickBestRow(rows) {
  let best = null;
  let bestScore = -Infinity;
  for (const r of Array.isArray(rows) ? rows : []) {
    const sc = scoreFileRow(r);
    if (!best || sc > bestScore) {
      best = r;
      bestScore = sc;
    }
  }
  return best;
}

async function listExistingFileRowsByHash(db, hash) {
  const rows = db
    .prepare(
      `
      SELECT id, path, missing, mtime_ms, updated_at, discovered_at, scanned_at
      FROM files
      WHERE hash = ?
      ORDER BY id ASC
      `
    )
    .all(hash);

  // Treat DB as an index: we only consider rows that still exist on disk.
  // Note: legacy DBs may have files.missing=1; we intentionally ignore that flag here.
  const candidates = rows.filter((r) => r?.path);
  if (!candidates.length) return [];

  const existsFlags = await Promise.all(candidates.map((r) => fs.pathExists(String(r.path))));
  return candidates.filter((_, idx) => existsFlags[idx]);
}

function parseAlbumNameFromManagedPath(filePath) {
  try {
    const rel = path.relative(String(MANAGED_ROOT), String(filePath));
    const parts = rel.split(path.sep).filter(Boolean);
    const first = parts.length ? String(parts[0]) : null;
    if (!first) return null;
    if (first === '_Trash') return null;
    return first;
  } catch {
    return null;
  }
}

async function reconcileAssetByFilesystem(db, hash) {
  const ts = now();
  const rows = await listExistingFileRowsByHash(db, hash);
  if (!rows.length) return;

  const inTrash = rows.filter((r) => isUnder(TRASH_DIR, r.path));
  const inManagedNonTrash = rows.filter((r) => isUnder(MANAGED_ROOT, r.path) && !isUnder(TRASH_DIR, r.path));

  // TRASH_DIR means the asset has been deleted and we're keeping the last copy for restore.
  if (inTrash.length > 0 && inTrash.length === rows.length) {
    const best = pickBestRow(inTrash) || pickBestRow(rows);
    if (!best?.path) return;

    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(best.path, ts, hash);
    db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
    insertChange('asset', hash, 'trash_fs');
    return;
  }

  // Any file under managed root (but not _Trash) means "sorted".
  if (inManagedNonTrash.length > 0) {
    const best = pickBestRow(inManagedNonTrash) || pickBestRow(rows);
    if (!best?.path) return;

    db.prepare(`UPDATE assets SET status = 'sorted', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(best.path, ts, hash);
    insertChange('asset', hash, 'sorted_fs');

    const albumName = parseAlbumNameFromManagedPath(best.path);
    if (albumName) {
      db.prepare(`INSERT OR IGNORE INTO albums (name, created_at, updated_at) VALUES (?, ?, ?)`).run(albumName, ts, ts);
      db.prepare(`UPDATE albums SET updated_at = ? WHERE name = ?`).run(ts, albumName);
      const album = db.prepare(`SELECT id FROM albums WHERE name = ?`).get(albumName);
      const albumId = album?.id;
      if (albumId != null) {
        // single-folder semantics
        db.prepare(`DELETE FROM album_assets WHERE hash = ? AND album_id <> ?`).run(hash, albumId);
        db.prepare(`INSERT OR REPLACE INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)`).run(albumId, hash, ts);
        db.prepare(`UPDATE albums SET updated_at = ? WHERE id = ?`).run(ts, albumId);
      }
    } else {
      // The file is under MANAGED_ROOT but not under a named album directory; clear album mapping.
      db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
    }

    return;
  }

  // Outside managed/trash: default to inbox unless user explicitly ignored it.
  const current = db.prepare(`SELECT status FROM assets WHERE hash = ?`).get(hash);
  if (String(current?.status || '') === 'ignored') return;

  db.prepare(`UPDATE assets SET status = 'inbox', target_path = NULL, missing = 0, updated_at = ? WHERE hash = ?`).run(ts, hash);
  db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
  insertChange('asset', hash, 'inbox_fs');
}

async function handleEnrich(ctx) {
  const cfg = await ctx.loadConfig();
  const mode = String(ctx.job?.mode || 'missing');
  const concurrency = Math.max(1, Math.min(64, Number(cfg?.tasks?.concurrency?.enrich || 4)));
  const db = getDB();
  const reconciledHashes = new Set();

  const stats = {
    mode,
    concurrency,
    picked: 0,
    processed: 0,
    skipped: 0,
    ok: 0,
    updated: 0,
    thumbOk: 0,
    thumbSkipped: 0,
    errors: 0,
    missingFiles: 0,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'pick' });

  // Pick candidate files (DB-driven).
  // We do NOT fully re-hash "done + unchanged" rows even in all-mode.
  const where = `
    path IS NOT NULL
    AND (
      missing = 1
      OR
      scanned_at IS NULL
      OR mtime_ms IS NULL
      OR scanned_at < mtime_ms
      OR hash IS NULL
      OR COALESCE(hash_status, 'pending') != 'done'
      OR COALESCE(thumb_status, 'pending') != 'ready'
      OR COALESCE(phash_status, 'pending') NOT IN ('done', 'unsupported')
    )
  `;

  const rows = db.prepare(`
    SELECT id, path, hash, scanned_at, mtime_ms, ext, mime_guess, hash_status, thumb_status, phash, phash_status
    FROM files
    WHERE ${where}
    ORDER BY id ASC
    LIMIT 200000
  `).all();

  stats.picked = rows.length;
  ctx.heartbeat({ phase: 'run', total: rows.length, processed: 0 });

  const q = fastq.promise(async (row) => {
    if (ctx.isCancelRequested()) return;
    stats.processed++;

    const fileId = row.id;
    const filePath = String(row.path);

    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      stats.missingFiles++;
      const hash = row.hash ? String(row.hash) : null;

      // Policy: missing paths are removed from `files` (files tab only shows existing instances).
      // For assets:
      // - if status != inbox: keep asset as a semantic object and mark assets.missing=1
      // - if status == inbox: delete asset entirely (and any remaining files rows)
      try {
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
        insertChange('file', fileId, 'deleted');
      } catch {
        // ignore
      }

      if (hash) {
        try {
          const stillExisting = await listExistingFileRowsByHash(db, hash);
          if (stillExisting.length > 0) {
            // Some physical instance still exists; ensure asset is not marked missing.
            try {
              const ts = now();
              db.prepare(`UPDATE assets SET missing = 0, updated_at = COALESCE(updated_at, ?) WHERE hash = ?`).run(ts, hash);
              insertChange('asset', hash, 'unmissing_fs');
            } catch {
              // ignore
            }
            return;
          }

          // No physical instances exist: clean up remaining file rows and decide asset fate.
          const fileIds = db.prepare('SELECT id FROM files WHERE hash = ?').all(hash).map((r) => r.id);
          try {
            db.prepare('DELETE FROM files WHERE hash = ?').run(hash);
          } catch {
            // ignore
          }
          for (const id of fileIds) {
            try {
              insertChange('file', id, 'deleted');
            } catch {
              // ignore
            }
          }

          const asset = db.prepare('SELECT status FROM assets WHERE hash = ?').get(hash);
          const status = String(asset?.status || 'inbox');

          if (status !== 'inbox') {
            const ts = now();
            db.prepare(`UPDATE assets SET missing = 1, updated_at = ? WHERE hash = ?`).run(ts, hash);
            insertChange('asset', hash, 'missing_fs');
          } else {
            // Remove ephemeral assets (never user-touched) when they disappear from disk.
            try {
              db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
              db.prepare('DELETE FROM asset_tags WHERE hash = ?').run(hash);
              db.prepare('DELETE FROM faces WHERE hash = ?').run(hash);
              db.prepare('UPDATE clip_embeddings SET hash = NULL WHERE hash = ?').run(hash);
            } catch {
              // ignore best-effort cleanup
            }
            db.prepare('DELETE FROM assets WHERE hash = ?').run(hash);
            insertChange('asset', hash, 'deleted_fs');
          }
        } catch {
          // ignore cleanup failures
        }
      }
      return;
    }

    const unchanged = row.scanned_at && Number(stat.mtimeMs) <= Number(row.scanned_at || 0);
    const mimeType = mime.lookup(filePath) || row.mime_guess || null;
    const phashNeeded = !row.phash || String(row.phash_status || '') !== 'done';

    // For missing-mode, if unchanged and already hashed, only backfill thumb if needed.
    if (mode === 'missing' && unchanged && row.hash && String(row.hash_status) === 'done') {
      // thumb backfill
      try {
        const hash = String(row.hash);
        if (row.thumb_status !== 'ready') {
          const thumbPath = getThumbnailPath(hash);
          const exists = await fs.pathExists(thumbPath);
          if (exists) {
            db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE id = ?').run('ready', now(), fileId);
            insertChange('file', fileId, 'thumb_ready');
            stats.thumbOk++;
          } else if (shouldTryThumb({ mimeType, filePath })) {
            const extLower = path.extname(filePath).toLowerCase();
            const created = await generateThumbnail(filePath, hash, { ext: extLower });
            if (created) {
              const ts = now();
              db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(ts, hash);
              db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE id = ?').run('ready', ts, fileId);
              insertChange('asset', hash, 'thumb_ready');
              insertChange('file', fileId, 'thumb_ready');
              stats.thumbOk++;
            } else {
              stats.thumbSkipped++;
            }
          }
        }
      } catch {
        stats.errors++;
      }

      // Filesystem-truth reconciliation: if we are scanning managed/trash, rebuild status even if unchanged.
      if (shouldReconcileForPath(filePath)) {
        try {
          await reconcileAssetByFilesystem(db, hash);
          reconciledHashes.add(hash);
        } catch {
          // ignore reconcile errors (keep enrich robust)
        }
      }

      // pHash backfill for unchanged files
      if (phashNeeded) {
        try {
          const extLower = path.extname(filePath).toLowerCase();
          const mt = String(mimeType || '').toLowerCase();
          const isImage = mt.startsWith('image/');
          const isRaw = RAW_EXTS.has(extLower);
          if (isImage || isRaw) {
            const phash = await computePHash(filePath);
            db.prepare('UPDATE files SET phash = ?, phash_status = ?, updated_at = ? WHERE id = ?').run(phash, 'done', now(), fileId);
            insertChange('file', fileId, 'phash_done');
          } else {
            db.prepare('UPDATE files SET phash_status = ? WHERE id = ?').run('unsupported', fileId);
          }
        } catch {
          try {
            db.prepare('UPDATE files SET phash_status = ? WHERE id = ?').run('error', fileId);
          } catch {
            // ignore
          }
        }
      }

      stats.skipped++;
      return;
    }

    // Compute hash + upsert asset metadata
    try {
      const hash = await computeHash(filePath);
      const existingAsset = db.prepare('SELECT hash, status FROM assets WHERE hash = ?').get(hash);
      const status = existingAsset ? existingAsset.status : 'inbox';

      const metadata = mimeType && String(mimeType).startsWith('image/')
        ? await extractMetadata(filePath)
        : (mimeType && String(mimeType).startsWith('video/') ? await extractVideoMetadata(filePath) : null);

      const takenAt = metadata?.taken_at ? metadata.taken_at : stat.mtimeMs;
      const cameraMake = metadata?.camera_make ? String(metadata.camera_make) : null;
      const cameraModel = metadata?.camera_model ? String(metadata.camera_model) : null;
      const isCamera = (cameraMake || cameraModel) ? 1 : 0;
      const ts = now();

      if (existingAsset) {
        db.prepare(`
          UPDATE assets
          SET mime_type = COALESCE(mime_type, ?),
              size = COALESCE(size, ?),
              metadata = COALESCE(metadata, ?),
              taken_at = COALESCE(taken_at, ?),
              camera_make = COALESCE(camera_make, ?),
              camera_model = COALESCE(camera_model, ?),
              is_camera = CASE
                WHEN COALESCE(is_camera, 0) = 1 THEN 1
                WHEN ? = 1 THEN 1
                ELSE COALESCE(is_camera, 0)
              END,
              missing = 0,
              updated_at = ?
          WHERE hash = ?
        `).run(
          mimeType,
          stat.size,
          safeJsonStringify(metadata || {}),
          takenAt,
          cameraMake,
          cameraModel,
          isCamera,
          ts,
          hash
        );
      } else {
        db.prepare(`
          INSERT INTO assets (hash, mime_type, size, metadata, taken_at, status, missing, camera_make, camera_model, is_camera, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `).run(
          hash,
          mimeType,
          stat.size,
          safeJsonStringify(metadata || {}),
          takenAt,
          status,
          cameraMake,
          cameraModel,
          isCamera,
          ts
        );
        stats.ok++;
      }

      // Update file row
      db.prepare(`
        UPDATE files
        SET hash = ?,
            scanned_at = ?,
            size = ?,
            mtime_ms = ?,
            missing = 0,
            updated_at = ?,
            hash_status = 'done'
        WHERE id = ?
      `).run(hash, ts, stat.size, stat.mtimeMs, ts, fileId);

      insertChange('file', fileId, 'upsert');
      insertChange('asset', hash, 'upsert');
      stats.updated++;

      // Filesystem-truth reconciliation (rebuild sorted/trash + album mapping).
      // - Always reconcile the first time we see a hash in this run (to fix stale DB).
      // - Always reconcile when scanning a file under MANAGED_ROOT/TRASH_DIR (to rebuild from filesystem).
      if (!reconciledHashes.has(hash) || shouldReconcileForPath(filePath)) {
        try {
          await reconcileAssetByFilesystem(db, hash);
          reconciledHashes.add(hash);
        } catch {
          // ignore reconcile errors (keep enrich robust)
        }
      }

      // Best-effort thumbnail
      const extLower = path.extname(filePath).toLowerCase();
      if (shouldTryThumb({ mimeType, filePath })) {
        const thumbPath = getThumbnailPath(hash);
        const exists = await fs.pathExists(thumbPath);
        if (!exists) {
          const created = await generateThumbnail(filePath, hash, { ext: extLower });
          if (created) {
            const tts = now();
            try {
              db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(tts, hash);
              db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE id = ?').run('ready', tts, fileId);
            } catch {
              // ignore
            }
            insertChange('asset', hash, 'thumb_ready');
            insertChange('file', fileId, 'thumb_ready');
            stats.thumbOk++;
          } else {
            stats.thumbSkipped++;
            try {
              db.prepare('UPDATE files SET thumb_status = ? WHERE id = ?').run('unsupported', fileId);
            } catch {
              // ignore
            }
          }
        } else {
          // backfill DB status
          try {
            db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = COALESCE(thumb_updated_at, ?) WHERE id = ?').run('ready', now(), fileId);
          } catch {
            // ignore
          }
          stats.thumbOk++;
        }
      } else {
        try {
          db.prepare('UPDATE files SET thumb_status = ? WHERE id = ?').run('unsupported', fileId);
        } catch {
          // ignore
        }
      }

      // Best-effort pHash (for duplicate tool). Images and RAW previews only.
      // This is stored on the FILE instance to support "similar but not identical" detection.
      if (phashNeeded) {
        try {
          const mt = String(mimeType || '').toLowerCase();
          const isImage = mt.startsWith('image/');
          const isRaw = RAW_EXTS.has(extLower);
          if (isImage || isRaw) {
            const phash = await computePHash(filePath);
            db.prepare('UPDATE files SET phash = ?, phash_status = ?, updated_at = ? WHERE id = ?').run(phash, 'done', now(), fileId);
            insertChange('file', fileId, 'phash_done');
          } else {
            db.prepare('UPDATE files SET phash_status = ? WHERE id = ?').run('unsupported', fileId);
          }
        } catch {
          try {
            db.prepare('UPDATE files SET phash_status = ? WHERE id = ?').run('error', fileId);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      stats.errors++;
      try {
        db.prepare('UPDATE files SET hash_status = ? WHERE id = ?').run('error', fileId);
      } catch {
        // ignore
      }
    }

    if (stats.processed % 200 === 0) {
      ctx.heartbeat({ phase: 'run', processed: stats.processed, ok: stats.ok, updated: stats.updated, errors: stats.errors });
    }
  }, concurrency);

  for (const row of rows) {
    if (ctx.isCancelRequested()) break;
    q.push(row);
  }

  await q.drained();

  ctx.heartbeat({ phase: 'done', processed: stats.processed, errors: stats.errors });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleEnrich };


