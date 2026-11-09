describe('watcher policy', () => {
  afterEach(() => {
    delete process.env.TIDY_DISABLE_WATCHER;
    delete process.env.TIDY_WATCHER_MODE;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function loadPolicy({ exists = true, driveInfo = null } = {}) {
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => exists),
      statSync: jest.fn(() => ({
        isDirectory: () => exists,
      })),
    }));
    jest.doMock('child_process', () => ({
      execFileSync: jest.fn(() => JSON.stringify(driveInfo)),
    }));
    return require('../policy');
  }

  test('legacy TIDY_DISABLE_WATCHER disables watcher', () => {
    process.env.TIDY_DISABLE_WATCHER = '1';
    const { getWatcherMode } = loadPolicy();

    expect(getWatcherMode()).toBe('off');
  });

  test('defaults to auto watcher mode', () => {
    const { getWatcherMode } = loadPolicy();

    expect(getWatcherMode()).toBe('auto');
  });

  test('classifies UNC roots as skipped in auto mode', () => {
    const { decideWatcherRoots } = loadPolicy();
    const out = decideWatcherRoots(['\\\\server\\share\\photos'], { mode: 'auto', platform: 'win32' });

    expect(out.watchRoots).toEqual([]);
    expect(out.decisions[0]).toMatchObject({
      root: '\\\\server\\share\\photos',
      action: 'skip',
      reason: 'unc_path',
    });
  });

  test('classifies Windows mapped network drive as skipped in auto mode', () => {
    const { decideWatcherRoots } = loadPolicy({
      driveInfo: { driveType: 4, providerName: '\\\\192.168.0.104\\Disk1' },
    });
    const out = decideWatcherRoots(['Z:\\_document\\photos'], { mode: 'auto', platform: 'win32' });

    expect(out.watchRoots).toEqual([]);
    expect(out.decisions[0]).toMatchObject({
      action: 'skip',
      reason: 'network_drive',
      driveType: 4,
      providerName: '\\\\192.168.0.104\\Disk1',
    });
  });

  test('uses valid PowerShell if else syntax when probing Windows drives', () => {
    const execFileSync = jest.fn(() => JSON.stringify({ driveType: 3, providerName: null }));
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      statSync: jest.fn(() => ({
        isDirectory: () => true,
      })),
    }));
    jest.doMock('child_process', () => ({ execFileSync }));
    const { decideWatcherRoots } = require('../policy');

    decideWatcherRoots(['Z:\\_document\\photos'], { mode: 'auto', platform: 'win32' });

    const script = execFileSync.mock.calls[0][1][2];
    expect(script).toContain('} else {');
    expect(script).not.toContain('}; else');
  });

  test('watches Windows fixed local drive in auto mode', () => {
    const { decideWatcherRoots } = loadPolicy({
      driveInfo: { driveType: 3, providerName: null },
    });
    const out = decideWatcherRoots(['C:\\Users\\me\\Pictures'], { mode: 'auto', platform: 'win32' });

    expect(out.watchRoots).toEqual(['C:\\Users\\me\\Pictures']);
    expect(out.decisions[0]).toMatchObject({
      action: 'watch',
      reason: 'local_fixed_drive',
      driveType: 3,
    });
  });

  test('force-on watches network roots when they are accessible', () => {
    const { decideWatcherRoots } = loadPolicy({
      driveInfo: { driveType: 4, providerName: '\\\\nas\\photos' },
    });
    const out = decideWatcherRoots(['Z:\\photos'], { mode: 'on', platform: 'win32' });

    expect(out.watchRoots).toEqual(['Z:\\photos']);
    expect(out.decisions[0]).toMatchObject({
      action: 'watch',
      reason: 'forced_on',
    });
  });

  test('inaccessible roots are skipped even when forced on', () => {
    const { decideWatcherRoots } = loadPolicy({ exists: false });
    const out = decideWatcherRoots(['Z:\\missing'], { mode: 'on', platform: 'win32' });

    expect(out.watchRoots).toEqual([]);
    expect(out.decisions[0]).toMatchObject({
      action: 'skip',
      reason: 'root_inaccessible',
    });
  });
});
