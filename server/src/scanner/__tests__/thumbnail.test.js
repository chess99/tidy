const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { generateThumbnail, THUMB_MAX_EDGE_PX } = require('../thumbnail');

describe('thumbnail generation', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidy-thumb-test-'));
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  test('preserves a landscape image aspect ratio', async () => {
    const source = path.join(tempDir, 'landscape.png');
    await sharp({
      create: { width: 1600, height: 800, channels: 3, background: '#4477aa' },
    }).png().toFile(source);

    const output = await generateThumbnail(source, 'landscape', { thumbDir: tempDir, force: true });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(THUMB_MAX_EDGE_PX);
    expect(metadata.height).toBe(THUMB_MAX_EDGE_PX / 2);
  });

  test('preserves a portrait image aspect ratio', async () => {
    const source = path.join(tempDir, 'portrait.png');
    await sharp({
      create: { width: 600, height: 1200, channels: 3, background: '#aa7744' },
    }).png().toFile(source);

    const output = await generateThumbnail(source, 'portrait', { thumbDir: tempDir, force: true });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(THUMB_MAX_EDGE_PX / 2);
    expect(metadata.height).toBe(THUMB_MAX_EDGE_PX);
  });

  test('does not enlarge a small source image', async () => {
    const source = path.join(tempDir, 'small.png');
    await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#777777' },
    }).png().toFile(source);

    const output = await generateThumbnail(source, 'small', { thumbDir: tempDir, force: true });
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(50);
  });
});
