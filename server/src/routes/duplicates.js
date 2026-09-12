const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { getDB } = require('../db');
const { getReview, invalidateReview, settleReview } = require('../services/duplicateReview');
const { loadConfig } = require('../configStore');
const { createFileOp, applyFileOp } = require('../services/fileOps');
const { makeQuarantinePath } = require('../services/fileSafety');
const { trashAssetKeepOne } = require('../services/assetTrash');
const { canTreatAsSameContentForDestructiveDedupe } = require('../services/hashPolicy');

const router = express.Router();
const applying = new WeakSet();

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

function opSucceeded(db, opId) {
  const row = db.prepare('SELECT status, error FROM file_ops WHERE id = ?').get(opId);
  return row?.status === 'done' ? { ok: true } : { ok: false, error: row?.error || 'file_op_failed' };
}

async function quarantineFileInstance(db, { hash, fileId, filePath, trashDir, allowedRoots, reason = 'duplicate' }) {
  const quarantinePath = await makeQuarantinePath({
    quarantineDir: path.join(trashDir, '.quarantine'),
    hash: hash || 'nohash',
    fileId,
    sourcePath: filePath,
    reason,
  });
  const op = createFileOp(db, {
    op: 'quarantine',
    hash: hash || null,
    fileId,
    fromPath: filePath,
    toPath: quarantinePath,
  });
  const report = { moved: 0, deleted: 0, errors: 0, messages: [] };
  await applyFileOp(db, op, {
    allowedRoots,
    insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
    report,
  });
  return opSucceeded(db, op.id);
}

function makeInClause(values) {
  const params = values.slice();
  const clause = `(${params.map(() => '?').join(',')})`;
  return { clause, params };
}

function cleanupOrphanAsset(db, hash) {
  // If no files remain for this hash, delete asset and links (DB-only).
  try {
    const exists = db.prepare('SELECT 1 FROM files WHERE hash = ? LIMIT 1').get(hash);
    if (exists) return { deleted: false };
  } catch {
    return { deleted: false };
  }

  try {
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
    db.prepare('DELETE FROM asset_tags WHERE hash = ?').run(hash);
    db.prepare('DELETE FROM file_ops WHERE hash = ?').run(hash);
    db.prepare(`DELETE FROM changes WHERE entity='asset' AND entity_id = ?`).run(hash);
    const r = db.prepare('DELETE FROM assets WHERE hash = ?').run(hash);
    insertChange(db, 'asset', hash, 'deleted');
    return { deleted: (r?.changes || 0) > 0 };
  } catch {
    return { deleted: false };
  }
}

// The complete candidate set is verified before returning it to the reviewer.
router.get('/groups', async (req, res) => {
  try { res.json(await getReview(getDB(), { refresh: req.query.refresh === '1' })); }
  catch (error) { res.status(500).json({ error: String(error.message || error) }); }
});

router.post('/dismiss', async (req, res) => {
  const db = getDB();
  try {
    const { groups } = await getReview(db);
    if (!groups.some((g) => g.id === req.body?.groupId)) {
      return res.status(409).json({ error: '这一组已发生变化，请刷新后重试。' });
    }
    db.prepare('INSERT OR REPLACE INTO duplicate_reviews (signature, reviewed_at) VALUES (?, ?)')
      .run(req.body.groupId, Date.now());
    res.json({ ok: true, removedGroupIds: [req.body.groupId], updatedGroups: [] });
  } catch (error) { res.status(500).json({ error: String(error.message || error) }); }
});

router.post('/reset', (req, res) => {
  const db = getDB();
  db.prepare('DELETE FROM duplicate_reviews').run();
  res.json({ ok: true });
});

