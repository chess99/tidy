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
});
