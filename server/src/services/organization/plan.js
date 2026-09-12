const path = require("path");
const { digest } = require("./filesystem");
const { folderPath, rulesOf } = require("./model");

function fingerprint(draft) {
  return digest(
    draft.bundles
      .map((b) => [
        b.id,
        b.files
          .map((f) => [f.relative, f.hash])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
}
function exportPlan(draft) {
  const groups = new Map();
  for (const b of draft.bundles) {
    const a = draft.assignments[b.id];
    const key = JSON.stringify([
      a.folder,
      a.reason,
      a.review,
      a.eventRoot,
      a.manual,
      a.kind,
    ]);
    if (!groups.has(key))
      groups.set(key, {
        folder: a.folder,
        reason: a.reason,
        review: Boolean(a.review),
        fixed: Boolean(a.manual),
        kind: a.kind,
        ...(a.eventRoot ? { eventRoot: a.eventRoot } : {}),
        ids: [],
      });
    groups.get(key).ids.push(b.id);
  }
  return {
    format: "tidy-plan",
    version: 1,
    catalogFingerprint: fingerprint(draft),
    rules: draft.rules,
    groups: [...groups.values()],
  };
}
function exportCatalog(draft) {
  return {
    format: "tidy-catalog",
    version: 1,
    rootLabel: path.basename(draft.root),
    catalogFingerprint: fingerprint(draft),
    items: draft.bundles.map((b) => ({
      id: b.id,
      name: b.name,
      time: b.time,
      gps: b.gps,
      camera: b.camera,
      tags: b.tags,
      sourceFolder: b.originalFolder,
      proposedFolder: draft.assignments[b.id].folder,
      files: b.files.map((f) => ({
        path: f.relative,
        sha256: f.hash,
        bytes: f.size,
      })),
    })),
  };
}
function importPlan(draft, input) {
  if (!input || input.format !== "tidy-plan" || input.version !== 1)
    throw new Error("需要 tidy-plan v1 格式的方案文件");
  if (input.catalogFingerprint !== fingerprint(draft))
    throw new Error("素材清单已变化，请重新导出后生成方案");
  if (
    !Array.isArray(input.groups) ||
    input.groups.length > draft.bundles.length
  )
    throw new Error("方案分组无效");
  const ids = new Set(draft.bundles.map((b) => b.id));
  const assignments = {};
  for (const group of input.groups) {
    const folder = folderPath(group?.folder);
    if (!Array.isArray(group.ids) || !group.ids.length)
      throw new Error("目录中必须包含素材 ID");
    if (group.review !== undefined && typeof group.review !== "boolean")
      throw new Error("review 必须为布尔值");
    if (group.fixed !== undefined && typeof group.fixed !== "boolean")
      throw new Error("fixed 必须为布尔值");
    if (
      group.kind !== undefined &&
      ![
        "existing",
        "event",
        "trip",
        "daily",
        "life",
        "theme",
        "reference",
        "unresolved",
      ].includes(group.kind)
    )
      throw new Error("分组类型无效");
    const eventRoot = group.eventRoot ? folderPath(group.eventRoot) : undefined;
    if (
      eventRoot &&
      folder !== eventRoot &&
      !folder.startsWith(eventRoot + "/")
    )
      throw new Error("事件目录必须包含其子目录");
    for (const id of group.ids) {
      if (typeof id !== "string" || !ids.has(id))
        throw new Error(`未知素材 ID：${String(id).slice(0, 60)}`);
      if (assignments[id]) throw new Error(`素材被重复分配：${id}`);
      assignments[id] = {
        folder,
        kind: group.kind || draft.assignments[id].kind,
        reason: String(group.reason || "导入的分组方案").slice(0, 300),
        manual: group.fixed ?? true,
        review: group.review ?? true,
        ...(eventRoot ? { eventRoot } : {}),
      };
    }
  }
  if (Object.keys(assignments).length !== ids.size)
    throw new Error(
      `方案遗漏 ${ids.size - Object.keys(assignments).length} 项素材；每项必须有且只有一个归属`,
    );
  const destinations = new Set();
  for (const b of draft.bundles)
    for (const f of b.files) {
      const target =
        `${assignments[b.id].folder}/${path.posix.basename(f.relative)}`.toLowerCase();
      if (destinations.has(target))
        throw new Error(`目标文件重名，请保留不同来源子目录：${target}`);
      destinations.add(target);
    }
  return {
    ...draft,
    assignments,
    rules: input.rules ? rulesOf(input.rules) : draft.rules,
    updatedAt: Date.now(),
    producer: "import",
  };
}

module.exports = { fingerprint, exportPlan, exportCatalog, importPlan };
