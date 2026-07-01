# Watcher Auto Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tidy automatically decide when scan roots should use real-time file watching, and safely downgrade network/mapped/UNC roots such as `Z:\_document\photos` to a non-watching fallback.

**Architecture:** Add a small watcher policy layer that classifies enabled scan roots before `chokidar.watch()` starts. Local fixed disks are watched by default; UNC, mapped network, removable, inaccessible, or watcher-error roots are skipped in auto mode and reported through system status. The watcher module owns fallback discover scheduling so the rest of the app still sees ordinary `discover missing` jobs.

**Tech Stack:** Node.js, Express, chokidar, SQLite job queue, Jest, React + TanStack Query.

---

## File Structure

- Create `server/src/watcher/policy.js`: pure-ish watcher policy boundary. It normalizes mode, probes Windows drive type, classifies roots, and returns watch/skip decisions.
- Test `server/src/watcher/__tests__/policy.test.js`: unit coverage for local paths, UNC paths, mapped network drives, inaccessible roots, forced modes, and legacy `TIDY_DISABLE_WATCHER`.
- Modify `server/src/watcher/index.js`: consume policy decisions, start chokidar only for watchable roots, record watcher status, start/stop fallback discover scheduling, and downgrade on watcher errors.
- Extend `server/src/watcher/__tests__/index.test.js`: startup behavior for auto-skipped network roots, forced off, forced on, fallback discover scheduling, and error downgrade.
- Modify `server/src/routes/system.js`: include watcher status in `/api/system/status`.
- Extend `server/src/routes/__tests__/system.test.js`: route returns watcher status without breaking existing AI/task status.
- Modify `client/src/components/systemHealthModel.js`: add a watcher summary model.
- Extend `client/src/components/systemHealthModel.test.js`: unit coverage for watcher summary text.
- Modify `client/src/components/SystemHealthSection.jsx`: show compact watcher status as a third health row or small section.
- Modify docs:
  - `server/src/watcher/README.md` (create if missing): document watcher policy and fallback.
  - `server/src/routes/README.md`: mention `watcher` in system status.
  - `docs/开发指南.md`: document `TIDY_WATCHER_MODE` and why network roots default to fallback.

## Behavioral Decisions

- `TIDY_DISABLE_WATCHER=1` remains supported and means watcher mode `off`.
- New `TIDY_WATCHER_MODE` supports:
  - `auto` (default): local fixed roots watch; network/removable/UNC/inaccessible roots skip.
  - `off`: no chokidar and no fallback scheduling.
  - `on`: try watching all accessible roots, even network/removable roots. Inaccessible roots still skip because there is nothing safe to watch.
- Network fallback is not low-level file polling. It is a conservative periodic `discover missing` job so the existing scanner remains the single source of truth.
- Fallback discover interval defaults to 60 minutes and is configurable with `TIDY_WATCHER_FALLBACK_INTERVAL_MS`.
- Fallback scheduling uses `createQueuedJobIfNoActiveJob({ type: 'discover', mode: 'missing', params: { auto: true, reason: 'watcher_fallback' } })` to avoid duplicate discover jobs.
- A chokidar runtime error in auto mode downgrades watcher state, closes the watcher, and starts fallback scheduling. This prevents repeated noisy errors from destabilizing `yarn dev`.
- Simplified settings should show watcher health compactly, not expose advanced toggles. Advanced overrides stay as environment variables.

---

### Task 1: Watcher Policy Classifier

**Files:**
- Create: `server/src/watcher/policy.js`
- Create: `server/src/watcher/__tests__/policy.test.js`

- [ ] **Step 1: Write failing policy tests**

Create `server/src/watcher/__tests__/policy.test.js`:

```javascript
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
    const out = decideWatcherRoots(['\\\\server\\share\\photos'], { mode: 'auto' });

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
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd server
npm test -- src/watcher/__tests__/policy.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../policy'`.

- [ ] **Step 3: Implement `policy.js`**

Create `server/src/watcher/policy.js`:

