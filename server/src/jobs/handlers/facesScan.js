/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const fastq = require('fastq');
const { getDB } = require('../../db');
const { processImageFaces } = require('../../scanner/face');
const { getAiCapabilities } = require('../../services/aiCapabilities');
const { now } = require('./_util');

async function handleFacesScan(ctx) {
  const mode = String(ctx.job?.mode || 'missing');
  if (ctx.isCancelRequested()) {
    const startedAt = now();
    return {
      ok: true,
      mode,
      concurrency: 1,
      total: 0,
      done: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
      lastError: null,
      startedAt,
      finishedAt: now(),
    };
  }

  const cfg = await ctx.loadConfig();
  const concurrency = Math.max(1, Math.min(16, Number(cfg?.tasks?.concurrency?.faces || 1)));

  const capabilities = await getAiCapabilities();
  if (capabilities?.faces?.available !== true) {
    const message = capabilities?.faces?.message || 'Face recognition is unavailable';
    const startedAt = now();
    const result = {
      ok: false,
      blocked: true,
      blockedReason: 'faces_unavailable',
      capabilityCode: capabilities?.faces?.code || 'faces_unavailable',
      message,
      mode,
      concurrency,
      total: 0,
      done: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
      lastError: message,
      startedAt,
      finishedAt: now(),
    };
    ctx.heartbeat({ phase: 'faces_blocked', ...result });
    return result;
  }

  const db = getDB();

  // Select assets to scan
  // - missing: face_scanned_at IS NULL
  // - all: face_scanned_at IS NULL OR no faces rows exist (best-effort, no overwrite)
  const where =
    mode === 'all'
      ? `
        a.mime_type LIKE 'image/%'
        AND a.status NOT IN ('trash', 'ignored')
        AND EXISTS (
          SELECT 1 FROM files ff
          WHERE ff.hash = a.hash AND ff.missing = 0 AND ff.path IS NOT NULL
          LIMIT 1
        )
        AND (
          a.face_scanned_at IS NULL
          OR NOT EXISTS (SELECT 1 FROM faces f WHERE f.hash = a.hash)
        )
      `
      : `
        a.mime_type LIKE 'image/%'
        AND a.status NOT IN ('trash', 'ignored')
        AND EXISTS (
          SELECT 1 FROM files ff
          WHERE ff.hash = a.hash AND ff.missing = 0 AND ff.path IS NOT NULL
          LIMIT 1
        )
        AND a.face_scanned_at IS NULL
      `;

  const assets = db.prepare(`
    SELECT a.hash, (
      SELECT f.path
      FROM files f
      WHERE f.hash = a.hash AND f.missing = 0 AND f.path IS NOT NULL
      ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
      LIMIT 1
    ) AS path
    FROM assets a
    WHERE ${where}
    ORDER BY a.taken_at DESC, a.hash ASC
  `).all();

  const stats = {
    mode,
    concurrency,
    total: assets.length,
    done: 0,
    scanned: 0,
    skipped: 0,
    errors: 0,
    lastError: null,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'faces', total: stats.total, done: 0 });

  const worker = async ({ hash, path: filePath }) => {
    if (ctx.isCancelRequested()) return;
    stats.done++;
    try {
      if (!filePath || !(await fs.pathExists(filePath))) {
        stats.skipped++;
        return;
      }
      // For safety (avoid duplicating/overwriting user assignments), do not rescan hashes that already have faces.
      const hasFaces = db.prepare('SELECT 1 AS ok FROM faces WHERE hash = ? LIMIT 1').get(hash);
      if (hasFaces) {
        stats.skipped++;
        db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(now(), hash);
        return;
      }

      await processImageFaces(filePath, hash);
      db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(now(), hash);
      stats.scanned++;
    } catch (e) {
      stats.errors++;
      stats.lastError = String(e?.message || e || 'face_scan_failed');
    }

    if (stats.done % 10 === 0) {
      ctx.heartbeat({ phase: 'faces', done: stats.done, scanned: stats.scanned, skipped: stats.skipped, errors: stats.errors, lastError: stats.lastError });
    }
  };

  const q = fastq.promise(worker, concurrency);
  for (const it of assets) {
    if (ctx.isCancelRequested()) break;
    q.push(it);
  }
  await q.drained();

  // Auto-trigger face reclustering after scan completes
  try {
    if (!ctx.isCancelRequested() && stats.scanned > 0) {
      ctx.enqueue('faces_recluster', 'all', {});
    }
  } catch {
    // ignore
  }

  ctx.heartbeat({ phase: 'faces_done', done: stats.done, scanned: stats.scanned, errors: stats.errors, lastError: stats.lastError });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleFacesScan };

