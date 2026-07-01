import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'dev-start.js'), 'utf8');

assert.match(
  source,
  /taskkill['"],\s*\[\s*['"]\/F['"],\s*['"]\/T['"],\s*['"]\/PID['"]/,
  'Windows stop must terminate the whole process tree so npm/nodemon/vite children do not leak',
);

assert.match(
  source,
  /Existing servers found; stopping them before restart/,
  'Starting dev with a stale PID file should clean existing servers instead of stacking more watchers',
);

assert.match(
  source,
  /manager:\s*process\.pid/,
  'PID file should include the dev-start manager process so stale wrappers can be cleaned up',
);

assert.match(
  source,
  /TIDY_DISABLE_WATCHER:\s*'1'/,
  'dev-start should expose a no-watcher mode for NAS-backed scan roots',
);

console.log('dev-start process management checks passed');
