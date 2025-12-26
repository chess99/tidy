const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const schema = require('./schema');

let db;

function initDB() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../tidy.db');
  console.log(`Initializing database at ${dbPath}`);
  
  fs.ensureDirSync(path.dirname(dbPath));
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  db.exec(schema);
  
  return db;
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call initDB() first.');
  }
  return db;
}

module.exports = { initDB, getDB };

