const dbSchema = `
  CREATE TABLE IF NOT EXISTS assets (
    hash TEXT PRIMARY KEY,
    mime_type TEXT,
    size INTEGER,
    metadata TEXT,
    taken_at INTEGER,
    status TEXT CHECK(status IN ('inbox', 'sorted', 'trash', 'ignored')) DEFAULT 'inbox',
    rating INTEGER DEFAULT 0,
    target_path TEXT,
    camera_make TEXT,
    camera_model TEXT,
    is_camera INTEGER DEFAULT 0,
    updated_at INTEGER,
    thumb_updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    hash TEXT,
    scanned_at INTEGER,
    missing INTEGER DEFAULT 0,
    size INTEGER,
    mtime_ms INTEGER,
    ext TEXT,
    mime_guess TEXT,
    discovered_at INTEGER,
    updated_at INTEGER,
    hash_status TEXT,
    thumb_status TEXT,
    thumb_updated_at INTEGER,
    FOREIGN KEY(hash) REFERENCES assets(hash)
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS album_assets (
    album_id INTEGER NOT NULL,
    hash TEXT NOT NULL,
    added_at INTEGER,
    PRIMARY KEY (album_id, hash),
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE,
    FOREIGN KEY(hash) REFERENCES assets(hash) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity TEXT NOT NULL CHECK(entity IN ('file', 'asset')),
    entity_id TEXT NOT NULL,
    type TEXT NOT NULL,
    ts INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assets_taken_at ON assets(taken_at);
  CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
  CREATE INDEX IF NOT EXISTS idx_changes_ts ON changes(ts);
`;

module.exports = dbSchema;

