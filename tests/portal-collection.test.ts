import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectPortalInventory, type PortalCollectionBridge } from '../runner/portal-collection.ts';
import { PortalHybrid, type HybridObservation } from '../runner/portal-hybrid.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=';
const row = (name = '完整任务名称', overrides = {}) => ({ name, instruction: '浏览15秒', quota: '00/02', reward: null,
  button: { text: '去完成', bounds: { left: 700, top: 900, right: 950, bottom: 1000 } }, ...overrides });
const observation = (overrides = {}): HybridObservation => ({
  id: 'observation', frame: { id: 'frame', dataUrl: `data:image/png;base64,${png}`, width: 1000, height: 2000, capturedAt: 1000 },
  pageIdentity: '赚金币抵钱', blocked: false, balance: 100, progress: '5/20', rows: [row()],
  scrollBounds: { left: 100, top: 600, right: 900, bottom: 1800 },
  atTop: true, atBottom: true, boundaryEvidence: { top: '今日进度及第一项任务', bottom: '列表末尾说明' },
  tiers: [{ coin: 100, need: '10次', button: '未达成' }], rowSource: 'vision', portalState: null, ...overrides,
});
function fixture(t: any, observations: HybridObservation[], receipt = 'dispatched') {
  const evidenceDir = fs.mkdtempSync(path.join(process.env.TMPDIR!, 'portal-collection-'));
  t.after(() => fs.rmSync(evidenceDir, { recursive: true, force: true }));
  let reads = 0;
  const swipes: { observation: HybridObservation; params: Parameters<PortalCollectionBridge['swipe']>[1] }[] = [];
  const bridge: PortalCollectionBridge = {
    observe: async () => {
      assert.ok(reads < observations.length, 'Unexpected extra observation');
      const next = structuredClone(observations[reads]);
      next.id = `observation-${++reads}`;
      next.frame.id = `frame-${reads}`;
      return next;
    },
    swipe: async (observation, params) => { swipes.push({ observation, params }); return { status: receipt, businessComplete: false }; },
  };
  return { bridge, evidenceDir, swipes, get reads() { return reads; },
    run: (options = {}) => collectPortalInventory(bridge, { account: 'account', activity: 'activity', evidenceDir, ...options }) };
}

test('one shared observation supplies the first page and preserves raw facts plus PNG evidence', async t => {
  const top = observation();
  const h = fixture(t, [top, top]);
  const result = await h.run();
  assert.equal(result.ok, true, result.detail ?? 'inventory complete');
  assert.equal(h.reads, 2, 'initial top query is cached; return verification uses a fresh observation');
  assert.equal(h.swipes.length, 0);
  assert.equal(result.inventory!.tasks[0].reward, 0);
  assert.equal(result.inventory!.tasks[0].quota, '00/02');
  assert.equal(result.inventory!.tasks[0].at, undefined);
  assert.equal(result.inventory!.account, 'account');
  assert.equal(result.inventory!.source!.evidenceFile, result.evidenceFile);
  const raw = result.pages[0].raw as any;
  assert.equal(raw.tasks[0].button, '去完成');
  assert.equal(raw.source.rowSource, 'vision');
  assert.equal(raw.source.ordinal, 1);
  const saved = JSON.parse(fs.readFileSync(raw.source.observationFile, 'utf8'));
  assert.equal(saved.ordinal, 1);
  assert.equal(saved.observation.rows[0].reward, null, 'unknown reward remains unknown in source');
  assert.equal(saved.observation.frame.id, 'frame-1');
  assert.deepEqual(fs.readFileSync(raw.source.imageFile), Buffer.from(png, 'base64'));
  assert.deepEqual(raw.boundaryEvidence, top.boundaryEvidence);
});

test('bounded top seeking and overlapping page swipes use each latest screenshot region', async t => {
  const middle = observation({ atTop: false, atBottom: false, progress: null, boundaryEvidence: { top: '', bottom: '' } });
  const top = observation({ atBottom: false, boundaryEvidence: { top: '第一行与今日进度', bottom: '' } });
  const bottom = observation({ atTop: false, rows: [row('末尾任务', { reward: 20 })], progress: null,
    scrollBounds: { left: 200, top: 800, right: 800, bottom: 1800 }, boundaryEvidence: { top: '', bottom: '底部帮助说明' }, tiers: [] });
  const h = fixture(t, [middle, top, bottom, bottom, top]);
  const result = await h.run({ maxPages: 2 });
  assert.equal(result.ok, true, result.detail ?? 'inventory complete');
  assert.equal(h.reads, 5, 'each query consumes one observation and each top result is reused');
  assert.deepEqual(result.inventory!.tasks.map(task => task.name), ['完整任务名称', '末尾任务']);
  assert.deepEqual(h.swipes.map(s => s.observation.id), ['observation-1', 'observation-2', 'observation-4']);
  assert.deepEqual(h.swipes.map(s => s.params), [
    { startX: 500, startY: 840, endX: 500, endY: 1560, duration: 450 },
    { startX: 500, startY: 1560, endX: 500, endY: 840, duration: 450 },
    { startX: 500, startY: 1000, endX: 500, endY: 1600, duration: 450 },
  ]);
});

