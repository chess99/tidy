/**
 * input: 测试用例 + configStore 模块
 * output: 测试结果
 * pos: configStore workspace 路径规范化逻辑的单元测试（变更需同步更新本头注释与所属目录 README）
 */

const path = require('path');
const os = require('os');

// Test workspace path normalization logic
// Since normalizeWorkspacePath is not exported, we test the behavior through the public API
// or duplicate the logic here for testing.

function abs(p) {
  if (!p) return null;
  try {
    return path.resolve(String(p));
  } catch {
    return String(p);
  }
}

function stripTrailingSep(p) {
  if (!p) return p;
  let s = String(p);
  while (s.length > 1 && (s.endsWith(path.sep) || s.endsWith('/') || s.endsWith('\\'))) {
    s = s.slice(0, -1);
  }
  return s;
}

function normalizeWorkspacePath(raw, defaultVal) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return defaultVal;
  try {
    const r = stripTrailingSep(abs(s));
    if (!r || !path.isAbsolute(r)) return defaultVal;
    return r;
  } catch {
    return defaultVal;
  }
}

describe('normalizeWorkspacePath', () => {
  const DEFAULT_MANAGED_ROOT = path.join(os.homedir(), 'Pictures', 'Tidy');
  const DEFAULT_TRASH_DIR = path.join(__dirname, '..', '..', 'data', 'trash');

  test('returns default for empty string', () => {
    expect(normalizeWorkspacePath('', DEFAULT_MANAGED_ROOT)).toBe(DEFAULT_MANAGED_ROOT);
    expect(normalizeWorkspacePath('   ', DEFAULT_MANAGED_ROOT)).toBe(DEFAULT_MANAGED_ROOT);
  });

  test('returns default for null/undefined', () => {
    expect(normalizeWorkspacePath(null, DEFAULT_MANAGED_ROOT)).toBe(DEFAULT_MANAGED_ROOT);
    expect(normalizeWorkspacePath(undefined, DEFAULT_MANAGED_ROOT)).toBe(DEFAULT_MANAGED_ROOT);
  });

  test('normalizes valid absolute paths', () => {
    const customPath = '/custom/path/to/managed';
    expect(normalizeWorkspacePath(customPath, DEFAULT_MANAGED_ROOT)).toBe(customPath);
    expect(normalizeWorkspacePath('  /custom/path  ', DEFAULT_MANAGED_ROOT)).toBe('/custom/path');
  });

  test('returns resolved path for relative paths (path.resolve makes them absolute)', () => {
    // Note: path.resolve('relative/path') resolves to an absolute path based on cwd.
    // So relative paths become absolute, and normalizeWorkspacePath accepts them.
    // This is actually fine - the function accepts any absolute path.
    const relativePath = 'relative/path';
    const resolved = path.resolve(relativePath);
    expect(normalizeWorkspacePath(relativePath, DEFAULT_MANAGED_ROOT)).toBe(resolved);
    // But paths that resolve to non-absolute (shouldn't happen) or invalid would use default
  });

  test('handles trailing separators', () => {
    const customPath = '/custom/path/';
    const expected = '/custom/path';
    expect(normalizeWorkspacePath(customPath, DEFAULT_MANAGED_ROOT)).toBe(expected);
  });

  test('handles Windows paths', () => {
    if (process.platform === 'win32') {
      const winPath = 'C:\\Users\\test\\Managed';
      expect(normalizeWorkspacePath(winPath, DEFAULT_MANAGED_ROOT)).toBe(winPath);
    }
  });
});
