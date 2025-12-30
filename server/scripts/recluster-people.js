#!/usr/bin/env node
/**
 * Recluster all faces into people using DBSCAN (cosine distance).
 *
 * Usage:
 *   node scripts/recluster-people.js --eps 0.4 --minSamples 2
 */
const { initDB, getDB } = require('../src/db');
const { reclusterPeople } = require('../src/services/reclusterPeople');

function readArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  return v == null ? fallback : v;
}

async function main() {
  initDB();
  const db = getDB();

  const eps = Number(readArg('--eps', '0.04'));
  const minSamples = Number(readArg('--minSamples', '2'));

  const res = reclusterPeople(db, { eps, minSamples });
  console.log('[recluster]', res);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


