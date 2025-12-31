/**
 * input: 文件路径/媒体字节 + 配置
 * output: hash/元信息/缩略图/人脸等派生产物
 * pos: 服务端扫描管线：从文件系统提取结构化信息（变更需同步更新本头注释与所属目录 README）
 */

// We require tfjs-node explicitly because we rely on TensorFlow in Node.
// If this fails to install, face detection cannot run.
let tf;
try {
  // eslint-disable-next-line global-require
  tf = require('@tensorflow/tfjs-node');
} catch (e) {
  const msg =
    `[faces] Missing dependency: @tensorflow/tfjs-node\n` +
    `This is required for face detection in Node (decodeImage).\n` +
    `If you are behind a proxy, try:\n` +
    `  HTTPS_PROXY=http://127.0.0.1:7897 npm i @tensorflow/tfjs-node\n` +
    `Original error: ${String(e?.message || e)}`;
  throw new Error(msg);
}

// IMPORTANT: use the Node bundle explicitly so `faceapi.node.*` is available.
const faceapi = require('@vladmandic/face-api/dist/face-api.node.js');
const { Canvas, Image, ImageData, createCanvas, loadImage } = require('canvas');
const path = require('path');
const fs = require('fs-extra');
const { getDB } = require('../db');
const { FACE_MIN_CONFIDENCE, FACE_MIN_PX } = require('../config');

// Monkey patch for Node.js environment
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

let modelsLoaded = false;
const MODEL_PATH = path.join(__dirname, '../../models');

async function loadModels() {
  if (modelsLoaded) return;
  try {
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_PATH);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_PATH);
    modelsLoaded = true;
    console.log('Face models loaded.');
  } catch (err) {
    console.error('Failed to load face models:', err);
  }
}

async function detectFaces(imagePath) {
  if (!modelsLoaded) await loadModels();

  try {
    // Decode image via node-canvas and build an RGB tensor.
    const img = await loadImage(imagePath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const tensor = tf.tidy(() => {
      const data = tf.tensor(Array.from(imageData?.data || []), [canvas.height, canvas.width, 4], 'int32');
      const channels = tf.split(data, 4, 2); // RGBA
      const rgb = tf.stack([channels[0], channels[1], channels[2]], 2);
      const reshaped = tf.reshape(rgb, [1, canvas.height, canvas.width, 3]);
      return reshaped;
    });

    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: FACE_MIN_CONFIDENCE,
      maxResults: 20,
    });
    const detections = await faceapi
      .detectAllFaces(tensor, options)
      .withFaceLandmarks()
      .withFaceDescriptors();
    
    // Dispose tensor to free memory
    tensor.dispose();

    // Filter obvious false positives by size/aspect
    const filtered = [];
    for (const det of detections || []) {
      const b = det?.detection?.box;
      const w = Number(b?.width ?? b?._width);
      const h = Number(b?.height ?? b?._height);
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      if (Math.min(w, h) < FACE_MIN_PX) continue;
      const ar = w / h;
      if (ar < 0.3 || ar > 3.3) continue;
      filtered.push(det);
    }

    return filtered;
  } catch (err) {
    console.error(`Error detecting faces in ${imagePath}:`, err.message);
    return [];
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
  loadModels,
  detectFaces,
  processImageFaces
};

