/**
 * input: current workspace config + previous workspace paths + files/assets DB state
 * output: rebuilt sorted/trash/inbox and album relationships without media reprocessing
 * pos: workspace path migration handler (变更需同步更新本头注释与所属目录 README)
 */

const path = require('path');
const { getDB } = require('../../db');
const { isUnder, reconcileAssetByFilesystem } = require('./enrich');

function optionalAbsolutePath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw && path.isAbsolute(raw) ? path.resolve(raw) : null;
}

function workspaceRoots(workspace) {
  return [optionalAbsolutePath(workspace?.managedRoot), optionalAbsolutePath(workspace?.trashDir)].filter(Boolean);
}

async function handleWorkspaceReconcile(ctx) {
  const cfg = await ctx.loadConfig();
  const currentWorkspace = cfg.workspace || {};
  const managedRoot = optionalAbsolutePath(currentWorkspace.managedRoot);
  const trashDir = optionalAbsolutePath(currentWorkspace.trashDir);
  if (!managedRoot || !trashDir) throw new Error('workspace.managedRoot and workspace.trashDir must be absolute paths');

  const roots = Array.from(new Set([
    ...workspaceRoots(currentWorkspace),
    ...workspaceRoots(ctx.job?.params?.previousWorkspace),
  ].map((root) => process.platform === 'win32' ? root.toLowerCase() : root)));

  const db = getDB();
  const rows = db.prepare(`
    SELECT hash, path
    FROM files
    WHERE hash IS NOT NULL AND path IS NOT NULL AND missing = 0
  `).all();
  const hashes = new Set();
  for (const row of rows) {
    if (ctx.isCancelRequested()) break;
    if (roots.some((root) => isUnder(root, row.path))) hashes.add(String(row.hash));
  }

  const stats = {
    phase: 'workspace_reconcile',
    total: hashes.size,
    done: 0,
    sorted: 0,
    trash: 0,
    inbox: 0,
    ignored: 0,
    unchanged: 0,
    errors: 0,
    lastError: null,
  };
  ctx.heartbeat(stats);

  for (const hash of hashes) {
    if (ctx.isCancelRequested()) break;
    try {
      const status = await reconcileAssetByFilesystem(db, hash, { managedRoot, trashDir });
      if (Object.hasOwn(stats, status)) stats[status] += 1;
      else stats.unchanged += 1;
    } catch (error) {
      stats.errors += 1;
      stats.lastError = String(error?.message || error);
    }
    stats.done += 1;
    if (stats.done % 50 === 0) ctx.heartbeat(stats);
  }

  const removedEmptyAlbums = db.prepare(`
    DELETE FROM albums
    WHERE NOT EXISTS (SELECT 1 FROM album_assets aa WHERE aa.album_id = albums.id)
  `).run().changes;
  const result = { ok: true, ...stats, removedEmptyAlbums };
  ctx.heartbeat({ ...result, phase: 'workspace_reconcile_done' });
  return result;
}

module.exports = { handleWorkspaceReconcile, workspaceRoots };
