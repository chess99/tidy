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


