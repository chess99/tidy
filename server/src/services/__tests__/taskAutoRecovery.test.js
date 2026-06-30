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
    const createJob = jest.fn((job) => ({ id: 10, ...job }));
    const listJobs = jest.fn(() => []);
    const get = jest.fn(() => ({ count: 12 }));
    const prepare = jest.fn(() => ({ get }));
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: true, facesQueued: true, missingFaceAssets: 12 });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'running' });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'queued' });
    expect(prepare.mock.calls[0][0]).toEqual(expect.stringContaining('a.face_scanned_at IS NULL'));
    expect(prepare.mock.calls[0][0]).toEqual(expect.stringContaining("a.status NOT IN ('trash', 'ignored')"));
    expect(prepare.mock.calls[0][0]).toEqual(expect.stringContaining('f.missing = 0'));
    expect(createJob).toHaveBeenCalledWith({
      type: 'faces_scan',
      mode: 'missing',
      params: { auto: true, reason: 'faces_capability_recovered' },
    });
  });

  test('does not enqueue when a running face job is already active', async () => {
    const createJob = jest.fn();
    const listJobs = jest.fn(({ status }) => {
      if (status === 'running') return [{ id: 5, type: 'faces_scan', status: 'running' }];
      return [];
    });
    const prepare = jest.fn(() => ({ get: jest.fn(() => ({ count: 12 })) }));
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: true, facesQueued: false, reason: 'faces_job_active' });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'running' });
    expect(listJobs).not.toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'queued' });
    expect(createJob).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('does not enqueue when a queued face job is already active', async () => {
    const createJob = jest.fn();
    const listJobs = jest.fn(({ status }) => {
      if (status === 'queued') return [{ id: 6, type: 'faces_scan', status: 'queued' }];
      return [];
    });
    const prepare = jest.fn(() => ({ get: jest.fn(() => ({ count: 12 })) }));
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../../db', () => ({ getDB: () => ({ prepare }) }));
    mockAvailableFaces();

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery({ force: true });

    expect(out).toEqual({ checked: true, facesQueued: false, reason: 'faces_job_active' });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'running' });
    expect(listJobs).toHaveBeenCalledWith({ limit: 1, type: 'faces_scan', status: 'queued' });
    expect(createJob).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('does not enqueue when face capability is unavailable', async () => {
    const createJob = jest.fn();
    const listJobs = jest.fn(() => []);
    const prepare = jest.fn();
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
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
    expect(listJobs).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  test('does not enqueue when there are no missing face assets', async () => {
    const createJob = jest.fn();
    const listJobs = jest.fn(() => []);
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: () => ({ get: () => ({ count: 0 }) }),
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
    expect(createJob).not.toHaveBeenCalled();
  });

  test('rate limits checks unless forced', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(100_000);
    const createJob = jest.fn();
    const listJobs = jest.fn(() => []);
    const getAiCapabilities = jest.fn(async () => ({
      faces: { available: true, code: null, message: 'ok' },
    }));
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: () => ({ get: () => ({ count: 0 }) }),
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