```javascript
/**
 * input: configured scan roots + environment + filesystem/drive probes
 * output: per-root watcher decisions and watchable root list
 * pos: watcher policy boundary; keeps platform/path capability checks out of watcher runtime
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DRIVE_TYPES = {
  removable: 2,
  fixed: 3,
  network: 4,
  cdrom: 5,
  ramdisk: 6,
};

function normalizeMode(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'on' || value === 'force' || value === 'watch') return 'on';
  if (value === 'off' || value === 'false' || value === '0' || value === 'disabled') return 'off';
  return 'auto';
}

function getWatcherMode(env = process.env) {
  if (env.TIDY_DISABLE_WATCHER === '1') return 'off';
  return normalizeMode(env.TIDY_WATCHER_MODE || 'auto');
}

function isUncPath(root) {
  return /^\\\\[^\\]+\\[^\\]+/.test(String(root || ''));
}

function rootExists(root) {
  try {
    if (!fs.existsSync(root)) return false;
    const stat = fs.statSync(root);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function driveLetter(root) {
  const parsed = path.win32.parse(String(root || ''));
  const match = parsed.root.match(/^([a-zA-Z]):\\/);
  return match ? `${match[1].toUpperCase()}:` : null;
}

function getWindowsDriveInfo(root) {
  const letter = driveLetter(root);
  if (!letter) return null;
  try {
    const script = [
      `$d = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter}'"`,
      'if ($null -eq $d) { "{}" }',
      'else { @{ driveType = [int]$d.DriveType; providerName = [string]$d.ProviderName } | ConvertTo-Json -Compress }',
    ].join('; ');
    const stdout = execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000,
    });
    const json = JSON.parse(String(stdout || '{}').trim() || '{}');
    if (!json || typeof json !== 'object') return null;
    return {
      driveType: Number.isFinite(Number(json.driveType)) ? Number(json.driveType) : null,
      providerName: json.providerName || null,
    };
  } catch {
    return null;
  }
}

function decision(root, action, reason, extra = {}) {
  return {
    root,
    action,
    reason,
    message: messageFor(reason, extra),
    ...extra,
  };
}

function messageFor(reason, extra = {}) {
  if (reason === 'forced_off') return 'File watcher disabled by configuration';
  if (reason === 'forced_on') return 'File watcher forced on for this root';
  if (reason === 'root_inaccessible') return 'Scan root is not accessible';
  if (reason === 'unc_path') return 'UNC/network roots use fallback scanning in auto mode';
  if (reason === 'network_drive') return `Network drive${extra.providerName ? ` (${extra.providerName})` : ''} uses fallback scanning in auto mode`;
  if (reason === 'removable_drive') return 'Removable drives use fallback scanning in auto mode';
  if (reason === 'local_fixed_drive') return 'Local fixed drive is watched in auto mode';
  return reason;
}

function classifyRoot(root, { mode = getWatcherMode(), platform = process.platform } = {}) {
  const normalizedRoot = String(root || '').trim();
  if (!normalizedRoot || !rootExists(normalizedRoot)) {
    return decision(normalizedRoot, 'skip', 'root_inaccessible');
  }

  if (mode === 'off') {
    return decision(normalizedRoot, 'skip', 'forced_off');
  }

  if (mode === 'on') {
    return decision(normalizedRoot, 'watch', 'forced_on');
  }

  if (platform === 'win32') {
    if (isUncPath(normalizedRoot)) {
      return decision(normalizedRoot, 'skip', 'unc_path');
    }

    const driveInfo = getWindowsDriveInfo(normalizedRoot);
    if (driveInfo?.driveType === DRIVE_TYPES.network) {
      return decision(normalizedRoot, 'skip', 'network_drive', driveInfo);
    }
    if (driveInfo?.driveType === DRIVE_TYPES.removable) {
      return decision(normalizedRoot, 'skip', 'removable_drive', driveInfo);
    }
    if (driveInfo?.driveType === DRIVE_TYPES.fixed) {
      return decision(normalizedRoot, 'watch', 'local_fixed_drive', driveInfo);
    }
  }

  return decision(normalizedRoot, 'watch', 'local_path');
}

function decideWatcherRoots(roots, opts = {}) {
  const mode = opts.mode || getWatcherMode();
  const platform = opts.platform || process.platform;
  const decisions = (Array.isArray(roots) ? roots : []).map((root) => classifyRoot(root, { mode, platform }));
  return {
    mode,
    decisions,
    watchRoots: decisions.filter((item) => item.action === 'watch').map((item) => item.root),
    skippedRoots: decisions.filter((item) => item.action === 'skip').map((item) => item.root),
  };
}

