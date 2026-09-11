const { getDB } = require('../../db');
const { reclusterPeople } = require('../../services/reclusterPeople');
const { now } = require('./_util');

async function handleFacesRecluster(ctx) {
  const db = getDB();
  const maxDistance = ctx.job?.params?.maxDistance != null ? Number(ctx.job.params.maxDistance) : undefined;
  const minFaces = ctx.job?.params?.minFaces != null ? Number(ctx.job.params.minFaces) : undefined;

  ctx.heartbeat({ phase: 'faces_recluster' });
  const result = await reclusterPeople(db, {
    maxDistance,
    minFaces,
    onProgress: (progress) => ctx.heartbeat(progress),
  });
  ctx.heartbeat({ phase: 'faces_recluster_done' });
  return { ok: true, result, finishedAt: now() };
}

module.exports = { handleFacesRecluster };
