/**
 * input: 本机 Node 二进制（process.execPath）+ 仓库产物（client/dist、ai-service/dist、server/）
 * output: 生成 `desktop/bundle/` 目录（供 electron-builder extraResources 打包）
 * pos: 桌面打包脚本：被 `desktop/package.json` scripts 调用（变更需同步更新本头注释与所属目录 README）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (res.status !== 0) {
    const detail = [res.stdout, res.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return res.stdout || '';
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

function isSystemDylib(dep) {
  return dep.startsWith('/usr/lib/') || dep.startsWith('/System/Library/');
}

function parseOtoolDeps(file) {
  const out = run('otool', ['-L', file]);
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function resolveDylib(dep, { fromDir } = {}) {
  if (dep.startsWith('@loader_path/') && fromDir) {
    const p = path.join(fromDir, dep.slice('@loader_path/'.length));
    if (fs.existsSync(p)) return p;
  }
  if (path.isAbsolute(dep) && fs.existsSync(dep)) return dep;
  const base = path.basename(dep);
  const candidates = [
    path.join('/opt/homebrew/lib', base),
    path.join('/opt/homebrew/opt/node/lib', base),
    path.join('/usr/local/lib', base),
  ];
  const direct = candidates.find((p) => fs.existsSync(p));
  if (direct) return direct;

  for (const optRoot of ['/opt/homebrew/opt', '/usr/local/opt']) {
    if (!fs.existsSync(optRoot)) continue;
    for (const pkg of fs.readdirSync(optRoot)) {
      const p = path.join(optRoot, pkg, 'lib', base);
      if (fs.existsSync(p)) return p;
    }
  }

  return null;
}

function patchInstallName(file, args) {
  run('install_name_tool', [...args, file]);
}

function bundleNodeRuntime({ nodeBin }) {
  if (process.platform !== 'darwin') return;

  const libDir = path.join(bundleNodeDir, 'lib');
  mkdirp(libDir);

  const copied = new Map();
  const queue = [];
  for (const dep of parseOtoolDeps(nodeBin)) {
    if (isSystemDylib(dep)) continue;
    queue.push({ dep, fromDir: path.dirname(nodeBin) });
  }

  while (queue.length > 0) {
    const { dep, fromDir } = queue.shift();
    const src = resolveDylib(dep, { fromDir });
    if (!src) throw new Error(`unable to resolve dylib dependency for ${dep}`);
    const base = path.basename(src);
    if (!copied.has(base)) {
      const dst = path.join(libDir, base);
      copyFile(src, dst);
      fs.chmodSync(dst, 0o755);
      copied.set(base, dst);
      for (const childDep of parseOtoolDeps(dst)) {
        if (!isSystemDylib(childDep) && path.basename(childDep) !== base) {
          queue.push({ dep: childDep, fromDir: path.dirname(dst) });
        }
      }
    }
  }

  for (const dep of parseOtoolDeps(nodeBin)) {
    if (!isSystemDylib(dep)) {
      patchInstallName(nodeBin, ['-change', dep, `@executable_path/lib/${path.basename(dep)}`]);
    }
  }

  for (const lib of copied.values()) {
    patchInstallName(lib, ['-id', `@loader_path/${path.basename(lib)}`]);
    for (const dep of parseOtoolDeps(lib)) {
      if (!isSystemDylib(dep)) {
        patchInstallName(lib, ['-change', dep, `@loader_path/${path.basename(dep)}`]);
      }
    }
  }
}

function patchAiServiceRuntime({ aiRoot }) {
  if (process.platform !== 'darwin') return;

  const internalDir = path.join(aiRoot, '_internal');
  const libssl = path.join(internalDir, 'libssl.3.dylib');
  const libcrypto = path.join(internalDir, 'libcrypto.3.dylib');
  if (!fs.existsSync(libssl) || !fs.existsSync(libcrypto)) return;

  fs.chmodSync(libssl, 0o755);
  fs.chmodSync(libcrypto, 0o755);
  patchInstallName(libssl, ['-id', '@rpath/libssl.3.dylib']);
  patchInstallName(libcrypto, ['-id', '@rpath/libcrypto.3.dylib']);

  for (const dep of parseOtoolDeps(libssl)) {
    if (path.basename(dep) === 'libcrypto.3.dylib') {
      patchInstallName(libssl, ['-change', dep, '@loader_path/libcrypto.3.dylib']);
    }
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
  bundleNodeRuntime({ nodeBin: nodeDst });

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
  const aiDst = path.join(bundleAiDir, 'dist', 'tidy-ai-service');
  copyDir(aiOnedir, aiDst);
  patchAiServiceRuntime({ aiRoot: aiDst });

  console.log('[prepare-resources] OK');
  console.log('  bundle =', bundleRoot);
  console.log('  node   =', nodeDst);
  console.log('  server =', bundleServerDir);
  console.log('  client =', bundleClientDir);
  console.log('  ai     =', bundleAiDir);
}

main();
