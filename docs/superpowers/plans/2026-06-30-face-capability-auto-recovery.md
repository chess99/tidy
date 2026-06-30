# Face Capability Auto Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make face recognition self-managing in the simplified Tidy workflow: detect unavailable AI dependencies before expensive scans, show a clear health state, and automatically run face scanning once the dependency becomes available.

**Architecture:** Add a narrow AI capability contract at the AI-service boundary, expose it through the Node server as `/api/system/status`, and make `faces_scan` fail fast with an actionable blocked-style result instead of processing every image. Keep the simplified settings page focused on "what photos are managed" plus a compact system health section; manual task controls remain in the task/maintenance surface.

**Tech Stack:** FastAPI Python AI service, Express Node server, SQLite-backed job queue, React + TanStack Query frontend, Jest for Node tests, pytest or direct Python function tests for AI-service health.

---

## File Structure

- Modify `ai-service/app/main.py`: enrich `/health` with capability data for faces and CLIP without loading heavy models.
- Create `server/src/services/aiCapabilities.js`: central Node-side AI health/capability client with normalized statuses and error codes.
- Test `server/src/services/__tests__/aiCapabilities.test.js`: unit coverage for health normalization and network failure handling.
- Modify `server/src/jobs/handlers/facesScan.js`: run preflight before selecting assets; fail fast when face capability is unavailable.
- Test `server/src/jobs/handlers/__tests__/facesScan.test.js`: assert unavailable InsightFace prevents per-image processing and preserves `face_scanned_at`.
- Create `server/src/services/taskAutoRecovery.js`: enqueue missing face scans when capability recovers and no active face job exists.
- Test `server/src/services/__tests__/taskAutoRecovery.test.js`: assert enqueue/no-enqueue behavior.
- Modify `server/src/jobs/runner.js`: call auto-recovery once per tick before picking queued jobs.
- Create `server/src/routes/system.js`: expose `/api/system/status`.
- Test `server/src/routes/__tests__/system.test.js`: route returns normalized capability and job summaries.
- Modify `server/src/app.js`: mount `/api/system`.
- Modify `client/src/api/client.js`: add `getSystemStatus()`.
- Create `client/src/components/SystemHealthSection.jsx`: compact health UI for simplified settings.
- Modify `client/src/components/SettingsViewSimple.jsx`: render health section without manual task buttons.
- Test with existing Jest/Vitest setup if available; if no frontend test harness exists, verify with `npm run build` for the client.

## Behavioral Decisions

- The system treats face recognition dependency failure as a capability problem, not a user configuration problem.
- `faces_scan` with unavailable faces capability returns a job result with `ok: false`, `blocked: true`, `blockedReason: "faces_unavailable"`, and a user-readable message. It must not loop over every asset.
- Do not mark `assets.face_scanned_at` when preflight fails.
- Do not clear `faces` or `people` automatically.
- Auto-recovery only enqueues `faces_scan missing`; it never enqueues destructive reset jobs.
- The simplified settings page shows a status row and a "重新检查" refetch action only. It does not expose `missing/all/reset/recluster`.

---

### Task 1: AI-Service Capability Contract

**Files:**
- Modify: `ai-service/app/main.py`

- [ ] **Step 1: Write the failing health expectation**

Run this Python one-liner from repo root before editing:

```powershell
@'
from ai_service_health_probe import read_health
'@ | python -
```

Expected: FAIL with `ModuleNotFoundError` because no probe exists. This confirms there is no current helper or contract test.

- [ ] **Step 2: Add direct health assertions as a temporary executable check**

Run this command before implementation:

```powershell
@'
import importlib.util
import json
import pathlib

path = pathlib.Path("ai-service/app/main.py")
spec = importlib.util.spec_from_file_location("tidy_ai_main", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
out = mod.health()
assert "capabilities" in out, out
assert out["capabilities"]["faces"]["available"] in (True, False), out
assert out["capabilities"]["clip"]["available"] in (True, False), out
print(json.dumps(out, ensure_ascii=False))
'@ | python -
```

Expected: FAIL with `AssertionError` because current `/health` returns only `{ok, service}`.

- [ ] **Step 3: Implement lightweight capability helpers**

