import assert from 'node:assert/strict';
import test from 'node:test';
import { openTaskDestination } from '../runner/task-opening';
const task = { name: '实际任务', instruction: '浏览', quota: '0/5' };
const panel = { pageIsTaskPanel: true, blocked: false, destinationShown: false, targetName: task.name, targetInstruction: task.instruction, targetQuota: task.quota };
const destination = { pageIsTaskPanel: false, blocked: false, destinationShown: true, pageIdentity: '真实结果页' };
function fixture(readings: any[]) {
  const events: string[] = [];
  const agent = { aiTap: async (_prompt: string) => { events.push('tap'); } };
  const observe = async () => { events.push('read'); return readings.shift(); };
  return { agent, observe, events };
}
test('single taps and independent reads can recover one confirmed unchanged exact row', async () => {
  const f = fixture([panel, destination]);
  const r = await openTaskDestination(f.agent, task, { observe: f.observe });
  assert.equal(r.observation, destination);
  assert.deepEqual(f.events, ['tap', 'read', 'tap', 'read']);
});
test('only one retry and no composite action', async () => {
  const f = fixture([panel, panel, destination]);
  await assert.rejects(openTaskDestination(f.agent, task, { observe: f.observe }), /两次|未打开/);
  assert.deepEqual(f.events, ['tap', 'read', 'tap', 'read']);
});
test('unknown blocked changed and unrelated pages never permit retry', async () => {
  for (const raw of [null, { ...panel, blocked: true }, { ...panel, targetQuota: '1/5' }, { ...panel, targetInstruction: '新要求' }, { ...destination, destinationShown: false }]) {
    const f = fixture([raw, destination]);
    await assert.rejects(openTaskDestination(f.agent, task, { observe: f.observe }));
    assert.deepEqual(f.events, ['tap', 'read']);
  }
});
test('tap errors stay errors and never retry unknown side effects', async () => {
  const f = fixture([destination]);
  f.agent.aiTap = async () => { f.events.push('tap'); throw new Error('transport failed'); };
  await assert.rejects(openTaskDestination(f.agent, task, { observe: f.observe }), /transport failed/);
  assert.deepEqual(f.events, ['tap']);
});
test('budget stops dependent tapping', async () => {
  const f = fixture([panel]); let checks = 0;
  await assert.rejects(openTaskDestination(f.agent, task, { observe: f.observe, overBudget: () => ++checks > 1 }), /预算/);
  assert.deepEqual(f.events, ['tap', 'read']);
});
