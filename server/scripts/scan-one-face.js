#!/usr/bin/env node
/**
 * Run face detection for a single image path and (optionally) insert into DB.
 *
 * Usage:
 *   node scripts/scan-one-face.js /abs/path/to/image.jpg
 *
 * Flags:
 *   --no-db   Only run detection (no DB writes)
 *   --reset  Delete existing faces for this hash before inserting
 */
const fs = require('fs-extra');
const mime = require('mime-types');
const path = require('path');
const { initDB, getDB } = require('../src/db');
const { computeHash } = require('../src/scanner/hasher');
const { extractMetadata } = require('../src/scanner/metadata');
const { detectFaces, processImageFaces } = require('../src/scanner/face');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  const imgPath = process.argv.find((a) => a && !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
  if (!imgPath) {
    console.error('Usage: node scripts/scan-one-face.js /abs/path/to/image.jpg [--no-db] [--reset]');
    process.exitCode = 1;
    return;
  }

  const abs = path.resolve(imgPath);
  if (!(await fs.pathExists(abs))) {
    console.error('File not found:', abs);
    process.exitCode = 1;
    return;
  }

  const stat = await fs.stat(abs);
  const mimeType = mime.lookup(abs) || 'image/jpeg';

  console.log('[one] file=', abs);
  console.log('[one] mime=', mimeType, 'size=', stat.size);

  if (hasFlag('--no-db')) {
    const dets = await detectFaces(abs);
    console.log('[one] faces=', dets.length);
    for (let i = 0; i < dets.length; i++) {
      const b = dets[i].detection?.box;
      const s = dets[i].detection?.score;
      console.log(`[one] #${i + 1}: score=${s} box=${JSON.stringify(b)}`);
    }
    return;
  }

  initDB();
  const db = getDB();

  const hashResult = await computeHash(abs);
  const hash = hashResult.hash;
  const hashAlgo = hashResult.hash_algo;
  console.log('[one] hash=', hash, 'algo=', hashAlgo);

  if (hasFlag('--reset')) {
    db.prepare('DELETE FROM faces WHERE hash = ?').run(hash);
    db.prepare('UPDATE assets SET face_scanned_at = NULL WHERE hash = ?').run(hash);
  }

  // Upsert asset row (minimal fields)
  const meta = await extractMetadata(abs);
  const now = Date.now();
  const existsAsset = db.prepare('SELECT hash FROM assets WHERE hash = ?').get(hash);
  if (!existsAsset) {
    db.prepare(`
      INSERT INTO assets (hash, hash_algo, mime_type, size, metadata, taken_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'inbox', ?)
    `).run(
      hash,
      hashAlgo,
      mimeType,
      stat.size,
      JSON.stringify(meta || {}),
      meta?.taken_at || stat.mtimeMs,
      now
    );
  }

  // Upsert a file row pointing to this physical path
  const existsFile = db.prepare('SELECT id FROM files WHERE path = ?').get(abs);
  if (!existsFile) {
    db.prepare(`
      INSERT INTO files (path, hash, hash_algo, scanned_at, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash_status, thumb_status)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'done', 'pending')
    `).run(
      abs,
      hash,
      hashAlgo,
      now,
      stat.size,
      stat.mtimeMs,
      path.extname(abs).toLowerCase() || null,
      mimeType,
      now,
      now
    );
  } else {
    db.prepare('UPDATE files SET hash = ?, hash_algo = ?, missing = 0, updated_at = ? WHERE path = ?').run(hash, hashAlgo, now, abs);
  }

  const inserted = await processImageFaces(abs, hash);
  db.prepare('UPDATE assets SET face_scanned_at = ? WHERE hash = ?').run(Date.now(), hash);

  const totalFaces = db.prepare('SELECT COUNT(*) AS c FROM faces WHERE hash = ?').get(hash).c;
  console.log('[one] inserted=', inserted, 'faces_in_db=', totalFaces);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