In `ai-service/app/main.py`, insert this helper block above `@app.get("/health")`:

```python
def _capability_error(exc: Optional[Exception]) -> Optional[str]:
    if exc is None:
        return None
    return str(exc) or exc.__class__.__name__


def _face_capability() -> Dict[str, Any]:
    if FaceAnalysis is None:
        return {
            "available": False,
            "code": "insightface_unavailable",
            "message": f"InsightFace unavailable: {_capability_error(_face_import_error)}",
        }
    return {
        "available": True,
        "code": None,
        "message": "InsightFace import is available",
    }


def _clip_capability() -> Dict[str, Any]:
    try:
        from app.clip_encoder import get_encoder  # type: ignore  # noqa: F401
    except Exception as e:
        return {
            "available": False,
            "code": "clip_encoder_unavailable",
            "message": f"CLIP encoder import failed: {e}",
        }
    return {
        "available": True,
        "code": None,
        "message": "CLIP encoder import is available",
        "model": os.environ.get("TIDY_CLIP_MODEL_ID") or "default",
    }
```

Replace the current `health()` implementation with:

```python
@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": True,
        "service": "tidy-ai-service",
        "capabilities": {
            "faces": _face_capability(),
            "clip": _clip_capability(),
        },
    }
```

- [ ] **Step 4: Run the health assertion**

Run:

```powershell
@'
import importlib.util
import json
import pathlib

path = pathlib.Path("ai-service/app/main.py")
spec = importlib.util.spec_from_file_location("tidy_ai_main", path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
out = mod.health()
assert "capabilities" in out, out
assert out["capabilities"]["faces"]["available"] in (True, False), out
assert out["capabilities"]["clip"]["available"] in (True, False), out
assert "message" in out["capabilities"]["faces"], out
print(json.dumps(out, ensure_ascii=False))
'@ | python -
```

Expected: PASS and printed JSON containing `capabilities.faces` and `capabilities.clip`.

- [ ] **Step 5: Commit**

```powershell
git add ai-service/app/main.py
git commit -m "Expose AI service capabilities in health"
```

---

### Task 2: Node Capability Client

**Files:**
- Create: `server/src/services/aiCapabilities.js`
- Create: `server/src/services/__tests__/aiCapabilities.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/src/services/__tests__/aiCapabilities.test.js`:

```javascript
describe('aiCapabilities', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('normalizes unavailable InsightFace from AI health', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: 'tidy-ai-service',
        capabilities: {
          faces: {
            available: false,
            code: 'insightface_unavailable',
            message: 'InsightFace unavailable: No module named insightface',
          },
          clip: { available: true, code: null, message: 'CLIP encoder import is available' },
        },
      }),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local' });

    expect(out.faces).toEqual({
      available: false,
      code: 'insightface_unavailable',
      message: 'InsightFace unavailable: No module named insightface',
    });
    expect(out.clip.available).toBe(true);
  });

  test('returns service_unreachable when fetch fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local' });

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_unreachable',
      message: 'AI service unreachable: connect ECONNREFUSED',
    });
    expect(out.clip.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
cd server
npm test -- src/services/__tests__/aiCapabilities.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../aiCapabilities'`.

- [ ] **Step 3: Implement `aiCapabilities.js`**

Create `server/src/services/aiCapabilities.js`:

