/**
 * input: CLIP inference responses from ai-service
 * output: strict model-identity validation before caching or persistence
 * pos: guards semantic-search vectors against cross-model contamination
 */

describe('aiClient CLIP model validation', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('rejects a text embedding returned by a different model', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        model: 'openai/clip-vit-base-patch32',
        dim: 512,
        normalized: true,
        embeddings: [[1, 0]],
      }),
    }));
    const { clipTextEmbed } = require('../aiClient');

    await expect(clipTextEmbed({ query: `mismatch-${Date.now()}` })).rejects.toThrow(
      'CLIP model mismatch: server expects jinaai/jina-clip-v2, AI service returned openai/clip-vit-base-patch32'
    );
  });

  test('rejects an image embedding response with no model identity', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ dim: 1024, normalized: true, embeddings: [[1, 0]] }),
    }));
    const { clipImageEmbedBuffer } = require('../aiClient');

    await expect(clipImageEmbedBuffer({ imageBuffer: Buffer.from('image') })).rejects.toThrow(
      'ai-service CLIP response did not report a model'
    );
  });
});
