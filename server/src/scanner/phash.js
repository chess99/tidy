/**
 * input: 图片文件路径/RAW 预览字节 + sharp
 * output: 64-bit pHash(hex) 与距离计算
 * pos: 服务端扫描管线：为重复项工具提供“相似度”特征（变更需同步更新本头注释与所属目录 README）
 */

const sharp = require('sharp');
const path = require('path');
const { RAW_EXTS, extractEmbeddedPreview } = require('./thumbnail');

const N = 32;
const K = 8;

function buildCosTable(n) {
  const t = Array.from({ length: n }, () => new Float64Array(n));
  for (let u = 0; u < n; u++) {
    for (let x = 0; x < n; x++) {
      t[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n));
    }
  }
  return t;
}

const COS_32 = buildCosTable(N);

function dct1d(vec, cosTable) {
  const n = vec.length;
  const out = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    let sum = 0;
    const cu = u === 0 ? Math.SQRT1_2 : 1; // 1/sqrt(2)
    const row = cosTable[u];
    for (let x = 0; x < n; x++) {
      sum += vec[x] * row[x];
    }
    out[u] = cu * sum;
  }
  return out;
}

function dct2dSeparable(mat) {
  // mat: Array<Float64Array(N)> rows
  const tmp = Array.from({ length: N }, () => new Float64Array(N));
  for (let y = 0; y < N; y++) {
    tmp[y].set(dct1d(mat[y], COS_32));
  }

  const out = Array.from({ length: N }, () => new Float64Array(N));
  const col = new Float64Array(N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) col[y] = tmp[y][x];
    const dc = dct1d(col, COS_32);
    for (let u = 0; u < N; u++) out[u][x] = dc[u];
  }
  return out;
}

function median(values) {
  if (!values.length) return 0;
  const a = values.slice().sort((x, y) => x - y);
  const mid = (a.length / 2) | 0;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function toHex64(bits) {
  // bits: 64-length 0/1 array, msb-first
  let s = '';
  for (let i = 0; i < 64; i += 4) {
    const v = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    s += v.toString(16);
  }
  return s;
}

function normalizeHex64(h) {
  const s = String(h || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16}$/.test(s)) return null;
  return s;
}

function popcountBigInt(x) {
  let n = 0;
  let v = x;
  while (v) {
    v &= (v - 1n);
    n++;
  }
  return n;
}

function hamming64(aHex, bHex) {
  const a = normalizeHex64(aHex);
  const b = normalizeHex64(bHex);
  if (!a || !b) return null;
  const ax = BigInt(`0x${a}`);
  const bx = BigInt(`0x${b}`);
  return popcountBigInt(ax ^ bx);
}

async function loadImageBytes(filePath) {
  const ext = String(path.extname(filePath) || '').toLowerCase();
  if (RAW_EXTS.has(ext)) {
    const preview = await extractEmbeddedPreview(filePath);
    if (preview) return { input: preview, kind: 'raw_preview' };
  }
  return { input: filePath, kind: 'file' };
}

async function computePHash(filePath) {
  const { input } = await loadImageBytes(filePath);
  // Convert to 32x32 grayscale. Use rotate() to respect EXIF orientation.
  const { data, info } = await sharp(input)
    .rotate()
    .resize(N, N, { fit: 'fill', fastShrinkOnLoad: true })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info || info.width !== N || info.height !== N) {
    throw new Error('phash_bad_resize');
  }

  // Build matrix of centered pixel values (0..255 -> -128..127).
  const mat = Array.from({ length: N }, () => new Float64Array(N));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      mat[y][x] = Number(data[y * N + x]) - 128;
    }
  }

  const dct = dct2dSeparable(mat);

  // Take top-left 8x8 (excluding DC [0,0]) and compare to median.
  const vals = [];
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      if (y === 0 && x === 0) continue;
      vals.push(dct[y][x]);
    }
  }
  const m = median(vals);

  const bits = new Array(64).fill(0);
  let i = 0;
  for (let y = 0; y < K; y++) {
    for (let x = 0; x < K; x++) {
      const v = dct[y][x];
      bits[i++] = v > m ? 1 : 0;
    }
  }
  const hex = toHex64(bits);
  return hex;
}

module.exports = { computePHash, hamming64 };


