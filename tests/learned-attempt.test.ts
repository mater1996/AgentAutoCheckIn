import assert from 'node:assert/strict';
import test from 'node:test';
import * as learning from '../runner/task-learning';
import { createTaskAttempt, isValidTaskReceipt } from '../runner/task-receipt';

const task = { name: '实际任务', instruction: '按目的页说明操作', quota: '0/1', reward: 30 };
const markers = ['任务已完成，继续逛逛吧', '任务已完成 继续逛逛吧'];
const entry = { pageIdentity: ' 搜索结果 · 实际页面 ', destinationShown: true, pageIsTaskPanel: false, blocked: false,
  instructions: '搜索屏幕显示的关键词，浏览结果直到出现完成提示', completionMarkers: ['搜索并浏览后可完成'] };
const completion = { pageIdentity: entry.pageIdentity, destinationShown: true, pageIsTaskPanel: false, blocked: false, completionText: markers[0] };

test('a confirmed unchanged exact task row permits one bounded opening retry', async () => {
  const unchanged = { pageIdentity: '任务面板', pageIsTaskPanel: true, blocked: false,
    destinationShown: false, targetName: task.name, targetInstruction: task.instruction, targetQuota: task.quota };
  const f = fixture([unchanged, entry, completion]);
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'tap:1', 'query:1', 'act:0', 'query:2', 'return']);
});

test('text input requires observed focus and exact entered text before submitting', async () => {
  const f = fixture([{ ...entry, inputRequired: true, inputValue: '麦片', inputTarget: '搜索框', submitTarget: '搜索' },
    { inputFocused: true, keyboardShown: true }, { inputText: '' }]);
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, false);
  assert.match(result.error!, /输入未确认/);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'act:0', 'query:1', 'act:1', 'query:2'], 'open, focus, input only; no submit or browse');
  assert.equal(f.events.includes('return'), false);
});

test('confirmed focus, exact input and loaded results permit completion', async () => {
  const f = fixture([{ ...entry, inputRequired: true, inputValue: '麦片', inputTarget: '搜索框', submitTarget: '搜索' },
    { inputFocused: true, keyboardShown: true }, { inputText: '麦片' },
    { resultsShown: true, blocked: false, inputText: '麦片' }, completion]);
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, true, result.error);
  assert.equal(isValidTaskReceipt(result.taskReceipt, f.attempt), true);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'act:0', 'query:1', 'act:1', 'query:2', 'act:2', 'query:3', 'act:3', 'query:4', 'return']);
});

test('an explicit completion already observed on entry needs no second action', async () => {
  const f = fixture([{ ...entry, completionMarkers: [markers[0]] }, completion]);
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'query:1', 'return']);
  assert.equal(isValidTaskReceipt(result.taskReceipt, f.attempt), true);
});

function fixture(observations: unknown[] = [entry, completion], actions?: (index: number) => Promise<void>, taps?: (index: number) => Promise<void>) {
  const events: string[] = [];
  const prompts: string[] = [];
  const attempt = createTaskAttempt(task);
  let queryIndex = 0;
  let actionIndex = 0;
  let tapIndex = 0;
  const agent = {
    aiTap: async (prompt: string) => { events.push(`tap:${tapIndex}`); prompts.push(prompt); const index = tapIndex++; await taps?.(index); },
    aiAct: async (prompt: string) => { events.push(`act:${actionIndex}`); prompts.push(prompt); const index = actionIndex++; await actions?.(index); },
    aiQuery: async (prompt: string) => { events.push(`query:${queryIndex}`); prompts.push(prompt); return observations[queryIndex++]; },
  };
  const options = { completionMarkers: markers, returnToPanel: async () => { events.push('return'); return true; } };
  return { agent, options, attempt, events, prompts };
}

test('unlearned task records an exact same-attempt receipt before returning', async () => {
  assert.equal(typeof learning.executeUnlearnedTask, 'function', 'staged unlearned executor is exported');
  const f = fixture();
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, true, result.error);
  assert.equal(isValidTaskReceipt(result.taskReceipt, f.attempt), true);
  assert.equal(result.taskReceipt?.destination, entry.pageIdentity, 'raw page identity is preserved');
  assert.equal(result.taskReceipt?.raw.completionText, markers[0]);
  assert.equal(result.taskEvidence?.observations.length, 2);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'act:0', 'query:1', 'return']);
  assert.match(f.prompts[0], /只打开/);
  assert.match(f.prompts[0], /不执行目的页动作/);
  assert.ok(f.prompts[0].includes(JSON.stringify(task)), 'opening targets the exact task row');
  assert.match(f.prompts[2], /搜索屏幕显示的关键词/);
  assert.match(f.prompts[2], /不要返回/);
});

