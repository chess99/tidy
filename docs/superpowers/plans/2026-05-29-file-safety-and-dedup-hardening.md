# File Safety And Dedup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tidy's destructive file workflows safe, explicit, recoverable, and test-covered before they move or remove user files.

**Architecture:** Centralize all filesystem mutations behind a `FileOpService` that records intent in `file_ops`, validates paths before touching disk, moves duplicate removals to a quarantine directory instead of recursively deleting, and keeps sync recovery idempotent. Upgrade hash handling to SHA-256 with algorithm metadata and make destructive dedupe require same algorithm, same size, and byte verification for legacy MD5 rows. Split "organize into album" from "dedupe extra copies" so preserving all physical copies is the default user-facing behavior.

**Tech Stack:** Node.js, Express, better-sqlite3, fs-extra, Jest, SQLite WAL.

---

## File Structure

- Create: `server/src/services/fileSafety.js`
  - Owns path safety checks, regular-file validation, unique destination selection, byte equality verification, and quarantine destination generation.
- Create: `server/src/services/fileOps.js`
  - Owns `file_ops` creation, execution, retry, idempotent recovery, and consistent DB updates for `move`, `trash`, and `quarantine`.
- Create: `server/src/services/assetTrash.js`
  - Owns "asset to trash" semantics: keep one copy under `TRASH_DIR`, quarantine or preserve extra copies according to caller policy, clear album links.
- Create: `server/src/services/hashPolicy.js`
  - Owns destructive dedupe eligibility: same hash, same hash algorithm, same size, and legacy MD5 byte-equality verification.
- Create: `server/src/services/__tests__/fileSafety.test.js`
- Create: `server/src/services/__tests__/fileOps.test.js`
- Create: `server/src/services/__tests__/assetTrash.test.js`
- Create: `server/src/services/__tests__/hashPolicy.test.js`
- Modify: `server/src/db/schema.js`
  - Extend `file_ops.op` to include `quarantine`.
  - Add `file_ops.attempts`, `file_ops.last_attempt_at`.
  - Add `assets.hash_algo`, `files.hash_algo`.
- Modify: `server/src/db/index.js`
  - Migrate existing DBs for new columns and the wider `file_ops.op` CHECK constraint.
- Modify: `server/src/scanner/hasher.js`
  - Compute SHA-256 and return algorithm metadata.
- Modify: `server/src/jobs/handlers/enrich.js`
  - Store `files.hash_algo` and `assets.hash_algo`.
  - Rehash legacy MD5 rows in all-mode and rows missing algorithm metadata.
- Modify: `server/src/sync/index.js`
  - Delegate replay to `FileOpService`.
  - Retry `pending` and retryable `error` operations.
- Modify: `server/src/routes/assets.js`
  - Replace `PATCH /api/assets/:hash` DB-only trash with real asset trash workflow.
  - Replace batch trash custom logic with `assetTrash`.
- Modify: `server/src/routes/duplicates.js`
  - Replace per-file delete with quarantine.
  - Use `hashPolicy` before removing same-hash file instances.
- Modify: `server/src/routes/organize.js`
  - Add explicit `duplicatePolicy`.
  - Default to preserving extra same-hash copies.
  - Use `FileOpService` for moves and quarantine operations.
- Modify: `client/src/api/client.js`
  - Send `duplicatePolicy` for organize calls.
- Modify: `client/src/components/FilesGrid.jsx`
  - Add an explicit organize-time duplicate policy control.
- Modify: `client/src/components/AssetDetail.jsx`
  - Keep the existing delete button, but it now calls a backend endpoint that performs real trashing.
- Modify: `docs/决策记录.md`, `docs/设计文档.md`, `docs/用户指南.md`, `README.md`
  - Document safer semantics: no recursive delete for file instances, quarantine for dedupe removals, SHA-256 hash metadata, explicit dedupe policy.

---

### Task 1: Add Safety Tests For File Instance Deletion Boundaries

**Files:**
- Create: `server/src/services/__tests__/fileSafety.test.js`
- Create: `server/src/services/fileSafety.js`

- [ ] **Step 1: Write failing tests for unsafe paths and regular-file-only deletion**

Create `server/src/services/__tests__/fileSafety.test.js`:

