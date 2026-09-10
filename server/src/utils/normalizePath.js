const path = require('path');

/**
 * Normalize filesystem paths for DB keys.
 *
 * On Windows, the filesystem is usually case-insensitive, but SQLite uniqueness
 * is case-sensitive by default. Canonicalizing to lower-case avoids
 * `Z:\Photos` vs `Z:\photos` being treated as different paths.
 *
 * On macOS/Linux, keep case-sensitive semantics.
 */
function normalizePathForDb(p) {
  if (!p) return p;
  const s = String(p);
  let resolved;
  try {
    resolved = path.resolve(s);
  } catch {
    resolved = s;
  }
  if (process.platform === 'win32') return resolved.toLowerCase();
  return resolved;
}

module.exports = { normalizePathForDb };



