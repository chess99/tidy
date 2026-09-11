const {
  DEFAULT_FACE_MAX_DISTANCE,
  DEFAULT_FACE_MIN_FACES,
  LinearFaceIndex,
  cosineDistance,
  recognizeFacePoints,
} = require('../faceClustering');

function unit(values) {
  const length = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return Float32Array.from(values.map((value) => value / length));
}

function point(id, values, personId = null) {
  return { id, descriptor: unit(values), personId, score: 1 };
}

const createLinearIndex = async (points) => new LinearFaceIndex(points);

describe('Immich-compatible face recognition grouping', () => {
  test('uses the same default cosine-distance settings as Immich', () => {
    expect(DEFAULT_FACE_MAX_DISTANCE).toBe(0.5);
    expect(DEFAULT_FACE_MIN_FACES).toBe(3);
    expect(cosineDistance(unit([1, 0]), unit([0.6, 0.8]))).toBeCloseTo(0.4);
  });

  test('does not create a person from only two matching faces', async () => {
    const result = await recognizeFacePoints([point(1, [1, 0]), point(2, [0.99, 0.1])], {
      createIndex: createLinearIndex,
    });

    expect(result.createdPeople.size).toBe(0);
    expect(result.assignments.size).toBe(0);
  });

  test('creates a person from three matching faces including the current face', async () => {
    const result = await recognizeFacePoints(
      [point(1, [1, 0]), point(2, [0.99, 0.1]), point(3, [0.98, -0.1])],
      { createIndex: createLinearIndex }
    );

    expect(result.createdPeople.size).toBe(1);
    expect(new Set(result.assignments.values()).size).toBe(1);
    expect(result.assignments.size).toBe(3);
  });

  test('defers a sparse face and then attaches it to one existing person', async () => {
    const result = await recognizeFacePoints([point(1, [1, 0], 42), point(2, [0.6, 0.8])], {
      createIndex: createLinearIndex,
    });

    expect(result.createdPeople.size).toBe(0);
    expect(result.assignments.get(1)).toBe(42);
    expect(result.assignments.get(2)).toBe(42);
    expect(result.stats.deferredFaces).toBe(1);
  });

  test('a bridge face never merges two existing people', async () => {
    const result = await recognizeFacePoints(
      [point(1, [1, 0], 10), point(2, [0.6, 0.8], 20), point(3, [0.8944, 0.4472])],
      { createIndex: createLinearIndex }
    );

    expect(result.assignments.get(1)).toBe(10);
    expect(result.assignments.get(2)).toBe(20);
    expect([10, 20]).toContain(result.assignments.get(3));
    expect(new Set(result.assignments.values())).toEqual(new Set([10, 20]));
  });
});
