/**
 * input: Express req/res + DB + 服务层
 * output: Express Router（HTTP API）
 * pos: 服务端路由层：把请求映射为领域动作（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const { isValidJobType, isValidJobMode } = require('../jobs/constants');
const {
  createJob,
  getJobById,
  listJobs,
  requestCancel,
  setJobQueued,
} = require('../jobs/store');

const router = express.Router();

router.get('/', (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : 50;
  const offset = req.query.offset != null ? Number(req.query.offset) : 0;
  const status = req.query.status != null ? String(req.query.status) : null;
  const type = req.query.type != null ? String(req.query.type) : null;
  const jobs = listJobs({ limit, offset, status, type });
  res.json({ data: jobs });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const job = getJobById(id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  res.json(job);
});

router.post('/', (req, res) => {
  const type = String(req.body?.type || '').trim();
  const mode = String(req.body?.mode || 'missing').trim();
  const params = req.body?.params || {};

  if (!isValidJobType(type)) return res.status(400).json({ error: 'Invalid type' });
  if (!isValidJobMode(mode)) return res.status(400).json({ error: 'Invalid mode' });

  const job = createJob({ type, mode, params });
  res.json(job);
});

router.post('/:id/cancel', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const ok = requestCancel(id);
  res.json({ success: ok });
});

router.post('/:id/retry', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const job = getJobById(id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  // clone as a new job
  const next = createJob({ type: job.type, mode: job.mode, params: job.params || {} });
  res.json(next);
});

router.post('/:id/requeue', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  setJobQueued(id);
  res.json({ success: true });
});

module.exports = router;


