const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const {
  assertRegularFileForMutation,
  ensurePathInsideOneOf,
  uniquePath,
  makeQuarantinePath,
  areFilesByteEqual,
} = require('../fileSafety');

describe('fileSafety', () => {
  let root;
  let managedRoot;
  let trashDir;
  let quarantineDir;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-safety-'));
    managedRoot = path.join(root, 'managed');
    trashDir = path.join(root, 'trash');
    quarantineDir = path.join(root, 'quarantine');
    await fs.ensureDir(managedRoot);
    await fs.ensureDir(trashDir);
    await fs.ensureDir(quarantineDir);
  });

  afterEach(async () => {
    await fs.remove(root);
  });

  test('assertRegularFileForMutation rejects directories before mutation', async () => {
    const dirPath = path.join(root, 'not-a-file');
    await fs.ensureDir(dirPath);

    await expect(assertRegularFileForMutation(dirPath)).rejects.toThrow('not_regular_file');
  });

  test('assertRegularFileForMutation accepts normal files', async () => {
    const filePath = path.join(root, 'photo.jpg');
    await fs.writeFile(filePath, 'photo-bytes');

    await expect(assertRegularFileForMutation(filePath)).resolves.toEqual({
      path: path.resolve(filePath),
      size: Buffer.byteLength('photo-bytes'),
    });
  });

  test('ensurePathInsideOneOf rejects paths outside configured roots', () => {
    const outside = path.join(os.tmpdir(), 'outside-photo.jpg');

    expect(() => ensurePathInsideOneOf(outside, [managedRoot, trashDir])).toThrow('path_outside_allowed_roots');
  });

  test('ensurePathInsideOneOf accepts path under configured roots', () => {
    const inside = path.join(managedRoot, 'album', 'photo.jpg');

    expect(ensurePathInsideOneOf(inside, [managedRoot, trashDir])).toBe(path.resolve(inside));
  });

  test('uniquePath does not overwrite existing files', async () => {
    const first = path.join(root, 'photo.jpg');
    await fs.writeFile(first, 'existing');

    await expect(uniquePath(first)).resolves.toBe(path.join(root, 'photo (1).jpg'));
  });

  test('makeQuarantinePath stays under quarantine root and includes source filename', async () => {
    const source = path.join(root, 'source', 'photo.jpg');
    const dest = await makeQuarantinePath({
      quarantineDir,
      hash: 'abc123',
      fileId: 42,
      sourcePath: source,
      reason: 'dedupe',
    });

    expect(dest.startsWith(path.resolve(quarantineDir) + path.sep)).toBe(true);
    expect(path.basename(dest)).toBe('abc123_file-42_dedupe_photo.jpg');
  });

  test('areFilesByteEqual distinguishes same-size different-content files', async () => {
    const a = path.join(root, 'a.bin');
    const b = path.join(root, 'b.bin');
    await fs.writeFile(a, 'abcd');
    await fs.writeFile(b, 'abce');

    await expect(areFilesByteEqual(a, b)).resolves.toBe(false);
  });

  test('areFilesByteEqual accepts identical files', async () => {
    const a = path.join(root, 'a.bin');
    const b = path.join(root, 'b.bin');
    await fs.writeFile(a, 'same-bytes');
    await fs.copy(a, b);

    await expect(areFilesByteEqual(a, b)).resolves.toBe(true);
  });
});
