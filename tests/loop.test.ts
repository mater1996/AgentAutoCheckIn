import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { ExecCtx } from '../runner/flow';
import type { TaskLoopOpts } from '../runner/loop';

// Refuse all device access; stub only the I/O boundary, run the real loop/probes.
mock.module(new URL('../runner/adb.ts', import.meta.url).href, {
  exports: { shell: () => { throw new Error('device access forbidden'); }, sleep: async () => {} },
});
mock.module(new URL('../runner/flow.ts', import.meta.url).href, {
  exports: { execSteps: async (_ctx: unknown, steps: any[]) => {
    for (const step of steps) await step.fixture?.();
  } },
});
const loop = await import('../runner/loop');

function fixture(answers: unknown[], extra: Partial<TaskLoopOpts> = {}) {
  let tasks = 0;
  let collects = 0;
  let reads = 0;
  const ctx: ExecCtx = {
    agent: { aiQuery: async () => answers[Math.min(reads++, answers.length - 1)] },
    seq: 0, stage: 'test', balanceBefore: null, balanceAfter: null, stepsDone: 0,
    failed: [], overBudget: () => false, log: () => {},
  };
  const opts: TaskLoopOpts = {
    objective: { strategy: 'fixed', fixedCount: 10, maxSeconds: 900 },
    valueModel: { unitReward: 1, unitSeconds: 10, tiers: [{ at: 2, reward: 10 }] },
    cnyPerUnit: 0.01, probes: [{ id: 'current', ask: 'fixture', parse: 'json' }],
    tasks: [{ name: 'fixture', kind: 'test', times: 2, yaml: 'fixture.yaml' }],
    runTask: async () => { tasks++; return { ok: true }; },
    collectSteps: [{ fixture: () => { collects++; } }], collectWhen: 'always',
    entryRetries: 0, t0: Date.now(), hardMax: 2, ...extra,
  };
  return { ctx, opts, counts: () => ({ tasks, collects, reads }) };
}
const valid = { progress: '1/20', tasks_left: 3 };

test('ensurePanel false prevents task execution and initial collection', async () => {
  const f = fixture([valid], { ensurePanel: async () => false });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 0);
  assert.equal(f.counts().collects, 0);
  assert.equal(result.rounds, 0);
  assert.deepEqual(result.ran, []);
  assert.match(result.stopReason, /观测失败.*面板/);
});

test('ensurePanel throwing is a prerequisite failure with an explicit reason', async () => {
  const f = fixture([valid], { ensurePanel: async () => { throw new Error('fixture failure'); } });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 0);
  assert.match(result.stopReason, /观测失败.*面板/);
});

test('panel failure after entry does not consume a queued task', async () => {
  let checks = 0;
  const f = fixture([valid], { collectWhen: 'never', ensurePanel: async () => ++checks === 1 });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 0);
  assert.equal(result.rounds, 0);
  assert.deepEqual(result.ran, []);
  assert.match(result.stopReason, /观测失败.*面板/);
});

test('failed observation after a task cannot trigger another task or tier collection', async () => {
  const f = fixture([valid, { progress: '2/20', tasks_left: -1 }]);
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 1);
  assert.equal(f.counts().collects, 1); // only initial collection
  assert.match(result.stopReason, /观测失败/);
  assert.doesNotMatch(result.stopReason, /无剩余|完成全部|无进展|硬上限/);
  assert.equal(result.finalState.tasksLeft, -1);
});

test('popup recovery that loses observation stops before cross-tier collection', async () => {
  const f = fixture([valid, valid, { progress: '2/20', tasks_left: -1 }], {
    recoverPopup: async () => ({ tried: true, closed: true, detail: 'fixture' }),
  });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 1);
  assert.equal(f.counts().collects, 1);
  assert.match(result.stopReason, /观测失败/);
});

test('one bounded recovery can restore observation before the next task', async () => {
  let recoveries = 0;
  const f = fixture([valid, { progress: '2/20', tasks_left: -1 }], {
    collectWhen: 'never',
    recoverSteps: [{ fixture: () => { recoveries++; f.ctx.agent.aiQuery = async () => valid; } }],
  });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(recoveries, 1);
  assert.equal(f.counts().tasks, 2);
  assert.doesNotMatch(result.stopReason, /观测失败/);
});

test('cross-tier predicate rejects either unknown observation', () => {
  const crossedTier = (loop as any).crossedTier;
  assert.equal(typeof crossedTier, 'function');
  const before = { done: 1, total: 20, tasksLeft: 3 };
  const after = { done: 2, total: 20, tasksLeft: 2 };
  const vm = { unitReward: 0, unitSeconds: 10, tiers: [{ at: 2, reward: 10 }] };
  assert.equal(crossedTier(before, after, vm), true);
  assert.equal(crossedTier({ ...before, tasksLeft: -1 }, after, vm), false);
  assert.equal(crossedTier(before, { ...after, tasksLeft: -1 }, vm), false);
});

test('initial unknown observation exhausts bounded recovery without actions', async () => {
  let recoveries = 0;
  const f = fixture([{ progress: '20/20' }], {
    recoverSteps: [{ fixture: () => { recoveries++; } }],
  });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 0);
  assert.equal(f.counts().collects, 0);
  assert.equal(f.counts().reads, 6); // two probe batches, three attempts each
  assert.equal(recoveries, 1);
  assert.match(result.stopReason, /观测失败/);
});

test('observation failure on the hard limit preserves the observation stop reason', async () => {
  const f = fixture([valid, { progress: '2/20', tasks_left: -1 }], { hardMax: 1 });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 1);
  assert.match(result.stopReason, /观测失败/);
  assert.doesNotMatch(result.stopReason, /硬上限/);
});

test('recovery step failure returns an observation failure instead of escaping the loop', async () => {
  const f = fixture([valid, { progress: '2/20', tasks_left: -1 }], {
    recoverSteps: [{ fixture: () => { throw new Error('recovery fixture failure'); } }],
  });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 1);
  assert.equal(f.counts().collects, 1);
  assert.match(result.stopReason, /观测失败/);
  assert.ok(f.ctx.failed.some((message) => message.includes('recovery fixture failure')));
});

test('independent task quota reduction is progress while the reward counter stays saturated', async () => {
  let popupRecoveries = 0;
  const f = fixture([4, 3, 2, 1, 0].map((n) => ({ progress: '20/20', tasks_left: n })), {
    objective: { strategy: 'all_tiers', maxSeconds: 900 },
    tasks: [{ name: 'fixture', kind: 'test', times: 4, yaml: 'fixture.yaml' }],
    hardMax: 5, collectWhen: 'never',
    recoverPopup: async () => {
      popupRecoveries++;
      return { tried: true, closed: false, detail: 'unexpected' };
    },
  });
  const result = await loop.runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().tasks, 4);
  assert.equal(result.finalState.done, 20);
  assert.equal(result.finalState.tasksLeft, 0);
  assert.equal(popupRecoveries, 0);
  assert.match(result.stopReason, /已无剩余任务/);
});
