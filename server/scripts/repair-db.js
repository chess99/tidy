#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * input: 本地 DB 路径 + 文件系统（存在性检查）
 * output: DB 修复/报告（可能会删除/更新 rows）
 * pos: 运维脚本：DB 修复工具（变更需同步更新本头注释与所属目录 README）
 */
const path = require('path');
const fs = require('fs-extra');
const Database = require('better-sqlite3');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] || '';
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`
Usage:
  node server/scripts/repair-db.js --report
  node server/scripts/repair-db.js --report --db <path/to/tidy.db>
  node server/scripts/repair-db.js --dedupe-case [--prefer-prefix "Z:\\\\Photos"] [--db ...]
  node server/scripts/repair-db.js --normalize-path-case [--db ...]
  node server/scripts/repair-db.js --mark-missing [--db ...]
  node server/scripts/repair-db.js --delete-missing [--db ...]

What it does:
  - Finds duplicate rows that differ only by path case (group by lower(path)).
  - Optionally deletes extra DB rows (does NOT modify the filesystem).
  - On Windows, can canonicalize paths to lower-case across the DB (after dedupe-case).
  - Applies missing policy: delete missing files rows; keep or delete assets based on assets.status.
`);
}

function defaultDbPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', '..', 'tidy.db');
}

function normalizeLower(p) {
  return String(p || '').toLowerCase();
}

function chooseKeepPath(paths, preferPrefix) {
  if (!paths.length) return null;
  const pref = preferPrefix ? normalizeLower(preferPrefix) : null;
  if (pref) {
    const hit = paths.find((p) => normalizeLower(p).startsWith(pref));
    if (hit) return hit;
  }
  // Heuristic: prefer path containing "\Photos\" (common canonical casing)
  const photosHit = paths.find((p) => normalizeLower(p).includes('\\photos\\'));
  if (photosHit) return photosHit;
  // Otherwise keep the shortest then lexicographically
  return paths.slice().sort((a, b) => (a.length - b.length) || a.localeCompare(b))[0];
}

