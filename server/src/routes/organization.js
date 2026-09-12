const express = require("express");
const path = require("path");
const { getDB } = require("../db");
const { loadConfig } = require("../configStore");
const { readDraft } = require("../services/organization/store");
const service = require("../services/organization/service");
const { DEFAULT_RULES } = require("../services/organization/model");

const router = express.Router();
router.use(express.json({ limit: "8mb" }));
const route = (fn) => async (req, res) => {
  try {
    const cfg = await loadConfig();
    const roots = (cfg.scanRoots || [])
      .filter((r) => r.enabled)
      .map((r) => path.resolve(r.root));
    const root = path.resolve(
      String(req.body?.root || req.query.root || roots[0] || "."),
    );
    const key = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
    if (!roots.some((r) => key(r) === key(root)))
      return res.status(400).json({ error: "请选择已启用的扫描目录" });
    return res.json(await fn(req, { db: getDB(), cfg, root, roots }));
  } catch (error) {
    res.status(409).json({ error: error.message });
  }
};
router.get("/", async (req, res) => {
  try {
    const cfg = await loadConfig();
    const db = getDB();
    const roots = (cfg.scanRoots || [])
      .filter((r) => r.enabled)
      .map((r) => path.resolve(r.root));
    const root = roots.find((r) => r === req.query.root) || roots[0];
    const runs = root
      ? db
          .prepare(
            "SELECT id FROM organization_runs WHERE root = ? ORDER BY created_at DESC LIMIT 5",
          )
          .all(root)
          .map((r) => service.summary(service.runData(db, r.id)))
      : [];
    res.json({
      roots,
      root,
      draft: root ? readDraft(db, root) : null,
      rules: DEFAULT_RULES,
      history: root ? service.history(db, root) : [],
      runs,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
router.post(
  "/generate",
  route((req, { db, root }) =>
    service.generate(
      db,
      root,
      req.body.rules,
      req.body.revision || 0,
      req.body.previewOnly === true,
    ),
  ),
);
router.post(
  "/accept",
  route((req, { db, root }) => service.accept(db, root, req.body.candidateId)),
);
router.get(
  "/snapshots/:id",
  route((req, { db, root }) => {
    const row = db
      .prepare("SELECT data FROM directory_snapshots WHERE id = ? AND root = ?")
      .get(req.params.id, root);
    if (!row) throw new Error("找不到目录版本");
    return JSON.parse(row.data);
  }),
);
router.patch(
  "/draft",
  route((req, { db, root }) =>
    service.edit(db, root, req.body.assignments, req.body.revision),
  ),
);
router.post(
  "/preview",
  route((req, { db, root, cfg }) => service.prepare(db, root, cfg, req.body)),
);
router.get(
  "/runs/:id",
  route((req, { db, root }) => {
    const run = service.runData(db, req.params.id);
    if (run.root !== root) throw new Error("执行记录不属于当前目录");
    return service.summary(run);
  }),
);
router.post(
  "/runs/:id/apply",
  route((req, { db, root }) => {
    if (service.runData(db, req.params.id).root !== root)
      throw new Error("执行记录不属于当前目录");
    return service.execute(db, req.params.id);
  }),
);
router.get(
  "/runs/:id/moves",
  route((req, { db, root }) => {
    const run = service.runData(db, req.params.id);
    if (run.root !== root) throw new Error("执行记录不属于当前目录");
    const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
    return (run.moves || [])
      .slice(offset, offset + 200)
      .map((m) => ({ from: m.from, to: m.to, size: m.size }));
  }),
);
router.post(
  "/runs/:id/cancel",
  route((req, { db, root }) => {
    if (service.runData(db, req.params.id).root !== root)
      throw new Error("执行记录不属于当前目录");
    service.cancelPrepare(db, req.params.id);
    return { ok: true };
  }),
);
module.exports = router;