// POST /api/duplicates/apply
// { groupId: string, keepFileIds: number[], deleteFileIds: number[] }
async function applyReview(req, res) {
  const db = getDB();
  const cfg = await loadConfig();
  const trashDir = cfg.workspace?.trashDir;
  if (!trashDir) return res.status(500).json({ error: 'workspace.trashDir not configured' });
  const allowedRoots = allowedRootsFromConfig(cfg);

  const validIds = (ids) => Array.isArray(ids) && ids.length <= 2000 &&
    ids.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
  const { keepFileIds, deleteFileIds, groupId } = req.body || {};
  if (!validIds(keepFileIds) || !validIds(deleteFileIds) || !keepFileIds.length || !deleteFileIds.length ||
      keepFileIds.some((id) => deleteFileIds.includes(id))) {
    return res.status(400).json({ error: '请选择要移入回收站的文件，并至少保留一份。' });
  }
  const keepSet = new Set(keepFileIds), deleteSet = new Set(deleteFileIds);
  const ids = [...keepFileIds, ...deleteFileIds];
  try {
    const { groups } = await getReview(db);
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.items.length !== ids.length || !group.items.every((i) => ids.includes(i.file_id))) {
      return res.status(409).json({ error: '这一组已发生变化，请刷新后重试。' });
    }
    for (const item of group.items) {
      const current = db.prepare(`SELECT f.path, f.hash, f.missing, a.status
        FROM files f JOIN assets a ON a.hash = f.hash WHERE f.id = ?`).get(item.file_id);
      if (!current || current.missing || current.status === 'trash' || current.path !== item.path || current.hash !== item.hash) {
        invalidateReview(db);
        return res.status(409).json({ error: '这一组已发生变化，请刷新后重试。' });
      }
      const st = await fs.lstat(item.path);
      if (!st.isFile() || st.size !== item.size || Math.abs(st.mtimeMs - item.mtime_ms) > 2) {
        invalidateReview(db);
        return res.status(409).json({ error: '文件已发生变化，请重新扫描后重试。' });
      }
    }
  } catch (error) {
    return res.status(409).json({ error: '无法核实原文件，请检查磁盘连接并重新扫描。' });
  }

  const report = { trashedAssets: 0, deletedFiles: 0, deletedAssets: 0, errors: 0, messages: [] };

  try {
    const { clause, params } = makeInClause(ids);
    const selected = db
      .prepare(
        `
        SELECT id, hash, hash_algo, size, path
        FROM files
        WHERE id IN ${clause}
        `
      )
      .all(...params)
      .map((r) => ({
        id: Number(r.id),
        hash: r.hash ? String(r.hash) : null,
        hash_algo: r.hash_algo ? String(r.hash_algo) : null,
        size: r.size,
        path: r.path ? String(r.path) : null,
      }))
      .filter((r) => Number.isFinite(r.id));

    // Group selected ids by hash (hash may be null -> treat as per-file delete only)
    const byHash = new Map();
    for (const r of selected) {
      const k = r.hash || `__nohash__:${r.id}`;
      if (!byHash.has(k)) byHash.set(k, []);
      byHash.get(k).push(r);
    }

    for (const [k, items] of byHash.entries()) {
      const hash = k.startsWith('__nohash__:') ? null : k;

      // Per-file delete for non-hash items.
      if (!hash) {
        for (const it of items) {
          if (!deleteSet.has(it.id)) continue;
          if (!it.path) continue;
          // eslint-disable-next-line no-await-in-loop
          const r = await quarantineFileInstance(db, {
            hash: null,
            fileId: it.id,
            filePath: it.path,
            trashDir,
            allowedRoots,
            reason: 'duplicate-nohash',
          });
          if (r.ok) report.deletedFiles++;
          else {
            report.errors++;
            report.messages.push(`quarantine file#${it.id} failed: ${r.error}`);
          }
        }
        continue;
      }

      // Determine current existing files for this hash.
      const allFiles = db.prepare('SELECT id, hash, hash_algo, size, path FROM files WHERE hash = ?').all(hash);
      const existing = [];
      for (const f of allFiles) {
        if (!f?.path) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await fs.pathExists(f.path)) {
          existing.push({
            id: Number(f.id),
            hash: f.hash ? String(f.hash) : null,
            hash_algo: f.hash_algo ? String(f.hash_algo) : null,
            size: f.size,
            path: String(f.path),
          });
        }
      }
      if (!existing.length) {
        const r = cleanupOrphanAsset(db, hash);
        if (r.deleted) report.deletedAssets++;
        continue;
      }

      const existingIds = new Set(existing.map((x) => x.id));
      const selectedDeleteIds = Array.from(deleteSet).filter((id) => existingIds.has(id));

      // Escalate to asset delete only if ALL existing instances are selected for delete.
      if (selectedDeleteIds.length && selectedDeleteIds.length === existing.length) {
        // eslint-disable-next-line no-await-in-loop
        const r = await trashAssetKeepOne(db, {
          hash,
          trashDir,
          allowedRoots,
          duplicatePolicy: 'quarantine-extra',
          insertChange: (entity, entityId, type) => insertChange(db, entity, entityId, type),
        });
        if (r.ok) report.trashedAssets++;
        else {
          report.errors++;
          report.messages.push(`trash asset ${hash} failed: ${r.error}`);
        }
        continue;
      }

      // Otherwise: delete selected instances only.
      const keepCandidate =
        existing.find((x) => keepSet.has(x.id)) ||
        existing.find((x) => !selectedDeleteIds.includes(x.id)) ||
        null;
      for (const fid of selectedDeleteIds) {
        const it = existing.find((x) => x.id === fid);
        if (!it?.path) continue;
        if (!keepCandidate) {
          report.errors++;
          report.messages.push(`quarantine dup file#${fid} failed: no_keep_candidate`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const sameContent = await canTreatAsSameContentForDestructiveDedupe(keepCandidate, it);
        if (!sameContent) {
          report.errors++;
          report.messages.push(`quarantine dup file#${fid} blocked: hash_policy_mismatch`);
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const r = await quarantineFileInstance(db, {
          hash,
          fileId: fid,
          filePath: it.path,
          trashDir,
          allowedRoots,
          reason: 'duplicate',
        });
        if (r.ok) report.deletedFiles++;
        else {
          report.errors++;
          report.messages.push(`quarantine dup file#${fid} failed: ${r.error}`);
        }
      }

      // If no files remain, cleanup orphan asset.
      const orphan = cleanupOrphanAsset(db, hash);
      if (orphan.deleted) report.deletedAssets++;
    }

    const delta = await settleReview(db, groupId);
    return res.json({ ...report, ...delta });
  } catch (e) {
    const delta = await settleReview(db, groupId);
    return res.status(500).json({ error: String(e.message || e), ...delta });
  }
}

router.post('/apply', async (req, res, next) => {
  const db = getDB();
  if (applying.has(db)) return res.status(409).json({ error: '正在处理另一组文件，请稍后重试。' });
  applying.add(db);
  try { await applyReview(req, res); }
  catch (error) { next(error); }
  finally { applying.delete(db); }
});

module.exports = router;
