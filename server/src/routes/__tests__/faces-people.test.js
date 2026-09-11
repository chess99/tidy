const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');

describe('people routes', () => {
  let root;
  let app;
  let db;
  let closeDB;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-people-routes-'));
    process.env.DATA_DIR = path.join(root, 'data');
    process.env.DB_PATH = path.join(root, 'data', 'tidy.db');

    const dbModule = require('../../db');
    db = dbModule.initDB();
    closeDB = dbModule.closeDB;

    app = express();
    app.use(express.json());
    app.use('/api/faces', require('../faces'));
  });

  afterAll(async () => {
    closeDB?.();
    await fs.remove(root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
  });

  test('returns named people first with photo counts and serves cropped avatars', async () => {
    const portraitPath = path.join(root, 'portrait-a.png');
    await sharp({
      create: { width: 1000, height: 800, channels: 3, background: '#c08457' },
    }).png().toFile(portraitPath);
    db.prepare(`
      INSERT INTO assets (hash, metadata, status)
      VALUES ('portrait-a', '{}', 'inbox')
    `).run();
    db.prepare(`
      INSERT INTO files (path, hash, ext, missing)
      VALUES (?, 'portrait-a', '.png', 0)
    `).run(portraitPath);
    const namedPerson = db.prepare('INSERT INTO people (name) VALUES (?)').run('阿青').lastInsertRowid;
    const unnamedPerson = db.prepare('INSERT INTO people (name) VALUES (NULL)').run().lastInsertRowid;
    const avatarFace = db.prepare(`
      INSERT INTO faces (hash, person_id, box, score)
      VALUES ('portrait-a', ?, '{"x":100,"y":120,"width":240,"height":260}', 0.99)
    `).run(namedPerson).lastInsertRowid;
    db.prepare(`
      INSERT INTO faces (hash, person_id, box, score)
      VALUES ('portrait-a', ?, '{"x":500,"y":600,"width":200,"height":220}', 0.95)
    `).run(namedPerson);
    db.prepare(`
      INSERT INTO faces (hash, person_id, box, score)
      VALUES ('portrait-a', ?, '{"x":800,"y":900,"width":180,"height":190}', 0.9)
    `).run(unnamedPerson);
    db.prepare('UPDATE people SET avatar_face_id = ? WHERE id = ?').run(avatarFace, namedPerson);

    const response = await request(app).get('/api/faces/people').expect(200);

    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({
      id: Number(namedPerson),
      name: '阿青',
      face_count: 1,
    });
    expect(response.body[1]).toMatchObject({
      id: Number(unnamedPerson),
      name: null,
      face_count: 1,
    });

    const avatarResponse = await request(app)
      .get(`/api/faces/people/${namedPerson}/avatar?v=${avatarFace}`)
      .expect('Content-Type', /image\/jpeg/)
      .expect(200);
    expect(avatarResponse.headers['cache-control']).toContain('immutable');
    await expect(sharp(avatarResponse.body).metadata()).resolves.toMatchObject({
      width: 192,
      height: 192,
      format: 'jpeg',
    });
  });

  test('merges into the selected person and inherits missing name and avatar', async () => {
    db.prepare(`INSERT INTO assets (hash, metadata, status) VALUES ('merge-portrait', '{}', 'inbox')`).run();
    const sourceId = db.prepare('INSERT INTO people (name) VALUES (?)').run('小满').lastInsertRowid;
    const targetId = db.prepare('INSERT INTO people (name) VALUES (NULL)').run().lastInsertRowid;
    const sourceFaceId = db.prepare(`
      INSERT INTO faces (hash, person_id, box, score)
      VALUES ('merge-portrait', ?, '{"x":10,"y":10,"width":80,"height":80}', 0.99)
    `).run(sourceId).lastInsertRowid;
    const targetFaceId = db.prepare(`
      INSERT INTO faces (hash, person_id, box, score)
      VALUES ('merge-portrait', ?, '{"x":100,"y":100,"width":80,"height":80}', 0.98)
    `).run(targetId).lastInsertRowid;
    db.prepare('UPDATE people SET avatar_face_id = ? WHERE id = ?').run(sourceFaceId, sourceId);

    const response = await request(app)
      .post(`/api/faces/people/${sourceId}/merge`)
      .send({ intoPersonId: Number(targetId) })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      result: {
        fromId: Number(sourceId),
        intoId: Number(targetId),
        movedFaces: 1,
        name: '小满',
        avatarFaceId: Number(sourceFaceId),
      },
    });
    expect(db.prepare('SELECT * FROM people WHERE id = ?').get(sourceId)).toBeUndefined();
    expect(db.prepare('SELECT name, avatar_face_id FROM people WHERE id = ?').get(targetId)).toEqual({
      name: '小满',
      avatar_face_id: Number(sourceFaceId),
    });
    expect(db.prepare('SELECT person_id FROM faces WHERE id = ?').get(sourceFaceId).person_id).toBe(Number(targetId));
    expect(db.prepare('SELECT person_id FROM faces WHERE id = ?').get(targetFaceId).person_id).toBe(Number(targetId));
  });

  test('adds a name to an existing unnamed person', async () => {
    const personId = db.prepare('INSERT INTO people (name) VALUES (NULL)').run().lastInsertRowid;

    await request(app)
      .patch(`/api/faces/people/${personId}`)
      .send({ name: '阿夏' })
      .expect(200, { success: true, id: Number(personId), name: '阿夏' });

    expect(db.prepare('SELECT name FROM people WHERE id = ?').get(personId)).toEqual({ name: '阿夏' });
  });

  test('does not expose the removed split endpoint', async () => {
    await request(app)
      .post('/api/faces/people/1/split')
      .send({ faceIds: [1] })
      .expect(404);
  });
});
