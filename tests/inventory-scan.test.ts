import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInventory } from '../runner/inventory';
import { collectInventory } from '../runner/inventory-scan';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const row = (name: string, overrides = {}) => ({ name, instruction: '浏览15秒', quota: '0/2', button: '去完成', reward: 20, ...overrides });

test('normalization remains compatible but complete execution rejects a single visible page', () => {
  const raw = { progress: '2/20', tasks: [row('完整任务名称')] };
  assert.equal(normalizeInventory(raw, 'a', 'b').tasks.length, 1);
  assert.throws(() => normalizeInventory(raw, 'a', 'b', { requireComplete: true }), /完整|complete/);
});

const page = (tasks: any[], overrides = {}) => ({ pageIsTaskPanel: true, blocked: false, atTop: false, atBottom: false, tiers: [], tasks, ...overrides });
async function scan(pages: any[], options = {}, failure?: (call: number) => void) {
  const evidenceDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'inventory-scan-'));
  let reads = 0;
  const scrolls: any[] = [];
  const agent = {
    aiQuery: async () => { failure?.(reads); return pages[Math.min(reads++, pages.length - 1)]; },
    aiScroll: async (...args: any[]) => { scrolls.push(args); },
  };
  try {
    const result = await collectInventory(agent, { account: 'a', activity: 'b', evidenceDir, ...options });
    const evidence = JSON.parse(fs.readFileSync(result.evidenceFile, 'utf8'));
    return { result, reads, scrolls, evidence };
  } finally { fs.rmSync(evidenceDir, { recursive: true, force: true }); }
}

test('scans overlapping pages, keeps exact requirements and evidence, and returns to top', async () => {
  const top = page([row('你关注的商品都可抵', { at: [.8, .4] }), row('好物沉浸看')], { atTop: true, progress: '5/20', tiers: [{ coin: 100, need: '10次', button: '未达成' }] });
  const bottom = page([row('好物沉浸看'), row('抢更多超级秒杀好物', { instruction: '浏览5秒' })], { atBottom: true });
  const { result, reads, scrolls, evidence } = await scan([top, bottom, top]);
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.inventory!.tasks.map(t => t.name), ['你关注的商品都可抵', '好物沉浸看', '抢更多超级秒杀好物']);
  assert.equal(result.inventory!.tasks[2].instruction, '浏览5秒');
  assert.equal(result.inventory!.tasks[0].at, undefined);
  assert.equal(result.inventory!.total_remaining, 6);
  assert.deepEqual(result.inventory!.progress, { done: 5, total: 20 });
  assert.equal(result.completeness.full, true);
  assert.equal(result.completeness.pages, 2);
  assert.deepEqual(result.completeness.coverage, { top: true, bottom: true, returnedToTop: true });
  assert.equal(reads, 3);
  assert.equal(scrolls[0][1].scrollType, 'scrollToTop');
  assert.deepEqual(scrolls[1][1], { direction: 'down', scrollType: 'singleAction', distance: 200 });
  assert.equal(scrolls.at(-1)[1].scrollType, 'scrollToTop');
  assert.deepEqual(evidence.pages.map((p: any) => p.raw), [top, bottom]);
  assert.deepEqual(evidence.returnToTop.raw, top);
  assert.equal(result.inventory!.source!.evidenceFile, result.evidenceFile);
});

test('an unreadable zero reward can be resolved by a later overlapping observation', async () => {
  const top = page([row('A', { reward: 0 }), row('B')], { atTop: true, progress: '5/20' });
  const bottom = page([row('A', { reward: 10 }), row('B', { reward: 0 })], { atBottom: true });
  const { result } = await scan([top, bottom, top]);
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.inventory!.tasks.map(t => t.reward), [10, 20]);
});

for (const [label, change] of [
  ['instruction', { instruction: '搜索后浏览15秒' }],
  ['total', { quota: '0/3' }],
  ['done', { quota: '1/2' }],
  ['reward', { reward: 30 }],
  ['button', { button: '已完成' }],
] as const) {
  test(`rejects overlapping ${label} conflicts without guessing`, async () => {
    const top = page([row('相同名称')], { atTop: true, progress: '5/20' });
    const { result, evidence, scrolls } = await scan([top, page([row('相同名称', change)], { atBottom: true }), top]);
    assert.equal(result.ok, false);
    assert.match(result.detail!, /冲突/);
    assert.equal(result.completeness.full, false);
    assert.equal(evidence.pages.length, 2);
    assert.equal(scrolls.at(-1)[1].scrollType, 'scrollToTop');
  });
}

