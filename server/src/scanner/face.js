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

    const options = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.2, maxResults: 20 });
    const detections = await faceapi
      .detectAllFaces(tensor, options)
      .withFaceLandmarks()
      .withFaceDescriptors();
    
    // Dispose tensor to free memory
    tensor.dispose();

    return detections;
  } catch (err) {
    console.error(`Error detecting faces in ${imagePath}:`, err.message);
    return [];
  }
}

// Get all people with their reference descriptor (from avatar face)
function getKnownPeople() {
  const db = getDB();
  // We need the descriptor of the avatar face.
  // Join people with faces on avatar_face_id
  const rows = db.prepare(`
    SELECT p.id, p.name, f.descriptor
    FROM people p
    JOIN faces f ON p.avatar_face_id = f.id
    WHERE f.descriptor IS NOT NULL
  `).all();

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    descriptor: new Float32Array(JSON.parse(r.descriptor))
  }));
}

function findMatch(descriptor, knownPeople) {
  let bestMatch = null;
  let minDist = 0.6; // Threshold

  for (const person of knownPeople) {
    const dist = faceapi.euclideanDistance(descriptor, person.descriptor);
    if (dist < minDist) {
      minDist = dist;
      bestMatch = person;
    }
  }
  return bestMatch;
}

async function processImageFaces(imagePath, hash) {
  const detections = await detectFaces(imagePath);
  if (!detections.length) return 0;

  const db = getDB();
  // We treat existing people (with avatar descriptor) as cluster centers.
  // New faces that don't match any known center will create a new person automatically.
  const knownPeople = getKnownPeople(); // [{ id, descriptor }]
  let addedCount = 0;
  let createdPeople = 0;

  const now = Date.now();

  const insertFaceStmt = db.prepare(`
      INSERT INTO faces (hash, person_id, descriptor, box, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  const createPersonStmt = db.prepare(`
      INSERT INTO people (name, avatar_face_id, created_at, updated_at)
      VALUES (NULL, NULL, ?, ?)
    `);
  const setAvatarStmt = db.prepare(`
      UPDATE people
      SET avatar_face_id = ?, updated_at = ?
      WHERE id = ? AND avatar_face_id IS NULL
    `);

  for (const det of detections) {
    const descriptor = det.descriptor;
    const box = det.detection.box; // { x, y, width, height }
    
    let match = findMatch(descriptor, knownPeople);
    let personId = match ? match.id : null;

    try {
      // If no match, create a new person cluster for this face.
      if (!personId) {
        const info = createPersonStmt.run(now, now);
        personId = info.lastInsertRowid;
        createdPeople++;
        // Immediately register this new person as a known center using this descriptor.
        knownPeople.push({ id: personId, name: null, descriptor });
      }

      const faceInfo = insertFaceStmt.run(
          hash,
          personId,
          JSON.stringify(Array.from(descriptor)),
          JSON.stringify(box),
          det.detection.score,
          now
        );
      const faceId = faceInfo.lastInsertRowid;

      // Set avatar_face_id if empty (for both new people and old people without avatar).
      setAvatarStmt.run(faceId, now, personId);

      addedCount++;
    } catch (e) {
      console.error('Failed to insert face:', e.message);
    }
  }

  if (createdPeople) {
    console.log(`[faces] hash=${hash} new_people=${createdPeople} faces=${addedCount}`);
  }
  return addedCount;
}

module.exports = {
  loadModels,
  detectFaces,
  processImageFaces
};

