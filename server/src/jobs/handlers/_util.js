/**
 * input: job payload + DB/文件系统/服务层
 * output: 任务执行副作用 + 进度/结果写回
 * pos: 服务端任务处理器：实现具体 job 类型（变更需同步更新本头注释与所属目录 README）
 */

const { getDB } = require('../../db');

function now() {
  return Date.now();
}

function insertChange(entity, entityId, type) {
  try {
    const db = getDB();
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
      entity,
      String(entityId),
      String(type),
      now()
    );
  } catch {
    // ignore
  }
}

module.exports = { now, insertChange };


