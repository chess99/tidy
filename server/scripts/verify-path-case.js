/* eslint-disable no-console */
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const Database = require('better-sqlite3');

const schema = require('../src/db/schema');
const { normalizePathForDb } = require('../src/utils/normalizePath');

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message || err)));
      resolve(String(stdout || ''));
    });
  });
}

async function main() {
  if (process.platform !== 'win32') {
    console.log('Skipping: verify-path-case is Windows-only.');
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-case-'));
  const dbPath = path.join(tmpDir, 'case-test.db');
  console.log(`Temp DB: ${dbPath}`);

  // Create schema
  const db = new Database(dbPath);
  db.exec(schema);

  // Seed two rows that differ only by case (allowed by UNIQUE(path) because strings differ)
  const p1 = 'Z:\\Photos\\A\\IMG_0001.JPG';
  const p2 = 'Z:\\photos\\a\\img_0001.jpg';
  db.prepare(`
    INSERT INTO files (path, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash_status, thumb_status)
    VALUES (?, 0, 1, 1, '.jpg', 'image/jpeg', 1, 1, 'done', 'unsupported')
  `).run(p1);
  db.prepare(`
    INSERT INTO files (path, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash_status, thumb_status)
    VALUES (?, 0, 1, 1, '.jpg', 'image/jpeg', 1, 1, 'done', 'unsupported')
  `).run(p2);
  db.close();

  // Sanity: normalization function lowers on Windows
  const n = normalizePathForDb(p1);
  if (n !== path.resolve(p1).toLowerCase()) {
    throw new Error(`normalizePathForDb mismatch: got=${n} expected=${path.resolve(p1).toLowerCase()}`);
  }

  // Run repair script to dedupe+normalize
  const nodeExe = process.execPath;
  const repair = path.join(__dirname, 'repair-db.js');

  await execFileAsync(nodeExe, [repair, '--report', '--db', dbPath], { cwd: path.join(__dirname, '..', '..') });
  await execFileAsync(nodeExe, [repair, '--normalize-path-case', '--db', dbPath], { cwd: path.join(__dirname, '..', '..') });

  // Verify: only one row remains and is lowercase
  const db2 = new Database(dbPath, { readonly: true });
  const rows = db2.prepare('SELECT id, path FROM files ORDER BY id ASC').all();
  db2.close();

  if (rows.length !== 1) {
    throw new Error(`Expected 1 row after normalize, got ${rows.length}`);
  }
  const onlyPath = String(rows[0].path || '');
  if (onlyPath !== onlyPath.toLowerCase()) {
    throw new Error(`Expected lowercase path, got: ${onlyPath}`);
  }

  console.log('OK: path case dedupe + normalize works on Windows.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


