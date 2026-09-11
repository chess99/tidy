const path = require('path');

function normalizePath(value) {
  return String(value || '').trim().replaceAll('/', '\\').replace(/\\+/g, '\\').toLowerCase();
}

function mapImmichPath(remotePath, { remoteRoot, localRoot }) {
  const normalizedRemote = String(remotePath || '').replaceAll('\\', '/').replace(/\/+$/, '');
  const normalizedRoot = String(remoteRoot || '').replaceAll('\\', '/').replace(/\/+$/, '');
  if (!normalizedRemote || !normalizedRoot) return null;
  const lowerPath = normalizedRemote.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();
  if (lowerPath !== lowerRoot && !lowerPath.startsWith(`${lowerRoot}/`)) return null;
  const relative = normalizedRemote.slice(normalizedRoot.length).replace(/^\/+/, '');
  return path.win32.join(String(localRoot), ...relative.split('/'));
}

function parseAssetDimensions(metadataJson) {
  try {
    const metadata = JSON.parse(metadataJson || '{}');
    const width = Number(metadata.width);
    const height = Number(metadata.height);
    if (width > 0 && height > 0) return { width, height };
  } catch {
    // Invalid metadata is handled by falling back to the Immich preview dimensions.
  }
  return null;
}

function convertBox(face, assetDimensions) {
  const imageWidth = Number(face.imageWidth);
  const imageHeight = Number(face.imageHeight);
  const x1 = Number(face.x1);
  const y1 = Number(face.y1);
  const x2 = Number(face.x2);
  const y2 = Number(face.y2);
  if (![imageWidth, imageHeight, x1, y1, x2, y2].every(Number.isFinite)
    || imageWidth <= 0 || imageHeight <= 0 || x2 <= x1 || y2 <= y1) {
    return null;
  }

  const width = Number(assetDimensions?.width) || imageWidth;
  const height = Number(assetDimensions?.height) || imageHeight;
  return {
    x: x1 * width / imageWidth,
    y: y1 * height / imageHeight,
    width: (x2 - x1) * width / imageWidth,
    height: (y2 - y1) * height / imageHeight,
  };
}

function createImportStaging(db) {
  db.exec(`
    DROP TABLE IF EXISTS temp.immich_face_import;
    DROP TABLE IF EXISTS temp.immich_asset_import;
    CREATE TEMP TABLE immich_face_import (
      remote_face_id TEXT PRIMARY KEY,
      local_hash TEXT NOT NULL,
      remote_group_id TEXT,
      person_name TEXT,
      box TEXT NOT NULL,
      descriptor TEXT NOT NULL,
      is_avatar INTEGER NOT NULL DEFAULT 0,
      face_area REAL NOT NULL DEFAULT 0,
      local_person_id INTEGER,
      local_face_id INTEGER
    );
    CREATE TEMP TABLE immich_asset_import (
      remote_asset_id TEXT PRIMARY KEY,
      local_hash TEXT NOT NULL
    );
    CREATE INDEX temp.idx_immich_face_import_hash ON immich_face_import(local_hash);
    CREATE INDEX temp.idx_immich_face_import_group ON immich_face_import(remote_group_id);
    CREATE INDEX temp.idx_immich_asset_import_hash ON immich_asset_import(local_hash);
  `);
}

function createLocalAssetLookup(db) {
  const dimensions = new Map();
  for (const asset of db.prepare('SELECT hash, metadata FROM assets').iterate()) {
    dimensions.set(asset.hash, parseAssetDimensions(asset.metadata));
  }

  const paths = new Map();
  for (const file of db.prepare('SELECT path, hash FROM files WHERE hash IS NOT NULL').iterate()) {
    paths.set(normalizePath(file.path), file.hash);
  }
  return { dimensions, paths };
}

