import assert from 'node:assert/strict';
import test from 'node:test';
import { observedRecipeUsable } from '../runner/observed-recipe';

test('an unverified action trace is not a reusable recipe', () => {
  assert.equal(observedRecipeUsable({ state: 'candidate', validations: 0, taskName: 'x', instruction: '浏览10秒' }, { name: 'x', instruction: '浏览10秒' }), false);
});
test('a verified recipe must match the observed task requirement', () => {
  assert.equal(observedRecipeUsable({ state: 'validated', validations: 2, taskName: 'x', instruction: '浏览10秒' }, { name: 'x', instruction: '搜索后浏览10秒' }), false);
});
