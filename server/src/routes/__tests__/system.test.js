const request = require('supertest');

describe('system status route', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('returns AI capabilities and latest face job state', async () => {
    jest.doMock('../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        ok: true,
        faces: { available: false, code: 'insightface_unavailable', message: 'InsightFace unavailable' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 123,
      })),
    }));
    jest.doMock('../../jobs/store', () => ({
      listJobs: jest.fn(({ type }) => {
        if (type === 'faces_scan') {
          return [
            { id: 25, type: 'faces_scan', status: 'failed', last_error: 'faces_unavailable: InsightFace unavailable' },
          ];
        }
        if (type === 'clip_enrich') {
          return [];
        }
        return [
          { id: 99, type: 'other_task', status: 'finished' },
        ];
      }),
    }));

    const { createApp } = require('../../app');
    const app = createApp({ includeConfig: false });
    const res = await request(app).get('/api/system/status').expect(200);

    expect(res.body).toEqual({
      ok: true,
      ai: {
        ok: true,
        faces: { available: false, code: 'insightface_unavailable', message: 'InsightFace unavailable' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 123,
      },
      tasks: {
        faces: {
          latest: {
            id: 25,
            type: 'faces_scan',
            status: 'failed',
            last_error: 'faces_unavailable: InsightFace unavailable',
          },
        },
        clip: { latest: null },
      },
    });
  });
});
