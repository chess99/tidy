/**
 * input: 本机 Node 二进制（process.execPath）+ 仓库产物（client/dist、ai-service/dist、server/）
 * output: 生成 `desktop/bundle/` 目录（供 electron-builder extraResources 打包）
 * pos: 桌面打包脚本：被 `desktop/package.json` scripts 调用（变更需同步更新本头注释与所属目录 README）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');

const bundleRoot = path.join(desktopRoot, 'bundle');
const bundleNodeDir = path.join(bundleRoot, 'node');
const bundleServerDir = path.join(bundleRoot, 'server');
const bundleClientDir = path.join(bundleRoot, 'client');
const bundleAiDir = path.join(bundleRoot, 'ai-service');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dst) {
  mkdirp(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  mkdirp(dst);
  fs.cpSync(src, dst, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (p) => {
      const base = path.basename(p);
      // Avoid bundling transient caches
      if (base === '__pycache__') return false;
      if (base === '.DS_Store') return false;
      return true;
    },
  });
}

function assertExists(p, hint) {
  if (!fs.existsSync(p)) {
    const msg = hint ? `${p}\n${hint}` : p;
    throw new Error(`missing required build input:\n${msg}`);
  }
}

function main() {
  rmrf(bundleRoot);
  mkdirp(bundleRoot);

  // 1) Bundle Node (system node) for running `server` without Electron ABI issues.
  const isWindows = process.platform === 'win32';
  const nodeSrc = process.execPath;
  const nodeDst = path.join(bundleNodeDir, isWindows ? 'node.exe' : 'node');
  assertExists(nodeSrc, 'Expected a working system node binary.');
  copyFile(nodeSrc, nodeDst);
  if (!isWindows) {
    try {
      fs.chmodSync(nodeDst, 0o755);
    } catch {
      // ignore
    }
  }

  // 2) Bundle server (including node_modules).
  const serverSrc = path.join(repoRoot, 'server');
  assertExists(path.join(serverSrc, 'index.js'), 'Run from repo root with server/ present.');
  assertExists(path.join(serverSrc, 'node_modules'), 'Install server deps first: `cd server && npm i`.');
  copyDir(serverSrc, bundleServerDir);

  // 3) Bundle client dist (static UI). Ensure it exists.
  const clientDist = path.join(repoRoot, 'client', 'dist');
  assertExists(path.join(clientDist, 'index.html'), 'Build UI first: `cd client && npm run build`.');
  copyDir(clientDist, path.join(bundleClientDir, 'dist'));

  // 4) Bundle ai-service binary (PyInstaller onedir).
  // Default output: ai-service/dist/tidy-ai-service/(tidy-ai-service[.exe])
  const aiOnedir = path.join(repoRoot, 'ai-service', 'dist', 'tidy-ai-service');
  const aiExe = path.join(aiOnedir, isWindows ? 'tidy-ai-service.exe' : 'tidy-ai-service');
  assertExists(aiExe, 'Build ai-service first: `cd ai-service && ./scripts/build-ai-service.sh` (or .bat).');
  copyDir(aiOnedir, path.join(bundleAiDir, 'dist', 'tidy-ai-service'));

  console.log('[prepare-resources] OK');
  console.log('  bundle =', bundleRoot);
  console.log('  node   =', nodeDst);
  console.log('  server =', bundleServerDir);
  console.log('  client =', bundleClientDir);
  console.log('  ai     =', bundleAiDir);
}

main();


