/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const { getDB } = require('../../db');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('../../scanner/thumbnail');
const { insertChange, now } = require('./_util');

async function chooseFileForHash(db, hash) {
  const rows = db
    .prepare(
      `SELECT path, ext, mime_guess
       FROM files
       WHERE hash = ?
       ORDER BY COALESCE(updated_at, 0) DESC, id DESC
       LIMIT 30`
    )
    .all(hash);

  for (const r of rows) {
    if (r?.path && await fs.pathExists(r.path)) return r;
  }
  return rows?.[0] || null;
}

async function handleThumbsRebuild(ctx) {
  const mode = String(ctx.job?.mode || 'missing');
  const db = getDB();
  const cfg = await ctx.loadConfig();
  const concurrency = Math.max(1, Math.min(16, Number(cfg?.tasks?.concurrency?.thumbs || 1)));

  const hashes = db
    .prepare(`SELECT DISTINCT hash FROM files WHERE hash IS NOT NULL`)
    .all()
    .map((r) => String(r.hash))
    .filter(Boolean);

  const stats = {
    mode,
    concurrency,
    total: hashes.length,
    done: 0,
    ok: 0,
    skipped: 0,
    errors: 0,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'thumbs', total: stats.total, done: 0 });

  const worker = async (hash) => {
    if (ctx.isCancelRequested()) return;
    stats.done++;
    try {
      const thumbPath = getThumbnailPath(hash);
      if (mode === 'missing' && await fs.pathExists(thumbPath)) {
        stats.skipped++;
        return;
      }

      const f = await chooseFileForHash(db, hash);
      if (!f?.path || !(await fs.pathExists(f.path))) {
        stats.skipped++;
        return;
      }

      // Force rebuild: remove old thumb then regenerate.
      try {
        await fs.remove(thumbPath);
      } catch {
        // ignore
      }

      const extLower = String(f.ext || path.extname(f.path) || '').toLowerCase();
      const shouldTryThumb =
        (f.mime_guess && String(f.mime_guess).startsWith('image/')) ||
        RAW_EXTS.has(extLower);

      if (!shouldTryThumb) {
        stats.skipped++;
        return;
      }

      const created = await generateThumbnail(f.path, hash, { ext: extLower, force: true });
      if (created) {
        const ts = now();
        try {
          db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(ts, hash);
          db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE hash = ?').run('ready', ts, hash);
        } catch {
          // ignore
        }
        insertChange('asset', hash, 'thumb_ready');
        stats.ok++;
      } else {
        stats.errors++;
      }
    } catch (e) {
      stats.errors++;
      ctx.heartbeat({ lastError: String(e?.message || e) });
    }

    if (stats.done % 50 === 0) {
      ctx.heartbeat({ phase: 'thumbs', done: stats.done, ok: stats.ok, skipped: stats.skipped, errors: stats.errors });
    }
  };

  const q = fastq.promise(worker, concurrency);
  for (const hash of hashes) {
    if (ctx.isCancelRequested()) break;
    q.push(hash);
  }
  await q.drained();

  ctx.heartbeat({ phase: 'thumbs_done', done: stats.done, ok: stats.ok, errors: stats.errors });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleThumbsRebuild };


