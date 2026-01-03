/**
 * input: 环境变量/配置 + DB
 * output: 服务端模块导出
 * pos: 服务端核心模块：被 server 入口与路由/任务依赖（变更需同步更新本头注释与所属目录 README）
 */

const path = require('path');
const os = require('os');

function abs(p) {
  if (!p) return p;
  try {
    return path.resolve(String(p));
  } catch {
    return String(p);
  }
}

// Cross-platform defaults.
// Users are expected to override WORK_ROOT in `server/.env` for their own library location.
const DEFAULT_WORK_ROOT = path.join(os.homedir(), 'Pictures');
const WORK_ROOT = abs(process.env.WORK_ROOT) || DEFAULT_WORK_ROOT;

// Managed library root under WORK_ROOT to avoid mixing with existing folders.
const MANAGED_ROOT = abs(process.env.MANAGED_ROOT) || path.join(WORK_ROOT, '_Tidy');

// Tool trash directory (duplicates + user trash).
const TRASH_DIR = abs(process.env.TRASH_DIR) || path.join(MANAGED_ROOT, '_Trash');

// Server-local data directory (DB, thumbs, logs, etc).
// Default: `server/data/`
const DATA_DIR = abs(process.env.DATA_DIR) || path.join(__dirname, '..', '..', 'data');

// Default DB path: `server/data/tidy.db`
const DB_PATH = abs(process.env.DB_PATH) || path.join(DATA_DIR, 'tidy.db');

// Default thumbnail directory: `server/data/thumbnails/`
const THUMB_DIR = abs(process.env.THUMB_DIR) || path.join(DATA_DIR, 'thumbnails');

// Derived previews directory (larger than thumbs). Default: `server/data/previews/`
const PREVIEW_DIR = abs(process.env.PREVIEW_DIR) || path.join(DATA_DIR, 'previews');

// Video poster frames directory. Default: `server/data/posters/`
const POSTER_DIR = abs(process.env.POSTER_DIR) || path.join(DATA_DIR, 'posters');

// Face detection tunables (server-side)
function numEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const FACE_MIN_CONFIDENCE = numEnv('FACE_MIN_CONFIDENCE', 0.7);
const FACE_MIN_PX = numEnv('FACE_MIN_PX', 40);

// AI service (Python) for face/CLIP inference
const AI_SERVICE_URL = String(process.env.AI_SERVICE_URL || 'http://localhost:8002').trim();
// CLIP model id (must match ai-service TIDY_CLIP_MODEL_ID for consistent indexing)
const CLIP_MODEL_ID = String(process.env.CLIP_MODEL_ID || 'jinaai/jina-clip-v2').trim();

module.exports = {
  WORK_ROOT,
  MANAGED_ROOT,
  TRASH_DIR,
  DATA_DIR,
  DB_PATH,
  THUMB_DIR,
  PREVIEW_DIR,
  POSTER_DIR,
  FACE_MIN_CONFIDENCE,
  FACE_MIN_PX,
  AI_SERVICE_URL,
  CLIP_MODEL_ID,
};


