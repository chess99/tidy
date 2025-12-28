/* eslint-disable no-console */
const path = require('path');
const Database = require('better-sqlite3');

const { RAW_EXTS } = require('../src/scanner/thumbnail');

function getDbPath() {
  // Mirror server/src/db/index.js default behavior (relative to server cwd)
  return process.env.DB_PATH || path.join(process.cwd(), 'tidy.db');
}

function main() {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });

  const rows = db
    .prepare(
      `
      SELECT LOWER(COALESCE(ext, '')) AS ext, COUNT(*) AS c
      FROM files
      GROUP BY LOWER(COALESCE(ext, ''))
      ORDER BY c DESC
    `
    )
    .all();

  const rawSet = new Set(Array.from(RAW_EXTS || []));
  const rawLikeRe =
    /\.(dng|cr2|cr3|crw|nef|arw|raf|rw2|rw1|orf|sr2|srw|nrw|pef|x3f|3fr|erf|fff|iiq|kdc|mef|mos|mrw|raw|rwl|r3d)$/i;

  const rawSeen = rows.filter((r) => rawSet.has(r.ext));
  const rawLikeSeen = rows.filter((r) => rawLikeRe.test(r.ext));
  const rawLikeNotCovered = rawLikeSeen.filter((r) => !rawSet.has(r.ext));
  const coveredButNotSeen = Array.from(rawSet).filter((e) => !rows.some((r) => r.ext === e));

  console.log(`DB: ${dbPath}`);
  console.log(`Distinct ext: ${rows.length}`);
  console.log('');

  console.log('RAW in whitelist seen (count):');
  if (!rawSeen.length) console.log('  (none)');
  for (const r of rawSeen) console.log(`  ${r.ext}\t${r.c}`);
  console.log('');

  console.log('RAW-like seen but NOT in whitelist:');
  if (!rawLikeNotCovered.length) console.log('  (none)');
  for (const r of rawLikeNotCovered) console.log(`  ${r.ext}\t${r.c}`);
  console.log('');

  console.log('Whitelist RAW not seen in DB:');
  if (!coveredButNotSeen.length) console.log('  (none)');
  for (const e of coveredButNotSeen) console.log(`  ${e}`);
}

main();


