/**
 * input: current and previous workspace roots with existing file rows
 * output: targeted asset status and album reconciliation
 * pos: verifies workspace path changes without media reprocessing
 */

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

describe('workspace reconcile job', () => {
  let root;
  let db;
  let closeDB;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-workspace-reconcile-'));
    process.env.DATA_DIR = path.join(root, 'data');
    process.env.DB_PATH = path.join(root, 'data', 'tidy.db');
    jest.resetModules();
    const dbModule = require('../../../db');
    db = dbModule.initDB();
    closeDB = dbModule.closeDB;
  });

  afterEach(async () => {
    closeDB?.();
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
    jest.resetModules();
    await fs.remove(root);
  });

  async function seed(hash, filePath, status) {
    await fs.outputFile(filePath, hash);
    db.prepare('INSERT INTO assets (hash, status, missing) VALUES (?, ?, 0)').run(hash, status);
    db.prepare('INSERT INTO files (path, hash, missing) VALUES (?, ?, 0)').run(filePath, hash);
  }

  test('reconciles only paths under the current or previous workspace', async () => {
    const previousManaged = path.join(root, 'previous');
    const previousTrash = path.join(root, 'previous-trash');
    const managedRoot = path.join(root, 'Tidy');
    const trashDir = path.join(managedRoot, '_Trash');
    await seed('sorted-hash', path.join(managedRoot, 'Album', 'photo.jpg'), 'inbox');
    await seed('trash-hash', path.join(trashDir, 'deleted.jpg'), 'inbox');
    await seed('old-hash', path.join(previousManaged, 'old.jpg'), 'sorted');
    await seed('unrelated-hash', path.join(root, 'source', 'source.jpg'), 'sorted');

    const { handleWorkspaceReconcile } = require('../workspaceReconcile');
    const heartbeat = jest.fn();
    const result = await handleWorkspaceReconcile({
      job: { params: { previousWorkspace: { managedRoot: previousManaged, trashDir: previousTrash } } },
      loadConfig: async () => ({ workspace: { managedRoot, trashDir } }),
      heartbeat,
      isCancelRequested: () => false,
    });

    expect(result).toMatchObject({ total: 3, done: 3, sorted: 1, trash: 1, inbox: 1, errors: 0 });
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get('sorted-hash').status).toBe('sorted');
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get('trash-hash').status).toBe('trash');
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get('old-hash').status).toBe('inbox');
    expect(db.prepare('SELECT status FROM assets WHERE hash = ?').get('unrelated-hash').status).toBe('sorted');
    expect(db.prepare('SELECT name FROM albums').all()).toEqual([{ name: 'Album' }]);
    expect(heartbeat).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'workspace_reconcile_done' }));
  });
});
