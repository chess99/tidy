const dbSchema = `
  CREATE TABLE IF NOT EXISTS assets (
    hash TEXT PRIMARY KEY,
    mime_type TEXT,
    size INTEGER,
    metadata TEXT,
    taken_at INTEGER,
    status TEXT CHECK(status IN ('inbox', 'sorted', 'trash', 'ignored')) DEFAULT 'inbox',
    rating INTEGER DEFAULT 0,
    target_path TEXT
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    hash TEXT,
    scanned_at INTEGER,
    missing INTEGER DEFAULT 0,
    FOREIGN KEY(hash) REFERENCES assets(hash)
  );

  CREATE INDEX IF NOT EXISTS idx_assets_taken_at ON assets(taken_at);
  CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
`;

module.exports = dbSchema;

