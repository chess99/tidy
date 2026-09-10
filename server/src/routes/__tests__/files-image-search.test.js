const express = require('express');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const request = require('supertest');

const mockClipImageEmbedBuffer = jest.fn(async () => ({
  embedding: [0.1, 0.2, 0.3],
  model: 'jinaai/jina-clip-v2',
  normalized: true,
}));
const mockQueryTopKByVector = jest.fn(async () => ({
  matches: [],
  model: 'jinaai/jina-clip-v2',
  dim: 3,
  normalized: true,
}));

jest.mock('../../services/aiClient', () => ({
  clipTextEmbed: jest.fn(),
  clipImageEmbedBuffer: mockClipImageEmbedBuffer,
}));
jest.mock('../../services/clipIndex', () => ({
  queryTopKByFileId: jest.fn(),
  queryTopKByVector: mockQueryTopKByVector,
}));

describe('temporary reference image search routes', () => {
  let root;
  let app;
  let closeDB;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-image-search-'));
    process.env.DATA_DIR = path.join(root, 'data');
    process.env.DB_PATH = path.join(root, 'data', 'tidy.db');

    const dbModule = require('../../db');
    dbModule.initDB();
    closeDB = dbModule.closeDB;

    app = express();
    app.use(express.json());
    app.use('/api/files', require('../files'));
  });

  afterAll(async () => {
    closeDB?.();
    await fs.remove(root);
    delete process.env.DATA_DIR;
    delete process.env.DB_PATH;
  });

  test('uploads once, searches by the short-lived id, then releases it', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const upload = await request(app)
      .post('/api/files/image-search')
      .set('content-type', 'image/jpeg')
      .send(bytes)
      .expect(201);

    expect(upload.body.imageSearchId).toEqual(expect.any(String));
    expect(upload.body.expiresAt).toEqual(expect.any(Number));
    expect(mockClipImageEmbedBuffer).toHaveBeenCalledWith({ imageBuffer: bytes, normalize: true });

    const search = await request(app)
      .post('/api/files')
      .send({ imageSearchId: upload.body.imageSearchId, page: 1, limit: 50 })
      .expect(200);
    expect(search.body.data).toEqual([]);
    expect(search.body.applied.searchKind).toBe('image');
    expect(mockQueryTopKByVector).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      expect.objectContaining({ model: 'jinaai/jina-clip-v2' })
    );

    await request(app).delete(`/api/files/image-search/${upload.body.imageSearchId}`).expect(204);
    const expired = await request(app)
      .post('/api/files')
      .send({ imageSearchId: upload.body.imageSearchId, page: 1, limit: 50 })
      .expect(410);
    expect(expired.body).toMatchObject({ code: 'IMAGE_SEARCH_EXPIRED' });
  });

  test('rejects non-image uploads before inference', async () => {
    await request(app)
      .post('/api/files/image-search')
      .set('content-type', 'text/plain')
      .send('not an image')
      .expect(415);
  });

  test('returns a stable migration code without exposing index filesystem paths', async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const upload = await request(app)
      .post('/api/files/image-search')
      .set('content-type', 'image/jpeg')
      .send(bytes)
      .expect(201);
    const error = new Error('智能搜索索引正在迁移到当前模型。完成 CLIP 处理和索引重建后将自动恢复。');
    error.statusCode = 409;
    error.code = 'CLIP_INDEX_MODEL_MISMATCH';
    mockQueryTopKByVector.mockRejectedValueOnce(error);

    const search = await request(app)
      .post('/api/files')
      .send({ imageSearchId: upload.body.imageSearchId, page: 1, limit: 50 })
      .expect(409);

    expect(search.body).toEqual({
      code: 'CLIP_INDEX_MODEL_MISMATCH',
      error: '智能搜索索引正在迁移到当前模型。完成 CLIP 处理和索引重建后将自动恢复。',
    });
    expect(JSON.stringify(search.body)).not.toContain('D:\\');
  });
});
