/**
 * input: scanRoots 配置 + 文件系统事件
 * output: 自动触发 discover 任务
 * pos: 文件系统监控模块：监听配置的扫描目录，文件变化时自动触发扫描（变更需同步更新本头注释与所属目录 README）
 */

const chokidar = require('chokidar');
const path = require('path');
const { getConfig } = require('../configStore');
const { createJob } = require('../jobs/store');

let watcher = null;
let debounceTimer = null;
const DEBOUNCE_MS = 3000; // 3秒防抖

function shouldIgnore(filePath) {
  const basename = path.basename(filePath);
  // 忽略常见临时文件和隐藏文件
  if (basename.startsWith('.')) return true;
  if (basename.startsWith('~')) return true;
  if (basename.endsWith('.tmp')) return true;
  if (basename.endsWith('.temp')) return true;
  if (basename === 'Thumbs.db') return true;
  if (basename === '.DS_Store') return true;
  if (basename.endsWith('.part')) return true; // 下载中文件
  return false;
}

function triggerDiscover() {
  try {
    // 创建 discover missing 任务（仅扫描新文件）
    const job = createJob({ type: 'discover', mode: 'missing' });
    console.log('[watcher] Auto-triggered discover job:', job.id);
  } catch (err) {
    console.error('[watcher] Failed to create discover job:', err);
  }
}

let pendingChanges = 0;
let lastLogTime = 0;

function onFileChange(eventType, filePath) {
  if (shouldIgnore(filePath)) return;

  pendingChanges++;

  // 限制日志频率，每5秒最多打印一次
  const now = Date.now();
  if (now - lastLogTime > 5000) {
    console.log(`[watcher] ${pendingChanges} file(s) changed, will scan soon...`);
    lastLogTime = now;
    pendingChanges = 0;
  }

  // 防抖处理
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
    .filter(r => r.enabled !== false && r.root)
    .map(r => r.root);
}

async function startWatcher() {
  if (process.env.TIDY_DISABLE_WATCHER === '1') {
    console.log('[watcher] Disabled by TIDY_DISABLE_WATCHER=1');
    return;
  }

  if (watcher) {
    console.log('[watcher] Already running, stopping first...');
    stopWatcher();
  }

  const roots = await getEnabledScanRoots();
  if (roots.length === 0) {
    console.log('[watcher] No enabled scan roots, skipping file watcher');
    return;
  }

  console.log('[watcher] Starting file watcher for roots:', roots);

  watcher = chokidar.watch(roots, {
    ignored: [
      /(^|[\/\\])\../, // 隐藏文件
      '**/node_modules/**',
      '**/.git/**',
      '**/Thumbs.db',
      '**/.DS_Store',
      '**/*.tmp',
      '**/*.temp',
      '**/*.part',
    ],
    persistent: true,
    ignoreInitial: true, // 启动时不触发历史事件
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
    .on('error', (error) => console.error('[watcher] Error:', error))
    .on('ready', () => console.log('[watcher] Ready, watching', roots.length, 'root(s)'));
}

function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[watcher] Stopped');
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

async function restartWatcher() {
  console.log('[watcher] Restarting...');
  await startWatcher();
}

module.exports = {
  startWatcher,
  stopWatcher,
  restartWatcher,
};
