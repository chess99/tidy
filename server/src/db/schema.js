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

  CREATE TABLE IF NOT EXISTS file_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    op TEXT NOT NULL CHECK(op IN ('move', 'trash')),
    hash TEXT,
    file_id INTEGER,
    from_path TEXT,
    to_path TEXT,
    album_id INTEGER,
    status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending',
    error TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('place', 'subject', 'person', 'food', 'other')) DEFAULT 'other',
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(name, type)
  );

  CREATE TABLE IF NOT EXISTS asset_tags (
    hash TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    added_at INTEGER,
    PRIMARY KEY (hash, tag_id),
    FOREIGN KEY(hash) REFERENCES assets(hash) ON DELETE CASCADE,
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
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
  CREATE INDEX IF NOT EXISTS idx_file_ops_status ON file_ops(status);
  CREATE INDEX IF NOT EXISTS idx_file_ops_created_at ON file_ops(created_at);
  CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type);
  CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);
`;

module.exports = dbSchema;

