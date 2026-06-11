const { dbscan, cosineDistance, norm } = require('../faceClustering');

function vectorAtCosine(cosine) {
  const s = Math.sqrt(1 - cosine * cosine);
  return Float32Array.from([cosine, s]);
}

function point(id, descriptor) {
  return { id, descriptor, norm: norm(descriptor) };
}

describe('face clustering', () => {
  test('default eps groups same-person embeddings at observed InsightFace distance', () => {
    const a = Float32Array.from([1, 0]);
    const b = vectorAtCosine(0.72); // cosine distance ~= 0.28

    expect(cosineDistance(a, b, norm(a), norm(b))).toBeLessThanOrEqual(0.3);

    const result = dbscan([point(1, a), point(2, b)], { minSamples: 2 });

    expect(result.clusters).toBe(1);
    expect(result.labels).toEqual([0, 0]);
  });
});
