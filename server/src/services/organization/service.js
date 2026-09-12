const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { isUnder } = require("../fileSafety");
const { readDraft, saveDraft } = require("./store");
const {
  DEFAULT_RULES,
  rulesOf,
  folderPath,
  makeBundles,
  generateAssignments,
} = require("./model");
const {
  capture,
  canonical,
  digest,
  sha256,
  moveExclusive,
  safePath,
  planMoves,
  restoreTargets,
} = require("./filesystem");

const activeTasks = new Set();
const verificationEpoch = crypto.randomUUID();
const cancelledTasks = new Set();
const pausedTasks = new Set();
function checkPause(id) {
  if (pausedTasks.has(id))
    throw Object.assign(new Error("执行已暂停，可继续或恢复原目录"), {
      code: "PAUSED",
    });
}
function busy(db, exceptId = "") {
  if (
    !db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name = 'organization_runs'",
      )
      .get()
  )
    return false;
  return (
    db
      .prepare(
        "SELECT count(*) AS n FROM organization_runs WHERE (status IN ('preparing','applying','paused') OR (status = 'failed' AND json_extract(data, '$.started') = 1)) AND id != ?",
      )
      .get(exceptId).n > 0
  );
}
function runData(db, id) {
  const row = db
    .prepare("SELECT * FROM organization_runs WHERE id = ?")
    .get(id);
  if (!row) throw new Error("找不到执行记录");
  const run = { ...JSON.parse(row.data), status: row.status };
  if (run.beforeId)
    run.before = JSON.parse(
      db
        .prepare("SELECT data FROM directory_snapshots WHERE id = ?")
        .get(run.beforeId).data,
    );
  if (run.movesStored)
    run.moves = db
      .prepare(
        "SELECT data FROM organization_moves WHERE run_id = ? ORDER BY source",
      )
      .all(id)
      .map((m) => JSON.parse(m.data));
  return run;
}
function persist(db, run) {
  db.transaction(() => {
    if (run.before && !run.beforeId) {
      run.beforeId = digest([run.root, run.before.fingerprint]);
      db.prepare(
        "INSERT OR IGNORE INTO directory_snapshots VALUES (?, ?, ?, ?)",
      ).run(run.beforeId, run.root, Date.now(), JSON.stringify(run.before));
    }
    if (run.moves && !run.movesStored) {
      const insert = db.prepare(
        "INSERT INTO organization_moves VALUES (?, ?, ?)",
      );
      for (const move of run.moves)
        insert.run(run.id, move.from, JSON.stringify(move));
      run.movesStored = true;
    }
    const { before, moves, ...state } = run;
    db.prepare(
      "INSERT OR REPLACE INTO organization_runs VALUES (?, ?, ?, ?, ?)",
    ).run(run.id, run.root, run.status, run.createdAt, JSON.stringify(state));
  })();
}
function checkpointMove(db, run, move) {
  db.prepare(
    "UPDATE organization_moves SET data = ? WHERE run_id = ? AND source = ?",
  ).run(JSON.stringify(move), run.id, move.from);
}
function latestSnapshot(db, root) {
  const row = db
    .prepare(
      "SELECT s.data FROM directory_history h JOIN directory_snapshots s ON s.id = h.snapshot_id WHERE h.root = ? ORDER BY h.id DESC LIMIT 1",
    )
    .get(root);
  const cached =
    row ||
    db
      .prepare(
        "SELECT data FROM directory_snapshots WHERE root = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(root);
  return cached ? JSON.parse(cached.data) : undefined;
}
function remember(db, snapshot, label, runId) {
  const id = digest([snapshot.root, snapshot.fingerprint]);
  db.prepare(
    "INSERT OR IGNORE INTO directory_snapshots VALUES (?, ?, ?, ?)",
  ).run(id, snapshot.root, Date.now(), JSON.stringify(snapshot));
  const last = db
    .prepare(
      "SELECT snapshot_id FROM directory_history WHERE root = ? ORDER BY id DESC LIMIT 1",
    )
    .get(snapshot.root);
  if (last?.snapshot_id !== id)
    db.prepare(
      "INSERT INTO directory_history (root, snapshot_id, created_at, label, run_id) VALUES (?, ?, ?, ?, ?)",
    ).run(snapshot.root, id, Date.now(), label, runId || null);
  return id;
}
function history(db, root) {
  return db
    .prepare(
      "SELECT h.id, h.snapshot_id AS snapshotId, h.created_at AS createdAt, h.label, json_array_length(s.data, '$.files') AS files FROM directory_history h JOIN directory_snapshots s ON s.id = h.snapshot_id WHERE h.root = ? ORDER BY h.id DESC",
    )
    .all(root);
}
function summary(run) {
  return {
    id: run.id,
    root: run.root,
    status: run.status,
    direction: run.rollback ? "rollback" : "apply",
    started: Boolean(run.started),
    revision: run.revision,
    snapshotId: run.snapshotId,
    phase: run.phase,
    checked: run.checked,
    total: run.total,
    currentFile: run.currentFile,
    currentBytes: run.currentBytes,
    done: run.done || 0,
    error: run.error,
    interrupted:
      ["preparing", "applying"].includes(run.status) &&
      !activeTasks.has(run.id),
    totalMoves: (run.moves || []).length,
    directoryChanges: run.directoryChanges || [],
    moves: (run.moves || []).slice(0, 200).map((m) => ({
      from: m.from,
      to: m.to,
      size: m.size,
    })),
    skipped: run.skipped || [],
    added: run.added || 0,
    createdAt: run.createdAt,
  };
}
async function catalog(db, root) {
  const rows = db
    .prepare(
      `SELECT f.*, a.metadata, a.captured_local_ms, a.captured_at, a.camera_model,
    (SELECT group_concat(t.name, '|') FROM asset_tags at JOIN tags t ON t.id = at.tag_id WHERE at.hash = f.hash) AS tags
    FROM files f LEFT JOIN assets a ON a.hash = f.hash
    WHERE f.missing = 0 AND COALESCE(a.status, 'inbox') NOT IN ('trash', 'ignored')`,
    )
    .all()
    .filter((f) => isUnder(root, f.path));
  return makeBundles(rows, root);
}
async function themesFor(db, bundles, rules) {
  if (!rules.themes.length) return { matches: {}, notices: [] };
  const { clipTextEmbed } = require("../aiClient");
  const { CLIP_MODEL_ID } = require("../../config");
  const matches = {};
  const notices = [];
  try {
    const vectors = [];
    for (const theme of rules.themes) {
      const response = await clipTextEmbed({
        query: theme.query,
        normalize: true,
      });
      vectors.push({ name: theme.name, vector: response.embedding });
    }
    const q = db.prepare(
      "SELECT embedding, dim FROM clip_embeddings WHERE file_id = ? AND model = ?",
    );
    let missing = 0;
    for (const bundle of bundles) {
      const row = q.get(bundle.fileIds[0], CLIP_MODEL_ID);
      if (!row) {
        missing++;
        continue;
      }
      const scores = vectors
        .filter((v) => v.vector?.length === row.dim)
        .map((v) => {
          let score = 0;
          for (let i = 0; i < row.dim; i++)
            score += row.embedding.readFloatLE(i * 4) * v.vector[i];
          return { name: v.name, score };
        })
        .sort((a, b) => b.score - a.score);
      // Text-image scores are model-specific evidence, not probabilities. Ambiguous matches stay unassigned.
      if (
        scores[0]?.score >= 0.3 &&
        (!scores[1] || scores[0].score - scores[1].score >= 0.04)
      )
        matches[bundle.id] = scores[0].name;
    }
    if (missing)
      notices.push(
        `${missing} 项尚无当前模型的图像向量，主题仅使用已有标签和目录`,
      );
  } catch (error) {
    notices.push(`主题语义匹配不可用：${error.message}`);
  }
  return { matches, notices };
}
async function generate(db, root, input, revision, previewOnly = false) {
  if (busy(db)) throw new Error("整理检查或执行尚未结束");
  const old = readDraft(db, root);
  const rules = rulesOf(input || old?.rules || DEFAULT_RULES);
  const bundles = await catalog(db, root);
  const { matches, notices } = await themesFor(db, bundles, rules);
  const proposal = {
    root,
    rules,
    bundles,
    assignments: generateAssignments(bundles, rules, old?.assignments, matches),
    notices,
    updatedAt: Date.now(),
  };
  if (previewOnly) {
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT OR REPLACE INTO organization_candidates VALUES (?, ?, ?, ?)",
    ).run(root, id, revision, JSON.stringify(proposal));
    return { candidateId: id, draft: proposal };
  }
  return saveDraft(db, proposal, revision);
}
function accept(db, root, id) {
  if (busy(db)) throw new Error("整理检查或执行尚未结束");
  const candidate = db
    .prepare("SELECT * FROM organization_candidates WHERE root = ? AND id = ?")
    .get(root, id);
  if (!candidate) throw new Error("候选方案已失效，请重新生成");
  const result = saveDraft(db, JSON.parse(candidate.data), candidate.revision);
  db.prepare("DELETE FROM organization_candidates WHERE root = ?").run(root);
  return result;
}
function importCandidate(db, root, input, revision) {
  if (busy(db)) throw new Error("整理检查或执行尚未结束");
  const draft = readDraft(db, root);
  if (!draft || draft.revision !== revision)
    throw new Error("草稿已变化，请重新加载后导入");
  const proposal = require("./plan").importPlan(draft, input);
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT OR REPLACE INTO organization_candidates VALUES (?, ?, ?, ?)",
  ).run(root, id, revision, JSON.stringify(proposal));
  return { candidateId: id, draft: proposal };
}
function edit(db, root, patch, revision) {
  if (busy(db)) throw new Error("整理检查或执行尚未结束");
  const draft = readDraft(db, root);
  if (!draft) throw new Error("请先生成整理方案");
  const ids = new Set(draft.bundles.map((b) => b.id));
  const assignments = { ...draft.assignments };
  if (!patch || typeof patch !== "object" || Array.isArray(patch))
    throw new Error("调整内容无效");
  for (const [id, value] of Object.entries(patch)) {
    if (!ids.has(id)) throw new Error("分组已变化，请刷新后重试");
    assignments[id] = {
      ...assignments[id],
      folder: folderPath(value.folder),
      manual: value.manual !== false,
      review: Boolean(value.review),
      reason: value.manual === false ? "允许重新分组" : "手动指定",
    };
  }
  return saveDraft(
    db,
    { ...draft, assignments, updatedAt: Date.now() },
    revision,
  );
}
function exclusions(cfg, root) {
  return [cfg.workspace?.trashDir, require("../../config").DATA_DIR].filter(
    (p) => p && isUnder(root, p) && canonical(p) !== canonical(root),
  );
}
async function prepare(db, root, cfg, { revision, snapshotId } = {}) {
  if (busy(db)) throw new Error("已有整理执行未结束");
  if (
    db.prepare("SELECT count(*) n FROM jobs WHERE status = 'running'").get().n
  )
    throw new Error("后台扫描正在运行，请完成后再检查落盘变更");
  const draft = readDraft(db, root);
  if (!snapshotId && (!draft || draft.revision !== revision))
    throw new Error("草稿已变化，请重新打开变更预览");
  const run = {
    id: crypto.randomUUID(),
    root,
    createdAt: Date.now(),
    status: "preparing",
    revision,
    snapshotId,
    exclude: exclusions(cfg, root),
    phase: "检查目录",
  };
  persist(db, run);
  activeTasks.add(run.id);
  setImmediate(async () => {
    try {
      run.before = await capture(db, root, {
        shouldCancel: () => cancelledTasks.has(run.id),
        previous: latestSnapshot(db, root),
        exclude: run.exclude,
        progress: (p) => {
          Object.assign(run, p);
          persist(db, run);
        },
      });
      let targets = {};
      if (snapshotId) {
        const row = db
          .prepare(
            "SELECT data FROM directory_snapshots WHERE id = ? AND root = ?",
          )
          .get(snapshotId, root);
        if (!row) throw new Error("历史版本不属于当前目录");
        const old = JSON.parse(row.data);
        const restored = restoreTargets(run.before, old);
        targets = restored.targets;
        run.skipped = restored.skipped;
        run.added = restored.added;
        run.restoreDirectories = old.directories;
        run.directoryChanges = old.directories.filter(
          (d) => !run.before.directories.includes(d),
        );
      } else {
        const known = new Map(
          run.before.files.map((f) => [canonical(f.relative), f]),
        );
        for (const bundle of draft.bundles) {
          const assignment = draft.assignments[bundle.id];
          if (!assignment) throw new Error("方案中有未分配文件");
          const folder = folderPath(assignment.folder);
          for (const file of bundle.files) {
            const actual = known.get(canonical(file.relative));
            if (!actual || actual.hash !== file.hash)
              throw new Error(
                `文件已变化，请重新扫描并生成方案：${file.relative}`,
              );
            const targetFolder =
              assignment.kind === "existing" && !assignment.manual
                ? path.posix.dirname(actual.relative)
                : folder;
            targets[actual.relative] =
              `${targetFolder}/${path.posix.basename(actual.relative)}`;
            const stem = file.relative.replace(/\.[^.]+$/, "");
            const companions = [
              `${file.relative}.xmp`,
              ...["xmp", "aae", "dop", "pp3", "srt", "lrf", "thm"].map(
                (ext) => `${stem}.${ext}`,
              ),
            ];
            for (const side of companions) {
              const sidecar = known.get(canonical(side));
              if (sidecar)
                targets[sidecar.relative] =
                  `${targetFolder}/${path.posix.basename(sidecar.relative)}`;
            }
          }
        }
      }
      run.stageRoot = `.tidy-stage-${run.id}`;
      run.moves = planMoves(run.before, targets).map((m, i) => ({
        ...m,
        stage: `${run.stageRoot}/${i}`,
      }));
      for (const m of run.moves) {
        if (cancelledTasks.has(run.id))
          throw Object.assign(new Error("检查已取消"), { code: "CANCELLED" });
        await safePath(root, m.to);
      }
      run.status = "ready";
      run.phase = "变更已就绪";
    } catch (error) {
      run.status = error.code === "CANCELLED" ? "cancelled" : "failed";
      run.error = error.code === "CANCELLED" ? null : error.message;
    } finally {
      persist(db, run);
      activeTasks.delete(run.id);
      cancelledTasks.delete(run.id);
    }
  });
  return summary(run);
}
async function verifyFile(file, expected) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expected.size)
    throw new Error(`文件内容已变化：${file}`);
  const proof = expected.verified;
  // A same-volume move preserves the already-verified inode and bytes. Recheck content after restart or any identity/stat change.
  if (
    Number.isSafeInteger(stat.ino) &&
    stat.ino > 0 &&
    proof?.epoch === verificationEpoch &&
    proof.hash === expected.hash &&
    proof.ino === stat.ino &&
    proof.dev === stat.dev &&
    proof.mtime === stat.mtimeMs
  )
    return;
  if ((await sha256(file)) !== expected.hash)
    throw new Error(`文件内容已变化：${file}`);
  const after = await fs.lstat(file);
  if (
    after.ino !== stat.ino ||
    after.dev !== stat.dev ||
    after.size !== stat.size ||
    after.mtimeMs !== stat.mtimeMs
  )
    throw new Error(`文件在校验期间变化：${file}`);
  expected.verified = {
    epoch: verificationEpoch,
    ino: stat.ino,
    dev: stat.dev,
    mtime: stat.mtimeMs,
    hash: expected.hash,
  };
}
async function execute(db, id) {
  const run = runData(db, id);
  if (activeTasks.has(id)) return summary(run);
  if (run.rollback) return rollback(db, id);
  if (
    !["ready", "applying", "failed", "paused"].includes(run.status) ||
    !run.moves ||
    (run.status === "failed" && !run.started)
  )
    throw new Error("请重新检查变更");
  if (!run.started && busy(db, id)) throw new Error("已有整理执行未结束");
  if (
    db.prepare("SELECT count(*) n FROM jobs WHERE status = 'running'").get().n
  )
    throw new Error("后台扫描正在运行，请完成后再应用");
  run.status = "applying";
  run.phase = "核对磁盘状态";
  run.checked = 0;
  run.done = run.moves.filter((m) => m.phase === "done").length;
  run.error = null;
  persist(db, run);
  activeTasks.add(id);
  setImmediate(async () => {
    try {
      if (
        run.before.physicalRoot &&
        (await fs.realpath(run.root)) !== run.before.physicalRoot
      )
        throw new Error("目录挂载已变化，请恢复原挂载后继续");
      if (!run.started) {
        const draft = readDraft(db, run.root);
        if (!run.snapshotId && draft?.revision !== run.revision)
          throw new Error("草稿已变化，请重新检查变更");
        const actual = await capture(db, run.root, {
          previous: run.before,
          exclude: run.exclude,
          progress: (p) => {
            Object.assign(run, p);
            persist(db, run);
          },
        });
        if (actual.fingerprint !== run.before.fingerprint)
          throw new Error("磁盘目录已变化，请重新检查变更");
        run.checked = 0;
        run.total = run.moves.length;
        for (const m of run.moves) {
          checkPause(id);
          run.currentFile = m.from;
          await verifyFile(await safePath(run.root, m.from), m);
          run.checked = (run.checked || 0) + 1;
          run.phase = "校验原件";
          persist(db, run);
        }
        remember(db, run.before, "应用前状态", id);
        run.started = true;
        persist(db, run);
      }
      const moveDB = (m, to) => {
        if (!m.fileId) return;
        db.prepare(
          "UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?",
        ).run(to, Date.now(), m.fileId);
        db.prepare(
          "INSERT INTO changes (entity, entity_id, type, ts) VALUES ('file', ?, 'moved', ?)",
        ).run(String(m.fileId), Date.now());
      };
      // Stage all sources first to support swaps. Each checkpoint is durable; recovery verifies bytes before continuing.
      for (const m of run.moves) {
        checkPause(id);
        if (m.phase !== "source") continue;
        const from = await safePath(run.root, m.from);
        const stage = await safePath(run.root, m.stage);
        if (await fs.pathExists(stage)) {
          await verifyFile(stage, m);
          if (await fs.pathExists(from)) {
            await verifyFile(from, m);
            await fs.unlink(from);
          }
        } else {
          await verifyFile(from, m);
          await fs.ensureDir(path.dirname(stage));
          await moveExclusive(from, stage, m);
        }
        m.phase = "staged";
        moveDB(m, stage);
        checkpointMove(db, run, m);
        run.phase = "暂存文件";
        persist(db, run);
      }
      for (const m of run.moves) {
        checkPause(id);
        if (m.phase === "done") {
          await verifyFile(await safePath(run.root, m.to), m);
          continue;
        }
        const stage = await safePath(run.root, m.stage);
        const to = await safePath(run.root, m.to);
        if (await fs.pathExists(stage)) {
          await verifyFile(stage, m);
          if (await fs.pathExists(to)) {
            if (!m.delivering)
              throw new Error(`目标位置被其他文件占用：${m.to}`);
            await verifyFile(to, m);
            await fs.unlink(stage);
          } else {
            m.delivering = true;
            checkpointMove(db, run, m);
            await moveExclusive(stage, to, m);
          }
        }
        await verifyFile(to, m);
        m.phase = "done";
        moveDB(m, to);
        checkpointMove(db, run, m);
        run.done = (run.done || 0) + 1;
        run.phase = "应用目录";
        persist(db, run);
      }
      const stageDir = await safePath(run.root, run.stageRoot);
      if (await fs.pathExists(stageDir)) await fs.rmdir(stageDir);
      for (const dir of run.restoreDirectories || [])
        await fs.ensureDir(await safePath(run.root, dir));
      const touched = new Set();
      for (const move of run.moves) {
        let dir = path.posix.dirname(move.from);
        while (dir !== ".") {
          touched.add(dir);
          dir = path.posix.dirname(dir);
        }
      }
      for (const dir of [...touched].sort((a, b) => b.length - a.length)) {
        if (dir === "." || run.restoreDirectories?.includes(dir)) continue;
        try {
          await fs.rmdir(await safePath(run.root, dir));
        } catch (error) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code))
            throw error;
        }
      }
      const movedPaths = new Map(run.moves.map((m) => [m.from, m.to]));
      const remapped = {
        ...run.before,
        files: run.before.files.map((f) => ({
          ...f,
          relative: movedPaths.get(f.relative) || f.relative,
        })),
      };
      const after = await capture(db, run.root, {
        exclude: run.exclude,
        previous: remapped,
      });
      const verifiedPaths = new Map(
        after.files.map((f) => [f.relative, f.hash]),
      );
      for (const m of run.moves)
        if (verifiedPaths.get(m.to) !== m.hash)
          throw new Error("应用后目录校验失败");
      db.transaction(() => {
        const draft = readDraft(db, run.root);
        if (draft && !run.snapshotId) after.rules = draft.rules;
        const snapshotId = remember(
          db,
          after,
          run.snapshotId ? "恢复历史目录" : "应用整理方案",
          id,
        );
        if (draft && !run.snapshotId) {
          saveDraft(
            db,
            {
              ...draft,
              appliedSnapshot: snapshotId,
              bundles: draft.bundles.map((b) => {
                const files = b.files.map((f) => {
                  const relative = movedPaths.get(f.relative) || f.relative;
                  return {
                    ...f,
                    relative,
                    path: path.join(run.root, relative),
                  };
                });
                return {
                  ...b,
                  files,
                  originalFolder: path.posix.dirname(files[0].relative),
                };
              }),
            },
            draft.revision,
          );
        } else
          db.prepare("DELETE FROM organization_drafts WHERE root = ?").run(
            run.root,
          );
        run.status = "done";
        run.phase = "已完成";
        persist(db, run);
      })();
    } catch (error) {
      run.status = error.code === "PAUSED" ? "paused" : "failed";
      run.error = error.message;
    } finally {
      persist(db, run);
      activeTasks.delete(id);
      pausedTasks.delete(id);
    }
  });
  return summary(run);
}
function cancelPrepare(db, id) {
  const run = runData(db, id);
  if (activeTasks.has(id) && run.status === "preparing") {
    cancelledTasks.add(id);
    return;
  }
  if (activeTasks.has(id) || run.started) throw new Error("正在执行，无法取消");
  run.status = "cancelled";
  persist(db, run);
}
function pause(db, id) {
  const run = runData(db, id);
  if (!activeTasks.has(id) || run.status !== "applying")
    throw new Error("当前没有正在执行的移动");
  pausedTasks.add(id);
}
async function rollback(db, id) {
  const run = runData(db, id);
  if (activeTasks.has(id)) throw new Error("执行尚未停止，请稍后重试");
  if (!run.started || !["failed", "applying", "paused"].includes(run.status))
    throw new Error("仅未完成的移动可以撤回；已完成的整理请从历史恢复");
  run.rollback = true;
  run.status = "applying";
  run.error = null;
  run.phase = "恢复应用前目录";
  run.done = run.moves.filter((m) => m.rollbackPhase === "restored").length;
  persist(db, run);
  activeTasks.add(id);
  setImmediate(async () => {
    try {
      if (
        run.before.physicalRoot &&
        (await fs.realpath(run.root)) !== run.before.physicalRoot
      )
        throw new Error("目录挂载已变化，请恢复原挂载后继续");
      // Stage delivered files first, so undoing a swap never overwrites another source.
      for (const m of run.moves) {
        checkPause(id);
        if (m.rollbackPhase) continue;
        const from = await safePath(run.root, m.from);
        const stage = await safePath(run.root, m.stage);
        const to = await safePath(run.root, m.to);
        if (m.phase === "source" && (await fs.pathExists(from))) {
          await verifyFile(from, m);
          if (await fs.pathExists(stage)) {
            await verifyFile(stage, m);
            await fs.unlink(stage);
          }
          m.rollbackPhase = "restored";
          run.done++;
          if (m.fileId)
            db.prepare(
              "UPDATE files SET path = ?, missing = 0 WHERE id = ?",
            ).run(from, m.fileId);
        } else {
          if (await fs.pathExists(stage)) {
            await verifyFile(stage, m);
            if (m.delivering && (await fs.pathExists(to))) {
              await verifyFile(to, m);
              await fs.unlink(to);
            }
          } else {
            await verifyFile(to, m);
            await moveExclusive(to, stage, m);
          }
          m.rollbackPhase = "staged";
        }
        checkpointMove(db, run, m);
        persist(db, run);
      }
      for (const m of run.moves) {
        checkPause(id);
        if (m.rollbackPhase === "restored") continue;
        const stage = await safePath(run.root, m.stage);
        const from = await safePath(run.root, m.from);
        if (await fs.pathExists(from)) {
          if (!m.rollbackDelivering)
            throw new Error(`原路径已被其他文件占用：${m.from}`);
          await verifyFile(from, m);
          if (await fs.pathExists(stage)) {
            await verifyFile(stage, m);
            await fs.unlink(stage);
          }
        } else {
          await verifyFile(stage, m);
          m.rollbackDelivering = true;
          checkpointMove(db, run, m);
          await moveExclusive(stage, from, m);
          await verifyFile(from, m);
        }
        if (m.fileId) {
          db.prepare(
            "UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?",
          ).run(from, Date.now(), m.fileId);
          db.prepare(
            "INSERT INTO changes(entity, entity_id, type, ts) VALUES ('file', ?, 'moved', ?)",
          ).run(String(m.fileId), Date.now());
        }
        m.rollbackPhase = "restored";
        run.done++;
        checkpointMove(db, run, m);
        persist(db, run);
      }
      const stageDir = await safePath(run.root, run.stageRoot);
      if (await fs.pathExists(stageDir)) await fs.rmdir(stageDir);
      const originalDirs = new Set(run.before.directories);
      for (const d of originalDirs)
        await fs.ensureDir(await safePath(run.root, d));
      const dirs = new Set();
      for (const m of run.moves) {
        let d = path.posix.dirname(m.to);
        while (d !== ".") {
          dirs.add(d);
          d = path.posix.dirname(d);
        }
      }
      for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
        if (originalDirs.has(d)) continue;
        try {
          await fs.rmdir(await safePath(run.root, d));
        } catch (e) {
          if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(e.code)) throw e;
        }
      }
      const after = await capture(db, run.root, {
        previous: run.before,
        exclude: run.exclude,
      });
      const actual = new Map(after.files.map((f) => [f.relative, f.hash]));
      for (const m of run.moves)
        if (actual.get(m.from) !== m.hash)
          throw new Error(`撤回后校验失败：${m.from}`);
      remember(db, after, "撤销未完成整理", id);
      run.status = "rolled_back";
      run.phase = "已恢复原目录";
    } catch (error) {
      run.status = error.code === "PAUSED" ? "paused" : "failed";
      run.error = error.message;
    } finally {
      persist(db, run);
      activeTasks.delete(id);
      pausedTasks.delete(id);
    }
  });
  return summary(run);
}
module.exports = {
  busy,
  generate,
  accept,
  importCandidate,
  edit,
  prepare,
  execute,
  rollback,
  pause,
  history,
  runData,
  summary,
  cancelPrepare,
};
