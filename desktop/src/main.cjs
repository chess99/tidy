/**
 * input: Electron app 生命周期 + 本机 userData 目录 + 子进程（server/ai-service）
 * output: 桌面窗口（加载本地 UI）+ 后端/AI 子进程的启动与退出清理
 * pos: 桌面应用入口：分发形态的最上层入口（变更需同步更新本头注释与所属目录 README）
 */

const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');

const { pickPort } = require('./ports.cjs');
const { resolveRepoRoot, startServer, startAiService, stopProcess } = require('./sidecars.cjs');
const { checkForUpdatesHinted } = require('./update.cjs');

let win = null;
let serverProc = null;
let aiProc = null;

function isDev() {
  return String(process.env.NODE_ENV || '').trim() === 'development' || !!process.env.TIDY_DEV;
}

async function initUserDataLayout() {
  const root = app.getPath('userData');
  const dataDir = path.join(root, 'data');
  await fs.ensureDir(dataDir);
  return { userDataRoot: root, dataDir };
}

async function bestEffortMigrateRepoData({ repoRoot, dataDir }) {
  // Dev convenience: if repo has `data/` and userData is empty, copy it once.
  try {
    const repoData = path.join(repoRoot, 'data');
    const srcDb = path.join(repoData, 'tidy.db');
    const dstDb = path.join(dataDir, 'tidy.db');
    const dstExists = await fs.pathExists(dstDb);
    const srcExists = await fs.pathExists(srcDb);
    if (dstExists || !srcExists) return { migrated: false };
    await fs.copy(repoData, dataDir, { overwrite: false, errorOnExist: false });
    return { migrated: true };
  } catch {
    return { migrated: false };
  }
}

function bootHtml({ serverPort } = {}) {
  const msg = `Starting Tidy...\n\nBackend: http://127.0.0.1:${serverPort}\n`;
  const esc = (s) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tidy</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0b0b0f; color: #e6e6ef; font-family: ui-sans-serif, system-ui, -apple-system; }
      .wrap { height: 100%; display: grid; place-items: center; }
      .card { width: min(720px, calc(100% - 48px)); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; background: rgba(255,255,255,0.03); }
      .title { font-size: 18px; margin: 0 0 8px; }
      .sub { opacity: 0.8; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono"; font-size: 12px; }
      .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.18); border-top-color: rgba(255,255,255,0.9); animation: r 1s linear infinite; display: inline-block; margin-right: 10px; vertical-align: -3px; }
      @keyframes r { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="title"><span class="spin"></span>Launching...</p>
        <div class="sub">${esc(msg)}</div>
      </div>
    </div>
  </body>
</html>
  `)}`;
}

async function waitForServerReady({ url, timeoutMs = 30000, intervalMs = 250 } = {}) {
  const u = String(url || '').trim();
  if (!u) throw new Error('waitForServerReady: url required');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      const res = await fetch(u, { signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return true;
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    backgroundColor: '#0b0b0f',
    webPreferences: {
      // Keep it simple for now; we don't expose Node APIs to renderer.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.on('closed', () => {
    win = null;
  });
}

async function main() {
  const devRepoRoot = resolveRepoRoot();
  const resourcesRoot = app.isPackaged ? process.resourcesPath : devRepoRoot;
  // Make repo/resources root explicit for sidecars (avoid relying on __dirname in app.asar).
  process.env.TIDY_REPO_ROOT = String(resourcesRoot);
  const uiDir = path.join(resourcesRoot, 'client', 'dist');
  const { dataDir } = await initUserDataLayout();
  if (!app.isPackaged) {
    await bestEffortMigrateRepoData({ repoRoot: devRepoRoot, dataDir });
  }

  const serverPort = await pickPort({ preferred: process.env.TIDY_SERVER_PORT || 3001 });
  const aiPort = await pickPort({ preferred: process.env.TIDY_AI_PORT || 8002 });
  process.env.TIDY_AI_PORT = String(aiPort);

  aiProc = startAiService({
    port: aiPort,
    repoRoot: resourcesRoot,
    clipModelId: process.env.TIDY_CLIP_MODEL_ID || undefined,
    clipConcurrency: process.env.TIDY_CLIP_CONCURRENCY || undefined,
  });

  serverProc = startServer({
    port: serverPort,
    dataDir,
    uiDir,
    repoRoot: resourcesRoot,
  });

  await createWindow();
  await win.loadURL(bootHtml({ serverPort }));

  const uiUrl = isDev() && process.env.TIDY_DEV_UI_URL
    ? String(process.env.TIDY_DEV_UI_URL)
    : `http://127.0.0.1:${serverPort}/`;

  // Wait for backend ready to avoid ERR_CONNECTION_REFUSED "flash quit".
  const ok = await waitForServerReady({ url: `http://127.0.0.1:${serverPort}/api/health` });
  if (!ok) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: '启动失败',
      message: '后端服务启动超时',
      detail: `无法连接到 http://127.0.0.1:${serverPort}/api/health\n\n请稍后重试；如果持续失败，请把启动日志发给开发者。`,
    });
    throw new Error(`backend not ready on :${serverPort}`);
  }

  try {
    await win.loadURL(uiUrl);
  } catch (e) {
    await dialog.showMessageBox(win, {
      type: 'error',
      title: '启动失败',
      message: '无法打开界面',
      detail: String(e?.message || e),
    });
    throw e;
  }

  // Stage-1 update strategy: hinted update via manifest URL.
  // Provide `TIDY_UPDATE_MANIFEST_URL` in distribution channel.
  const manifestUrl = process.env.TIDY_UPDATE_MANIFEST_URL;
  if (manifestUrl) {
    checkForUpdatesHinted({
      currentVersion: app.getVersion(),
      manifestUrl,
      parentWindow: win,
    }).catch(() => {});
  }
}

async function shutdown() {
  await stopProcess(serverProc);
  await stopProcess(aiProc);
  serverProc = null;
  aiProc = null;
}

app.on('window-all-closed', async () => {
  await shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await shutdown();
});

app.whenReady().then(main).catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[desktop] failed to start:', e);
  app.quit();
});


