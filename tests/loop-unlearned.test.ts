import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createTaskReceiptState, recordTaskEntered, recordTaskReceipt } from '../runner/task-receipt';
mock.module(new URL('../runner/adb.ts', import.meta.url).href, { exports: { shell: () => { throw new Error('no device'); }, sleep: async () => {} } });
let fallbackCalls = 0;
mock.module(new URL('../runner/flow.ts', import.meta.url).href, { exports: { execSteps: async () => { fallbackCalls++; } } });
const { runTaskLoop } = await import('../runner/loop');

function fixture(runUnlearned: any, observeTask?: any) {
  let counter = 0;
  const ctx: any = { agent: { aiQuery: async () => ({ progress: '20/20', tasks_left: 5 }) }, failed: [], stepsDone: 0, log: () => {}, overBudget: () => false };
  const opts: any = {
    objective: { strategy: 'all_tiers', maxSeconds: 60 },
    valueModel: { unitReward: 30, unitSeconds: 5, tiers: [] }, cnyPerUnit: .01,
    probes: [{ id: 'state', ask: 'fixture', parse: 'json' }],
    tasks: [{ name: '任务', instruction: '实际说明', kind: 'observed', times: 3, fallbackSteps: [{}] }],
    runTask: async () => { throw new Error('unexpected yaml'); }, runUnlearned,
    observeTask: observeTask ?? (async () => ({ name: '任务', done: counter++, total: 5 })),
    ensurePanel: async () => true, entryRetries: 0, t0: Date.now(), hardMax: 3,
  };
  return { ctx, opts };
}

test('unlearned callback precedes legacy fallback, persists receipt and counts successful step', async () => {
  const initialFallbackCalls = fallbackCalls;
  let observations = 0;
  const f = fixture(async (unit: any, attempt: any) => {
    const state = createTaskReceiptState(attempt);
    const config = { taskName: unit.name, instruction: unit.instruction, destination: '目的页' };
    const raw = { pageIdentity: '目的页', pageIsTaskPanel: false, blocked: false };
    recordTaskEntered(state, config, raw);
    const receipt = recordTaskReceipt(state, { ...config, completionMarker: '完整完成提示' }, { ...raw, completionText: '完整完成提示' });
    return { ok: true, taskEvidence: state, taskReceipt: receipt };
  }, async () => observations++ ? { name: '任务', absent: true, pageIsTaskPanel: true } : { name: '任务', done: 4, total: 5 });
  f.opts.tasks[0].times = 1;
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(fallbackCalls, initialFallbackCalls);
  assert.equal(result.taskEvidence[0].verification, 'receipt');
  assert.equal(result.taskEvidence[0].workflow?.taskReceipt?.raw.completionText, '完整完成提示');
  assert.equal(f.ctx.stepsDone, 1);
  assert.deepEqual(result.ran, [{ name: '任务', times: 1, ok: 1, fail: 0 }]);
  assert.deepEqual(result.missing, []);
});

test('unlearned callback failure stops queue even when selected quota grows', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return { ok: false, error: 'action failed after landing' }; });
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(calls, 1);
  assert.equal(result.rounds, 1);
  assert.equal(result.taskEvidence[0].verification, 'quota');
  assert.match(result.stopReason, /执行失败.*action failed after landing/);
  assert.equal(result.taskEvidence[0].workflow?.ok, false);
  assert.deepEqual(result.ran, [{ name: '任务', times: 1, ok: 0, fail: 1 }]);
  assert.equal(f.ctx.stepsDone, 0);
});

test('thrown unlearned callback is recorded and stops without fallback', async () => {
  const initialFallbackCalls = fallbackCalls;
  const f = fixture(async () => { throw new Error('callback exploded'); });
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(result.rounds, 1);
  assert.match(result.stopReason, /callback exploded/);
  assert.equal(result.taskEvidence[0].workflow?.ok, false);
  assert.equal(fallbackCalls, initialFallbackCalls);
});

test('failed YAML also stops even when selected quota grows', async () => {
  const f = fixture(undefined);
  f.opts.tasks[0].yaml = 'fixture.yaml';
  f.opts.runTask = async () => ({ ok: false, error: 'yaml failed' });
  const result = await runTaskLoop(f.ctx, f.opts);
  assert.equal(result.rounds, 1);
  assert.match(result.stopReason, /执行失败.*yaml failed/);
});
