/**
 * input: 环境变量/配置 + DB
 * output: 服务端模块导出
 * pos: 服务端核心模块：被 server 入口与路由/任务依赖（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./config');

const DEFAULT_MANAGED_ROOT = path.join(os.homedir(), 'Pictures', 'Tidy');
const DEFAULT_TRASH_DIR = path.join(DATA_DIR, 'trash');

// Demo-stage “optimal design”: single schema, no legacy compatibility.
// server/data/config.json:
// {
//   scanRoots: [{ root: string, enabled: boolean }],
//   scanType: { exts: string[], includeNoExt: boolean },
//   scan: { excludeGlobs: string[], minFileSizeBytes: number },
//   tasks: { concurrency: { enrich?: number, faces?: number, thumbs?: number, clip?: number }, autoTrigger: { afterDiscover: string[] } }
//   workspace: { managedRoot: string, trashDir: string }  // user-configurable via UI
// }

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// No default scan root; user adds roots explicitly.
const DEFAULT_SCAN_ROOTS = [];
const DEFAULT_SCAN_EXTS = [
  // images
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'tif', 'tiff',
  // raw-ish
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'rw2', 'orf', 'sr2', 'pef',
  // videos
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp',
];
// ts, mts, m2ts are NOT included by default to avoid scanning codebases as videos.

const DEFAULT_CONFIG = {
  scanRoots: DEFAULT_SCAN_ROOTS,
  scanType: { exts: DEFAULT_SCAN_EXTS, includeNoExt: false },
  scan: {
    excludeGlobs: [
      '**/.git/**',
      '**/node_modules/**',
      '**/.DS_Store',
      '**/.stversions/**',
      '**/.stfolder/**',
      '**/#recycle/**',
      '**/#snapshot/**',
      '**/@eaDir/**',
      '**/.@__thumb/**',
    ],
    minFileSizeBytes: 0,
  },
  tasks: {
    concurrency: {
      enrich: 4,
      faces: 1,
      thumbs: 4,
      clip: 1,
    },
    autoTrigger: {
      afterDiscover: ['enrich'],
    },
  },
  workspace: {
    managedRoot: DEFAULT_MANAGED_ROOT,
    trashDir: DEFAULT_TRASH_DIR,
  },
};

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

function validateRootOrThrow(root) {
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
  return r;
}

function normalizeWorkspacePath(raw, defaultVal) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return defaultVal;
  try {
    const r = stripTrailingSep(abs(s));
    if (!r || !path.isAbsolute(r)) return defaultVal;
    return r;
  } catch {
    return defaultVal;
  }
}

function normalizeWorkspace(workspace) {
  const w = workspace && typeof workspace === 'object' ? workspace : {};
  return {
    managedRoot: normalizeWorkspacePath(w.managedRoot, DEFAULT_MANAGED_ROOT),
    trashDir: normalizeWorkspacePath(w.trashDir, DEFAULT_TRASH_DIR),
  };
}

function normalizeExt(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (s === '.') return null;
  if (s.startsWith('.')) s = s.slice(1);
  if (!s) return null;
  // allow things like 3gp
  if (!/^[a-z0-9]{1,12}$/.test(s)) return null;
  return s;
}

function normalizeScanType(scanType) {
  const extsRaw = Array.isArray(scanType?.exts) ? scanType.exts : [];
  const includeNoExt = !!scanType?.includeNoExt;
  const set = new Set();
  for (const r of extsRaw) {
    const e = normalizeExt(r);
    if (e) set.add(e);
  }
  const exts = Array.from(set);
  if (!exts.length && !includeNoExt) {
    const e = new Error('scanType must include at least one ext or includeNoExt=true');
    e.statusCode = 400;
    throw e;
  }
  return { exts, includeNoExt };
}

function dedupeRoots(items) {
  const out = [];
  const seen = new Set();
  for (const it of Array.isArray(items) ? items : []) {
    if (!it) continue;
    const root = validateRootOrThrow(it.root);
    const enabled = !!it.enabled;
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ root, enabled });
  }
  return out;
}

