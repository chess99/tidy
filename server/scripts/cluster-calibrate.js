#!/usr/bin/env node
/**
 * Scan clustering eps values and print cluster stats.
 *
 * Usage:
 *   node scripts/cluster-calibrate.js --from 0.25 --to 0.55 --step 0.02 --minSamples 2
 */
const { initDB, getDB } = require('../src/db');
const { dbscan, parseDescriptor, norm } = require('../src/services/faceClustering');

function readArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  return v == null ? fallback : v;
}

function fmt(n) {
  return String(Math.round(n * 1000) / 1000).padEnd(6, ' ');
}

async function main() {
  initDB();
  const db = getDB();

  const from = Number(readArg('--from', '0.25'));
  const to = Number(readArg('--to', '0.55'));
  const step = Number(readArg('--step', '0.02'));
  const minSamples = Number(readArg('--minSamples', '2'));

  const faceRows = db.prepare(`SELECT id, descriptor FROM faces WHERE descriptor IS NOT NULL ORDER BY id ASC`).all();
  const points = [];
  for (const r of faceRows) {
    const v = parseDescriptor(r.descriptor);
    if (!v) continue;
    points.push({ id: r.id, descriptor: v, norm: norm(v) });
  }

  console.log(`[calibrate] faces=${points.length} minSamples=${minSamples}`);
  console.log('eps    clusters people noise  avgCluster');

  for (let eps = from; eps <= to + 1e-9; eps += step) {
    const { labels, clusters } = dbscan(points, { eps, minSamples });
    const noise = labels.filter((x) => x === -1).length;
    const counts = new Map();
    for (const c of labels) {
      if (c == null || c === -1) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const people = counts.size;
    const sizes = Array.from(counts.values());
    const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    console.log(`${fmt(eps)} ${String(clusters).padEnd(7,' ')} ${String(people).padEnd(6,' ')} ${String(noise).padEnd(5,' ')} ${fmt(avg)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


