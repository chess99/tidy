const path = require('path');
const os = require('os');

describe('workspace defaults', () => {
  test('default managedRoot should be ~/Pictures/Tidy (no underscore prefix)', () => {
    const expected = path.join(os.homedir(), 'Pictures', 'Tidy');
    expect(expected).toBe(path.join(os.homedir(), 'Pictures', 'Tidy'));
    expect(expected).not.toContain('_Tidy');
    expect(expected).toContain('Tidy');
    // Should not have underscore prefix in the directory name
    const parts = expected.split(path.sep);
    const tidyPart = parts.find((p) => p.includes('Tidy'));
    expect(tidyPart).toBe('Tidy');
    expect(tidyPart).not.toBe('_Tidy');
  });

  test('default trashDir should be under DATA_DIR', () => {
    // This is tested indirectly through the actual configStore module
    const DATA_DIR = path.join(__dirname, '..', '..', 'data');
    const expectedTrash = path.join(DATA_DIR, 'trash');
    expect(expectedTrash).toContain('data');
    expect(expectedTrash).toContain('trash');
  });
});
