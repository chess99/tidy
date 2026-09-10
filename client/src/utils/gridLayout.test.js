/**
 * input: 网格可用宽度
 * output: 响应式列数与 4:3 缩略图尺寸断言
 * pos: 客户端工具层测试：锁定虚拟网格的响应式布局契约
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GRID_COLUMNS, getGridMetrics } from './gridLayout.js';

test('falls back to stable metrics before the container is measured', () => {
  const metrics = getGridMetrics(0);

  assert.equal(metrics.columns, DEFAULT_GRID_COLUMNS);
  assert.equal(metrics.thumbnailHeight, 216);
  assert.equal(metrics.rowHeight, 312);
});

test('adds and removes columns while keeping cards above the preferred minimum width', () => {
  const wide = getGridMetrics(1344);
  const narrow = getGridMetrics(1216);

  assert.equal(wide.columns, 5);
  assert.equal(wide.cardWidth, 256);
  assert.equal(wide.thumbnailHeight, 192);
  assert.equal(wide.rowHeight, 288);
  assert.equal(narrow.columns, 4);
  assert.equal(narrow.cardWidth, 292);
  assert.equal(narrow.thumbnailHeight, 219);
  assert.equal(narrow.rowHeight, 315);
});

test('uses a single column when the content area is narrower than one preferred card', () => {
  const metrics = getGridMetrics(200);

  assert.equal(metrics.columns, 1);
  assert.equal(metrics.cardWidth, 200);
  assert.equal(metrics.thumbnailHeight, 150);
});
