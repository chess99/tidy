const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const exifr = require('exifr');

const TEST_DIR = process.argv[2] || 'Z:\\photos';
const SAMPLES = 10;

async function measure(label, fn) {
  const start = performance.now();
  await fn();
  const end = performance.now();
  console.log(`${label}: ${(end - start).toFixed(2)}ms`);
}

async function runTest() {
  console.log(`Sampling ${SAMPLES} files from ${TEST_DIR}...`);
  
  // 1. Find some files
  const files = [];
  try {
      const dir = fs.opendirSync(TEST_DIR);
      let dirent;
      while ((dirent = dir.readSync()) !== null && files.length < SAMPLES) {
          if (dirent.isFile() && /\.(jpg|jpeg|png)$/i.test(dirent.name)) {
              files.push(path.join(TEST_DIR, dirent.name));
          }
      }
      dir.closeSync();
  } catch(e) {
      console.error("Error reading dir:", e.message);
      return;
  }

  if (files.length === 0) {
      console.log("No images found for test.");
      return;
  }

  console.log(`Testing with ${files.length} files.`);

  // Test IO Read
  await measure('IO (fs.stat)', async () => {
    for (const f of files) await fs.promises.stat(f);
  });

  // Test Hashing
  await measure('Hashing (MD5)', async () => {
    for (const f of files) {
      await new Promise((resolve) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(f);
        stream.on('data', d => hash.update(d));
        stream.on('end', resolve);
      });
    }
  });

  // Test EXIF
  await measure('EXIF Extraction', async () => {
    for (const f of files) {
      await exifr.parse(f, { tiff: true, ifd0: true, exif: true });
    }
  });
}

runTest();

