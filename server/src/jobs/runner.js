/**
 * input: 任务请求 + 配置/DB
 * output: 任务调度/存储/生命周期管理
 * pos: 服务端任务系统：编排后台作业（变更需同步更新本头注释与所属目录 README）
 */

const { loadConfig, getEnabledRoots } = require('../configStore');
const { getHandler } = require('./handlers');
const {
  interruptStaleRunningJobs,
  pickNextQueuedJob,
  startJob,
  heartbeat,
  finishJob,
  failJob,
  isCancelRequested,
  setCheckpoint,
  getCheckpoint,
  createJob,
} = require('./store');

let _running = false;
let _timer = null;

const SUCCESS_COUNT_KEYS = [
  'ok',
  'updated',
  'changed',
  'added',
  'removed',
  'cleaned',
  'scanned',
  'embedded',
  'moved',
  'deleted',
];

function numericValue(value) {
  if (typeof value === 'boolean') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getSuccessCount(result) {
  if (!result || typeof result !== 'object') return 0;
  let total = 0;
  for (const key of SUCCESS_COUNT_KEYS) {
    total += numericValue(result[key]);
  }
  const report = result.report && typeof result.report === 'object' ? result.report : null;
  if (report) {
    for (const key of SUCCESS_COUNT_KEYS) {
      total += numericValue(report[key]);
    }
  }
  return total;
}

function classifyJobResult(result) {
  if (result?.blocked) {
    const reason = String(result.blockedReason || 'job_blocked');
    const message = String(result.message || result.lastError || reason);
    return { status: 'failed', error: `${reason}: ${message}` };
  }
  const total = numericValue(result?.total);
  const errors = numericValue(result?.errors);
  if (total > 0 && errors >= total && getSuccessCount(result) === 0) {
    const lastError = result?.lastError ? `; last error: ${String(result.lastError)}` : '';
    return { status: 'failed', error: `job_failed_all_items: ${errors}/${total} items failed${lastError}` };
  }
  return { status: 'finished' };
}

function makeCtx(job) {
  return {
    job,
    async loadConfig() {
      return await loadConfig();
    },
    async getEnabledRoots() {
      const cfg = await loadConfig();
      return getEnabledRoots(cfg);
    },
    heartbeat(patch) {
      heartbeat(job.id, patch);
    },
    isCancelRequested() {
      return isCancelRequested(job.id);
    },
    setCheckpoint(key, value) {
      setCheckpoint(job.id, key, value);
    },
    getCheckpoint(key) {
      return getCheckpoint(job.id, key);
    },
    enqueue(type, mode, params) {
      return createJob({ type, mode, params });
    },
  };
}

async function runOne(job) {
  const ok = startJob(job.id);
  if (!ok) return;

  const handler = getHandler(job.type);
  if (!handler) {
    failJob(job.id, new Error(`Unknown job type: ${String(job.type)}`));
    return;
  }

  const ctx = makeCtx(job);
  try {
    ctx.heartbeat({ phase: 'start' });
    const result = await handler(ctx);
    if (ctx.isCancelRequested()) {
      finishJob(job.id, { status: 'cancelled', result: { cancelled: true, result } });
      return;
    }
    const classification = classifyJobResult(result);
    if (classification.status === 'failed') {
      failJob(job.id, new Error(classification.error));
      return;
    }
    finishJob(job.id, { status: 'finished', result });
  } catch (e) {
    if (ctx.isCancelRequested()) {
      finishJob(job.id, { status: 'cancelled', result: { cancelled: true } });
      return;
    }
    failJob(job.id, e);
  }
}

async function tick() {
  if (_running) return;
  _running = true;
  try {
    // Jobs like CLIP embedding can spend minutes in one inference step (model warmup/download).
    // Stale interruption should be conservative to avoid killing healthy long-running jobs.
    interruptStaleRunningJobs({ staleAfterMs: 60 * 60_000 });
    const job = pickNextQueuedJob();
    if (job) {
      await runOne(job);
    }
  } finally {
    _running = false;
  }
}

function startJobRunner({ pollIntervalMs = 500 } = {}) {
  if (_timer) return;
  _timer = setInterval(() => {
    tick().catch(() => {});
  }, Math.max(200, Number(pollIntervalMs) || 500));
  tick().catch(() => {});
}

module.exports = { startJobRunner, classifyJobResult };
