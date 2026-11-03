import assert from 'node:assert/strict';
import test from 'node:test';
import { observeTaskChange } from '../runner/task-evidence';

test('saturated tier progress does not hide an individual task increment', () => {
  assert.deepEqual(observeTaskChange({ name: '当前观察的任务', done: 4, total: 5 }, { name: '当前观察的任务', done: 5, total: 5 }), { status: 'completed', increment: 1 });
});
test('a missing task after navigation is unknown, not completed', () => {
  assert.equal(observeTaskChange({ name: '当前观察的任务', done: 4, total: 5 }, null).status, 'unknown');
});
test('a different task cannot verify the selected task', () => {
  assert.equal(observeTaskChange({ name: '任务A', done: 0, total: 5 }, { name: '任务B', done: 1, total: 5 }).status, 'unknown');
});

test('untrusted null numeric or missing task names are unknown without throwing', () => {
  const valid = { name: '拍立淘', done: 1, total: 5 };
  for (const invalid of [{ name: null, done: 1, total: 5 }, { name: 42, done: 1, total: 5 }, { done: 1, total: 5 }]) {
    assert.deepEqual(observeTaskChange(invalid as any, valid), { status: 'unknown', increment: null });
    assert.deepEqual(observeTaskChange(valid, invalid as any), { status: 'unknown', increment: null });
  }
});
