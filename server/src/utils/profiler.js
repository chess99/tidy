/**
 * input: Node 运行时（hrtime/cpuUsage/memoryUsage/perf_hooks）
 * output: 轻量 profiling 工具（分段耗时 + CPU/内存增量 + event loop 延迟）
 * pos: 服务端工具层：为路由/服务提供可观测性（变更需同步更新本头注释与所属目录 README）
 */

const { monitorEventLoopDelay } = require('perf_hooks');

function nowNs() {
  return process.hrtime.bigint();
}

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

function bytesToKb(n) {
  return Math.round((Number(n) || 0) / 1024);
}

function cpuToMs(cpu) {
  const user = Number(cpu?.user) || 0; // microseconds
  const system = Number(cpu?.system) || 0; // microseconds
  return (user + system) / 1000;
}

function snapshot() {
  return {
    t: nowNs(),
    cpu: process.cpuUsage(),
    mem: process.memoryUsage(),
  };
}

/**
 * Create a request-scoped profiler.
 *
 * - Always safe to construct; set `enabled:false` for near-zero overhead.
 * - Call `mark(name, extra?)` for checkpoints.
 * - Call `end(extra?)` once to finalize.
 */
function createProfiler({ enabled = true, name = 'request', requestId = null, eventLoop = true } = {}) {
  const on = !!enabled;
  const steps = [];

  const base = snapshot();
  let last = base;

  const loop = on && eventLoop ? monitorEventLoopDelay({ resolution: 20 }) : null;
  if (loop) loop.enable();

  function mark(stepName, extra = null) {
    if (!on) return;
    const s = snapshot();
    const delta = {
      ms: nsToMs(s.t - last.t),
      cpuMs: cpuToMs({ user: s.cpu.user - last.cpu.user, system: s.cpu.system - last.cpu.system }),
      rssDeltaKb: bytesToKb(s.mem.rss - last.mem.rss),
      heapUsedDeltaKb: bytesToKb(s.mem.heapUsed - last.mem.heapUsed),
      externalDeltaKb: bytesToKb(s.mem.external - last.mem.external),
    };
    const total = {
      ms: nsToMs(s.t - base.t),
      cpuMs: cpuToMs({ user: s.cpu.user - base.cpu.user, system: s.cpu.system - base.cpu.system }),
      rssDeltaKb: bytesToKb(s.mem.rss - base.mem.rss),
      heapUsedDeltaKb: bytesToKb(s.mem.heapUsed - base.mem.heapUsed),
      externalDeltaKb: bytesToKb(s.mem.external - base.mem.external),
    };
    steps.push({
      name: String(stepName || 'step'),
      ...delta,
      totalMs: total.ms,
      totalCpuMs: total.cpuMs,
      totalRssDeltaKb: total.rssDeltaKb,
      totalHeapUsedDeltaKb: total.heapUsedDeltaKb,
      totalExternalDeltaKb: total.externalDeltaKb,
      extra: extra || undefined,
    });
    last = s;
  }

  function end(extra = null) {
    if (!on) return null;
    mark('end', extra);
    if (loop) loop.disable();
    const lastStep = steps[steps.length - 1] || null;
    const out = {
      name,
      requestId: requestId || undefined,
      totalMs: lastStep ? lastStep.totalMs : 0,
      totalCpuMs: lastStep ? lastStep.totalCpuMs : 0,
      totalRssDeltaKb: lastStep ? lastStep.totalRssDeltaKb : 0,
      totalHeapUsedDeltaKb: lastStep ? lastStep.totalHeapUsedDeltaKb : 0,
      totalExternalDeltaKb: lastStep ? lastStep.totalExternalDeltaKb : 0,
      eventLoopDelay: loop
        ? {
            meanMs: nsToMs(loop.mean),
            maxMs: nsToMs(loop.max),
          }
        : undefined,
      steps,
    };
    return out;
  }

  async function wrap(stepName, fn, extra = null) {
    if (!on) return await fn();
    const t0 = snapshot();
    try {
      const r = await fn();
      const t1 = snapshot();
      const deltaMs = nsToMs(t1.t - t0.t);
      const cpuMs = cpuToMs({ user: t1.cpu.user - t0.cpu.user, system: t1.cpu.system - t0.cpu.system });
      steps.push({
        name: String(stepName || 'wrap'),
        ms: deltaMs,
        cpuMs,
        rssDeltaKb: bytesToKb(t1.mem.rss - t0.mem.rss),
        heapUsedDeltaKb: bytesToKb(t1.mem.heapUsed - t0.mem.heapUsed),
        externalDeltaKb: bytesToKb(t1.mem.external - t0.mem.external),
        totalMs: nsToMs(t1.t - base.t),
        totalCpuMs: cpuToMs({ user: t1.cpu.user - base.cpu.user, system: t1.cpu.system - base.cpu.system }),
        totalRssDeltaKb: bytesToKb(t1.mem.rss - base.mem.rss),
        totalHeapUsedDeltaKb: bytesToKb(t1.mem.heapUsed - base.mem.heapUsed),
        totalExternalDeltaKb: bytesToKb(t1.mem.external - base.mem.external),
        extra: extra || undefined,
      });
      last = t1;
      return r;
    } catch (e) {
      const t1 = snapshot();
      steps.push({
        name: String(stepName || 'wrap'),
        ms: nsToMs(t1.t - t0.t),
        cpuMs: cpuToMs({ user: t1.cpu.user - t0.cpu.user, system: t1.cpu.system - t0.cpu.system }),
        rssDeltaKb: bytesToKb(t1.mem.rss - t0.mem.rss),
        heapUsedDeltaKb: bytesToKb(t1.mem.heapUsed - t0.mem.heapUsed),
        externalDeltaKb: bytesToKb(t1.mem.external - t0.mem.external),
        totalMs: nsToMs(t1.t - base.t),
        totalCpuMs: cpuToMs({ user: t1.cpu.user - base.cpu.user, system: t1.cpu.system - base.cpu.system }),
        totalRssDeltaKb: bytesToKb(t1.mem.rss - base.mem.rss),
        totalHeapUsedDeltaKb: bytesToKb(t1.mem.heapUsed - base.mem.heapUsed),
        totalExternalDeltaKb: bytesToKb(t1.mem.external - base.mem.external),
        extra: { ...(extra || {}), error: String(e?.message || e) },
      });
      last = t1;
      throw e;
    }
  }

  return { enabled: on, mark, wrap, end };
}

module.exports = { createProfiler };