test('missing top is incomplete even when the first page explicitly reports bottom', async () => {
  const { result, reads } = await scan([page([row('A')], { progress: '5/20', atBottom: true })]);
  assert.equal(result.ok, false);
  assert.match(result.detail!, /顶部/);
  assert.equal(result.completeness.coverage.top, false);
  assert.equal(reads, 2);
});

test('missing top progress cannot be invented from a later page', async () => {
  const { result } = await scan([page([row('A')], { atTop: true })]);
  assert.equal(result.ok, false);
  assert.equal(result.inventory, null);
  assert.match(result.detail!, /进度/);
});

test('page limit with no explicit bottom remains incomplete and returns to top', async () => {
  const top = page([row('A')], { atTop: true, progress: '5/20' });
  const { result, reads, scrolls } = await scan([top, page([row('B')]), top], { maxPages: 2 });
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'MAX_PAGES');
  assert.equal(result.completeness.coverage.returnedToTop, true);
  assert.equal(result.completeness.coverage.bottom, false);
  assert.equal(reads, 3);
  assert.equal(scrolls.length, 3);
});

test('two repeated semantic pages stop a stalled scroll without asserting bottom', async () => {
  const top = page([row('A')], { atTop: true, progress: '5/20' });
  const { result, reads } = await scan([top,
    page([row('A', { at: [.8, .4] })]),
    page([row('A', { at: [.9, .6] })]), top]);
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'STALLED');
  assert.equal(result.completeness.pages, 3);
  assert.equal(reads, 4);
});

test('default cap is twelve pages even if each page introduces new tasks', async () => {
  const top = page([row('0')], { atTop: true, progress: '5/20' });
  const { result } = await scan([top, ...Array.from({ length: 11 }, (_, i) => page([row(`${i + 1}`)])), top]);
  assert.equal(result.completeness.pages, 12);
  assert.equal(result.completeness.reason, 'MAX_PAGES');
  assert.equal(result.ok, false);
});

for (const overrides of [{ blocked: true }, { pageIsTaskPanel: false }, { blocked: 'false' }, { tasks: null }]) {
  test(`rejects ambiguous or blocked pages ${JSON.stringify(overrides)}`, async () => {
    const { result } = await scan([page([row('A')], { atTop: true, progress: '5/20', atBottom: true, ...overrides })]);
    assert.equal(result.ok, false);
    assert.equal(result.completeness.full, false);
  });
}

test('query failure preserves prior pages and still attempts return to top', async () => {
  const top = page([row('A')], { atTop: true, progress: '5/20' });
  let calls = 0;
  const { result, scrolls, evidence } = await scan([top], {}, () => { if (++calls === 2) throw new Error('offline query failed'); });
  assert.equal(result.ok, false);
  assert.match(result.detail!, /offline query failed/);
  assert.equal(evidence.pages.length, 1);
  assert.equal(scrolls.at(-1)[1].scrollType, 'scrollToTop');
  assert.equal(result.completeness.coverage.returnedToTop, true);
});

test('return-to-top must confirm the same top panel before permitting execution', async () => {
  const top = page([row('A')], { atTop: true, atBottom: true, progress: '5/20' });
  const { result } = await scan([top, page([row('wrong panel')], { atTop: true, progress: '5/20' })]);
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'RETURN_FAILED');
  assert.equal(result.completeness.coverage.returnedToTop, false);
});

test('strict scanning rejects unsafe counters instead of building a false complete inventory', async () => {
  for (const overrides of [{ progress: '9007199254740993/20' }, { tasks: [row('A', { quota: '0/9007199254740993' })] }, { progress: '21/20' }]) {
    const { result } = await scan([page([row('A')], { atTop: true, atBottom: true, progress: '5/20', ...overrides })]);
    assert.equal(result.ok, false);
  }
});

test('budget exhaustion stops the scan and records an incomplete inventory', async () => {
  const top = page([row('A')], { atTop: true, progress: '5/20' });
  let checks = 0;
  const { result } = await scan([top, top], { overBudget: () => ++checks > 1 });
  assert.equal(result.ok, false);
  assert.equal(result.completeness.reason, 'BUDGET');
  assert.equal(result.completeness.coverage.returnedToTop, true);
  assert.equal(result.completeness.pages, 1);
});

test('strict collection cannot mark an empty task inventory complete', async () => {
  const { result } = await scan([page([], { atTop: true, atBottom: true, progress: '5/20' })]);
  assert.equal(result.ok, false);
});

test('same quota numbers with different whitespace are compatible observations', async () => {
  const top = page([row('A')], { atTop: true, progress: '5/20' });
  const { result } = await scan([top, page([row('A', { quota: '0 / 2' })], { atBottom: true }), top]);
  assert.equal(result.ok, true, result.detail);
});
