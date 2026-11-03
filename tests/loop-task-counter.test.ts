import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
mock.module(new URL('../runner/adb.ts', import.meta.url).href, { exports: { shell: () => { throw new Error('no device'); }, sleep: async () => {} } });
mock.module(new URL('../runner/flow.ts', import.meta.url).href, { exports: { execSteps: async () => {} } });
const { runTaskLoop } = await import('../runner/loop');
test('unknown selected-task quota stops before any action', async () => {
  let actions = 0;
  const ctx: any = { agent: { aiQuery: async () => ({ progress: '20/20', tasks_left: 4 }) }, failed: [], log: () => {}, overBudget: () => false };
  const result = await runTaskLoop(ctx, { objective: { strategy: 'all_tiers', maxSeconds: 60 }, valueModel: { unitReward: 30, unitSeconds: 5, tiers: [] }, cnyPerUnit: .01, probes: [{ id: 'state', ask: 'x', parse: 'json' }], tasks: [{ name: 'x', kind: 'test', times: 1, yaml: 'x' }], runTask: async () => { actions++; return { ok: true }; }, observeTask: async () => null, entryRetries: 0, t0: Date.now() });
  assert.equal(actions, 0);
  assert.match(result.stopReason, /观测失败/);
});

function counterFixture(counters: any[], extra: any = {}) {
  let actions = 0;
  let observations = 0;
  let popups = 0;
  const ctx: any = { agent: { aiQuery: async () => ({ progress: '20/20', tasks_left: 5 }) }, failed: [], log: () => {}, overBudget: () => false };
  const opts: any = {
    objective: { strategy: 'all_tiers', maxSeconds: 60 },
    valueModel: { unitReward: 20, unitSeconds: 5, tiers: [] }, cnyPerUnit: .01,
    probes: [{ id: 'state', ask: 'fixture', parse: 'json' }],
    tasks: [{ name: '拍立淘', kind: 'test', times: 4, yaml: 'fixture.yaml' }],
    runTask: async () => { actions++; return { ok: true }; },
    observeTask: async () => counters[Math.min(observations++, counters.length - 1)],
    recoverPopup: async () => { popups++; return { tried: true, closed: false, detail: 'fixture' }; },
    entryRetries: 0, t0: Date.now(), hardMax: 4, ...extra,
  };
  return { ctx, opts, counts: () => ({ actions, observations, popups }) };
}
const counter = (done: number) => ({ name: '拍立淘', done, total: 5 });

import { recordTaskEntered, recordTaskReceipt, createTaskReceiptState } from '../runner/task-receipt';
function receiptRunner(override?: (attempt: any) => any) {
  return async (_yaml: string, _unit: any, attempt: any) => {
    const state = createTaskReceiptState(attempt);
    const config = { taskName: attempt.name, instruction: attempt.instruction, destination: '目的页' };
    const raw = { pageIsTaskPanel: false, blocked: false, pageIdentity: '目的页' };
    recordTaskEntered(state, config, raw);
    const taskReceipt = recordTaskReceipt(state, { ...config, completionMarker: '任务已完成' }, { ...raw, completionText: '任务已完成' });
    return { ok: true, taskReceipt: override ? override(taskReceipt) : taskReceipt, taskEvidence: state };
  };
}
const absent = { name: '拍立淘', absent: true, pageIsTaskPanel: true };
test('disappeared known target requires fresh completion receipt captured inside its workflow', async () => {
  const f = counterFixture([counter(4), absent], {
    tasks: [{ name: '拍立淘', instruction: '浏览5秒', kind: 'test', times: 1, yaml: 'fixture.yaml' }],
    runTask: receiptRunner(),
  });
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.deepEqual(result.ran, [{ name: '拍立淘', times: 1, ok: 1, fail: 0 }]);
  assert.deepEqual(f.ctx.failed, []);
  assert.equal(result.taskEvidence[0].verification, 'receipt');
  assert.equal(result.taskEvidence[0].workflow.taskReceipt.raw.completionText, '任务已完成');
});

test('receipt never overrides unchanged quota, unknown observation, or wrong task/attempt', async () => {
  for (const [after, runner] of [
    [counter(4), receiptRunner()], [null, receiptRunner()],
    [absent, receiptRunner((r) => ({ ...r, attemptId: 'previous' }))],
    [absent, receiptRunner((r) => ({ ...r, name: '邻居任务' }))],
    [absent, receiptRunner((r) => ({ ...r, instruction: '浏览15秒' }))],
    [absent, async () => ({ ok: true })],
  ] as const) {
    const f = counterFixture([counter(4), after], {
      tasks: [{ name: '拍立淘', instruction: '浏览5秒', kind: 'test', times: 1, yaml: 'fixture.yaml' }], runTask: runner,
    });
    const result = await runTaskLoop(f.ctx, f.opts);
    assert.equal(result.ran[0].ok, 0);
    assert.equal(result.ran[0].fail, 1);
    assert.match(result.stopReason, /观测失败|任务无效果/);
  }
});

test('independent same-task quota growth continues with saturated reward and unchanged aggregate', async () => {
  const f = counterFixture([counter(0), counter(1), counter(1), counter(2), counter(2), counter(3), counter(3), counter(4)]);
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.deepEqual(f.counts(), { actions: 4, observations: 8, popups: 0 });
  assert.equal(result.finalState.done, 20);
  assert.deepEqual(result.ran, [{ name: '拍立淘', times: 4, ok: 4, fail: 0 }]);
  assert.deepEqual(f.ctx.failed, []);
});

test('successful navigation with unchanged selected-task quota is a failure and stops the queue', async () => {
  const f = counterFixture([counter(1), counter(1)]);
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().actions, 1);
  assert.match(result.stopReason, /任务无效果/);
  assert.deepEqual(result.ran, [{ name: '拍立淘', times: 1, ok: 0, fail: 1 }]);
  assert.match(f.ctx.failed.join(' '), /配额未增长/);
});

test('another task counter cannot confirm the selected task', async () => {
  const f = counterFixture([counter(1), { ...counter(2), name: '邻居任务' }]);
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(f.counts().actions, 1);
  assert.match(result.stopReason, /观测失败/);
  assert.equal(result.ran[0].fail, 1);
});

test('independent task progress still obeys the supervised hard limit', async () => {
  const f = counterFixture([counter(1), counter(2)], { hardMax: 1 });
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.deepEqual(f.counts(), { actions: 1, observations: 2, popups: 0 });
  assert.equal(result.rounds, 1);
  assert.match(result.stopReason, /硬上限 1/);
});
