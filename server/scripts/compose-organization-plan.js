const fs = require("fs-extra");
const path = require("path");
const Database = require("better-sqlite3");
const {
  generateAssignments,
  DEFAULT_RULES,
  folderPath,
  rulesOf,
  keyOf,
} = require("../src/services/organization/model");
const { exportPlan, importPlan } = require("../src/services/organization/plan");
const { CLIP_MODEL_ID } = require("../src/config");

function compose(draft, decisions, imageMatches = {}) {
  const rules = rulesOf({
    ...DEFAULT_RULES,
    ...decisions.rules,
    preserveNamed: false,
  });
  const automatic = generateAssignments(
    draft.bundles,
    rules,
    draft.assignments,
    {},
  );
  const assignments = { ...automatic };
  const references = (decisions.references || [])
    .map((r) => ({
      ...r,
      sourceFolder: folderPath(r.sourceFolder),
      folder: folderPath(r.folder),
    }))
    .sort((a, b) => b.sourceFolder.length - a.sourceFolder.length);
  const ownership = new Map();
  const referenceItems = new Map();
  const report = {
    referenceItems: 0,
    attachedItems: 0,
    imageThemeItems: 0,
    visualRenamedItems: 0,
    collisionItems: 0,
    retainedManual: 0,
  };
  for (const b of draft.bundles) {
    const ref = references.find(
      (r) =>
        b.originalFolder === r.sourceFolder ||
        b.originalFolder.startsWith(r.sourceFolder + "/"),
    );
    if (!ref) continue;
    ownership.set(b.id, ref);
    if (!referenceItems.has(ref.folder)) referenceItems.set(ref.folder, []);
    referenceItems.get(ref.folder).push(b);
    if (draft.assignments[b.id]?.manual) {
      report.retainedManual++;
      continue;
    }
    const suffix = b.originalFolder.slice(ref.sourceFolder.length);
    const nominal = ref.sourceFolder
      .split("/")
      .find((p) => /^\d{8}/.test(p))
      ?.slice(0, 4);
    const anomaly =
      nominal &&
      Number.isFinite(b.time) &&
      new Date(b.time).getUTCFullYear() !== Number(nominal);
    assignments[b.id] = {
      folder: ref.folder + (ref.preserveChildren === false ? "" : suffix),
      eventRoot: ref.eventRoot || ref.folder,
      kind: ref.kind || "event",
      reason: anomaly
        ? "目录标注与拍摄年份不一致，保留事件归属待核对"
        : ref.reason || "以已有事件目录为参照",
      review: Boolean(ref.review || anomaly),
      manual: true,
    };
    report.referenceItems++;
  }
  const autoGroups = new Map();
  for (const b of draft.bundles) {
    const a = automatic[b.id];
    if (!["event", "trip"].includes(a.kind)) continue;
    const key = a.eventRoot || a.folder;
    if (!autoGroups.has(key)) autoGroups.set(key, []);
    autoGroups.get(key).push(b);
  }
  for (const [group, items] of autoGroups) {
    const refs = new Set(
      items.map((b) => ownership.get(b.id)?.folder).filter(Boolean),
    );
    if (decisions.attachToReferences && refs.size === 1) {
      const target = [...refs][0];
      const known = referenceItems.get(target);
      const dated = known.map((b) => b.time).filter(Number.isFinite);
      if (
        dated.length &&
        items.filter((b) => ownership.has(b.id)).length >=
          Math.max(8, items.length * 0.2)
      ) {
        const from = Math.min(...dated);
        const to = Math.max(...dated);
        const cameras = new Set(
          known.map((b) => (b.camera || "").trim()).filter(Boolean),
        );
        if (to - from <= 21 * 86400000)
          for (const b of items) {
            if (
              ownership.has(b.id) ||
              draft.assignments[b.id]?.manual ||
              !cameras.has((b.camera || "").trim()) ||
              !Number.isFinite(b.time) ||
              b.time < from ||
              b.time > to + 2 * 3600000
            )
              continue;
            assignments[b.id] = {
              folder: `${target}/补充记录`,
              eventRoot: target,
              kind: "event",
              reason: "与已有事件在时间、设备及自动分组上吻合，待审核补入",
              review: true,
              manual: true,
            };
            report.attachedItems++;
          }
      }
    }
    const rename = decisions.groupNames?.find((n) => n.from === group);
    if (rename)
      for (const b of items) {
        if (
          ownership.has(b.id) ||
          draft.assignments[b.id]?.manual ||
          assignments[b.id].manual
        )
          continue;
        const target = folderPath(rename.to);
        assignments[b.id] = {
          ...assignments[b.id],
          folder: target + automatic[b.id].folder.slice(group.length),
          eventRoot: target,
          reason: String(rename.reason || "按代表画面命名，待审核整组").slice(
            0,
            300,
          ),
          review: true,
          manual: true,
        };
        report.visualRenamedItems++;
      }
  }
  for (const b of draft.bundles) {
    const match = imageMatches[b.id];
    if (
      !match ||
      ownership.has(b.id) ||
      draft.assignments[b.id]?.manual ||
      assignments[b.id].manual ||
      automatic[b.id].kind === "reference"
    )
      continue;
    assignments[b.id] = {
      folder: `${folderPath(match.folder)}/${Number.isFinite(b.time) ? new Date(b.time).getUTCFullYear() : "日期未定"}`,
      kind: "theme",
      reason: "主题参考图相似匹配，需审核归属",
      review: true,
      manual: true,
    };
    report.imageThemeItems++;
  }
  if (decisions.preserveUndatedSources)
    for (const b of draft.bundles) {
      if (
        assignments[b.id].kind !== "unresolved" ||
        draft.assignments[b.id]?.manual ||
        ownership.has(b.id)
      )
        continue;
      assignments[b.id] = {
        ...assignments[b.id],
        folder: `待确认/日期缺失/${b.originalFolder === "." ? "根目录" : b.originalFolder}`,
        reason: "日期不足以判断事件，保留来源目录供审核",
        manual: true,
      };
    }
  // Keep every physical file; isolate same-name sources into visible subdirectories instead of renaming or dropping a copy.
  for (let attempt = 0; attempt < 2; attempt++) {
    const destinations = new Map();
    const conflicted = new Set();
    for (const b of draft.bundles)
      for (const f of b.files) {
        const target =
          `${assignments[b.id].folder}/${path.posix.basename(f.relative)}`.toLowerCase();
        if (destinations.has(target)) {
          conflicted.add(destinations.get(target));
          conflicted.add(b.id);
        }
        destinations.set(target, b.id);
      }
    if (!conflicted.size) break;
    for (const b of draft.bundles)
      if (conflicted.has(b.id)) {
        if (draft.assignments[b.id]?.manual)
          throw new Error("已有人工固定目录发生同名冲突，请先处理");
        const a = assignments[b.id];
        const source =
          path.posix.basename(b.originalFolder) === "."
            ? "根目录"
            : path.posix.basename(b.originalFolder);
        assignments[b.id] = {
          ...a,
          folder: `${a.folder}/来源-${attempt ? keyOf(b.originalFolder).slice(0, 6) : source}`,
          eventRoot: a.eventRoot || a.folder,
          reason: "同名文件保留各自来源，待人工处理重复或命名",
          review: true,
          manual: true,
        };
        report.collisionItems++;
      }
  }
  const next = { ...draft, rules, assignments };
  const plan = exportPlan(next);
  importPlan(draft, plan);
  return { plan, report };
}
function imageThemes(draft, decisions, dbPath) {
  const policies = decisions.imageThemes || [];
  if (!policies.length) return {};
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        "SELECT hash, embedding, dim FROM clip_embeddings WHERE model = ? AND normalized = 1",
      )
      .all(CLIP_MODEL_ID);
    const matches = {};
    const byHash = new Map(draft.bundles.map((b) => [b.hash, b]));
    for (const policy of policies) {
      folderPath(policy.folder);
      if (
        !Number.isFinite(policy.minScore) ||
        policy.minScore < 0 ||
        policy.minScore > 1
      )
        throw new Error("参考图阈值无效");
      const seeds = rows.filter((r) => policy.hashes.includes(r.hash));
      if (!seeds.length) throw new Error("参考图缺少当前模型的向量");
      for (const row of rows) {
        const b = byHash.get(row.hash);
        if (!b?.camera) continue;
        let best = -1;
        for (const seed of seeds) {
          if (row.dim !== seed.dim) continue;
          let score = 0;
          for (let i = 0; i < row.dim; i++)
            score +=
              row.embedding.readFloatLE(i * 4) *
              seed.embedding.readFloatLE(i * 4);
          best = Math.max(best, score);
        }
        if (
          best >= policy.minScore &&
          (!matches[b.id] || matches[b.id].score < best)
        )
          matches[b.id] = { folder: policy.folder, score: best };
      }
    }
    return matches;
  } finally {
    db.close();
  }
}
async function main() {
  const args = process.argv.slice(2);
  const get = (name, fallback) => {
    const i = args.indexOf(name);
    return i < 0 ? fallback : args[i + 1];
  };
  const url = get("--url", "http://127.0.0.1:3001");
  const response = await fetch(`${url}/api/organization`);
  if (!response.ok) throw new Error(`读取草稿失败：${response.status}`);
  const { draft } = await response.json();
  if (!draft) throw new Error("请先生成草稿");
  const decisions = await fs.readJson(get("--decisions"));
  const { plan, report } = compose(
    draft,
    decisions,
    imageThemes(
      draft,
      decisions,
      get("--db", path.join(__dirname, "../../data/tidy.db")),
    ),
  );
  const output = path.resolve(
    get(
      "--output",
      path.join(__dirname, "../../data/organization-reviewed-plan.json"),
    ),
  );
  await fs.outputJson(output, plan, { spaces: 2 });
  await fs.outputJson(output.replace(/\.json$/, "-report.json"), report, {
    spaces: 2,
  });
  console.log(
    JSON.stringify({ output, ...report, groups: plan.groups.length }),
  );
  if (args.includes("--submit")) {
    const imported = await fetch(`${url}/api/organization/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        root: draft.root,
        revision: draft.revision,
        plan,
      }),
    });
    const candidate = await imported.json();
    if (!imported.ok) throw new Error(candidate.error);
    console.log(`candidate=${candidate.candidateId}`);
    if (args.includes("--accept")) {
      const accepted = await fetch(`${url}/api/organization/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          root: draft.root,
          candidateId: candidate.candidateId,
        }),
      });
      const saved = await accepted.json();
      if (!accepted.ok) throw new Error(saved.error);
      console.log(`draft_revision=${saved.revision}`);
    }
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { compose };
