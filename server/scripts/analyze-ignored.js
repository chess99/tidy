#!/usr/bin/env node
/**
 * Analyze directory file composition and what would be counted as "ignored"
 * by the Scanner logic (mime-types lookup + `image/*` check).
 *
 * Usage:
 *   node server/scripts/analyze-ignored.js "Z:\\Photos"
 *   node server/scripts/analyze-ignored.js "Z:\\Photos" --json out.json
 */
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function topN(map, n = 30) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function walk(root, onFile) {
  let items;
  try {
    items = await fs.readdir(root);
  } catch {
    return;
  }
  for (const item of items) {
    // keep consistent with Scanner: skip dot-directories
    if (item.startsWith('.')) continue;
    const fullPath = path.join(root, item);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      await walk(fullPath, onFile);
    } else if (stat.isFile()) {
      await onFile(fullPath, stat);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dir = args[0] || 'Z:\\Photos';
  const jsonIdx = args.indexOf('--json');
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

  const stats = {
    dir,
    totalFiles: 0,
    imageFiles: 0,
    ignoredFiles: 0,
    unknownMime: 0,
    byExt: new Map(),
    byMime: new Map(),
    ignoredByExt: new Map(),
    ignoredByMime: new Map(),
  };

  console.log(`Analyzing: ${dir}`);

  await walk(dir, async (filePath) => {
    stats.totalFiles++;

    const ext = (path.extname(filePath) || '').toLowerCase() || '(no-ext)';
    inc(stats.byExt, ext);

    const m = mime.lookup(filePath) || null;
    inc(stats.byMime, m || '(unknown)');
    if (!m) stats.unknownMime++;

    const isImage = !!m && m.startsWith('image/');
    if (isImage) {
      stats.imageFiles++;
      return;
    }

    // Scanner ignored definition
    stats.ignoredFiles++;
    inc(stats.ignoredByExt, ext);
    inc(stats.ignoredByMime, m || '(unknown)');
  });

  const report = {
    dir: stats.dir,
    totalFiles: stats.totalFiles,
    imageFiles: stats.imageFiles,
    ignoredFiles: stats.ignoredFiles,
    unknownMime: stats.unknownMime,
    topExt: topN(stats.byExt, 30),
    topMime: topN(stats.byMime, 30),
    ignoredTopExt: topN(stats.ignoredByExt, 50),
    ignoredTopMime: topN(stats.ignoredByMime, 50),
  };

  console.log('');
  console.log('=== Summary ===');
  console.log(report);
  console.log('');
  console.log('=== Ignored Top Extensions ===');
  for (const [k, v] of report.ignoredTopExt) console.log(`${String(v).padStart(8)}  ${k}`);
  console.log('');
  console.log('=== Ignored Top MIME ===');
  for (const [k, v] of report.ignoredTopMime) console.log(`${String(v).padStart(8)}  ${k}`);

  if (jsonOut) {
    const out = {
      ...report,
      // keep arrays only (json friendly)
    };
    await fs.outputJson(jsonOut, out, { spaces: 2 });
    console.log('');
    console.log(`Wrote JSON report to: ${jsonOut}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});


