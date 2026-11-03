import test from 'node:test';
import assert from 'node:assert/strict';
import { readTaskObservation } from '../runner/task-observation';
const task = { name: '目标任务' };
test('records a known panel with target not visible as observation, without asserting global absence', async () => {
  const value = await readTaskObservation({ aiQuery: async () => ({ pageIsTaskPanel: true, blocked: false, targetVisible: false }) }, task);
  assert.deepEqual(value, { name: task.name, absent: true, pageIsTaskPanel: true, scope: 'visible' });
});
test('ambiguous visibility and a blocked or non-panel page remain unknown', async () => {
  for (const raw of [null, { pageIsTaskPanel: false, blocked: false, targetVisible: false }, { pageIsTaskPanel: true, blocked: true, targetVisible: false }, { pageIsTaskPanel: true, blocked: false, targetVisible: null }]) {
    assert.equal(await readTaskObservation({ aiQuery: async () => raw }, task), null);
  }
});
test('visible row must have exact task identity and valid quota', async () => {
  const raw = { pageIsTaskPanel: true, blocked: false, targetVisible: true, name: task.name, done: 4, total: 5 };
  assert.deepEqual(await readTaskObservation({ aiQuery: async () => raw }, task), { name: task.name, done: 4, total: 5 });
  for (const bad of [{ ...raw, name: '邻居' }, { ...raw, done: null }, { ...raw, done: 6 }]) assert.equal(await readTaskObservation({ aiQuery: async () => bad }, task), null);
});
