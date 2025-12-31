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
const { computeHash } = require('../../scanner/hasher');
const { extractMetadata } = require('../../scanner/metadata');
const { extractVideoMetadata } = require('../../scanner/videoMetadata');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('../../scanner/thumbnail');
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

async function handleEnrich(ctx) {
  const cfg = await ctx.loadConfig();
  const mode = String(ctx.job?.mode || 'missing');
  const concurrency = Math.max(1, Math.min(64, Number(cfg?.tasks?.concurrency?.enrich || 4)));
  const db = getDB();

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
    missing = 0
    AND path IS NOT NULL
    AND (
      scanned_at IS NULL
      OR mtime_ms IS NULL
      OR scanned_at < mtime_ms
      OR hash IS NULL
      OR COALESCE(hash_status, 'pending') != 'done'
      OR COALESCE(thumb_status, 'pending') != 'ready'
    )
  `;

  const rows = db.prepare(`
    SELECT id, path, hash, scanned_at, mtime_ms, ext, mime_guess, hash_status, thumb_status
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
      try {
        db.prepare('UPDATE files SET missing = 1, updated_at = ? WHERE id = ?').run(now(), fileId);
        insertChange('file', fileId, 'missing');
      } catch {
        // ignore
      }
      return;
    }

    const unchanged = row.scanned_at && Number(stat.mtimeMs) <= Number(row.scanned_at || 0);
    const mimeType = mime.lookup(filePath) || row.mime_guess || null;

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
          INSERT INTO assets (hash, mime_type, size, metadata, taken_at, status, camera_make, camera_model, is_camera, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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


