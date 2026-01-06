/**
 * input: Electron userData 路径 + 文件系统（fs）
 * output: 创建/清理日志目录，并提供写入工具（用于 desktop/server/ai 日志落盘）
 * pos: 桌面主进程工具：被 `main.cjs`/`sidecars.cjs` 使用（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function initLogs({ userDataRoot, appName = 'tidy-desktop' } = {}) {
  const root = path.join(String(userDataRoot || ''), 'logs');
  const latest = path.join(root, 'latest');
  ensureDir(root);
  rmrf(latest);
  ensureDir(latest);

  // Write a tiny marker file for support.
  try {
    fs.writeFileSync(path.join(latest, 'README.txt'), `Logs for ${appName}\n`, 'utf8');
  } catch {
    // ignore
  }

  return { logsRoot: root, latestDir: latest };
}

function openLogStream({ dir, name } = {}) {
  const p = path.join(String(dir || ''), `${String(name || 'log')}.log`);
  ensureDir(path.dirname(p));
  return fs.createWriteStream(p, { flags: 'a' });
}

module.exports = { initLogs, openLogStream };


