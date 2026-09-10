/**
 * input: 测试用例 + configStore 模块
 * output: 测试结果
 * pos: configStore workspace 路径规范化逻辑的单元测试（变更需同步更新本头注释与所属目录 README）
 */

const os = require('os');
const path = require('path');
const { normalizeWorkspacePath } = require('../configStore');

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
    expect(normalizeWorkspacePath(customPath, DEFAULT_MANAGED_ROOT)).toBe(path.resolve(customPath));
    expect(normalizeWorkspacePath('  /custom/path  ', DEFAULT_MANAGED_ROOT)).toBe(path.resolve('/custom/path'));
  });

  test('rejects relative paths', () => {
    expect(() => normalizeWorkspacePath('relative/path', DEFAULT_MANAGED_ROOT)).toThrow(
      'workspace paths must be absolute'
    );
  });

  test('handles trailing separators', () => {
    const customPath = '/custom/path/';
    const expected = path.resolve('/custom/path');
    expect(normalizeWorkspacePath(customPath, DEFAULT_MANAGED_ROOT)).toBe(expected);
  });

  test('handles Windows paths', () => {
    if (process.platform === 'win32') {
      const winPath = 'C:\\Users\\test\\Managed';
      expect(normalizeWorkspacePath(winPath, DEFAULT_MANAGED_ROOT)).toBe(winPath);
    }
  });
});
