const request = require('supertest');

describe('system status route', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('returns AI capabilities and compact latest task summaries', async () => {
    const listJobs = jest.fn(({ type }) => {
      if (type === 'faces_scan') {
        return [
          {
            id: 25,
            type: 'faces_scan',
            status: 'failed',
            progress: 42,
            last_error: 'faces_unavailable: InsightFace unavailable',
            created_at: 100,
            updated_at: 101,
            started_at: 102,
            finished_at: 103,
            params: { force: true },
            result: { skipped: 10 },
          },
        ];
      }
      if (type === 'clip_enrich') {
        return [];
      }
      return [
        { id: 99, type: 'other_task', status: 'finished' },
      ];
    });

    jest.doMock('../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        ok: true,
        faces: { available: false, code: 'insightface_unavailable', message: 'InsightFace unavailable' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 123,
      })),
    }));
    jest.doMock('../../jobs/store', () => ({
      listJobs,
    }));
    jest.doMock('../../watcher', () => ({
      getWatcherStatus: jest.fn(() => ({
        mode: 'auto',
        state: 'watching',
        roots: [],
        activeRoots: ['C:\\Photos'],
        fallbackIntervalMs: null,
        lastError: null,
        updatedAt: 1000,
      })),
    }));

    const { createApp } = require('../../app');
    const app = createApp({ includeConfig: false });
    const res = await request(app).get('/api/system/status').expect(200);

    expect(listJobs).toHaveBeenNthCalledWith(1, { limit: 50, type: 'faces_scan' });
    expect(listJobs).toHaveBeenNthCalledWith(2, { limit: 50, type: 'clip_enrich' });
    expect(res.body).toEqual({
      ok: true,
      ai: {
        ok: true,
        faces: { available: false, code: 'insightface_unavailable', message: 'InsightFace unavailable' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 123,
      },
      watcher: {
        mode: 'auto',
        state: 'watching',
        roots: [],
        activeRoots: ['C:\\Photos'],
        fallbackIntervalMs: null,
        lastError: null,
        updatedAt: 1000,
      },
      tasks: {
        faces: {
          latest: {
            id: 25,
            type: 'faces_scan',
            status: 'failed',
            progress: 42,
            last_error: 'faces_unavailable: InsightFace unavailable',
            created_at: 100,
            updated_at: 101,
            started_at: 102,
            finished_at: 103,
          },
        },
        clip: { latest: null },
      },
    });
    expect(res.body.tasks.faces.latest.params).toBeUndefined();
    expect(res.body.tasks.faces.latest.result).toBeUndefined();
  });

  test('keeps AI status available when a task lookup fails', async () => {
    const listJobs = jest.fn(({ type }) => {
      if (type === 'faces_scan') {
        throw new Error('faces store unavailable');
      }
      if (type === 'clip_enrich') {
        return [
          {
            id: 7,
            type: 'clip_enrich',
            status: 'running',
            progress: 80,
            last_error: null,
            created_at: 200,
            updated_at: 201,
            started_at: 202,
            finished_at: null,
            params: { priority: 'high' },
          },
        ];
      }
      return [];
    });

    jest.doMock('../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        ok: true,
        faces: { available: true, code: null, message: 'ok' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 456,
      })),
    }));
    jest.doMock('../../jobs/store', () => ({
      listJobs,
    }));
    jest.doMock('../../watcher', () => ({
      getWatcherStatus: jest.fn(() => ({
        mode: 'auto',
        state: 'watching',
        roots: [],
        activeRoots: ['C:\\Photos'],
        fallbackIntervalMs: null,
        lastError: null,
        updatedAt: 1000,
      })),
    }));

    const { createApp } = require('../../app');
    const app = createApp({ includeConfig: false });
    const res = await request(app).get('/api/system/status').expect(200);

    expect(listJobs).toHaveBeenNthCalledWith(1, { limit: 50, type: 'faces_scan' });
    expect(listJobs).toHaveBeenNthCalledWith(2, { limit: 50, type: 'clip_enrich' });
    expect(res.body).toEqual({
      ok: true,
      ai: {
        ok: true,
        faces: { available: true, code: null, message: 'ok' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 456,
      },
      watcher: {
        mode: 'auto',
        state: 'watching',
        roots: [],
        activeRoots: ['C:\\Photos'],
        fallbackIntervalMs: null,
        lastError: null,
        updatedAt: 1000,
      },
      tasks: {
        faces: {
          latest: null,
          error: 'faces store unavailable',
        },
        clip: {
          latest: {
            id: 7,
            type: 'clip_enrich',
            status: 'running',
            progress: 80,
            last_error: null,
            created_at: 200,
            updated_at: 201,
            started_at: 202,
            finished_at: null,
          },
        },
      },
    });
  });

  test('returns watcher status with AI and task status', async () => {
    jest.doMock('../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        ok: true,
        faces: { available: true, code: null, message: 'ok' },
        clip: { available: true, code: null, message: 'ok' },
        checkedAt: 789,
      })),
    }));
    jest.doMock('../../jobs/store', () => ({
      listJobs: jest.fn(() => []),
    }));
    jest.doMock('../../watcher', () => ({
      getWatcherStatus: jest.fn(() => ({
        mode: 'auto',
        state: 'fallback',
        roots: [
          {
            root: 'Z:\\_document\\photos',
            action: 'skip',
            reason: 'network_drive',
            message: 'Network drive uses fallback scanning in auto mode',
          },
        ],
        activeRoots: [],
        fallbackIntervalMs: 3600000,
        lastError: null,
        updatedAt: 1000,
      })),
    }));

    const { createApp } = require('../../app');
    const app = createApp({ includeConfig: false });
    const res = await request(app).get('/api/system/status').expect(200);

    expect(res.body.watcher).toEqual({
      mode: 'auto',
      state: 'fallback',
      roots: [
        {
          root: 'Z:\\_document\\photos',
          action: 'skip',
          reason: 'network_drive',
          message: 'Network drive uses fallback scanning in auto mode',
        },
      ],
      activeRoots: [],
      fallbackIntervalMs: 3600000,
      lastError: null,
      updatedAt: 1000,
    });
  });
});
