const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const mime = require('mime-types');
const { getDB } = require('../../db');
const { computeHash } = require('../../scanner/hasher');
const { TIME_METADATA_VERSION, extractMetadata } = require('../../scanner/metadata');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('../../scanner/thumbnail');
const { computePHash } = require('../../scanner/phash');
const { insertChange, now } = require('./_util');
const { applyMissingPolicyForMissingFileRows } = require('../../services/missingPolicy');

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

function shouldExtractMetadata({ mimeType, filePath }) {
  const mediaType = String(mimeType || '').toLowerCase();
  return mediaType.startsWith('image/') || mediaType.startsWith('video/') || RAW_EXTS.has(path.extname(filePath).toLowerCase());
}

async function readMetadata({ mimeType, filePath }) {
  if (!shouldExtractMetadata({ mimeType, filePath })) return null;
  return extractMetadata(filePath);
}

function timeRank({ source, confidence }) {
  if (source === 'manual' || source === 'manual_unknown') return 100;
  if (source === 'sidecar') return 40;
  if (source === 'embedded' && confidence === 'high') return 30;
  if (source === 'embedded') return 20;
  return 0;
}

function updateExistingAssetMetadata(db, { hash, metadata, stat, mimeType, ts }) {
  const current = db.prepare(`
    SELECT time_source, time_confidence, time_locked, time_metadata_version
    FROM assets WHERE hash = ?
  `).get(hash);
  const replaceTime = !current?.time_locked && (
    Number(current?.time_metadata_version || 0) !== TIME_METADATA_VERSION
    || timeRank({ source: metadata?.time_source, confidence: metadata?.time_confidence })
      > timeRank({ source: current?.time_source, confidence: current?.time_confidence })
  );
  const cameraMake = metadata?.camera_make ? String(metadata.camera_make) : null;
  const cameraModel = metadata?.camera_model ? String(metadata.camera_model) : null;
  const isCamera = cameraMake || cameraModel ? 1 : 0;
  db.prepare(`
    UPDATE assets
    SET mime_type = COALESCE(?, mime_type),
        size = ?,
        metadata = ?,
        captured_at = CASE WHEN ? = 1 THEN ? ELSE captured_at END,
        captured_local_ms = CASE WHEN ? = 1 THEN ? ELSE captured_local_ms END,
        time_zone = CASE WHEN ? = 1 THEN ? ELSE time_zone END,
        time_source = CASE WHEN ? = 1 THEN ? ELSE time_source END,
        time_tag = CASE WHEN ? = 1 THEN ? ELSE time_tag END,
        time_confidence = CASE WHEN ? = 1 THEN ? ELSE time_confidence END,
        time_zone_inferred = CASE WHEN ? = 1 THEN ? ELSE time_zone_inferred END,
        time_scanned_at = ?,
        time_metadata_version = ?,
        camera_make = ?,
        camera_model = ?,
        is_camera = ?,
        missing = 0,
        updated_at = ?
    WHERE hash = ?
  `).run(
    mimeType,
    stat.size,
    safeJsonStringify(metadata || {}),
    replaceTime ? 1 : 0,
    metadata?.captured_at ?? null,
    replaceTime ? 1 : 0,
    metadata?.captured_local_ms ?? null,
    replaceTime ? 1 : 0,
    metadata?.time_zone ?? null,
    replaceTime ? 1 : 0,
    metadata?.time_source ?? null,
    replaceTime ? 1 : 0,
    metadata?.time_tag ?? null,
    replaceTime ? 1 : 0,
    metadata?.time_confidence ?? null,
    replaceTime ? 1 : 0,
    metadata?.time_zone_inferred ? 1 : 0,
    ts,
    TIME_METADATA_VERSION,
    cameraMake,
    cameraModel,
    isCamera,
    ts,
    hash
  );
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

function shouldReconcileForPath(filePath, { managedRoot, trashDir }) {
  return isUnder(trashDir, filePath) || isUnder(managedRoot, filePath);
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

function parseAlbumNameFromManagedPath(filePath, managedRoot, trashDir) {
  try {
    const rel = path.relative(String(managedRoot), String(filePath));
    // If file is outside managedRoot, path.relative returns a path starting with '..'
    if (rel.startsWith('..')) return null;
    const parts = rel.split(path.sep).filter(Boolean);
    const first = parts.length ? String(parts[0]) : null;
    if (!first) return null;
    // Exclude trashDir if it's under managedRoot (to avoid treating it as an album).
    if (trashDir && isUnder(managedRoot, trashDir) && isUnder(trashDir, filePath)) {
      return null;
    }
    return first;
  } catch {
    return null;
  }
}

async function reconcileAssetByFilesystem(db, hash, { managedRoot, trashDir }) {
  const ts = now();
  const rows = await listExistingFileRowsByHash(db, hash);
  if (!rows.length) return 'unchanged';

  const inTrash = rows.filter((r) => isUnder(trashDir, r.path));
  const inManagedNonTrash = rows.filter((r) => isUnder(managedRoot, r.path) && !isUnder(trashDir, r.path));

  // TRASH_DIR means the asset has been deleted and we're keeping the last copy for restore.
  if (inTrash.length > 0 && inTrash.length === rows.length) {
    const best = pickBestRow(inTrash) || pickBestRow(rows);
    if (!best?.path) return 'unchanged';

    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(best.path, ts, hash);
    db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
    insertChange('asset', hash, 'trash_fs');
    return 'trash';
  }

  // Any file under managed root (but not in trashDir) means "sorted".
  if (inManagedNonTrash.length > 0) {
    const best = pickBestRow(inManagedNonTrash) || pickBestRow(rows);
    if (!best?.path) return 'unchanged';

    db.prepare(`UPDATE assets SET status = 'sorted', target_path = ?, missing = 0, updated_at = ? WHERE hash = ?`).run(best.path, ts, hash);
    insertChange('asset', hash, 'sorted_fs');

    const albumName = parseAlbumNameFromManagedPath(best.path, managedRoot, trashDir);
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

    return 'sorted';
  }

  // Outside managed/trash: default to inbox unless user explicitly ignored it.
  const current = db.prepare(`SELECT status FROM assets WHERE hash = ?`).get(hash);
  if (String(current?.status || '') === 'ignored') return 'ignored';

  db.prepare(`UPDATE assets SET status = 'inbox', target_path = NULL, missing = 0, updated_at = ? WHERE hash = ?`).run(ts, hash);
  db.prepare(`DELETE FROM album_assets WHERE hash = ?`).run(hash);
  insertChange('asset', hash, 'inbox_fs');
  return 'inbox';
}

async function handleEnrich(ctx) {
  const cfg = await ctx.loadConfig();
  const managedRoot = cfg.workspace?.managedRoot;
  const trashDir = cfg.workspace?.trashDir;
  if (!managedRoot || !trashDir) throw new Error('workspace.managedRoot and workspace.trashDir must be configured');

  const mode = String(ctx.job?.mode || 'missing');
  const concurrency = Math.max(1, Math.min(64, Number(cfg?.tasks?.concurrency?.enrich || 4)));
  const db = getDB();
  const reconciledHashes = new Set();
  const workspace = { managedRoot, trashDir };

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
	      OR hash IN (
	        SELECT hash FROM assets
	        WHERE time_scanned_at IS NULL OR COALESCE(time_metadata_version, 0) != ${TIME_METADATA_VERSION}
	      )
	      ${mode === 'all' ? 'OR 1 = 1' : ''}
	      ${mode === 'all' ? "OR COALESCE(hash_algo, 'md5') != 'sha256'" : ''}
	    )
	  `;

	  const rows = db.prepare(`
	    SELECT id, path, hash, hash_algo, scanned_at, mtime_ms, birthtime_ms, ext, mime_guess, hash_status, thumb_status, phash, phash_status,
	      (SELECT time_scanned_at FROM assets WHERE assets.hash = files.hash) AS asset_time_scanned_at,
	      (SELECT time_metadata_version FROM assets WHERE assets.hash = files.hash) AS asset_time_metadata_version
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
      try {
        await applyMissingPolicyForMissingFileRows(
          db,
          [{ id: fileId, hash }],
          {
            pathExists: fs.pathExists,
            ts: now,
            insertChange: (entity, entityId, type) => insertChange(entity, entityId, type),
          }
        );
      } catch {
        // ignore
      }
      return;
    }

    const unchanged = row.scanned_at && Number(stat.mtimeMs) <= Number(row.scanned_at || 0);
    const mimeType = mime.lookup(filePath) || row.mime_guess || null;
    const phashNeeded = !row.phash || String(row.phash_status || '') !== 'done';

    const needsHashUpgrade = mode === 'all' && String(row.hash_algo || 'md5') !== 'sha256';
    // Unchanged, hashed files do not need another content hash. Metadata has its own versioned refresh path.
    if (unchanged && row.hash && String(row.hash_status) === 'done' && !needsHashUpgrade) {
      const hash = String(row.hash);
      const needsMetadataRefresh = mode === 'all'
        || !row.asset_time_scanned_at
        || Number(row.asset_time_metadata_version || 0) !== TIME_METADATA_VERSION;
      if (needsMetadataRefresh) {
        try {
          const metadata = await readMetadata({ mimeType, filePath });
          updateExistingAssetMetadata(db, { hash, metadata, stat, mimeType, ts: now() });
          db.prepare('UPDATE files SET mtime_ms = ?, birthtime_ms = ?, updated_at = ? WHERE id = ?')
            .run(stat.mtimeMs, stat.birthtimeMs || null, now(), fileId);
          insertChange('asset', hash, 'metadata_refresh');
          stats.updated++;
        } catch (error) {
          stats.errors++;
          console.warn('[enrich] Metadata refresh failed:', { fileId, filePath, error: String(error?.message || error) });
        }
      }
      // thumb backfill
      try {
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
      if (shouldReconcileForPath(filePath, workspace)) {
        try {
          await reconcileAssetByFilesystem(db, hash, workspace);
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
	    const hashResult = await computeHash(filePath);
	    const hash = hashResult.hash;
	    const hashAlgo = hashResult.hash_algo;
	    const existingAsset = db.prepare('SELECT hash, status, hash_algo, time_locked FROM assets WHERE hash = ?').get(hash);
	    const status = existingAsset ? existingAsset.status : 'inbox';

      const metadata = await readMetadata({ mimeType, filePath });
      const cameraMake = metadata?.camera_make ? String(metadata.camera_make) : null;
      const cameraModel = metadata?.camera_model ? String(metadata.camera_model) : null;
      const isCamera = (cameraMake || cameraModel) ? 1 : 0;
      const ts = now();

      if (existingAsset) {
        db.prepare('UPDATE assets SET hash_algo = COALESCE(hash_algo, ?) WHERE hash = ?').run(hashAlgo, hash);
        updateExistingAssetMetadata(db, { hash, metadata, stat, mimeType, ts });
	      } else {
	        db.prepare(`
	          INSERT INTO assets (
	            hash, hash_algo, mime_type, size, metadata,
	            captured_at, captured_local_ms, time_zone, time_source, time_tag, time_confidence,
	            time_zone_inferred, time_locked, time_scanned_at, time_metadata_version,
	            status, missing, camera_make, camera_model, is_camera, updated_at
	          )
	          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?)
	        `).run(
	          hash,
	          hashAlgo,
	          mimeType,
          stat.size,
          safeJsonStringify(metadata || {}),
          metadata?.captured_at ?? null,
          metadata?.captured_local_ms ?? null,
          metadata?.time_zone ?? null,
          metadata?.time_source ?? null,
          metadata?.time_tag ?? null,
          metadata?.time_confidence ?? null,
          metadata?.time_zone_inferred ? 1 : 0,
          ts,
          TIME_METADATA_VERSION,
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
	            hash_algo = ?,
	            scanned_at = ?,
            size = ?,
            mtime_ms = ?,
            birthtime_ms = ?,
            missing = 0,
            updated_at = ?,
            hash_status = 'done'
	        WHERE id = ?
	      `).run(hash, hashAlgo, ts, stat.size, stat.mtimeMs, stat.birthtimeMs || null, ts, fileId);

      insertChange('file', fileId, 'upsert');
      insertChange('asset', hash, 'upsert');
      stats.updated++;

      // Filesystem-truth reconciliation (rebuild sorted/trash + album mapping).
      // - Always reconcile the first time we see a hash in this run (to fix stale DB).
      // - Always reconcile when scanning a file under managed root/trash (to rebuild from filesystem).
      if (!reconciledHashes.has(hash) || shouldReconcileForPath(filePath, workspace)) {
        try {
          await reconcileAssetByFilesystem(db, hash, workspace);
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

  // Auto-trigger subsequent tasks in the pipeline
  // enrich -> faces_scan, clip_enrich (thumbs are built during enrich)
  try {
    if (!ctx.isCancelRequested()) {
      ctx.enqueue('faces_scan', 'missing', {});
      ctx.enqueue('clip_enrich', 'missing', {});
    }
  } catch {
    // ignore
  }

  ctx.heartbeat({ phase: 'done', processed: stats.processed, errors: stats.errors });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = {
  TIME_METADATA_VERSION,
  handleEnrich,
  isUnder,
  reconcileAssetByFilesystem,
  updateExistingAssetMetadata,
};