module.exports = {
  DRIVE_TYPES,
  getWatcherMode,
  normalizeMode,
  classifyRoot,
  decideWatcherRoots,
};
```

- [ ] **Step 4: Run policy tests**

Run:

```powershell
cd server
npm test -- src/watcher/__tests__/policy.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/watcher/policy.js server/src/watcher/__tests__/policy.test.js
git commit -m "Add automatic watcher root policy"
```

---

### Task 2: Watcher Runtime Downgrade And Fallback Discover

**Files:**
- Modify: `server/src/watcher/index.js`
- Modify: `server/src/watcher/__tests__/index.test.js`

- [ ] **Step 1: Add failing watcher runtime tests**

Replace `server/src/watcher/__tests__/index.test.js` with:

```javascript
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
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob }));
    jest.doMock('chokidar', () => ({ watch }));
    jest.doMock('../policy', () => ({
      getWatcherMode: jest.fn(() => 'auto'),
      decideWatcherRoots: jest.fn(() => decisions || {
        mode: 'auto',
        watchRoots: roots,
        skippedRoots: [],
        decisions: roots.map((root) => ({ root, action: 'watch', reason: 'local_fixed_drive', message: 'watch' })),
      }),
    }));
    return { getConfig, createQueuedJobIfNoActiveJob, watch };
  }

  test('does not read config or start chokidar when watcher is disabled', async () => {
    process.env.TIDY_DISABLE_WATCHER = '1';
    const getConfig = jest.fn(() => {
      throw new Error('getConfig should not be called');
    });
    const watch = jest.fn();

    jest.doMock('../../configStore', () => ({ getConfig }));
    jest.doMock('../../jobs/store', () => ({ createQueuedJobIfNoActiveJob: jest.fn() }));
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
    process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS = '1000';
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
    expect(getWatcherStatus()).toMatchObject({ state: 'fallback' });

    jest.advanceTimersByTime(1000);
    expect(createQueuedJobIfNoActiveJob).toHaveBeenCalledWith({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
  });

  test('downgrades to fallback when chokidar emits an error in auto mode', async () => {
    jest.useFakeTimers();
    process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS = '1000';
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
    });

    jest.advanceTimersByTime(1000);
    expect(createQueuedJobIfNoActiveJob).toHaveBeenCalledWith({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd server
npm test -- src/watcher/__tests__/index.test.js --runInBand
```

Expected: FAIL because `getWatcherStatus`, policy integration, and fallback scheduling do not exist.

- [ ] **Step 3: Implement watcher runtime state and fallback**

Modify `server/src/watcher/index.js` to use this complete implementation:

```javascript
/**
 * input: scanRoots config + filesystem events + watcher policy
 * output: automatic discover jobs and watcher operational status
 * pos: filesystem watcher module; decides when real-time watching is safe and falls back otherwise
 */

const chokidar = require('chokidar');
const path = require('path');
const { getConfig } = require('../configStore');
const { createJob, createQueuedJobIfNoActiveJob } = require('../jobs/store');
const { decideWatcherRoots, getWatcherMode } = require('./policy');

let watcher = null;
let debounceTimer = null;
let fallbackTimer = null;
const DEBOUNCE_MS = 3000;
const DEFAULT_FALLBACK_INTERVAL_MS = 60 * 60 * 1000;

let watcherStatus = {
  mode: 'auto',
  state: 'idle',
  roots: [],
  activeRoots: [],
  fallbackIntervalMs: null,
  lastError: null,
  updatedAt: Date.now(),
};

function now() {
  return Date.now();
}

function fallbackIntervalMs() {
  const raw = Number(process.env.TIDY_WATCHER_FALLBACK_INTERVAL_MS);
  if (!Number.isFinite(raw)) return DEFAULT_FALLBACK_INTERVAL_MS;
  return Math.max(60_000, Math.trunc(raw));
}

function setStatus(patch) {
  watcherStatus = {
    ...watcherStatus,
    ...patch,
    updatedAt: now(),
  };
}

function getWatcherStatus() {
  return {
    ...watcherStatus,
    roots: watcherStatus.roots.map((root) => ({ ...root })),
    activeRoots: [...watcherStatus.activeRoots],
  };
}

function shouldIgnore(filePath) {
  const basename = path.basename(filePath);
  if (basename.startsWith('.')) return true;
  if (basename.startsWith('~')) return true;
  if (basename.endsWith('.tmp')) return true;
  if (basename.endsWith('.temp')) return true;
  if (basename === 'Thumbs.db') return true;
  if (basename === '.DS_Store') return true;
  if (basename.endsWith('.part')) return true;
  return false;
}

function triggerDiscover() {
  try {
    const job = createJob({ type: 'discover', mode: 'missing' });
    console.log('[watcher] Auto-triggered discover job:', job.id);
  } catch (err) {
    console.error('[watcher] Failed to create discover job:', err);
  }
}

function triggerFallbackDiscover() {
  try {
    const job = createQueuedJobIfNoActiveJob({
      type: 'discover',
      mode: 'missing',
      params: { auto: true, reason: 'watcher_fallback' },
    });
    if (job) {
      console.log('[watcher] Fallback discover job:', job.id);
    }
  } catch (err) {
    console.error('[watcher] Failed to create fallback discover job:', err);
  }
}

let pendingChanges = 0;
let lastLogTime = 0;

function onFileChange(eventType, filePath) {
  if (shouldIgnore(filePath)) return;

  pendingChanges++;

  const ts = Date.now();
  if (ts - lastLogTime > 5000) {
    console.log(`[watcher] ${pendingChanges} file(s) changed, will scan soon...`);
    lastLogTime = ts;
    pendingChanges = 0;
  }

  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    if (pendingChanges > 0) {
      console.log(`[watcher] Detected ${pendingChanges} change(s), triggering scan...`);
      pendingChanges = 0;
    }
    triggerDiscover();
  }, DEBOUNCE_MS);
}

async function getEnabledScanRoots() {
  const cfg = await getConfig();
  return (cfg.scanRoots || [])
    .filter((r) => r.enabled !== false && r.root)
    .map((r) => r.root);
}

function stopFallbackScheduler() {
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
}

function startFallbackScheduler() {
  stopFallbackScheduler();
  const intervalMs = fallbackIntervalMs();
  fallbackTimer = setInterval(triggerFallbackDiscover, intervalMs);
  if (typeof fallbackTimer.unref === 'function') fallbackTimer.unref();
  setStatus({
    state: 'fallback',
    fallbackIntervalMs: intervalMs,
  });
  console.log(`[watcher] Using fallback discover every ${Math.round(intervalMs / 1000)}s`);
}

function closeWatcherOnly() {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[watcher] Stopped');
  }
}

function downgradeToFallback(error) {
  const message = String(error?.message || error || 'watcher_error');
  console.error('[watcher] Error, switching to fallback discover:', message);
  closeWatcherOnly();
  setStatus({ lastError: message });
  startFallbackScheduler();
}

async function startWatcher() {
  const mode = getWatcherMode();
  if (mode === 'off') {
    console.log('[watcher] Disabled by watcher mode');
    setStatus({
      mode,
      state: 'disabled',
      roots: [],
      activeRoots: [],
      fallbackIntervalMs: null,
      lastError: null,
    });
    return;
  }

  if (watcher) {
    console.log('[watcher] Already running, stopping first...');
    stopWatcher();
  } else {
    stopFallbackScheduler();
  }

  const roots = await getEnabledScanRoots();
  if (roots.length === 0) {
    console.log('[watcher] No enabled scan roots, skipping file watcher');
    setStatus({
      mode,
      state: 'idle',
      roots: [],
      activeRoots: [],
      fallbackIntervalMs: null,
      lastError: null,
    });
    return;
  }

  const plan = decideWatcherRoots(roots, { mode });
  setStatus({
    mode: plan.mode,
    state: plan.watchRoots.length > 0 ? 'starting' : 'fallback',
    roots: plan.decisions,
    activeRoots: plan.watchRoots,
    fallbackIntervalMs: null,
    lastError: null,
  });

  if (plan.watchRoots.length === 0) {
    console.log('[watcher] No watchable roots in current policy; using fallback discover');
    startFallbackScheduler();
    return;
  }

  if (plan.skippedRoots.length > 0) {
    startFallbackScheduler();
  }

  console.log('[watcher] Starting file watcher for roots:', plan.watchRoots);

  watcher = chokidar.watch(plan.watchRoots, {
    ignored: [
      /(^|[\/\\])\../,
      '**/node_modules/**',
      '**/.git/**',
      '**/Thumbs.db',
      '**/.DS_Store',
      '**/*.tmp',
      '**/*.temp',
      '**/*.part',
    ],
    persistent: true,
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 100,
    },
  });

  watcher
    .on('add', (filePath) => onFileChange('add', filePath))
    .on('change', (filePath) => onFileChange('change', filePath))
    .on('unlink', (filePath) => onFileChange('unlink', filePath))
    .on('addDir', (dirPath) => onFileChange('addDir', dirPath))
    .on('unlinkDir', (dirPath) => onFileChange('unlinkDir', dirPath))
    .on('error', (error) => {
      if (mode === 'auto') downgradeToFallback(error);
      else {
        const message = String(error?.message || error || 'watcher_error');
        setStatus({ state: 'error', lastError: message });
        console.error('[watcher] Error:', error);
      }
    })
    .on('ready', () => {
      setStatus({ state: 'watching' });
      console.log('[watcher] Ready, watching', plan.watchRoots.length, 'root(s)');
    });
}

