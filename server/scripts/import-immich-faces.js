#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const { DB_PATH } = require('../src/config');
const {
  applyStagedImport,
  createImportStaging,
  createLocalAssetLookup,
  createStageWriter,
  getStagingSummary,
} = require('../src/services/immichFaceImport');

const EXPORT_SQL = `
SELECT json_build_object(
  'kind', 'asset',
  'assetId', a.id,
  'path', a."originalPath"
)::text
FROM asset a
WHERE a."deletedAt" IS NULL
UNION ALL
SELECT json_build_object(
  'kind', 'face',
  'assetId', a.id,
  'path', a."originalPath",
  'faceId', af.id,
  'personGroupId', af."personId",
  'imageWidth', af."imageWidth",
  'imageHeight', af."imageHeight",
  'x1', af."boundingBoxX1",
  'y1', af."boundingBoxY1",
  'x2', af."boundingBoxX2",
  'y2', af."boundingBoxY2",
  'embedding', fs.embedding::text,
  'personName', p.name,
  'isAvatar', COALESCE(p."faceAssetId" = af.id, false)
)::text
FROM asset_face af
JOIN asset a ON a.id = af."assetId"
JOIN face_search fs ON fs."faceId" = af.id
LEFT JOIN person p ON p.id = af."personId" AND p."ownerId" = a."ownerId"
WHERE af."deletedAt" IS NULL AND a."deletedAt" IS NULL;
`;

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function safeToken(value, label) {
  const token = String(value || '');
  if (!/^[a-zA-Z0-9_.-]+$/.test(token)) throw new Error(`Invalid ${label}`);
  return token;
}

function streamRemoteFaces(options, onFace) {
  const host = String(options.host || '');
  if (!/^[a-zA-Z0-9_.@:-]+$/.test(host)) throw new Error('Invalid SSH host');
  const container = safeToken(options.container, 'container name');
  const database = safeToken(options.database, 'database name');
  const databaseUser = safeToken(options.databaseUser, 'database user');
  const docker = options.sudo ? 'sudo -n /usr/bin/docker' : '/usr/bin/docker';
  const remoteCommand = `${docker} exec -i ${container} psql -v ON_ERROR_STOP=1 -U ${databaseUser} -d ${database} -Atq`;
  const child = spawn('ssh', ['-o', 'BatchMode=yes', host, remoteCommand], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(EXPORT_SQL);

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 16_000) stderr += chunk;
  });

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const consume = (async () => {
    for await (const line of lines) {
      const text = line.trim();
      if (!text) continue;
      onFace(JSON.parse(text));
    }
  })();

  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Immich export failed with exit code ${code}: ${stderr.trim() || 'unknown error'}`));
    });
  });
  return Promise.all([consume, exited]);
}

async function main() {
  const apply = process.argv.includes('--apply');
  const options = {
    host: readArg('--host', 'zcs@192.168.0.104'),
    container: readArg('--container', 'immich_postgres'),
    database: readArg('--database', 'immich'),
    databaseUser: readArg('--databaseUser', 'postgres'),
    remoteRoot: readArg('--remoteRoot', '/external/photos'),
    localRoot: readArg('--localRoot', 'Z:\\_document\\photos'),
    sudo: !process.argv.includes('--no-sudo'),
  };
  const minMatchRate = Number(readArg('--minMatchRate', '0.8'));
  if (!(minMatchRate >= 0 && minMatchRate <= 1)) throw new Error('minMatchRate must be between 0 and 1');

  if (apply) {
    const backupPath = readArg(
      '--backup',
      'D:\\code\\tidy\\data\\backups\\tidy-faces-before-immich-20260911.db'
    );
    if (!fs.existsSync(backupPath)) throw new Error(`Verified face backup is required before --apply: ${backupPath}`);
  }

  const db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma('busy_timeout = 30000');
  createImportStaging(db);
  const lookup = createLocalAssetLookup(db);
  const stage = createStageWriter(db, lookup, options);
  const counters = { remoteFaces: 0, remoteAssets: new Set(), invalidFaces: 0 };

  try {
    await streamRemoteFaces(options, (face) => {
      counters.remoteAssets.add(String(face.assetId || face.path));
      const result = stage(face);
      if (face.kind === 'asset') return;
      counters.remoteFaces++;
      if (result.reason) counters.invalidFaces++;
      if (counters.remoteFaces % 5000 === 0) process.stderr.write(`[immich-import] read ${counters.remoteFaces} faces\n`);
    });

    const summary = getStagingSummary(db, counters);
    const matchRate = summary.remoteFaces ? summary.matchedFaces / summary.remoteFaces : 0;
    const assetMatchRate = summary.remoteAssets ? summary.matchedAssets / summary.remoteAssets : 0;
    const report = { mode: apply ? 'apply' : 'dry-run', ...summary, matchRate, assetMatchRate };
    if (!summary.remoteFaces) throw new Error('Immich export returned no faces');
    if (Math.min(matchRate, assetMatchRate) < minMatchRate) {
      throw new Error(
        `Matched ${(matchRate * 100).toFixed(2)}% of faces and ${(assetMatchRate * 100).toFixed(2)}% of assets; `
        + `required ${(minMatchRate * 100).toFixed(2)}%`
      );
    }

    if (apply) report.applied = applyStagedImport(db);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { EXPORT_SQL, streamRemoteFaces };
