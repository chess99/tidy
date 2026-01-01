/**
 * input: job payload + DB/文件系统 + ai-service(CLIP) + clip_embeddings 表
 * output: 为图片资产补算 CLIP embedding，并落库到 clip_embeddings
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const { getDB } = require('../../db');
const { CLIP_MODEL_ID } = require('../../config');
const { now } = require('./_util');
const { clipImageEmbed } = require('../../services/aiClient');
const { packF32 } = require('../../services/clipIndex');

async function handleClipEnrich(ctx) {
  const db = getDB();
  const mode = String(ctx.job?.mode || 'missing'); // missing | all
  const model = CLIP_MODEL_ID;

  // Pick one representative file per asset (stable) to avoid storing duplicate embeddings for duplicates.
  const where =
    mode === 'all'
      ? `
        a.status NOT IN ('trash', 'ignored')
        AND a.mime_type LIKE 'image/%'
      `
      : `
        a.status NOT IN ('trash', 'ignored')
        AND a.mime_type LIKE 'image/%'
        AND NOT EXISTS (
          SELECT 1
          FROM clip_embeddings ce
          WHERE ce.hash = a.hash
            AND ce.model = ?
        )
      `;

  const assets = db
    .prepare(
      `
      SELECT a.hash, (
        SELECT f.id
        FROM files f
        WHERE f.hash = a.hash AND f.missing = 0
        ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
        LIMIT 1
      ) AS file_id, (
        SELECT f.path
        FROM files f
        WHERE f.hash = a.hash AND f.missing = 0
        ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
        LIMIT 1
      ) AS path
      FROM assets a
      WHERE ${where}
      ORDER BY a.taken_at DESC, a.hash ASC
      LIMIT 200000
      `
    )
    .all(...(mode === 'all' ? [] : [model]));

  const stats = {
    mode,
    model,
    total: assets.length,
    done: 0,
    embedded: 0,
    skipped: 0,
    errors: 0,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'clip_pick', total: stats.total, done: 0 });

  const upsert = db.prepare(`
    INSERT INTO clip_embeddings (file_id, hash, model, dim, normalized, embedding, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_id) DO UPDATE SET
      hash=excluded.hash,
      model=excluded.model,
      dim=excluded.dim,
      normalized=excluded.normalized,
      embedding=excluded.embedding,
      updated_at=excluded.updated_at
  `);

  for (const it of assets) {
    if (ctx.isCancelRequested()) break;
    stats.done++;

    const hash = it?.hash ? String(it.hash) : null;
    const fileId = Number(it?.file_id);
    const filePath = it?.path ? String(it.path) : null;
    if (!hash || !Number.isFinite(fileId) || !filePath) {
      stats.skipped++;
      continue;
    }

    try {
      if (!(await fs.pathExists(filePath))) {
        stats.skipped++;
        continue;
      }

      // Ensure we don't recompute if already present (race-safe).
      const exists = db.prepare('SELECT 1 AS ok FROM clip_embeddings WHERE file_id = ? AND model = ? LIMIT 1').get(fileId, model);
      if (exists) {
        stats.skipped++;
        continue;
      }

      const r = await clipImageEmbed({ imagePath: filePath, normalize: true });
      const emb = Array.isArray(r.embedding) ? r.embedding.map(Number) : [];
      const dim = emb.length;
      if (!dim) throw new Error('empty embedding');

      upsert.run(fileId, hash, String(r.model || model), dim, r.normalized ? 1 : 0, packF32(emb), now());
      stats.embedded++;
    } catch {
      stats.errors++;
    }

    if (stats.done % 10 === 0) {
      ctx.heartbeat({ phase: 'clip', done: stats.done, embedded: stats.embedded, skipped: stats.skipped, errors: stats.errors });
    }
  }

  ctx.heartbeat({ phase: 'clip_done', done: stats.done, embedded: stats.embedded, errors: stats.errors });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleClipEnrich };


