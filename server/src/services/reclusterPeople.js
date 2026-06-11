/**
 * input: DB + 文件系统 + 配置
 * output: 领域服务函数（可复用业务动作）
 * pos: 服务端服务层：跨路由/任务复用的领域能力（变更需同步更新本头注释与所属目录 README）
 */

const { DEFAULT_FACE_CLUSTER_EPS, dbscan, parseDescriptor, norm, cosineDistance } = require('./faceClustering');

function meanVector(vecs) {
  if (!vecs.length) return null;
  const d = vecs[0].length;
  const out = new Float32Array(d);
  for (const v of vecs) {
    for (let i = 0; i < d; i++) out[i] += v[i];
  }
  const inv = 1 / vecs.length;
  for (let i = 0; i < d; i++) out[i] *= inv;
  const n = norm(out);
  if (!n) return out;
  for (let i = 0; i < d; i++) out[i] /= n;
  return out;
}

function reclusterPeople(db, opts = {}) {
  const eps = Number(opts.eps ?? DEFAULT_FACE_CLUSTER_EPS);
  const minSamples = Number(opts.minSamples ?? 2);
  const preserveNamed = opts.preserveNamed !== false;
  const anchorMaxDist = Number(opts.anchorMaxDist ?? eps);

  // Clean up orphaned faces (hash references non-existent assets) before clustering
  // This ensures data consistency and avoids foreign key constraint failures
  const cleanupResult = db.transaction(() => {
    // Count orphaned faces before cleanup
    const orphanedCount = db.prepare(`
      SELECT COUNT(*) AS c
      FROM faces f
      WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.hash = f.hash)
    `).get().c;

    // Delete orphaned faces
    const deleted = db.prepare(`
      DELETE FROM faces
      WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.hash = faces.hash)
    `).run();

    return {
      orphanedFaces: orphanedCount,
      deletedFaces: deleted.changes,
    };
  })();

  // Only process faces that have valid assets (to avoid foreign key constraint failures)
  const faceRows = db.prepare(`
    SELECT f.id, f.hash, f.descriptor, f.score
    FROM faces f
    WHERE f.descriptor IS NOT NULL
      AND EXISTS (SELECT 1 FROM assets a WHERE a.hash = f.hash)
    ORDER BY f.id ASC
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
    const now = Date.now();

    // 1) Optionally preserve named people as anchors
    let anchors = [];
    if (preserveNamed) {
      anchors = db.prepare(`
        SELECT p.id AS person_id, p.name
        FROM people p
        WHERE p.name IS NOT NULL AND trim(p.name) <> ''
      `).all();
    }

    // Build embedding for each anchor (best-score face assigned to that person)
    // Note: Query before resetting person_id to NULL, and ensure people records still exist
    const anchorVec = new Map(); // person_id -> { vec, norm }
    if (anchors.length) {
      const rows = db.prepare(`
        SELECT f.person_id, f.descriptor
        FROM faces f
        JOIN people p ON p.id = f.person_id
        JOIN (
          SELECT person_id, MAX(COALESCE(score, 0)) AS best
          FROM faces
          WHERE person_id IS NOT NULL
          GROUP BY person_id
        ) m ON m.person_id = f.person_id AND COALESCE(f.score, 0) = m.best
        WHERE f.person_id IS NOT NULL AND f.descriptor IS NOT NULL
      `).all();
      for (const r of rows) {
        const v = parseDescriptor(r.descriptor);
        if (!v) continue;
        const n = norm(v);
        if (!n) continue;
        // normalize
        for (let i = 0; i < v.length; i++) v[i] /= n;
        anchorVec.set(Number(r.person_id), { vec: v, norm: 1 });
      }
    }

    // 2) Reset all assignments but DO NOT delete named people
    db.prepare('UPDATE faces SET person_id = NULL').run();
    if (preserveNamed) {
      // delete only unnamed people to avoid unbounded growth
      db.prepare(`DELETE FROM people WHERE name IS NULL OR trim(name) = ''`).run();
    } else {
      db.prepare('DELETE FROM people').run();
    }

    const insertPerson = db.prepare(
      `INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (NULL, NULL, ?, ?)`
    );
    const updateFace = db.prepare('UPDATE faces SET person_id = ? WHERE id = ?');
    const setAvatar = db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?');
    const verifyPersonExists = db.prepare('SELECT 1 FROM people WHERE id = ? LIMIT 1');

    // 3) Compute cluster centroids
    const clusterMembers = new Map(); // clusterId -> idx[]
    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      if (c === -1) continue;
      if (!clusterMembers.has(c)) clusterMembers.set(c, []);
      clusterMembers.get(c).push(i);
    }

    const clusterCentroid = new Map(); // clusterId -> { vec, norm }
    for (const [c, idxs] of clusterMembers.entries()) {
      const vecs = idxs.map((i) => points[i].descriptor);
      const m = meanVector(vecs);
      if (!m) continue;
      clusterCentroid.set(c, { vec: m, norm: 1 });
    }

    // 4) Map clusters to preserved named people when close enough
    const clusterToPersonId = new Map(); // clusterId -> personId
    const mappedToNamed = new Set();

    if (preserveNamed && anchorVec.size) {
      for (const [c, cent] of clusterCentroid.entries()) {
        let bestPid = null;
        let bestDist = Infinity;
        for (const [pid, av] of anchorVec.entries()) {
          // Verify person still exists after deletion step (defensive check)
          const personExists = verifyPersonExists.get(pid);
          if (!personExists) continue;
          const d = cosineDistance(cent.vec, av.vec, 1, 1);
          if (d < bestDist) {
            bestDist = d;
            bestPid = pid;
          }
        }
        if (bestPid != null && bestDist <= anchorMaxDist) {
          clusterToPersonId.set(c, bestPid);
          mappedToNamed.add(bestPid);
        }
      }
    }

    // 5) Create new people for remaining clusters
    for (const c of clusterMembers.keys()) {
      if (clusterToPersonId.has(c)) continue;
      const info = insertPerson.run(now, now);
      if (!info?.lastInsertRowid) {
        throw new Error(`Failed to create person for cluster ${c}`);
      }
      clusterToPersonId.set(c, info.lastInsertRowid);
    }

    // 6) Assign faces + choose avatars for each cluster/person
    const clusterBestFace = new Map(); // clusterId -> { faceId, score }
    for (let i = 0; i < labels.length; i++) {
      const c = labels[i];
      const faceId = idxToFaceId[i];
      if (c === -1) continue; // keep noise unassigned
      const personId = clusterToPersonId.get(c);
      if (personId == null) {
        // This should not happen, but guard against it
        console.warn(`[recluster] cluster ${c} has no personId, skipping face ${faceId}`);
        continue;
      }
      // Verify person exists before updating (defensive check)
      const personExists = verifyPersonExists.get(personId);
      if (!personExists) {
        console.warn(`[recluster] person ${personId} does not exist, skipping face ${faceId}`);
        continue;
      }
      updateFace.run(personId, faceId);

      const s = scores[i];
      const best = clusterBestFace.get(c);
      if (!best || s > best.score) clusterBestFace.set(c, { faceId, score: s });
    }

    // Set avatar faces for newly created people, and for preserved people only if missing
    for (const [clusterId, personId] of clusterToPersonId.entries()) {
      const best = clusterBestFace.get(clusterId);
      if (!best?.faceId) continue;
      const row = db.prepare('SELECT avatar_face_id, name FROM people WHERE id = ?').get(personId);
      const hasName = row?.name != null && String(row.name).trim() !== '';
      if (!row?.avatar_face_id || !hasName) {
        setAvatar.run(best.faceId, now, personId);
      }
    }

    return {
      faces: labels.length,
      clusters,
      people: db.prepare('SELECT COUNT(*) AS c FROM people').get().c,
      noise: labels.filter((x) => x === -1).length,
      eps,
      minSamples,
      preserveNamed,
      anchorMaxDist,
      mappedNamedPeople: mappedToNamed.size,
      cleanup: cleanupResult,
    };
  });

  const result = tx();
  return result;
}

module.exports = { reclusterPeople };