function ensureColumn(db, table, name, ddl) {
  try {
    const cols = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
    if (cols.has(name)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch {
    // ignore
  }
}

async function main() {
  if (hasFlag('--help') || process.argv.length <= 2) {
    usage();
    process.exit(0);
  }

  const dbPath = getArg('--db') || defaultDbPath();
  const doReport = hasFlag('--report');
  const doDedupeCase = hasFlag('--dedupe-case');
  const doNormalizePathCase = hasFlag('--normalize-path-case');
  const doMarkMissing = hasFlag('--mark-missing');
  const doDeleteMissing = hasFlag('--delete-missing');
  const preferPrefix = getArg('--prefer-prefix');

  if (!doReport && !doDedupeCase && !doNormalizePathCase && !doMarkMissing && !doDeleteMissing) {
    console.error('No action specified. Use --report / --dedupe-case / --normalize-path-case / --mark-missing / --delete-missing');
    usage();
    process.exit(1);
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}`);
    process.exit(1);
  }

  console.log(`Opening DB: ${dbPath}`);
  const db = new Database(dbPath);

  const dupGroups = db.prepare(`
    SELECT lower(path) AS key, COUNT(*) AS cnt
    FROM files
    GROUP BY lower(path)
    HAVING cnt > 1
    ORDER BY cnt DESC
  `).all();

  console.log(`Case-duplicate groups: ${dupGroups.length}`);

  let totalDupRows = 0;
  for (const g of dupGroups) totalDupRows += (g.cnt - 1);
  console.log(`Extra duplicate rows (would remove): ${totalDupRows}`);

  if (doReport) {
    for (const g of dupGroups.slice(0, 50)) {
      const rows = db.prepare('SELECT id, path, hash, size, mtime_ms FROM files WHERE lower(path) = ? ORDER BY id ASC').all(g.key);
      console.log(`\n[dup] ${g.key} (${rows.length})`);
      rows.forEach((r) => console.log(`  - id=${r.id} hash=${r.hash || '-'} path=${r.path}`));
    }
    if (dupGroups.length > 50) console.log(`\n... truncated (showing 50/${dupGroups.length})`);
  }

  if (doDedupeCase && dupGroups.length) {
    console.log(`\nApplying --dedupe-case (DB rows only; filesystem untouched)`);
    const tx = db.transaction((groups) => {
      for (const g of groups) {
        const rows = db.prepare('SELECT id, path FROM files WHERE lower(path) = ? ORDER BY id ASC').all(g.key);
        const keepPath = chooseKeepPath(rows.map((r) => r.path), preferPrefix);
        const keep = rows.find((r) => r.path === keepPath) || rows[0];
        const toDelete = rows.filter((r) => r.id !== keep.id);
        for (const r of toDelete) {
          db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
        }
      }
    });
    tx(dupGroups);
    console.log(`Done. Removed duplicates by case.`);
  }

  if (doNormalizePathCase) {
    if (process.platform !== 'win32') {
      console.error('--normalize-path-case is Windows-only (this tool keeps case-sensitive semantics on macOS/Linux).');
      process.exit(1);
    }

    // Ensure we don't trip UNIQUE(path) by first removing case-only duplicates.
    if (!doDedupeCase) {
      console.log(`\nApplying implicit --dedupe-case before --normalize-path-case...`);
      const tx = db.transaction((groups) => {
        for (const g of groups) {
          const rows = db.prepare('SELECT id, path FROM files WHERE lower(path) = ? ORDER BY id ASC').all(g.key);
          const keepPath = chooseKeepPath(rows.map((r) => r.path), preferPrefix);
          const keep = rows.find((r) => r.path === keepPath) || rows[0];
          const toDelete = rows.filter((r) => r.id !== keep.id);
          for (const r of toDelete) {
            db.prepare('DELETE FROM files WHERE id = ?').run(r.id);
          }
        }
      });
      tx(dupGroups);
      console.log(`Done. Removed duplicates by case.`);
    }

    console.log(`\nNormalizing path casing to lower-case across DB (Windows-only)`);
    const now = Date.now();
    const tx3 = db.transaction(() => {
      // files.path (also bump updated_at)
      db.exec(`
        UPDATE files
        SET path = lower(path),
            updated_at = COALESCE(updated_at, ${now})
        WHERE path IS NOT NULL AND path <> lower(path);
      `);

      // file_ops paths
      db.exec(`
        UPDATE file_ops
        SET from_path = CASE WHEN from_path IS NULL THEN NULL ELSE lower(from_path) END,
            to_path   = CASE WHEN to_path IS NULL THEN NULL ELSE lower(to_path) END,
            updated_at = COALESCE(updated_at, ${now})
        WHERE
          (from_path IS NOT NULL AND from_path <> lower(from_path))
          OR (to_path IS NOT NULL AND to_path <> lower(to_path));
      `);

      // assets.target_path
      db.exec(`
        UPDATE assets
        SET target_path = CASE WHEN target_path IS NULL THEN NULL ELSE lower(target_path) END,
            updated_at = COALESCE(updated_at, ${now})
        WHERE target_path IS NOT NULL AND target_path <> lower(target_path);
      `);
    });
    tx3();
    console.log(`Done. Normalized path casing.`);
  }

  if (doMarkMissing || doDeleteMissing) {
    console.log(`\nScanning for missing files on disk...`);
    // Ensure schema exists even when running this script standalone.
    ensureColumn(db, 'assets', 'missing', 'missing INTEGER DEFAULT 0');

    const rows = db.prepare('SELECT id, path, hash FROM files').all();
    let missingCount = 0;
    const missingRows = [];
    for (const r of rows) {
      if (!r.path) continue;
      // eslint-disable-next-line no-await-in-loop
      const exists = await fs.pathExists(r.path);
      if (!exists) {
        missingCount++;
        missingRows.push({ id: r.id, hash: r.hash ? String(r.hash) : null });
      }
    }
    console.log(`Missing rows: ${missingCount}`);

    if (missingRows.length) {
      const tx2 = db.transaction((rowsToDelete) => {
        const delFile = db.prepare('DELETE FROM files WHERE id = ?');
        const selectFilesByHash = db.prepare('SELECT id, path FROM files WHERE hash = ?');
        const delFilesByHash = db.prepare('DELETE FROM files WHERE hash = ?');

        const getAsset = db.prepare('SELECT status FROM assets WHERE hash = ?');
        const markAssetMissing = db.prepare('UPDATE assets SET missing = 1, updated_at = ? WHERE hash = ?');
        const clearAssetMissing = db.prepare('UPDATE assets SET missing = 0, updated_at = ? WHERE hash = ?');

        const delAlbumAssets = db.prepare('DELETE FROM album_assets WHERE hash = ?');
        const delAssetTags = db.prepare('DELETE FROM asset_tags WHERE hash = ?');
        const delFaces = db.prepare('DELETE FROM faces WHERE hash = ?');
        const clearClipHash = db.prepare('UPDATE clip_embeddings SET hash = NULL WHERE hash = ?');
        const delAsset = db.prepare('DELETE FROM assets WHERE hash = ?');

        const affectedHashes = new Set();

        // 1) Delete missing file rows by id.
        for (const r of rowsToDelete) {
          if (r?.id == null) continue;
          delFile.run(r.id);
          if (r.hash) affectedHashes.add(String(r.hash));
        }

        // 2) For each affected hash, decide whether asset should be kept (missing=1) or deleted.
        const now = Date.now();
        for (const hash of affectedHashes) {
          const files = selectFilesByHash.all(hash);
          const anyExists = files.some((f) => f?.path && fs.existsSync(String(f.path)));

          if (anyExists) {
            clearAssetMissing.run(now, hash);
            continue;
          }

          // No instances exist -> delete all remaining file rows for this hash to keep DB consistent.
          delFilesByHash.run(hash);

          const status = String(getAsset.get(hash)?.status || 'inbox');
          if (status !== 'inbox') {
            markAssetMissing.run(now, hash);
            continue;
          }

          // Ephemeral (inbox) assets are removed when they disappear.
          delAlbumAssets.run(hash);
          delAssetTags.run(hash);
          delFaces.run(hash);
          clearClipHash.run(hash);
          delAsset.run(hash);
        }
      });

      tx2(missingRows);
      console.log('Applied missing policy (deleted missing files rows; updated/deleted assets as needed).');
    }
  }

  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


