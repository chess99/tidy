const path = require('path');
const fs = require('fs-extra');
const { DATA_DIR, WORK_ROOT, MANAGED_ROOT, TRASH_DIR } = require('./config');

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function abs(p) {
  if (!p) return null;
  try {
    return path.resolve(String(p));
  } catch {
    return String(p);
  }
}

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent, child) {
  try {
    const p = stripTrailingSep(abs(parent));
    const c = stripTrailingSep(abs(child));
    if (!p || !c) return false;
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

function validateScanRoot(root) {
  const r = stripTrailingSep(abs(root));
  if (!r) {
    const e = new Error('root is required');
    e.statusCode = 400;
    throw e;
  }
  if (!path.isAbsolute(r)) {
    const e = new Error('root must be an absolute path');
    e.statusCode = 400;
    throw e;
  }
  // Prevent scanning tool-managed directories.
  if (isUnder(MANAGED_ROOT, r) || isUnder(TRASH_DIR, r)) {
    const e = new Error('root must not be under MANAGED_ROOT/TRASH_DIR');
    e.statusCode = 400;
    throw e;
  }
  return r;
}

function normalizeRoots(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw) continue;
    let r;
    try {
      r = validateScanRoot(raw);
    } catch {
      continue;
    }
    const key = process.platform === 'win32' ? r.toLowerCase() : r;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function loadConfig() {
  try {
    const exists = await fs.pathExists(CONFIG_FILE);
    if (!exists) {
      return { scanRoots: [], activeScanRoot: null };
    }
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const json = JSON.parse(raw);
    const scanRoots = normalizeRoots(json?.scanRoots);
    let active = json?.activeScanRoot ? stripTrailingSep(abs(json.activeScanRoot)) : null;
    if (active) {
      // Ensure active is valid and present in the list.
      try {
        active = validateScanRoot(active);
      } catch {
        active = null;
      }
      const key = process.platform === 'win32' ? active.toLowerCase() : active;
      const has = scanRoots.some((r) => (process.platform === 'win32' ? r.toLowerCase() : r) === key);
      if (!has) active = null;
    }
    return { scanRoots, activeScanRoot: active };
  } catch {
    return { scanRoots: [], activeScanRoot: null };
  }
}

async function saveConfig(next) {
  const scanRoots = normalizeRoots(next?.scanRoots);
  let active = next?.activeScanRoot ? stripTrailingSep(abs(next.activeScanRoot)) : null;
  if (active) {
    active = validateScanRoot(active);
    const key = process.platform === 'win32' ? active.toLowerCase() : active;
    const has = scanRoots.some((r) => (process.platform === 'win32' ? r.toLowerCase() : r) === key);
    if (!has) scanRoots.unshift(active);
  }

  await fs.ensureDir(path.dirname(CONFIG_FILE));
  const tmp = CONFIG_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({ scanRoots, activeScanRoot: active }, null, 2), 'utf8');
  await fs.move(tmp, CONFIG_FILE, { overwrite: true });
  return { scanRoots, activeScanRoot: active };
}

async function addScanRoot(root, { setActive = false } = {}) {
  const r = validateScanRoot(root);
  const cfg = await loadConfig();
  const list = normalizeRoots([...(cfg.scanRoots || []), r]);
  const next = {
    scanRoots: list,
    activeScanRoot: setActive ? r : (cfg.activeScanRoot || null),
  };
  return await saveConfig(next);
}

async function setActiveScanRoot(root) {
  const r = validateScanRoot(root);
  const cfg = await loadConfig();
  const list = normalizeRoots([...(cfg.scanRoots || []), r]);
  return await saveConfig({ scanRoots: list, activeScanRoot: r });
}

function getEffectiveScanRoot(cfg) {
  return cfg?.activeScanRoot || WORK_ROOT;
}

module.exports = {
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  addScanRoot,
  setActiveScanRoot,
  getEffectiveScanRoot,
  validateScanRoot,
};


