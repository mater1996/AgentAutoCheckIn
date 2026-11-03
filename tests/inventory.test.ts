import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInventory } from '../runner/inventory';

test('invalid progress is unknown and cannot produce an executable inventory', () => {
  assert.throws(() => normalizeInventory({ progress: null, tasks: [{ name: 'anything', quota: '0/5' }] }, 'tb_main', 'tb_coin'), /进度|progress/);
});
test('invalid per-task quota is rejected instead of silently dropped as zero', () => {
  assert.throws(() => normalizeInventory({ progress: '19/20', tasks: [{ name: 'anything', quota: null }] }, 'tb_main', 'tb_coin'), /配额|quota/);
});
