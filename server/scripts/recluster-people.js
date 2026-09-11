#!/usr/bin/env node
/**
 * Incrementally assign ungrouped faces using Immich-compatible semantics.
 *
 * Usage:
 *   node scripts/recluster-people.js --maxDistance 0.5 --minFaces 3
 */
const { initDB, getDB } = require('../src/db');
const { DEFAULT_FACE_MAX_DISTANCE, DEFAULT_FACE_MIN_FACES } = require('../src/services/faceClustering');
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

  const maxDistance = Number(readArg('--maxDistance', String(DEFAULT_FACE_MAX_DISTANCE)));
  const minFaces = Number(readArg('--minFaces', String(DEFAULT_FACE_MIN_FACES)));

  const res = await reclusterPeople(db, { maxDistance, minFaces });
  console.log('[recluster]', res);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

