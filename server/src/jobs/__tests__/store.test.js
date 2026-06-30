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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-jobs-store-'));
  const dataDir = path.join(root, 'data');
  process.env.DATA_DIR = dataDir;
  process.env.DB_PATH = path.join(dataDir, 'tidy.db');

  const { initDB, getDB, closeDB } = require('../../db');
  initDB();
  return { root, db: getDB(), closeDB };
}

describe('jobs store', () => {
  let harness;

  afterEach(async () => {
    harness?.closeDB?.();
    if (harness?.root) await fs.remove(harness.root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    harness = null;
  });

  test('creates a queued job when no active job of the same type exists', async () => {
    harness = await makeHarness();
    const { createQueuedJobIfNoActiveJob } = require('../store');

    const job = createQueuedJobIfNoActiveJob({
      type: 'faces_scan',
      mode: 'missing',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });

    expect(job).toMatchObject({
      type: 'faces_scan',
      mode: 'missing',
      status: 'queued',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM jobs').get().count).toBe(1);
  });

  test('does not create a queued job when a queued job of the same type already exists', async () => {
    harness = await makeHarness();
    const { createJob, createQueuedJobIfNoActiveJob } = require('../store');
    createJob({ type: 'faces_scan', mode: 'missing', params: { existing: true } });

    const job = createQueuedJobIfNoActiveJob({
      type: 'faces_scan',
      mode: 'missing',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });

    expect(job).toBeNull();
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE type = ?').get('faces_scan').count).toBe(1);
  });

  test('does not create a queued job when a running job of the same type already exists', async () => {
    harness = await makeHarness();
    const { createJob, startJob, createQueuedJobIfNoActiveJob } = require('../store');
    const existing = createJob({ type: 'faces_scan', mode: 'missing', params: { existing: true } });
    expect(startJob(existing.id)).toBe(true);

    const job = createQueuedJobIfNoActiveJob({
      type: 'faces_scan',
      mode: 'missing',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });

    expect(job).toBeNull();
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM jobs WHERE type = ?').get('faces_scan').count).toBe(1);
  });
});
