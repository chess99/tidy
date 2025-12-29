#!/usr/bin/env node
/**
 * Clear face records from DB.
 *
 * Default:
 * - DELETE FROM faces
 * - Reset people.avatar_face_id (since it points to faces.id)
 * - Reset assets.face_scanned_at (so future scans will pick them up)
 *
 * Flags:
 *   --people   Also delete all people rows
 */
const { initDB, getDB } = require('../src/db');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function main() {
  initDB();
  const db = getDB();

  const deletePeople = hasFlag('--people');

  const facesCount = db.prepare('SELECT COUNT(*) AS c FROM faces').get().c;
  const peopleCount = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;

  console.log(`[faces] before: faces=${facesCount}, people=${peopleCount}`);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM faces').run();
    db.prepare('UPDATE assets SET face_scanned_at = NULL').run();
    db.prepare('UPDATE people SET avatar_face_id = NULL').run();
    if (deletePeople) db.prepare('DELETE FROM people').run();
  });
  tx();

  const facesCount2 = db.prepare('SELECT COUNT(*) AS c FROM faces').get().c;
  const peopleCount2 = db.prepare('SELECT COUNT(*) AS c FROM people').get().c;
  const resetCount = db.prepare('SELECT COUNT(*) AS c FROM assets WHERE face_scanned_at IS NULL').get().c;

  console.log(`[faces] after:  faces=${facesCount2}, people=${peopleCount2}, assets.face_scanned_at NULL=${resetCount}`);
  console.log('[faces] done');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


