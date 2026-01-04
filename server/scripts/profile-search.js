/**
 * input: 本地 server（/api/search）+ Node fetch + CLI 参数
 * output: 打印 /api/search 的 server/ai-service profiling 关键步骤摘要
 * pos: 运维/调试脚本：性能排查入口（变更需同步更新本头注释与所属目录 README）
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

async function main() {
  const args = parseArgs(process.argv);
  const base = String(args.base || 'http://localhost:5173').replace(/\/+$/, '');
  const query = String(args.query || args.q || '海');
  const page = Number(args.page || 1);
  const limit = Number(args.limit || 50);
  const topK = Number(args.topK || 1000);
  const minScore = args.minScore != null ? Number(args.minScore) : 0.51;

  const url = `${base}/api/search?profile=1`;
  const body = { query, page, limit, topK, minScore };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tidy-profile': '1' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  const j = await res.json();

  const prof = j?.profile || null;
  console.log('[search]', { total: j?.pagination?.total, returned: Array.isArray(j?.data) ? j.data.length : null });
  if (!prof) {
    console.log('No profile in response. Add ?profile=1 or header x-tidy-profile: 1.');
    return;
  }

  console.log('[server]', {
    totalMs: Number(prof.totalMs || 0),
    totalCpuMs: Number(prof.totalCpuMs || 0),
    eventLoopDelay: prof.eventLoopDelay || null,
  });

  const sInflight = pickStep(prof.steps, 'inflight');
  const sHttp = pickStep(prof.steps, 'ai.http');
  const sAnn = pickStep(prof.steps, 'clip.ann.done');
  const sDb = pickStep(prof.steps, 'db.files.batch');
  if (sInflight) console.log(' - inflight', sInflight.extra || null);
  if (sHttp) console.log(' - ai.http', { ms: sHttp.ms, extra: sHttp.extra || null });
  if (sAnn) console.log(' - ann', sAnn.extra || null);
  if (sDb) console.log(' - db.files.batch', { ms: sDb.ms, extra: sDb.extra || null });

  const endExtra = (Array.isArray(prof.steps) && prof.steps.length ? prof.steps[prof.steps.length - 1].extra : null) || {};
  const ai = endExtra.aiService || null;
  if (!ai) return;

  console.log('[ai-service]', { totalMs: ai.totalMs, totalCpuMs: ai.totalCpuMs, rssMaxKb: ai.rssMaxKb, device: j?.applied?.model ? undefined : undefined });
  const aiSlot = pickStep(ai.steps, 'clip.slot');
  const aiEnc = pickStep(ai.steps, 'clip.encode_text.model.encode_text') || pickStep(ai.steps, 'clip.encode_images.model.encode_image');
  if (aiSlot) console.log(' - clip.slot', aiSlot.extra || null);
  if (aiEnc) console.log(' - clip.encode.*', { ms: aiEnc.ms, cpuMs: aiEnc.cpuMs });
}

main().catch((e) => {
  console.error(String(e?.stack || e?.message || e));
  process.exitCode = 1;
});