```js
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const {
  assertRegularFileForMutation,
  ensurePathInsideOneOf,
  uniquePath,
  makeQuarantinePath,
  areFilesByteEqual,
} = require('../fileSafety');

describe('fileSafety', () => {
  let root;
  let managedRoot;
  let trashDir;
  let quarantineDir;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-safety-'));
    managedRoot = path.join(root, 'managed');
    trashDir = path.join(root, 'trash');
    quarantineDir = path.join(root, 'quarantine');
    await fs.ensureDir(managedRoot);
    await fs.ensureDir(trashDir);
    await fs.ensureDir(quarantineDir);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  test('assertRegularFileForMutation rejects directories before mutation', async () => {
    const dirPath = path.join(root, 'not-a-file');
    await fs.ensureDir(dirPath);

    await expect(assertRegularFileForMutation(dirPath)).rejects.toThrow('not_regular_file');
  });

  test('assertRegularFileForMutation accepts normal files', async () => {
    const filePath = path.join(root, 'photo.jpg');
    await fs.writeFile(filePath, 'photo-bytes');

    await expect(assertRegularFileForMutation(filePath)).resolves.toEqual({
      path: path.resolve(filePath),
      size: Buffer.byteLength('photo-bytes'),
    });
  });

  test('ensurePathInsideOneOf rejects paths outside configured roots', () => {
    const outside = path.join(os.tmpdir(), 'outside-photo.jpg');

    expect(() => ensurePathInsideOneOf(outside, [managedRoot, trashDir])).toThrow('path_outside_allowed_roots');
  });

  test('ensurePathInsideOneOf accepts path under configured roots', () => {
    const inside = path.join(managedRoot, 'album', 'photo.jpg');

    expect(ensurePathInsideOneOf(inside, [managedRoot, trashDir])).toBe(path.resolve(inside));
  });

  test('uniquePath does not overwrite existing files', async () => {
    const first = path.join(root, 'photo.jpg');
    await fs.writeFile(first, 'existing');

    await expect(uniquePath(first)).resolves.toBe(path.join(root, 'photo (1).jpg'));
  });

  test('makeQuarantinePath stays under quarantine root and includes source filename', async () => {
    const source = path.join(root, 'source', 'photo.jpg');
    const dest = await makeQuarantinePath({
      quarantineDir,
      hash: 'abc123',
      fileId: 42,
      sourcePath: source,
      reason: 'dedupe',
    });

    expect(dest.startsWith(path.resolve(quarantineDir) + path.sep)).toBe(true);
    expect(path.basename(dest)).toBe('abc123_file-42_dedupe_photo.jpg');
  });

  test('areFilesByteEqual distinguishes same-size different-content files', async () => {
    const a = path.join(root, 'a.bin');
    const b = path.join(root, 'b.bin');
    await fs.writeFile(a, 'abcd');
    await fs.writeFile(b, 'abce');

    await expect(areFilesByteEqual(a, b)).resolves.toBe(false);
  });

  test('areFilesByteEqual accepts identical files', async () => {
    const a = path.join(root, 'a.bin');
    const b = path.join(root, 'b.bin');
    await fs.writeFile(a, 'same-bytes');
    await fs.copy(a, b);

    await expect(areFilesByteEqual(a, b)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing file safety tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/fileSafety.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../fileSafety'`.

- [ ] **Step 3: Implement `server/src/services/fileSafety.js`**

Create `server/src/services/fileSafety.js`:

```js
/**
 * input: filesystem paths + configured roots
 * output: safe path validation and quarantine helpers for file mutations
 * pos: service layer guardrail for destructive or move-like filesystem operations
 */

const fs = require('fs-extra');
const path = require('path');

function stripTrailingSep(p) {
  let s = String(p || '');
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function normCase(p) {
  const r = stripTrailingSep(path.resolve(String(p)));
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function isUnder(parent, child) {
  const p = normCase(parent);
  const c = normCase(child);
  return c === p || c.startsWith(p + path.sep);
}

function ensurePathInsideOneOf(filePath, allowedRoots = []) {
  const resolved = path.resolve(String(filePath || ''));
  const roots = allowedRoots.filter(Boolean).map(String);
  if (!roots.length) throw new Error('allowed_roots_required');
  if (!roots.some((root) => isUnder(root, resolved))) {
    throw new Error(`path_outside_allowed_roots: ${resolved}`);
  }
  return resolved;
}

async function assertRegularFileForMutation(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const st = await fs.lstat(resolved);
  if (!st.isFile()) throw new Error(`not_regular_file: ${resolved}`);
  return { path: resolved, size: st.size };
}

async function uniquePath(destPath) {
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let candidate = destPath;
  for (let i = 1; i <= 9999; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fs.pathExists(candidate))) return candidate;
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  throw new Error(`unique_path_exhausted: ${destPath}`);
}

function safeNamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 160) || 'unknown';
}

async function makeQuarantinePath({ quarantineDir, hash, fileId, sourcePath, reason }) {
  if (!quarantineDir) throw new Error('quarantine_dir_required');
  const baseName = safeNamePart(path.basename(String(sourcePath || 'file')));
  const hashPart = safeNamePart(hash || 'nohash');
  const reasonPart = safeNamePart(reason || 'removed');
  const filePart = Number.isFinite(Number(fileId)) ? `file-${Number(fileId)}` : 'file-unknown';
  const raw = path.join(path.resolve(quarantineDir), `${hashPart}_${filePart}_${reasonPart}_${baseName}`);
  await fs.ensureDir(path.dirname(raw));
  return await uniquePath(raw);
}

async function areFilesByteEqual(a, b) {
  const [as, bs] = await Promise.all([fs.stat(a), fs.stat(b)]);
  if (!as.isFile() || !bs.isFile()) return false;
  if (as.size !== bs.size) return false;

  const ah = await fs.readFile(a);
  const bh = await fs.readFile(b);
  return Buffer.compare(ah, bh) === 0;
}

module.exports = {
  isUnder,
  ensurePathInsideOneOf,
  assertRegularFileForMutation,
  uniquePath,
  makeQuarantinePath,
  areFilesByteEqual,
};
```

