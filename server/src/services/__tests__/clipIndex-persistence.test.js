/**
 * input: small SQLite CLIP embedding set and binary HNSW persistence
 * output: rebuilt index can be loaded in a fresh process module instance and queried
 * pos: regression coverage for large-model index storage without JSON string limits
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

describe('CLIP index persistence', () => {
  test('round-trips an index through structured binary storage', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-clip-index-'));
    const dbModulePath = require.resolve('../../db');
    const clipIndexPath = require.resolve('../clipIndex');
    const configPath = require.resolve('../../config');
    const childScript = `
      process.env.DATA_DIR = ${JSON.stringify(tempDir)};
      process.env.DB_PATH = ${JSON.stringify(path.join(tempDir, 'tidy.db'))};
      process.env.TIDY_CLIP_MODEL_ID = 'test/clip-model';
      const fs = require('fs');
      const dbModulePath = ${JSON.stringify(dbModulePath)};
      const clipIndexPath = ${JSON.stringify(clipIndexPath)};
      const configPath = ${JSON.stringify(configPath)};
      (async () => {
        let dbModule = require(dbModulePath);
        dbModule.initDB();
        const db = dbModule.getDB();
        const clipIndex = require(clipIndexPath);
        const now = Date.now();
        db.prepare("INSERT INTO assets (hash, mime_type, status) VALUES (?, 'image/jpeg', 'inbox')").run('hash-1');
        db.prepare("INSERT INTO assets (hash, mime_type, status) VALUES (?, 'image/jpeg', 'inbox')").run('hash-2');
        const file1 = Number(db.prepare('INSERT INTO files (path, hash, missing) VALUES (?, ?, 0)').run('C:\\\\images\\\\one.jpg', 'hash-1').lastInsertRowid);
        const file2 = Number(db.prepare('INSERT INTO files (path, hash, missing) VALUES (?, ?, 0)').run('C:\\\\images\\\\two.jpg', 'hash-2').lastInsertRowid);
        const insert = db.prepare("INSERT INTO clip_embeddings (file_id, hash, model, dim, normalized, embedding, updated_at) VALUES (?, ?, 'test/clip-model', 2, 1, ?, ?)");
        insert.run(file1, 'hash-1', clipIndex.packF32([1, 0]), now);
        insert.run(file2, 'hash-2', clipIndex.packF32([0, 1]), now);
        const legacyPath = require('path').join(${JSON.stringify(tempDir)}, 'index', 'clip_hnsw.json');
        fs.mkdirSync(require('path').dirname(legacyPath), { recursive: true });
        fs.writeFileSync(legacyPath, '{"legacy":true}');
        const rebuilt = await clipIndex.rebuildIndex({ model: 'test/clip-model' });
        const binaryPrefix = fs.readFileSync(rebuilt.indexPath).subarray(0, 1).toString('utf8');
        const legacyExists = fs.existsSync(legacyPath);
        dbModule.closeDB();
        delete require.cache[dbModulePath];
        delete require.cache[clipIndexPath];
        delete require.cache[configPath];
        dbModule = require(dbModulePath);
        dbModule.initDB();
        const reloaded = require(clipIndexPath);
        const query = await reloaded.queryTopKByVector([1, 0], { model: 'test/clip-model', topK: 1 });
        dbModule.closeDB();
        console.log('RESULT ' + JSON.stringify({ rebuilt, binaryPrefix, legacyExists, query, file1 }));
      })().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    `;

    try {
      const output = execFileSync(process.execPath, ['-e', childScript], { encoding: 'utf8' });
      const resultLine = output.split(/\r?\n/).find((line) => line.startsWith('RESULT '));
      const result = JSON.parse(resultLine.slice('RESULT '.length));
      expect(result.rebuilt).toMatchObject({ ok: true, dim: 2, fileCount: 2 });
      expect(result.rebuilt.indexPath).toMatch(/clip_hnsw\.bin$/);
      expect(result.binaryPrefix).not.toBe('{');
      expect(result.legacyExists).toBe(false);
      expect(result.query.matches).toHaveLength(1);
      expect(result.query.matches[0].file_id).toBe(result.file1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