```javascript
/**
 * input: AI service health endpoint
 * output: normalized AI capability state for job preflight and UI status
 * pos: server service boundary for AI availability checks
 */

const { AI_SERVICE_URL } = require('../config');

function joinUrl(base, p) {
  const b = String(base || '').replace(/\/+$/, '');
  const path = String(p || '');
  if (!b) return path;
  return path.startsWith('/') ? `${b}${path}` : `${b}/${path}`;
}

function normalizeCapability(raw, fallbackCode, fallbackMessage) {
  const available = raw?.available === true;
  return {
    available,
    code: available ? null : String(raw?.code || fallbackCode),
    message: String(raw?.message || fallbackMessage),
  };
}

function unavailableAll(code, message) {
  return {
    ok: false,
    service: 'tidy-ai-service',
    faces: { available: false, code, message },
    clip: { available: false, code, message },
    checkedAt: Date.now(),
  };
}

async function getAiCapabilities({ aiServiceUrl = AI_SERVICE_URL } = {}) {
  const url = joinUrl(aiServiceUrl, '/health');
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return unavailableAll('ai_service_unhealthy', `AI service health returned ${res.status}`);
    }
    const json = await res.json();
    const caps = json?.capabilities || {};
    return {
      ok: true,
      service: String(json?.service || 'tidy-ai-service'),
      faces: normalizeCapability(
        caps.faces,
        'faces_capability_missing',
        'Face recognition capability is not reported by AI service'
      ),
      clip: normalizeCapability(
        caps.clip,
        'clip_capability_missing',
        'CLIP capability is not reported by AI service'
      ),
      checkedAt: Date.now(),
    };
  } catch (err) {
    return unavailableAll('ai_service_unreachable', `AI service unreachable: ${err?.message || err}`);
  }
}

module.exports = { getAiCapabilities };
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```powershell
cd server
npm test -- src/services/__tests__/aiCapabilities.test.js --runInBand
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/aiCapabilities.js server/src/services/__tests__/aiCapabilities.test.js
git commit -m "Add AI capability client"
```

---

### Task 3: Face Scan Preflight

**Files:**
- Modify: `server/src/jobs/handlers/facesScan.js`
- Modify: `server/src/jobs/handlers/__tests__/facesScan.test.js`

- [ ] **Step 1: Add failing preflight test**

Append this test to `server/src/jobs/handlers/__tests__/facesScan.test.js`:

```javascript
test('blocks before selecting assets when face capability is unavailable', async () => {
  jest.resetModules();
  jest.doMock('../../../services/aiCapabilities', () => ({
    getAiCapabilities: jest.fn(async () => ({
      faces: {
        available: false,
        code: 'insightface_unavailable',
        message: 'InsightFace unavailable: No module named insightface',
      },
      clip: { available: true, code: null, message: 'ok' },
    })),
  }));
  const processImageFaces = jest.fn();
  jest.doMock('../../../scanner/face', () => ({ processImageFaces }));

  const prepare = jest.fn(() => {
    throw new Error('DB should not be queried when preflight blocks');
  });
  jest.doMock('../../../db', () => ({ getDB: () => ({ prepare }) }));

  const { handleFacesScan } = require('../facesScan');
  const heartbeats = [];
  const result = await handleFacesScan({
    job: { id: 1, mode: 'missing' },
    loadConfig: async () => ({ tasks: { concurrency: { faces: 1 } } }),
    heartbeat: (patch) => heartbeats.push(patch),
    isCancelRequested: () => false,
    enqueue: jest.fn(),
  });

  expect(result).toMatchObject({
    ok: false,
    blocked: true,
    blockedReason: 'faces_unavailable',
    capabilityCode: 'insightface_unavailable',
  });
  expect(processImageFaces).not.toHaveBeenCalled();
  expect(heartbeats[0]).toMatchObject({ phase: 'faces_blocked' });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/jobs/handlers/__tests__/facesScan.test.js --runInBand
```

Expected: FAIL because `facesScan.js` does not import or call `getAiCapabilities`.

- [ ] **Step 3: Implement preflight**

At the top of `server/src/jobs/handlers/facesScan.js`, add:

```javascript
const { getAiCapabilities } = require('../../services/aiCapabilities');
```

Inside `handleFacesScan`, immediately after reading `cfg` and `concurrency`, insert:

```javascript
  const capabilities = await getAiCapabilities();
  if (capabilities?.faces?.available !== true) {
    const message = capabilities?.faces?.message || 'Face recognition is unavailable';
    const result = {
      ok: false,
      blocked: true,
      blockedReason: 'faces_unavailable',
      capabilityCode: capabilities?.faces?.code || 'faces_unavailable',
      message,
      mode,
      concurrency,
      total: 0,
      done: 0,
      scanned: 0,
      skipped: 0,
      errors: 0,
      lastError: message,
      startedAt: now(),
      finishedAt: now(),
    };
    ctx.heartbeat({ phase: 'faces_blocked', ...result });
    return result;
  }
```

- [ ] **Step 4: Run face scan tests**

Run:

```powershell
cd server
npm test -- src/jobs/handlers/__tests__/facesScan.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run capability tests too**

Run:

```powershell
cd server
npm test -- src/services/__tests__/aiCapabilities.test.js src/jobs/handlers/__tests__/facesScan.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/src/jobs/handlers/facesScan.js server/src/jobs/handlers/__tests__/facesScan.test.js
git commit -m "Block face scan when AI capability is unavailable"
```

---

### Task 4: Job Result Classification For Blocked Work

**Files:**
- Modify: `server/src/jobs/runner.js`
- Modify: `server/src/jobs/__tests__/runner.test.js`

- [ ] **Step 1: Write failing classification test**

Append to `server/src/jobs/__tests__/runner.test.js`:

```javascript
test('marks blocked job results as failed with actionable message', () => {
  const result = {
    ok: false,
    blocked: true,
    blockedReason: 'faces_unavailable',
    capabilityCode: 'insightface_unavailable',
    message: 'InsightFace unavailable: No module named insightface',
  };

  expect(classifyJobResult(result)).toEqual({
    status: 'failed',
    error: 'faces_unavailable: InsightFace unavailable: No module named insightface',
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/jobs/__tests__/runner.test.js --runInBand
```

Expected: FAIL because `classifyJobResult` currently treats this as finished.

- [ ] **Step 3: Update classification**

In `server/src/jobs/runner.js`, add this block at the start of `classifyJobResult(result)`:

```javascript
  if (result?.blocked) {
    const reason = String(result.blockedReason || 'job_blocked');
    const message = String(result.message || result.lastError || reason);
    return { status: 'failed', error: `${reason}: ${message}` };
  }
```

- [ ] **Step 4: Run runner tests**

Run:

```powershell
cd server
npm test -- src/jobs/__tests__/runner.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/jobs/runner.js server/src/jobs/__tests__/runner.test.js
git commit -m "Classify blocked jobs as actionable failures"
```

---

### Task 5: Auto-Recovery Enqueue Service

**Files:**
- Create: `server/src/services/taskAutoRecovery.js`
- Create: `server/src/services/__tests__/taskAutoRecovery.test.js`

- [ ] **Step 1: Write failing tests**

Create `server/src/services/__tests__/taskAutoRecovery.test.js`:

```javascript
describe('taskAutoRecovery', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('enqueues faces_scan missing when faces become available and missing assets exist', () => {
    const createJob = jest.fn((job) => ({ id: 10, ...job }));
    const listJobs = jest.fn(() => []);
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: { available: true, code: null, message: 'ok' },
      })),
    }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: () => ({ get: () => ({ count: 12 }) }),
      }),
    }));

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    return runTaskAutoRecovery().then((out) => {
      expect(out).toEqual({ checked: true, facesQueued: true, missingFaceAssets: 12 });
      expect(createJob).toHaveBeenCalledWith({ type: 'faces_scan', mode: 'missing', params: { auto: true, reason: 'faces_capability_recovered' } });
    });
  });

  test('does not enqueue when a face job is already active', async () => {
    const createJob = jest.fn();
    const listJobs = jest.fn(() => [{ id: 5, type: 'faces_scan', status: 'running' }]);
    jest.doMock('../../jobs/store', () => ({ createJob, listJobs }));
    jest.doMock('../aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        faces: { available: true, code: null, message: 'ok' },
      })),
    }));
    jest.doMock('../../db', () => ({
      getDB: () => ({
        prepare: () => ({ get: () => ({ count: 12 }) }),
      }),
    }));

    const { runTaskAutoRecovery } = require('../taskAutoRecovery');
    const out = await runTaskAutoRecovery();

    expect(out).toEqual({ checked: true, facesQueued: false, reason: 'faces_job_active' });
    expect(createJob).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/services/__tests__/taskAutoRecovery.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../taskAutoRecovery'`.

- [ ] **Step 3: Implement auto-recovery**

Create `server/src/services/taskAutoRecovery.js`:

```javascript
/**
 * input: AI capabilities + DB asset state + job queue
 * output: best-effort automatic recovery jobs for capabilities that became available
 * pos: service-level task orchestration helper called by the job runner
 */

const { getDB } = require('../db');
const { createJob, listJobs } = require('../jobs/store');
const { getAiCapabilities } = require('./aiCapabilities');

let lastCheckAt = 0;
const CHECK_INTERVAL_MS = 60_000;

function hasActiveFaceJob() {
  const jobs = listJobs({ limit: 50, type: 'faces_scan' });
  return jobs.some((j) => j?.type === 'faces_scan' && (j.status === 'queued' || j.status === 'running'));
}

function countMissingFaceAssets(db) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM assets a
    WHERE a.mime_type LIKE 'image/%'
      AND a.status NOT IN ('trash', 'ignored')
      AND a.face_scanned_at IS NULL
      AND EXISTS (
        SELECT 1 FROM files f
        WHERE f.hash = a.hash AND f.missing = 0 AND f.path IS NOT NULL
        LIMIT 1
      )
  `).get().count;
}

