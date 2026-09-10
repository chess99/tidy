/**
 * input: isolated DATA_DIR + config.json contents
 * output: config loading behavior without destructive recovery
 * pos: guards configuration persistence against silent reset or rewrite
 */

const fs = require('fs-extra');
const os = require('os');
const path = require('path');

describe('configStore load behavior', () => {
  let dataDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-config-'));
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
  });

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    jest.resetModules();
    await fs.remove(dataDir);
  });

  test('creates defaults only when config.json is absent', async () => {
    const { loadConfig, CONFIG_FILE } = require('../configStore');

    const config = await loadConfig();

    expect(config.scanRoots).toEqual([]);
    expect(await fs.pathExists(CONFIG_FILE)).toBe(true);
  });

  test('reports malformed JSON without overwriting the original file', async () => {
    const configFile = path.join(dataDir, 'config.json');
    const original = '{ this is not json';
    await fs.writeFile(configFile, original, 'utf8');
    const { loadConfig } = require('../configStore');

    await expect(loadConfig()).rejects.toThrow(`Invalid Tidy config at ${configFile}`);
    await expect(fs.readFile(configFile, 'utf8')).resolves.toBe(original);
  });

  test('normalizes in memory without rewriting an existing valid file', async () => {
    const configFile = path.join(dataDir, 'config.json');
    const original = JSON.stringify({
      scanRoots: [{ root: path.join(dataDir, 'photos'), enabled: true }],
      scanType: { exts: ['JPG', '.jpg'], includeNoExt: false },
      scan: { excludeGlobs: [], minFileSizeBytes: 0 },
      tasks: { concurrency: { clip: 1 } },
      workspace: {
        managedRoot: path.join(dataDir, 'sorted'),
        trashDir: path.join(dataDir, 'trash'),
      },
      unknownFutureField: true,
    });
    await fs.writeFile(configFile, original, 'utf8');
    const { loadConfig } = require('../configStore');

    const config = await loadConfig();

    expect(config.scanType.exts).toEqual(['jpg']);
    await expect(fs.readFile(configFile, 'utf8')).resolves.toBe(original);
  });

  test('rejects relative workspace paths instead of resolving them against cwd', async () => {
    const configFile = path.join(dataDir, 'config.json');
    await fs.writeJson(configFile, {
      scanRoots: [],
      scanType: { exts: ['jpg'], includeNoExt: false },
      scan: { excludeGlobs: [], minFileSizeBytes: 0 },
      tasks: { concurrency: {} },
      workspace: { managedRoot: 'relative/sorted', trashDir: path.join(dataDir, 'trash') },
    });
    const { loadConfig } = require('../configStore');

    await expect(loadConfig()).rejects.toThrow('workspace paths must be absolute');
  });
});
