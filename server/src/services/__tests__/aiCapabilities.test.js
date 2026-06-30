describe('aiCapabilities', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.useRealTimers();
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

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai.local/health',
      expect.objectContaining({ signal: expect.any(Object) })
    );
    expect(out).toMatchObject({
      ok: true,
      service: 'tidy-ai-service',
      faces: {
        available: false,
        code: 'insightface_unavailable',
        message: 'InsightFace unavailable: No module named insightface',
      },
      clip: {
        available: true,
        code: null,
        message: 'CLIP encoder import is available',
      },
    });
    expect(typeof out.checkedAt).toBe('number');
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
    expect(out.clip).toEqual({
      available: false,
      code: 'ai_service_unreachable',
      message: 'AI service unreachable: connect ECONNREFUSED',
    });
    expect(out.ok).toBe(false);
  });

  test('marks both capabilities unavailable when AI health is not ok', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: async () => ({ ok: false }),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local/' });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai.local/health',
      expect.objectContaining({ signal: expect.any(Object) })
    );
    expect(out).toMatchObject({
      ok: false,
      faces: { available: false, code: 'ai_service_unhealthy' },
      clip: { available: false, code: 'ai_service_unhealthy' },
    });
  });

  test('uses fallback codes when capability entries are missing', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        service: 'tidy-ai-service',
        capabilities: {},
      }),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local' });

    expect(out.faces).toEqual({
      available: false,
      code: 'faces_capability_missing',
      message: 'Face recognition capability is not reported by AI service',
    });
    expect(out.clip).toEqual({
      available: false,
      code: 'clip_capability_missing',
      message: 'CLIP capability is not reported by AI service',
    });
  });

  test('returns service_timeout when AI health does not respond before timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const { getAiCapabilities } = require('../aiCapabilities');
    const pending = getAiCapabilities({ aiServiceUrl: 'http://ai.local', timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);
    const out = await pending;

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_timeout',
      message: expect.stringMatching(/^AI service health timed out/),
    });
    expect(out.clip).toEqual(out.faces);
    expect(out.ok).toBe(false);
  });

  test('returns invalid_response when AI health JSON parsing fails', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local' });

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_invalid_response',
      message: 'AI service health returned invalid JSON: Unexpected token < in JSON',
    });
    expect(out.clip).toEqual(out.faces);
    expect(out.ok).toBe(false);
  });

  test('marks HTTP 200 health body with ok false as unhealthy', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: false,
        service: 'tidy-ai-service',
        message: 'models not ready',
      }),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const out = await getAiCapabilities({ aiServiceUrl: 'http://ai.local' });

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_unhealthy',
      message: 'AI service health reported ok=false: models not ready',
    });
    expect(out.clip).toEqual(out.faces);
    expect(out.ok).toBe(false);
  });

  test('returns service_timeout when AI health JSON parsing hangs past timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: () => new Promise(() => {}),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const pending = getAiCapabilities({ aiServiceUrl: 'http://ai.local', timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);
    const out = await pending;

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_timeout',
      message: expect.stringMatching(/^AI service health timed out/),
    });
    expect(out.clip).toEqual(out.faces);
    expect(out.ok).toBe(false);
  });

  test('returns service_timeout when AI health JSON parsing rejects with AbortError after timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(async (url, opts) => ({
      ok: true,
      json: () =>
        new Promise((resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    }));

    const { getAiCapabilities } = require('../aiCapabilities');
    const pending = getAiCapabilities({ aiServiceUrl: 'http://ai.local', timeoutMs: 25 });
    await jest.advanceTimersByTimeAsync(25);
    const out = await pending;

    expect(out.faces).toEqual({
      available: false,
      code: 'ai_service_timeout',
      message: expect.stringMatching(/^AI service health timed out/),
    });
    expect(out.clip).toEqual(out.faces);
    expect(out.ok).toBe(false);
  });

  test('uses default timeout when timeoutMs is zero instead of timing out immediately', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, opts) => {
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        setTimeout(() => {
          resolve({
            ok: true,
            json: async () => ({
              ok: true,
              service: 'tidy-ai-service',
              capabilities: {
                faces: { available: true, code: null, message: 'InsightFace import is available' },
                clip: { available: true, code: null, message: 'CLIP encoder import is available' },
              },
            }),
          });
        }, 1);
      });
    });

    const { getAiCapabilities } = require('../aiCapabilities');
    const pending = getAiCapabilities({ aiServiceUrl: 'http://ai.local', timeoutMs: 0 });
    await jest.advanceTimersByTimeAsync(1);
    const out = await pending;

    expect(out.ok).toBe(true);
    expect(out.faces.available).toBe(true);
    expect(out.clip.available).toBe(true);
  });
});
