const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const { computeHash } = require('../hasher');

describe('computeHash', () => {
  test('returns sha256 digest and algorithm metadata', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-hasher-'));
    try {
      const file = path.join(root, 'a.txt');
      await fs.writeFile(file, 'abc');
      const result = await computeHash(file);
      expect(result).toEqual({
        hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        hash_algo: 'sha256',
      });
    } finally {
      await fs.remove(root);
    }
  });
});
