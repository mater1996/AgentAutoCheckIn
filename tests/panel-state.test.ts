import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureTaskPanel } from '../runner/panel-state';

const panel = { pageIsTaskPanel: true, blocked: false, pageIdentity: '任务列表：任务配额和操作按钮可见' };
const landing = { pageIsTaskPanel: false, blocked: false, pageIdentity: '活动首页' };

function setup(observations: unknown[]) {
  const prompts: string[] = [];
  let recoveries = 0;
  const agent = {
    aiQuery: async (prompt: string) => {
      prompts.push(prompt);
      const value = observations[prompts.length - 1];
      if (value instanceof Error) throw value;
      return value;
    },
    aiAct: async () => { assert.fail('helper must delegate all navigation to recover'); },
    aiBack: async () => { assert.fail('helper must not navigate back itself'); },
  };
  const recover = async () => { recoveries++; };
  return { agent, recover, prompts, recoveries: () => recoveries };
}

test('an already visible task panel is queried once and never recovered', async () => {
  const state = setup([panel]);
  assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), true);
  assert.equal(state.prompts.length, 1);
  assert.equal(state.recoveries(), 0);
  const prompt = state.prompts[0];
  for (const field of ['pageIsTaskPanel', 'blocked', 'pageIdentity']) assert.ok(prompt.includes(field));
  assert.match(prompt, /配额/);
  assert.match(prompt, /按钮/);
  assert.match(prompt, /活动首页/);
  assert.match(prompt, /面板本身.*不是.*blocked/);
});

test('a confirmed unblocked activity landing recovers once and requires a fresh panel observation', async () => {
  const state = setup([landing, panel]);
  assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), true);
  assert.equal(state.recoveries(), 1);
  assert.equal(state.prompts.length, 2);
});

test('a failed recovery observation stops without a second recovery', async () => {
  for (const raw of [landing, { ...panel, blocked: true }, null, { blocked: false }]) {
    const state = setup([landing, raw, panel]);
    assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), false);
    assert.equal(state.recoveries(), 1);
    assert.equal(state.prompts.length, 2);
  }
});

test('blocked and ambiguous observations cause no recovery or navigation', async () => {
  for (const raw of [null, undefined, {}, [], 'unknown',
    { ...landing, blocked: true }, { ...panel, blocked: true },
    { pageIsTaskPanel: false }, { pageIsTaskPanel: true }, { blocked: false },
    { ...landing, pageIsTaskPanel: null }, { ...landing, pageIsTaskPanel: 'false' },
    { ...panel, pageIsTaskPanel: 'true' }, { ...landing, blocked: 'false' },
    { ...panel, blocked: null }, { ...landing, blocked: 0 }]) {
    const state = setup([raw]);
    assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), false);
    assert.equal(state.recoveries(), 0);
    assert.equal(state.prompts.length, 1);
  }
});

test('an unblocked non-panel without a configured recovery returns false', async () => {
  const state = setup([landing]);
  assert.equal(await ensureTaskPanel(state.agent, {}), false);
  assert.equal(state.prompts.length, 1);
});

test('query errors return false without recovery', async () => {
  const state = setup([new Error('offline query failure')]);
  assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), false);
  assert.equal(state.recoveries(), 0);
  assert.equal(state.prompts.length, 1);
});

test('recovery errors return false without another query', async () => {
  const state = setup([landing, panel]);
  let attempts = 0;
  assert.equal(await ensureTaskPanel(state.agent, { recover: async () => {
    attempts++;
    throw new Error('configured entry failed');
  } }), false);
  assert.equal(attempts, 1);
  assert.equal(state.prompts.length, 1);
});

test('a query error after recovery returns false without retrying', async () => {
  const state = setup([landing, new Error('offline query failure'), panel]);
  assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover }), false);
  assert.equal(state.recoveries(), 1);
  assert.equal(state.prompts.length, 2);
});

test('an exhausted budget stops before the initial query', async () => {
  const state = setup([panel]);
  assert.equal(await ensureTaskPanel(state.agent, { recover: state.recover, overBudget: () => true }), false);
  assert.equal(state.prompts.length, 0);
  assert.equal(state.recoveries(), 0);
});

test('budget exhaustion during the initial query stops before recovery or success', async () => {
  for (const raw of [landing, panel]) {
    const state = setup([raw]);
    let expired = false;
    const agent = { aiQuery: async (prompt: string) => {
      const result = await state.agent.aiQuery(prompt);
      expired = true;
      return result;
    } };
    assert.equal(await ensureTaskPanel(agent, { recover: state.recover, overBudget: () => expired }), false);
    assert.equal(state.prompts.length, 1);
    assert.equal(state.recoveries(), 0);
  }
});

test('budget exhaustion during recovery stops before the second query', async () => {
  const state = setup([landing, panel]);
  let expired = false;
  assert.equal(await ensureTaskPanel(state.agent, {
    recover: async () => { await state.recover(); expired = true; },
    overBudget: () => expired,
  }), false);
  assert.equal(state.prompts.length, 1);
  assert.equal(state.recoveries(), 1);
});

test('budget exhaustion during the recovered query cannot report success', async () => {
  const state = setup([landing, panel]);
  let expired = false;
  const agent = { aiQuery: async (prompt: string) => {
    const result = await state.agent.aiQuery(prompt);
    if (state.prompts.length === 2) expired = true;
    return result;
  } };
  assert.equal(await ensureTaskPanel(agent, { recover: state.recover, overBudget: () => expired }), false);
  assert.equal(state.prompts.length, 2);
  assert.equal(state.recoveries(), 1);
});
