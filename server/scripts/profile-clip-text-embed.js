/**
 * input: ai-service（/clip/text-embed?profile=1）+ Node fetch + CLI 参数
 * output: 并发请求并汇总每次的 totalMs / clip.slot.waitMs（排队）用于长尾定位
 * pos: 运维/调试脚本：AI 推理性能排查（变更需同步更新本头注释与所属目录 README）
 */
/* eslint-disable no-console */

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function pickStep(steps, name) {
  return (steps || []).find((s) => s && s.name === name) || null;
}

async function one({ url, text }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tidy-profile': '1' },
    body: JSON.stringify({ text, normalize: true }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${t || res.statusText}`);
  }
  const j = await res.json();
  const prof = j?.profile || null;
  const totalMs = Number(prof?.totalMs || 0);
  const slot = prof ? pickStep(prof.steps, 'clip.slot') : null;
  const waitMs = Number(slot?.extra?.waitMs || 0);
  const inflight = slot?.extra?.inflight ?? null;
  const concurrency = slot?.extra?.concurrency ?? null;
  return { totalMs, waitMs, inflight, concurrency };
}

async function main() {
  const args = parseArgs(process.argv);
  const base = String(args.base || 'http://127.0.0.1:8002').replace(/\/+$/, '');
  const text = String(args.text || args.t || '海');
  const concurrency = Math.max(1, Number(args.concurrency || args.c || 6));
  const url = `${base}/clip/text-embed?profile=1`;

  const startedAt = Date.now();
  const tasks = Array.from({ length: concurrency }).map(() => one({ url, text }));
  const results = await Promise.allSettled(tasks);
  const ok = [];
  const errs = [];
  for (const r of results) {
    if (r.status === 'fulfilled') ok.push(r.value);
    else errs.push(r.reason);
  }

  console.log('[clip.text-embed burst]', { base, text, concurrency, wallMs: Date.now() - startedAt });
  for (let i = 0; i < ok.length; i++) {
    const r = ok[i];
    console.log(` - #${i + 1}`, { totalMs: Math.round(r.totalMs), waitMs: Math.round(r.waitMs), inflight: r.inflight, conc: r.concurrency });
  }
  if (errs.length) {
    console.log(`[errors] ${errs.length}`);
    for (const e of errs) console.log(String(e?.message || e));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(String(e?.stack || e?.message || e));
  process.exitCode = 1;
});


