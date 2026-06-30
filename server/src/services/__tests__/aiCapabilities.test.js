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

    expect(global.fetch).toHaveBeenCalledWith('http://ai.local/health');
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

    expect(global.fetch).toHaveBeenCalledWith('http://ai.local/health');
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
});
