const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const request = require('supertest');

function clearServerModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}server${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

async function makeHarness() {
  clearServerModules();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-route-workflows-'));
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'tidy.db');
  process.env.DATA_DIR = dataDir;
  process.env.DB_PATH = dbPath;
  process.env.THUMB_DIR = path.join(dataDir, 'thumbs');
  process.env.PREVIEW_DIR = path.join(dataDir, 'previews');
  process.env.POSTER_DIR = path.join(dataDir, 'posters');

  const sourceRoot = path.join(root, 'source');
  const managedRoot = path.join(root, 'managed');
  const trashDir = path.join(root, 'trash');
  await fs.ensureDir(sourceRoot);
  await fs.ensureDir(managedRoot);
  await fs.ensureDir(trashDir);

  const { initDB, getDB } = require('../../db');
  initDB();
  const db = getDB();
  const { saveConfig } = require('../../configStore');
  await saveConfig({
    scanRoots: [{ root: sourceRoot, enabled: true }],
    scanType: { exts: ['jpg'], includeNoExt: false },
    scan: { excludeGlobs: [], minFileSizeBytes: 0 },
    tasks: { concurrency: { enrich: 1, faces: 1, thumbs: 1, clip: 1 } },
    workspace: { managedRoot, trashDir },
  });
  const { createApp } = require('../../app');
  const app = createApp({ includeConfig: false });

  return { root, sourceRoot, managedRoot, trashDir, db, app };
}

function seedAssetFile(db, { filePath, hash, content = 'same-bytes', hashAlgo = 'sha256' }) {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  const st = fs.statSync(filePath);
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO assets (hash, hash_algo, status, size, updated_at)
    VALUES (?, ?, 'inbox', ?, ?)
  `).run(hash, hashAlgo, st.size, now);
  return db.prepare(`
    INSERT INTO files (path, hash, hash_algo, size, mtime_ms, missing, updated_at, hash_status)
    VALUES (?, ?, ?, ?, ?, 0, ?, 'done')
  `).run(filePath, hash, hashAlgo, st.size, st.mtimeMs, now).lastInsertRowid;
}

describe('file workflow routes', () => {
  let harness;

  afterEach(async () => {
    if (harness?.root) await fs.remove(harness.root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    delete process.env.THUMB_DIR;
    delete process.env.PREVIEW_DIR;
    delete process.env.POSTER_DIR;
    harness = null;
  });

  test('PATCH /api/assets/:hash with trash moves a real file into trash immediately', async () => {
    harness = await makeHarness();
    const hash = 'hash-trash';
    const source = path.join(harness.sourceRoot, 'photo.jpg');
    seedAssetFile(harness.db, { filePath: source, hash });

    await request(harness.app).patch(`/api/assets/${hash}`).send({ status: 'trash' }).expect(200);

    expect(await fs.pathExists(source)).toBe(false);
    const asset = harness.db.prepare('SELECT status, target_path FROM assets WHERE hash = ?').get(hash);
    expect(asset.status).toBe('trash');
    expect(asset.target_path.startsWith(path.resolve(harness.trashDir) + path.sep)).toBe(true);
    expect(await fs.pathExists(asset.target_path)).toBe(true);
    expect(harness.db.prepare('SELECT op, status FROM file_ops').all()).toEqual([{ op: 'trash', status: 'done' }]);
  });

  test('POST /api/organize keeps duplicate copies by default', async () => {
    harness = await makeHarness();
    const hash = 'hash-organize-keep';
    const a = path.join(harness.sourceRoot, 'a.jpg');
    const b = path.join(harness.sourceRoot, 'b.jpg');
    seedAssetFile(harness.db, { filePath: a, hash });
    seedAssetFile(harness.db, { filePath: b, hash });

    await request(harness.app).post('/api/organize').send({ hashes: [hash], albumName: 'Album' }).expect(200);

    expect(await fs.pathExists(b)).toBe(true);
    const filesCount = harness.db.prepare('SELECT COUNT(*) AS c FROM files WHERE hash = ?').get(hash).c;
    expect(filesCount).toBe(2);
    expect(harness.db.prepare("SELECT COUNT(*) AS c FROM file_ops WHERE op = 'quarantine'").get().c).toBe(0);
  });

  test('POST /api/organize quarantines duplicate copies only when requested', async () => {
    harness = await makeHarness();
    const hash = 'hash-organize-quarantine';
    const a = path.join(harness.sourceRoot, 'a.jpg');
    const b = path.join(harness.sourceRoot, 'b.jpg');
    seedAssetFile(harness.db, { filePath: a, hash, content: 'same' });
    seedAssetFile(harness.db, { filePath: b, hash, content: 'same' });

    await request(harness.app)
      .post('/api/organize')
      .send({ hashes: [hash], albumName: 'Album', duplicatePolicy: 'quarantine-extra' })
      .expect(200);

    expect(await fs.pathExists(b)).toBe(false);
    const quarantineDir = path.join(harness.trashDir, '.quarantine');
    expect((await fs.readdir(quarantineDir)).length).toBe(1);
    expect(harness.db.prepare("SELECT COUNT(*) AS c FROM file_ops WHERE op = 'quarantine' AND status = 'done'").get().c).toBe(1);
  });

  test('POST /api/duplicates/apply never recursively removes a directory path from a corrupted files row', async () => {
    harness = await makeHarness();
    const badPath = path.join(harness.sourceRoot, 'bad-directory.jpg');
    await fs.ensureDir(badPath);
    const id = harness.db.prepare(`
      INSERT INTO files (path, hash, hash_algo, missing, updated_at)
      VALUES (?, NULL, NULL, 0, ?)
    `).run(badPath, Date.now()).lastInsertRowid;

    const res = await request(harness.app).post('/api/duplicates/apply').send({ deleteFileIds: [id] }).expect(200);

    expect(res.body.errors).toBeGreaterThan(0);
    expect(await fs.pathExists(badPath)).toBe(true);
    const op = harness.db.prepare('SELECT op, status, error FROM file_ops WHERE file_id = ?').get(id);
    expect(op.op).toBe('quarantine');
    expect(op.status).toBe('error');
    expect(op.error).toContain('not_regular_file');
  });
});
