const path = require('path');

// Fixed working root for now (later: make configurable).
// NOTE: keep as Windows-style absolute path since this project is used on Windows.
const WORK_ROOT = process.env.WORK_ROOT || 'Z:\\Photos';

// Managed library root under WORK_ROOT to avoid mixing with existing folders.
const MANAGED_ROOT = process.env.MANAGED_ROOT || path.join(WORK_ROOT, '_Tidy');

// Tool trash directory (duplicates + user trash).
const TRASH_DIR = process.env.TRASH_DIR || path.join(MANAGED_ROOT, '_Trash');

module.exports = {
  WORK_ROOT,
  MANAGED_ROOT,
  TRASH_DIR,
};


