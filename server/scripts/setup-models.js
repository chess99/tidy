#!/usr/bin/env node
/**
 * Initialize face-api model files into ./server/models
 *
 * Why:
 * - Models are large binary artifacts; we intentionally do NOT commit them to git.
 * - This script copies the model files shipped with @vladmandic/face-api into server/models.
 *
 * Usage:
 *   cd server
 *   npm run models:setup
 */
const path = require('path');
const fs = require('fs-extra');

function resolveFaceApiModelsDir() {
  // Resolve from within server package context
  const pkgJson = require.resolve('@vladmandic/face-api/package.json');
  const pkgDir = path.dirname(pkgJson);
  return path.join(pkgDir, 'model');
}

async function main() {
  const srcDir = resolveFaceApiModelsDir();
  const dstDir = path.join(__dirname, '..', 'models');

  if (!(await fs.pathExists(srcDir))) {
    throw new Error(`Source model dir not found: ${srcDir}`);
  }

  await fs.ensureDir(dstDir);

  // Keep minimal required set for our pipeline:
  // - ssdMobilenetv1: detection
  // - faceLandmark68Net: landmarks
  // - faceRecognitionNet: descriptor embedding
  const allow = new Set([
    'ssd_mobilenetv1_model-weights_manifest.json',
    'ssd_mobilenetv1_model.bin',
    'face_landmark_68_model-weights_manifest.json',
    'face_landmark_68_model.bin',
    'face_recognition_model-weights_manifest.json',
    'face_recognition_model.bin',
  ]);

  const files = (await fs.readdir(srcDir)).filter((f) => allow.has(f));
  if (!files.length) {
    throw new Error(`No model files found in ${srcDir} (package layout changed?)`);
  }

  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await fs.copy(path.join(srcDir, f), path.join(dstDir, f), { overwrite: true });
  }

  console.log(`[models] copied ${files.length} files to ${dstDir}`);
  console.log('[models] done');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


