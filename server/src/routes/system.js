/**
 * input: Express req/res + AI capabilities + job store
 * output: system status API for AI readiness and latest background task state
 * pos: server route layer for system-level operational status
 */

const express = require('express');
const { getAiCapabilities } = require('../services/aiCapabilities');
const { listJobs } = require('../jobs/store');

const router = express.Router();

function latestJob(type) {
  const jobs = listJobs({ limit: 50, type });
  return jobs.find((job) => job?.type === type) || null;
}

router.get('/status', async (_req, res) => {
  const ai = await getAiCapabilities();
  res.json({
    ok: true,
    ai,
    tasks: {
      faces: { latest: latestJob('faces_scan') },
      clip: { latest: latestJob('clip_enrich') },
    },
  });
});

module.exports = router;
