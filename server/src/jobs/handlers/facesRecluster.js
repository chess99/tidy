const { getDB } = require('../../db');
const { reclusterPeople } = require('../../services/reclusterPeople');
const { now } = require('./_util');

async function handleFacesRecluster(ctx) {
  const db = getDB();
  const eps = ctx.job?.params?.eps != null ? Number(ctx.job.params.eps) : undefined;
  const minSamples = ctx.job?.params?.minSamples != null ? Number(ctx.job.params.minSamples) : undefined;
  const preserveNamed = ctx.job?.params?.preserveNamed != null ? !!ctx.job.params.preserveNamed : true;
  const anchorMaxDist = ctx.job?.params?.anchorMaxDist != null ? Number(ctx.job.params.anchorMaxDist) : undefined;

  ctx.heartbeat({ phase: 'faces_recluster' });
  const result = reclusterPeople(db, { eps, minSamples, preserveNamed, anchorMaxDist });
  ctx.heartbeat({ phase: 'faces_recluster_done' });
  return { ok: true, result, finishedAt: now() };
}

module.exports = { handleFacesRecluster };


