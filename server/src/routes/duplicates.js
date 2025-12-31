/**
 * input: Express req/res + DB + 相似度阈值/分页参数
 * output: 重复项分组（hash/pHash）与建议保留项
 * pos: 服务端路由层：为“实用工具-检查重复项”提供数据（变更需同步更新本头注释与所属目录 README）
 */

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { getDB } = require('../db');
const { hamming64 } = require('../scanner/phash');
const { TRASH_DIR } = require('../config');

const router = express.Router();

function safeJsonParse(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function parseIntSafe(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function clampInt(v, { min, max, fallback }) {
  const n = parseIntSafe(v, fallback);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function toItemRow(r) {
  const p = r?.path ? String(r.path) : null;
  const fileName = p ? path.basename(p) : null;
  const meta = safeJsonParse(r?.asset_metadata) || null;
  return {
    file_id: r?.file_id,
    path: p,
    file_name: fileName,
    size: r?.size ?? null,
    mtime_ms: r?.mtime_ms ?? null,
    width: meta?.width ?? null,
    height: meta?.height ?? null,
    lat: meta?.lat ?? null,
    lon: meta?.lon ?? null,
    hash: r?.hash ?? null,
    phash: r?.phash ?? null,
    asset_taken_at: r?.asset_taken_at ?? null,
    asset_mime_type: r?.asset_mime_type ?? null,
    asset_status: r?.asset_status ?? null,
    organized_to: r?.organized_to ?? null,
  };
}

function scoreKeepCandidate(item) {
  // Prefer higher resolution and larger file size.
  const w = Number(item?.width) || 0;
  const h = Number(item?.height) || 0;
  const pixels = w > 0 && h > 0 ? w * h : 0;
  const size = Number(item?.size) || 0;
  return pixels * 1e3 + size; // pixels dominates
}

function pickSuggestedKeepFileId(items) {
  let best = null;
  let bestScore = -Infinity;
  for (const it of Array.isArray(items) ? items : []) {
    const sc = scoreKeepCandidate(it);
    if (!best || sc > bestScore) {
      best = it;
      bestScore = sc;
    }
  }
  return best?.file_id ?? null;
}

function organizedToSubquery(aliasHash) {
  return `
    (
      SELECT al.name
      FROM album_assets aa2
      JOIN albums al ON al.id = aa2.album_id
      WHERE aa2.hash = ${aliasHash}
      ORDER BY COALESCE(aa2.added_at, 0) DESC, aa2.album_id DESC
      LIMIT 1
    )`;
}

function selectItemSql() {
  return `
    SELECT
      f.id AS file_id,
      f.path,
      f.size,
      f.mtime_ms,
      f.hash,
      f.phash,
      a.taken_at AS asset_taken_at,
      a.mime_type AS asset_mime_type,
      a.status AS asset_status,
      a.metadata AS asset_metadata,
      ${organizedToSubquery('f.hash')} AS organized_to
    FROM files f
    LEFT JOIN assets a ON a.hash = f.hash
  `;
}

function isNonTrashAssetExpr() {
  return `(a.status IS NULL OR a.status != 'trash')`;
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

async function uniquePath(destPath) {
  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let candidate = destPath;
  for (let i = 1; i <= 9999; i++) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await fs.pathExists(candidate))) return candidate;
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

async function ensureDirForFile(filePath) {
  await fs.ensureDir(path.dirname(filePath));
}

async function deleteFileInstance(db, { hash, fileId, filePath }) {
  const now = Date.now();
  const info = db
    .prepare(
      `
      INSERT INTO file_ops (op, hash, file_id, from_path, to_path, album_id, status, created_at, updated_at)
      VALUES ('delete', ?, ?, ?, NULL, NULL, 'pending', ?, ?)
      `
    )
    .run(hash || null, fileId, filePath, now, now);
  const opId = info.lastInsertRowid;

  try {
    await fs.remove(filePath);
    db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
    db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', Date.now(), opId);
    insertChange(db, 'file', fileId, 'deleted');
    return { ok: true };
  } catch (e) {
    const msg = String(e?.message || e);
    try {
      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', Date.now(), msg, opId);
    } catch {
      // ignore
    }
    return { ok: false, error: msg };
  }
}

async function trashAssetKeepOne(db, { hash }) {
  // Keep exactly one existing file copy under TRASH_DIR.
  const rows = db
    .prepare(
      `
      SELECT id, path, mtime_ms, updated_at, discovered_at, scanned_at
      FROM files
      WHERE hash = ?
      ORDER BY COALESCE(mtime_ms, updated_at, discovered_at, scanned_at, 0) DESC, id DESC
      `
    )
    .all(hash);

  const existing = [];
  for (const f of rows) {
    if (!f?.path) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await fs.pathExists(f.path)) existing.push({ ...f, path: String(f.path) });
    else {
      try {
        db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
        insertChange(db, 'file', f.id, 'deleted');
      } catch {
        // ignore
      }
    }
  }

  if (!existing.length) {
    // No physical files left; treat as orphan cleanup.
    return { ok: false, error: 'no_existing_files' };
  }

  await fs.ensureDir(TRASH_DIR);

  const keep = existing.find((f) => String(f.path).startsWith(TRASH_DIR)) || existing[0];
  let keepPath = keep.path;

  if (!String(keepPath).startsWith(TRASH_DIR)) {
    const fileName = path.basename(keepPath);
    const trashRaw = path.join(TRASH_DIR, `${hash}_${fileName}`);
    // eslint-disable-next-line no-await-in-loop
    const trashPath = await uniquePath(trashRaw);
    // eslint-disable-next-line no-await-in-loop
    await ensureDirForFile(trashPath);

    const now = Date.now();
    const info = db
      .prepare(
        `
        INSERT INTO file_ops (op, hash, file_id, from_path, to_path, album_id, status, created_at, updated_at)
        VALUES ('trash', ?, ?, ?, ?, NULL, 'pending', ?, ?)
        `
      )
      .run(hash, keep.id, keepPath, trashPath, now, now);
    const opId = info.lastInsertRowid;

    try {
      await fs.move(keepPath, trashPath, { overwrite: false });
      db.prepare('UPDATE files SET path = ?, missing = 0, updated_at = ? WHERE id = ?').run(trashPath, Date.now(), keep.id);
      db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = NULL WHERE id = ?').run('done', Date.now(), opId);
      insertChange(db, 'file', keep.id, 'trashed');
      keepPath = trashPath;
    } catch (e) {
      const msg = String(e?.message || e);
      try {
        db.prepare('UPDATE file_ops SET status = ?, updated_at = ?, error = ? WHERE id = ?').run('error', Date.now(), msg, opId);
      } catch {
        // ignore
      }
      return { ok: false, error: msg };
    }
  }

  // Delete all other copies.
  for (const f of existing) {
    if (f.id === keep.id) continue;
    // eslint-disable-next-line no-await-in-loop
    await deleteFileInstance(db, { hash, fileId: f.id, filePath: f.path });
  }

  // Asset-level state
  try {
    db.prepare(`UPDATE assets SET status = 'trash', target_path = ?, updated_at = ? WHERE hash = ?`).run(keepPath, Date.now(), hash);
    db.prepare('DELETE FROM album_assets WHERE hash = ?').run(hash);
    insertChange(db, 'asset', hash, 'trash');
  } catch {
    // ignore
  }

  return { ok: true, keepPath, keptFileId: keep.id };
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
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

// GET /api/duplicates/groups?kind=hash|phash&threshold=10&limit=20&cursor=...
router.get('/groups', (req, res) => {
  const db = getDB();
  const kind = String(req.query.kind || 'phash').trim();
  const threshold = clampInt(req.query.threshold, { min: 0, max: 32, fallback: 10 });
  const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: 20 });
  const cursorRaw = req.query.cursor;

  if (kind !== 'hash' && kind !== 'phash') {
    return res.status(400).json({ error: 'invalid kind' });
  }

  try {
    if (kind === 'hash') {
      const cursor = cursorRaw != null ? String(cursorRaw) : '';
      const hashes = db.prepare(`
        SELECT h
        FROM (
          SELECT f.hash AS h
          FROM files f
          WHERE f.hash IS NOT NULL
          GROUP BY f.hash
          HAVING COUNT(*) > 1
        )
        WHERE h > ?
        ORDER BY h ASC
        LIMIT ?
      `).all(cursor, limit);

      const groups = [];
      for (const row of hashes) {
        const h = String(row.h);
        const itemsRaw = db.prepare(`
          ${selectItemSql()}
          WHERE f.hash = ?
            AND f.missing = 0
            AND ${isNonTrashAssetExpr()}
          ORDER BY COALESCE(f.mtime_ms, f.updated_at, f.discovered_at, f.scanned_at, 0) DESC, f.id DESC
        `).all(h);
        const items = itemsRaw.map(toItemRow);
        if (items.length < 2) continue;
        groups.push({
          id: h,
          kind: 'hash',
          items,
          suggested_keep_file_id: pickSuggestedKeepFileId(items),
        });
      }

      const nextCursor = groups.length ? String(groups[groups.length - 1].id) : null;
      return res.json({ kind, threshold, groups, nextCursor });
    }

    // kind === 'phash'
    const cursor = parseIntSafe(cursorRaw, 0) || 0;
    const seedLimit = Math.max(200, limit * 30);
    const seeds = db.prepare(`
      SELECT f.id, f.phash
      FROM files f
      LEFT JOIN assets a ON a.hash = f.hash
      WHERE f.id > ?
        AND f.missing = 0
        AND f.phash IS NOT NULL
        AND f.phash_status = 'done'
        AND ${isNonTrashAssetExpr()}
        AND COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
      ORDER BY f.id ASC
      LIMIT ?
    `).all(cursor, seedLimit);

    const groups = [];
    let lastSeedId = cursor;

    const candStmt = db.prepare(`
      ${selectItemSql()}
      WHERE f.missing = 0
        AND f.phash IS NOT NULL
        AND f.phash_status = 'done'
        AND ${isNonTrashAssetExpr()}
        AND COALESCE(a.mime_type, f.mime_guess) LIKE 'image/%'
        AND (
          substr(f.phash, 1, 4) = ?
          OR substr(f.phash, 5, 4) = ?
          OR substr(f.phash, 9, 4) = ?
          OR substr(f.phash, 13, 4) = ?
        )
      LIMIT 500
    `);

    for (const s of seeds) {
      const seedId = Number(s.id);
      const seedHash = String(s.phash || '');
      if (!Number.isFinite(seedId) || !seedHash) continue;
      lastSeedId = seedId;

      const b1 = seedHash.slice(0, 4);
      const b2 = seedHash.slice(4, 8);
      const b3 = seedHash.slice(8, 12);
      const b4 = seedHash.slice(12, 16);

      const raw = candStmt.all(b1, b2, b3, b4);
      const near = [];
      let hasEarlier = false;

      for (const r of raw) {
        const pid = Number(r.file_id);
        const ph = String(r.phash || '');
        const d = hamming64(seedHash, ph);
        if (d == null || d > threshold) continue;
        if (pid < seedId) {
          hasEarlier = true;
          break;
        }
        near.push(r);
      }

      if (hasEarlier) continue;
      if (near.length < 2) continue; // must be a group

      // De-dup by file_id (cand query may include duplicates in weird DB states)
      const seen = new Set();
      const items = [];
      for (const r of near) {
        const id = Number(r.file_id);
        if (!Number.isFinite(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(toItemRow(r));
      }
      if (items.length < 2) continue;

      groups.push({
        id: seedId,
        kind: 'phash',
        threshold,
        items,
        suggested_keep_file_id: pickSuggestedKeepFileId(items),
      });

      if (groups.length >= limit) break;
    }

    const nextCursor = lastSeedId > cursor ? String(lastSeedId) : null;
    return res.json({ kind, threshold, groups, nextCursor });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/duplicates/apply
// { keepFileIds: number[], deleteFileIds: number[] }
router.post('/apply', async (req, res) => {
  const db = getDB();
  const keepFileIds = Array.isArray(req.body?.keepFileIds) ? req.body.keepFileIds.map((n) => Number(n)).filter(Number.isFinite) : [];
  const deleteFileIds = Array.isArray(req.body?.deleteFileIds) ? req.body.deleteFileIds.map((n) => Number(n)).filter(Number.isFinite) : [];

  const keepSet = new Set(keepFileIds);
  const deleteSet = new Set(deleteFileIds);
  // Resolve conflicts: keep wins over delete.
  for (const id of keepSet) deleteSet.delete(id);

  const ids = Array.from(new Set([...keepSet, ...deleteSet])).slice(0, 2000);
  if (!ids.length) return res.status(400).json({ error: 'no file ids' });

  const report = { trashedAssets: 0, deletedFiles: 0, deletedAssets: 0, errors: 0, messages: [] };

  try {
    const { clause, params } = makeInClause(ids);
    const selected = db
      .prepare(
        `
        SELECT id, hash, path
        FROM files
        WHERE id IN ${clause}
        `
      )
      .all(...params)
      .map((r) => ({ id: Number(r.id), hash: r.hash ? String(r.hash) : null, path: r.path ? String(r.path) : null }))
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
          const r = await deleteFileInstance(db, { hash: null, fileId: it.id, filePath: it.path });
          if (r.ok) report.deletedFiles++;
          else {
            report.errors++;
            report.messages.push(`delete file#${it.id} failed: ${r.error}`);
          }
        }
        continue;
      }

      // Determine current existing files for this hash.
      const allFiles = db.prepare('SELECT id, path FROM files WHERE hash = ?').all(hash);
      const existing = [];
      for (const f of allFiles) {
        if (!f?.path) continue;
        // eslint-disable-next-line no-await-in-loop
        if (await fs.pathExists(f.path)) existing.push({ id: Number(f.id), path: String(f.path) });
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
        const r = await trashAssetKeepOne(db, { hash });
        if (r.ok) report.trashedAssets++;
        else {
          report.errors++;
          report.messages.push(`trash asset ${hash} failed: ${r.error}`);
        }
        continue;
      }

      // Otherwise: delete selected instances only.
      for (const fid of selectedDeleteIds) {
        const it = existing.find((x) => x.id === fid);
        if (!it?.path) continue;
        // eslint-disable-next-line no-await-in-loop
        const r = await deleteFileInstance(db, { hash, fileId: fid, filePath: it.path });
        if (r.ok) report.deletedFiles++;
        else {
          report.errors++;
          report.messages.push(`delete dup file#${fid} failed: ${r.error}`);
        }
      }

      // If no files remain, cleanup orphan asset.
      const orphan = cleanupOrphanAsset(db, hash);
      if (orphan.deleted) report.deletedAssets++;
    }

    return res.json(report);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
});

module.exports = router;


