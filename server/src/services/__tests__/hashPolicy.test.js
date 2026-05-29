const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { canTreatAsSameContentForDestructiveDedupe } = require('../hashPolicy');

describe('hashPolicy', () => {
  let root;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-hash-policy-'));
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  test('allows sha256 rows with same hash algorithm and size', async () => {
    const a = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'a') };
    const b = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'b') };
    await fs.writeFile(a.path, '0123456789');
    await fs.writeFile(b.path, '0123456789');

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(true);
  });

  test('rejects same hash with different sizes', async () => {
    const a = { hash: 'h', hash_algo: 'sha256', size: 10, path: path.join(root, 'a') };
    const b = { hash: 'h', hash_algo: 'sha256', size: 11, path: path.join(root, 'b') };

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(false);
  });

  test('legacy md5 requires byte equality', async () => {
    const a = { hash: 'legacy', hash_algo: 'md5', size: 4, path: path.join(root, 'a') };
    const b = { hash: 'legacy', hash_algo: 'md5', size: 4, path: path.join(root, 'b') };
    await fs.writeFile(a.path, 'abcd');
    await fs.writeFile(b.path, 'abce');

    await expect(canTreatAsSameContentForDestructiveDedupe(a, b)).resolves.toBe(false);
  });
});