- [ ] **Step 4: Run file safety tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/fileSafety.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/fileSafety.js server/src/services/__tests__/fileSafety.test.js
git commit -m "test: add file safety guards"
```

---

### Task 2: Extend Schema For Safe Operations And Hash Algorithms

**Files:**
- Modify: `server/src/db/schema.js`
- Modify: `server/src/db/index.js`
- Test: `server/src/__tests__/db-migration.test.js`

- [ ] **Step 1: Write failing migration tests**

Create `server/src/__tests__/db-migration.test.js`:

```js
const Database = require('better-sqlite3');
const { applyMigrationsForTest } = require('../db');

describe('db migration shape', () => {
  test('file_ops supports quarantine and retry metadata', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (hash TEXT PRIMARY KEY);
      CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, hash TEXT);
      CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE file_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete')),
        hash TEXT,
        file_id INTEGER,
        from_path TEXT,
        to_path TEXT,
        album_id INTEGER,
        status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending',
        error TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);

    applyMigrationsForTest(db);

    expect(() => {
      db.prepare("INSERT INTO file_ops (op, status) VALUES ('quarantine', 'pending')").run();
    }).not.toThrow();

    const cols = db.prepare('PRAGMA table_info(file_ops)').all().map((r) => r.name);
    expect(cols).toContain('attempts');
    expect(cols).toContain('last_attempt_at');
  });

  test('assets and files get hash_algo defaults for legacy rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (hash TEXT PRIMARY KEY);
      CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT UNIQUE NOT NULL, hash TEXT);
      CREATE TABLE albums (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL);
      CREATE TABLE file_ops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete', 'quarantine')),
        status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending'
      );
      INSERT INTO assets (hash) VALUES ('legacy-md5');
      INSERT INTO files (path, hash) VALUES ('/tmp/a.jpg', 'legacy-md5');
    `);

    applyMigrationsForTest(db);

    expect(db.prepare('SELECT hash_algo FROM assets WHERE hash = ?').get('legacy-md5').hash_algo).toBe('md5');
    expect(db.prepare('SELECT hash_algo FROM files WHERE hash = ?').get('legacy-md5').hash_algo).toBe('md5');
  });
});
```

- [ ] **Step 2: Run migration tests and verify failure**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/__tests__/db-migration.test.js --runInBand
```

Expected: FAIL with `applyMigrationsForTest is not a function`.

- [ ] **Step 3: Modify `server/src/db/schema.js`**

Change the table definitions:

```js
hash_algo TEXT DEFAULT 'sha256',
```

Add that column to both `assets` and `files`.

Change `file_ops` to:

```sql
op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete', 'quarantine')),
attempts INTEGER DEFAULT 0,
last_attempt_at INTEGER,
```

- [ ] **Step 4: Modify `server/src/db/index.js` migration logic**

Add these columns to the existing `ensureColumns` calls:

```js
ensureColumns(dbConn, 'assets', [
  { name: 'updated_at', type: 'INTEGER' },
  { name: 'thumb_updated_at', type: 'INTEGER' },
  { name: 'camera_make', type: 'TEXT' },
  { name: 'camera_model', type: 'TEXT' },
  { name: 'is_camera', type: 'INTEGER', defaultSql: '0' },
  { name: 'face_scanned_at', type: 'INTEGER' },
  { name: 'missing', type: 'INTEGER', defaultSql: '0' },
  { name: 'hash_algo', type: 'TEXT', defaultSql: "'md5'" },
]);

