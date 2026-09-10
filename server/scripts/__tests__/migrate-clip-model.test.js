/**
 * input: standalone CLIP migration CLI arguments and AI error payloads
 * output: deterministic parsing and error normalization assertions
 * pos: regression coverage for the resumable model migration runner
 */

const { parseArgs, responseError } = require('../migrate-clip-model');

describe('migrate-clip-model', () => {
  test('requires an explicit source model and defaults the target model', () => {
    expect(() => parseArgs([])).toThrow('--from-model is required');
    expect(parseArgs(['--from-model', 'old/model'])).toMatchObject({
      fromModel: 'old/model',
      toModel: 'jinaai/jina-clip-v2',
      aiUrl: 'http://127.0.0.1:8002',
      limit: null,
    });
  });

  test('rejects an ambiguous no-op migration', () => {
    expect(() => parseArgs(['--from-model', 'same', '--to-model', 'same'])).toThrow(
      'source and target CLIP models must differ'
    );
  });

  test('normalizes AI service error details', () => {
    expect(responseError(400, { detail: 'cannot decode image' })).toBe(
      'ai-service error 400: cannot decode image'
    );
  });
});
