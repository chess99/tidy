/**
 * input: 任务请求 + 配置/DB
 * output: 任务调度/存储/生命周期管理
 * pos: 服务端任务系统：编排后台作业（变更需同步更新本头注释与所属目录 README）
 */

const { getDB } = require('../db');
const { JOB_STATUSES } = require('./constants');

function now() {
  return Date.now();
}

function safeJsonStringify(v) {
  try {
    return JSON.stringify(v ?? null);
  } catch {
    return JSON.stringify(String(v));
  }
}

function safeJsonParse(v) {
  if (v == null) return null;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

function normalizeJobRow(r) {
  if (!r) return null;
  return {
    ...r,
    params: safeJsonParse(r.params_json),
    progress: safeJsonParse(r.progress_json),
    result: safeJsonParse(r.result_json),
    params_json: undefined,
    progress_json: undefined,
    result_json: undefined,
  };
}

function createJob({ type, mode, params }) {
  const db = getDB();
  const ts = now();
  const info = db.prepare(`
    INSERT INTO jobs (type, mode, status, params_json, progress_json, result_json, last_error, cancel_requested, created_at, updated_at, started_at, finished_at, heartbeat_at)
    VALUES (?, ?, 'queued', ?, NULL, NULL, NULL, 0, ?, ?, NULL, NULL, NULL)
  `).run(String(type), String(mode), safeJsonStringify(params || {}), ts, ts);
  return getJobById(info.lastInsertRowid);
}

function getJobById(id) {
  const db = getDB();
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(Number(id));
  return normalizeJobRow(row);
}

function listJobs({ limit = 50, offset = 0, status, type } = {}) {
  const db = getDB();
  const lim = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const off = Math.max(0, Math.trunc(Number(offset) || 0));

  const where = [];
  const params = [];
  if (status) {
    const s = String(status);
    if (JOB_STATUSES.includes(s)) {
      where.push('status = ?');
      params.push(s);
    }
  }
  if (type) {
    where.push('type = ?');
    params.push(String(type));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT * FROM jobs
    ${whereSql}
    ORDER BY id DESC
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);
  return rows.map(normalizeJobRow);
}

function requestCancel(jobId) {
  const db = getDB();
  const ts = now();
  const r = db.prepare(`
    UPDATE jobs
    SET cancel_requested = 1, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(ts, Number(jobId));
  return r.changes > 0;
}

function setJobQueued(jobId) {
  const db = getDB();
  const ts = now();
  db.prepare(`
    UPDATE jobs
    SET status = 'queued', updated_at = ?, started_at = NULL, finished_at = NULL, heartbeat_at = NULL, cancel_requested = 0, last_error = NULL
    WHERE id = ?
  `).run(ts, Number(jobId));
}

function startJob(jobId) {
  const db = getDB();
  const ts = now();
  const r = db.prepare(`
    UPDATE jobs
    SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?, heartbeat_at = ?, last_error = NULL
    WHERE id = ? AND status = 'queued'
  `).run(ts, ts, ts, Number(jobId));
  return r.changes > 0;
}

function heartbeat(jobId, progressPatch = null) {
  const db = getDB();
  const ts = now();
  if (progressPatch) {
    const prev = db.prepare(`SELECT progress_json FROM jobs WHERE id = ?`).get(Number(jobId))?.progress_json;
    const oldProgress = safeJsonParse(prev) || {};
    const next = { ...oldProgress, ...progressPatch };
    db.prepare(`
      UPDATE jobs
      SET progress_json = ?, updated_at = ?, heartbeat_at = ?
      WHERE id = ? AND status = 'running'
    `).run(safeJsonStringify(next), ts, ts, Number(jobId));
    return;
  }
  db.prepare(`
    UPDATE jobs
    SET updated_at = ?, heartbeat_at = ?
    WHERE id = ? AND status = 'running'
  `).run(ts, ts, Number(jobId));
}

function finishJob(jobId, { status = 'finished', result = null } = {}) {
  const db = getDB();
  const ts = now();
  db.prepare(`
    UPDATE jobs
    SET status = ?, result_json = ?, updated_at = ?, finished_at = ?
    WHERE id = ?
  `).run(String(status), safeJsonStringify(result), ts, ts, Number(jobId));
}

function failJob(jobId, err) {
  const db = getDB();
  const ts = now();
  const msg = String(err?.message || err || 'job_failed');
  db.prepare(`
    UPDATE jobs
    SET status = 'failed', last_error = ?, updated_at = ?, finished_at = ?
    WHERE id = ?
  `).run(msg, ts, ts, Number(jobId));
}

function isCancelRequested(jobId) {
  const db = getDB();
  const r = db.prepare(`SELECT cancel_requested FROM jobs WHERE id = ?`).get(Number(jobId));
  return !!r?.cancel_requested;
}

function setCheckpoint(jobId, key, value) {
  const db = getDB();
  const ts = now();
  db.prepare(`
    INSERT INTO job_checkpoints (job_id, key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(job_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(Number(jobId), String(key), safeJsonStringify(value), ts);
}

function getCheckpoint(jobId, key) {
  const db = getDB();
  const row = db.prepare(`SELECT value_json FROM job_checkpoints WHERE job_id = ? AND key = ?`).get(Number(jobId), String(key));
  return safeJsonParse(row?.value_json);
}

function interruptStaleRunningJobs({ staleAfterMs = 30_000 } = {}) {
  const db = getDB();
  const ts = now();
  const cutoff = ts - Math.max(5_000, Math.trunc(Number(staleAfterMs) || 30_000));
  db.prepare(`
    UPDATE jobs
    SET status = 'interrupted', updated_at = ?, finished_at = COALESCE(finished_at, ?)
    WHERE status = 'running'
      AND COALESCE(heartbeat_at, 0) > 0
      AND heartbeat_at < ?
  `).run(ts, ts, cutoff);
}

function pickNextQueuedJob() {
  const db = getDB();
  const row = db.prepare(`
    SELECT *
    FROM jobs
    WHERE status = 'queued'
    ORDER BY id ASC
    LIMIT 1
  `).get();
  return normalizeJobRow(row);
}

module.exports = {
  createJob,
  getJobById,
  listJobs,
  requestCancel,
  setJobQueued,
  startJob,
  heartbeat,
  finishJob,
  failJob,
  isCancelRequested,
  setCheckpoint,
  getCheckpoint,
  interruptStaleRunningJobs,
  pickNextQueuedJob,
};