async function runTaskAutoRecovery({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastCheckAt < CHECK_INTERVAL_MS) {
    return { checked: false, reason: 'interval' };
  }
  lastCheckAt = now;

  const caps = await getAiCapabilities();
  if (caps?.faces?.available !== true) {
    return { checked: true, facesQueued: false, reason: caps?.faces?.code || 'faces_unavailable' };
  }
  if (hasActiveFaceJob()) {
    return { checked: true, facesQueued: false, reason: 'faces_job_active' };
  }

  const db = getDB();
  const missingFaceAssets = Number(countMissingFaceAssets(db) || 0);
  if (missingFaceAssets <= 0) {
    return { checked: true, facesQueued: false, reason: 'no_missing_face_assets', missingFaceAssets };
  }

  createJob({
    type: 'faces_scan',
    mode: 'missing',
    params: { auto: true, reason: 'faces_capability_recovered' },
  });
  return { checked: true, facesQueued: true, missingFaceAssets };
}

module.exports = { runTaskAutoRecovery };
```

- [ ] **Step 4: Run auto-recovery tests**

Run:

```powershell
cd server
npm test -- src/services/__tests__/taskAutoRecovery.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/taskAutoRecovery.js server/src/services/__tests__/taskAutoRecovery.test.js
git commit -m "Add automatic face task recovery"
```

---

### Task 6: Runner Integration

**Files:**
- Modify: `server/src/jobs/runner.js`
- Modify: `server/src/jobs/__tests__/runner.test.js`

- [ ] **Step 1: Export `tick` for focused testing**

Modify the bottom of `server/src/jobs/runner.js` from:

```javascript
module.exports = { startJobRunner, classifyJobResult };
```

to:

```javascript
module.exports = { startJobRunner, classifyJobResult, tick };
```

- [ ] **Step 2: Add failing runner integration test**

Append to `server/src/jobs/__tests__/runner.test.js`:

```javascript
test('runner checks auto-recovery before picking the next queued job', async () => {
  jest.resetModules();
  const calls = [];
  jest.doMock('../../services/taskAutoRecovery', () => ({
    runTaskAutoRecovery: jest.fn(async () => calls.push('recovery')),
  }));
  jest.doMock('../store', () => ({
    interruptStaleRunningJobs: jest.fn(() => calls.push('interrupt')),
    pickNextQueuedJob: jest.fn(() => {
      calls.push('pick');
      return null;
    }),
    startJob: jest.fn(),
    heartbeat: jest.fn(),
    finishJob: jest.fn(),
    failJob: jest.fn(),
    isCancelRequested: jest.fn(),
    setCheckpoint: jest.fn(),
    getCheckpoint: jest.fn(),
    createJob: jest.fn(),
  }));

  const { tick } = require('../runner');
  await tick();

  expect(calls).toEqual(['recovery', 'interrupt', 'pick']);
});
```

- [ ] **Step 3: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/jobs/__tests__/runner.test.js --runInBand
```

