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

  const { initDB, getDB, closeDB } = require('../../db');
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

  return { root, sourceRoot, managedRoot, trashDir, db, app, closeDB };
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

function seedVideoAssetFile(db, { filePath, hash }) {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.from('fake-video-bytes'));
  const st = fs.statSync(filePath);
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO assets (hash, hash_algo, mime_type, status, size, updated_at)
    VALUES (?, 'sha256', 'video/mp4', 'inbox', ?, ?)
  `).run(hash, st.size, now);
  return db.prepare(`
    INSERT INTO files (path, hash, hash_algo, size, mtime_ms, missing, ext, mime_guess, updated_at, hash_status)
    VALUES (?, ?, 'sha256', ?, ?, 0, '.mp4', 'video/mp4', ?, 'done')
  `).run(filePath, hash, st.size, st.mtimeMs, now).lastInsertRowid;
}

describe('file workflow routes', () => {
  let harness;

  afterEach(async () => {
    harness?.closeDB?.();
    if (harness?.root) await fs.remove(harness.root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    delete process.env.THUMB_DIR;
    delete process.env.PREVIEW_DIR;
    delete process.env.POSTER_DIR;
    jest.restoreAllMocks();
    jest.dontMock('../../utils/findSystemCommand');
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

    await request(harness.app).post('/api/duplicates/apply').send({ deleteFileIds: [id] }).expect(400);
    expect(await fs.pathExists(badPath)).toBe(true);
    const op = harness.db.prepare('SELECT op, status, error FROM file_ops WHERE file_id = ?').get(id);
    expect(op).toBeUndefined();
  });

  test('duplicate review dismisses durably, resets and rejects stale or overlapping decisions', async () => {
    harness = await makeHarness();
    const first = seedAssetFile(harness.db, { filePath: path.join(harness.sourceRoot, 'a.jpg'), hash: 'same' });
    const second = seedAssetFile(harness.db, { filePath: path.join(harness.sourceRoot, 'b.jpg'), hash: 'same' });
    const result = await request(harness.app).get('/api/duplicates/groups').expect(200);
    const groupId = result.body.groups[0].id;
    expect(result.body.groups).toHaveLength(1);
    await request(harness.app).post('/api/duplicates/dismiss').send({ groupId }).expect(200);
    expect((await request(harness.app).get('/api/duplicates/groups')).body.groups).toEqual([]);
    await request(harness.app).post('/api/duplicates/reset').send({}).expect(200);
    expect((await request(harness.app).get('/api/duplicates/groups')).body.groups).toHaveLength(1);
    await request(harness.app).post('/api/duplicates/apply').send({ groupId, keepFileIds: [first], deleteFileIds: [first, second] }).expect(400);
    await request(harness.app).post('/api/duplicates/apply').send({ groupId: 'stale', keepFileIds: [first], deleteFileIds: [second] }).expect(409);
    await fs.appendFile(path.join(harness.sourceRoot, 'b.jpg'), 'changed');
    await request(harness.app).post('/api/duplicates/apply').send({ groupId, keepFileIds: [first], deleteFileIds: [second] }).expect(409);
    expect(harness.db.prepare('SELECT count(*) n FROM file_ops').get().n).toBe(0);
  });

  test('duplicate apply moves only the selected physical copy and preserves its keeper', async () => {
    harness = await makeHarness();
    const a = path.join(harness.sourceRoot, 'a.jpg'), b = path.join(harness.sourceRoot, 'b.jpg');
    const first = seedAssetFile(harness.db, { filePath: a, hash: 'same' });
    const second = seedAssetFile(harness.db, { filePath: b, hash: 'same' });
    const groupId = (await request(harness.app).get('/api/duplicates/groups')).body.groups[0].id;
    const result = await request(harness.app).post('/api/duplicates/apply')
      .send({ groupId, keepFileIds: [first], deleteFileIds: [second] }).expect(200);
    expect(result.body.errors).toBe(0);
    expect(result.body.deletedFiles).toBe(1);
    expect(await fs.pathExists(a)).toBe(true);
    expect(await fs.pathExists(b)).toBe(false);
    expect((await request(harness.app).get('/api/duplicates/groups')).body.groups).toEqual([]);
  });

  test('PATCH /api/assets/:hash/time stores a locked manual capture time and can mark it unknown', async () => {
    harness = await makeHarness();
    const hash = 'hash-manual-time';
    seedAssetFile(harness.db, { filePath: path.join(harness.sourceRoot, 'photo.jpg'), hash });
    const capturedAt = Date.parse('2020-05-02T03:04:05.000Z');
    const capturedLocalMs = Date.parse('2020-05-02T11:04:05.000Z');

    await request(harness.app)
      .patch(`/api/assets/${hash}/time`)
      .send({ capturedAt, capturedLocalMs, timeZone: 'Asia/Shanghai' })
      .expect(200);

    expect(harness.db.prepare(`
      SELECT captured_at, captured_local_ms, time_zone, time_source, time_confidence, time_locked
      FROM assets WHERE hash = ?
    `).get(hash)).toEqual({
      captured_at: capturedAt,
      captured_local_ms: capturedLocalMs,
      time_zone: 'Asia/Shanghai',
      time_source: 'manual',
      time_confidence: 'high',
      time_locked: 1,
    });

    await request(harness.app).patch(`/api/assets/${hash}/time`).send({ capturedAt: null }).expect(200);
    expect(harness.db.prepare('SELECT captured_at, time_source, time_locked FROM assets WHERE hash = ?').get(hash))
      .toEqual({ captured_at: null, time_source: 'manual_unknown', time_locked: 1 });
  });

  test('GET /api/assets/:hash/poster generates and serves a cached video poster when ffmpeg is available', async () => {
    jest.resetModules();
    const childProcess = require('child_process');
    const execFileSpy = jest.spyOn(childProcess, 'execFile').mockImplementation((cmd, args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const outputPath = args[args.length - 1];
      fs.ensureDirSync(path.dirname(outputPath));
      fs.writeFileSync(outputPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      cb(null, '', '');
      return { pid: 1, kill: jest.fn() };
    });
    jest.doMock(require.resolve('../../utils/findSystemCommand'), () => ({
      findSystemCommand: jest.fn(async (cmd) => (cmd === 'ffmpeg' ? 'C:\\Tools\\ffmpeg.exe' : null)),
    }));

    harness = await makeHarness();
    const hash = 'hash-video-poster';
    const source = path.join(harness.sourceRoot, 'clip.mp4');
    seedVideoAssetFile(harness.db, { filePath: source, hash });

    const res = await request(harness.app).get(`/api/assets/${hash}/poster?w=640&q=4`).expect(200);

    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(await fs.pathExists(path.join(process.env.POSTER_DIR, `${hash}_640_q4.jpg`))).toBe(true);
  });
});
