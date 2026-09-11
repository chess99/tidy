import assert from 'node:assert/strict';
import test from 'node:test';
import { updateItemSelection, updateRangeSelection } from './gridSelection.js';

test('plain click replaces the previous selection', () => {
  assert.deepEqual([...updateItemSelection(new Set([1, 2]), 3)], [3]);
});

test('additive click appends an unselected item', () => {
  assert.deepEqual([...updateItemSelection(new Set([1, 2]), 3, { additive: true })], [1, 2, 3]);
});

test('additive click removes an already selected item', () => {
  assert.deepEqual([...updateItemSelection(new Set([1, 2]), 2, { additive: true })], [1]);
});

test('shift range replaces the previous selection', () => {
  assert.deepEqual([...updateRangeSelection(new Set([8]), [2, 3, 4])], [2, 3, 4]);
});

test('additive shift range preserves the previous selection', () => {
  assert.deepEqual([...updateRangeSelection(new Set([8]), [2, 3, 4], { additive: true })], [8, 2, 3, 4]);
});
