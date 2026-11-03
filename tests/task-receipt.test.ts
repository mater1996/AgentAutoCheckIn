import assert from 'node:assert/strict';
import test from 'node:test';
import * as receipt from '../runner/task-receipt';

const target = { name: '目标任务', instruction: '浏览5秒' };
const config = { taskName: target.name, instruction: target.instruction, destination: '精选商品' };
const entered = { pageIsTaskPanel: false, blocked: false, pageIdentity: '精选商品' };
const completed = { ...entered, completionText: '任务完成，可返回' };

test('configured exact completion variants accept live page identity and reject substring or punctuation guesses', () => {
  const attempt = receipt.createTaskAttempt(target);
  const state = receipt.createTaskReceiptState(attempt);
  const config = { taskName: target.name, instruction: target.instruction, destination: '拍立淘商品搜索结果页' };
  const raw = { pageIdentity: config.destination, pageIsTaskPanel: false, blocked: false, completionText: '任务已完成 继续逛逛吧', rewardText: '' };
  receipt.recordTaskEntered(state, config, raw);
  const completion = { ...config, completionMarker: ['任务已完成 继续逛逛吧', '任务已完成，继续逛逛吧'] };
  assert.equal(receipt.isValidTaskReceipt(receipt.recordTaskReceipt(state, completion, raw), attempt), true);
  const equivalentPage = { ...raw, pageIdentity: '找到以下宝贝，下方商品搜索结果列表', destinationShown: true };
  assert.equal(receipt.isValidTaskReceipt(receipt.recordTaskReceipt(state, completion, equivalentPage), attempt), true);
  assert.throws(() => receipt.recordTaskReceipt(state, completion, { ...raw, completionText: '已完成' }));
  assert.throws(() => receipt.recordTaskReceipt(state, completion, { ...raw, completionText: '任务已完成,继续逛逛吧' }));
});

test('completion receipt binds exact selected identity and retains raw destination and completion observations', () => {
  const attempt = receipt.createTaskAttempt(target);
  const state = receipt.createTaskReceiptState(attempt);
  receipt.recordTaskEntered(state, config, entered, attempt.startedAt);
  const result = receipt.recordTaskReceipt(state, { ...config, completionMarker: '任务完成，可返回' }, completed, attempt.startedAt + 1);
  assert.equal(receipt.isValidTaskReceipt(result, attempt), true);
  assert.deepEqual(result.entered.raw, entered);
  assert.deepEqual(result.raw, completed);
  assert.equal(result.name, target.name);
  assert.equal(result.instruction, target.instruction);
  assert.equal(result.attemptId, attempt.attemptId);
});

test('panel completion, missing/partial markers, blocked and absent destinations cannot issue receipts', () => {
  for (const raw of [
    { ...completed, pageIsTaskPanel: true, completionText: '已完成' },
    { ...completed, completionText: '' }, { ...completed, completionText: '已完成' },
    { ...completed, blocked: true }, { ...completed, pageIdentity: '' },
    { ...completed, pageIdentity: '另一个商品页' },
  ]) {
    const state = receipt.createTaskReceiptState(receipt.createTaskAttempt(target));
    receipt.recordTaskEntered(state, config, entered);
    assert.throws(() => receipt.recordTaskReceipt(state, { ...config, completionMarker: '任务完成，可返回' }, raw));
    assert.equal(state.receipt, undefined);
    assert.deepEqual(state.observations.at(-1)?.raw, raw);
  }
});

test('receipt needs prior entry, exact configured identity, ordered timestamps and matching attempt', () => {
  const attempt = receipt.createTaskAttempt(target);
  const state = receipt.createTaskReceiptState(attempt);
  const completionConfig = { ...config, completionMarker: '任务完成，可返回' };
  assert.throws(() => receipt.recordTaskReceipt(state, completionConfig, completed));
  for (const wrong of [{ ...config, taskName: '其他任务' }, { ...config, instruction: '浏览15秒' }]) {
    assert.throws(() => receipt.recordTaskEntered(state, wrong, entered));
  }
  receipt.recordTaskEntered(state, config, entered, attempt.startedAt + 2);
  assert.throws(() => receipt.recordTaskReceipt(state, completionConfig, completed, attempt.startedAt + 1));
  const result = receipt.recordTaskReceipt(state, completionConfig, completed, attempt.startedAt + 3);
  assert.equal(receipt.isValidTaskReceipt(result, { ...attempt, attemptId: 'previous' }), false);
  assert.equal(receipt.isValidTaskReceipt(result, { ...attempt, name: '其他任务' }), false);
  assert.equal(receipt.isValidTaskReceipt(result, { ...attempt, instruction: '浏览15秒' }), false);
  assert.equal(receipt.isValidTaskReceipt({ ...result, observedAt: attempt.startedAt - 1 }, attempt), false);
});

import fs from 'node:fs';
import path from 'node:path';
import { runWorkflowFile } from '../runner/workflow';
const yaml = `cases:
  - name: receipt
    steps:
      - taskEntered: { taskName: 目标任务, instruction: 浏览5秒, destination: 精选商品 }
      - taskReceipt: { taskName: 目标任务, instruction: 浏览5秒, destination: 精选商品, completionMarker: '任务完成，可返回' }
      - wait: { duration: 1, unit: ms }
`;
test('workflow nodes capture raw receipt before subsequent navigation and never reuse state across workflows', async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR!, 'receipt-'));
  try {
    const file = path.join(dir, 'task.yaml'); fs.writeFileSync(file, yaml);
    let queries = 0;
    const attempt = receipt.createTaskAttempt(target);
    const agent: any = { aiQuery: async () => (++queries === 1 ? entered : completed) };
    const result = await runWorkflowFile(file, agent, { serial: 'offline', screen: { w: 1, h: 1 }, taskAttempt: attempt });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.steps[1].node, 'taskReceipt');
    assert.equal(receipt.isValidTaskReceipt(result.taskReceipt, attempt), true);
    assert.equal(result.taskEvidence?.observations.length, 2);
    fs.writeFileSync(file, 'cases:\n  - name: no receipt\n    steps:\n      - wait: { duration: 1, unit: ms }\n');
    const next = await runWorkflowFile(file, agent, { serial: 'offline', screen: { w: 1, h: 1 }, taskAttempt: receipt.createTaskAttempt(target), taskEvidence: result.taskEvidence } as any);
    assert.equal(next.taskReceipt, undefined);
    assert.deepEqual(next.taskEvidence?.observations, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
