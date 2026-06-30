describe('taskAutoRecovery', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function mockAvailableFaces() {
    jest.doMock('../aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: { available: true, code: null, message: 'ok' },
      })),
    }));
  }

  test('enqueues faces_scan missing when faces become available and missing assets exist', async () => {
    const createQueuedJobIfNoActiveJob = jest.fn((job) => ({ id: 10, status: 'queued', ...job }));
    const prepare = jest.fn((sql) => ({
      get: jest.fn(() => {
        if (sql.includes('FROM jobs')) return undefined;
        return { count: 12 };
      }),
    }));
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: true, facesQueued: true, missingFaceAssets: 12 });
    expect(prepare.mock.calls[0][0]).toEqual(expect.stringContaining("status IN ('queued', 'running')"));
    expect(prepare.mock.calls[1][0]).toEqual(expect.stringContaining('a.face_scanned_at IS NULL'));
    expect(prepare.mock.calls[1][0]).toEqual(expect.stringContaining("a.status NOT IN ('trash', 'ignored')"));
    expect(prepare.mock.calls[1][0]).toEqual(expect.stringContaining('f.missing = 0'));
    expect(createQueuedJobIfNoActiveJob).toHaveBeenCalledWith({
      type: 'faces_scan',
      mode: 'missing',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });
  });

  test('does not enqueue when an active face job already exists', async () => {
    const createQueuedJobIfNoActiveJob = jest.fn(() => null);
    const prepare = jest.fn(() => ({ get: jest.fn(() => ({ id: 5 })) }));
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: true, facesQueued: false, reason: 'faces_job_active' });
    expect(prepare.mock.calls[0][0]).toEqual(expect.stringContaining("status IN ('queued', 'running')"));
    expect(createQueuedJobIfNoActiveJob).not.toHaveBeenCalled();
  });

  test('does not enqueue when face capability is unavailable', async () => {
    const createQueuedJobIfNoActiveJob = jest.fn();
    const prepare = jest.fn();
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    jest.doMock('../aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: {
          available: false,
          code: 'insightface_unavailable',
          message: 'InsightFace unavailable',
        },
      })),
    }));

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({
      checked: true,
      facesQueued: false,
      reason: 'insightface_unavailable',
    });
    expect(createQueuedJobIfNoActiveJob).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('does not enqueue when there are no missing face assets', async () => {
    const createQueuedJobIfNoActiveJob = jest.fn();
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: (sql) => ({
          get: () => {
            if (sql.includes('FROM jobs')) return undefined;
            return { count: 0 };
          },
        }),
      }),
    }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({
      checked: true,
      facesQueued: false,
      reason: 'no_missing_face_assets',
      missingFaceAssets: 0,
    });
    expect(createQueuedJobIfNoActiveJob).not.toHaveBeenCalled();
  });

  test('rate limits checks unless forced', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(100_000);
    const createQueuedJobIfNoActiveJob = jest.fn();
    const getAiCapabilities = jest.fn(async () => ({
      faces: { available: true, code: null, message: 'ok' },
    }));
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: (sql) => ({
          get: () => {
            if (sql.includes('FROM jobs')) return undefined;
            return { count: 0 };
          },
        }),
      }),
    }));
    jest.doMock('../aiCapabilities', () => ({ getAiCapabilities }));

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');

    await runTaskAutoRecovery();
    const out = await runTaskAutoRecovery();
    await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: false, reason: 'interval' });
    expect(getAiCapabilities).toHaveBeenCalledTimes(2);
  });
});