function stopWatcher() {
  closeWatcherOnly();
  stopFallbackScheduler();
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  setStatus({
    state: 'stopped',
    activeRoots: [],
    fallbackIntervalMs: null,
  });
}

async function restartWatcher() {
  console.log('[watcher] Restarting...');
  await startWatcher();
}

module.exports = {
  startWatcher,
  stopWatcher,
  restartWatcher,
  getWatcherStatus,
};
```

- [ ] **Step 4: Run watcher tests**

Run:

```powershell
cd server
npm test -- src/watcher/__tests__/index.test.js src/watcher/__tests__/policy.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/watcher/index.js server/src/watcher/__tests__/index.test.js
git commit -m "Auto-downgrade unsafe file watchers"
```

---

### Task 3: System Status Watcher Reporting

**Files:**
- Modify: `server/src/routes/system.js`
- Modify: `server/src/routes/__tests__/system.test.js`

- [ ] **Step 1: Add failing system status assertion**

Append this test to `server/src/routes/__tests__/system.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/routes/__tests__/system.test.js --runInBand
```

Expected: FAIL because `watcher` is absent from the response.

- [ ] **Step 3: Add watcher status to route**

Modify `server/src/routes/system.js`:

```javascript
const { getWatcherStatus } = require('../watcher');
```

Then change the route response:

```javascript
router.get('/status', async (_req, res) => {
  const ai = await getAiCapabilities();
  res.json({
    ok: true,
    ai,
    watcher: getWatcherStatus(),
    tasks: {
      faces: latestTask('faces_scan'),
      clip: latestTask('clip_enrich'),
    },
  });
});
```

- [ ] **Step 4: Run system route tests**

Run:

```powershell
cd server
npm test -- src/routes/__tests__/system.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/routes/system.js server/src/routes/__tests__/system.test.js
git commit -m "Expose watcher status in system health"
```

---

### Task 4: Settings Health Watcher UI

**Files:**
- Modify: `client/src/components/systemHealthModel.js`
- Modify: `client/src/components/systemHealthModel.test.js`
- Modify: `client/src/components/SystemHealthSection.jsx`

- [ ] **Step 1: Add failing watcher model tests**

Append to `client/src/components/systemHealthModel.test.js`:

```javascript
test('returns watcher fallback summary for network roots', () => {
  const model = getWatcherSummaryModel({
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
  });

  assert.equal(model.kind, 'unknown');
  assert.equal(model.label, '降级扫描');
  assert.equal(model.detail, '网络盘已关闭实时监听，系统会定期补扫。');
});

