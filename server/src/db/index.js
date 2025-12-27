const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const schema = require('./schema');

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
  ]);

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

  // Indexes that depend on newly added columns must be created after ALTER TABLE.
  try {
    dbConn.exec(`
      CREATE INDEX IF NOT EXISTS idx_assets_updated_at ON assets(updated_at);
      CREATE INDEX IF NOT EXISTS idx_files_discovered_at ON files(discovered_at);
      CREATE INDEX IF NOT EXISTS idx_files_updated_at ON files(updated_at);
    `);
  } catch {
    // ignore
  }
}

function initDB() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../tidy.db');
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

module.exports = { initDB, getDB };

