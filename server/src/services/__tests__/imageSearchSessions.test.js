const {
  createImageSearchSession,
  getImageSearchSession,
  deleteImageSearchSession,
  clearImageSearchSessions,
} = require('../imageSearchSessions');

describe('image search sessions', () => {
  afterEach(() => {
    clearImageSearchSessions();
    jest.useRealTimers();
  });

  test('keeps only a defensive in-memory copy of the embedding', () => {
    const source = [0.1, 0.2, 0.3];
    const created = createImageSearchSession({ embedding: source, model: 'clip-test' });
    source[0] = 9;

    const first = getImageSearchSession(created.id);
    expect(first).toMatchObject({ model: 'clip-test', normalized: true });
    expect(first.embedding).toEqual([0.1, 0.2, 0.3]);

    first.embedding[0] = 8;
    expect(getImageSearchSession(created.id).embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test('expires and explicitly deletes sessions', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T00:00:00Z'));
    const expired = createImageSearchSession({ embedding: [1], ttlMs: 60_000 });
    jest.advanceTimersByTime(60_001);
    expect(getImageSearchSession(expired.id)).toBeNull();

    const deleted = createImageSearchSession({ embedding: [1] });
    expect(deleteImageSearchSession(deleted.id)).toBe(true);
    expect(getImageSearchSession(deleted.id)).toBeNull();
  });

  test('rejects invalid vectors', () => {
    expect(() => createImageSearchSession({ embedding: [] })).toThrow('invalid image search embedding');
    expect(() => createImageSearchSession({ embedding: [Number.NaN] })).toThrow('invalid image search embedding');
  });
});
