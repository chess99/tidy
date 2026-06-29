describe('discover directory walking', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('skips a directory read that times out and continues walking siblings', async () => {
    jest.doMock('fs-extra', () => ({
      readdir: jest.fn((dir) => {
        if (dir === 'root') return Promise.resolve(['bad', 'good']);
        if (dir.endsWith('bad')) return new Promise(() => {});
        if (dir.endsWith('good')) return Promise.resolve(['photo.jpg']);
        return Promise.resolve([]);
      }),
      stat: jest.fn((filePath) => Promise.resolve({
        isDirectory: () => filePath.endsWith('bad') || filePath.endsWith('good'),
        isFile: () => filePath.endsWith('photo.jpg'),
      })),
    }));

    const { walkDir } = require('../discover');
    const visited = [];
    const errors = [];
    const ctx = { isCancelRequested: () => false };

    await walkDir(
      ctx,
      'root',
      async (filePath) => visited.push(filePath),
      {
        onError: (err) => errors.push(err),
        readdirTimeoutMs: 1,
        statTimeoutMs: 1,
      }
    );

    expect(visited).toEqual([expect.stringContaining('photo.jpg')]);
    expect(errors).toEqual([
      expect.objectContaining({
        operation: 'readdir',
        code: 'ETIMEDOUT',
        target: expect.stringContaining('bad'),
      }),
    ]);
  });
});
