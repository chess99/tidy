const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const mime = require('mime-types');
const { computeHash } = require('./hasher');
const { extractMetadata } = require('./metadata');
const { generateThumbnail } = require('./thumbnail');
const { getDB } = require('../db');

const QUEUE_CONCURRENCY = 4;

class Scanner {
  constructor() {
    this.queue = fastq.promise(this.processFile.bind(this), QUEUE_CONCURRENCY);
    this.isScanning = false;
    this.stats = { total: 0, walked: 0, scanned: 0, new: 0, updated: 0, skipped: 0, ignored: 0, errors: 0 };
  }

  async scanDirectory(dirPath) {
    if (this.isScanning) throw new Error('Scan already in progress');
    this.isScanning = true;
    this.stats = { total: 0, walked: 0, scanned: 0, new: 0, updated: 0, skipped: 0, ignored: 0, errors: 0 };
    
    console.log(`Starting scan of ${dirPath}`);
    
    try {
      // Phase 1: Count files
      console.log('Counting files...');
      await this.countFiles(dirPath);
      console.log(`Found ${this.stats.total} files. Starting processing...`);

      // Phase 2: Process files
      await this.walk(dirPath);
      
      console.log(`Walk finished. Walked: ${this.stats.walked}. Waiting for queue drain...`);
      // NOTE: In fastq@1.x, `drain()` is NOT awaitable (returns undefined).
      // Use `drained()` which returns a Promise that resolves when the queue is empty and idle.
      await this.queue.drained();
    } catch (err) {
      console.error('Scan failed:', err);
      this.queue.kill();
    } finally {
      this.isScanning = false;
      console.log('Scan complete', this.stats);
    }
  }

  async countFiles(dir) {
    try {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            if (item.startsWith('.')) continue;
            await this.countFiles(fullPath);
          } else if (stat.isFile()) {
            this.stats.total++;
          }
        } catch (e) {
          // Ignore
        }
      }
    } catch (e) {
      // Ignore
    }
  }

  async walk(dir) {
    if (!this.isScanning) return;

    try {
        const items = await fs.readdir(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          try {
            const stat = await fs.stat(fullPath);
            if (stat.isDirectory()) {
              if (item.startsWith('.')) continue;
              await this.walk(fullPath);
            } else if (stat.isFile()) {
              this.stats.walked++; // DEBUG: Count walked files
              this.queue.push({ filePath: fullPath, stat });
            }
          } catch (e) {
            console.error(`Error accessing ${fullPath}:`, e.message);
          }
        }
    } catch (e) {
        console.error(`Error reading dir ${dir}:`, e.message);
    }
  }

  async processFile({ filePath, stat }) {
    if (!this.isScanning) return;

    this.stats.scanned++;
    const db = getDB();
    
    const mimeType = mime.lookup(filePath);
    if (!mimeType || !mimeType.startsWith('image/')) {
      this.stats.ignored++;
      return; 
    }

    try {
      const existingFile = db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
      
      let hash;

      if (existingFile) {
          if (stat.mtimeMs <= existingFile.scanned_at) {
              this.stats.skipped++;
              db.prepare('UPDATE files SET missing = 0 WHERE id = ?').run(existingFile.id);
              return;
          }
      }

      hash = await computeHash(filePath);

      const existingAsset = db.prepare('SELECT * FROM assets WHERE hash = ?').get(hash);
      
      let status = 'inbox';
      if (existingAsset) {
        status = existingAsset.status;
      } else {
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

        await generateThumbnail(filePath, hash);
      }

      if (existingFile) {
        if (existingFile.hash !== hash) {
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