ensureColumns(dbConn, 'files', [
  { name: 'size', type: 'INTEGER' },
  { name: 'mtime_ms', type: 'INTEGER' },
  { name: 'ext', type: 'TEXT' },
  { name: 'mime_guess', type: 'TEXT' },
  { name: 'discovered_at', type: 'INTEGER' },
  { name: 'updated_at', type: 'INTEGER' },
  { name: 'hash_status', type: 'TEXT' },
  { name: 'thumb_status', type: 'TEXT' },
  { name: 'thumb_updated_at', type: 'INTEGER' },
  { name: 'phash', type: 'TEXT' },
  { name: 'phash_status', type: 'TEXT' },
  { name: 'hash_algo', type: 'TEXT', defaultSql: "'md5'" },
]);
```

Add `file_ops` columns:

```js
ensureColumns(dbConn, 'file_ops', [
  { name: 'attempts', type: 'INTEGER', defaultSql: '0' },
  { name: 'last_attempt_at', type: 'INTEGER' },
]);
```

Replace the existing CHECK migration with one that rebuilds `file_ops` unless the table SQL includes `'quarantine'`. The rebuilt table must preserve old rows:

```sql
CREATE TABLE file_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL CHECK(op IN ('move', 'trash', 'delete', 'quarantine')),
  hash TEXT,
  file_id INTEGER,
  from_path TEXT,
  to_path TEXT,
  album_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'done', 'error')) DEFAULT 'pending',
  error TEXT,
  attempts INTEGER DEFAULT 0,
  last_attempt_at INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE SET NULL
);
```

Export `applyMigrationsForTest`:

```js
module.exports = { initDB, getDB, applyMigrationsForTest: migrateDB };
```

- [ ] **Step 5: Run migration tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/__tests__/db-migration.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Run full backend tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/schema.js server/src/db/index.js server/src/__tests__/db-migration.test.js
git commit -m "feat: extend file op and hash metadata schema"
```

---

### Task 3: Implement Unified FileOpService

**Files:**
- Create: `server/src/services/fileOps.js`
- Create: `server/src/services/__tests__/fileOps.test.js`

- [ ] **Step 1: Write failing tests for unified operation execution**

Create `server/src/services/__tests__/fileOps.test.js` with in-memory DB setup and temp files. Cover these named tests:

```js
test('move op records pending then done and updates file and asset rows')
test('trash op moves one file to trash and removes album links')
test('quarantine op moves file to quarantine and deletes only that files row')
test('delete op refuses to recursively remove a directory')
test('executor treats missing source plus existing target as idempotent success')
test('retryPendingAndErrored retries pending and retryable error rows')
```

The directory refusal assertion must create a directory at `from_path`, insert a `delete` op for that path, run the executor, and assert the directory still exists and the op becomes `error` with `not_regular_file`.

- [ ] **Step 2: Run FileOpService tests and verify failure**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/fileOps.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../fileOps'`.

- [ ] **Step 3: Implement `server/src/services/fileOps.js`**

Create a service with these exports:

```js
module.exports = {
  createFileOp,
  applyFileOp,
  retryPendingAndErrored,
};
```

Use this behavior:

- `createFileOp(db, attrs)` inserts a `pending` row with `op`, `hash`, `file_id`, `from_path`, `to_path`, `album_id`, timestamps, `attempts = 0`.
- `applyFileOp(db, op, { allowedRoots, insertChange })` increments attempts before filesystem mutation.
- `move` validates source is a regular file when source exists, ensures destination parent, uses `fs.move(..., { overwrite: false })`, then updates `files.path`, `assets.status='sorted'`, `assets.target_path`, and `album_assets`.
- `trash` validates source, moves to `to_path`, updates the kept `files` row, marks asset `trash`, deletes album links.
- `quarantine` validates source, moves to `to_path`, deletes that `files` row, inserts a `file` change, and leaves `assets.status` unchanged.
- `delete` is retained only for old pending rows; it validates the source is a regular file and then uses `fs.unlink`, never `fs.remove`.
- All operations mark `done` only after DB pointers are updated.
- Failures mark `error`, set `error`, increment `attempts`, and preserve source/target metadata.
- `retryPendingAndErrored` selects rows where `status='pending' OR (status='error' AND attempts < maxAttempts)` ordered by `id ASC`.