Expected: FAIL because runner does not call `runTaskAutoRecovery`.

- [ ] **Step 4: Add auto-recovery call**

At the top of `server/src/jobs/runner.js`, add:

```javascript
const { runTaskAutoRecovery } = require('../services/taskAutoRecovery');
```

Inside `tick()`, before `interruptStaleRunningJobs(...)`, add:

```javascript
    await runTaskAutoRecovery().catch((err) => {
      console.warn('[jobs] auto-recovery skipped:', err?.message || err);
    });
```

- [ ] **Step 5: Run runner tests**

Run:

```powershell
cd server
npm test -- src/jobs/__tests__/runner.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/src/jobs/runner.js server/src/jobs/__tests__/runner.test.js
git commit -m "Run task auto-recovery from job runner"
```

---

### Task 7: System Status API

**Files:**
- Create: `server/src/routes/system.js`
- Create: `server/src/routes/__tests__/system.test.js`
- Modify: `server/src/app.js`

- [ ] **Step 1: Write failing route test**

Create `server/src/routes/__tests__/system.test.js`:

```javascript
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
      listJobs: jest.fn(() => [
        { id: 25, type: 'faces_scan', status: 'failed', last_error: 'faces_unavailable: InsightFace unavailable' },
      ]),
    }));

    const { createApp } = require('../../app');
    const app = createApp({ includeConfig: false });
    const res = await request(app).get('/api/system/status').expect(200);

    expect(res.body.ai.faces.available).toBe(false);
    expect(res.body.ai.faces.code).toBe('insightface_unavailable');
    expect(res.body.tasks.faces.latest.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
cd server
npm test -- src/routes/__tests__/system.test.js --runInBand
```

