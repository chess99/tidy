const fs = require('fs-extra');
const { getDB } = require('../../db');
const { loadModels, processImageFaces } = require('../../scanner/face');
const { now } = require('./_util');

async function handleFacesScan(ctx) {
  const db = getDB();
  const mode = String(ctx.job?.mode || 'missing');

  await loadModels();

  // Select assets to scan
  // - missing: face_scanned_at IS NULL
  // - all: face_scanned_at IS NULL OR no faces rows exist (best-effort, no overwrite)
  const where =
    mode === 'all'
      ? `
        a.mime_type LIKE 'image/%'
        AND a.status NOT IN ('trash', 'ignored')
        AND (
          a.face_scanned_at IS NULL
          OR NOT EXISTS (SELECT 1 FROM faces f WHERE f.hash = a.hash)
        )
      `
      : `
        a.mime_type LIKE 'image/%'
        AND a.status NOT IN ('trash', 'ignored')
        AND a.face_scanned_at IS NULL
      `;

  const assets = db.prepare(`
    SELECT a.hash, (
      SELECT f.path
      FROM files f
      WHERE f.hash = a.hash
      ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
      LIMIT 1
    ) AS path
    FROM assets a
    WHERE ${where}
    ORDER BY a.taken_at DESC, a.hash ASC
  `).all();

  const stats = {
    mode,
    total: assets.length,
    done: 0,
    scanned: 0,
    skipped: 0,
    errors: 0,
    startedAt: now(),
  };

  ctx.heartbeat({ phase: 'faces', total: stats.total, done: 0 });

  for (const { hash, path: filePath } of assets) {
    if (ctx.isCancelRequested()) break;
    stats.done++;
    try {
      if (!filePath || !(await fs.pathExists(filePath))) {
        stats.skipped++;
        continue;
      }
      // For safety (avoid duplicating/overwriting user assignments), do not rescan hashes that already have faces.
      const hasFaces = db.prepare('SELECT 1 AS ok FROM faces WHERE hash = ? LIMIT 1').get(hash);
      if (hasFaces) {
        stats.skipped++;
        db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(now(), hash);
        continue;
      }

      await processImageFaces(filePath, hash);
      db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(now(), hash);
      stats.scanned++;
    } catch (e) {
      stats.errors++;
      try {
        db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(now(), hash);
      } catch {
        // ignore
      }
    }

    if (stats.done % 10 === 0) {
      ctx.heartbeat({ phase: 'faces', done: stats.done, scanned: stats.scanned, skipped: stats.skipped, errors: stats.errors });
    }
  }

  ctx.heartbeat({ phase: 'faces_done', done: stats.done, scanned: stats.scanned, errors: stats.errors });
  return { ok: true, ...stats, finishedAt: now() };
}

module.exports = { handleFacesScan };


