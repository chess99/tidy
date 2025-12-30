const express = require('express');
const scanner = require('../scanner');
const { loadConfig, getEnabledRoots, validateRootOrThrow } = require('../configStore');
const { getDB } = require('../db');
const fs = require('fs-extra');
const path = require('path');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('../scanner/thumbnail');
const router = express.Router();

router.post('/', async (req, res) => {
  // Demo optimal design:
  // - default: scan all enabled roots sequentially
  // - optional: request body `{ root }` to scan a single directory ad-hoc
  let roots = [];
  try {
    const reqRoot = req.body?.root;
    if (reqRoot) {
      roots = [validateRootOrThrow(reqRoot)];
    } else {
      const cfg = await loadConfig();
      roots = getEnabledRoots(cfg);
    }
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Error' });
  }

  if (!roots.length) {
    return res.status(400).json({ error: 'No enabled scan roots. Add a scan root and enable it first.' });
  }

  if (scanner.isScanning) {
    return res.status(409).json({ error: 'Scan already in progress' });
  }

  // Track queue progress on the scanner instance (best-effort, in-memory).
  scanner.currentRoot = null;
  scanner.queueTotal = roots.length;
  scanner.queueDone = 0;

  // Run in background (sequential, to avoid thrashing IO/CPU and simplify progress UI).
  (async () => {
    for (let i = 0; i < roots.length; i++) {
      const r = roots[i];
      scanner.currentRoot = r;
      // eslint-disable-next-line no-await-in-loop
      await scanner.scanDirectory(r);
      scanner.queueDone = i + 1;
    }
  })().catch((err) => {
    console.error(err);
  }).finally(() => {
    scanner.currentRoot = null;
  });

  res.json({ message: 'Scan started', roots });
});

router.get('/status', (req, res) => {
  res.json({
    isScanning: scanner.isScanning,
    stats: scanner.stats,
    currentRoot: scanner.currentRoot || null,
    queueTotal: Number.isFinite(scanner.queueTotal) ? scanner.queueTotal : null,
    queueDone: Number.isFinite(scanner.queueDone) ? scanner.queueDone : null,
    thumbRebuild: scanner.thumbRebuild || null,
  });
});

function tryInsertChange(db, entity, entityId, type) {
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

async function chooseFileForHash(db, hash) {
  // Pick a stable and existing file for this hash.
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

// Rebuild all thumbnails (best-effort, background)
router.post('/thumbs/rebuild', async (req, res) => {
  if (scanner.isScanning) return res.status(409).json({ error: 'Scan already in progress' });
  if (scanner.thumbRebuild?.isRunning) return res.status(409).json({ error: 'Thumb rebuild already in progress' });

  const db = getDB();
  const mode = String(req.body?.mode || 'all'); // all | missing

  const hashes = db
    .prepare(`SELECT DISTINCT hash FROM files WHERE hash IS NOT NULL`)
    .all()
    .map((r) => String(r.hash))
    .filter(Boolean);

  scanner.thumbRebuild = {
    isRunning: true,
    mode,
    total: hashes.length,
    done: 0,
    ok: 0,
    skipped: 0,
    errors: 0,
    startedAt: Date.now(),
    finishedAt: null,
    lastError: null,
  };

  (async () => {
    for (const hash of hashes) {
      scanner.thumbRebuild.done++;
      try {
        const thumbPath = getThumbnailPath(hash);
        if (mode === 'missing' && await fs.pathExists(thumbPath)) {
          scanner.thumbRebuild.skipped++;
          continue;
        }

        const f = await chooseFileForHash(db, hash);
        if (!f?.path || !(await fs.pathExists(f.path))) {
          scanner.thumbRebuild.skipped++;
          continue;
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
          scanner.thumbRebuild.skipped++;
          continue;
        }

        const created = await generateThumbnail(f.path, hash, { ext: extLower, force: true });
        if (created) {
          const now = Date.now();
          try {
            db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(now, hash);
            db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE hash = ?').run('ready', now, hash);
          } catch {
            // ignore
          }
          tryInsertChange(db, 'asset', hash, 'thumb_ready');
          scanner.thumbRebuild.ok++;
        } else {
          scanner.thumbRebuild.errors++;
        }
      } catch (e) {
        scanner.thumbRebuild.errors++;
        scanner.thumbRebuild.lastError = String(e?.message || e);
      }
    }
  })().catch((e) => {
    scanner.thumbRebuild.errors++;
    scanner.thumbRebuild.lastError = String(e?.message || e);
  }).finally(() => {
    try {
      scanner.thumbRebuild.isRunning = false;
      scanner.thumbRebuild.finishedAt = Date.now();
    } catch {
      // ignore
    }
  });

  res.json({ message: 'Thumb rebuild started', total: hashes.length, mode });
});

// New endpoint to open system dialog (simulated for now as browser can't trigger system dialog directly via backend easily without native modules like electron or specialized calls, but we can accept input)
// Actually, standard web apps can't trigger server-side file pickers easily. 
// We will skip implementing a native OS picker for now unless we use Electron.
// But we can implement a simple directory auto-complete or listing later.

module.exports = router;
