describe('server CLIP model selection', () => {
  const originalModelId = process.env.TIDY_CLIP_MODEL_ID;

  afterEach(() => {
    if (originalModelId == null) delete process.env.TIDY_CLIP_MODEL_ID;
    else process.env.TIDY_CLIP_MODEL_ID = originalModelId;
    jest.resetModules();
  });

  test('defaults to Jina even when an old local OpenAI model directory exists', () => {
    delete process.env.TIDY_CLIP_MODEL_ID;
    jest.resetModules();

    expect(require('../config').CLIP_MODEL_ID).toBe('jinaai/jina-clip-v2');
  });

  test('uses the single explicit model setting', () => {
    process.env.TIDY_CLIP_MODEL_ID = 'example/custom-model';
    jest.resetModules();

    expect(require('../config').CLIP_MODEL_ID).toBe('example/custom-model');
  });
});
