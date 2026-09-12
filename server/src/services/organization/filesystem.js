const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const { isUnder } = require("../fileSafety");

const canonical = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function sha256(
  file,
  { shouldCancel = () => false, onBytes = () => {} } = {},
) {
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for await (const block of fs.createReadStream(file)) {
    if (shouldCancel())
      throw Object.assign(new Error("检查已取消"), { code: "CANCELLED" });
    hash.update(block);
    bytes += block.length;
    onBytes(bytes);
  }
  return hash.digest("hex");
}
async function moveExclusive(from, to, expected) {
  await fs.ensureDir(path.dirname(to));
  try {
    // link creates the destination exclusively; unlike rename it cannot replace a racing writer's file.
    await fs.link(from, to);
  } catch (error) {
    if (!["EXDEV", "EPERM", "EOPNOTSUPP", "ENOTSUP"].includes(error.code))
      throw error;
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    if ((await sha256(to)) !== expected.hash)
      throw new Error(`移动副本校验失败：${to}`);
    if ((await sha256(from)) !== expected.hash)
      throw new Error(`源文件在移动期间变化：${from}`);
    const stat = await fs.stat(from);
    await fs.utimes(to, stat.atime, stat.mtime);
  }
  await fs.unlink(from);
}
async function safePath(root, relative) {
  if (
    typeof relative !== "string" ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).some((p) => !p || p === ".." || p === ".")
  )
    throw new Error("文件路径无效");
  const target = path.resolve(root, relative);
  if (!isUnder(root, target) || target === root)
    throw new Error("文件路径超出整理范围");
  // Check every existing ancestor; lexical containment alone cannot detect a junction escape.
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink())
        throw new Error(`不支持符号链接：${cursor}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}
async function capture(
  db,
  root,
  {
    previous,
    exclude = [],
    progress = () => {},
    shouldCancel = () => false,
  } = {},
) {
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new Error("整理范围必须是普通目录");
  const physicalRoot = await fs.realpath(root);
  const cached = new Map(
    db
      .prepare("SELECT id,path,hash,hash_algo,size,mtime_ms FROM files")
      .all()
      .map((r) => [canonical(path.resolve(r.path)), r]),
  );
  const prior = new Map(
    (previous?.files || []).map((f) => [canonical(f.relative), f]),
  );
  const files = [];
  const directories = [];
  const queue = [];
  async function walk(directory) {
    if (shouldCancel())
      throw Object.assign(new Error("检查已取消"), { code: "CANCELLED" });
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (exclude.some((p) => isUnder(p, absolute))) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.name.startsWith(".tidy-stage-"))
        throw new Error("存在未完成的整理，请先继续执行");
      if (entry.isSymbolicLink())
        throw new Error(`请将符号链接移出整理范围：${relative}`);
      if (entry.isDirectory()) {
        directories.push(relative);
        await walk(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error(`不支持的文件类型：${relative}`);
      queue.push({ absolute, relative });
    }
  }
  await walk(root);
  let cursor = 0;
  let lastProgress = 0;
  let firstError;
  async function inspect() {
    try {
      while (!firstError && cursor < queue.length) {
        if (shouldCancel())
          throw Object.assign(new Error("检查已取消"), { code: "CANCELLED" });
        const { absolute, relative } = queue[cursor++];
        const stat = await fs.lstat(absolute);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          !isUnder(physicalRoot, await fs.realpath(absolute))
        )
          throw new Error(`文件类型或路径已变化：${relative}`);
        const known = cached.get(canonical(absolute));
        const old = prior.get(canonical(relative));
        let hash;
        if (
          known?.hash_algo === "sha256" &&
          /^[a-f0-9]{64}$/i.test(known.hash || "") &&
          known.size === stat.size &&
          Math.abs(known.mtime_ms - stat.mtimeMs) < 0.01
        )
          hash = known.hash;
        else if (
          /^[a-f0-9]{64}$/i.test(old?.hash || "") &&
          old?.size === stat.size &&
          Math.abs(old.mtime - stat.mtimeMs) < 0.01
        )
          hash = old.hash;
        else
          hash = await sha256(absolute, {
            shouldCancel: () => Boolean(firstError) || shouldCancel(),
            onBytes: (bytes) => {
              if (Date.now() - lastProgress > 1000) {
                lastProgress = Date.now();
                progress({
                  phase: "计算校验值",
                  checked: files.length,
                  total: queue.length,
                  currentFile: relative,
                  currentBytes: bytes,
                });
              }
            },
          });
        const after = await fs.stat(absolute);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
          throw new Error(`文件正在变化：${relative}`);
        files.push({
          id: known ? `file:${known.id}` : old?.id || crypto.randomUUID(),
          fileId: known?.id,
          relative,
          hash,
          size: stat.size,
          mtime: stat.mtimeMs,
        });
        if (files.length % 100 === 0)
          progress({
            phase: "检查目录",
            checked: files.length,
            total: queue.length,
            currentFile: relative,
          });
      }
    } catch (error) {
      firstError ||= error;
      throw error;
    }
  }
  // Bounded concurrency hides NAS round trips without opening thousands of files at once.
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(4, queue.length) }, inspect),
  );
  const failure = results.find((r) => r.status === "rejected");
  if (failure) throw firstError || failure.reason;
  if ((await fs.realpath(root)) !== physicalRoot)
    throw new Error("目录挂载在检查期间变化");
  files.sort((a, b) => a.relative.localeCompare(b.relative, "en"));
  directories.sort();
  return {
    root,
    physicalRoot,
    files,
    directories,
    fingerprint: digest({
      physicalRoot,
      files: files.map((f) => [f.relative, f.hash]),
      directories,
    }),
  };
}
function planMoves(before, targets) {
  const byPath = new Map(before.files.map((f) => [canonical(f.relative), f]));
  const desired = new Map();
  const moves = [];
  for (const [relative, to] of Object.entries(targets)) {
    const file = byPath.get(canonical(relative));
    if (!file) throw new Error(`文件已移走，请重新生成方案：${relative}`);
    if (relative === to) continue;
    const key = canonical(to);
    if (desired.has(key)) throw new Error(`目标文件重名：${to}`);
    desired.set(key, relative);
    moves.push({
      ...file,
      from: file.relative,
      to,
      stage: "",
      phase: "source",
    });
  }
  const moving = new Set(moves.map((m) => canonical(m.from)));
  const directories = new Set(before.directories.map(canonical));
  for (const m of moves) {
    if (byPath.has(canonical(m.to)) && !moving.has(canonical(m.to)))
      throw new Error(`目标位置已有文件：${m.to}`);
    if (directories.has(canonical(m.to)))
      throw new Error(`目标位置已有目录：${m.to}`);
    let parent = path.posix.dirname(m.to);
    while (parent !== ".") {
      if (byPath.has(canonical(parent)))
        throw new Error(`目标父目录是文件：${parent}`);
      if (desired.has(canonical(parent)))
        throw new Error(`目标文件与目录冲突：${parent}`);
      parent = path.posix.dirname(parent);
    }
  }
  return moves;
}
function restoreTargets(current, snapshot) {
  const byId = new Map(current.files.map((f) => [f.id, f]));
  const byPath = new Map(current.files.map((f) => [canonical(f.relative), f]));
  const byHash = new Map();
  for (const f of current.files) {
    if (!byHash.has(f.hash)) byHash.set(f.hash, []);
    byHash.get(f.hash).push(f);
  }
  const used = new Set();
  const targets = {};
  const skipped = [];
  for (const old of snapshot.files) {
    let file = byId.get(old.id);
    if (!file) {
      const atPath = byPath.get(canonical(old.relative));
      if (atPath?.hash === old.hash) file = atPath;
    }
    if (!file && byHash.get(old.hash)?.length === 1)
      file = byHash.get(old.hash)[0];
    if (!file || used.has(file.relative) || file.hash !== old.hash) {
      skipped.push({
        path: old.relative,
        reason: file
          ? "内容已变化或无法唯一对应"
          : "文件缺失或同内容副本无法唯一对应",
      });
      continue;
    }
    used.add(file.relative);
    targets[file.relative] = old.relative;
  }
  return {
    targets,
    skipped,
    added: current.files.filter((f) => !used.has(f.relative)).length,
  };
}

module.exports = {
  capture,
  canonical,
  digest,
  sha256,
  moveExclusive,
  safePath,
  planMoves,
  restoreTargets,
};
