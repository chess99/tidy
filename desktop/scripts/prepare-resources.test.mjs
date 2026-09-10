/**
 * input: candidate paths from the server source tree
 * output: packaging inclusion decisions
 * pos: prevents development data and secrets from entering desktop bundles
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { shouldCopyServerPath } from './prepare-resources.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..', '..', 'server');

test('desktop bundle excludes server-local data and secrets', () => {
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'tidy.db')), false);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'tidy.db-wal')), false);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, '.env')), false);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'data', 'tidy.db')), false);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'src', '__tests__', 'config.test.js')), false);
});

test('desktop bundle keeps runtime code and dependency data directories', () => {
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'index.js')), true);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'src', 'config.js')), true);
  assert.equal(shouldCopyServerPath(path.join(serverRoot, 'node_modules', 'example', 'data', 'runtime.bin')), true);
});
