/**
 * input: AI capabilities + DB asset state + job queue
 * output: best-effort automatic recovery jobs for capabilities that became available
 * pos: server service boundary for non-destructive task auto-recovery
 */

const { getDB } = require('../db');
const { createQueuedJobIfNoActiveJob } = require('../jobs/store');
const { getAiCapabilities } = require('./aiCapabilities');

const CHECK_INTERVAL_MS = 60_000;

let lastCheckAt = 0;

function hasActiveFaceJob(db) {
  const row = db.prepare(`
    SELECT id
    FROM jobs
    WHERE type = 'faces_scan'
      AND status IN ('queued', 'running')
    LIMIT 1
  `).get();
  return !!row;
}

function countMissingFaceAssets(db) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM assets a
    WHERE a.mime_type LIKE 'image/%'
      AND a.status NOT IN ('trash', 'ignored')
      AND a.face_scanned_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM files f
        WHERE f.hash = a.hash
          AND f.missing = 0
          AND f.path IS NOT NULL
        LIMIT 1
      )
  `).get();
  return Number(row?.count || 0);
}

async function runTaskAutoRecovery({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_INTERVAL_MS) {
    return { checked: false, reason: 'interval' };
  }
  lastCheckAt = now;

  const capabilities = await getAiCapabilities();
  if (capabilities?.faces?.available !== true) {
    return {
      checked: true,
      facesQueued: false,
      reason: capabilities?.faces?.code || 'faces_unavailable',
    };
  }

  const db = getDB();
  if (hasActiveFaceJob(db)) {
    return { checked: true, facesQueued: false, reason: 'faces_job_active' };
  }

  const missingFaceAssets = countMissingFaceAssets(db);
  if (missingFaceAssets <= 0) {
    return {
      checked: true,
      facesQueued: false,
      reason: 'no_missing_face_assets',
      missingFaceAssets,
    };
  }

  const job = createQueuedJobIfNoActiveJob({
    type: 'faces_scan',
    mode: 'missing',
    params: { auto: true, reason: 'faces_capability_recovered' },
  });
  if (!job) {
    return { checked: true, facesQueued: false, reason: 'faces_job_active' };
  }

  return { checked: true, facesQueued: true, missingFaceAssets };
}

module.exports = { runTaskAutoRecovery, CHECK_INTERVAL_MS };
