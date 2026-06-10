/**
 * input: 文件路径/媒体字节 + 配置 + ai-service
 * output: hash/元信息/缩略图/人脸等派生产物
 * pos: 服务端扫描管线：从文件系统提取结构化信息（变更需同步更新本头注释与所属目录 README）
 */

const { getDB } = require('../db');
const { FACE_MIN_CONFIDENCE, FACE_MIN_PX } = require('../config');
const { detectFaces: aiDetectFaces } = require('../services/aiClient');

async function detectFaces(imagePath) {
  try {
    const detections = await aiDetectFaces({ imagePath });

    // Filter obvious false positives by size/aspect
    const filtered = [];
    for (const det of detections || []) {
      const b = det?.detection?.box;
      const w = Number(b?.width ?? 0);
      const h = Number(b?.height ?? 0);
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      if (Math.min(w, h) < FACE_MIN_PX) continue;
      const score = Number(det?.detection?.score ?? 0);
      if (score < FACE_MIN_CONFIDENCE) continue;
      const ar = w / h;
      if (ar < 0.3 || ar > 3.3) continue;
      filtered.push(det);
    }

    return filtered;
  } catch (err) {
    console.error(`Error detecting faces in ${imagePath}:`, err.message);
    throw err;
  }
}

async function processImageFaces(imagePath, hash) {
  const detections = await detectFaces(imagePath);
  if (!detections.length) return 0;

  const db = getDB();
  let addedCount = 0;

  const now = Date.now();

  const insertFaceStmt = db.prepare(`
    INSERT INTO faces (hash, person_id, descriptor, box, score, created_at)
    VALUES (?, NULL, ?, ?, ?, ?)
  `);

  for (const det of detections) {
    const descriptor = det.descriptor;
    const b = det?.detection?.box;
    const box = {
      x: Number(b?.x ?? b?._x ?? 0),
      y: Number(b?.y ?? b?._y ?? 0),
      width: Number(b?.width ?? b?._width ?? 0),
      height: Number(b?.height ?? b?._height ?? 0),
    };

    try {
      insertFaceStmt.run(
        hash,
        JSON.stringify(Array.from(descriptor)),
        JSON.stringify(box),
        det.detection.score,
        now
      );

      addedCount++;
    } catch (e) {
      console.error('Failed to insert face:', e.message);
    }
  }

  return addedCount;
}

module.exports = {
  detectFaces,
  processImageFaces
};