function createStageWriter(db, lookup, pathMapping) {
  const insertAsset = db.prepare(`
    INSERT OR REPLACE INTO temp.immich_asset_import (remote_asset_id, local_hash)
    VALUES (?, ?)
  `);
  const insert = db.prepare(`
    INSERT OR REPLACE INTO temp.immich_face_import (
      remote_face_id, local_hash, remote_group_id, person_name, box, descriptor, is_avatar, face_area
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return (face) => {
    const localPath = mapImmichPath(face.path, pathMapping);
    const localHash = localPath ? lookup.paths.get(normalizePath(localPath)) : null;
    if (!localHash) return { matched: false, localPath };
    insertAsset.run(String(face.assetId), localHash);
    if (face.kind === 'asset') return { matched: true, localPath, localHash, assetOnly: true };
    const box = convertBox(face, lookup.dimensions.get(localHash));
    if (!box) return { matched: false, localPath, reason: 'invalid_box' };
    const descriptor = String(face.embedding || '');
    if (!descriptor.startsWith('[') || !descriptor.endsWith(']')) {
      return { matched: false, localPath, reason: 'invalid_embedding' };
    }
    insert.run(
      String(face.faceId),
      localHash,
      face.personGroupId == null ? null : String(face.personGroupId),
      String(face.personName || '').trim() || null,
      JSON.stringify(box),
      descriptor,
      face.isAvatar ? 1 : 0,
      box.width * box.height
    );
    return { matched: true, localPath, localHash };
  };
}

function getStagingSummary(db, counters) {
  const staged = db.prepare(`
    SELECT
      COUNT(*) AS faces,
      COUNT(DISTINCT remote_group_id) AS people,
      SUM(CASE WHEN remote_group_id IS NULL THEN 1 ELSE 0 END) AS unassigned
    FROM temp.immich_face_import
  `).get();
  const matchedAssets = db.prepare('SELECT COUNT(*) AS count FROM temp.immich_asset_import').get().count;
  return {
    remoteFaces: counters.remoteFaces,
    remoteAssets: counters.remoteAssets.size,
    matchedFaces: Number(staged.faces) || 0,
    matchedAssets: Number(matchedAssets) || 0,
    matchedPeople: Number(staged.people) || 0,
    matchedUnassignedFaces: Number(staged.unassigned) || 0,
    unmatchedFaces: counters.remoteFaces - (Number(staged.faces) || 0),
    invalidFaces: counters.invalidFaces,
  };
}

function applyStagedImport(db) {
  return db.transaction(() => {
    const now = Date.now();
    db.prepare('DELETE FROM faces').run();
    db.prepare('DELETE FROM people').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('faces', 'people')").run();

    const people = new Map();
    const insertPerson = db.prepare(
      'INSERT INTO people (name, avatar_face_id, created_at, updated_at) VALUES (?, NULL, ?, ?)'
    );
    const personGroups = db.prepare(`
      SELECT remote_group_id, MAX(person_name) AS person_name
      FROM temp.immich_face_import
      WHERE remote_group_id IS NOT NULL
      GROUP BY remote_group_id
      ORDER BY remote_group_id
    `).all();
    const setLocalPerson = db.prepare(`
      UPDATE temp.immich_face_import
      SET local_person_id = ?
      WHERE remote_group_id = ?
    `);
    for (const row of personGroups) {
      const result = insertPerson.run(row.person_name, now, now);
      const personId = Number(result.lastInsertRowid);
      people.set(row.remote_group_id, personId);
      setLocalPerson.run(personId, row.remote_group_id);
    }

    db.prepare('UPDATE temp.immich_face_import SET local_face_id = rowid').run();
    const faces = db.prepare(`
      INSERT INTO faces (id, hash, person_id, descriptor, box, score, created_at)
      SELECT local_face_id, local_hash, local_person_id, descriptor, box, 1, ?
      FROM temp.immich_face_import
      ORDER BY local_face_id
    `).run(now).changes;

    const setAvatar = db.prepare('UPDATE people SET avatar_face_id = ?, updated_at = ? WHERE id = ?');
    const selectAvatar = db.prepare(`
      SELECT local_face_id AS id
      FROM temp.immich_face_import
      WHERE remote_group_id = ?
      ORDER BY is_avatar DESC, face_area DESC, local_face_id ASC
      LIMIT 1
    `);
    for (const [remoteGroupId, personId] of people) {
      const avatar = selectAvatar.get(remoteGroupId);
      if (avatar?.id) setAvatar.run(avatar.id, now, personId);
    }

    db.prepare('UPDATE assets SET face_scanned_at = NULL').run();
    db.prepare(`
      UPDATE assets
      SET face_scanned_at = ?
      WHERE hash IN (SELECT DISTINCT local_hash FROM temp.immich_asset_import)
    `).run(now);

    return {
      faces,
      people: people.size,
      assignedFaces: db.prepare('SELECT COUNT(*) AS count FROM faces WHERE person_id IS NOT NULL').get().count,
      unassignedFaces: db.prepare('SELECT COUNT(*) AS count FROM faces WHERE person_id IS NULL').get().count,
    };
  })();
}

module.exports = {
  applyStagedImport,
  convertBox,
  createImportStaging,
  createLocalAssetLookup,
  createStageWriter,
  getStagingSummary,
  mapImmichPath,
  normalizePath,
};
