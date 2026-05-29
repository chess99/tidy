const Database = require('better-sqlite3');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const schema = require('../../db/schema');
const { applyMigrationsForTest } = require('../../db');
const { trashAssetKeepOne } = require('../assetTrash');

function makeDb() {
  const db = new Database(':memory:');
  db.exec(schema);
  applyMigrationsForTest(db);
  return db;
}

function insertChange(db, entity, entityId, type) {
  db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
    entity,
    String(entityId),
    type,
    Date.now()
  );
}

describe('assetTrash', () => {
  let root;
  let sourceRoot;
  let trashDir;
  let db;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-asset-trash-'));
    sourceRoot = path.join(root, 'source');
    trashDir = path.join(root, 'trash');
    await fs.ensureDir(sourceRoot);
    await fs.ensureDir(trashDir);
    db = makeDb();
  });

  afterEach(async () => {
    db.close();
    await fs.remove(root);
  });

  function seedAsset({ hash = 'h1', count = 2, album = true } = {}) {
    const now = Date.now();
    db.prepare(`
      INSERT INTO assets (hash, hash_algo, status, updated_at)
      VALUES (?, 'sha256', 'sorted', ?)
    `).run(hash, now);

    let albumId = null;
    if (album) {
      albumId = db.prepare('INSERT INTO albums (name, created_at, updated_at) VALUES (?, ?, ?)').run('Album', now, now).lastInsertRowid;
      db.prepare('INSERT INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(albumId, hash, now);
    }

    const files = [];
    for (let i = 0; i < count; i++) {
      const filePath = path.join(sourceRoot, `photo-${i}.jpg`);
      fs.writeFileSync(filePath, `same-content-${i}`);
      const st = fs.statSync(filePath);
      const id = db.prepare(`
        INSERT INTO files (path, hash, hash_algo, size, mtime_ms, missing, updated_at)
        VALUES (?, ?, 'sha256', ?, ?, 0, ?)
      `).run(filePath, hash, st.size, st.mtimeMs + i, now + i).lastInsertRowid;
      files.push({ id, path: filePath });
    }
    return { hash, files, albumId };
  }

  test('trashAssetKeepOne moves one copy into trash and quarantines extras', async () => {
    const seeded = seedAsset({ count: 3 });

    const result = await trashAssetKeepOne(db, {
      hash: seeded.hash,
      trashDir,
      allowedRoots: [root],
      duplicatePolicy: 'quarantine-extra',
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    expect(result.ok).toBe(true);
    expect(result.quarantined).toBe(2);
    expect(await fs.pathExists(result.keepPath)).toBe(true);
    expect(result.keepPath.startsWith(path.resolve(trashDir) + path.sep)).toBe(true);

    const quarantineFiles = await fs.readdir(path.join(trashDir, '.quarantine'));
    expect(quarantineFiles).toHaveLength(2);
    for (const f of seeded.files) {
      if (f.id === result.keptFileId) continue;
      expect(await fs.pathExists(f.path)).toBe(false);
    }
    const asset = db.prepare('SELECT status, target_path FROM assets WHERE hash = ?').get(seeded.hash);
    expect(asset).toMatchObject({ status: 'trash', target_path: result.keepPath });
    expect(db.prepare('SELECT COUNT(*) AS c FROM album_assets WHERE hash = ?').get(seeded.hash).c).toBe(0);
  });

  test('trashAssetKeepOne preserves extra copies when duplicatePolicy is keep-all', async () => {
    const seeded = seedAsset({ count: 2 });

    const result = await trashAssetKeepOne(db, {
      hash: seeded.hash,
      trashDir,
      allowedRoots: [root],
      duplicatePolicy: 'keep-all',
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    expect(result.ok).toBe(true);
    expect(result.preserved).toBe(1);
    const extra = seeded.files.find((f) => f.id !== result.keptFileId);
    expect(await fs.pathExists(extra.path)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS c FROM files WHERE hash = ?').get(seeded.hash).c).toBe(2);
  });

  test('trashAssetKeepOne reports no_existing_files without deleting asset metadata', async () => {
    const seeded = seedAsset({ count: 1 });
    await fs.remove(seeded.files[0].path);

    const result = await trashAssetKeepOne(db, {
      hash: seeded.hash,
      trashDir,
      allowedRoots: [root],
      duplicatePolicy: 'quarantine-extra',
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_existing_files');
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get(seeded.hash).status).toBe('sorted');
  });

  test('trashAssetKeepOne writes file_ops for trash and quarantine operations', async () => {
    const seeded = seedAsset({ count: 2 });

    await trashAssetKeepOne(db, {
      hash: seeded.hash,
      trashDir,
      allowedRoots: [root],
      duplicatePolicy: 'quarantine-extra',
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    const ops = db.prepare('SELECT op, status FROM file_ops ORDER BY id ASC').all();
    expect(ops).toEqual([
      { op: 'trash', status: 'done' },
      { op: 'quarantine', status: 'done' },
    ]);
  });
});
