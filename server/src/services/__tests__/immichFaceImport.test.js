const Database = require('better-sqlite3');
const {
  applyStagedImport,
  convertBox,
  createImportStaging,
  mapImmichPath,
  normalizePath,
} = require('../immichFaceImport');

describe('Immich face import mapping', () => {
  test('maps the external library path to the local Windows library', () => {
    expect(mapImmichPath('/external/photos/相册/IMG_0001.jpg', {
      remoteRoot: '/external/photos',
      localRoot: 'Z:\\_document\\photos',
    })).toBe('Z:\\_document\\photos\\相册\\IMG_0001.jpg');
  });

  test('does not map paths outside the configured external library', () => {
    expect(mapImmichPath('/data/upload/IMG_0001.jpg', {
      remoteRoot: '/external/photos',
      localRoot: 'Z:\\_document\\photos',
    })).toBeNull();
  });

  test('normalizes slash direction and case for lookup', () => {
    expect(normalizePath('Z:/Photos/A.JPG')).toBe('z:\\photos\\a.jpg');
  });

  test('scales an Immich preview face box into original image coordinates', () => {
    expect(convertBox({ imageWidth: 1000, imageHeight: 500, x1: 100, y1: 50, x2: 300, y2: 150 }, {
      width: 4000,
      height: 2000,
    })).toEqual({ x: 400, y: 200, width: 800, height: 400 });
  });

  test('replaces faces and people atomically from staging', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE assets (hash TEXT PRIMARY KEY, face_scanned_at INTEGER);
      CREATE TABLE people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        avatar_face_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE faces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash TEXT NOT NULL,
        person_id INTEGER,
        descriptor TEXT,
        box TEXT,
        score REAL,
        created_at INTEGER
      );
      INSERT INTO assets(hash) VALUES ('asset-1'), ('asset-2');
      INSERT INTO people(name) VALUES ('old');
      INSERT INTO faces(hash, person_id, descriptor, box) VALUES ('asset-1', 1, '[1,0]', '{}');
    `);
    createImportStaging(db);
    db.prepare('INSERT INTO temp.immich_asset_import VALUES (?, ?)').run('remote-asset-1', 'asset-1');
    db.prepare(`
      INSERT INTO temp.immich_face_import (
        remote_face_id, local_hash, remote_group_id, person_name, box, descriptor, is_avatar, face_area
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('remote-face-1', 'asset-1', 'remote-person-1', 'Alice', '{"x":1,"y":2,"width":3,"height":4}', '[1,0]', 1, 12);

    const result = applyStagedImport(db);

    expect(result).toMatchObject({ faces: 1, people: 1, assignedFaces: 1, unassignedFaces: 0 });
    expect(db.prepare('SELECT name, avatar_face_id FROM people').get()).toEqual({ name: 'Alice', avatar_face_id: 1 });
    expect(db.prepare('SELECT hash, person_id FROM faces').get()).toEqual({ hash: 'asset-1', person_id: 1 });
    expect(db.prepare('SELECT face_scanned_at FROM assets WHERE hash = ?').get('asset-1').face_scanned_at).not.toBeNull();
    expect(db.prepare('SELECT face_scanned_at FROM assets WHERE hash = ?').get('asset-2').face_scanned_at).toBeNull();
    db.close();
  });
});