- [ ] **Step 4: Run FileOpService tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/fileOps.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/fileOps.js server/src/services/__tests__/fileOps.test.js
git commit -m "feat: centralize file operation execution"
```

---

### Task 4: Refactor Sync To Use FileOpService And Retry Errors

**Files:**
- Modify: `server/src/sync/index.js`
- Test: `server/src/services/__tests__/fileOps.test.js`

- [ ] **Step 1: Add sync retry assertions**

Extend `fileOps.test.js` with:

```js
test('retryPendingAndErrored skips exhausted error rows', async () => {
  const op = insertErroredOp({ attempts: 5 });
  const report = await retryPendingAndErrored(db, { maxAttempts: 5, allowedRoots, insertChange });
  expect(report.errors).toBe(0);
  expect(db.prepare('SELECT status FROM file_ops WHERE id = ?').get(op.id).status).toBe('error');
});
```

- [ ] **Step 2: Modify `server/src/sync/index.js`**

Replace local `applyFileOp`, `ensureDirForFile`, and `uniquePath` logic with imports:

```js
const { retryPendingAndErrored, createFileOp, applyFileOp } = require('../services/fileOps');
const { makeQuarantinePath } = require('../services/fileSafety');
```

In `syncChanges`, replace the pending replay block with:

```js
const allowedRoots = [cfg.workspace?.managedRoot, cfg.workspace?.trashDir].filter(Boolean);
const replay = await retryPendingAndErrored(db, {
  maxAttempts: 5,
  allowedRoots,
  insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
});
report.moved += replay.moved;
report.deleted += replay.deleted;
report.errors += replay.errors;
report.messages.push(...replay.messages);
```

For trash reconciliation extra copies, create `quarantine` ops instead of `delete` ops:

```js
const quarantineDir = path.join(trashDir, '.quarantine');
const toPath = await makeQuarantinePath({
  quarantineDir,
  hash,
  fileId: f.id,
  sourcePath: f.path,
  reason: 'trash-extra',
});
const op = createFileOp(db, {
  op: 'quarantine',
  hash,
  fileId: f.id,
  fromPath: f.path,
  toPath,
});
await applyFileOp(db, op, {
  allowedRoots: [managedRoot, trashDir],
  insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
});
```

- [ ] **Step 3: Run sync and FileOpService tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/fileOps.test.js --runInBand
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/sync/index.js server/src/services/__tests__/fileOps.test.js
git commit -m "fix: retry file operation recovery through shared executor"
```

---

### Task 5: Replace Asset Trash Paths With Shared Service

**Files:**
- Create: `server/src/services/assetTrash.js`
- Create: `server/src/services/__tests__/assetTrash.test.js`
- Modify: `server/src/routes/assets.js`

- [ ] **Step 1: Write failing asset trash tests**

Create `server/src/services/__tests__/assetTrash.test.js` with these tests:

```js
test('trashAssetKeepOne moves one copy into trash and quarantines extras')
test('trashAssetKeepOne preserves extra copies when duplicatePolicy is keep-all')
test('trashAssetKeepOne reports no_existing_files without deleting asset metadata')
test('trashAssetKeepOne writes file_ops for trash and quarantine operations')
```

The first test must assert that no call path leaves an original extra copy deleted without a quarantine file under `trash/.quarantine`.

- [ ] **Step 2: Implement `server/src/services/assetTrash.js`**

Export:

```js
module.exports = {
  trashAssetKeepOne,
};
```

Behavior:

- Select existing `files` rows for the hash by newest mtime/update timestamp.
- If a copy is already under `trashDir`, keep that one.
- Otherwise create and apply a `trash` op for the selected keep copy.
- If `duplicatePolicy === 'quarantine-extra'`, create and apply `quarantine` ops for other copies.
- If `duplicatePolicy === 'keep-all'`, leave other copies in place and keep `files` rows.
- Always set `assets.status='trash'`, `assets.target_path=keepPath`, `assets.missing=0`, and remove `album_assets`.
- Return `{ ok, keepPath, keptFileId, quarantined, preserved, errors, messages }`.

- [ ] **Step 3: Refactor `server/src/routes/assets.js`**

Change `PATCH /api/assets/:hash`:

- For `status === 'trash'`, call `trashAssetKeepOne` with `duplicatePolicy: 'quarantine-extra'`.
- For other statuses, keep DB-only status update, but update `updated_at` and insert a change.

Change `/batch-status`:

- For `status === 'trash'`, call `trashAssetKeepOne` for each hash.
- Remove route-local `fs.move`, `fs.remove`, and `file_ops` insert/update logic.

- [ ] **Step 4: Run asset tests and backend tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/assetTrash.test.js --runInBand
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/assetTrash.js server/src/services/__tests__/assetTrash.test.js server/src/routes/assets.js
git commit -m "fix: make asset trash perform real safe file operations"
```

---

### Task 6: Refactor Duplicates And Organize To Avoid Permanent Duplicate Deletion

**Files:**
- Create: `server/src/services/hashPolicy.js`
- Create: `server/src/services/__tests__/hashPolicy.test.js`
- Modify: `server/src/routes/duplicates.js`
- Modify: `server/src/routes/organize.js`
- Modify: `client/src/api/client.js`
- Modify: `client/src/components/FilesGrid.jsx`

- [ ] **Step 1: Write hash policy tests**

Create `server/src/services/__tests__/hashPolicy.test.js`:

```js
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { canTreatAsSameContentForDestructiveDedupe } = require('../hashPolicy');

