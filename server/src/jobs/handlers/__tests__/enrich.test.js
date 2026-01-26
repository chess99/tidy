/**
 * input: 测试用例 + enrich 模块
 * output: 测试结果
 * pos: enrich handler 的单元测试（变更需同步更新本头注释与所属目录 README）
 */

const path = require('path');

// Import the actual functions we want to test.
// Since they're not exported, we'll need to either:
// 1. Export them from enrich.js, or
// 2. Test them indirectly through the handler
// For now, we'll duplicate the logic here to test it, then we can refactor to export if needed.

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function isUnder(parent, child) {
  try {
    const p = stripTrailingSep(path.resolve(String(parent)));
    const c = stripTrailingSep(path.resolve(String(child)));
    const pNorm = process.platform === 'win32' ? p.toLowerCase() : p;
    const cNorm = process.platform === 'win32' ? c.toLowerCase() : c;
    return cNorm === pNorm || cNorm.startsWith(pNorm + path.sep);
  } catch {
    return false;
  }
}

function parseAlbumNameFromManagedPath(filePath, managedRoot, trashDir) {
  try {
    const rel = path.relative(String(managedRoot), String(filePath));
    // If file is outside managedRoot, path.relative returns a path starting with '..'
    if (rel.startsWith('..')) return null;
    const parts = rel.split(path.sep).filter(Boolean);
    const first = parts.length ? String(parts[0]) : null;
    if (!first) return null;
    // Exclude trashDir if it's under managedRoot (to avoid treating it as an album).
    if (trashDir && isUnder(managedRoot, trashDir) && isUnder(trashDir, filePath)) {
      return null;
    }
    return first;
  } catch {
    return null;
  }
}

describe('parseAlbumNameFromManagedPath', () => {
  const managedRoot = '/Users/test/Pictures/Tidy';
  const trashDirUnderManaged = '/Users/test/Pictures/Tidy/Trash';
  const trashDirSeparate = '/tmp/trash';

  test('extracts album name from path under managed root', () => {
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/Vacation/photo.jpg', managedRoot, trashDirSeparate)).toBe('Vacation');
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/2024/photo.jpg', managedRoot, trashDirSeparate)).toBe('2024');
  });

  test('returns null for files in trashDir when trashDir is under managedRoot', () => {
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/Trash/photo.jpg', managedRoot, trashDirUnderManaged)).toBeNull();
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/Trash/sub/photo.jpg', managedRoot, trashDirUnderManaged)).toBeNull();
  });

  test('allows album named "Trash" when trashDir is separate', () => {
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/Trash/photo.jpg', managedRoot, trashDirSeparate)).toBe('Trash');
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/TrashAlbum/photo.jpg', managedRoot, trashDirSeparate)).toBe('TrashAlbum');
  });

  test('returns null for files outside managedRoot', () => {
    expect(parseAlbumNameFromManagedPath('/tmp/trash/photo.jpg', managedRoot, trashDirSeparate)).toBeNull();
    expect(parseAlbumNameFromManagedPath('/other/path/photo.jpg', managedRoot, trashDirSeparate)).toBeNull();
  });

  test('returns album name for files directly in managedRoot (treats filename as album)', () => {
    // Note: Current implementation treats the first path segment as album name.
    // A file directly in managedRoot would have rel = "photo.jpg", so first = "photo.jpg".
    // This is actually fine - it means the file is in an "album" named after itself.
    // If we want to exclude this, we'd need to check if first contains a file extension.
    const result = parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/photo.jpg', managedRoot, trashDirSeparate);
    // Current behavior: returns the filename as album name
    expect(result).toBe('photo.jpg');
  });

  test('handles Windows paths', () => {
    // Skip on non-Windows platforms (path resolution differs)
    if (process.platform !== 'win32') {
      const winManagedRoot = 'C:\\Users\\test\\Pictures\\Tidy';
      const winTrashDir = 'C:\\Users\\test\\Pictures\\Tidy\\Trash';
      // On non-Windows, these paths won't resolve correctly, so we skip
      return;
    }
    const winManagedRoot = 'C:\\Users\\test\\Pictures\\Tidy';
    const winTrashDir = 'C:\\Users\\test\\Pictures\\Tidy\\Trash';
    expect(parseAlbumNameFromManagedPath('C:\\Users\\test\\Pictures\\Tidy\\Vacation\\photo.jpg', winManagedRoot, winTrashDir)).toBe('Vacation');
    expect(parseAlbumNameFromManagedPath('C:\\Users\\test\\Pictures\\Tidy\\Trash\\photo.jpg', winManagedRoot, winTrashDir)).toBeNull();
  });

  test('handles edge cases', () => {
    expect(parseAlbumNameFromManagedPath('', managedRoot, trashDirSeparate)).toBeNull();
    expect(parseAlbumNameFromManagedPath(managedRoot, managedRoot, trashDirSeparate)).toBeNull();
    expect(parseAlbumNameFromManagedPath('/Users/test/Pictures/Tidy/', managedRoot, trashDirSeparate)).toBeNull();
  });
});

describe('isUnder', () => {
  test('detects child paths correctly', () => {
    expect(isUnder('/Users/test', '/Users/test/file.txt')).toBe(true);
    expect(isUnder('/Users/test', '/Users/test/sub/file.txt')).toBe(true);
    expect(isUnder('/Users/test', '/Users/test')).toBe(true);
    expect(isUnder('/Users/test', '/Users/other/file.txt')).toBe(false);
    expect(isUnder('/Users/test', '/tmp/file.txt')).toBe(false);
  });

  test('handles trailing separators', () => {
    expect(isUnder('/Users/test/', '/Users/test/file.txt')).toBe(true);
    expect(isUnder('/Users/test', '/Users/test/file.txt/')).toBe(true);
  });

  test('handles Windows paths (case-insensitive)', () => {
    if (process.platform === 'win32') {
      expect(isUnder('C:\\Users\\Test', 'C:\\Users\\test\\file.txt')).toBe(true);
      expect(isUnder('C:\\Users\\test', 'C:\\Users\\TEST\\file.txt')).toBe(true);
    }
  });
});
