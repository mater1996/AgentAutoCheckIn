import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRunResult } from '../runner/result';

test('a positive balance change with a task failure is partial', () => {
  assert.equal(classifyRunResult({ before: 715, after: 740, failures: ['task input failed'], verified: false }), 'PARTIAL');
});
test('a missing final balance cannot become already done from a completion label', () => {
  assert.equal(classifyRunResult({ before: 740, after: null, failures: [], verified: true }), 'OBSERVATION_FAILED');
});
test('clean observed growth remains OK', () => {
  assert.equal(classifyRunResult({ before: 715, after: 740, failures: [], verified: false }), 'OK');
});
test('valid unchanged balance and completion marker is already done', () => {
  assert.equal(classifyRunResult({ before: 740, after: 740, failures: [], verified: true }), 'ALREADY');
});
