describe('watcher startup', () => {
  const originalDisableWatcher = process.env.TIDY_DISABLE_WATCHER;

  afterEach(() => {
    if (originalDisableWatcher === undefined) {
      delete process.env.TIDY_DISABLE_WATCHER;
    } else {
      process.env.TIDY_DISABLE_WATCHER = originalDisableWatcher;
    }
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('does not read config or start chokidar when watcher is disabled', async () => {
    process.env.TIDY_DISABLE_WATCHER = '1';
    const getConfig = jest.fn(() => {
      throw new Error('getConfig should not be called');
    });
    const watch = jest.fn();

    jest.doMock('../../configStore', () => ({ getConfig }));
    jest.doMock('chokidar', () => ({ watch }));

    const { startWatcher } = require('../index');

    await expect(startWatcher()).resolves.toBeUndefined();
    expect(getConfig).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });
});
