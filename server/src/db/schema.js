/**
 * input: SQLite 文件/连接参数
 * output: DB 访问入口与 schema
 * pos: 服务端数据层：统一 DB 初始化与访问（变更需同步更新本头注释与所属目录 README）
 */

const dbSchema = `
  CREATE TABLE IF NOT EXISTS assets (
    hash TEXT PRIMARY KEY,
    mime_type TEXT,
    size INTEGER,
    metadata TEXT,
    taken_at INTEGER,
    status TEXT CHECK(status IN ('inbox', 'sorted', 'trash', 'ignored')) DEFAULT 'inbox',
    missing INTEGER DEFAULT 0,
    rating INTEGER DEFAULT 0,
    target_path TEXT,
    camera_make TEXT,
    camera_model TEXT,
    is_camera INTEGER DEFAULT 0,
    updated_at INTEGER,
    thumb_updated_at INTEGER,
    face_scanned_at INTEGER
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
    phash TEXT,
    phash_status TEXT,
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
    op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete')),
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

  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    avatar_face_id INTEGER,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS faces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT NOT NULL,
    person_id INTEGER,
    descriptor TEXT,
    box TEXT,
    score REAL,
    created_at INTEGER,
    FOREIGN KEY(hash) REFERENCES assets(hash) ON DELETE CASCADE,
    FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE SET NULL
  );

  -- CLIP embeddings (for smart search / similarity)
  CREATE TABLE IF NOT EXISTS clip_embeddings (
    file_id INTEGER PRIMARY KEY,
    hash TEXT,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    normalized INTEGER NOT NULL DEFAULT 1,
    embedding BLOB NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY(hash) REFERENCES assets(hash) ON DELETE SET NULL
  );

  -- CLIP text embeddings cache (deterministic per model+normalize+text; used by /api/search)
  CREATE TABLE IF NOT EXISTS clip_text_embeddings (
    model TEXT NOT NULL,
    normalized INTEGER NOT NULL DEFAULT 1,
    text TEXT NOT NULL,
    dim INTEGER NOT NULL,
    embedding BLOB NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (model, normalized, text)
  );

  -- Index metadata for ANN (the actual index is stored as a file under data/)
  CREATE TABLE IF NOT EXISTS clip_index_meta (
    name TEXT PRIMARY KEY,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    normalized INTEGER NOT NULL DEFAULT 1,
    built_at INTEGER NOT NULL,
    file_count INTEGER NOT NULL,
    params_json TEXT,
    index_path TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_assets_taken_at ON assets(taken_at);
  CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
  CREATE INDEX IF NOT EXISTS idx_changes_ts ON changes(ts);
  CREATE INDEX IF NOT EXISTS idx_file_ops_status ON file_ops(status);
  CREATE INDEX IF NOT EXISTS idx_file_ops_created_at ON file_ops(created_at);
  CREATE INDEX IF NOT EXISTS idx_tags_type ON tags(type);
  CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);
  CREATE INDEX IF NOT EXISTS idx_faces_hash ON faces(hash);
  CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
  CREATE INDEX IF NOT EXISTS idx_clip_embeddings_hash ON clip_embeddings(hash);
  CREATE INDEX IF NOT EXISTS idx_clip_embeddings_updated_at ON clip_embeddings(updated_at);
  CREATE INDEX IF NOT EXISTS idx_clip_text_embeddings_updated_at ON clip_text_embeddings(updated_at);

  -- Jobs (task queue / execution log)
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'finished', 'failed', 'cancelled', 'interrupted')) DEFAULT 'queued',
    params_json TEXT,
    progress_json TEXT,
    result_json TEXT,
    last_error TEXT,
    cancel_requested INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    heartbeat_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS job_checkpoints (
    job_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (job_id, key),
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_heartbeat ON jobs(heartbeat_at);
`;

module.exports = dbSchema;

