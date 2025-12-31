const { syncChanges } = require('../../sync');
const { now } = require('./_util');

async function handleSync(ctx) {
  ctx.heartbeat({ phase: 'sync' });
  const report = await syncChanges();
  ctx.heartbeat({ phase: 'sync_done', moved: report?.moved, deleted: report?.deleted, errors: report?.errors });
  return { ok: true, report, finishedAt: now() };
}

module.exports = { handleSync };


