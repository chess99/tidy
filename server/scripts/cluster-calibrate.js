#!/usr/bin/env node
/**
 * Analyze Immich-style core-face eligibility across distance thresholds.
 * This is read-only and does not change people or face assignments.
 */
const { initDB, getDB } = require('../src/db');
const {
  DEFAULT_FACE_MAX_DISTANCE,
  DEFAULT_FACE_MIN_FACES,
  HnswFaceIndex,
  norm,
  parseDescriptor,
} = require('../src/services/faceClustering');

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

async function main() {
  initDB();
  const db = getDB();
  const from = Number(readArg('--from', '0.3'));
  const to = Number(readArg('--to', '0.7'));
  const step = Number(readArg('--step', '0.05'));
  const minFaces = Math.max(1, Math.trunc(Number(readArg('--minFaces', String(DEFAULT_FACE_MIN_FACES)))));

  const points = [];
  for (const row of db.prepare('SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL ORDER BY id').iterate()) {
    const descriptor = parseDescriptor(row.descriptor);
    if (!descriptor || !norm(descriptor)) continue;
    points.push({ id: Number(row.id), descriptor });
  }
  if (!points.length) throw new Error('No face descriptors found');

  const index = await HnswFaceIndex.create(points);
  const neighborDistances = points.map((point) => index.search(point.descriptor, minFaces).map((match) => match.distance));
  console.log(`[calibrate] faces=${points.length} minFaces=${minFaces} defaultMaxDistance=${DEFAULT_FACE_MAX_DISTANCE}`);
  console.log('distance coreFaces nonCoreFaces');
  for (let maxDistance = from; maxDistance <= to + 1e-9; maxDistance += step) {
    const coreFaces = neighborDistances.filter(
      (distances) => distances.filter((distance) => distance <= maxDistance).length >= minFaces
    ).length;
    console.log(`${maxDistance.toFixed(3)}    ${coreFaces}      ${points.length - coreFaces}`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
