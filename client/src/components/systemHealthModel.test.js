import test from 'node:test';
import assert from 'node:assert/strict';

import { getCapabilityModel, getTaskSummaryModel } from './systemHealthModel.js';

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

test('returns auto-retry summary when latest faces task is blocked by unavailable faces capability', () => {
  const model = getTaskSummaryModel(
    {
      latest: {
        status: 'failed',
        last_error: 'faces_unavailable: InsightFace unavailable',
        progress: { blockedReason: 'faces_unavailable' },
      },
    },
    { capabilityKey: 'faces' }
  );

  assert.equal(model.tone, 'issue');
  assert.equal(model.text, '最近任务：人脸能力不可用，系统会在恢复后自动重试');
});

test('returns running summary for active latest task using done and total counts', () => {
  const model = getTaskSummaryModel(
    {
      latest: {
        status: 'running',
        progress: { done: 12, total: 40 },
      },
    },
    { capabilityKey: 'clip' }
  );

  assert.equal(model.tone, 'running');
  assert.equal(model.text, '最近任务：处理中 12 / 40');
});

test('retains processed compatibility for active latest task summaries', () => {
  const model = getTaskSummaryModel(
    {
      latest: {
        status: 'running',
        progress: { processed: 12, total: 40 },
      },
    },
    { capabilityKey: 'clip' }
  );

  assert.equal(model.tone, 'running');
  assert.equal(model.text, '最近任务：处理中 12 / 40');
});

test('returns queued summary for pending latest task', () => {
  const model = getTaskSummaryModel(
    {
      latest: {
        status: 'queued',
      },
    },
    { capabilityKey: 'clip' }
  );

  assert.equal(model.tone, 'running');
  assert.equal(model.text, '最近任务：排队中');
});

test('returns finished summary when latest task completed successfully', () => {
  const model = getTaskSummaryModel(
    {
      latest: {
        status: 'finished',
      },
    },
    { capabilityKey: 'clip' }
  );

  assert.equal(model.tone, 'ok');
  assert.equal(model.text, '最近任务：已完成');
});

test('returns neutral summary when there is no latest task', () => {
  const model = getTaskSummaryModel({ latest: null }, { capabilityKey: 'faces' });

  assert.equal(model.tone, 'neutral');
  assert.equal(model.text, '暂无最近任务');
});