describe('hashPolicy', () => {
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-hash-policy-'));
  });
  afterEach(async () => {
    await fs.remove(root);
  });

  test('allows sha256 rows with same hash algorithm and size', async () => {
    const a = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'a') };
    const b = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'b') };
    await fs.writeFile(a.path, '0123456789');
    await fs.writeFile(b.path, '0123456789');

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(true);
  });

  test('rejects same hash with different sizes', async () => {
    const a = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'a') };
    const b = { hash: 'h', hash_algo: 'sha256', size: 11, path: path.join(root, 'b') };

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(false);
  });

  test('legacy md5 requires byte equality', async () => {
    const a = { hash: 'legacy', hash_algo: 'md5', size: 4, path: path.join(root, 'a') };
    const b = { hash: 'legacy', hash_algo: 'md5', size: 4, path: path.join(root, 'b') };
    await fs.writeFile(a.path, 'abcd');
    await fs.writeFile(b.path, 'abce');

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Implement `server/src/services/hashPolicy.js`**

```js
/**
 * input: two file/content rows
 * output: whether they are safe to treat as the same content for destructive dedupe
 * pos: service layer guardrail for hash-based duplicate actions
 */

const { areFilesByteEqual } = require('./fileSafety');

async function canTreatAsSameContentForDestructiveDedupe(a, b) {
  if (!a || !b) return false;
  if (!a.hash || !b.hash || String(a.hash) !== String(b.hash)) return false;
  const algoA = String(a.hash_algo || 'md5').toLowerCase();
  const algoB = String(b.hash_algo || 'md5').toLowerCase();
  if (algoA !== algoB) return false;
  if (Number(a.size) !== Number(b.size)) return false;
  if (algoA === 'sha256') return true;
  if (!a.path || !b.path) return false;
  return await areFilesByteEqual(a.path, b.path);
}

module.exports = { canTreatAsSameContentForDestructiveDedupe };
```

- [ ] **Step 3: Refactor `duplicates.js`**

Replace `deleteFileInstance` so it creates a `quarantine` op under `trashDir/.quarantine` and applies it through `FileOpService`. Keep asset-level trash through `assetTrash.trashAssetKeepOne`.

Before quarantining a selected same-hash duplicate, load the kept row and candidate row with `hash`, `hash_algo`, `size`, and `path`, and require `canTreatAsSameContentForDestructiveDedupe(keep, candidate)`.

- [ ] **Step 4: Refactor `organize.js` backend policy**

Accept:

```js
const duplicatePolicy = ['keep-all', 'quarantine-extra'].includes(req.body?.duplicatePolicy)
  ? req.body.duplicatePolicy
  : 'keep-all';
```

Behavior:

- Move one primary file to the album through `FileOpService`.
- If `duplicatePolicy === 'keep-all'`, do not touch other same-hash physical copies.
- If `duplicatePolicy === 'quarantine-extra'`, quarantine extra copies after `hashPolicy` passes against the moved primary row.
- Remove all `fs.remove` calls from this route.

- [ ] **Step 5: Update frontend organize API and UI**

In `client/src/api/client.js`, change:

```js
export const organizeAssets = ({ hashes = [], albumId, albumName, duplicatePolicy = 'keep-all' }) =>
  api.post('/organize', { hashes, albumId, albumName, duplicatePolicy }).then(res => res.data);
```

In `client/src/components/FilesGrid.jsx`, add a checkbox or switch near the organize confirmation controls:

```jsx
<label className="flex items-center gap-2 text-sm text-gray-700">
  <input
    type="checkbox"
    checked={dedupeExtras}
    onChange={(e) => setDedupeExtras(e.target.checked)}
  />
  <span>隔离相同内容的额外副本</span>
</label>
```

When invoking `organizeAssets`, pass:

```js
duplicatePolicy: dedupeExtras ? 'quarantine-extra' : 'keep-all'
```

- [ ] **Step 6: Run duplicate and organize tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/services/__tests__/hashPolicy.test.js src/services/__tests__/fileOps.test.js src/services/__tests__/assetTrash.test.js --runInBand
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/hashPolicy.js server/src/services/__tests__/hashPolicy.test.js server/src/routes/duplicates.js server/src/routes/organize.js client/src/api/client.js client/src/components/FilesGrid.jsx
git commit -m "fix: quarantine duplicate removals behind explicit policy"
```

---

### Task 7: Upgrade Content Hashing To SHA-256 With Algorithm Metadata

**Files:**
- Modify: `server/src/scanner/hasher.js`
- Modify: `server/src/jobs/handlers/enrich.js`
- Modify: `server/src/routes/duplicates.js`
- Test: `server/src/scanner/__tests__/hasher.test.js`

- [ ] **Step 1: Write failing SHA-256 hasher tests**

Create `server/src/scanner/__tests__/hasher.test.js`:

```js
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { computeHash } = require('../hasher');

describe('computeHash', () => {
  test('returns sha256 digest and algorithm metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-hasher-'));
    try {
      const file = path.join(root, 'a.txt');
      await fs.writeFile(file, 'abc');
      const result = await computeHash(file);
      expect(result).toEqual({
        hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        hash_algo: 'sha256',
      });
    } finally {
      await fs.remove(root);
    }
  });
});
```

- [ ] **Step 2: Modify `hasher.js`**

Change `computeHash` to:

```js
function computeHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve({ hash: hash.digest('hex'), hash_algo: 'sha256' }));
  });
}
```

- [ ] **Step 3: Modify `enrich.js` for returned object**

Replace:

```js
const hash = await computeHash(filePath);
```

with:

```js
const hashResult = await computeHash(filePath);
const hash = hashResult.hash;
const hashAlgo = hashResult.hash_algo;
```

When selecting existing assets:

```js
const existingAsset = db.prepare('SELECT hash, status, hash_algo FROM assets WHERE hash = ?').get(hash);
```

When inserting/updating assets and files, set `hash_algo = ?` with `hashAlgo`.

For rows with legacy algorithm metadata, ensure they are reprocessed in all-mode by extending the pick condition:

```sql
OR COALESCE(hash_algo, 'md5') != 'sha256'
```

For missing-mode, keep existing legacy rows stable unless the file changed, so no surprise full-library rehash happens in routine scans.

- [ ] **Step 4: Ensure duplicate grouping does not mix algorithms**

In `duplicates.js`, include `f.hash_algo` in duplicate item selects and exact-hash grouping. Exact duplicate groups must group by `(f.hash, COALESCE(f.hash_algo, 'md5'), f.size)`, not only `f.hash`.

- [ ] **Step 5: Run hash tests and backend tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/scanner/__tests__/hasher.test.js src/services/__tests__/hashPolicy.test.js --runInBand
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/scanner/hasher.js server/src/jobs/handlers/enrich.js server/src/routes/duplicates.js server/src/scanner/__tests__/hasher.test.js
git commit -m "feat: use sha256 hashes with algorithm metadata"
```

