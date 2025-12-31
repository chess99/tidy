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
    interruptStaleRunningJobs({ staleAfterMs: 30_000 });
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

module.exports = { startJobRunner };


