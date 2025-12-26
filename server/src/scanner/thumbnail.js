const sharp = require('sharp');
const path = require('path');
const fs = require('fs-extra');

const THUMB_DIR = path.join(process.cwd(), 'data', 'thumbnails');

// Ensure thumb dir exists
fs.ensureDirSync(THUMB_DIR);

async function generateThumbnail(filePath, hash) {
  const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);

  if (await fs.pathExists(thumbPath)) {
    return thumbPath;
  }

  try {
    await sharp(filePath)
      .resize(300, 300, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toFile(thumbPath);
    return thumbPath;
  } catch (err) {
    console.error(`Failed to generate thumbnail for ${filePath}:`, err.message);
    return null;
  }
}

function getThumbnailPath(hash) {
  return path.join(THUMB_DIR, `${hash}.jpg`);
}

module.exports = { generateThumbnail, getThumbnailPath };

