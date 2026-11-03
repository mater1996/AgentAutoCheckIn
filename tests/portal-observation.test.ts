import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractPortalRows, PortalTapAttempt, assessPortalObservation } from '../runner/portal-observation';
import { PortalHttpClient } from '../runner/portal-client';

test('HTTP client state is gated and a Portal rejection stays rejected without a second POST', async () => {
  let posts = 0;
  const client = new PortalHttpClient({ baseUrl: 'http://127.0.0.1:1', token: 'offline-token',
    fetchImpl: async (_url, init) => {
      if (init?.method === 'POST') {
        posts++;
        return new Response(JSON.stringify({ status: 'error', error: 'gesture rejected' }));
      }
      return new Response(JSON.stringify({ status: 'success', result: recordedState() }));
    },
  });
  const state = await client.readState();
  const c = { ...context(), state };
  const target = extractPortalRows(state, rules)[2].button;
  const attempt = new PortalTapAttempt(client);
  await assert.rejects(attempt.tap(target, c), /degraded/);
  assert.equal(posts, 0);
  // Construct only the fresh branch; this does not establish phone freshness.
  c.state = { ...state, degraded: false, degradedReason: '', snapshotAgeMs: 0 };
  assert.equal((await attempt.tap(target, c)).status, 'rejected');
  await assert.rejects(attempt.tap(target, c), /already/);
  assert.equal(posts, 1);
});

test('v0.7.30 normal response needs bounded timing and current target confirmation, without invented age', async () => {
  const state = JSON.parse(fs.readFileSync(new URL('../evidence/portal-freshness-2026-10-31T09-35-20-065Z/sample-2.json', import.meta.url), 'utf8'));
  const target = extractPortalRows(state, rules)[2].button;
  const c = { ...context(), state, capturedAt: 4000, now: 4100, maxAgeMs: 5000,
    portalVersion: '0.7.30', readStartedAt: 1000,
    targetConfirmation: { ...structuredClone(target), confirmedAt: 4050 } };
  const before = JSON.stringify(state);
  assert.equal(assessPortalObservation(c).ok, true);
  let calls = 0;
  const attempt = new PortalTapAttempt({ tap: async () => { calls++; } });
  for (const change of [
    { portalVersion: undefined }, { readStartedAt: undefined }, { readStartedAt: -2000 },
    { capturedAt: 4200 }, { screenConfirmed: false },
    { state: { ...state, degraded: true } },
    { state: { ...state, degradedReason: 'a11y_timeout' } },
  ]) assert.equal(assessPortalObservation({ ...c, ...change }).ok, false);
  for (const confirmation of [undefined, { ...c.targetConfirmation, text: 'another task' },
    { ...c.targetConfirmation, confirmedAt: 2000 },
    { ...c.targetConfirmation, bounds: { ...target.bounds, top: target.bounds.top + 1 } }]) {
    await assert.rejects(attempt.tap(target, { ...c, targetConfirmation: confirmation }));
  }
  assert.equal(calls, 0);
  assert.equal((await attempt.tap(target, c)).status, 'dispatched');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.snapshotAgeMs, undefined);
});

const evidence = new URL('../evidence/portal-readonly-2026-10-31/panel-settled-state.txt', import.meta.url);
function recordedState() {
  return JSON.parse(fs.readFileSync(evidence, 'utf8').split('result=')[1]).result;
}
const rules = {
  panelText: '赚金币抵钱',
  titlePattern: '^(.+)[(]([0-9]+)/([0-9]+)[)]$',
  buttonTexts: ['领取奖励', '去完成', '去逛逛', '逛一逛'],
};

test('recorded Portal tree binds each visible row to its own instruction, quota and button', () => {
  const rows = extractPortalRows(recordedState(), rules);
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.slice(0, 3).map(r => [r.name, r.instruction, r.quota, r.reward, r.button.text]), [
    ['任务到访得金币', '每日来任务面板', '0/1', 10, '领取奖励'],
    ['好物沉浸看', '浏览', '1/5', 35, '去完成'],
    ['抢更多超级秒杀好物', '浏览5秒', '0/1', 20, '去完成'],
  ]);
  assert.deepEqual(rows[2].button.bounds, { left: 853, top: 1199, right: 1034, bottom: 1283 });
  assert.notEqual(rows[1].button.path, rows[2].button.path);
});

