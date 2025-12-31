/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const { syncChanges } = require('../../sync');
const { now } = require('./_util');

async function handleSync(ctx) {
  ctx.heartbeat({ phase: 'sync' });
  const report = await syncChanges();
  ctx.heartbeat({ phase: 'sync_done', moved: report?.moved, deleted: report?.deleted, errors: report?.errors });
  return { ok: true, report, finishedAt: now() };
}

module.exports = { handleSync };


