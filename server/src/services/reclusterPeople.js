const { dbscan, parseDescriptor, norm } = require('./faceClustering');

function reclusterPeople(db, opts = {}) {
  const eps = Number(opts.eps ?? 0.04);
  const minSamples = Number(opts.minSamples ?? 2);

  const faceRows = db.prepare(`
    SELECT id, hash, descriptor, score
    FROM faces
    WHERE descriptor IS NOT NULL
    ORDER BY id ASC
  `).all();

  const points = [];
  const idxToFaceId = [];
  const scores = [];

  for (const r of faceRows) {
    const v = parseDescriptor(r.descriptor);
    if (!v) continue;
    points.push({ id: r.id, descriptor: v, norm: norm(v) });
    idxToFaceId.push(r.id);
    scores.push(Number(r.score) || 0);
  }

  const { labels, clusters } = dbscan(points, { eps, minSamples });

  const tx = db.transaction(() => {
    // Reset all assignments
    db.prepare('UPDATE faces SET person_id = NULL').run();
    db.prepare('DELETE FROM people').run();

    const insertPerson = db.prepare(
      `INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (NULL, NULL, ?, ?)`
    );
    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');
    const setAvatar = db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?');

    const now = Date.now();
    const clusterToPersonId = new Map();
    const clusterBestFace = new Map(); // clusterId -> { faceId, score }

    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      const faceId = idxToFaceId[i];
      if (c === -1) continue; // noise

      let personId = clusterToPersonId.get(c);
      if (!personId) {
        const info = insertPerson.run(now, now);
        personId = info.lastInsertRowid;
        clusterToPersonId.set(c, personId);
      }

      updateFace.run(personId, faceId);

      const s = scores[i];
      const best = clusterBestFace.get(c);
      if (!best || s > best.score) clusterBestFace.set(c, { faceId, score: s });
    }

    // Set avatar faces
    for (const [clusterId, personId] of clusterToPersonId.entries()) {
      const best = clusterBestFace.get(clusterId);
      if (best?.faceId) setAvatar.run(best.faceId, now, personId);
    }

    return {
      faces: labels.length,
      clusters,
      people: clusterToPersonId.size,
      noise: labels.filter((x) => x === -1).length,
      eps,
      minSamples,
    };
  });

  return tx();
}

module.exports = { reclusterPeople };


