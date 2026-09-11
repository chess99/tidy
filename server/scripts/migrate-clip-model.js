#!/usr/bin/env node
/**
 * input: source/target CLIP model ids + SQLite library DB + running ai-service
 * output: resumable target-model embeddings, rebuilt target index, and removed source-model derived rows
 * pos: standalone CLIP model migration runner; intentionally independent from the hot-reloaded job process
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_TARGET_MODEL = 'jinaai/jina-clip-v2';

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value == null || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function positiveInteger(value, fallback, name) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const fromModel = String(readOption(argv, '--from-model') || '').trim();
  const toModel = String(readOption(argv, '--to-model') || process.env.TIDY_CLIP_MODEL_ID || DEFAULT_TARGET_MODEL).trim();
  if (!fromModel) throw new Error('--from-model is required');
  if (!toModel) throw new Error('--to-model must not be empty');
  if (fromModel === toModel) throw new Error('source and target CLIP models must differ');

  return {
    fromModel,
    toModel,
    dbPath: readOption(argv, '--db'),
    aiUrl: String(readOption(argv, '--ai-url') || process.env.AI_SERVICE_URL || 'http://127.0.0.1:8002').replace(/\/+$/, ''),
    requestTimeoutMs: positiveInteger(readOption(argv, '--request-timeout-ms'), 5 * 60_000, '--request-timeout-ms'),
    retryDelayMs: positiveInteger(readOption(argv, '--retry-delay-ms'), 5_000, '--retry-delay-ms'),
    maxRetries: positiveInteger(readOption(argv, '--max-retries'), 120, '--max-retries'),
    progressEvery: positiveInteger(readOption(argv, '--progress-every'), 10, '--progress-every'),
    limit: readOption(argv, '--limit') == null ? null : positiveInteger(readOption(argv, '--limit'), null, '--limit'),
  };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    const prior = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (processExists(Number(prior?.pid))) {
      throw new Error(`another CLIP migration is already running (pid ${prior.pid})`);
    }
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== 'ENOENT' && !String(error?.message || '').includes('Unexpected')) throw error;
    if (error?.code !== 'ENOENT' && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }

  const fd = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
  fs.closeSync(fd);
  return () => {
    try {
      const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (Number(current?.pid) === process.pid) fs.unlinkSync(lockPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn(`[clip-migrate] could not release lock: ${error?.message || error}`);
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseError(status, body) {
  const detail = body?.detail || body?.error || body?.message || `HTTP ${status}`;
  return `ai-service error ${status}: ${String(detail)}`;
}

async function requestEmbedding({ aiUrl, imagePath, toModel, requestTimeoutMs, retryDelayMs, maxRetries }) {
  let transientFailures = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(`${aiUrl}/clip/image-embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_path: imagePath, normalize: true }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 400 || response.status === 404) {
        return { ok: false, permanent: true, error: responseError(response.status, body) };
      }
      if (!response.ok) throw new Error(responseError(response.status, body));
      if (String(body?.model || '').trim() !== toModel) {
        throw new Error(`CLIP model mismatch: expected ${toModel}, received ${String(body?.model || '<missing>')}`);
      }
      const embedding = Array.isArray(body?.embeddings?.[0]) ? body.embeddings[0].map(Number) : [];
      if (!embedding.length || embedding.some((value) => !Number.isFinite(value))) {
        throw new Error('ai-service returned an invalid embedding');
      }
      return {
        ok: true,
        model: toModel,
        normalized: body?.normalized === true,
        embedding,
      };
    } catch (error) {
      transientFailures += 1;
      if (transientFailures > maxRetries) throw error;
      console.warn(JSON.stringify({
        event: 'transient_retry',
        attempt: transientFailures,
        maxRetries,
        error: String(error?.message || error),
      }));
      await sleep(retryDelayMs);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function selectCandidates(db, targetModel, limit) {
  const limitSql = limit == null ? '' : 'LIMIT ?';
  const statement = db.prepare(`
    SELECT a.hash, (
      SELECT f.id
      FROM files f
      WHERE f.hash = a.hash AND f.missing = 0
      ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
      LIMIT 1
    ) AS file_id, (
      SELECT f.path
      FROM files f
      WHERE f.hash = a.hash AND f.missing = 0
      ORDER BY COALESCE(f.updated_at, 0) DESC, f.id DESC
      LIMIT 1
    ) AS path
    FROM assets a
    WHERE a.status NOT IN ('trash', 'ignored')
      AND a.mime_type LIKE 'image/%'
      AND EXISTS (
        SELECT 1 FROM files ff
        WHERE ff.hash = a.hash AND ff.missing = 0 AND ff.path IS NOT NULL
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM clip_embeddings ce
        WHERE ce.hash = a.hash AND ce.model = ?
      )
    ORDER BY a.captured_at DESC, a.hash ASC
    ${limitSql}
  `);
  return limit == null ? statement.all(targetModel) : statement.all(targetModel, limit);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.dbPath) process.env.DB_PATH = path.resolve(options.dbPath);
  process.env.AI_SERVICE_URL = options.aiUrl;
  process.env.TIDY_CLIP_MODEL_ID = options.toModel;

  const { DB_PATH } = require('../src/config');
  const { initDB, getDB, closeDB } = require('../src/db');
  const { packF32, rebuildIndex } = require('../src/services/clipIndex');
  const lockPath = path.join(path.dirname(DB_PATH), 'clip-model-migration.lock');
  const releaseLock = acquireLock(lockPath);

  let db;
  try {
    initDB();
    db = getDB();
    const candidates = selectCandidates(db, options.toModel, options.limit);
    const countsBefore = db.prepare('SELECT model, COUNT(*) AS count FROM clip_embeddings GROUP BY model').all();
    console.log(JSON.stringify({
      event: 'start',
      pid: process.pid,
      fromModel: options.fromModel,
      toModel: options.toModel,
      candidates: candidates.length,
      countsBefore,
      partialRun: options.limit != null,
    }));

    const upsert = db.prepare(`
      INSERT INTO clip_embeddings (file_id, hash, model, dim, normalized, embedding, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id) DO UPDATE SET
        hash=excluded.hash,
        model=excluded.model,
        dim=excluded.dim,
        normalized=excluded.normalized,
        embedding=excluded.embedding,
        updated_at=excluded.updated_at
    `);
    let embedded = 0;
    let skipped = 0;
    let permanentErrors = 0;
    const permanentErrorCounts = new Map();

    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      if (!item?.path || !fs.existsSync(item.path)) {
        skipped += 1;
      } else {
        const result = await requestEmbedding({ ...options, imagePath: String(item.path) });
        if (result.ok) {
          upsert.run(
            Number(item.file_id),
            String(item.hash),
            result.model,
            result.embedding.length,
            result.normalized ? 1 : 0,
            packF32(result.embedding),
            Date.now()
          );
          embedded += 1;
        } else {
          permanentErrors += 1;
          permanentErrorCounts.set(result.error, (permanentErrorCounts.get(result.error) || 0) + 1);
        }
      }

      const done = index + 1;
      if (done % options.progressEvery === 0 || done === candidates.length) {
        console.log(JSON.stringify({ event: 'progress', total: candidates.length, done, embedded, skipped, permanentErrors }));
      }
    }

    if (options.limit != null) {
      console.log(JSON.stringify({ event: 'partial_complete', embedded, skipped, permanentErrors }));
      return;
    }

    const indexResult = await rebuildIndex({ model: options.toModel });
    if (indexResult?.ok !== true) throw new Error(`target CLIP index rebuild failed: ${indexResult?.reason || 'unknown error'}`);

    const cleanup = db.transaction(() => {
      const embeddings = db.prepare('DELETE FROM clip_embeddings WHERE model = ?').run(options.fromModel).changes;
      const textEmbeddings = db.prepare('DELETE FROM clip_text_embeddings WHERE model = ?').run(options.fromModel).changes;
      return { embeddings, textEmbeddings };
    })();

    const targetCount = Number(db.prepare('SELECT COUNT(*) AS count FROM clip_embeddings WHERE model = ?').get(options.toModel)?.count || 0);
    const sourceCount = Number(db.prepare('SELECT COUNT(*) AS count FROM clip_embeddings WHERE model = ?').get(options.fromModel)?.count || 0);
    const targetDimensions = db.prepare('SELECT DISTINCT dim FROM clip_embeddings WHERE model = ? ORDER BY dim').all(options.toModel);
    const indexMeta = db.prepare("SELECT model, dim, normalized, file_count, built_at, index_path FROM clip_index_meta WHERE name = 'clip'").get();
    if (sourceCount !== 0) throw new Error(`source CLIP rows remain after cleanup: ${sourceCount}`);
    if (targetDimensions.length !== 1) throw new Error(`target CLIP rows have ${targetDimensions.length} distinct dimensions`);
    const targetDimension = Number(targetDimensions[0].dim);
    if (indexMeta?.model !== options.toModel || Number(indexMeta?.dim) !== targetDimension || Number(indexMeta?.file_count) !== targetCount) {
      throw new Error('target CLIP index verification failed');
    }

    console.log(JSON.stringify({
      event: 'complete',
      embedded,
      skipped,
      permanentErrors,
      permanentErrorCounts: Object.fromEntries(permanentErrorCounts),
      targetCount,
      cleanup,
      index: indexMeta,
    }));
  } finally {
    try {
      if (db) closeDB();
    } finally {
      releaseLock();
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ event: 'fatal', error: String(error?.stack || error) }));
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, responseError, selectCandidates };
