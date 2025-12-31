/**
 * input: 文件路径/媒体字节 + 配置
 * output: hash/元信息/缩略图/人脸等派生产物
 * pos: 服务端扫描管线：从文件系统提取结构化信息（变更需同步更新本头注释与所属目录 README）
 */

const { execFile } = require('child_process');
const ffprobePath = require('ffprobe-static').path;

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) {
        const e = new Error(stderr || err.message || 'ffprobe failed');
        e.code = err.code;
        return reject(e);
      }
      resolve(String(stdout || ''));
    });
  });
}

function pickTag(tags, keys) {
  if (!tags) return null;
  for (const k of keys) {
    if (tags[k] != null && String(tags[k]).trim() !== '') return String(tags[k]).trim();
  }
  return null;
}

function parseTimeMs(v) {
  if (!v) return null;
  // ffprobe often returns ISO-8601, sometimes "YYYY-MM-DD HH:MM:SS"
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

async function extractVideoMetadata(filePath) {
  try {
    const out = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);

    const json = JSON.parse(out);
    const tags = json?.format?.tags || null;

    const camera_make = pickTag(tags, [
      'make',
      'MAKE',
      'com.apple.quicktime.make',
      'com.android.manufacturer',
      'manufacturer',
    ]);
    const camera_model = pickTag(tags, [
      'model',
      'MODEL',
      'com.apple.quicktime.model',
      'com.android.model',
    ]);

    const taken_at =
      parseTimeMs(pickTag(tags, ['creation_time', 'com.apple.quicktime.creationdate', 'date'])) ||
      null;

    return {
      taken_at,
      camera_make,
      camera_model,
    };
  } catch {
    return null;
  }
}

module.exports = { extractVideoMetadata };


