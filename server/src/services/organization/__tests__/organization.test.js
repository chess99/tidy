const Database = require("better-sqlite3");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const schema = require("../../../db/schema");
const { initOrganization, saveDraft, readDraft } = require("../store");
const {
  makeBundles,
  generateAssignments,
  folderPath,
  DEFAULT_RULES,
} = require("../model");
const { capture, sha256, planMoves, restoreTargets } = require("../filesystem");
const service = require("../service");

describe("organization proposals", () => {
  const root = path.resolve("test-photos");
  const row = (id, name, time, gps) => ({
    id,
    path: path.join(root, name),
    captured_local_ms: time,
    metadata: JSON.stringify(gps || {}),
    hash: String(id),
  });
  const start = Date.UTC(2020, 1, 1);
  test("RAW/JPG is one decision; filename dates and filesystem mtimes cannot manufacture events", () => {
    const bundles = makeBundles(
      [row(1, "DCIM/a.JPG"), row(2, "DCIM/a.DNG"), row(3, "IMG_20200101.jpg")],
      root,
    );
    expect(bundles).toHaveLength(2);
    expect(bundles.find((b) => b.name === "a.JPG").fileIds).toEqual([1, 2]);
    expect(
      Object.values(generateAssignments(bundles, DEFAULT_RULES)).every(
        (a) => a.folder === "待确认/日期缺失",
      ),
    ).toBe(true);
  });
  test("events, recurring places, themes, existing folders and missing dates remain distinguishable", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(i + 1, `DCIM/e${i}.jpg`, start + i * 10000, {
        lat: 25.1,
        lon: 102.7,
      }),
    );
    rows.push(
      ...Array.from({ length: 6 }, (_, i) =>
        row(i + 20, `phone/d${i}.jpg`, start + (i + 2) * 86400000, {
          lat: 25.1,
          lon: 102.7,
        }),
      ),
    );
    rows.push(row(30, "20161001 九寨沟/j.jpg", start));
    rows.push(row(31, "cat.jpg", start + 100 * 86400000));
    rows.push(row(32, "none.jpg"));
    const bundles = makeBundles(rows, root);
    const cat = bundles.find((b) => b.name === "cat.jpg");
    const result = generateAssignments(
      bundles,
      { ...DEFAULT_RULES, themes: [{ name: "猫", query: "宠物猫" }] },
      {},
      { [cat.id]: "猫" },
    );
    const counts = Object.values(result).reduce(
      (acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] || 0) + 1 }),
      {},
    );
    expect(counts).toEqual({
      event: 8,
      daily: 6,
      existing: 1,
      theme: 1,
      unresolved: 1,
    });
  });
  test("manual membership survives changed rules, unlocked assignments can be recomputed", () => {
    const bundles = makeBundles(
      [row(1, "a.jpg", start), row(2, "b.jpg", start + 1000)],
      root,
    );
    const fixed = { folder: "主题/贝塔", manual: true, review: false };
    const result = generateAssignments(
      bundles,
      { ...DEFAULT_RULES, minPhotos: 2 },
      { [bundles[0].id]: fixed },
    );
    expect(result[bundles[0].id]).toEqual(fixed);
    expect(result[bundles[1].id].kind).toBe("life");
  });
  test.each([
    "../escape",
    "/absolute",
    "a//b",
    "a/CON.txt",
    "a/b.",
    "C:/outside",
    "a/../b",
  ])("invalid folder %s is rejected", (value) =>
    expect(() => folderPath(value)).toThrow(),
  );
});

