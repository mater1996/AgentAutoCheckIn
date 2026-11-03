import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivityRound, taskIdentity, type RoundDependencies, type RoundInventory, type RoundState} from '../runner/staged/round.ts';

const row = (name: string, done = 0, total = 1) => ({name, instruction: '浏览5秒', done, total});
const inventory = (tasks = [row('A'), row('B'), row('C')]): RoundInventory => ({complete: true, pages: [{top: true, bottom: true}], tasks});
const execution = (status = 'completed', extra = {}) => ({status, entryDispatched: true, inputUnknown: false, blocked: false, returned: true, persistenceVerified: true, gainCoins: status === 'completed' ? 20 : null, ...extra});
function harness(options: Partial<RoundDependencies> = {}) {
  const saved: RoundState[] = [], executed: string[] = [], events: string[] = [];
  const deps: RoundDependencies = {
    prepare: async () => { events.push('prepare'); }, open: async () => { events.push('open'); },
    collect: async () => { events.push('collect'); return inventory(); },
    plan: async inv => ({items: inv.tasks.toReversed().map(t => ({...t, decision: 'do', times: 1, reason: 'explicit current requirement'}))}),
    execute: async (item, state) => {
      const durable = saved.at(-1)!;
      assert.equal(durable.attempts.at(-1)?.status, 'reserved');
      assert.equal(durable.revisions.length, state.revisions.length);
      executed.push(item.name); return execution(item.name === 'B' ? 'stopped' : 'completed');
    },
    persist: async state => { saved.push(structuredClone(state)); },
    finish: async () => { events.push('finish'); return {home: true, asleep: true}; },
    cleanup: async () => { events.push('cleanup'); }, ...options,
  };
  return {deps, saved, executed, events};
}

test('round persists plans and reservations, runs A then safely returned failure B then C, and finishes', async () => {
  const h = harness();
  const result = await runActivityRound({id: 'round-1', batchId: 'existing-batch'}, h.deps);
  assert.deepEqual(h.executed, ['A', 'B', 'C']);
  assert.equal(result.status, 'completed');
  assert.equal(result.reason, 'no-eligible-candidates');
  assert.equal(result.revisions.length, 4);
  assert.deepEqual(result.attempts.map(a => a.status), ['consumed', 'consumed', 'consumed']);
  assert.equal(result.attempts[1].result?.gainCoins, null);
  assert.equal(result.attempts[0].identity, taskIdentity(row('A')));
  assert.deepEqual(h.events, ['prepare', 'open', 'collect', 'collect', 'collect', 'collect', 'finish', 'cleanup']);
  assert.equal(h.saved.at(-1)?.status, 'completed');
});

test('changed quotas do not release consumed identities and newly appearing tasks are planned', async () => {
  let cycle = 0;
  const h = harness({collect: async () => ++cycle === 1 ? inventory([row('A', 0, 2)]) : inventory([row('A', 1, 4), row('NEW')])});
  const result = await runActivityRound({id: 'dynamic'}, h.deps);
  assert.deepEqual(h.executed, ['A', 'NEW']);
  assert.equal(result.revisions[1].inventory.tasks[0].total, 4);
});

test('a new runtime given a durable unresolved reservation never replays dispatch or home input', async () => {
  const first = harness({execute: async () => {throw Error('process disappeared after dispatch boundary');}});
  const failed = await runActivityRound({id: 'restart'}, first.deps);
  assert.equal(failed.status, 'unknown');
  assert.equal(failed.attempts[0].status, 'reserved');
  const second = harness();
  const result = await runActivityRound({id: 'restart', resume: first.saved.at(-1)}, second.deps);
  assert.equal(result.reason, 'unresolved-reservation');
  assert.deepEqual(second.events, ['cleanup']);
  assert.deepEqual(second.executed, []);
});

test('an existing failed attempt remains consumed while a broader same-day candidate can run', async () => {
  const h = harness();
  const result = await runActivityRound({id: 'new-round', batchId: 'old', attempts: [{identity: taskIdentity(row('A')), ...row('A'), reservationId: 'old-A', status: 'consumed', evidenceKey: 'old', result: execution('stopped')}]}, h.deps);
  assert.deepEqual(h.executed, ['B', 'C']);
  assert.equal(result.batchId, 'old');
});

test('predispatch rejection remains pending without an identical-evidence retry loop', async () => {
  let calls = 0;
  const h = harness({execute: async () => { calls++; return execution('stopped', {entryDispatched: false}); }});
  const result = await runActivityRound({id: 'pending'}, h.deps);
  assert.equal(calls, 3);
  assert.deepEqual(result.attempts.map(a => a.status), ['pending', 'pending', 'pending']);
  assert.equal(result.status, 'completed');
});