Expected: FAIL with 404 because `/api/system` is not mounted.

- [ ] **Step 3: Implement route**

Create `server/src/routes/system.js`:

```javascript
/**
 * input: system service state + task queue
 * output: compact status API for simplified UI health display
 * pos: Express route for non-configuration system health
 */

const express = require('express');
const { getAiCapabilities } = require('../services/aiCapabilities');
const { listJobs } = require('../jobs/store');

const router = express.Router();

function latestJob(type) {
  const jobs = listJobs({ limit: 50, type });
  return jobs.find((j) => j?.type === type) || null;
}

router.get('/status', async (req, res) => {
  const ai = await getAiCapabilities();
  res.json({
    ok: true,
    ai,
    tasks: {
      faces: {
        latest: latestJob('faces_scan'),
      },
      clip: {
        latest: latestJob('clip_enrich'),
      },
    },
  });
});

module.exports = router;
```

Modify `server/src/app.js` by adding:

```javascript
  app.use('/api/system', require('./routes/system'));
```

Place it after `/api/health` and before `/api/jobs`.

- [ ] **Step 4: Run route test**

Run:

```powershell
cd server
npm test -- src/routes/__tests__/system.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/src/routes/system.js server/src/routes/__tests__/system.test.js server/src/app.js
git commit -m "Expose system status API"
```

---

### Task 8: Simplified Settings Health UI

**Files:**
- Modify: `client/src/api/client.js`
- Create: `client/src/components/SystemHealthSection.jsx`
- Modify: `client/src/components/SettingsViewSimple.jsx`

- [ ] **Step 1: Add API client function**

In `client/src/api/client.js`, after `getConfig`, add:

```javascript
export const getSystemStatus = () => api.get('/system/status').then((res) => res.data);
```

- [ ] **Step 2: Create `SystemHealthSection.jsx`**

Create `client/src/components/SystemHealthSection.jsx`:

```javascript
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { getSystemStatus } from '../api/client';
import { Button } from './ui/button';

function StatusRow({ label, available, message }) {
  const Icon = available ? CheckCircle2 : AlertCircle;
  const tone = available ? 'text-green-700 bg-green-50 border-green-100' : 'text-amber-800 bg-amber-50 border-amber-100';
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 shrink-0" />
        <div className="text-sm font-medium">{label}</div>
      </div>
      <div className="text-xs truncate text-right" title={message || ''}>
        {message || (available ? '正常' : '不可用')}
      </div>
    </div>
  );
}

export function SystemHealthSection() {
  const query = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 30_000,
  });

  const ai = query.data?.ai || {};
  const faces = ai.faces || {};
  const clip = ai.clip || {};

  return (
    <section className="bg-white border rounded-xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">系统状态</h3>
          <p className="text-sm text-gray-500 mt-1">自动任务会在能力可用时继续处理。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div className="space-y-2">
        <StatusRow
          label="人脸识别"
          available={faces.available === true}
          message={faces.available === true ? '正常' : faces.message}
        />
        <StatusRow
          label="智能搜索"
          available={clip.available === true}
          message={clip.available === true ? '正常' : clip.message}
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Render health in simple settings**

In `client/src/components/SettingsViewSimple.jsx`, add import:

```javascript
import { SystemHealthSection } from './SystemHealthSection';
```

Render it after `WorkspaceSection`:

```javascript
      <WorkspaceSection config={config} />
      <SystemHealthSection />
      <FileTypesSection config={config} />
