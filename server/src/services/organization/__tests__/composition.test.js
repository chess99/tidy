const { compose } = require("../../../../scripts/compose-organization-plan");
const { DEFAULT_RULES } = require("../model");
const bundle = (id, source) => ({
  id,
  name: "image.jpg",
  hash: id.repeat(64),
  camera: "camera",
  tags: "",
  time: Date.UTC(2024, 0, 1, 12),
  originalFolder: source,
  files: [{ relative: `${source}/image.jpg`, hash: id.repeat(64) }],
});
const draft = {
  root: "/photos",
  rules: DEFAULT_RULES,
  bundles: [bundle("a", "one"), bundle("b", "two")],
  assignments: {
    a: { folder: "before", kind: "event" },
    b: { folder: "before", kind: "event" },
  },
};
test("reference-assisted composition preserves source variants without dropping same-name files", () => {
  const { plan, report } = compose(draft, {
    references: [
      { sourceFolder: "one", folder: "事件/活动" },
      { sourceFolder: "two", folder: "事件/活动" },
    ],
  });
  expect(report.referenceItems).toBe(2);
  expect(new Set(plan.groups.map((g) => g.folder)).size).toBe(2);
  expect(plan.groups.flatMap((g) => g.ids).sort()).toEqual(["a", "b"]);
  expect(plan.groups.every((g) => g.folder.startsWith("事件/活动/来源-"))).toBe(
    true,
  );
});
test("composition respects existing user adjustments instead of overwriting them with reference rules", () => {
  const locked = {
    ...draft,
    assignments: {
      ...draft.assignments,
      a: { folder: "用户固定", manual: true, kind: "theme" },
    },
  };
  const { plan } = compose(locked, {
    references: [{ sourceFolder: "one", folder: "新建议" }],
  });
  expect(plan.groups.find((g) => g.ids.includes("a")).folder).toBe("用户固定");
});