test('returns watcher ok summary when local roots are watched', () => {
  const model = getWatcherSummaryModel({
    mode: 'auto',
    state: 'watching',
    roots: [
      { root: 'C:\\Users\\me\\Pictures', action: 'watch', reason: 'local_fixed_drive' },
    ],
    activeRoots: ['C:\\Users\\me\\Pictures'],
  });

  assert.equal(model.kind, 'ok');
  assert.equal(model.label, '实时监听');
  assert.equal(model.detail, '正在监听 1 个本地目录。');
});

test('returns watcher disabled summary when watcher is off', () => {
  const model = getWatcherSummaryModel({
    mode: 'off',
    state: 'disabled',
    roots: [],
    activeRoots: [],
  });

  assert.equal(model.kind, 'unknown');
  assert.equal(model.label, '已关闭');
  assert.equal(model.detail, '文件监听已关闭，可通过手动扫描更新图库。');
});
```

Update the import in the same file:

```javascript
import { getCapabilityModel, getTaskSummaryModel, getWatcherSummaryModel } from './systemHealthModel.js';
```

- [ ] **Step 2: Run model tests to verify failure**

Run:

```powershell
cd client
node --test src/components/systemHealthModel.test.js
```

Expected: FAIL with `getWatcherSummaryModel` not exported.

- [ ] **Step 3: Implement watcher summary model**

Append to `client/src/components/systemHealthModel.js`:

```javascript
export function getWatcherSummaryModel(watcher) {
  if (!watcher || typeof watcher !== 'object') {
    return {
      kind: 'unknown',
      label: '未知',
      detail: '文件监听状态暂不可用。',
    };
  }

  if (watcher.mode === 'off' || watcher.state === 'disabled') {
    return {
      kind: 'unknown',
      label: '已关闭',
      detail: '文件监听已关闭，可通过手动扫描更新图库。',
    };
  }

  if (watcher.state === 'watching') {
    const count = Array.isArray(watcher.activeRoots) ? watcher.activeRoots.length : 0;
    return {
      kind: 'ok',
      label: '实时监听',
      detail: `正在监听 ${count} 个本地目录。`,
    };
  }

  if (watcher.state === 'fallback') {
    const hasNetworkRoot = Array.isArray(watcher.roots)
      ? watcher.roots.some((root) => root?.reason === 'network_drive' || root?.reason === 'unc_path')
      : false;
    return {
      kind: 'unknown',
      label: '降级扫描',
      detail: hasNetworkRoot
        ? '网络盘已关闭实时监听，系统会定期补扫。'
        : '当前目录不适合实时监听，系统会定期补扫。',
    };
  }

  if (watcher.state === 'error') {
    return {
      kind: 'issue',
      label: '监听异常',
      detail: asTrimmedString(watcher.lastError) || '文件监听遇到异常。',
    };
  }

  return {
    kind: 'unknown',
    label: '检查中',
    detail: '正在判断目录监听方式。',
  };
}
```

- [ ] **Step 4: Render watcher row in system health**

Modify `client/src/components/SystemHealthSection.jsx` import:

```javascript
import { getCapabilityModel, getTaskSummaryModel, getWatcherSummaryModel } from './systemHealthModel';
```

Add a `FolderSync` icon import:

```javascript
import { AlertCircle, CheckCircle2, CircleHelp, FolderSync, Loader2, RefreshCw, ScanFace, Search } from 'lucide-react';
```

Add a watcher row component after the two health rows:

```javascript
function WatcherRow({ watcher, isLoading = false }) {
  const model = isLoading
    ? { kind: 'loading', label: '检查中', detail: '正在判断目录监听方式。' }
    : getWatcherSummaryModel(watcher);
  const meta = STATUS_META[model.kind];
  const StatusIcon = meta.icon;

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-white px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-600">
        <FolderSync className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-gray-900">文件监听</div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${meta.badgeClassName}`}>
            <StatusIcon className={`h-3.5 w-3.5 ${meta.iconClassName}`} />
            {model.label}
          </span>
        </div>
        <div className="mt-1 break-words text-xs text-gray-500">{model.detail}</div>
      </div>
    </div>
  );
}
```

Render it under the CLIP row:

```jsx
<WatcherRow watcher={status?.watcher} isLoading={isInitialLoading} />
```

- [ ] **Step 5: Run frontend checks**

Run:

```powershell
cd client
node --test src/components/systemHealthModel.test.js
npm run build
```

Expected: tests PASS and build PASS. Existing Vite warnings about chunk size or unrelated directives are acceptable if unchanged.

- [ ] **Step 6: Commit**

```powershell
git add client/src/components/systemHealthModel.js client/src/components/systemHealthModel.test.js client/src/components/SystemHealthSection.jsx
git commit -m "Show watcher policy in system health"
```

---

### Task 5: Documentation And Operational Verification

**Files:**
- Create: `server/src/watcher/README.md`
- Modify: `server/src/routes/README.md`
- Modify: `docs/开发指南.md`

- [ ] **Step 1: Add watcher README**

Create `server/src/watcher/README.md`:

```markdown
# watcher

