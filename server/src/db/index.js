/**
 * input: SQLite 文件/连接参数
 * output: DB 访问入口与 schema
 * pos: 服务端数据层：统一 DB 初始化与访问（变更需同步更新本头注释与所属目录 README）
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const schema = require('./schema');
const { DB_PATH } = require('../config');

let db;

function getExistingColumns(dbConn, tableName) {
  try {
    const rows = dbConn.prepare(`PRAGMA table_info(${tableName})`).all();
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}

function ensureColumns(dbConn, tableName, columns) {
  const existing = getExistingColumns(dbConn, tableName);
  for (const col of columns) {
    if (existing.has(col.name)) continue;
    const ddl = `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}${col.defaultSql ? ` DEFAULT ${col.defaultSql}` : ''}`;
    dbConn.exec(ddl);
  }
}

function migrateDB(dbConn) {
  // Add new columns to existing tables (SQLite CREATE TABLE IF NOT EXISTS won't alter).
  ensureColumns(dbConn, 'assets', [
    { name: 'updated_at', type: 'INTEGER' },
    { name: 'thumb_updated_at', type: 'INTEGER' },
    { name: 'camera_make', type: 'TEXT' },
    { name: 'camera_model', type: 'TEXT' },
    { name: 'is_camera', type: 'INTEGER', defaultSql: '0' },
    { name: 'face_scanned_at', type: 'INTEGER' },
    { name: 'missing', type: 'INTEGER', defaultSql: '0' },
    { name: 'hash_algo', type: 'TEXT', defaultSql: "'md5'" },
  ]);

  ensureColumns(dbConn, 'files', [
    { name: 'size', type: 'INTEGER' },
    { name: 'mtime_ms', type: 'INTEGER' },
    { name: 'ext', type: 'TEXT' },
    { name: 'mime_guess', type: 'TEXT' },
    { name: 'discovered_at', type: 'INTEGER' },
    { name: 'updated_at', type: 'INTEGER' },
    { name: 'hash_status', type: 'TEXT' },
    { name: 'thumb_status', type: 'TEXT' },
    { name: 'thumb_updated_at', type: 'INTEGER' },
    { name: 'phash', type: 'TEXT' },
    { name: 'phash_status', type: 'TEXT' },
    { name: 'hash_algo', type: 'TEXT', defaultSql: "'md5'" },
  ]);

  ensureColumns(dbConn, 'file_ops', [
    { name: 'attempts', type: 'INTEGER', defaultSql: '0' },
    { name: 'last_attempt_at', type: 'INTEGER' },
  ]);

  try {
    dbConn.exec(`
      UPDATE assets SET hash_algo = COALESCE(hash_algo, 'md5') WHERE hash_algo IS NULL;
      UPDATE files SET hash_algo = COALESCE(hash_algo, 'md5') WHERE hash_algo IS NULL;
      UPDATE file_ops SET attempts = COALESCE(attempts, 0) WHERE attempts IS NULL;
    `);
  } catch {
    // ignore
  }

  // Basic backfill for timestamps (best-effort, safe if columns already populated).
  try {
    dbConn.exec(`
      UPDATE files
      SET discovered_at = COALESCE(discovered_at, scanned_at),
          updated_at    = COALESCE(updated_at, scanned_at)
      WHERE discovered_at IS NULL OR updated_at IS NULL;
    `);
  } catch {
    // ignore
  }

  try {
    dbConn.exec(`
      UPDATE assets
      SET updated_at = COALESCE(updated_at, taken_at)
      WHERE updated_at IS NULL;
    `);
  } catch {
    // ignore
  }

  // Best-effort backfill camera_* from metadata JSON (only if JSON functions available).
  try {
    dbConn.exec(`
      UPDATE assets
      SET camera_make = COALESCE(camera_make, json_extract(metadata, '$.camera_make')),
          camera_model = COALESCE(camera_model, json_extract(metadata, '$.camera_model')),
          is_camera = CASE
            WHEN COALESCE(is_camera, 0) = 1 THEN 1
            WHEN json_extract(metadata, '$.camera_make') IS NOT NULL THEN 1
            WHEN json_extract(metadata, '$.camera_model') IS NOT NULL THEN 1
            ELSE 0
          END
      WHERE metadata IS NOT NULL;
    `);
  } catch {
    // ignore (json_extract may be unavailable)
  }

  // Indexes that depend on newly added columns must be created after ALTER TABLE.
  try {
    dbConn.exec(`
      CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at);
      CREATE INDEX IF NOT EXISTS idx_assets_is_camera ON assets(is_camera);
      CREATE INDEX IF NOT EXISTS idx_assets_missing ON assets(missing);
      CREATE INDEX IF NOT EXISTS idx_files_discovered_at ON files(discovered_at);
      CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at);
      CREATE INDEX IF NOT EXISTS idx_files_phash ON files(phash);
    `);
  } catch {
    // ignore
  }

  // Migrate CHECK constraints that cannot be ALTERed (SQLite): file_ops.op must include 'quarantine'.
  try {
    const row = dbConn
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'file_ops'`)
      .get();
    const sql = String(row?.sql || '');
    const hasTable = !!sql;
    const hasQuarantine = sql.includes("'quarantine'") || sql.includes('"quarantine"');
    if (hasTable && !hasQuarantine) {
      dbConn.exec('BEGIN');
      dbConn.exec('ALTER TABLE file_ops RENAME TO file_ops_old');
      dbConn.exec(`
        CREATE TABLE file_ops (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete', 'quarantine')),
          hash TEXT,
          file_id INTEGER,
          from_path TEXT,
          to_path TEXT,
          album_id INTEGER,
          status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending',
          error TEXT,
          attempts INTEGER DEFAULT 0,
          last_attempt_at INTEGER,
          created_at INTEGER,
          updated_at INTEGER,
          FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE SET NULL
        );
      `);
      dbConn.exec(`
        INSERT INTO file_ops (
          id, op, hash, file_id, from_path, to_path, album_id, status, error,
          attempts, last_attempt_at, created_at, updated_at
        )
        SELECT
          id, op, hash, file_id, from_path, to_path, album_id, status, error,
          COALESCE(attempts, 0), last_attempt_at, created_at, updated_at
        FROM file_ops_old;
      `);
      dbConn.exec('DROP TABLE file_ops_old');
      dbConn.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_ops_status ON file_ops(status);
        CREATE INDEX IF NOT EXISTS idx_file_ops_created_at ON file_ops(created_at);
      `);
      dbConn.exec('COMMIT');
    } else if (hasTable) {
      // Ensure indexes exist (older DBs may miss them).
      dbConn.exec(`
        CREATE INDEX IF NOT EXISTS idx_file_ops_status ON file_ops(status);
        CREATE INDEX IF NOT EXISTS idx_file_ops_created_at ON file_ops(created_at);
      `);
    }
  } catch {
    try {
      dbConn.exec('ROLLBACK');
    } catch {
      // ignore
    }
  }
}

function initDB() {
  const dbPath = process.env.DB_PATH ? path.resolve(String(process.env.DB_PATH)) : DB_PATH;
  console.log(`Initializing database at ${dbPath}`);
  
  fs.ensureDirSync(path.dirname(dbPath));
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  db.exec(schema);
  migrateDB(db);
  
  return db;
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

module.exports = { initDB, getDB, applyMigrationsForTest: migrateDB };
