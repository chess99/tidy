const Database = require('better-sqlite3');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const schema = require('../../db/schema');
const { applyMigrationsForTest } = require('../../db');
const { createFileOp, applyFileOp, retryPendingAndErrored } = require('../fileOps');

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

describe('fileOps', () => {
  let root;
  let managedRoot;
  let trashDir;
  let quarantineDir;
  let db;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-fileops-'));
    managedRoot = path.join(root, 'managed');
    trashDir = path.join(root, 'trash');
    quarantineDir = path.join(trashDir, '.quarantine');
    await fs.ensureDir(managedRoot);
    await fs.ensureDir(trashDir);
    db = makeDb();
  });

  afterEach(async () => {
    db.close();
    await fs.remove(root);
  });

  function seedAssetWithFile({ hash = 'h1', fileName = 'photo.jpg', album = false } = {}) {
    const now = Date.now();
    const source = path.join(root, 'source', fileName);
    fs.ensureDirSync(path.dirname(source));
    fs.writeFileSync(source, `bytes-${fileName}`);
    db.prepare(`
      INSERT INTO assets (hash, hash_algo, status, size, updated_at)
      VALUES (?, 'sha256', 'inbox', ?, ?)
    `).run(hash, fs.statSync(source).size, now);
    const file = db.prepare(`
      INSERT INTO files (path, hash, hash_algo, size, missing, updated_at)
      VALUES (?, ?, 'sha256', ?, 0, ?)
    `).run(source, hash, fs.statSync(source).size, now);
    let albumId = null;
    if (album) {
      albumId = db.prepare('INSERT INTO albums (name, created_at, updated_at) VALUES (?, ?, ?)').run('Album', now, now).lastInsertRowid;
      db.prepare('INSERT INTO album_assets (album_id, hash, added_at) VALUES (?, ?, ?)').run(albumId, hash, now);
    }
    return { hash, fileId: file.lastInsertRowid, source, albumId };
  }

  test('move op records pending then done and updates file and asset rows', async () => {
    const seeded = seedAssetWithFile({ album: true });
    const target = path.join(managedRoot, 'Album', 'photo.jpg');

    const op = createFileOp(db, {
      op: 'move',
      hash: seeded.hash,
      fileId: seeded.fileId,
      fromPath: seeded.source,
      toPath: target,
      albumId: seeded.albumId,
    });

    expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(op.id).status).toBe('pending');

    const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
    await applyFileOp(db, op, {
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
      report,
    });

    expect(await fs.pathExists(target)).toBe(true);
    expect(await fs.pathExists(seeded.source)).toBe(false);
    expect(db.prepare('SELECT path FROM files WHERE id = ?').get(seeded.fileId).path).toBe(target);
    expect(db.prepare('SELECT status, target_path FROM assets WHERE hash = ?').get(seeded.hash)).toMatchObject({
      status: 'sorted',
      target_path: target,
    });
    expect(db.prepare('SELECT status, attempts FROM file_ops WHERE id = ?').get(op.id)).toMatchObject({
      status: 'done',
      attempts: 1,
    });
    expect(report.moved).toBe(1);
  });

  test('trash op moves one file to trash and removes album links', async () => {
    const seeded = seedAssetWithFile({ album: true });
    const target = path.join(trashDir, `${seeded.hash}_photo.jpg`);
    const op = createFileOp(db, {
      op: 'trash',
      hash: seeded.hash,
      fileId: seeded.fileId,
      fromPath: seeded.source,
      toPath: target,
    });

    const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
    await applyFileOp(db, op, {
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
      report,
    });

    expect(await fs.pathExists(target)).toBe(true);
    expect(db.prepare('SELECT path FROM files WHERE id = ?').get(seeded.fileId).path).toBe(target);
    expect(db.prepare('SELECT status, target_path FROM assets WHERE hash = ?').get(seeded.hash)).toMatchObject({
      status: 'trash',
      target_path: target,
    });
    expect(db.prepare('SELECT COUNT(*) AS c FROM album_assets WHERE hash = ?').get(seeded.hash).c).toBe(0);
    expect(report.deleted).toBe(1);
  });

  test('quarantine op moves file to quarantine and deletes only that files row', async () => {
    const seeded = seedAssetWithFile();
    const target = path.join(quarantineDir, 'h1_file-1_dedupe_photo.jpg');
    const op = createFileOp(db, {
      op: 'quarantine',
      hash: seeded.hash,
      fileId: seeded.fileId,
      fromPath: seeded.source,
      toPath: target,
    });

    const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
    await applyFileOp(db, op, {
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
      report,
    });

    expect(await fs.pathExists(target)).toBe(true);
    expect(await fs.pathExists(seeded.source)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS c FROM files WHERE id = ?').get(seeded.fileId).c).toBe(0);
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get(seeded.hash).status).toBe('inbox');
    expect(report.deleted).toBe(1);
  });

  test('delete op refuses to recursively remove a directory', async () => {
    const dirPath = path.join(root, 'source', 'directory-at-file-path');
    await fs.ensureDir(dirPath);
    const op = createFileOp(db, {
      op: 'delete',
      fileId: 987,
      fromPath: dirPath,
    });

    const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
    await applyFileOp(db, op, {
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
      report,
    });

    expect(await fs.pathExists(dirPath)).toBe(true);
    const row = db.prepare('SELECT status, error FROM file_ops WHERE id = ?').get(op.id);
    expect(row.status).toBe('error');
    expect(row.error).toContain('not_regular_file');
    expect(report.errors).toBe(1);
  });

  test('executor treats missing source plus existing target as idempotent success', async () => {
    const seeded = seedAssetWithFile();
    const target = path.join(managedRoot, 'Album', 'photo.jpg');
    await fs.ensureDir(path.dirname(target));
    await fs.move(seeded.source, target);
    const op = createFileOp(db, {
      op: 'move',
      hash: seeded.hash,
      fileId: seeded.fileId,
      fromPath: seeded.source,
      toPath: target,
    });

    const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
    await applyFileOp(db, op, {
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
      report,
    });

    expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(op.id).status).toBe('done');
    expect(db.prepare('SELECT path FROM files WHERE id = ?').get(seeded.fileId).path).toBe(target);
    expect(report.errors).toBe(0);
  });

  test('retryPendingAndErrored retries pending and retryable error rows', async () => {
    const pending = seedAssetWithFile({ hash: 'pending', fileName: 'pending.jpg' });
    const retryable = seedAssetWithFile({ hash: 'retryable', fileName: 'retryable.jpg' });
    const pendingTarget = path.join(managedRoot, 'Pending', 'pending.jpg');
    const retryTarget = path.join(managedRoot, 'Retry', 'retryable.jpg');
    const pendingOp = createFileOp(db, {
      op: 'move',
      hash: pending.hash,
      fileId: pending.fileId,
      fromPath: pending.source,
      toPath: pendingTarget,
    });
    const retryOp = createFileOp(db, {
      op: 'move',
      hash: retryable.hash,
      fileId: retryable.fileId,
      fromPath: retryable.source,
      toPath: retryTarget,
    });
    db.prepare('UPDATE file_ops SET status = ?, attempts = ? WHERE id = ?').run('error', 1, retryOp.id);

    const report = await retryPendingAndErrored(db, {
      maxAttempts: 5,
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(pendingOp.id).status).toBe('done');
    expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(retryOp.id).status).toBe('done');
    expect(await fs.pathExists(pendingTarget)).toBe(true);
    expect(await fs.pathExists(retryTarget)).toBe(true);
    expect(report.moved).toBe(2);
    expect(report.errors).toBe(0);
  });

  test('retryPendingAndErrored skips exhausted error rows', async () => {
    const seeded = seedAssetWithFile({ hash: 'exhausted', fileName: 'exhausted.jpg' });
    const op = createFileOp(db, {
      op: 'move',
      hash: seeded.hash,
      fileId: seeded.fileId,
      fromPath: seeded.source,
      toPath: path.join(managedRoot, 'Exhausted', 'exhausted.jpg'),
    });
    db.prepare('UPDATE file_ops SET status = ?, attempts = ? WHERE id = ?').run('error', 5, op.id);

    const report = await retryPendingAndErrored(db, {
      maxAttempts: 5,
      allowedRoots: [root],
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });

    expect(report.errors).toBe(0);
    expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(op.id).status).toBe('error');
  });
});
