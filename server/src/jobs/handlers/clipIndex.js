/**
 * input: job payload + DB(clip_embeddings) + DATA_DIR(索引文件)
 * output: 重建/刷新 CLIP HNSW 索引（用于智能搜索/找相似）
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

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


