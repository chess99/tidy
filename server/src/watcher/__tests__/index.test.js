describe('watcher startup', () => {
  const originalDisableWatcher = process.env.TIDY_DISABLE_WATCHER;
  const originalWatcherMode = process.env.TIDY_WATCHER_MODE;
  const originalFallbackInterval = process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS;

  afterEach(() => {
    if (originalDisableWatcher === undefined) delete process.env.TIDY_DISABLE_WATCHER;
    else process.env.TIDY_DISABLE_WATCHER = originalDisableWatcher;

    if (originalWatcherMode === undefined) delete process.env.TIDY_WATCHER_MODE;
    else process.env.TIDY_WATCHER_MODE = originalWatcherMode;

    if (originalFallbackInterval === undefined) delete process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS;
    else process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS = originalFallbackInterval;

    jest.useRealTimers();
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function mockBase({ roots = ['C:\\Photos'], decisions, watchImpl } = {}) {
    const getConfig = jest.fn(async () => ({
      scanRoots: roots.map((root) => ({ root, enabled: true })),
    }));
    const createJob = jest.fn((job) => ({ id: 88, ...job }));
    const createQueuedJobIfNoActiveJob = jest.fn((job) => ({ id: 99, ...job }));
    const watch = jest.fn(watchImpl || (() => {
      const handlers = {};
      return {
        on(event, handler) {
          handlers[event] = handler;
          return this;
        },
        close: jest.fn(),
        handlers,
      };
    }));
    jest.doMock('../../configStore', () => ({ getConfig }));
    jest.doMock('../../jobs/store', () => ({ createJob, createQueuedJobIfNoActiveJob }));
    jest.doMock('chokidar', () => ({ watch }));
    jest.doMock('../policy', () => ({
      getWatcherMode: jest.fn(() => 'auto'),
      decideWatcherRoots: jest.fn(() => decisions || {
        mode: 'auto',
        watchRoots: roots,
        skippedRoots: [],
        decisions: roots.map((root) => ({
          root,
          action: 'watch',
          reason: 'local_fixed_drive',
          message: 'watch',
        })),
      }),
    }));
    return { getConfig, createJob, createQueuedJobIfNoActiveJob, watch };
  }

  test('does not read config or start chokidar when watcher is disabled', async () => {
    process.env.TIDY_DISABLE_WATCHER = '1';
    const getConfig = jest.fn(() => {
      throw new Error('getConfig should not be called');
    });
    const watch = jest.fn();

    jest.doMock('../../configStore', () => ({ getConfig }));
    jest.doMock('../../jobs/store', () => ({
      createJob: jest.fn(),
      createQueuedJobIfNoActiveJob: jest.fn(),
    }));
    jest.doMock('chokidar', () => ({ watch }));
    jest.doMock('../policy', () => ({
      getWatcherMode: jest.fn(() => 'off'),
      decideWatcherRoots: jest.fn(),
    }));

    const { startWatcher, getWatcherStatus } = require('../index');

    await expect(startWatcher()).resolves.toBeUndefined();
    expect(getConfig).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(getWatcherStatus()).toMatchObject({ mode: 'off', state: 'disabled' });
  });

  test('starts chokidar only for watchable roots', async () => {
    const decisions = {
      mode: 'auto',
      watchRoots: ['C:\\Photos'],
      skippedRoots: ['Z:\\_document\\photos'],
      decisions: [
        { root: 'C:\\Photos', action: 'watch', reason: 'local_fixed_drive', message: 'watch' },
        { root: 'Z:\\_document\\photos', action: 'skip', reason: 'network_drive', message: 'fallback' },
      ],
    };
    const { watch } = mockBase({ roots: ['C:\\Photos', 'Z:\\_document\\photos'], decisions });

    const { startWatcher, getWatcherStatus } = require('../index');
    await startWatcher();

    expect(watch).toHaveBeenCalledWith(['C:\\Photos'], expect.objectContaining({ ignoreInitial: true }));
    expect(getWatcherStatus()).toMatchObject({
      mode: 'auto',
      state: 'watching',
      activeRoots: ['C:\\Photos'],
    });
    expect(getWatcherStatus().roots).toHaveLength(2);
  });

  test('starts fallback discover timer when all enabled roots are skipped', async () => {
    jest.useFakeTimers();
    process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS = '60000';
    const decisions = {
      mode: 'auto',
      watchRoots: [],
      skippedRoots: ['Z:\\_document\\photos'],
      decisions: [
        { root: 'Z:\\_document\\photos', action: 'skip', reason: 'network_drive', message: 'fallback' },
      ],
    };
    const { watch, createQueuedJobIfNoActiveJob } = mockBase({ roots: ['Z:\\_document\\photos'], decisions });

    const { startWatcher, getWatcherStatus } = require('../index');
    await startWatcher();

    expect(watch).not.toHaveBeenCalled();
    expect(getWatcherStatus()).toMatchObject({ state: 'fallback', fallbackIntervalMs: 60000 });

    jest.advanceTimersByTime(60000);
    expect(createQueuedJobIfNoActiveJob).toHaveBeenCalledWith({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
  });

  test('downgrades to fallback when chokidar emits an error in auto mode', async () => {
    jest.useFakeTimers();
    process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS = '60000';
    const watcherMock = {
      handlers: {},
      on(event, handler) {
        this.handlers[event] = handler;
        return this;
      },
      close: jest.fn(),
    };
    const { createQueuedJobIfNoActiveJob } = mockBase({
      roots: ['C:\\Photos'],
      watchImpl: () => watcherMock,
    });

    const { startWatcher, getWatcherStatus } = require('../index');
    await startWatcher();
    watcherMock.handlers.error(new Error('Z:\\ is not accessible. The system cannot open the file.'));

    expect(watcherMock.close).toHaveBeenCalled();
    expect(getWatcherStatus()).toMatchObject({
      state: 'fallback',
      lastError: 'Z:\\ is not accessible. The system cannot open the file.',
      fallbackIntervalMs: 60000,
    });

    jest.advanceTimersByTime(60000);
    expect(createQueuedJobIfNoActiveJob).toHaveBeenCalledWith({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
  });
});
