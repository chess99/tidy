/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const { getDB } = require('../../db');
const { now } = require('./_util');

async function handleFacesReset(ctx) {
  const db = getDB();
  const clearFaces = !!ctx.job?.params?.clearFaces;
  const clearPeople = !!ctx.job?.params?.clearPeople;

  const ts = now();
  const tx = db.transaction(() => {
    const r = db.prepare('UPDATE assets SET face_scanned_at = NULL').run();
    if (clearFaces) db.prepare('DELETE FROM faces').run();
    if (clearPeople) db.prepare('DELETE FROM people').run();
    db.prepare('UPDATE assets SET updated_at = COALESCE(updated_at, ?)').run(ts);
    return { assetsReset: r.changes, clearFaces, clearPeople };
  });

  const result = tx();
  ctx.heartbeat({ phase: 'faces_reset', ...result });
  return { ok: true, ...result, finishedAt: now() };
}

module.exports = { handleFacesReset };