输入：扫描目录配置、文件系统事件、根目录能力探测。

输出：安全的文件监听状态，以及必要时的 fallback discover 任务。

## 策略

`TIDY_WATCHER_MODE` 支持：

- `auto`：默认。固定本地盘启用实时监听；UNC、映射网络盘、可移动盘、不可访问目录降级为 fallback discover。
- `off`：关闭 watcher 与 fallback discover。`TIDY_DISABLE_WATCHER=1` 等价于 `off`。
- `on`：对可访问目录强制尝试 watcher。网络盘仍可能由 chokidar/系统层报错；auto 模式更适合日常使用。

## 网络盘

Windows 映射盘（例如 `Z:\` 指向 `\\192.168.0.104\Disk1`）不适合默认递归 watcher。SMB 目录监听可能返回 `UNKNOWN` 或 `The system cannot open the file`。Tidy 在 auto 模式下不会对这类根目录调用 `chokidar.watch()`，而是定期创建 `discover missing` 任务。

## fallback discover

fallback 不是低层文件轮询，而是保守地复用现有扫描任务：

```js
{ type: 'discover', mode: 'missing', params: { auto: true, reason: 'watcher_fallback' } }
```

默认间隔为 60 分钟，可通过 `TIDY_WATCHER_FALLBACK_INTERVAL_MS` 调整，最小值为 60 秒。
```

