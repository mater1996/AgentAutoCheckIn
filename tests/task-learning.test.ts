import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnknownTaskPrompt } from '../runner/task-learning';

test('unknown task execution receives the actual observation without assigning a template', () => {
  const prompt = buildUnknownTaskPrompt({ name: '当前任务', instruction: '浏览5秒', quota: '1/5', reward: 20 });
  assert.match(prompt, /浏览5秒/);
  assert.match(prompt, /1\/5/);
  assert.match(prompt, /不要根据名称/);
});