test('a single task uses its row rather than absorbing panel headers into requirements', () => {
  const state = recordedState();
  const path = extractPortalRows(state, rules)[2].path.split('/').slice(1).map(Number);
  let row = state.a11y_tree;
  for (const index of path) row = row.children[index];
  state.a11y_tree = { children: [
    { text: rules.panelText, isVisibleToUser: true },
    { text: 'header must not become a task instruction', isVisibleToUser: true,
      boundsInScreen: { left: 1, top: 1, right: 200, bottom: 30 } },
    row,
  ] };
  const rows = extractPortalRows(state, rules);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].instruction, '浏览5秒');
});

test('ambiguous buttons in one task row cannot silently choose one', () => {
  const state = recordedState();
  const rowPath = extractPortalRows(state, rules)[2].path.split('/').slice(1).map(Number);
  let row = state.a11y_tree;
  for (const index of rowPath) row = row.children[index];
  row.children.push(structuredClone(row.children[row.children.length - 1]));
  assert.throws(() => extractPortalRows(state, rules), /ambiguous/);
});

test('invalid task quota is rejected', () => {
  const invalid = recordedState();
  const visit = (n: any) => {
    if (n.text === '好物沉浸看(1/5)') n.text = '好物沉浸看(6/5)';
    for (const child of n.children ?? []) visit(child);
  };
  visit(invalid.a11y_tree);
  assert.throws(() => extractPortalRows(invalid, rules), /quota/);
});

const context = () => ({
  state: { ...recordedState(), degraded: false, degradedReason: '', snapshotAgeMs: 0 },
  capturedAt: 1000, now: 1100, maxAgeMs: 2000,
  expectedPackage: 'com.taobao.taobao', foregroundPackage: 'com.taobao.taobao',
  expectedText: rules.panelText, screenConfirmed: true,
});

test('real timed-out cached tree remains readable evidence but cannot authorize tapping', () => {
  const c = context(); c.state = recordedState();
  const verdict = assessPortalObservation(c);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /degraded|stale/);
});

test('missing age, changed foreground, absent page or unconfirmed screenshot cannot authorize tapping', () => {
  for (const change of [
    { state: { ...context().state, snapshotAgeMs: undefined } },
    { foregroundPackage: 'com.miui.home' }, { expectedText: 'unobserved-page' },
    { screenConfirmed: false }, { now: 4001 },
  ]) assert.equal(assessPortalObservation({ ...context(), ...change }).ok, false);
  assert.equal(assessPortalObservation(context()).ok, true);
});

test('one action dispatch is not business success and cannot be repeated through this attempt', async () => {
  const calls: [number, number][] = [];
  const attempt = new PortalTapAttempt({ tap: async (x, y) => { calls.push([x, y]); } });
  const c = context(), target = extractPortalRows(c.state, rules)[2].button;
  const result = await attempt.tap(target, c);
  assert.equal(result.status, 'dispatched');
  assert.equal(result.businessComplete, false);
  await assert.rejects(attempt.tap(target, c), /already/);
  assert.deepEqual(calls, [[944, 1241]]);
});

test('transport errors after dispatch preserve unknown outcome without automatic retry', async () => {
  let calls = 0;
  const attempt = new PortalTapAttempt({ tap: async () => { calls++; throw Error('network'); } });
  const c = context(), target = extractPortalRows(c.state, rules)[2].button;
  assert.equal((await attempt.tap(target, c)).status, 'unknown');
  await assert.rejects(attempt.tap(target, c), /already/);
  assert.equal(calls, 1);
});

test('stale observations and targets changed or offscreen dispatch nothing', async () => {
  let calls = 0;
  const attempt = new PortalTapAttempt({ tap: async () => { calls++; } });
  const c = context(), target = extractPortalRows(c.state, rules)[2].button;
  for (const [t, ctx] of [
    [target, { ...c, state: recordedState() }],
    [{ ...target, bounds: { ...target.bounds, top: -1 } }, c],
    [{ ...target, path: '0/missing' }, c],
  ] as any[]) await assert.rejects(attempt.tap(t, ctx));
  assert.equal(calls, 0);
});