---

### Task 8: Add End-To-End Route Coverage For Destructive Workflows

**Files:**
- Modify: `server/package.json`
- Create: `server/src/routes/__tests__/file-workflows.test.js`

- [ ] **Step 1: Add test dependency if needed**

If route tests use HTTP-level assertions, install `supertest`:

```bash
cd /Users/zcs/code2/tidy/server
npm install --save-dev supertest
```

- [ ] **Step 2: Export Express app for tests**

If `server/index.js` currently starts the listener directly, extract app creation to `server/src/app.js`:

```js
function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/assets', require('./routes/assets'));
  app.use('/api/organize', require('./routes/organize'));
  app.use('/api/duplicates', require('./routes/duplicates'));
  app.use('/api/jobs', require('./routes/jobs'));
  return app;
}

module.exports = { createApp };
```

Then make `server/index.js` call `createApp()` and `app.listen(...)`.

- [ ] **Step 3: Write route workflow tests**

Create `server/src/routes/__tests__/file-workflows.test.js` with these tests:

```js
test('PATCH /api/assets/:hash with trash moves a real file into trash immediately')
test('POST /api/assets/batch-status quarantines extra copies instead of deleting them permanently')
test('POST /api/organize keeps duplicate copies by default')
test('POST /api/organize quarantines duplicate copies only when duplicatePolicy is quarantine-extra')
test('POST /api/duplicates/apply never recursively removes a directory path from a corrupted files row')
```

Each test must assert physical disk state, `file_ops` state, `files` rows, and `assets.status`.

- [ ] **Step 4: Run route tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npx jest src/routes/__tests__/file-workflows.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run full backend tests**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/package.json server/package-lock.json server/index.js server/src/app.js server/src/routes/__tests__/file-workflows.test.js
git commit -m "test: cover destructive file workflows"
```

---

### Task 9: Update Product Documentation And Recovery Guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/决策记录.md`
- Modify: `docs/设计文档.md`
- Modify: `docs/用户指南.md`
- Modify: `docs/ROADMAP_TODOS.md`

- [ ] **Step 1: Update destructive operation language**

Replace statements that say duplicate remnants are "直接物理删除" with:

```md
相同内容的额外副本默认保留；当用户明确选择去重时，额外副本会移动到工具隔离区（默认 `TRASH_DIR/.quarantine`），而不是递归删除原路径。
```

- [ ] **Step 2: Update hash policy docs**

Document:

```md
新扫描内容使用 `sha256`，并在 `assets.hash_algo` / `files.hash_algo` 中记录算法。历史 MD5 数据保留为 `hash_algo='md5'`，全量 enrich 可逐步重算。任何会移除额外副本的去重动作必须同时满足 hash、hash_algo、size 一致；历史 MD5 行还会做字节级二次确认。
```

