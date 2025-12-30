function parseDescriptor(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const v = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) v[i] = Number(arr[i]) || 0;
    return v;
  } catch {
    return null;
  }
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineDistance(a, b, na, nb) {
  const denom = (na || norm(a)) * (nb || norm(b));
  if (!denom) return 1;
  const cos = dot(a, b) / denom;
  // clamp for numeric stability
  const c = Math.max(-1, Math.min(1, cos));
  return 1 - c;
}

/**
 * DBSCAN clustering (O(n^2)). Fine for small/medium face counts.
 *
 * @param {Array<{id:number, descriptor:Float32Array, norm:number}>} points
 * @param {{eps:number, minSamples:number}} opts
 * @returns {{labels:number[], clusters:number forcingNoise:number}}
 *  labels: -1 = noise, else clusterId 0..k-1
 */
function dbscan(points, opts) {
  // NOTE: face-api descriptors in this pipeline tend to have small cosine distances.
  // A practical starting point is ~0.04 (tune with scripts/cluster-calibrate.js).
  const eps = Number(opts?.eps ?? 0.04);
  const minSamples = Number(opts?.minSamples ?? 2);

  const n = points.length;
  const labels = new Array(n).fill(undefined); // undefined=unvisited, -1=noise, >=0 cluster
  let clusterId = 0;

  function regionQuery(i) {
    const res = [];
    const pi = points[i];
    for (let j = 0; j < n; j++) {
      const pj = points[j];
      const d = cosineDistance(pi.descriptor, pj.descriptor, pi.norm, pj.norm);
      if (d <= eps) res.push(j);
    }
    return res;
  }

  for (let i = 0; i < n; i++) {
    if (labels[i] !== undefined) continue;
    const neighbors = regionQuery(i);
    if (neighbors.length < minSamples) {
      labels[i] = -1;
      continue;
    }

    labels[i] = clusterId;
    const queue = neighbors.slice();
    for (let qi = 0; qi < queue.length; qi++) {
      const j = queue[qi];
      if (labels[j] === -1) labels[j] = clusterId;
      if (labels[j] !== undefined) continue;
      labels[j] = clusterId;

      const n2 = regionQuery(j);
      if (n2.length >= minSamples) {
        for (const k of n2) queue.push(k);
      }
    }

    clusterId++;
  }

  return { labels, clusters: clusterId };
}

module.exports = {
  parseDescriptor,
  norm,
  cosineDistance,
  dbscan,
};


