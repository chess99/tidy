const fs = require('fs-extra');
const path = require('path');
const fastq = require('fastq');
const mime = require('mime-types');
const { computeHash } = require('./hasher');
const { extractMetadata } = require('./metadata');
const { extractVideoMetadata } = require('./videoMetadata');
const { generateThumbnail, getThumbnailPath, RAW_EXTS } = require('./thumbnail');
const { getDB } = require('../db');
const { MANAGED_ROOT, TRASH_DIR } = require('../config');

const QUEUE_CONCURRENCY = 4;

class Scanner {
  constructor() {
    this.queue = fastq.promise(this.processFile.bind(this), QUEUE_CONCURRENCY);
    this.isScanning = false;
    this.stats = { total: 0, walked: 0, scanned: 0, new: 0, updated: 0, skipped: 0, ignored: 0, errors: 0 };
  }

  _insertChange(entity, entityId, type) {
    try {
      const db = getDB();
      db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
        entity,
        String(entityId),
        type,
        Date.now()
      );
    } catch (e) {
      // ignore (changes table may not exist during early dev)
    }
  }

  _upsertFileDiscovered(filePath, stat) {
    const db = getDB();
    const now = Date.now();
    const ext = path.extname(filePath).toLowerCase() || null;
    const mimeGuess = mime.lookup(filePath) || null;

    const existing = db.prepare('SELECT id FROM files WHERE path = ?').get(filePath);
    if (existing) {
      db.prepare(`
        UPDATE files
        SET missing = 0,
            size = ?,
            mtime_ms = ?,
            ext = COALESCE(ext, ?),
            mime_guess = COALESCE(mime_guess, ?),
            updated_at = ?,
            discovered_at = COALESCE(discovered_at, ?)
        WHERE id = ?
      `).run(stat.size, stat.mtimeMs, ext, mimeGuess, now, now, existing.id);
      this._insertChange('file', existing.id, 'upsert');
      return existing.id;
    }

    const info = db.prepare(`
      INSERT INTO files (
        path, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash_status, thumb_status
      ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, 'pending', 'pending')
    `).run(filePath, stat.size, stat.mtimeMs, ext, mimeGuess, now, now);

    const id = info.lastInsertRowid;
    this._insertChange('file', id, 'upsert');
    return id;
  }

  async scanDirectory(dirPath) {
    if (this.isScanning) throw new Error('Scan already in progress');
    this.isScanning = true;
    this.stats = { total: 0, walked: 0, scanned: 0, new: 0, updated: 0, skipped: 0, ignored: 0, errors: 0 };
    
    console.log(`Starting scan of ${dirPath}`);
    try {
      // Ensure tool directories exist (best-effort).
      fs.ensureDirSync(MANAGED_ROOT);
      fs.ensureDirSync(TRASH_DIR);
    } catch {
      // ignore
    }
    
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
            // Skip managed root to avoid re-scanning files we already organized.
            if (this._isUnderManagedRoot(fullPath)) continue;
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
              if (this._isUnderManagedRoot(fullPath)) continue;
              await this.walk(fullPath);
            } else if (stat.isFile()) {
              this.stats.walked++; // DEBUG: Count walked files
              const fileId = this._upsertFileDiscovered(fullPath, stat);
              this.queue.push({ fileId, filePath: fullPath, stat });
            }
          } catch (e) {
            console.error(`Error accessing ${fullPath}:`, e.message);
          }
        }
    } catch (e) {
        console.error(`Error reading dir ${dir}:`, e.message);
    }
  }

  async processFile({ fileId, filePath, stat }) {
    if (!this.isScanning) return;

    this.stats.scanned++;
    const db = getDB();
    
    const mimeType = mime.lookup(filePath) || null;
    if (!mimeType || !mimeType.startsWith('image/')) {
      // Keep this counter as “non-image encountered” for now (still processed for hash).
      this.stats.ignored++;
    }

    try {
      const existingFile = fileId
        ? db.prepare('SELECT * FROM files WHERE id = ?').get(fileId)
        : db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
      
      let hash;

      if (existingFile) {
          if (stat.mtimeMs <= existingFile.scanned_at) {
              this.stats.skipped++;
              try {
                db.prepare('UPDATE files SET missing = 0, updated_at = ? WHERE id = ?').run(Date.now(), existingFile.id);
              } catch (e) {
                // ignore
              }

              // Backfill thumbnails even when file contents are unchanged:
              // this allows newly-added thumb strategies (e.g. RAW preview extraction) to apply on next scan.
              try {
                const hash = existingFile.hash;
                if (hash && existingFile.thumb_status !== 'ready') {
                  const thumbPath = getThumbnailPath(hash);
                  const thumbExists = await fs.pathExists(thumbPath);
                  if (!thumbExists) {
                    const mimeGuess = existingFile.mime_guess || mimeType || null;
                    const extLower = path.extname(filePath).toLowerCase();
                    const shouldTryThumb = (mimeGuess && String(mimeGuess).startsWith('image/')) || RAW_EXTS.has(extLower);
                    if (shouldTryThumb) {
                      // eslint-disable-next-line no-await-in-loop
                      const created = await generateThumbnail(filePath, hash, { ext: extLower });
                      if (created) {
                        db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(Date.now(), hash);
                        db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE id = ?').run('ready', Date.now(), existingFile.id);
                        this._insertChange('file', existingFile.id, 'thumb_ready');
                        this._insertChange('asset', hash, 'thumb_ready');
                      }
                    }
                  }
                }
              } catch {
                // ignore (best-effort)
              }

              this._insertChange('file', existingFile.id, 'upsert');
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
      }

      const metadata = mimeType && mimeType.startsWith('image/')
        ? await extractMetadata(filePath)
        : (mimeType && mimeType.startsWith('video/') ? await extractVideoMetadata(filePath) : null);

      const takenAt = (metadata && metadata.taken_at) ? metadata.taken_at : stat.mtimeMs;
      const cameraMake = metadata && metadata.camera_make ? String(metadata.camera_make) : null;
      const cameraModel = metadata && metadata.camera_model ? String(metadata.camera_model) : null;
      const isCamera = (cameraMake || cameraModel) ? 1 : 0;
      const now = Date.now();

      if (existingAsset) {
        db.prepare(`
          UPDATE assets
          SET mime_type = COALESCE(mime_type, ?),
              size = COALESCE(size, ?),
              metadata = COALESCE(metadata, ?),
              taken_at = COALESCE(taken_at, ?),
              camera_make = COALESCE(camera_make, ?),
              camera_model = COALESCE(camera_model, ?),
              is_camera = CASE
                WHEN COALESCE(is_camera, 0) = 1 THEN 1
                WHEN ? = 1 THEN 1
                ELSE COALESCE(is_camera, 0)
              END,
              updated_at = ?
          WHERE hash = ?
        `).run(
          mimeType,
          stat.size,
          JSON.stringify(metadata || {}),
          takenAt,
          cameraMake,
          cameraModel,
          isCamera,
          now,
          hash
        );
      } else {
        db.prepare(`
          INSERT INTO assets (hash, mime_type, size, metadata, taken_at, status, camera_make, camera_model, is_camera, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          hash,
          mimeType,
          stat.size,
          JSON.stringify(metadata || {}),
          takenAt,
          status,
          cameraMake,
          cameraModel,
          isCamera,
          now
        );
      }

      if (existingFile) {
        if (existingFile.hash !== hash) {
          this.stats.updated++;
        }
        db.prepare(`
          UPDATE files
          SET hash = ?,
              scanned_at = ?,
              updated_at = ?,
              missing = 0,
              hash_status = 'done'
          WHERE id = ?
        `).run(hash, now, now, existingFile.id);
        this._insertChange('file', existingFile.id, 'upsert');
      } else {
        const info = db.prepare(`
          INSERT INTO files (path, hash, scanned_at, missing, size, mtime_ms, ext, mime_guess, discovered_at, updated_at, hash_status, thumb_status)
          VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'done', 'pending')
        `).run(
          filePath,
          hash,
          now,
          stat.size,
          stat.mtimeMs,
          path.extname(filePath).toLowerCase() || null,
          mimeType,
          now,
          now
        );
        this._insertChange('file', info.lastInsertRowid, 'upsert');
      }

      this._insertChange('asset', hash, 'upsert');

      // Best-effort thumbnail:
      // - try for image/* (sharp supports most common images)
      // - also try for RAW extensions even if mime guess is missing/incorrect
      const extLower = path.extname(filePath).toLowerCase();
      const shouldTryThumb = (mimeType && mimeType.startsWith('image/')) || RAW_EXTS.has(extLower);
      if (shouldTryThumb) {
        const thumbPath = await generateThumbnail(filePath, hash, { ext: extLower });
        if (thumbPath) {
          try {
            db.prepare('UPDATE assets SET thumb_updated_at = ? WHERE hash = ?').run(Date.now(), hash);
            if (existingFile) {
              db.prepare('UPDATE files SET thumb_status = ?, thumb_updated_at = ? WHERE id = ?').run('ready', Date.now(), existingFile.id);
              this._insertChange('file', existingFile.id, 'thumb_ready');
            }
          } catch (e) {
            // ignore
          }
          this._insertChange('asset', hash, 'thumb_ready');
        } else if (existingFile) {
          try {
            db.prepare('UPDATE files SET thumb_status = ? WHERE id = ?').run('unsupported', existingFile.id);
          } catch (e) {
            // ignore
          }
        }
      } else if (existingFile) {
        try {
          db.prepare('UPDATE files SET thumb_status = ? WHERE id = ?').run('unsupported', existingFile.id);
        } catch (e) {
          // ignore
        }
      }

    } catch (err) {
      console.error(`Error processing ${filePath}:`, err);
      this.stats.errors++;
      try {
        if (fileId) db.prepare('UPDATE files SET hash_status = ? WHERE id = ?').run('error', fileId);
      } catch (e) {
        // ignore
      }
    }
  }

  _isUnderManagedRoot(p) {
    try {
      const managed = path.resolve(MANAGED_ROOT);
      const abs = path.resolve(p);
      // Case-insensitive on Windows; safe elsewhere.
      const m = managed.toLowerCase();
      const a = abs.toLowerCase();
      return a === m || a.startsWith(m + path.sep);
    } catch {
      return false;
    }
  }
}

module.exports = new Scanner();
