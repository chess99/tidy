const Database = require('better-sqlite3');
const { applyMigrationsForTest } = require('../db');
const schema = require('../db/schema');

describe('db migration shape', () => {
  test('file_ops supports quarantine and retry metadata', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (hash TEXT PRIMARY KEY, metadata TEXT, taken_at INTEGER);
      CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, hash TEXT, scanned_at INTEGER);
      CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE file_ops (
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
        updated_at INTEGER
      );
    `);

    applyMigrationsForTest(db);

    expect(() => {
      db.prepare("INSERT INTO file_ops (op, status) VALUES ('quarantine', 'pending')").run();
    }).not.toThrow();

    const cols = db.prepare('PRAGMA table_info(file_ops)').all().map((r) => r.name);
    expect(cols).toContain('attempts');
    expect(cols).toContain('last_attempt_at');
    const assetCols = db.prepare('PRAGMA table_info(assets)').all().map((r) => r.name);
    expect(assetCols).not.toContain('taken_at');
    expect(assetCols).toEqual(expect.arrayContaining([
      'captured_at',
      'captured_local_ms',
      'time_source',
      'time_tag',
      'time_confidence',
      'time_locked',
      'time_scanned_at',
    ]));
  });

  test('assets and files get hash_algo defaults for legacy rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (hash TEXT PRIMARY KEY, metadata TEXT, taken_at INTEGER);
      CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, hash TEXT, scanned_at INTEGER);
      CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE file_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete', 'quarantine')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending',
        created_at INTEGER
      );
      INSERT INTO assets (hash) VALUES ('legacy-md5');
      INSERT INTO files (path, hash) VALUES ('/tmp/a.jpg', 'legacy-md5');
    `);

    applyMigrationsForTest(db);

    expect(db.prepare('SELECT hash_algo FROM assets WHERE hash = ?').get('legacy-md5').hash_algo).toBe('md5');
    expect(db.prepare('SELECT hash_algo FROM files WHERE hash = ?').get('legacy-md5').hash_algo).toBe('md5');
  });

  test('queues one metadata refresh when automatic asset times are stale', () => {
    const db = new Database(':memory:');
    db.exec(schema);
    db.prepare(`INSERT INTO assets (hash, time_locked, time_metadata_version) VALUES ('stale', 0, 0)`).run();
    db.prepare(`INSERT INTO files (path, hash, missing) VALUES ('/tmp/stale.jpg', 'stale', 0)`).run();

    applyMigrationsForTest(db);
    applyMigrationsForTest(db);

    expect(db.prepare(`SELECT type, mode, status FROM jobs WHERE type = 'enrich'`).all()).toEqual([
      { type: 'enrich', mode: 'missing', status: 'queued' },
    ]);
  });
});
