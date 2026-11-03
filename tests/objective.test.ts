import assert from 'node:assert/strict';
import test from 'node:test';
import * as objective from '../runner/objective';
import type { ProbeState } from '../runner/objective';

const obj = { strategy: 'fixed', fixedCount: 30, maxSeconds: 900 } as const;
const vm = { unitReward: 1, unitSeconds: 10, tiers: [{ at: 20, reward: 100 }] };

test('unknown or malformed observations cannot imply completion or no remaining tasks', () => {
  for (const state of [
    { done: 0, total: 0, tasksLeft: -1 },
    { done: 20, total: 20, tasksLeft: -1 },
    { done: 0, total: 20, tasksLeft: NaN },
    { done: NaN, total: 20, tasksLeft: 0 },
    { done: 0, total: Infinity, tasksLeft: 2 },
    { done: -1, total: 20, tasksLeft: 2 },
    { done: 21, total: 20, tasksLeft: 2 },
    { done: 0.5, total: 20, tasksLeft: 2 },
    { done: 0, total: 20.5, tasksLeft: 2 },
    { done: 0, total: 20, tasksLeft: 1.5 },
  ]) {
    const plan = objective.computePlan(state, obj, vm, 0.01, 0);
    assert.equal(plan.shouldContinue, false, JSON.stringify(state));
    assert.match(plan.reason, /观测.*无效|探测失败/, JSON.stringify(state));
    assert.equal(plan.currentUnits, 0);
    assert.equal(plan.currentCny, 0);
    assert.equal(plan.marginalPerHour, null);
  }
});

test('pure observation validator is usable by callers with untrusted input', () => {
  const isValid = (objective as any).isValidProbeState as (state: unknown) => state is ProbeState;
  assert.equal(typeof isValid, 'function');
  assert.equal(isValid({ done: 0, total: 20, tasksLeft: 0 }), true);
  assert.equal(isValid({ done: 20, total: 20, tasksLeft: 3 }), true);
  for (const value of [null, undefined, {}, { done: '0', total: 20, tasksLeft: 1 },
    { done: 0, total: 0, tasksLeft: 0 }, { done: 0, total: 20, tasksLeft: Infinity }]) {
    assert.equal(isValid(value), false);
  }
});

test('reward threshold does not count as exhausted task quota', () => {
  const plan = objective.computePlan({ done: 20, total: 20, tasksLeft: 3 }, obj, vm, 0.01, 0);
  assert.equal(plan.shouldContinue, true);
  assert.equal(plan.roundsRemaining, 3);
  assert.doesNotMatch(plan.reason, /全部进度/);
});

test('all_tiers continues at saturated progress within its marginal and time budgets', () => {
  const state = { done: 20, total: 20, tasksLeft: 3 };
  const strategy = { strategy: 'all_tiers', maxSeconds: 900 } as const;
  const plan = objective.computePlan(state, strategy, vm, 0.01, 0);
  assert.equal(plan.shouldContinue, true);
  assert.equal(plan.roundsRemaining, 3);
  assert.equal(objective.computePlan(state, { ...strategy, minMarginalCnyPerHour: 100 }, vm, 0.01, 0).shouldContinue, false);
  assert.equal(objective.computePlan(state, strategy, vm, 0.01, 895).shouldContinue, false);
});