- [ ] **Step 3: Update recovery docs**

Document:

```md
`sync` 会重试 `pending` 以及未超过重试上限的 `error` file_ops。`delete` 仅用于历史操作兼容；新去重路径使用 `quarantine`。如果隔离区确认无误，用户可以在系统文件管理器中手动清空隔离区。
```

- [ ] **Step 4: Run doc consistency search**

Run:

```bash
cd /Users/zcs/code2/tidy
rg -n "直接物理删除|fs.remove|MD5|md5|pending file_ops|去重残骸" README.md docs server/src
```

Expected: remaining matches either describe legacy behavior, code identifiers, or the new migration behavior.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/决策记录.md docs/设计文档.md docs/用户指南.md docs/ROADMAP_TODOS.md
git commit -m "docs: describe safe dedupe and hash policy"
```

---

### Task 10: Final Verification

**Files:**
- Inspect: all modified files

- [ ] **Step 1: Confirm no unsafe recursive file-instance deletes remain**

Run:

```bash
cd /Users/zcs/code2/tidy
rg -n "fs\\.remove\\(" server/src
```

Expected: no matches in `server/src/routes/organize.js`, `server/src/routes/duplicates.js`, `server/src/routes/assets.js` for user file instances, and no match in `server/src/sync/index.js` for file instance delete replay. Matches for temp/cache cleanup such as poster temp files are allowed only when paths are under app-owned cache directories.

- [ ] **Step 2: Confirm all destructive workflows use FileOpService**

Run:

```bash
cd /Users/zcs/code2/tidy
rg -n "INSERT INTO file_ops|UPDATE file_ops SET status" server/src/routes server/src/sync
```

Expected: route and sync files do not hand-roll `file_ops` status transitions; `server/src/services/fileOps.js` owns them.

- [ ] **Step 3: Confirm hash algorithm metadata is used**

Run:

```bash
cd /Users/zcs/code2/tidy
rg -n "hash_algo|sha256|createHash" server/src
```

Expected: `server/src/scanner/hasher.js` uses `sha256`, schema/migrations include `hash_algo`, enrich writes it, duplicate grouping reads it, and hash policy tests cover it.

- [ ] **Step 4: Run complete test suite**

Run:

```bash
cd /Users/zcs/code2/tidy/server
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd /Users/zcs/code2/tidy/client
npm run build
```

Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Use a temporary scan root with three files:

```bash
mkdir -p /tmp/tidy-smoke/source /tmp/tidy-smoke/managed /tmp/tidy-smoke/trash
printf "same" > /tmp/tidy-smoke/source/a.jpg
cp /tmp/tidy-smoke/source/a.jpg /tmp/tidy-smoke/source/b.jpg
printf "different" > /tmp/tidy-smoke/source/c.jpg
```

In the UI:

1. Configure scan root `/tmp/tidy-smoke/source`.
2. Configure managed root `/tmp/tidy-smoke/managed`.
3. Configure trash dir `/tmp/tidy-smoke/trash`.
4. Scan and enrich.
5. Organize `a.jpg` without enabling duplicate quarantine.
6. Confirm `b.jpg` remains in source.
7. Organize with duplicate quarantine enabled.
8. Confirm extra same-content copy moved under `/tmp/tidy-smoke/trash/.quarantine`.
9. Delete the asset from details.
10. Confirm one kept file exists under `/tmp/tidy-smoke/trash` and no directory was recursively removed.

- [ ] **Step 7: Final commit**

```bash
git status --short
git add -A
git commit -m "chore: verify file safety hardening"
```

---

## Self-Review

**Spec coverage:**

- Safe deletion: Tasks 1, 3, 4, 5, 6, and 10 remove recursive `fs.remove` from user file instance paths and add regular-file validation.
- Single detail delete: Task 5 routes `PATCH /api/assets/:hash` trash through `trashAssetKeepOne`.
- Unified `file_ops`: Tasks 2, 3, and 4 centralize op lifecycle and retry pending plus retryable error rows.
- Hash assumptions: Tasks 2, 6, and 7 add algorithm metadata, SHA-256, size checks, and MD5 byte verification.
- Product semantics: Task 6 splits organize from physical dedupe and defaults to preserving extra copies.
- Verification: Tasks 8 and 10 add route coverage and final search/build/test gates.

**Placeholder scan:** This plan contains no `TBD`, no `TODO`, and no "implement later" steps. Every task names exact files, commands, expected results, and the concrete behavior to implement.

**Type consistency:** The planned service names are consistent across tasks: `fileSafety`, `fileOps`, `assetTrash`, and `hashPolicy`. The planned operation names are consistent: `move`, `trash`, `delete` for legacy compatibility, and `quarantine` for new duplicate removals.