for (const [name, flags, reason] of [
  ['unknown input', {inputUnknown: true}, 'input-unknown'],
  ['authentication', {blocked: true}, 'blocked'],
  ['unverified return', {returned: false}, 'return-unverified'],
  ['unverified persistence', {persistenceVerified: false}, 'persistence-unverified'],
] as const) test(`${name} stops later attempts and skips home/sleep`, async () => {
  let calls = 0;
  const h = harness({execute: async () => {calls++; return execution('unknown', flags);}});
  const result = await runActivityRound({id: name}, h.deps);
  assert.equal(calls, 1);
  assert.equal(result.reason, reason);
  assert.deepEqual(h.events.at(-1), 'cleanup');
  assert.equal(h.events.includes('finish'), false);
});

test('persist failure on reservation prevents dispatch', async () => {
  const h = harness({persist: async state => {if (state.attempts.length) throw Error('disk full');}});
  const result = await runActivityRound({id: 'disk'}, h.deps);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(h.executed, []);
  assert.equal(h.events.includes('finish'), false);
});

test('restarting a stopped unsafe round does not reset input authority', async () => {
  const h = harness({execute: async () => execution('unknown', {inputUnknown: true})});
  const first = await runActivityRound({id: 'unsafe'}, h.deps);
  const second = harness();
  const result = await runActivityRound({id: 'unsafe', resume: first}, second.deps);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(second.executed, []);
  assert.deepEqual(second.events, ['cleanup']);
});

test('unrelated row changes do not release a predispatch pending identity', async () => {
  let cycle = 0; const names: string[] = [];
  const h = harness({
    collect: async () => inventory([row('A'), row('B', ++cycle === 1 ? 0 : 1), row('C')]),
    execute: async item => {names.push(item.name); return execution('stopped', {entryDispatched: false});},
  });
  await runActivityRound({id: 'pending-evidence'}, h.deps);
  assert.deepEqual(names, ['A', 'C']);
});

test('malformed execution result leaves reservation unresolved and stops all later input', async () => {
  const h = harness({execute: async () => ({status: 'stopped', returned: true, persistenceVerified: true} as any)});
  const result = await runActivityRound({id: 'malformed'}, h.deps);
  assert.equal(result.status, 'unknown');
  assert.equal(result.attempts[0].status, 'reserved');
  assert.equal(h.events.includes('finish'), false);
});

for (const [label, data] of [
  ['duplicate identity', inventory([row('A'), row('A')])],
  ['invalid quota', inventory([row('A', 2, 1)])],
  ['empty page coverage', {...inventory(), pages: []}],
] as const) test(`invalid inventory never dispatches: ${label}`, async () => {
  const h = harness({collect: async () => structuredClone(data) as RoundInventory});
  const result = await runActivityRound({id: label}, h.deps);
  assert.deepEqual(h.executed, []);
  assert.notEqual(result.status, 'completed');
});

test('predispatch pending can be reconsidered only after its own semantic evidence changes', async () => {
  let cycle = 0, calls = 0;
  const h = harness({collect: async () => inventory([row('A', 0, ++cycle === 1 ? 1 : 2)]), execute: async () => ++calls === 1 ? execution('stopped', {entryDispatched: false}) : execution()});
  const result = await runActivityRound({id: 'fresh-evidence'}, h.deps);
  assert.equal(calls, 2);
  assert.deepEqual(result.attempts.map(a => a.status), ['pending', 'consumed']);
});

for (const phase of ['prepare', 'collect', 'plan', 'persist'] as const) test(`${phase} rejection still performs cleanup without further input`, async () => {
  const h = harness({[phase]: async () => {throw Error(`${phase} failed`);}});
  const result = await runActivityRound({id: phase}, h.deps);
  assert.equal(result.status, 'unknown');
  assert.equal(h.events.at(-1), 'cleanup');
  assert.equal(h.events.includes('finish'), false);
  assert.deepEqual(h.executed, []);
});

test('current inventory quotas override a stale planner quota before dispatch', async () => {
  const h = harness({collect: async () => inventory([row('A', 1)]), plan: async () => ({items: [{...row('A'), decision: 'do', times: 1, reason: 'stale'}]})});
  const result = await runActivityRound({id: 'stale'}, h.deps);
  assert.deepEqual(h.executed, []);
  assert.equal(result.status, 'completed');
});
