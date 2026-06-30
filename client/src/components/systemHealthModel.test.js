import test from 'node:test';
import assert from 'node:assert/strict';

import { getCapabilityModel } from './systemHealthModel.js';

test('returns loading model when status data has not arrived yet', () => {
  const model = getCapabilityModel(undefined, { isLoading: true });

  assert.equal(model.kind, 'loading');
  assert.equal(model.label, '检查中');
});

test('returns unknown model when capability payload is missing after load', () => {
  const model = getCapabilityModel(undefined, { isLoading: false });

  assert.equal(model.kind, 'unknown');
  assert.equal(model.label, '未知');
});

test('returns ok model when capability is explicitly available', () => {
  const model = getCapabilityModel({ available: true }, { isLoading: false });

  assert.equal(model.kind, 'ok');
  assert.equal(model.label, '正常');
});

test('returns issue model only when capability payload exists and is unavailable', () => {
  const model = getCapabilityModel({ available: false, message: '服务离线' }, { isLoading: false });

  assert.equal(model.kind, 'issue');
  assert.equal(model.label, '待恢复');
  assert.equal(model.detail, '服务离线');
});
