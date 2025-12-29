const faceapi = require('@vladmandic/face-api');
const { Canvas, Image, ImageData } = require('canvas');
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
    const img = await fs.readFile(imagePath);
    const tensor = await faceapi.node.decodeImage(img);

    const detections = await faceapi
      .detectAllFaces(tensor)
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
  const knownPeople = getKnownPeople();
  let addedCount = 0;

  const now = Date.now();

  const insertStmt = db.prepare(`
    INSERT INTO faces (hash, person_id, descriptor, box, score, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const det of detections) {
    const descriptor = det.descriptor;
    const box = det.detection.box; // { x, y, width, height }
    
    const match = findMatch(descriptor, knownPeople);
    const personId = match ? match.id : null;

    try {
      insertStmt.run(
        hash,
        personId,
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

