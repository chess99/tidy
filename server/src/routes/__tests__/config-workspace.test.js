/**
 * input: workspace configuration HTTP updates
 * output: persisted paths plus one targeted reconciliation job per actual change
 * pos: verifies the config-to-job boundary for workspace migrations
 */

const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('../../watcher', () => ({ restartWatcher: jest.fn(async () => {}) }));

describe('workspace config route', () => {
  let root;
  let app;
  let db;
  let closeDB;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-config-workspace-route-'));
    process.env.DATA_DIR = path.join(root, 'data');
    process.env.DB_PATH = path.join(root, 'data', 'tidy.db');
    const dbModule = require('../../db');
    db = dbModule.initDB();
    closeDB = dbModule.closeDB;
    app = express();
    app.use(express.json());
    app.use('/api/config', require('../config'));
  });

  afterAll(async () => {
    closeDB?.();
    await fs.remove(root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
  });

  test('allows nested trash and queues reconciliation only when paths change', async () => {
    const managedRoot = path.join(root, 'Tidy');
    const trashDir = path.join(managedRoot, '_Trash');
    const changed = await request(app)
      .put('/api/config/workspace')
      .send({ managedRoot, trashDir })
      .expect(200);

    expect(changed.body.workspace).toMatchObject({ MANAGED_ROOT: managedRoot, TRASH_DIR: trashDir });
    expect(changed.body.reconcileJob).toMatchObject({ type: 'workspace_reconcile', mode: 'rebuild', status: 'queued' });
    expect(changed.body.reconcileJob.params).toHaveProperty('previousWorkspace');

    const unchanged = await request(app)
      .put('/api/config/workspace')
      .send({ managedRoot, trashDir })
      .expect(200);
    expect(unchanged.body.reconcileJob).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE type = 'workspace_reconcile'").get().count).toBe(1);
  });

  test('rejects a managed root equal to or inside trash', async () => {
    const trashDir = path.join(root, 'trash');
    await request(app)
      .put('/api/config/workspace')
      .send({ managedRoot: trashDir, trashDir })
      .expect(400);
    await request(app)
      .put('/api/config/workspace')
      .send({ managedRoot: path.join(trashDir, 'managed'), trashDir })
      .expect(400);
  });
});