function normalizeStringList(list, { maxItems = 200, maxLen = 300 } = {}) {
  const raw = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const it of raw) {
    const s = String(it ?? '').trim();
    if (!s) continue;
    if (s.length > maxLen) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeScanOptions(scan) {
  const excludeGlobs = normalizeStringList(scan?.excludeGlobs, { maxItems: 200, maxLen: 300 });
  const minRaw = scan?.minFileSizeBytes ?? 0;
  const minN = Number(minRaw);
  const minFileSizeBytes = Number.isFinite(minN) && minN >= 0 ? Math.trunc(minN) : 0;
  return { excludeGlobs, minFileSizeBytes };
}

function normalizeConcurrency(concurrency) {
  const c = concurrency || {};
  const pick = (k, fallback) => {
    const n = Number(c?.[k]);
    if (!Number.isFinite(n)) return fallback;
    const i = Math.trunc(n);
    if (i < 1) return 1;
    if (i > 64) return 64;
    return i;
  };
  return {
    enrich: pick('enrich', DEFAULT_CONFIG.tasks.concurrency.enrich),
    faces: pick('faces', DEFAULT_CONFIG.tasks.concurrency.faces),
    thumbs: pick('thumbs', DEFAULT_CONFIG.tasks.concurrency.thumbs),
    clip: pick('clip', DEFAULT_CONFIG.tasks.concurrency.clip),
  };
}

function normalizeAutoTrigger(autoTrigger) {
  return {
    afterDiscover: normalizeStringList(autoTrigger?.afterDiscover, { maxItems: 20, maxLen: 40 }),
  };
}

function normalizeTasks(tasks) {
  return {
    concurrency: normalizeConcurrency(tasks?.concurrency),
    autoTrigger: normalizeAutoTrigger(tasks?.autoTrigger),
  };
}

async function loadConfig() {
  try {
    const exists = await fs.pathExists(CONFIG_FILE);
    if (!exists) {
      // initialize
      await saveConfig(DEFAULT_CONFIG);
      return { ...DEFAULT_CONFIG };
    }
    const raw = await fs.readFile(CONFIG_FILE, 'utf8');
    const json = JSON.parse(raw);
    // No legacy compat: validate strictly. If invalid, reset to defaults (demo-stage safety).
    const scanRoots = dedupeRoots(json?.scanRoots);
    const scanType = normalizeScanType(json?.scanType);
    const scan = normalizeScanOptions(json?.scan || DEFAULT_CONFIG.scan);
    const tasks = normalizeTasks(json?.tasks || DEFAULT_CONFIG.tasks);
    const workspace = normalizeWorkspace(json?.workspace);
    const normalized = { scanRoots, scanType, scan, tasks, workspace };

    // One-time auto-fix: when schema evolves (e.g. removing non-configurable concurrency keys),
    // persist the normalized config to strip unknown fields.
    try {
      const nextRaw = JSON.stringify(normalized, null, 2);
      if (String(raw || '').trim() !== String(nextRaw || '').trim()) {
        await saveConfig(normalized);
      }
    } catch {
      // ignore auto-fix errors; returning normalized config is still correct.
    }

    return normalized;
  } catch {
    await saveConfig(DEFAULT_CONFIG);
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(cfg) {
  const scanRoots = dedupeRoots(cfg?.scanRoots);
  const scanType = normalizeScanType(cfg?.scanType);
  const scan = normalizeScanOptions(cfg?.scan || DEFAULT_CONFIG.scan);
  const tasks = normalizeTasks(cfg?.tasks || DEFAULT_CONFIG.tasks);
  const workspace = normalizeWorkspace(cfg?.workspace);
  await fs.ensureDir(path.dirname(CONFIG_FILE));
  const tmp = CONFIG_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({ scanRoots, scanType, scan, tasks, workspace }, null, 2), 'utf8');
  await fs.move(tmp, CONFIG_FILE, { overwrite: true });
  return { scanRoots, scanType, scan, tasks, workspace };
}

async function setScanRoots(scanRoots) {
  const cfg = await loadConfig();
  return await saveConfig({ ...cfg, scanRoots });
}

async function addScanRoot(root) {
  const r = validateRootOrThrow(root);
  const cfg = await loadConfig();
  const next = {
    ...cfg,
    scanRoots: dedupeRoots([...cfg.scanRoots, { root: r, enabled: true }]),
  };
  return await saveConfig(next);
}

async function setScanRootEnabled(root, enabled) {
  const r = validateRootOrThrow(root);
  const cfg = await loadConfig();
  const key = process.platform === 'win32' ? r.toLowerCase() : r;
  const nextList = cfg.scanRoots.map((it) => {
    const k = process.platform === 'win32' ? it.root.toLowerCase() : it.root;
    if (k === key) return { ...it, enabled: !!enabled };
    return it;
  });
  // If not found, treat as error.
  const found = nextList.some((it) => (process.platform === 'win32' ? it.root.toLowerCase() : it.root) === key);
  if (!found) {
    const e = new Error('root not found');
    e.statusCode = 404;
    throw e;
  }
  return await saveConfig({ ...cfg, scanRoots: nextList });
}

async function removeScanRoot(root) {
  const r = validateRootOrThrow(root);
  const cfg = await loadConfig();
  const key = process.platform === 'win32' ? r.toLowerCase() : r;
  const nextList = cfg.scanRoots.filter((it) => {
    const k = process.platform === 'win32' ? it.root.toLowerCase() : it.root;
    return k !== key;
  });
  return await saveConfig({ ...cfg, scanRoots: nextList });
}

async function setScanType(scanType) {
  const cfg = await loadConfig();
  const st = normalizeScanType(scanType);
  return await saveConfig({ ...cfg, scanType: st });
}

async function setScanOptions(scan) {
  const cfg = await loadConfig();
  const next = normalizeScanOptions(scan);
  return await saveConfig({ ...cfg, scan: next });
}

async function setTaskSettings(tasks) {
  const cfg = await loadConfig();
  const next = normalizeTasks(tasks);
  return await saveConfig({ ...cfg, tasks: next });
}

async function setWorkspacePaths({ managedRoot, trashDir } = {}) {
  const cfg = await loadConfig();
  const prev = cfg.workspace || normalizeWorkspace();
  const next = {
    managedRoot: managedRoot !== undefined ? (managedRoot === '' ? DEFAULT_MANAGED_ROOT : validateRootOrThrow(managedRoot)) : prev.managedRoot,
    trashDir: trashDir !== undefined ? (trashDir === '' ? DEFAULT_TRASH_DIR : validateRootOrThrow(trashDir)) : prev.trashDir,
  };
  return await saveConfig({ ...cfg, workspace: next });
}

function getEnabledRoots(cfg) {
  const list = Array.isArray(cfg?.scanRoots) ? cfg.scanRoots : [];
  return list.filter((r) => r && r.enabled).map((r) => r.root);
}

module.exports = {
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  setScanRoots,
  addScanRoot,
  setScanRootEnabled,
  removeScanRoot,
  setScanType,
  setScanOptions,
  setTaskSettings,
  setWorkspacePaths,
  getEnabledRoots,
  validateRootOrThrow,
  normalizeExt,
};


