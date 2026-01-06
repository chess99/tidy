/**
 * input: client/public/icon.svg（源图标）+ 系统工具（macOS: iconutil）+ Node 依赖（sharp/png-to-ico）
 * output: desktop/assets 下生成 icon.png/icon.icns/icon.ico（供 electron-builder 使用）
 * pos: 桌面打包脚本：被 desktop/package.json 的 dist 前置调用（变更需同步更新本头注释与所属目录 README）
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');

const srcSvg = path.join(repoRoot, 'client', 'public', 'icon.svg');
const outDir = path.join(desktopRoot, 'assets');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function assertExists(p) {
  if (!fs.existsSync(p)) throw new Error(`missing icon source: ${p}`);
}

async function renderPng(size) {
  const buf = await sharp(srcSvg, { density: 512 }).resize(size, size).png().toBuffer();
  return buf;
}

async function writePng(file, size) {
  const buf = await renderPng(size);
  fs.writeFileSync(file, buf);
  return buf;
}

async function buildMacIcns() {
  // iconutil expects an .iconset folder with specific file names.
  const iconsetDir = path.join(outDir, 'icon.iconset');
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  ensureDir(iconsetDir);

  const sizes = [16, 32, 128, 256, 512];
  for (const s of sizes) {
    fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}.png`), await renderPng(s));
    fs.writeFileSync(path.join(iconsetDir, `icon_${s}x${s}@2x.png`), await renderPng(s * 2));
  }

  const icnsPath = path.join(outDir, 'icon.icns');
  const res = spawnSync('iconutil', ['-c', 'icns', iconsetDir, '-o', icnsPath], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error('iconutil failed to generate icns');
}

async function buildWinIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const bufs = await Promise.all(sizes.map((s) => renderPng(s)));
  const ico = await pngToIco(bufs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
}

async function main() {
  assertExists(srcSvg);
  ensureDir(outDir);

  // Always generate a 1024 png (useful for docs and as a fallback).
  await writePng(path.join(outDir, 'icon.png'), 1024);

  if (process.platform === 'darwin') {
    await buildMacIcns();
  }
  await buildWinIco();

  console.log('[generate-icons] OK', outDir);
}

main().catch((e) => {
  console.error('[generate-icons] failed:', e?.stack || e);
  process.exit(1);
});