```

- [ ] **Step 4: Build client**

Run:

```powershell
cd client
npm run build
```

Expected: build exits 0. If the project has no build script, run `npm test -- --runInBand` if available and record the exact fallback command.

- [ ] **Step 5: Commit**

```powershell
git add client/src/api/client.js client/src/components/SystemHealthSection.jsx client/src/components/SettingsViewSimple.jsx
git commit -m "Show automatic system health in simple settings"
```

---

### Task 9: End-To-End Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Restart services**

Restart `ai-service` and `server` using the existing project scripts or current local process manager. Keep the server watcher setting consistent with current local workflow:

```powershell
$env:TIDY_DISABLE_WATCHER='1'
```

- [ ] **Step 2: Verify AI health contract**

Run:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/health' | ConvertTo-Json -Depth 8
```

Expected: JSON has `capabilities.faces.available` and `capabilities.clip.available`.

- [ ] **Step 3: Verify server status route**

Run:

```powershell
Invoke-RestMethod 'http://127.0.0.1:3001/api/system/status' | ConvertTo-Json -Depth 8
```

Expected: JSON has `ai.faces`, `ai.clip`, and `tasks.faces.latest`.

- [ ] **Step 4: Verify face scan blocks fast when InsightFace is missing**

Only run this if `/api/system/status` reports `ai.faces.available = false`:

```powershell
$job = Invoke-RestMethod -Method Post `
  -Uri 'http://127.0.0.1:3001/api/jobs' `
  -ContentType 'application/json' `
  -Body '{"type":"faces_scan","mode":"missing","params":{}}'
Start-Sleep -Seconds 2
Invoke-RestMethod "http://127.0.0.1:3001/api/jobs/$($job.id)" | ConvertTo-Json -Depth 8
```

Expected: the job finishes as `failed` with `faces_unavailable` and does not process tens of thousands of items.

- [ ] **Step 5: Verify auto-recovery after dependency is available**

Only run this after installing/fixing InsightFace and restarting `ai-service`:

```powershell
Invoke-RestMethod 'http://127.0.0.1:3001/api/system/status' | ConvertTo-Json -Depth 8
Start-Sleep -Seconds 70
Invoke-RestMethod 'http://127.0.0.1:3001/api/jobs?limit=5' | ConvertTo-Json -Depth 8
```

Expected: a `faces_scan` job with `mode: missing` appears automatically if there are assets with `face_scanned_at IS NULL`.

- [ ] **Step 6: Run server test suite slice**

Run:

```powershell
cd server
npm test -- src/services/__tests__/aiCapabilities.test.js src/services/__tests__/taskAutoRecovery.test.js src/jobs/__tests__/runner.test.js src/jobs/handlers/__tests__/facesScan.test.js src/routes/__tests__/system.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Check git state**

Run:

```powershell
git status --short
```

Expected: no uncommitted tracked files except local ignored runtime data.

---

## Self-Review Notes

- Spec coverage: The plan covers capability detection, face scan preflight, automatic recovery, simplified UI status, and verification.
- Placeholder scan: No unresolved placeholder markers or unspecified "add handling" steps remain.
- Type consistency: Capability shape is consistently `{ available, code, message }`; blocked job result uses `{ blocked, blockedReason, capabilityCode, message }`; UI reads `/api/system/status`.
- Scope control: The plan does not add manual task controls to the simplified settings page and does not implement destructive reset automation.
