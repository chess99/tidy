const { exportPlan, exportCatalog, importPlan } = require("../plan");
const { DEFAULT_RULES } = require("../model");
const draft = {
  root: "/photos",
  revision: 1,
  rules: DEFAULT_RULES,
  bundles: ["a", "b"].map((id) => ({
    id,
    name: `${id}.jpg`,
    files: [{ relative: `source/${id}.jpg`, hash: id.repeat(64) }],
    originalFolder: "source",
  })),
  assignments: {
    a: { folder: "事件/旅行", kind: "event" },
    b: { folder: "日常", kind: "daily" },
  },
};
test("plan round-trip preserves ownership and catalog identity without trusting file paths from the document", () => {
  const plan = exportPlan(draft);
  plan.groups[0].folder = "主题/猫";
  plan.groups[0].fixed = true;
  plan.root = "/outside";
  const imported = importPlan(draft, plan);
  expect(imported.root).toBe("/photos");
  expect(imported.bundles).toBe(draft.bundles);
  expect(imported.assignments.a).toMatchObject({
    folder: "主题/猫",
    manual: true,
  });
  expect(exportCatalog(draft).catalogFingerprint).toBe(plan.catalogFingerprint);
});
test.each(["../escape", "/root", "X:/photos", "事件/NUL", "event//test"])(
  "invalid target %s is rejected",
  (folder) => {
    const p = exportPlan(draft);
    p.groups[0].folder = folder;
    expect(() => importPlan(draft, p)).toThrow();
  },
);
test("unknown IDs, duplicates, omissions and stale catalogs are rejected", () => {
  const unknown = exportPlan(draft);
  unknown.groups[0].ids = ["unknown"];
  expect(() => importPlan(draft, unknown)).toThrow(/未知/);
  const repeated = exportPlan(draft);
  repeated.groups[1].ids.push("a");
  expect(() => importPlan(draft, repeated)).toThrow(/重复/);
  const missing = exportPlan(draft);
  missing.groups.pop();
  expect(() => importPlan(draft, missing)).toThrow(/遗漏/);
  const stale = exportPlan(draft);
  stale.catalogFingerprint = "old";
  expect(() => importPlan(draft, stale)).toThrow(/清单已变化/);
});
test("a trip parent cannot reference an unrelated folder", () => {
  const p = exportPlan(draft);
  p.groups[0].eventRoot = "另一个目录";
  expect(() => importPlan(draft, p)).toThrow(/子目录/);
});
test("distinct physical instances with identical destination names are rejected", () => {
  const sameNames = {
    ...draft,
    bundles: draft.bundles.map((b, i) => ({
      ...b,
      files: [{ relative: `source${i}/image.jpg`, hash: b.id.repeat(64) }],
    })),
  };
  const p = exportPlan(sameNames);
  p.groups.forEach((g) => {
    g.folder = "事件/合并";
  });
  expect(() => importPlan(sameNames, p)).toThrow(/目标文件重名/);
});
test("export-import preserves unlocked machine suggestions", () => {
  const result = importPlan(draft, exportPlan(draft));
  expect(result.assignments.a.manual).toBe(false);
});
