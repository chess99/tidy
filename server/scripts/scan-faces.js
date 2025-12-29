#!/usr/bin/env node
/**
 * Trigger face scan.
 *
 * Default: scan only images where assets.face_scanned_at IS NULL
 * Flags:
 *   --all    rescan ALL image assets (and delete existing faces per-asset before scanning)
 */
const fs = require('fs-extra');
const { initDB, getDB } = require('../src/db');
const scanner = require('../src/scanner');
const { processImageFaces, loadModels } = require('../src/scanner/face');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function scanAllImages() {
  initDB();
  const db = getDB();
  await loadModels();

  const rows = db.prepare(`
    SELECT a.hash, MIN(f.path) AS path
    FROM assets a
    JOIN files f ON a.hash = f.hash
    WHERE COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
      AND a.status NOT IN ('trash','ignored')
    GROUP BY a.hash
  `).all();

  console.log(`[faces] --all: images=${rows.length}`);

  let ok = 0;
  let err = 0;
  let facesInserted = 0;
  for (const r of rows) {
    try {
      // ensure re-scan is clean for this asset
      db.prepare('DELETE FROM faces WHERE hash = ?').run(r.hash);
      if (r.path && (await fs.pathExists(r.path))) {
        // eslint-disable-next-line no-await-in-loop
        const inserted = await processImageFaces(r.path, r.hash);
        facesInserted += Number(inserted) || 0;
      }
      db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(Date.now(), r.hash);
      ok++;
      if (ok % 20 === 0) console.log(`[faces] scanned ${ok}/${rows.length}`);
    } catch (e) {
      err++;
      console.error('[faces] scan error:', r.hash, r.path, e?.message || e);
    }
  }

  const faceRows = db.prepare('SELECT COUNT(*) AS c FROM faces').get().c;
  const peopleRows = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const distinctPeople = db.prepare('SELECT COUNT(DISTINCT person_id) AS c FROM faces WHERE person_id IS NOT NULL').get().c;
  const unknownFaces = db.prepare('SELECT COUNT(*) AS c FROM faces WHERE person_id IS NULL').get().c;

  console.log(`[faces] done: ok=${ok}, err=${err}, facesInserted=${facesInserted}`);
  console.log(`[faces] db: faces=${faceRows}, people=${peopleRows}, clustered_people=${distinctPeople}, unknown_faces=${unknownFaces}`);
}

async function main() {
  const all = hasFlag('--all');
  if (all) return await scanAllImages();

  // Default path: use the built-in scanner scanFaces() which respects face_scanned_at IS NULL
  initDB();
  await scanner.scanFaces();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


