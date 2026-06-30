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

  const { initDB, getDB, closeDB } = require('../../../db');
  initDB();
  const db = getDB();
  return { root, db, closeDB };
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
    jest.dontMock('../../../db');
    jest.dontMock('../../../services/aiCapabilities');
    jest.dontMock('../../../scanner/face');
    harness?.closeDB?.();
    if (harness?.root) await fs.remove(harness.root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    harness = null;
  });

  test('keeps an asset unscanned when face detection throws', async () => {
    harness = await makeHarness();
    jest.doMock('../../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: { available: true, code: null, message: 'ok' },
        clip: { available: true, code: null, message: 'ok' },
      })),
    }));
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
    expect(result.lastError).toBe('ai-service error 500');
    const asset = harness.db.prepare('SELECT face_scanned_at FROM assets WHERE hash = ?').get(hash);
    expect(asset.face_scanned_at).toBeNull();
  });

  test('scans an image and enqueues reclustering when face capability is available', async () => {
    harness = await makeHarness();
    jest.doMock('../../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: { available: true, code: null, message: 'ok' },
        clip: { available: true, code: null, message: 'ok' },
      })),
    }));
    const processImageFaces = jest.fn(async () => {});
    jest.doMock('../../../scanner/face', () => ({ processImageFaces }));

    const filePath = path.join(harness.root, 'photo.jpg');
    const hash = seedImage(harness.db, filePath, 'hash-face-success');
    const enqueue = jest.fn();
    const { handleFacesScan } = require('../facesScan');

    const result = await handleFacesScan({
      job: { mode: 'missing' },
      loadConfig: async () => ({ tasks: { concurrency: { faces: 1 } } }),
      heartbeat: jest.fn(),
      enqueue,
      isCancelRequested: () => false,
    });

    expect(result).toMatchObject({ ok: true, total: 1, done: 1, scanned: 1, skipped: 0, errors: 0 });
    expect(processImageFaces).toHaveBeenCalledWith(filePath, hash);
    const asset = harness.db.prepare('SELECT face_scanned_at FROM assets WHERE hash = ?').get(hash);
    expect(asset.face_scanned_at).not.toBeNull();
    expect(enqueue).toHaveBeenCalledWith('faces_recluster', 'all', {});
  });

  test('blocks before selecting assets when face capability is unavailable', async () => {
    jest.resetModules();
    jest.doMock('../../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: {
          available: false,
          code: 'insightface_unavailable',
          message: 'InsightFace unavailable: No module named insightface',
        },
        clip: { available: true, code: null, message: 'ok' },
      })),
    }));
    const processImageFaces = jest.fn();
    jest.doMock('../../../scanner/face', () => ({ processImageFaces }));

    const prepare = jest.fn(() => {
      throw new Error('DB should not be queried when preflight blocks');
    });
    jest.doMock('../../../db', () => ({ getDB: () => ({ prepare }) }));

    const { handleFacesScan } = require('../facesScan');
    const heartbeats = [];
    const result = await handleFacesScan({
      job: { id: 1, mode: 'missing' },
      loadConfig: async () => ({ tasks: { concurrency: { faces: 1 } } }),
      heartbeat: (patch) => heartbeats.push(patch),
      isCancelRequested: () => false,
      enqueue: jest.fn(),
    });

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      blockedReason: 'faces_unavailable',
      capabilityCode: 'insightface_unavailable',
    });
    expect(processImageFaces).not.toHaveBeenCalled();
    expect(heartbeats[0]).toMatchObject({ phase: 'faces_blocked' });
  });

  test('returns without config or capability checks when already cancelled', async () => {
    jest.resetModules();
    const getAiCapabilities = jest.fn(async () => ({
      faces: { available: true, code: null, message: 'ok' },
    }));
    jest.doMock('../../../services/aiCapabilities', () => ({ getAiCapabilities }));
    const loadConfig = jest.fn(async () => ({ tasks: { concurrency: { faces: 1 } } }));

    const { handleFacesScan } = require('../facesScan');
    const result = await handleFacesScan({
      job: { mode: 'missing' },
      loadConfig,
      heartbeat: jest.fn(),
      enqueue: jest.fn(),
      isCancelRequested: () => true,
    });

    expect(result).toMatchObject({
      ok: true,
      mode: 'missing',
      total: 0,
      done: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
    });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(getAiCapabilities).not.toHaveBeenCalled();
  });
});
