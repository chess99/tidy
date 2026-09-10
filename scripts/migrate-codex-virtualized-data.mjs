import fs from 'node:fs';
import path from 'node:path';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(message) {
  throw new Error(message);
}

function normalized(value) {
  return path.resolve(String(value || '')).toLowerCase();
}

function readConfig(dataDir) {
  const configPath = path.join(dataDir, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.scanRoots) || !config.workspace?.managedRoot || !config.workspace?.trashDir) {
    fail(`Source config is incomplete: ${configPath}`);
  }
  return config;
}

function inspectDataDir(dataDir) {
  if (!fs.existsSync(dataDir)) return { exists: false, path: dataDir };
  const dbPath = path.join(dataDir, 'tidy.db');
  const configPath = path.join(dataDir, 'config.json');
  return {
    exists: true,
    path: dataDir,
    dbBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : null,
    hasConfig: fs.existsSync(configPath),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

const sourceArg = argValue('--source');
if (!sourceArg) fail('--source is required');
const source = path.resolve(sourceArg);
const resultPath = path.resolve(argValue('--result') || path.join(process.cwd(), 'tidy-appdata-migration-result.json'));
const apply = process.argv.includes('--apply');
const appData = String(process.env.APPDATA || '').trim();
if (!appData) fail('APPDATA is required');

const target = path.join(appData, 'tidy-desktop', 'data');
if (normalized(source) === normalized(target)) {
  fail('Source and target resolve to the same path; run this migration outside the Codex MSIX context.');
}

const sourceConfig = readConfig(source);
const sourceDb = path.join(source, 'tidy.db');
if (!fs.existsSync(sourceDb) || fs.statSync(sourceDb).size < 1024 * 1024) {
  fail(`Source database is missing or unexpectedly small: ${sourceDb}`);
}

const report = {
  ok: true,
  applied: false,
  source: inspectDataDir(source),
  target: inspectDataDir(target),
  sourceScanRoots: sourceConfig.scanRoots,
  sourceWorkspace: sourceConfig.workspace,
};

if (apply) {
  const parent = path.dirname(target);
  const staging = path.join(parent, `data.migrating-${timestamp()}`);
  const backup = path.join(parent, `data.before-codex-migration-${timestamp()}`);
  fs.mkdirSync(parent, { recursive: true });
  fs.cpSync(source, staging, { recursive: true, force: false, errorOnExist: true });

  const stagedConfig = readConfig(staging);
  const stagedDb = path.join(staging, 'tidy.db');
  if (fs.statSync(stagedDb).size !== fs.statSync(sourceDb).size) {
    fail('Staged database size does not match the source database.');
  }

  if (fs.existsSync(target)) fs.renameSync(target, backup);
  fs.renameSync(staging, target);
  report.applied = true;
  report.backup = fs.existsSync(backup) ? backup : null;
  report.target = inspectDataDir(target);
  report.targetScanRoots = stagedConfig.scanRoots;
  report.targetWorkspace = stagedConfig.workspace;
}

fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report));
