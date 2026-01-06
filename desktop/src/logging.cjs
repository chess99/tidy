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

function safeStatSize(p) {
  try {
    return fs.statSync(p).size || 0;
  } catch {
    return 0;
  }
}

function listFiles(dir) {
  try {
    return fs.readdirSync(dir).map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function enforceTotalCap({ dir, maxTotalBytes } = {}) {
  const cap = Number(maxTotalBytes);
  if (!Number.isFinite(cap) || cap <= 0) return;
  const files = listFiles(dir)
    .map((p) => {
      try {
        const st = fs.statSync(p);
        return st.isFile() ? { p, size: st.size || 0, mtimeMs: st.mtimeMs || 0 } : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0)); // oldest first

  let total = files.reduce((s, f) => s + (f.size || 0), 0);
  for (const f of files) {
    if (total <= cap) break;
    try {
      fs.rmSync(f.p, { force: true });
      total -= f.size || 0;
    } catch {
      // ignore
    }
  }
}

function initLogs({
  userDataRoot,
  appName = 'tidy-desktop',
  maxBytesPerFile = 20 * 1024 * 1024,
  maxFilesPerLog = 5,
  maxTotalBytes = 200 * 1024 * 1024,
} = {}) {
  const logsDir = path.join(String(userDataRoot || ''), 'logs');
  ensureDir(logsDir);

  // Marker file for support.
  try {
    fs.writeFileSync(path.join(logsDir, 'README.txt'), `Logs for ${appName}\n`, 'utf8');
  } catch {
    // ignore
  }

  enforceTotalCap({ dir: logsDir, maxTotalBytes });
  return {
    logsDir,
    policy: {
      maxBytesPerFile: clampInt(maxBytesPerFile, 1 * 1024 * 1024, 500 * 1024 * 1024),
      maxFilesPerLog: clampInt(maxFilesPerLog, 1, 50),
      maxTotalBytes: clampInt(maxTotalBytes, 10 * 1024 * 1024, 5 * 1024 * 1024 * 1024),
    },
  };
}

function rotateFiles({ basePath, maxFiles } = {}) {
  const keep = clampInt(maxFiles, 1, 50);
  // Shift: .(keep-1) -> .keep, ... .1 -> .2, base -> .1
  for (let i = keep - 1; i >= 1; i -= 1) {
    const src = `${basePath}.${i}`;
    const dst = `${basePath}.${i + 1}`;
    try {
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    } catch {
      // ignore
    }
  }
  try {
    if (fs.existsSync(basePath)) fs.renameSync(basePath, `${basePath}.1`);
  } catch {
    // ignore
  }
  // Drop tail (keep+1)
  try {
    fs.rmSync(`${basePath}.${keep + 1}`, { force: true });
  } catch {
    // ignore
  }
}

function createRotatingLogger({
  dir,
  name,
  maxBytesPerFile = 20 * 1024 * 1024,
  maxFilesPerLog = 5,
  maxTotalBytes = 200 * 1024 * 1024,
} = {}) {
  const logsDir = path.resolve(String(dir || ''));
  const baseName = String(name || 'log').trim() || 'log';
  const basePath = path.join(logsDir, `${baseName}.log`);
  ensureDir(logsDir);

  const maxBytes = clampInt(maxBytesPerFile, 1 * 1024 * 1024, 500 * 1024 * 1024);
  const maxFiles = clampInt(maxFilesPerLog, 1, 50);
  const maxTotal = clampInt(maxTotalBytes, 10 * 1024 * 1024, 5 * 1024 * 1024 * 1024);

  let stream = fs.createWriteStream(basePath, { flags: 'a' });
  let chain = Promise.resolve();

  async function _write(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    // Rotate before writing if the next write would exceed the cap (best-effort).
    try {
      const cur = safeStatSize(basePath);
      if (cur + b.length > maxBytes) {
        try {
          stream.end();
        } catch {
          // ignore
        }
        rotateFiles({ basePath, maxFiles });
        stream = fs.createWriteStream(basePath, { flags: 'a' });
      }
    } catch {
      // ignore
    }

    await new Promise((resolve) => stream.write(b, resolve));
    enforceTotalCap({ dir: logsDir, maxTotalBytes: maxTotal });
  }

  return {
    path: basePath,
    write(buf) {
      chain = chain.then(() => _write(buf)).catch(() => {});
    },
    close() {
      try {
        stream.end();
      } catch {
        // ignore
      }
    },
  };
}

module.exports = { initLogs, createRotatingLogger };


