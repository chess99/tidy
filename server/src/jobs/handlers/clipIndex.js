const { now } = require('./_util');
const { rebuildIndex } = require('../../services/clipIndex');

async function handleClipIndex(ctx) {
  const mode = String(ctx.job?.mode || 'rebuild'); // rebuild (reserved for future incremental)
  ctx.heartbeat({ phase: 'clip_index_start', mode });
  const r = await rebuildIndex({});
  ctx.heartbeat({ phase: 'clip_index_done', ok: !!r.ok });
  return { ok: true, mode, result: r, finishedAt: now() };
}

module.exports = { handleClipIndex };