describe("directory versions and execution", () => {
  let db;
  let root;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "tidy-directory-version-"));
    db = new Database(":memory:");
    db.exec(schema);
    initOrganization(db);
  });
  afterEach(async () => {
    db.close();
    await fs.remove(root);
  });
  async function seed(relative, bytes = relative) {
    const file = path.join(root, relative);
    await fs.outputFile(file, bytes);
    const stat = await fs.stat(file);
    const hash = await sha256(file);
    db.prepare(
      "INSERT OR IGNORE INTO assets(hash, hash_algo, captured_local_ms) VALUES (?, 'sha256', ?)",
    ).run(hash, Date.UTC(2021, 0, 1));
    db.prepare(
      "INSERT INTO files(path, hash, hash_algo, size, mtime_ms) VALUES (?, ?, 'sha256', ?, ?)",
    ).run(file, hash, stat.size, stat.mtimeMs);
    return { hash, file };
  }
  async function wait(id, expected) {
    for (let i = 0; i < 1000; i++) {
      const r = service.runData(db, id);
      if (r.status === expected || r.status === "failed") return r;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("operation timed out");
  }
  async function draftTo(folder = "事件/2021/旅行") {
    const draft = await service.generate(db, root, DEFAULT_RULES, 0);
    return service.edit(
      db,
      root,
      Object.fromEntries(draft.bundles.map((b) => [b.id, { folder }])),
      draft.revision,
    );
  }
  test("application records before/after, includes sidecar; restore preserves new files and can be redone", async () => {
    const a = await seed("source/a.jpg");
    await fs.outputFile(path.join(root, "source/a.jpg.xmp"), "<xmp/>");
    await fs.ensureDir(path.join(root, "empty-kept"));
    const draft = await draftTo();
    const initial = await capture(db, root);
    const preview = await service.prepare(
      db,
      root,
      {},
      { revision: draft.revision },
    );
    expect((await wait(preview.id, "ready")).moves).toHaveLength(2);
    expect(service.history(db, root)).toHaveLength(0);
    await service.execute(db, preview.id);
    expect((await wait(preview.id, "done")).status).toBe("done");
    expect(await sha256(path.join(root, "事件/2021/旅行/a.jpg"))).toBe(a.hash);
    expect(
      await fs.pathExists(path.join(root, "事件/2021/旅行/a.jpg.xmp")),
    ).toBe(true);
    expect(readDraft(db, root).bundles[0].files[0].relative).toBe(
      "事件/2021/旅行/a.jpg",
    );
    const history = service.history(db, root);
    expect(history).toHaveLength(2);
    await seed("new/photo.jpg");
    const restore = await service.prepare(
      db,
      root,
      {},
      { snapshotId: history[1].snapshotId },
    );
    await wait(restore.id, "ready");
    await service.execute(db, restore.id);
    const result = await wait(restore.id, "done");
    expect(result.error).toBeNull();
    expect(result.status).toBe("done");
    expect(await fs.pathExists(a.file)).toBe(true);
    expect(await fs.pathExists(path.join(root, "new/photo.jpg"))).toBe(true);
    expect(await fs.pathExists(path.join(root, "empty-kept"))).toBe(true);
    expect(service.history(db, root)).toHaveLength(4); // external addition is checkpointed before restoring
    expect(initial.files).toHaveLength(2);
    const redo = await service.prepare(
      db,
      root,
      {},
      { snapshotId: history[0].snapshotId },
    );
    await wait(redo.id, "ready");
    await service.execute(db, redo.id);
    expect((await wait(redo.id, "done")).status).toBe("done");
    expect(await fs.pathExists(path.join(root, "事件/2021/旅行/a.jpg"))).toBe(
      true,
    );
  });
  test("snapshot deduplication reuses old states while restoration remains an append-only event", async () => {
    await seed("source/a.jpg");
    const draft = await draftTo();
    const preview = await service.prepare(
      db,
      root,
      {},
      { revision: draft.revision },
    );
    await wait(preview.id, "ready");
    await service.execute(db, preview.id);
    await wait(preview.id, "done");
    const history = service.history(db, root);
    const restore = await service.prepare(
      db,
      root,
      {},
      { snapshotId: history[1].snapshotId },
    );
    await wait(restore.id, "ready");
    await service.execute(db, restore.id);
    expect((await wait(restore.id, "done")).status).toBe("done");
    expect(
      db.prepare("SELECT count(*) n FROM directory_snapshots").get().n,
    ).toBe(2);
    expect(service.history(db, root)).toHaveLength(3);
  });
  test("disk drift invalidates preview; nothing is moved or overwritten", async () => {
    const a = await seed("a.jpg");
    const draft = await draftTo();
    const preview = await service.prepare(
      db,
      root,
      {},
      { revision: draft.revision },
    );
    await wait(preview.id, "ready");
    await fs.outputFile(path.join(root, "new.txt"), "new");
    await service.execute(db, preview.id);
    const result = await wait(preview.id, "done");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/已变化/);
    expect(await fs.pathExists(a.file)).toBe(true);
    expect(service.busy(db)).toBe(false);
  });
  test("duplicate basenames are blocked before a snapshot or move", async () => {
    await seed("one/a.jpg");
    await seed("two/a.jpg");
    const draft = await draftTo();
    const preview = await service.prepare(
      db,
      root,
      {},
      { revision: draft.revision },
    );
    const result = await wait(preview.id, "ready");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/重名/);
    expect(service.history(db, root)).toHaveLength(0);
  });
  test("interrupted stage resumes with integrity checks and keeps physical file identity", async () => {
    const a = await seed("source/a.jpg");
    const draft = await draftTo();
    const preview = await service.prepare(
      db,
      root,
      {},
      { revision: draft.revision },
    );
    await wait(preview.id, "ready");
    const run = service.runData(db, preview.id);
    run.started = true;
    run.stageRoot = `.tidy-stage-${run.id}`;
    run.moves[0].stage = `${run.stageRoot}/0`;
    run.status = "applying";
    await fs.ensureDir(path.join(root, run.stageRoot));
    await fs.move(a.file, path.join(root, run.moves[0].stage));
    db.prepare(
      "UPDATE organization_runs SET status = ?, data = ? WHERE id = ?",
    ).run(run.status, JSON.stringify(run), run.id);
    expect(service.summary(service.runData(db, run.id)).interrupted).toBe(true);
    await service.execute(db, run.id);
    expect((await wait(run.id, "done")).status).toBe("done");
    expect(db.prepare("SELECT path FROM files").get().path).toBe(
      path.join(root, "事件/2021/旅行/a.jpg"),
    );
  });
  test("swap plan supports cycles; no file identity is collapsed for identical content", async () => {
    await seed("a.jpg", "same");
    await seed("b.jpg", "same");
    const state = await capture(db, root);
    expect(new Set(state.files.map((f) => f.id)).size).toBe(2);
    expect(
      planMoves(state, { "a.jpg": "b.jpg", "b.jpg": "a.jpg" }),
    ).toHaveLength(2);
    expect(() => planMoves(state, { "a.jpg": "b.jpg" })).toThrow(/已有文件/);
    const changed = {
      ...state,
      files: [
        { ...state.files[0], relative: "new-a.jpg", hash: "changed" },
        state.files[1],
      ],
    };
    expect(restoreTargets(changed, state).skipped).toHaveLength(1);
  });
  test("draft optimistic revision prevents another window from overwriting decisions", async () => {
    await seed("a.jpg");
    const draft = await draftTo();
    expect(() => saveDraft(db, draft, draft.revision - 1)).toThrow(/另一窗口/);
  });
  test("a regenerated candidate does not change the draft until accepted and rejects stale acceptance", async () => {
    await seed("a.jpg");
    const draft = await draftTo();
    const candidate = await service.generate(
      db,
      root,
      { ...DEFAULT_RULES, dailyPeriod: "month" },
      draft.revision,
      true,
    );
    expect(readDraft(db, root).rules.dailyPeriod).toBe("year");
    const accepted = service.accept(db, root, candidate.candidateId);
    expect(accepted.rules.dailyPeriod).toBe("month");
    expect(Object.values(accepted.assignments)[0].folder).toBe(
      "事件/2021/旅行",
    );
    const another = await service.generate(
      db,
      root,
      DEFAULT_RULES,
      accepted.revision,
      true,
    );
    service.edit(db, root, {}, accepted.revision);
    expect(() => service.accept(db, root, another.candidateId)).toThrow(
      /另一窗口/,
    );
  });
  test("changed and missing historical files are not restored and fresh additions remain untouched", async () => {
    await seed("a.jpg");
    await seed("b.jpg");
    const snapshot = await capture(db, root);
    await fs.outputFile(path.join(root, "a.jpg"), "changed content");
    await fs.remove(path.join(root, "b.jpg"));
    await seed("new.jpg");
    const now = await capture(db, root);
    const restore = restoreTargets(now, snapshot);
    expect(restore.skipped).toHaveLength(2);
    expect(restore.targets).toEqual({});
    expect(restore.added).toBe(2);
  });
  test("symlink ancestors cannot redirect a move outside the root", async () => {
    const external = await fs.mkdtemp(path.join(os.tmpdir(), "tidy-outside-"));
    try {
      await fs.symlink(
        external,
        path.join(root, "link"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await expect(
        require("../filesystem").safePath(root, "link/a.jpg"),
      ).rejects.toThrow(/符号链接/);
      await expect(capture(db, root)).rejects.toThrow(/符号链接/);
    } finally {
      await fs.remove(path.join(root, "link"));
      await fs.remove(external);
    }
  });
  test("exclusive move never overwrites a pre-existing destination", async () => {
    const source = await seed("a.jpg");
    await fs.outputFile(path.join(root, "b.jpg"), "unrelated");
    await expect(
      require("../filesystem").moveExclusive(
        source.file,
        path.join(root, "b.jpg"),
        { hash: source.hash },
      ),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(root, "b.jpg"), "utf8")).toBe(
      "unrelated",
    );
    expect(await sha256(source.file)).toBe(source.hash);
  });
});
