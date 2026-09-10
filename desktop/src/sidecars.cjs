/**
 * input: 本地 node/python 可执行文件 + 仓库路径/环境变量 + 端口/数据目录
 * output: 拉起/关闭后端 server 与 ai-service 子进程（返回 child_process 句柄）
 * pos: 桌面进程编排层：被 `main.cjs` 调用（变更需同步更新本头注释与所属目录 README）
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { createRotatingLogger } = require('./logging.cjs');

function exists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveRepoRoot() {
  // In dev: `desktop/src/*` -> repo root is `../..`
  // In packaged app, we expect to ship server/client as resources and override with env.
  const env = process.env.TIDY_REPO_ROOT ? path.resolve(String(process.env.TIDY_REPO_ROOT)) : null;
  if (env) return env;
  return path.resolve(__dirname, '..', '..');
}

function resolvePython(aiServiceDir) {
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? path.join(aiServiceDir, '.venv', 'Scripts', 'python.exe')
    : path.join(aiServiceDir, '.venv', 'bin', 'python');
  if (exists(venvPython)) return venvPython;
  return process.env.PYTHON || (isWindows ? 'python' : 'python3');
}

function resolveNodeBin({ repoRoot, isPackaged = false } = {}) {
  const configured = String(process.env.TIDY_NODE_BIN || '').trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!exists(resolved)) throw new Error(`TIDY_NODE_BIN does not exist: ${resolved}`);
    return resolved;
  }

  const isWindows = process.platform === 'win32';
  const bundled = path.join(repoRoot, 'node', isWindows ? 'node.exe' : 'node');
  if (exists(bundled)) return bundled;
  if (isPackaged) throw new Error(`Packaged Node runtime is missing: ${bundled}`);
  return String(process.env.NODE || 'node');
}

function spawnLogged(cmd, args, opts) {
  const p = spawn(cmd, args, {
    ...opts,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    detached: false,
  });
  const label = opts?.label || path.basename(cmd);
  const logDir = process.env.TIDY_LOG_DIR ? path.resolve(String(process.env.TIDY_LOG_DIR)) : null;
  const out = logDir ? createRotatingLogger({ dir: logDir, name: label }) : null;
  p.stdout?.on('data', (d) => process.stdout.write(`[${label}] ${String(d)}`));
  p.stderr?.on('data', (d) => process.stderr.write(`[${label}] ${String(d)}`));
  if (out) {
    p.stdout?.on('data', (d) => out.write(d));
    p.stderr?.on('data', (d) => out.write(d));
    p.once('exit', (code, signal) => {
      out.write(`\n[exit] code=${code} signal=${signal}\n`);
      out.close();
    });
  }
  return p;
}

function startServer({
  port,
  dataDir,
  uiDir,
  repoRoot = resolveRepoRoot(),
  clipModelId,
  isPackaged = false,
} = {}) {
  const serverDir = path.join(repoRoot, 'server');
  const entry = path.join(serverDir, 'index.js');
  if (!exists(entry)) throw new Error(`Server entrypoint is missing: ${entry}`);
  const nodeBin = resolveNodeBin({ repoRoot, isPackaged });
  const env = {
    ...process.env,
    PORT: String(port),
    ...(dataDir ? { DATA_DIR: String(dataDir) } : {}),
    ...(uiDir ? { TIDY_UI_DIR: String(uiDir) } : {}),
    ...(clipModelId ? { TIDY_CLIP_MODEL_ID: String(clipModelId) } : {}),
    // Make the server explicitly talk to local ai-service.
    AI_SERVICE_URL: `http://127.0.0.1:${process.env.TIDY_AI_PORT || 8002}`,
  };
  return spawnLogged(nodeBin, [entry], { cwd: serverDir, env, label: 'server' });
}

function startAiService({
  port = 8002,
  repoRoot = resolveRepoRoot(),
  clipModelId,
  clipConcurrency,
  isPackaged = false,
} = {}) {
  const aiDir = path.join(repoRoot, 'ai-service');
  const env = {
    ...process.env,
    // PyInstaller's Python readline extension can crash under macOS GUI
    // launch environments that provide an invalid LC_* value such as "UTF-8".
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
    LC_CTYPE: 'en_US.UTF-8',
    ...(clipModelId ? { TIDY_CLIP_MODEL_ID: String(clipModelId) } : {}),
    ...(clipConcurrency ? { TIDY_CLIP_CONCURRENCY: String(clipConcurrency) } : {}),
    TIDY_AI_PORT: String(port),
  };

  const isWindows = process.platform === 'win32';
  const configuredBin = String(process.env.TIDY_AI_BIN || '').trim();
  const binFromEnv = configuredBin ? path.resolve(configuredBin) : null;
  if (binFromEnv && !exists(binFromEnv)) throw new Error(`TIDY_AI_BIN does not exist: ${binFromEnv}`);
  const defaultBin = path.join(aiDir, 'dist', 'tidy-ai-service', isWindows ? 'tidy-ai-service.exe' : 'tidy-ai-service');
  const aiBin = (binFromEnv && exists(binFromEnv) ? binFromEnv : null) || (exists(defaultBin) ? defaultBin : null);

  if (aiBin) {
    return spawnLogged(aiBin, ['--host', '127.0.0.1', '--port', String(port)], { cwd: path.dirname(aiBin), env, label: 'ai' });
  }

  if (isPackaged) throw new Error(`Packaged AI service is missing: ${defaultBin}`);

  // Development explicitly uses the project Python environment when no built sidecar exists.
  const python = resolvePython(aiDir);
  return spawnLogged(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)], { cwd: aiDir, env, label: 'ai' });
}

function stopProcess(proc, { timeoutMs = 2500 } = {}) {
  return new Promise((resolve) => {
    if (!proc) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    proc.once('exit', finish);
    try {
      proc.kill('SIGTERM');
    } catch {
      finish();
      return;
    }
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      finish();
    }, timeoutMs);
  });
}

module.exports = { resolveRepoRoot, resolveNodeBin, startServer, startAiService, stopProcess };
