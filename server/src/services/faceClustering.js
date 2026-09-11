const { HNSW } = require('hnsw');

const DEFAULT_FACE_MAX_DISTANCE = 0.5;
const DEFAULT_FACE_MIN_FACES = 3;

function parseDescriptor(json) {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const vector = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) vector[i] = Number(arr[i]) || 0;
    return vector;
  } catch {
    return null;
  }
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineDistance(a, b, normA, normB) {
  const denominator = (normA || norm(a)) * (normB || norm(b));
  if (!denominator) return 1;
  const cosine = dot(a, b) / denominator;
  return 1 - Math.max(-1, Math.min(1, cosine));
}

class LinearFaceIndex {
  constructor(points = []) {
    this.points = new Map(points.map((point) => [point.id, point]));
  }

  search(descriptor, limit) {
    return Array.from(this.points.values())
      .map((point) => ({ id: point.id, distance: cosineDistance(descriptor, point.descriptor) }))
      .sort((a, b) => a.distance - b.distance || a.id - b.id)
      .slice(0, limit);
  }
}

class HnswFaceIndex {
  constructor({ dimensions, efSearch = 100 } = {}) {
    this.index = new HNSW(16, 300, dimensions, 'cosine', efSearch);
    this.ids = new Set();
  }

  static async create(points, options = {}) {
    const dimensions = Number(options.dimensions || points[0]?.descriptor?.length || 0);
    if (!dimensions) throw new Error('Face index dimensions are required');
    const faceIndex = new HnswFaceIndex({ dimensions, efSearch: options.efSearch });
    if (points.length) {
      await faceIndex.index.buildIndex(
        points.map((point) => ({ id: point.id, vector: point.descriptor })),
        { onProgress: options.onProgress, progressInterval: options.progressInterval || 1000 }
      );
      for (const point of points) faceIndex.ids.add(point.id);
    }
    return faceIndex;
  }

  search(descriptor, limit) {
    if (!this.ids.size) return [];
    return this.index
      .searchKNN(descriptor, limit, { efSearch: Math.max(100, limit) })
      .map((result) => ({ id: result.id, distance: 1 - result.score }));
  }
}

function isWithinDistance(match, maxDistance) {
  return Number.isFinite(match?.distance) && match.distance <= maxDistance;
}

/**
 * Incremental grouping matching Immich's core/defer/assign behavior. A sparse
 * face may join one existing person, but never unions two people through a
 * bridge as an all-pairs DBSCAN component would.
 */
async function recognizeFacePoints(points, options = {}) {
  const maxDistance = Number(options.maxDistance ?? DEFAULT_FACE_MAX_DISTANCE);
  const minFaces = Math.max(1, Math.trunc(Number(options.minFaces ?? DEFAULT_FACE_MIN_FACES)));
  const assignedSearchLimit = Math.max(minFaces, Math.trunc(Number(options.assignedSearchLimit ?? 100)));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const createIndex = options.createIndex || ((items, indexOptions) => HnswFaceIndex.create(items, indexOptions));
  const assignments = new Map();
  for (const point of points) {
    if (point.personId != null) assignments.set(point.id, point.personId);
  }

  if (!points.length) {
    return {
      assignments,
      createdPeople: new Set(),
      stats: {
        faces: 0,
        existingAssignedFaces: 0,
        attachedFaces: 0,
        deferredFaces: 0,
        unassignedFaces: 0,
        newPeople: 0,
        maxDistance,
        minFaces,
      },
    };
  }

  const allIndex = await createIndex(points, {
    dimensions: points[0].descriptor.length,
    onProgress: (done, total) => onProgress?.({ phase: 'face_index', done, total }),
  });
  const assignedPoints = points.filter((point) => assignments.has(point.id));
  const createdPeople = new Set();
  const deferred = [];
  let nextPersonToken = 1;
  let attachedFaces = 0;

  async function assign(point, personId) {
    if (assignments.has(point.id)) return;
    assignments.set(point.id, personId);
    attachedFaces++;
  }

  async function processPoint(point, isDeferredPass) {
    if (assignments.has(point.id)) return;
    const matches = allIndex.search(point.descriptor, minFaces).filter((match) => isWithinDistance(match, maxDistance));
    if (minFaces > 1 && matches.length <= 1) return;

    const isCore = matches.length >= minFaces;
    if (!isCore && !isDeferredPass) {
      deferred.push(point);
      return;
    }

    let personId = null;
    for (const match of matches) {
      const assignedPersonId = assignments.get(match.id);
      if (assignedPersonId != null) {
        personId = assignedPersonId;
        break;
      }
    }

    if (personId == null) {
      const nearestAssigned = allIndex
        .search(point.descriptor, assignedSearchLimit)
        .find((match) => isWithinDistance(match, maxDistance) && assignments.has(match.id));
      if (nearestAssigned) personId = assignments.get(nearestAssigned.id) ?? null;
    }

    if (personId == null && isCore) {
      personId = `new:${nextPersonToken++}`;
      createdPeople.add(personId);
    }

    if (personId != null) await assign(point, personId);
  }

  for (let index = 0; index < points.length; index++) {
    await processPoint(points[index], false);
    if ((index + 1) % 500 === 0) onProgress?.({ phase: 'face_recognition', done: index + 1, total: points.length });
  }
  for (let index = 0; index < deferred.length; index++) {
    await processPoint(deferred[index], true);
    if ((index + 1) % 500 === 0) {
      onProgress?.({ phase: 'face_recognition_deferred', done: index + 1, total: deferred.length });
    }
  }

  return {
    assignments,
    createdPeople,
    stats: {
      faces: points.length,
      existingAssignedFaces: assignedPoints.length,
      attachedFaces,
      deferredFaces: deferred.length,
      unassignedFaces: points.length - assignments.size,
      newPeople: createdPeople.size,
      maxDistance,
      minFaces,
    },
  };
}

module.exports = {
  DEFAULT_FACE_MAX_DISTANCE,
  DEFAULT_FACE_MIN_FACES,
  HnswFaceIndex,
  LinearFaceIndex,
  cosineDistance,
  norm,
  parseDescriptor,
  recognizeFacePoints,
};
