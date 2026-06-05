import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

async function alphaBounds(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha > 10) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return {
    width: info.width,
    height: info.height,
    left: minX,
    top: minY,
    right: info.width - 1 - maxX,
    bottom: info.height - 1 - maxY,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1,
  };
}

describe('desktop icon generation', () => {
  it('keeps the app icon inside a transparent safe area', async () => {
    execFileSync(process.execPath, ['scripts/generate-icons.mjs'], {
      cwd: new URL('..', import.meta.url),
      stdio: 'pipe',
    });

    const bounds = await alphaBounds(fileURLToPath(new URL('../assets/icon.png', import.meta.url)));

    assert.equal(bounds.width, 1024);
    assert.equal(bounds.height, 1024);
    assert.ok(bounds.left >= 70, `expected left padding >= 70px, got ${bounds.left}px`);
    assert.ok(bounds.top >= 70, `expected top padding >= 70px, got ${bounds.top}px`);
    assert.ok(bounds.right >= 70, `expected right padding >= 70px, got ${bounds.right}px`);
    assert.ok(bounds.bottom >= 70, `expected bottom padding >= 70px, got ${bounds.bottom}px`);
    assert.ok(bounds.contentWidth <= 884, `expected content width <= 884px, got ${bounds.contentWidth}px`);
    assert.ok(bounds.contentHeight <= 884, `expected content height <= 884px, got ${bounds.contentHeight}px`);
  });
});
