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
