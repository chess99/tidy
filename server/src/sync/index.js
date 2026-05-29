/**
 * input: DB 变更记录/文件系统状态
 * output: 增量变更/同步结果
 * pos: 服务端同步层：对账与增量更新（变更需同步更新本头注释与所属目录 README）
 */

const fs = require('fs-extra');
const path = require('path');
const { getDB } = require('../db');
const { loadConfig } = require('../configStore');
const { createFileOp, applyFileOp, retryPendingAndErrored } = require('../services/fileOps');
const { makeQuarantinePath, uniquePath } = require('../services/fileSafety');

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent, child) {
  try {
    const p = stripTrailingSep(path.resolve(String(parent)));
    const c = stripTrailingSep(path.resolve(String(child)));
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

function insertChange(db, entity, entityId, type) {
  try {
    db.prepare('INSERT INTO changes (entity, entity_id, type, ts) VALUES (?, ?, ?, ?)').run(
      entity,
      String(entityId),
      type,
      Date.now()
    );
  } catch {
    // ignore
  }
}

function allowedRootsFromConfig(cfg) {
  const roots = [];
  for (const r of Array.isArray(cfg?.scanRoots) ? cfg.scanRoots : []) {
    if (r?.root) roots.push(r.root);
  }
  if (cfg?.workspace?.managedRoot) roots.push(cfg.workspace.managedRoot);
  if (cfg?.workspace?.trashDir) roots.push(cfg.workspace.trashDir);
  return Array.from(new Set(roots.filter(Boolean).map(String)));
}

async function syncChanges() {
  const db = getDB();
  const cfg = await loadConfig();
  const trashDir = cfg.workspace?.trashDir;
  if (!trashDir) throw new Error('workspace.trashDir not configured');
  const allowedRoots = allowedRootsFromConfig(cfg);

  const report = { moved: 0, deleted: 0, errors: 0, messages: [] };

  await fs.ensureDir(trashDir);

  // 1) Replay pending file ops (crash recovery / reconciliation)
  try {
    const replay = await retryPendingAndErrored(db, {
      maxAttempts: 5,
      limit: 2000,
      allowedRoots,
      insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    });
    report.moved += replay.moved;
    report.deleted += replay.deleted;
    report.errors += replay.errors;
    report.messages.push(...replay.messages);
  } catch (e) {
    report.errors++;
    report.messages.push(`file ops replay failed: ${String(e.message || e)}`);
  }

  // 2) Handle assets explicitly marked as trash (reconcile to new semantics):
  // Keep exactly ONE physical file copy for the asset under TRASH_DIR; quarantine all other copies.
  const trashAssets = db.prepare("SELECT hash FROM assets WHERE status = 'trash'").all();

  for (const { hash } of trashAssets) {
    const files = db.prepare('SELECT id, path FROM files WHERE hash = ? ORDER BY id ASC').all(hash);
    const existing = [];
    for (const f of files) {
      if (!f?.path) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await fs.pathExists(f.path)) existing.push({ id: f.id, path: String(f.path) });
    }

    if (!existing.length) continue;

    const alreadyInTrash = existing.filter((f) => isUnder(trashDir, f.path));
    const keep = alreadyInTrash[0] || existing[0];

    // Ensure keep is under trashDir.
    if (!isUnder(trashDir, keep.path)) {
      try {
        const fileName = path.basename(keep.path);
        const trashRaw = path.join(trashDir, `${hash}_${fileName}`);
        // eslint-disable-next-line no-await-in-loop
        const trashPath = await uniquePath(trashRaw);
        const op = createFileOp(db, {
          op: 'trash',
          hash,
          fileId: keep.id,
          fromPath: keep.path,
          toPath: trashPath,
        });
        // eslint-disable-next-line no-await-in-loop
        await applyFileOp(db, op, {
          allowedRoots,
          insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
          report,
        });
        keep.path = trashPath;
      } catch (e) {
        report.errors++;
        report.messages.push(`Failed to keep trash copy for ${hash}: ${String(e.message || e)}`);
        continue;
      }
    } else {
      // Ensure assets points to kept file.
      try {
        db.prepare(`UPDATE assets SET target_path = COALESCE(target_path, ?), updated_at = ? WHERE hash = ?`).run(keep.path, Date.now(), hash);
      } catch {
        // ignore
      }
    }

    // Quarantine all other existing copies.
    for (const f of existing) {
      if (f.id === keep.id) continue;
      try {
        const quarantineDir = path.join(trashDir, '.quarantine');
        const quarantinePath = await makeQuarantinePath({
          quarantineDir,
          hash,
          fileId: f.id,
          sourcePath: f.path,
          reason: 'trash-extra',
        });
        const op = createFileOp(db, {
          op: 'quarantine',
          hash,
          fileId: f.id,
          fromPath: f.path,
          toPath: quarantinePath,
        });
        // eslint-disable-next-line no-await-in-loop
        await applyFileOp(db, op, {
          allowedRoots,
          insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
          report,
        });
      } catch (e) {
        report.errors++;
        report.messages.push(`Failed to quarantine extra copy ${f.path}: ${String(e.message || e)}`);
      }
    }
  }

  return report;
}

module.exports = { syncChanges };
