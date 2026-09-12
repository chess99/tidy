function initOrganization(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_drafts (
      root TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS organization_candidates (
      root TEXT PRIMARY KEY, id TEXT NOT NULL, revision INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS directory_snapshots (
      id TEXT PRIMARY KEY, root TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS directory_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, root TEXT NOT NULL, snapshot_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, label TEXT NOT NULL, run_id TEXT
    );
    CREATE TABLE IF NOT EXISTS organization_runs (
      id TEXT PRIMARY KEY, root TEXT NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS directory_history_root ON directory_history(root, id);
    CREATE TABLE IF NOT EXISTS organization_moves (
      run_id TEXT NOT NULL, source TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (run_id, source)
    );
  `);
}
function readDraft(db, root) {
  const row = db
    .prepare("SELECT data FROM organization_drafts WHERE root = ?")
    .get(root);
  return row ? JSON.parse(row.data) : null;
}
function saveDraft(db, draft, expectedRevision) {
  return db.transaction(() => {
    const current = readDraft(db, draft.root);
    if ((current?.revision || 0) !== expectedRevision)
      throw new Error("草稿已在另一窗口更新，请重新打开整理");
    const next = { ...draft, revision: expectedRevision + 1 };
    db.prepare(
      "INSERT OR REPLACE INTO organization_drafts VALUES (?, ?, ?)",
    ).run(next.root, next.revision, JSON.stringify(next));
    return next;
  })();
}
module.exports = { initOrganization, readDraft, saveDraft };
