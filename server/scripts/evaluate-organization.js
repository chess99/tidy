const fs = require("fs-extra");
const path = require("path");
const { execFileSync } = require("child_process");
const Module = require("module");
const crypto = require("crypto");
const current = require("../src/services/organization/model");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const choose2 = (n) => (n * (n - 1)) / 2;
function referenceOf(b) {
  const parts = b.originalFolder.split("/");
  const index = parts.findIndex(
    (p) =>
      /^\d{8}[\s\u4e00-\u9fff_-]/.test(p) || /^\d{4}-\d{2}-\d{2}\s/.test(p),
  );
  return index < 0
    ? undefined
    : parts
        .slice(0, index + 1)
        .join("/")
        .replace(/[- ]导出$/, "");
}
function evaluate(bundles, assignments) {
  const references = new Map();
  const groups = new Map();
  for (const b of bundles) {
    const ref = referenceOf(b);
    if (ref) {
      if (!references.has(ref)) references.set(ref, []);
      references.get(ref).push(b);
    }
    const a = assignments[b.id];
    const key = a.eventRoot || a.folder;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const events = [...references].map(([name, items]) => {
    const partitions = new Map();
    for (const b of items) {
      const a = assignments[b.id];
      const key = a.eventRoot || a.folder;
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key).push(b);
    }
    const list = [...partitions].sort((a, b) => b[1].length - a[1].length);
    const [main, inside] = list[0];
    const members = groups.get(main);
    const times = items
      .map((b) => b.time)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const eventGroups = list.filter(([, bs]) =>
      ["event", "trip"].includes(assignments[bs[0].id].kind),
    );
    return {
      name,
      count: items.length,
      dated: times.length,
      spanDays: times.length
        ? +((times.at(-1) - times[0]) / 86400000).toFixed(2)
        : null,
      partitions: list.length,
      eventGroups: eventGroups.length,
      mainCount: inside.length,
      mainTotal: members.length,
      mainShare: +(inside.length / items.length).toFixed(3),
      mainKind: assignments[inside[0].id].kind,
      otherNamedEvents: [
        ...new Set(
          members.map(referenceOf).filter((ref) => ref && ref !== name),
        ),
      ],
      mainFolder: main,
      parts: list.map(([folder, bs]) => ({
        folder,
        count: bs.length,
        kind: assignments[bs[0].id].kind,
      })),
      pairRecall:
        items.length > 1
          ? +(
              eventGroups.reduce((sum, [, bs]) => sum + choose2(bs.length), 0) /
              choose2(items.length)
            ).toFixed(3)
          : null,
    };
  });
  const comparable = events.filter(
    (e) => e.count >= 8 && e.dated / e.count >= 0.8 && e.spanDays <= 30,
  );
  return {
    referenceEvents: events.length,
    comparableEvents: comparable.length,
    coherent80: comparable.filter(
      (e) =>
        e.mainShare >= 0.8 &&
        ["event", "trip"].includes(e.mainKind) &&
        !e.otherNamedEvents.length,
    ).length,
    coherent95: comparable.filter(
      (e) =>
        e.mainShare >= 0.95 &&
        ["event", "trip"].includes(e.mainKind) &&
        !e.otherNamedEvents.length,
    ).length,
    referencePairsRetained: +(
      comparable.reduce((s, e) => s + e.pairRecall * choose2(e.count), 0) /
      comparable.reduce((s, e) => s + choose2(e.count), 0)
    ).toFixed(3),
    groups: groups.size,
    directories: new Set(Object.values(assignments).map((a) => a.folder)).size,
    kinds: Object.values(assignments).reduce(
      (o, a) => ({ ...o, [a.kind]: (o[a.kind] || 0) + 1 }),
      {},
    ),
    events,
  };
}
async function main() {
  const response = await fetch(
    `${option("--url", "http://127.0.0.1:3001")}/api/organization`,
  );
  if (!response.ok) throw new Error(`读取草稿失败：${response.status}`);
  const { draft } = await response.json();
  if (!draft) throw new Error("请先生成目录草稿");
  const report = {
    generatedAt: new Date().toISOString(),
    catalogFingerprint: crypto
      .createHash("sha256")
      .update(JSON.stringify(draft.bundles.map((b) => [b.id, b.time, b.gps])))
      .digest("hex"),
    mode: "blind: preserveNamed=false, previous={}, themes=[]",
    runs: [],
  };
  const baseline = option("--baseline");
  const models = [["current", current]];
  if (baseline) {
    if (!/^[a-f0-9]{7,40}$/.test(baseline))
      throw new Error("baseline 必须为提交哈希");
    const source = execFileSync(
      "git",
      ["show", `${baseline}:server/src/services/organization/model.js`],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    );
    const compiled = new Module(
      path.join(__dirname, "../src/services/organization/baseline.cjs"),
    );
    compiled.paths = module.paths;
    compiled._compile(source, compiled.id);
    models.unshift([baseline, compiled.exports]);
  }
  for (const [version, model] of models) {
    const start = Date.now();
    const assignments = model.generateAssignments(
      draft.bundles,
      { ...model.DEFAULT_RULES, preserveNamed: false },
      {},
      {},
    );
    const result = evaluate(draft.bundles, assignments);
    report.runs.push({
      version,
      rules: model.DEFAULT_RULES,
      elapsedMs: Date.now() - start,
      ...result,
    });
    const { events, ...summary } = report.runs.at(-1);
    console.log(JSON.stringify(summary));
    const focus = option("--focus");
    if (focus)
      console.log(
        JSON.stringify(events.filter((e) => new RegExp(focus).test(e.name))),
      );
  }
  const output = option("--output");
  if (output) {
    await fs.outputJson(path.resolve(output), report, { spaces: 2 });
    console.log(`report=${path.resolve(output)}`);
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { evaluate };
