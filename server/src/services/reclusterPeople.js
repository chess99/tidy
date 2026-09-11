const {
  DEFAULT_FACE_MAX_DISTANCE,
  DEFAULT_FACE_MIN_FACES,
  norm,
  parseDescriptor,
  recognizeFacePoints,
} = require('./faceClustering');

function capturedAtExpression(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(assets)').all().map((column) => column.name));
  if (columns.has('captured_at')) return 'a.captured_at';
  if (columns.has('taken_at')) return 'a.taken_at';
  return 'NULL';
}

async function reclusterPeople(db, options = {}) {
  const maxDistance = Number(options.maxDistance ?? DEFAULT_FACE_MAX_DISTANCE);
  const minFaces = Math.max(1, Math.trunc(Number(options.minFaces ?? DEFAULT_FACE_MIN_FACES)));

  const cleanup = db.transaction(() => {
    const orphanedFaces = db.prepare(`
      SELECT COUNT(*) AS count
      FROM faces f
      WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.hash = f.hash)
    `).get().count;
    const deletedFaces = db.prepare(`
      DELETE FROM faces
      WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.hash = faces.hash)
    `).run().changes;
    return { orphanedFaces, deletedFaces };
  })();

  const capturedAt = capturedAtExpression(db);
  const faceRows = db.prepare(`
    SELECT
      f.id,
      f.hash,
      f.person_id,
      f.descriptor,
      f.score,
      COALESCE(${capturedAt}, f.created_at, 0) AS sort_time
    FROM faces f
    JOIN assets a ON a.hash = f.hash
    WHERE f.descriptor IS NOT NULL
    ORDER BY sort_time DESC, f.id ASC
  `).all();

  const points = [];
  let dimensions = null;
  for (const row of faceRows) {
    const descriptor = parseDescriptor(row.descriptor);
    if (!descriptor) continue;
    if (dimensions == null) dimensions = descriptor.length;
    if (descriptor.length !== dimensions || !norm(descriptor)) continue;
    points.push({
      id: Number(row.id),
      descriptor,
      personId: row.person_id == null ? null : Number(row.person_id),
      score: Number(row.score) || 0,
    });
  }

  const recognition = await recognizeFacePoints(points, {
    maxDistance,
    minFaces,
    createIndex: options.createIndex,
    onProgress: options.onProgress,
  });

  const apply = db.transaction(() => {
    const now = Date.now();
    const personIds = new Map();
    const insertPerson = db.prepare(
      'INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (NULL, NULL, ?, ?)'
    );
    for (const token of recognition.createdPeople) {
      const result = insertPerson.run(now, now);
      personIds.set(token, Number(result.lastInsertRowid));
    }

    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ? AND person_id IS NULL');
    const bestNewFace = new Map();
    let assignedFaces = 0;
    for (const point of points) {
      if (point.personId != null) continue;
      const assigned = recognition.assignments.get(point.id);
      if (assigned == null) continue;
      const personId = typeof assigned === 'string' ? personIds.get(assigned) : Number(assigned);
      if (!personId) continue;
      assignedFaces += updateFace.run(personId, point.id).changes;
      const current = bestNewFace.get(personId);
      if (!current || point.score > current.score) bestNewFace.set(personId, { id: point.id, score: point.score });
    }

    const setAvatar = db.prepare(`
      UPDATE people
      SET avatar_face_id = ?, updated_at = ?
      WHERE id = ? AND avatar_face_id IS NULL
    `);
    for (const [personId, face] of bestNewFace) setAvatar.run(face.id, now, personId);

    db.prepare(`
      DELETE FROM people
      WHERE NOT EXISTS (SELECT 1 FROM faces WHERE faces.person_id = people.id)
    `).run();

    return {
      ...recognition.stats,
      assignedFaces,
      people: db.prepare('SELECT COUNT(*) AS count FROM people').get().count,
      unassignedFaces: db.prepare('SELECT COUNT(*) AS count FROM faces WHERE person_id IS NULL').get().count,
      cleanup,
    };
  });

  return apply();
}

module.exports = { reclusterPeople };
