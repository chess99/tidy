const fs = require('fs-extra');
const os = require('os');
const path = require('path');

function clearServerModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes(`${path.sep}server${path.sep}src${path.sep}`)) {
      delete require.cache[key];
    }
  }
}

async function makeHarness() {
  clearServerModules();
  jest.resetModules();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-faces-scan-'));
  const dataDir = path.join(root, 'data');
  process.env.DATA_DIR = dataDir;
  process.env.DB_PATH = path.join(dataDir, 'tidy.db');

  const { initDB, getDB } = require('../../../db');
  initDB();
  const db = getDB();
  return { root, db };
}

function seedImage(db, filePath, hash = 'hash-face-fail') {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, 'not-real-image-bytes');
  const now = Date.now();
  db.prepare(`
    INSERT INTO assets (hash, hash_algo, mime_type, status, missing, updated_at, face_scanned_at)
    VALUES (?, 'sha256', 'image/jpeg', 'inbox', 0, ?, NULL)
  `).run(hash, now);
  db.prepare(`
    INSERT INTO files (path, hash, hash_algo, missing, updated_at, mime_guess)
    VALUES (?, ?, 'sha256', 0, ?, 'image/jpeg')
  `).run(filePath, hash, now);
  return hash;
}

describe('faces scan job', () => {
  let harness;

  afterEach(async () => {
    jest.dontMock('../../../scanner/face');
    if (harness?.root) await fs.remove(harness.root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    harness = null;
  });

  test('keeps an asset unscanned when face detection throws', async () => {
    harness = await makeHarness();
    jest.doMock('../../../scanner/face', () => ({
      processImageFaces: jest.fn(async () => {
        throw new Error('ai-service error 500');
      }),
    }));

    const hash = seedImage(harness.db, path.join(harness.root, 'photo.jpg'));
    const { handleFacesScan } = require('../facesScan');

    const result = await handleFacesScan({
      job: { mode: 'missing' },
      loadConfig: async () => ({ tasks: { concurrency: { faces: 1 } } }),
      heartbeat: jest.fn(),
      enqueue: jest.fn(),
      isCancelRequested: () => false,
    });

    expect(result.errors).toBe(1);
    expect(result.scanned).toBe(0);
    const asset = harness.db.prepare('SELECT face_scanned_at FROM assets WHERE hash = ?').get(hash);
    expect(asset.face_scanned_at).toBeNull();
  });
});
