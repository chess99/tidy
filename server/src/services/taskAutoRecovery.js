/**
 * input: AI capabilities + DB asset state + job queue
 * output: best-effort automatic recovery jobs for capabilities that became available
 * pos: server service boundary for non-destructive task auto-recovery
 */

const { getDB } = require('../db');
const { createQueuedJobIfNoActiveJob } = require('../jobs/store');
const { getAiCapabilities } = require('./aiCapabilities');

const CHECK_INTERVAL_MS = 60_000;
const FACE_AUTO_FAILURE_BACKOFF_MS = 10 * 60_000;

let lastCheckAt = 0;

function safeParseParamsJson(paramsJson) {
  if (paramsJson == null) return null;
  try {
    return JSON.parse(String(paramsJson));
  } catch {
    return null;
  }
}

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

function hasRecentFailedAutoFaceRecoveryJob(db, { now, failureBackoffMs = FACE_AUTO_FAILURE_BACKOFF_MS } = {}) {
  const windowMs = Math.max(0, Math.trunc(Number(failureBackoffMs) || 0));
  if (windowMs <= 0) {
    return false;
  }

  const rows = db.prepare(`
    SELECT params_json, finished_at, updated_at, created_at
    FROM jobs
    WHERE type = 'faces_scan'
      AND status = 'failed'
    ORDER BY COALESCE(finished_at, updated_at, created_at, 0) DESC, id DESC
    LIMIT 20
  `).all();

  for (const row of rows) {
    const params = safeParseParamsJson(row?.params_json);
    if (params?.auto !== true || params?.reason !== 'faces_capability_recovered') {
      continue;
    }

    const lastTouchedAt = [row?.finished_at, row?.updated_at, row?.created_at]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);

    if (lastTouchedAt != null && now - lastTouchedAt <= windowMs) {
      return true;
    }
  }

  return false;
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

async function runTaskAutoRecovery({ force = false, failureBackoffMs = FACE_AUTO_FAILURE_BACKOFF_MS } = {}) {
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
  if (hasRecentFailedAutoFaceRecoveryJob(db, { now, failureBackoffMs })) {
    return { checked: true, facesQueued: false, reason: 'recent_faces_auto_failure' };
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

module.exports = { runTaskAutoRecovery, CHECK_INTERVAL_MS, FACE_AUTO_FAILURE_BACKOFF_MS };
