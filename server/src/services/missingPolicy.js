/**
 * input: DB + 文件系统存在性检查（pathExists）+ 时间戳
 * output: 缺失策略应用（删除 files / 标记 assets.missing / 删除 assets）
 * pos: 服务端服务层：缺失治理策略复用（变更需同步更新本头注释与所属目录 README）
 */

function toTs(tsOrFn) {
  if (typeof tsOrFn === 'function') return Number(tsOrFn());
  if (Number.isFinite(Number(tsOrFn))) return Number(tsOrFn);
  return Date.now();
}

async function anyExistingFileForHash(db, hash, { pathExists }) {
  const rows = db
    .prepare(
      `
      SELECT path
      FROM files
      WHERE hash = ?
        AND path IS NOT NULL
      ORDER BY id ASC
      `
    )
    .all(hash);

  for (const r of rows) {
    const p = r?.path ? String(r.path) : '';
    if (!p) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(p)) return true;
  }
  return false;
}

function cleanupEphemeralAsset(db, hash) {
  // Best-effort cleanup: do not throw (callers treat this as maintenance).
  try {
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
  } catch {
    // ignore
  }
  try {
    db.prepare('DELETE FROM asset_tags WHERE hash = ?').run(hash);
  } catch {
    // ignore
  }
  try {
    db.prepare('DELETE FROM faces WHERE hash = ?').run(hash);
  } catch {
    // ignore
  }
  try {
    db.prepare('UPDATE clip_embeddings SET hash = NULL WHERE hash = ?').run(hash);
  } catch {
    // ignore
  }
}

function emitChange(insertChange, entity, entityId, type) {
  if (typeof insertChange !== 'function') return;
  try {
    insertChange(entity, entityId, type);
  } catch {
    // ignore
  }
}

function deleteFileRowById(db, fileId, { insertChange } = {}) {
  try {
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    emitChange(insertChange, 'file', fileId, 'deleted');
    return true;
  } catch {
    return false;
  }
}

async function reconcileAssetMissingByHash(db, hash, { pathExists, ts, insertChange } = {}) {
  if (!hash) return;
  const h = String(hash);

  // If any physical instance exists, asset is not missing.
  try {
    const anyExists = await anyExistingFileForHash(db, h, { pathExists });
    if (anyExists) {
      const t = toTs(ts);
      try {
        db.prepare(`UPDATE assets SET missing = 0, updated_at = COALESCE(updated_at, ?) WHERE hash = ?`).run(t, h);
        emitChange(insertChange, 'asset', h, 'unmissing');
      } catch {
        // ignore
      }
      return;
    }
  } catch {
    // ignore
  }

  // No instances exist: delete all remaining file rows to keep DB consistent.
  let ids = [];
  try {
    ids = db.prepare('SELECT id FROM files WHERE hash = ?').all(h).map((r) => r.id);
  } catch {
    ids = [];
  }
  try {
    db.prepare('DELETE FROM files WHERE hash = ?').run(h);
  } catch {
    // ignore
  }
  for (const id of ids) emitChange(insertChange, 'file', id, 'deleted');

  // Decide asset fate based on status.
  const asset = (() => {
    try {
      return db.prepare('SELECT status FROM assets WHERE hash = ?').get(h);
    } catch {
      return null;
    }
  })();
  const status = String(asset?.status || 'inbox');

  const t = toTs(ts);
  if (status !== 'inbox') {
    try {
      db.prepare(`UPDATE assets SET missing = 1, updated_at = ? WHERE hash = ?`).run(t, h);
      emitChange(insertChange, 'asset', h, 'missing');
    } catch {
      // ignore
    }
    return;
  }

  // Ephemeral assets (inbox) are removed when they disappear from disk.
  cleanupEphemeralAsset(db, h);
  try {
    db.prepare('DELETE FROM assets WHERE hash = ?').run(h);
    emitChange(insertChange, 'asset', h, 'deleted');
  } catch {
    // ignore
  }
}

/**
 * Apply missing policy for a list of missing file rows (id + optional hash).
 * - Always deletes those file rows.
 * - For each affected hash, reconciles asset missing/deletion.
 */
async function applyMissingPolicyForMissingFileRows(db, missingRows = [], { pathExists, ts, insertChange } = {}) {
  if (!db) return;
  if (typeof pathExists !== 'function') throw new Error('pathExists is required');

  const hashes = new Set();
  for (const r of Array.isArray(missingRows) ? missingRows : []) {
    const id = r?.id != null ? Number(r.id) : null;
    if (Number.isFinite(id)) deleteFileRowById(db, id, { insertChange });
    const hash = r?.hash ? String(r.hash) : null;
    if (hash) hashes.add(hash);
  }

  for (const hash of hashes) {
    // eslint-disable-next-line no-await-in-loop
    await reconcileAssetMissingByHash(db, hash, { pathExists, ts, insertChange });
  }
}

module.exports = {
  applyMissingPolicyForMissingFileRows,
  reconcileAssetMissingByHash,
  deleteFileRowById,
};


