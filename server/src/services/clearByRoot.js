const path = require('path');

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function escapeLike(s) {
  // Escape for SQLite LIKE with ESCAPE '\'
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

function buildPathPrefixWhere(rootAbs) {
  const root = stripTrailingSep(rootAbs);
  const sep = path.sep;
  const prefix = escapeLike(root + sep);

  // On Windows, be case-insensitive.
  if (process.platform === 'win32') {
    return {
      // SQLite requires ESCAPE to be a single character. We use backslash: ESCAPE '\'
      where: `(LOWER(path) = LOWER(?) OR LOWER(path) LIKE LOWER(?) ESCAPE '\\')`,
      params: [root, `${prefix}%`],
    };
  }
  return {
    // SQLite requires ESCAPE to be a single character. We use backslash: ESCAPE '\'
    where: `(path = ? OR path LIKE ? ESCAPE '\\')`,
    params: [root, `${prefix}%`],
  };
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

function clearByRoot(db, { root, dryRun }) {
  const { where, params } = buildPathPrefixWhere(root);

  // Identify impacted files + candidate hashes (before deleting).
  const files = db.prepare(`SELECT id, hash FROM files WHERE ${where}`).all(...params);
  const fileIds = files.map((r) => r.id).filter((n) => Number.isFinite(n));
  const hashes = Array.from(new Set(files.map((r) => r.hash).filter(Boolean).map(String)));

  // Orphan hashes are computed AFTER deleting those files.
  let orphanHashesEstimate = [];
  if (hashes.length) {
    const { clause, params: inParams } = makeInClause(hashes);
    const rows = db
      .prepare(`SELECT hash, COUNT(*) as c FROM files WHERE hash IN ${clause} GROUP BY hash`)
      .all(...inParams);
    const countByHash = new Map(rows.map((r) => [String(r.hash), Number(r.c) || 0]));
    const countInRoot = new Map();
    for (const f of files) {
      if (!f.hash) continue;
      const k = String(f.hash);
      countInRoot.set(k, (countInRoot.get(k) || 0) + 1);
    }
    orphanHashesEstimate = hashes.filter((h) => (countByHash.get(h) || 0) <= (countInRoot.get(h) || 0));
  }

  const report = {
    root,
    dryRun: !!dryRun,
    matchedFiles: fileIds.length,
    matchedHashes: hashes.length,
    deletedFiles: 0,
    deletedAssets: 0,
    deletedAlbumLinks: 0,
    deletedTagLinks: 0,
    deletedOps: 0,
    deletedChanges: 0,
    orphanHashesEstimate: orphanHashesEstimate.length,
  };

  if (dryRun) return report;

  let orphanHashes = [];

  const tx = db.transaction(() => {
    const idsChunks = chunk(fileIds, 500);
    for (const ids of idsChunks) {
      const { clause, params: inParams } = makeInClause(ids);
      report.deletedOps += db.prepare(`DELETE FROM file_ops WHERE file_id IN ${clause}`).run(...inParams).changes || 0;
      report.deletedChanges +=
        db.prepare(`DELETE FROM changes WHERE entity='file' AND CAST(entity_id AS INTEGER) IN ${clause}`).run(...inParams).changes || 0;
      report.deletedFiles += db.prepare(`DELETE FROM files WHERE id IN ${clause}`).run(...inParams).changes || 0;
    }

    // Compute exact orphan hashes from affected set.
    const affected = hashes.slice();
    const orphan = [];
    for (const hs of chunk(affected, 500)) {
      const { clause, params: inParams } = makeInClause(hs);
      const rows = db.prepare(
        `SELECT a.hash
         FROM assets a
         WHERE a.hash IN ${clause}
           AND NOT EXISTS (SELECT 1 FROM files f WHERE f.hash = a.hash)
        `
      ).all(...inParams);
      for (const r of rows) orphan.push(String(r.hash));
    }
    orphanHashes = Array.from(new Set(orphan));

    for (const hs of chunk(orphanHashes, 500)) {
      const { clause, params: inParams } = makeInClause(hs);
      report.deletedAlbumLinks += db.prepare(`DELETE FROM album_assets WHERE hash IN ${clause}`).run(...inParams).changes || 0;
      report.deletedTagLinks += db.prepare(`DELETE FROM asset_tags WHERE hash IN ${clause}`).run(...inParams).changes || 0;
      report.deletedOps += db.prepare(`DELETE FROM file_ops WHERE hash IN ${clause}`).run(...inParams).changes || 0;
      report.deletedChanges += db.prepare(`DELETE FROM changes WHERE entity='asset' AND entity_id IN ${clause}`).run(...inParams).changes || 0;
      report.deletedAssets += db.prepare(`DELETE FROM assets WHERE hash IN ${clause}`).run(...inParams).changes || 0;
    }
  });

  tx();

  return { ...report, orphanHashes: orphanHashes.length };
}

module.exports = { clearByRoot };


