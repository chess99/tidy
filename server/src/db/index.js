const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const schema = require('./schema');
const { DB_PATH } = require('../config');
const { TIME_METADATA_VERSION } = require('../scanner/metadata');

let db;

function getExistingColumns(dbConn, tableName) {
  const rows = dbConn.prepare(`PRAGMA table_info(${tableName})`).all();
  return new Set(rows.map(r => r.name));
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
  const legacyAssetColumns = getExistingColumns(dbConn, 'assets');
  ensureColumns(dbConn, 'assets', [
    { name: 'updated_at', type: 'INTEGER' },
    { name: 'thumb_updated_at', type: 'INTEGER' },
    { name: 'camera_make', type: 'TEXT' },
    { name: 'camera_model', type: 'TEXT' },
    { name: 'is_camera', type: 'INTEGER', defaultSql: '0' },
    { name: 'face_scanned_at', type: 'INTEGER' },
    { name: 'missing', type: 'INTEGER', defaultSql: '0' },
    { name: 'hash_algo', type: 'TEXT', defaultSql: "'md5'" },
    { name: 'captured_at', type: 'INTEGER' },
    { name: 'captured_local_ms', type: 'INTEGER' },
    { name: 'time_zone', type: 'TEXT' },
    { name: 'time_source', type: 'TEXT' },
    { name: 'time_tag', type: 'TEXT' },
    { name: 'time_confidence', type: 'TEXT' },
    { name: 'time_zone_inferred', type: 'INTEGER', defaultSql: '0' },
    { name: 'time_locked', type: 'INTEGER', defaultSql: '0' },
    { name: 'time_scanned_at', type: 'INTEGER' },
    { name: 'time_metadata_version', type: 'INTEGER', defaultSql: '0' },
  ]);

  ensureColumns(dbConn, 'files', [
    { name: 'missing', type: 'INTEGER', defaultSql: '0' },
    { name: 'size', type: 'INTEGER' },
    { name: 'mtime_ms', type: 'INTEGER' },
    { name: 'birthtime_ms', type: 'INTEGER' },
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

  dbConn.exec(`
    UPDATE assets SET hash_algo = COALESCE(hash_algo, 'md5') WHERE hash_algo IS NULL;
    UPDATE files SET hash_algo = COALESCE(hash_algo, 'md5') WHERE hash_algo IS NULL;
    UPDATE file_ops SET attempts = COALESCE(attempts, 0) WHERE attempts IS NULL;
  `);

  // Legacy taken_at mixed real media dates with filesystem fallbacks and carried no provenance.
  // Do not migrate those values into captured_at: the enrich job will re-extract every asset.
  if (legacyAssetColumns.has('taken_at')) {
    dbConn.exec(`
      DROP INDEX IF EXISTS idx_assets_taken_at;
      UPDATE assets
      SET captured_at = NULL,
          captured_local_ms = NULL,
          time_zone = NULL,
          time_source = NULL,
          time_tag = NULL,
          time_confidence = NULL,
          time_zone_inferred = 0,
          time_scanned_at = NULL,
          time_metadata_version = 0
      WHERE COALESCE(time_locked, 0) = 0;
      ALTER TABLE assets DROP COLUMN taken_at;
    `);
  }

  dbConn.exec(`
    UPDATE files
    SET discovered_at = COALESCE(discovered_at, scanned_at),
        updated_at    = COALESCE(updated_at, scanned_at)
    WHERE discovered_at IS NULL OR updated_at IS NULL;
  `);

  dbConn.exec(`
    UPDATE assets
    SET updated_at = COALESCE(updated_at, captured_at)
    WHERE updated_at IS NULL;
  `);

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

  // Indexes that depend on newly added columns must be created after ALTER TABLE.
  dbConn.exec(`
    CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at);
    CREATE INDEX IF NOT EXISTS idx_assets_is_camera ON assets(is_camera);
    CREATE INDEX IF NOT EXISTS idx_assets_missing ON assets(missing);
    CREATE INDEX IF NOT EXISTS idx_assets_captured_at ON assets(captured_at);
    CREATE INDEX IF NOT EXISTS idx_assets_captured_local_ms ON assets(captured_local_ms);
    CREATE INDEX IF NOT EXISTS idx_assets_time_scanned_at ON assets(time_scanned_at);
    CREATE INDEX IF NOT EXISTS idx_files_discovered_at ON files(discovered_at);
    CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at);
    CREATE INDEX IF NOT EXISTS idx_files_phash ON files(phash);
  `);

  const hasJobsTable = dbConn.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jobs'`).get();
  const needsTimeRescan = dbConn.prepare(`
    SELECT 1 FROM assets
    WHERE COALESCE(time_locked, 0) = 0
      AND (time_scanned_at IS NULL OR COALESCE(time_metadata_version, 0) != ?)
      AND EXISTS (SELECT 1 FROM files WHERE files.hash = assets.hash AND COALESCE(files.missing, 0) = 0)
    LIMIT 1
  `).get(TIME_METADATA_VERSION);
  if (hasJobsTable && needsTimeRescan) {
    const ts = Date.now();
    dbConn.prepare(`
      INSERT INTO jobs (type, mode, status, params_json, created_at, updated_at)
      SELECT 'enrich', 'missing', 'queued', '{"reason":"time_metadata_migration"}', ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs
        WHERE type = 'enrich' AND status = 'queued'
      )
    `).run(ts, ts);
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
  } catch (error) {
    try {
      dbConn.exec('ROLLBACK');
    } catch {
      // The original migration error is more actionable than a no-active-transaction rollback error.
    }
    throw error;
  }
}

function initDB() {
  const dbPath = process.env.DB_PATH ? path.resolve(String(process.env.DB_PATH)) : DB_PATH;
  console.log(`Initializing database at ${dbPath}`);
  
  fs.ensureDirSync(path.dirname(dbPath));
  
  db = new Database(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(schema);
    migrateDB(db);
    require('../services/organization/store').initOrganization(db);
    return db;
  } catch (error) {
    db.close();
    db = null;
    throw new Error(`Failed to initialize Tidy database at ${dbPath}: ${error?.message || error}`, { cause: error });
  }
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

function closeDB() {
  if (!db) return;
  db.close();
  db = null;
}

module.exports = { initDB, getDB, closeDB, applyMigrationsForTest: migrateDB };
