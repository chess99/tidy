const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveNodeBin, startAiService } = require('./sidecars.cjs');

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (previous == null) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('packaged server refuses to borrow a host Node runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-sidecars-'));
  try {
    withEnv('TIDY_NODE_BIN', null, () => {
      assert.throws(
        () => resolveNodeBin({ repoRoot: root, isPackaged: true }),
        /Packaged Node runtime is missing/
      );
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('development server uses PATH node when no bundled runtime exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-sidecars-'));
  try {
    withEnv('TIDY_NODE_BIN', null, () => {
      withEnv('NODE', null, () => {
        assert.equal(resolveNodeBin({ repoRoot: root, isPackaged: false }), 'node');
      });
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit missing Node runtime is an error', () => {
  withEnv('TIDY_NODE_BIN', path.join(os.tmpdir(), 'missing-tidy-node'), () => {
    assert.throws(() => resolveNodeBin({ repoRoot: os.tmpdir() }), /TIDY_NODE_BIN does not exist/);
  });
});

test('packaged app refuses to borrow host Python when AI sidecar is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidy-sidecars-'));
  try {
    withEnv('TIDY_AI_BIN', null, () => {
      assert.throws(
        () => startAiService({ repoRoot: root, isPackaged: true }),
        /Packaged AI service is missing/
      );
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
