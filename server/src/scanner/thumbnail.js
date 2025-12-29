const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { exiftoolPath: exiftoolPathFn } = require('exiftool-vendored');

const { THUMB_DIR } = require('../config');

// Ensure thumb dir exists
fs.ensureDirSync(THUMB_DIR);

const RAW_EXTS = new Set([
  '.dng',
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.raf',
  '.rw2',
  '.orf',
  '.sr2',
  '.pef',
]);

let _exiftoolCmdPromise = null;
async function getExiftoolCmd() {
  if (!_exiftoolCmdPromise) _exiftoolCmdPromise = Promise.resolve(exiftoolPathFn());
  return await _exiftoolCmdPromise;
}

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      // ExifTool may exit non-zero on warnings depending on "failOn" settings, while still producing stdout.
      // For our use-case (binary extraction), prefer any non-empty stdout over the exit code.
      const hasStdout = Buffer.isBuffer(stdout) ? stdout.length > 0 : String(stdout || '').length > 0;
      if (err && !hasStdout) {
        const e = new Error(String(stderr || err.message || 'execFile failed'));
        e.code = err.code;
        return reject(e);
      }
      resolve(stdout);
    });
  });
}

function isJpeg(buf) {
  if (!buf || buf.length < 4) return false;
  // JPEG SOI: FF D8, EOI ends with FF D9 (not guaranteed present in truncated streams, but should be here)
  return buf[0] === 0xff && buf[1] === 0xd8;
}

async function extractEmbeddedPreviewJpeg(filePath) {
  // Try common RAW embedded preview tags in priority order.
  const tags = ['PreviewImage', 'JpgFromRaw', 'OtherImage', 'ThumbnailImage', 'PreviewTIFF', 'PreviewPNG'];
  const exiftoolCmd = await getExiftoolCmd();
  for (const tag of tags) {
    try {
      // -b: binary. -q -q: quiet. Output as Buffer.
      // eslint-disable-next-line no-await-in-loop
      const out = await execFileAsync(
        exiftoolCmd,
        // -m: ignore minor warnings (some DNGs emit warnings like Incorrect count for DNGPrivateData)
        // -api IgnoreMinorErrors=1: be extra tolerant across RAW variants
        ['-b', '-q', '-q', '-m', '-api', 'IgnoreMinorErrors=1', `-${tag}`, filePath],
        { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }
      );
      // Prefer JPEG but allow other embedded formats too (sharp will validate/parse).
      if (Buffer.isBuffer(out) && out.length > 0) return out;
    } catch {
      // ignore and try next tag
    }
  }
  return null;
}

async function trySharpToThumb({ input, thumbPath }) {
  await sharp(input)
    .rotate()
    .resize(300, 300, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toFile(thumbPath);
}

async function generateThumbnail(filePath, hash, opts = {}) {
  const baseDir = opts.thumbDir ? path.resolve(String(opts.thumbDir)) : THUMB_DIR;
  try {
    fs.ensureDirSync(baseDir);
  } catch {
    // ignore
  }

  const thumbPath = path.join(baseDir, `${hash}.jpg`);

  if (await fs.pathExists(thumbPath)) {
    return thumbPath;
  }

  const ext = String(opts.ext || path.extname(filePath) || '').toLowerCase();
  const isRaw = RAW_EXTS.has(ext);

  try {
    await trySharpToThumb({ input: filePath, thumbPath });
    return thumbPath;
  } catch (err) {
    // Fallback: for RAW/DNG etc, extract embedded preview JPEG via exiftool.
    if (isRaw) {
      try {
        const preview = await extractEmbeddedPreviewJpeg(filePath);
        if (preview) {
          await trySharpToThumb({ input: preview, thumbPath });
          return thumbPath;
        }
      } catch {
        // ignore; fall through to null
      }
    }

    console.error(`Failed to generate thumbnail for ${filePath}:`, err.message);
    return null;
  }
}

function getThumbnailPath(hash) {
  return path.join(THUMB_DIR, `${hash}.jpg`);
}

module.exports = { generateThumbnail, getThumbnailPath, RAW_EXTS };

