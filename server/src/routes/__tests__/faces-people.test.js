/**
 * input: people/faces/assets 测试数据 + 人物 HTTP 路由
 * output: 人物筛选所需的头像裁剪元数据与照片数
 * pos: 路由层测试：锁定人物选择器依赖的接口结构
 */

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
});
