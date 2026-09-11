const Database = require('better-sqlite3');
const { LinearFaceIndex } = require('../faceClustering');
const { reclusterPeople } = require('../reclusterPeople');

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE assets (hash TEXT PRIMARY KEY, captured_at INTEGER);
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
      created_at INTEGER,
      FOREIGN KEY(hash) REFERENCES assets(hash) ON DELETE CASCADE,
      FOREIGN KEY(person_id) REFERENCES people(id) ON DELETE SET NULL
    );
  `);
  return db;
}

const createLinearIndex = async (points) => new LinearFaceIndex(points);

describe('incremental people recognition persistence', () => {
  test('attaches an unassigned face without rebuilding the existing person', async () => {
    const db = createDb();
    db.exec(`
      INSERT INTO assets(hash, captured_at) VALUES ('a', 2), ('b', 1);
      INSERT INTO people(id, name, avatar_face_id) VALUES (42, 'Alice', 1);
      INSERT INTO faces(id, hash, person_id, descriptor, score) VALUES
        (1, 'a', 42, '[1,0]', 0.9),
        (2, 'b', NULL, '[0.6,0.8]', 0.8);
    `);

    const result = await reclusterPeople(db, { createIndex: createLinearIndex });

    expect(result).toMatchObject({ existingAssignedFaces: 1, assignedFaces: 1, newPeople: 0, people: 1 });
    expect(db.prepare('SELECT person_id FROM faces WHERE id = 2').get().person_id).toBe(42);
    expect(db.prepare('SELECT name FROM people WHERE id = 42').get().name).toBe('Alice');
    db.close();
  });

  test('creates one person for three mutually close unassigned faces', async () => {
    const db = createDb();
    db.exec(`
      INSERT INTO assets(hash, captured_at) VALUES ('a', 3), ('b', 2), ('c', 1);
      INSERT INTO faces(id, hash, descriptor, score) VALUES
        (1, 'a', '[1,0]', 0.8),
        (2, 'b', '[0.99,0.1]', 0.9),
        (3, 'c', '[0.98,-0.1]', 0.7);
    `);

    const result = await reclusterPeople(db, { createIndex: createLinearIndex });

    expect(result).toMatchObject({ assignedFaces: 3, newPeople: 1, people: 1, unassignedFaces: 0 });
    expect(db.prepare('SELECT COUNT(DISTINCT person_id) AS count FROM faces').get().count).toBe(1);
    expect(db.prepare('SELECT avatar_face_id FROM people').get().avatar_face_id).toBe(2);
    db.close();
  });
});