for (const [label, change] of Object.entries({
  'missing top flag': { atTop: undefined },
  'missing bottom flag': { atBottom: undefined },
  'missing boundary evidence': { boundaryEvidence: undefined },
  'empty top evidence': { boundaryEvidence: { top: ' ', bottom: '末尾说明' } },
  'empty bottom evidence': { boundaryEvidence: { top: '首项任务', bottom: '' } },
  'non-string evidence': { boundaryEvidence: { top: 42, bottom: '末尾说明' } },
  'missing tiers': { tiers: undefined },
  'malformed tier': { tiers: [{ coin: -10, need: '10次', button: '未达成' }] },
  'blocked page': { blocked: true },
  'wrong page': { pageIdentity: '商品详情' },
  'invalid row': { rows: [row('错误任务', { quota: '3/2' })] },
})) {
  test(`rejects ${label} before any gesture, retains raw evidence, and stops cleanup`, async t => {
    const h = fixture(t, [observation(change), observation()]);
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.equal(h.swipes.length, 0);
    assert.equal(h.reads, 1, 'invalid evidence stops the adapter before finally recovery');
    const directory = fs.readdirSync(h.evidenceDir).find(name => name.startsWith('portal-'))!;
    const saved = JSON.parse(fs.readFileSync(path.join(h.evidenceDir, directory, '0001.json'), 'utf8'));
    assert.equal(saved.ordinal, 1);
    assert.deepEqual(saved.observation.rows, observation(change).rows);
    assert.ok(fs.existsSync(path.join(h.evidenceDir, directory, '0001.png')));
  });
}

test('six unsuccessful top-seeking swipes stop without another cleanup gesture or query', async t => {
  const middle = observation({ atTop: false, atBottom: false, boundaryEvidence: { top: '', bottom: '' } });
  const h = fixture(t, Array.from({ length: 8 }, () => middle));
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.match(result.detail!, /6/);
  assert.equal(h.swipes.length, 6);
  assert.equal(h.reads, 7);
});

for (const status of ['unknown', 'rejected']) {
  test(`${status} swipe stops collection without a finally recovery gesture`, async t => {
    const h = fixture(t, [observation({ atBottom: false }), observation()], status);
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.match(result.detail!, /unresolved/);
    assert.equal(h.swipes.length, 1);
    assert.equal(h.reads, 1);
  });
}

test('an empty scroll area cannot authorize a page swipe or recovery gesture', async t => {
  const h = fixture(t, [observation({ atBottom: false, scrollBounds: null }), observation()]);
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.match(result.detail!, /scroll/i);
  assert.equal(h.swipes.length, 0);
  assert.equal(h.reads, 1);
});

for (const [label, change] of Object.entries({
  'offscreen scroll bounds': { scrollBounds: { left: 0, top: 100, right: 1200, bottom: 1000 } },
  'zero height scroll bounds': { scrollBounds: { left: 100, top: 1000, right: 900, bottom: 1000 } },
  'invalid frame dimensions': { frame: { ...observation().frame, width: 0 } },
  'invalid frame timestamp': { frame: { ...observation().frame, capturedAt: NaN } },
  'non-PNG image': { frame: { ...observation().frame, dataUrl: 'data:image/jpeg;base64,ZmFrZQ==' } },
  'malformed PNG data': { frame: { ...observation().frame, dataUrl: 'data:image/png;base64,fixture' } },
  'missing source': { rowSource: undefined },
})) {
  test(`${label} cannot produce a complete inventory`, async t => {
    const h = fixture(t, [observation(change), observation()]);
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.equal(h.reads, 1);
    assert.equal(h.swipes.length, 0);
  });
}

test('return verification requires the actual same top task signature', async t => {
  const h = fixture(t, [observation(), observation({ rows: [row('不同的顶部任务')] })]);
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'RETURN_FAILED');
  assert.equal(result.completeness.coverage.returnedToTop, false);
  assert.equal(h.swipes.length, 0);
});

