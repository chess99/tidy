const exifr = require('exifr');
const fs = require('fs-extra');

async function extractMetadata(filePath) {
  try {
    // fast: true - only reads the first few chunks
    const output = await exifr.parse(filePath, {
      tiff: true,
      ifd0: true,
      exif: true,
      gps: true,
      mergeOutput: true
    });

    if (!output) return null;

    const taken_at = output.DateTimeOriginal || output.CreateDate || output.ModifyDate;
    
    return {
      width: output.ExifImageWidth,
      height: output.ExifImageHeight,
      taken_at: taken_at ? new Date(taken_at).getTime() : null,
      camera_make: output.Make,
      camera_model: output.Model,
      lat: output.latitude,
      lon: output.longitude
    };
  } catch (err) {
    // console.warn(`Failed to extract EXIF for ${filePath}:`, err.message);
    return null;
  }
}

module.exports = { extractMetadata };

