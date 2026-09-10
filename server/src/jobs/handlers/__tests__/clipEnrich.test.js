/**
 * input: CLIP capability preflight state
 * output: blocked enrichment result before database selection or inference
 * pos: guards CLIP storage against mismatched or unavailable AI models
 */

describe('clipEnrich capability preflight', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('blocks before selecting assets when the AI service reports a model mismatch', async () => {
    const prepare = jest.fn();
    jest.doMock('../../../db', () => ({ getDB: () => ({ prepare }) }));
    jest.doMock('../../../services/aiCapabilities', () => ({
      getAiCapabilities: jest.fn(async () => ({
        clip: {
          available: false,
          code: 'clip_model_mismatch',
          message: 'CLIP model mismatch: server expects Jina, AI service reports OpenAI',
        },
      })),
    }));
    jest.doMock('../../../services/aiClient', () => ({ clipImageEmbed: jest.fn() }));
    jest.doMock('../../../services/clipIndex', () => ({ packF32: jest.fn() }));

    const { handleClipEnrich } = require('../clipEnrich');
    const result = await handleClipEnrich({
      job: { mode: 'missing' },
      loadConfig: async () => ({ tasks: { concurrency: { clip: 1 } } }),
    });

    expect(result).toMatchObject({
      ok: false,
      blocked: true,
      blockedReason: 'clip_model_mismatch',
      total: 0,
      embedded: 0,
      errors: 0,
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});
