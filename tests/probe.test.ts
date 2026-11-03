import assert from 'node:assert/strict';
import test from 'node:test';
import { runProbes } from '../runner/probe';
import { isValidProbeState, parseFraction, parseIntStrict } from '../runner/objective';
import type { ExecCtx } from '../runner/flow';

const defs = [{ id: 'current', ask: 'fixture', parse: 'json' as const }];
const ctx = (answer: unknown): ExecCtx => ({
  agent: { aiQuery: async () => answer }, seq: 0, stage: 'test',
  balanceBefore: null, balanceAfter: null, stepsDone: 0, failed: [],
  overBudget: () => false, log: () => {},
});

test('missing task counts remain unknown instead of being inferred from reward progress', async () => {
  const result = await runProbes(ctx({ progress: '20/20' }), defs, { retry: 0 });
  assert.equal(isValidProbeState(result.state), false);
  assert.equal(result.state.tasksLeft, -1);
  assert.equal(result.valid, false);
  assert.ok(result.failed.length > 0);
});

test('probes reject malformed current counts and expose explicit validity', async () => {
  for (const answer of [
    { progress: '21/20', tasks_left: 1 },
    { progress: '-1/20', tasks_left: 1 },
    { progress: '1.5/20', tasks_left: 1 },
    { progress: '1/20.5', tasks_left: 1 },
    { progress: '1/20', tasks_left: -1 },
    { progress: '1/20', tasks_left: 1.5 },
    { progress: '1/20', tasks_left: Infinity },
    { progress: '1/20', tasks_left: NaN },
  ]) {
    const result = await runProbes(ctx(answer), defs, { retry: 0 });
    assert.equal(result.valid, false, String(answer.progress));
    assert.equal(isValidProbeState(result.state), false);
    assert.ok(result.failed.length > 0);
  }
  const result = await runProbes(ctx({ progress: '1/20', tasks_left: '3' }), defs, { retry: 0 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.state, { done: 1, total: 20, tasksLeft: 3 });
});

test('invalid observations retry even when the progress denominator is positive', async () => {
  let calls = 0;
  const context = ctx(null);
  context.agent.aiQuery = async () => (++calls === 1
    ? { progress: '1/20', tasks_left: -1 }
    : { progress: '1/20', tasks_left: 3 });
  const result = await runProbes(context, defs, { retry: 1 });
  assert.equal(calls, 2);
  assert.equal(result.valid, true);
});

test('strict counter parsers never salvage negative, fractional, or unsafe readings', () => {
  for (const value of ['-1/20', '1.5/20', '1/20.5', '21/20', '0/0', '1/9007199254740992']) {
    assert.equal(parseFraction(value), null, value);
  }
  assert.deepEqual(parseFraction('进度 3 / 20 次'), { done: 3, total: 20 });
  assert.equal(parseIntStrict('9007199254740992'), null);
});