for (const change of [
  { instruction: '搜索15秒' }, { quota: '1/2' }, { quota: '0/3' }, { reward: 30 },
  { button: { ...row().button, text: '已完成' } },
]) {
  test(`existing collector rejects overlap conflict ${JSON.stringify(change)}`, async t => {
    const top = observation({ atBottom: false, rows: [row('重叠任务', { reward: 20 })] });
    const bottom = observation({ atTop: false, rows: [row('重叠任务', { reward: 20, ...change })] });
    const h = fixture(t, [top, bottom, top]);
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.match(result.detail!, /冲突/);
    assert.equal(result.pages.length, 2);
    assert.equal(result.completeness.coverage.returnedToTop, true);
  });
}

test('repeated rows never establish bottom; the existing stalled bound returns incomplete', async t => {
  const top = observation({ atBottom: false, boundaryEvidence: { top: '首项任务', bottom: '' } });
  const middle = observation({ atTop: false, atBottom: false, boundaryEvidence: { top: '', bottom: '' } });
  const h = fixture(t, [top, middle, middle, top]);
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'STALLED');
  assert.equal(result.completeness.coverage.bottom, false);
  assert.equal(result.completeness.coverage.returnedToTop, true);
  assert.equal(h.reads, 4);
});

test('maxPages is delegated to the existing collector and still verifies return to top', async t => {
  const top = observation({ atBottom: false });
  const h = fixture(t, [top, top]);
  const result = await h.run({ maxPages: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'MAX_PAGES');
  assert.equal(result.completeness.pages, 1);
  assert.equal(result.completeness.coverage.returnedToTop, true);
  assert.equal(h.swipes.length, 0);
});

test('budget option produces an incomplete collection with no page gestures', async t => {
  const top = observation();
  const h = fixture(t, [top, top]);
  const result = await h.run({ overBudget: () => true });
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'BUDGET');
  assert.equal(result.pages.length, 0);
  assert.equal(h.swipes.length, 0);
});

test('read or dispatcher exceptions stop cleanup and preserve preceding evidence', async t => {
  for (const failure of ['observe', 'swipe']) {
    const h = fixture(t, [observation({ atBottom: false })]);
    let attempts = 0;
    if (failure === 'observe') {
      const original = h.bridge.observe;
      h.bridge.observe = async () => { if (++attempts > 1) throw new Error('offline observation failed'); return original(); };
    } else {
      h.bridge.swipe = async () => { attempts++; throw new Error('offline dispatcher failed'); };
    }
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.match(result.detail!, /offline/);
    assert.equal(result.pages.length, 1);
    assert.equal(attempts, failure === 'observe' ? 2 : 1);
  }
});

test('custom panel identity is explicit and unknown rewards retain source provenance', async t => {
  const top = observation({ pageIdentity: '测试活动面板', rowSource: 'portal' });
  const h = fixture(t, [top, top]);
  const result = await h.run({ panelText: '测试活动面板' });
  assert.equal(result.ok, true);
  assert.equal((result.pages[0].raw as any).source.rowSource, 'portal');
});

test('real PortalHybrid and collector share one model query per frame without task dispatch', async t => {
  const f = fixture(t, []);
  const top = observation({ atBottom: false, rows: [row('顶部任务', { quota: '0/2' })] });
  const bottom = observation({ atTop: false, progress: null, rows: [row('底部任务', { quota: '0/1' })], tiers: [] });
  const pages = [top, bottom, bottom, top];
  const calls: string[] = [];
  let captures = 0, queries = 0;
  const bridge = new PortalHybrid({
    portal: {
      readState: async () => { throw new Error('offline tree unavailable'); },
      tap: async () => { assert.fail('Collection must never tap'); },
      back: async () => { assert.fail('Collection must never navigate back'); },
      swipe: async () => { calls.push('swipe'); return { portalStatus: 'success' }; },
    },
    capture: async () => ({ ...top.frame, id: `frame-${++captures}`, capturedAt: 1000 }),
    foreground: async () => 'test.package',
    vision: { query: async frame => { calls.push(`query:${frame.id}`); return structuredClone(pages[queries++]); } },
    expectedPackage: 'test.package', panelText: '赚金币抵钱',
    rowRules: { panelText: '赚金币抵钱', titlePattern: '^(.+)[(]([0-9]+)/([0-9]+)[)]$', buttonTexts: ['去完成'] },
    now: () => 1000, maxAgeMs: 5000, maxModelCalls: 4,
  });
  const result = await collectPortalInventory(bridge, { account: 'a', activity: 'b', evidenceDir: f.evidenceDir });
  assert.equal(result.ok, true, result.detail ?? 'complete');
  assert.equal(captures, 4);
  assert.equal(queries, 4);
  assert.deepEqual(calls, ['query:frame-1', 'swipe', 'query:frame-2', 'query:frame-3', 'swipe', 'query:frame-4']);
});


