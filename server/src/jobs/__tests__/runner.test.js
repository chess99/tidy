const { classifyJobResult } = require('../runner');

describe('job runner result classification', () => {
  test('marks all-error item jobs as failed', () => {
    const result = { ok: true, total: 10, done: 10, errors: 10, scanned: 0, embedded: 0, lastError: 'ai-service 503' };

    expect(classifyJobResult(result)).toEqual({
      status: 'failed',
      error: 'job_failed_all_items: 10/10 items failed; last error: ai-service 503',
    });
  });

  test('keeps partially successful item jobs finished', () => {
    const result = { ok: true, total: 10, done: 10, errors: 9, scanned: 1 };

    expect(classifyJobResult(result)).toEqual({ status: 'finished' });
  });

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
});

test('runner checks auto-recovery before picking the next queued job', async () => {
  jest.resetModules();
  const calls = [];
  jest.doMock('../../db', () => ({ getDB: jest.fn(() => ({})) }));
  jest.doMock('../../services/organization/service', () => ({ busy: jest.fn(() => false) }));

  jest.doMock('../../services/taskAutoRecovery', () => ({
    runTaskAutoRecovery: jest.fn(async () => calls.push('recovery')),
  }));
  jest.doMock('../store', () => ({
    interruptStaleRunningJobs: jest.fn(() => calls.push('interrupt')),
    interruptRunningJobsOnStartup: jest.fn(() => 0),
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

test('runner waits while a directory operation owns the workspace', async () => {
  jest.resetModules();
  jest.doMock('../../db', () => ({ getDB: jest.fn(() => ({})) }));
  jest.doMock('../../services/organization/service', () => ({ busy: jest.fn(() => true) }));
  const recovery = jest.fn();
  jest.doMock('../../services/taskAutoRecovery', () => ({ runTaskAutoRecovery: recovery }));
  await require('../runner').tick();
  expect(recovery).not.toHaveBeenCalled();
});
