import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInventory } from '../runner/inventory';

test('observed task instructions survive collection for learning', () => {
  const inv = normalizeInventory({ progress: '20/20', tasks: [{ name: 'fresh task', quota: '1/5', instruction: '浏览5秒', reward: 20 }] }, 'a', 'b');
  assert.equal(inv.tasks[0].instruction, '浏览5秒');
});