test('opening tap exceptions stop before observations, execution, or receipt settlement', async () => {
  const f = fixture([entry, completion], undefined, async () => { throw new Error('tap-failed'); });
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, false);
  assert.match(result.error!, /tap-failed/);
  assert.deepEqual(f.events, ['tap:0'], 'a failed tap cannot authorize a retry or dependent action');
  assert.equal(result.taskReceipt, undefined);
  assert.deepEqual(result.taskEvidence?.observations, []);
});

test('execution exceptions preserve failure while capturing precise completion evidence', async () => {
  const f = fixture([entry, completion], async () => { throw new Error('execution-failed'); });
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, false);
  assert.match(result.error!, /execution-failed/);
  assert.equal(isValidTaskReceipt(result.taskReceipt, f.attempt), true);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'act:0', 'query:1', 'return'], 'only read-only settlement and bounded return follow the exception');
});


test('blocked, unchanged panel, or uncertain entry never executes or returns', async () => {
  for (const raw of [null, { ...entry, blocked: true }, { ...entry, pageIsTaskPanel: true }, { ...entry, destinationShown: false }, { ...entry, pageIdentity: '' }]) {
    const f = fixture([raw, completion]);
    const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
    assert.equal(result.ok, false);
    assert.match(result.error!, /打开任务后页面\/身份未知或存在阻挡/);
    assert.deepEqual(f.events, ['tap:0', 'query:0']);
    assert.equal(result.taskReceipt, undefined);
    assert.deepEqual(result.taskEvidence?.observations, [], 'rejected opening facts cannot establish task entry');
  }
});

test('wrong or unrelated completion cannot cause return or a valid receipt', async () => {
  for (const raw of [
    { ...completion, completionText: '任务已完成' },
    { ...completion, completionText: '任务已完成,继续逛逛吧' },
    { ...completion, pageIsTaskPanel: true },
    { ...completion, blocked: true },
    { ...completion, pageIdentity: '无关页面', destinationShown: false },
  ]) {
    const f = fixture([entry, raw]);
    const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
    assert.equal(result.ok, false);
    assert.equal(result.taskReceipt, undefined);
    assert.equal(f.events.includes('return'), false);
    assert.equal(result.taskEvidence?.observations[1].phase, 'completion');
  }
});

test('both configured full completion variants work without normalization', async () => {
  for (const completionText of markers) {
    const f = fixture([entry, { ...completion, completionText }]);
    const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
    assert.equal(result.ok, true, result.error);
    assert.equal(result.taskReceipt?.raw.completionText, completionText);
  }
});

test('return failure retains the receipt and propagates failure', async () => {
  const f = fixture();
  f.options.returnToPanel = async () => false;
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, false);
  assert.match(result.error!, /返回任务面板/);
  assert.equal(isValidTaskReceipt(result.taskReceipt, f.attempt), true);
});

test('mismatched attempt and missing receipt policy stop before opening', async () => {
  for (const overrides of [{ name: '旧任务' }, { instruction: '旧说明' }, { attemptId: '' }, { startedAt: -1 }]) {
    const f = fixture();
    const result = await learning.executeUnlearnedTask(f.agent, task, { ...f.attempt, ...overrides }, f.options);
    assert.equal(result.ok, false);
    assert.deepEqual(f.events, []);
  }
  for (const completionMarkers of [[], [''], ['任务已完成', ' ']]) {
    const f = fixture();
    const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, { ...f.options, completionMarkers });
    assert.equal(result.ok, false);
    assert.deepEqual(f.events, []);
  }
});

test('absent observed instructions and criteria never triggers a guessed completion action', async () => {
  const f = fixture([{ ...entry, instructions: '', completionMarkers: [] }, { ...completion, completionText: '' }]);
  const result = await learning.executeUnlearnedTask(f.agent, task, f.attempt, f.options);
  assert.equal(result.ok, false);
  assert.deepEqual(f.events, ['tap:0', 'query:0', 'query:1'], 'missing requirements allow observation only after opening');
  assert.equal(f.events.includes('return'), false);
});

test('budget exhaustion prevents new actions but allows read-only receipt settlement', async () => {
  const f = fixture();
  const initial = await learning.executeUnlearnedTask(f.agent, task, f.attempt, { ...f.options, overBudget: () => true });
  assert.equal(initial.ok, false);
  assert.deepEqual(f.events, []);
  let checks = 0;
  const settling = fixture();
  const result = await learning.executeUnlearnedTask(settling.agent, task, settling.attempt, { ...settling.options, overBudget: () => ++checks > 2 });
  assert.equal(result.ok, false);
  assert.match(result.error!, /预算已耗尽/);
  assert.deepEqual(settling.events, ['tap:0', 'query:0', 'query:1', 'return'], 'budget expires after opening; no execution action is authorized');
  assert.equal(isValidTaskReceipt(result.taskReceipt, settling.attempt), true);
});
