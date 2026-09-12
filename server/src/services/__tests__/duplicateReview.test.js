const { buildReview, comparePixels, cosine, HashTree, isCompanion } = require('../duplicateReview');

const pixels = (phase = 0) => Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) =>
  Math.round(128 + 90 * Math.sin(i / 35 + phase))));
const item = (id, overrides = {}) => ({ file_id: id, hash: `hash${id}`, hash_algo: 'sha256',
  path: `/photos/${id}.jpg`, size: 1000, mtime_ms: 100, width: 640, height: 480,
  asset_mime_type: 'image/jpeg', phash: 'aaaaaaaaaaaaaaaa', ...overrides });

test('identical pHash does not equate a photograph and an unrelated screenshot', async () => {
  const result = await buildReview([item(1), item(2)], { loadPixels: (i) => pixels(i.file_id) });
  expect(result.groups).toEqual([]);
  expect(comparePixels(Buffer.alloc(100, 255), Buffer.alloc(100, 255))).toBe(false);
});

test('compression/resizing is recalled but groups never chain unrelated endpoints', async () => {
  const result = await buildReview([item(1), item(2), item(3)], { loadPixels: (i) => pixels((i.file_id - 1) * 0.13) });
  expect(comparePixels(pixels(0), pixels(0.13))).toBe(true);
  expect(comparePixels(pixels(0), pixels(0.26))).toBe(false);
  expect(result.groups.map((g) => g.items.map((i) => i.file_id))).toEqual([[1, 2]]);
});

test('metric candidates include differences in all four 16-bit segments', () => {
  const tree = new HashTree();
  tree.add(item(1, { phash: '0000000000000000' }));
  expect(tree.find(item(2, { phash: '0001000100010001' })).map((i) => i.file_id)).toEqual([1]);
});

test('exact copies group separately, with organized path recommended', async () => {
  const result = await buildReview([item(1), item(2, { hash: 'hash1', organized_to: '旅行' })], { loadPixels: () => pixels() });
  expect(result.groups).toHaveLength(1);
  expect(result.groups[0].kind).toBe('hash');
  expect(result.groups[0].suggested_keep_file_id).toBe(2);
});

test('raw/jpeg companions remain separate and unknown previews fail closed', async () => {
  const a = item(1, { path: 'Z:\\photos\\IMGP001.DNG' });
  const b = item(2, { path: 'Z:\\photos\\IMGP001.JPG' });
  expect(isCompanion(a, b)).toBe(true);
  expect((await buildReview([a, b], { loadPixels: () => pixels() })).groups).toEqual([]);
  const failed = await buildReview([item(1), item(2)], { loadPixels: () => { throw new Error('offline'); } });
  expect(failed.groups).toEqual([]);
  expect(failed.coverage.unreadable).toBe(2);
});

test('embedding comparisons require matching models and dimensions', () => {
  const embedding = Buffer.alloc(8); embedding.writeFloatLE(1, 0);
  expect(cosine({ model: 'a', dim: 2, embedding }, { model: 'b', dim: 2, embedding })).toBeUndefined();
  expect(cosine({ model: 'a', dim: 2, embedding }, { model: 'a', dim: 2, embedding })).toBeCloseTo(1);
});

test('high structural similarity is rejected when same-model semantics disagree', async () => {
  const result = await buildReview([item(1), item(2)], {
    loadPixels: () => pixels(),
    loadEmbedding: (i) => {
      const embedding = Buffer.alloc(8); embedding.writeFloatLE(1, (i.file_id - 1) * 4);
      return { model: 'test', dim: 2, embedding };
    },
  });
  expect(result.groups).toHaveLength(0);
});

test('group signatures change when files are replaced', async () => {
  const a = await buildReview([item(1), item(2)], { loadPixels: () => pixels() });
  const b = await buildReview([item(1), item(2, { mtime_ms: 101 })], { loadPixels: () => pixels() });
  expect(a.groups[0].id).not.toBe(b.groups[0].id);
});
