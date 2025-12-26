const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const mime = require('mime-types');
const { computeHash } = require('./hasher');
const { extractMetadata } = require('./metadata');
const { generateThumbnail } = require('./thumbnail');
const { getDB } = require('../db');

class Scanner {
  constructor() {
    this.queue = fastq.promise(this.processFile.bind(this), 4); // 4 concurrent files
    this.isScanning = false;
    this.stats = { scanned: 0, new: 0, updated: 0, errors: 0 };
  }

  async scanDirectory(dirPath) {
    if (this.isScanning) throw new Error('Scan already in progress');
    this.isScanning = true;
    this.stats = { scanned: 0, new: 0, updated: 0, errors: 0 };
    
    console.log(`Starting scan of ${dirPath}`);
    
    try {
      await this.walk(dirPath);
      await this.queue.drain();
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      this.isScanning = false;
      console.log('Scan complete', this.stats);
    }
  }

  async walk(dir) {
    const items = await fs.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          // Skip hidden folders like .Trash, .git
          if (item.startsWith('.')) continue;
          await this.walk(fullPath);
        } else if (stat.isFile()) {
          this.queue.push({ filePath: fullPath, stat });
        }
      } catch (e) {
        console.error(`Error accessing ${fullPath}:`, e.message);
      }
    }
  }

  async processFile({ filePath, stat }) {
    this.stats.scanned++;
    const db = getDB();
    
    // Check extension
    const mimeType = mime.lookup(filePath);
    if (!mimeType || !mimeType.startsWith('image/')) {
      return; // Skip non-images for now
    }

    try {
      // 1. Compute Hash
      const hash = await computeHash(filePath);

      // 2. Check Asset Logic
      const existingAsset = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
      
      let status = 'inbox';
      if (existingAsset) {
        // "Resurrection" check: if marked as trash, we might want to flag this file?
        // For now, we just respect the existing asset status.
        status = existingAsset.status;
      } else {
        // New Asset
        this.stats.new++;
        const metadata = await extractMetadata(filePath);
        const takenAt = metadata ? metadata.taken_at : stat.mtimeMs;
        
        db.prepare(`
          INSERT INTO assets (hash, mime_type, size, metadata, taken_at, status)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          hash,
          mimeType,
          stat.size,
          JSON.stringify(metadata),
          takenAt,
          'inbox'
        );

        // Generate Thumbnail for new assets
        await generateThumbnail(filePath, hash);
      }

      // 3. Update Files Table
      const existingFile = db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
      
      if (existingFile) {
        if (existingFile.hash !== hash) {
          // File changed content?
          db.prepare('UPDATE files SET hash = ?, scanned_at = ?, missing = 0 WHERE path = ?')
            .run(hash, Date.now(), filePath);
          this.stats.updated++;
        } else {
          db.prepare('UPDATE files SET scanned_at = ?, missing = 0 WHERE path = ?')
            .run(Date.now(), filePath);
        }
      } else {
        db.prepare('INSERT INTO files (path, hash, scanned_at) VALUES (?, ?, ?)')
          .run(filePath, hash, Date.now());
      }

    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
      this.stats.errors++;
    }
  }
}

module.exports = new Scanner();