- [ ] **Step 2: Update routes README**

In `server/src/routes/README.md`, add this bullet:

```markdown
- `system.js`：系统状态接口，聚合 AI 能力、最近任务摘要和 watcher 策略/降级状态，供简化设置页显示。
```

- [ ] **Step 3: Update development guide**

In `docs/开发指南.md`, add a short section near local development startup notes:

```markdown
### 文件监听策略

默认 `TIDY_WATCHER_MODE=auto`。本地固定磁盘会启用实时 watcher；UNC、映射网络盘（例如 `Z:\` 指向 NAS/SMB）、可移动盘或不可访问目录会自动降级为 fallback discover，避免 chokidar 在 Windows 网络盘上报 `UNKNOWN` 或 `The system cannot open the file`。

可选环境变量：

- `TIDY_WATCHER_MODE=auto|off|on`
- `TIDY_DISABLE_WATCHER=1`：兼容旧开关，等价于 `TIDY_WATCHER_MODE=off`
- `TIDY_WATCHER_FALLBACK_INTERVAL_MS=3600000`：fallback discover 间隔，默认 60 分钟，最小 60 秒

使用 `Z:\_document\photos` 这类网络盘时，建议保持默认 `auto`，不要强制开启 watcher。
```

- [ ] **Step 4: Run full focused verification**

Run:

```powershell
cd server
npm test -- src/watcher/__tests__/policy.test.js src/watcher/__tests__/index.test.js src/routes/__tests__/system.test.js --runInBand
cd ../client
node --test src/components/systemHealthModel.test.js
npm run build
cd ..
git diff --check
```

Expected:

- Watcher policy/runtime/system tests PASS.
- Client model tests PASS.
- Client build PASS.
- `git diff --check` PASS.

- [ ] **Step 5: Manual local verification with Z drive**

Run from repo root without `TIDY_DISABLE_WATCHER`:

```powershell
Remove-Item Env:TIDY_DISABLE_WATCHER -ErrorAction SilentlyContinue
$env:TIDY_WATCHER_MODE='auto'
npm run dev
```

Expected backend log:

```text
[watcher] No watchable roots in current policy; using fallback discover
[watcher] Using fallback discover every 3600s
```

Expected status:

```powershell
Invoke-RestMethod 'http://127.0.0.1:3001/api/system/status' | ConvertTo-Json -Depth 8
```

Contains:

```json
{
  "watcher": {
    "mode": "auto",
    "state": "fallback",
    "roots": [
      {
        "root": "Z:\\_document\\photos",
        "action": "skip",
        "reason": "network_drive"
      }
    ],
    "activeRoots": []
  }
}
```

No repeated `Z:\ is not accessible` watcher error should appear.

- [ ] **Step 6: Commit**

```powershell
git add server/src/watcher/README.md server/src/routes/README.md docs/开发指南.md
git commit -m "Document watcher auto policy"
```

---

## Self-Review Notes

- Spec coverage: The plan covers automatic root classification, local watch, network/UNC/removable fallback, preflight accessibility, chokidar error downgrade, status reporting, simplified UI messaging, env overrides, tests, docs, and manual Z-drive verification.
- Placeholder scan: No `TODO`, `TBD`, or unspecified "add handling" steps remain.
- Type consistency: Server watcher status uses `{ mode, state, roots, activeRoots, fallbackIntervalMs, lastError, updatedAt }`; UI reads `status.watcher`; root decisions use `{ root, action, reason, message }`.
- Scope control: The plan does not add advanced settings UI toggles. Overrides are environment variables; simplified settings only displays watcher health.
