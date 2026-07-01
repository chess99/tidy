const chokidar = require('chokidar');
const path = require('path');
const { getConfig } = require('../configStore');
const { createJob, createQueuedJobIfNoActiveJob } = require('../jobs/store');
const { decideWatcherRoots, getWatcherMode } = require('./policy');

const DEBOUNCE_MS = 3000;
const DEFAULT_FALLBACK_INTERVAL_MS = 60 * 60 * 1000;
const MIN_FALLBACK_INTERVAL_MS = 60 * 1000;

let watcher = null;
let debounceTimer = null;
let fallbackTimer = null;
let pendingChanges = 0;
let lastLogTime = 0;

let watcherStatus = {
  mode: 'auto',
  state: 'idle',
  roots: [],
  activeRoots: [],
  fallbackIntervalMs: null,
  lastError: null,
  updatedAt: Date.now(),
};

function setStatus(patch) {
  watcherStatus = {
    ...watcherStatus,
    ...patch,
    updatedAt: Date.now(),
  };
}

function getWatcherStatus() {
  return {
    ...watcherStatus,
    roots: watcherStatus.roots.map((root) => ({ ...root })),
    activeRoots: [...watcherStatus.activeRoots],
  };
}

function fallbackIntervalMs() {
  const raw = Number(process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_FALLBACK_INTERVAL_MS;
  return Math.max(MIN_FALLBACK_INTERVAL_MS, Math.trunc(raw));
}

function shouldIgnore(filePath) {
  const basename = path.basename(filePath);
  if (basename.startsWith('.')) return true;
  if (basename.startsWith('~')) return true;
  if (basename.endsWith('.tmp')) return true;
  if (basename.endsWith('.temp')) return true;
  if (basename === 'Thumbs.db') return true;
  if (basename === '.DS_Store') return true;
  if (basename.endsWith('.part')) return true;
  return false;
}

function triggerDiscover() {
  try {
    const job = createJob({ type: 'discover', mode: 'missing' });
    console.log('[watcher] Auto-triggered discover job:', job.id);
  } catch (err) {
    console.error('[watcher] Failed to create discover job:', err);
  }
}

function triggerFallbackDiscover() {
  try {
    const job = createQueuedJobIfNoActiveJob({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
    if (job) {
      console.log('[watcher] Fallback discover job:', job.id);
    }
  } catch (err) {
    console.error('[watcher] Failed to create fallback discover job:', err);
  }
}

function onFileChange(eventType, filePath) {
  if (shouldIgnore(filePath)) return;

  pendingChanges++;

  const now = Date.now();
  if (now - lastLogTime > 5000) {
    console.log(`[watcher] ${pendingChanges} file(s) changed, will scan soon...`);
    lastLogTime = now;
    pendingChanges = 0;
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    if (pendingChanges > 0) {
      console.log(`[watcher] Detected ${pendingChanges} change(s), triggering scan...`);
      pendingChanges = 0;
    }
    triggerDiscover();
  }, DEBOUNCE_MS);
}

async function getEnabledScanRoots() {
  const cfg = await getConfig();
  return (cfg.scanRoots || [])
    .filter((r) => r.enabled !== false && r.root)
    .map((r) => r.root);
}

function stopFallbackScheduler() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

function startFallbackScheduler() {
  stopFallbackScheduler();
  const intervalMs = fallbackIntervalMs();
  fallbackTimer = setInterval(triggerFallbackDiscover, intervalMs);
  if (typeof fallbackTimer.unref === 'function') fallbackTimer.unref();
  setStatus({ fallbackIntervalMs: intervalMs });
  console.log(`[watcher] Using fallback discover every ${Math.round(intervalMs / 1000)}s`);
}

function closeWatcherOnly() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[watcher] Stopped');
  }
}

function clearDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

function downgradeToFallback(error) {
  const message = String(error?.message || error || 'watcher_error');
  console.error('[watcher] Error, switching to fallback discover:', message);
  closeWatcherOnly();
  setStatus({
    state: 'fallback',
    activeRoots: [],
    lastError: message,
  });
  startFallbackScheduler();
}

async function startWatcher() {
  const mode = getWatcherMode();

  if (mode === 'off') {
    closeWatcherOnly();
    stopFallbackScheduler();
    clearDebounce();
    console.log('[watcher] Disabled by watcher mode');
    setStatus({
      mode,
      state: 'disabled',
      roots: [],
      activeRoots: [],
      fallbackIntervalMs: null,
      lastError: null,
    });
    return;
  }

  if (watcher || fallbackTimer) {
    console.log('[watcher] Already running, stopping first...');
    stopWatcher();
  }

  const roots = await getEnabledScanRoots();
  if (roots.length === 0) {
    console.log('[watcher] No enabled scan roots, skipping file watcher');
    setStatus({
      mode,
      state: 'idle',
      roots: [],
      activeRoots: [],
      fallbackIntervalMs: null,
      lastError: null,
    });
    return;
  }

  const plan = decideWatcherRoots(roots, { mode });
  setStatus({
    mode: plan.mode,
    state: plan.watchRoots.length > 0 ? 'starting' : 'fallback',
    roots: plan.decisions,
    activeRoots: plan.watchRoots,
    fallbackIntervalMs: null,
    lastError: null,
  });

  if (plan.watchRoots.length === 0) {
    console.log('[watcher] No watchable roots in current policy; using fallback discover');
    startFallbackScheduler();
    setStatus({ state: 'fallback' });
    return;
  }

  if (plan.skippedRoots.length > 0) {
    startFallbackScheduler();
  }

  console.log('[watcher] Starting file watcher for roots:', plan.watchRoots);

  watcher = chokidar.watch(plan.watchRoots, {
    ignored: [
      /(^|[\/\\])\../,
      '**/node_modules/**',
      '**/.git/**',
      '**/Thumbs.db',
      '**/.DS_Store',
      '**/*.tmp',
      '**/*.temp',
      '**/*.part',
    ],
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', (filePath) => onFileChange('add', filePath))
    .on('change', (filePath) => onFileChange('change', filePath))
    .on('unlink', (filePath) => onFileChange('unlink', filePath))
    .on('addDir', (dirPath) => onFileChange('addDir', dirPath))
    .on('unlinkDir', (dirPath) => onFileChange('unlinkDir', dirPath))
    .on('error', (error) => {
      if (mode === 'auto') {
        downgradeToFallback(error);
        return;
      }
      const message = String(error?.message || error || 'watcher_error');
      setStatus({ state: 'error', lastError: message });
      console.error('[watcher] Error:', error);
    })
    .on('ready', () => {
      setStatus({ state: 'watching' });
      console.log('[watcher] Ready, watching', plan.watchRoots.length, 'root(s)');
    });

  setStatus({ state: 'watching' });
}

function stopWatcher() {
  closeWatcherOnly();
  stopFallbackScheduler();
  clearDebounce();
  setStatus({
    state: 'stopped',
    activeRoots: [],
    fallbackIntervalMs: null,
  });
}

async function restartWatcher() {
  console.log('[watcher] Restarting...');
  await startWatcher();
}

module.exports = {
  startWatcher,
  stopWatcher,
  restartWatcher,
  getWatcherStatus,
};
