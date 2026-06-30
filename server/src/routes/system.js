/**
 * input: Express req/res + AI capabilities + job store
 * output: system status API for AI readiness and latest background task state
 * pos: server route layer for system-level operational status
 */

const express = require('express');
const { getAiCapabilities } = require('../services/aiCapabilities');
const { listJobs } = require('../jobs/store');

const router = express.Router();
const PUBLIC_JOB_FIELDS = [
  'id',
  'type',
  'status',
  'progress',
  'last_error',
  'created_at',
  'updated_at',
  'started_at',
  'finished_at',
];

function toPublicJob(job) {
  if (!job) return null;
  return PUBLIC_JOB_FIELDS.reduce((publicJob, field) => {
    publicJob[field] = job[field] ?? null;
    return publicJob;
  }, {});
}

function latestJob(type) {
  const jobs = listJobs({ limit: 50, type });
  const job = jobs.find((candidate) => candidate?.type === type) || null;
  return toPublicJob(job);
}

function latestTask(type) {
  try {
    return { latest: latestJob(type) };
  } catch (error) {
    return {
      latest: null,
      error: String(error?.message || error || 'list_jobs_failed'),
    };
  }
}

router.get('/status', async (_req, res) => {
  const ai = await getAiCapabilities();
  res.json({
    ok: true,
    ai,
    tasks: {
      faces: latestTask('faces_scan'),
      clip: latestTask('clip_enrich'),
    },
  });
});

module.exports = router;
