import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInventory, inventoryMatchesSession } from '../runner/inventory';

test('persisted inventory is not accepted as this run current inventory', () => {
  const inv = normalizeInventory({ progress: '20/20', tasks: [{ name: 'x', quota: '0/5' }] }, 'a', 'b');
  inv.collected_at = '2026-10-30T01:00:00.000Z';
  assert.equal(inventoryMatchesSession(inv, 'a', 'b', new Date('2026-10-30T14:00:00Z')), false);
});
test('fresh inventory must belong to the actual account and activity', () => {
  const inv = normalizeInventory({ progress: '20/20', tasks: [{ name: 'x', quota: '0/5' }] }, 'a', 'b');
  assert.equal(inventoryMatchesSession(inv, 'other', 'b', new Date()), false);
});
