/**
 * input: 环境变量（PORT/DATA_DIR/AI_SERVICE_URL 等）+ 文件系统/DB + HTTP 请求
 * output: 启动本地 HTTP 服务（API + 可选静态 UI 托管）与后台任务 runner
 * pos: 后端进程入口：被桌面壳/开发脚本拉起（变更需同步更新本头注释与所属目录 README）
 */

require('dotenv').config();
const { initDB } = require('./src/db');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { DATA_DIR, DB_PATH, THUMB_DIR, PREVIEW_DIR, POSTER_DIR } = require('./src/config');
const { createApp } = require('./src/app');

const app = createApp();
const PORT = process.env.PORT || 3001;

// Initialize DB
initDB();

// Start background job runner (DB-backed task queue).
const { startJobRunner } = require('./src/jobs/runner');
startJobRunner({ pollIntervalMs: 500 });

// Start file system watcher for auto-scan.
const { startWatcher } = require('./src/watcher');
startWatcher().catch(err => console.error('[watcher] Failed to start:', err));

// Log effective config (helps cross-platform setup). MANAGED_ROOT/TRASH_DIR come from config.json (UI-configurable).
console.log('[config] DATA_DIR   =', DATA_DIR);
console.log('[config] DB_PATH    =', DB_PATH);
console.log('[config] THUMB_DIR  =', THUMB_DIR);
console.log('[config] PREVIEW_DIR=', PREVIEW_DIR);
console.log('[config] POSTER_DIR =', POSTER_DIR);

// Optional: serve built client UI (desktop/distribution mode).
// - If `TIDY_UI_DIR` is set, use it.
// - Else, try to locate `client/dist` adjacent to the repo/app bundle.
try {
  const uiDir = process.env.TIDY_UI_DIR
    ? path.resolve(String(process.env.TIDY_UI_DIR))
    : path.join(__dirname, '..', 'client', 'dist');
  const uiIndex = path.join(uiDir, 'index.html');
  if (fs.existsSync(uiIndex)) {
    // Static assets
    app.use(express.static(uiDir, { index: false }));
    // SPA fallback (avoid hijacking API routes)
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(uiIndex));
    console.log('[ui] serving client from', uiDir);
  } else {
    console.log('[ui] client dist not found; skipping static UI');
  }
} catch (e) {
  console.log('[ui] static UI init failed:', e?.message || e);
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Best-effort warmup:
// - CLIP index loading can take ~1s+ on first query (disk read). Preload it in background to avoid
//   the first smart-search `/api/files` feeling "stuck".
try {
  const { ensureIndexLoaded } = require('./src/services/clipIndex');
  const { clipTextEmbed } = require('./src/services/aiClient');
  setImmediate(() => {
    ensureIndexLoaded({}).catch(() => {});
    // Also warm up the text-embed path (model load/caches) without blocking user requests.
    clipTextEmbed({ query: 'warmup', normalize: true }).catch(() => {});
  });
} catch {
  // ignore warmup failures
}
