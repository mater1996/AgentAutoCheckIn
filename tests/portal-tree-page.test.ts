import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import type { PortalState } from '../runner/portal-observation.ts';
import { parseTreePage } from '../probes/lib/portal-tree-page.ts';

const evidence = new URL('../evidence/', import.meta.url);
const cached = (round = 1, read = 5): PortalState => JSON.parse(fs.readFileSync(
  new URL(`portal-cached-tree-entry-2026-10-31/round-${round}/read-${read}.json`, evidence), 'utf8')).state;

// These assertions come from the saved node ancestry, not screen coordinates used by the parser.
const listPath = '0/0/0/0/4/0/2/0/0/0';
const contentPath = '0/0/0/0/4/0/2/0';
const at = (state: PortalState, path: string) => path.split('/').slice(1)
  .reduce((node, part) => node.children![Number(part)], state.a11y_tree);
const texts = (state: PortalState, text: string) => {
  const visit = (n: any): any[] => [...((n.text || n.contentDescription || '').trim() === text ? [n] : []), ...(n.children ?? []).flatMap(visit)];
  return visit(state.a11y_tree);
};

test('tiers use local reward siblings and never invent missing needs or button states', () => {
  const state = cached();
  texts(state, '+30').find(n => n.boundsInScreen.top === 609).text = '+37';
  const { raw } = parseTreePage(state);
  assert.deepEqual(raw.tiers, [
    { coin: 37, need: '', button: '立即领取' },
    { coin: 50, need: '10次任务', button: '' },
    { coin: 100, need: '20次任务', button: '' },
  ]);
  assert.equal(raw.evidence.tiers[0].reward.text, '+37');
  assert.equal(raw.evidence.tiers[1].need?.text, '10次任务');
  assert.equal(raw.evidence.tiers[1].button, null);
});

test('boundaries require visible in-list progress and tiers, or the exact visible sibling disclaimer', () => {
  const state = cached();
  const progress = texts(state, '完成进度 9/20')[0];
  progress.boundsInScreen = { left: 40, top: 400, right: 300, bottom: 450 };
  // An unrelated background progress must never restore top.
  state.a11y_tree.children!.push({ ...structuredClone(progress), text: '完成进度 1/20' });
  let raw = parseTreePage(state).raw;
  assert.equal(raw.atTop, false);
  assert.equal(raw.progress, null);
  assert.deepEqual(raw.tiers, []);
  const note = at(state, `${contentPath}/1`);
  note.text = ' \n注：以上奖励均为最高奖励，以实际获得奖励为准\t ';
  note.isVisibleToUser = true;
  note.boundsInScreen = { left: 157, top: 2150, right: 924, bottom: 2200 };
  raw = parseTreePage(state).raw;
  assert.equal(raw.atBottom, true);
  assert.equal(raw.evidence.bottom?.path, `${contentPath}/1`);
  note.text = '以上奖励均为最高奖励，以实际获得奖励为准';
  assert.equal(parseTreePage(state).raw.atBottom, false);
  note.text = '注：以上奖励均为最高奖励，以实际获得奖励为准';
  note.boundsInScreen.bottom = 2450;
  assert.equal(parseTreePage(state).raw.atBottom, false);
});

test('progress alone is insufficient for top and invalid progress fails closed', () => {
  const state = cached();
  const tierGroup = at(state, `${listPath}/0/0/1`);
  tierGroup.isVisibleToUser = false;
  assert.equal(parseTreePage(state).raw.atTop, false);
  texts(state, '完成进度 9/20')[0].text = '完成进度 21/20';
  assert.throws(() => parseTreePage(state), /progress/);
});

test('clipping excludes incomplete titles/buttons and source requirements outside list', () => {
  const state = cached();
  at(state, `${listPath}/1/1/0`).boundsInScreen!.top = 560;
  at(state, `${listPath}/2/2`).boundsInScreen!.bottom = 2280;
  at(state, `${listPath}/3/1/1`).boundsInScreen = { left: 231, top: 400, right: 359, bottom: 450 };
  const raw = parseTreePage(state).raw;
  assert.equal(raw.tasks.length, 6);
  assert.equal(raw.tasks[0].name, '逛爆款好物抵扣快闪');
  assert.equal(raw.tasks[0].instruction, '');
});

test('signature detects identity movement and boundary positions, but ignores timing metadata', () => {
  const state = cached();
  const initial = parseTreePage(state).signature;
  state.snapshotAgeMs = 99999;
  assert.equal(parseTreePage(state).signature, initial);
  at(state, `${listPath}/1/1/0`).boundsInScreen!.top++;
  const moved = parseTreePage(state).signature;
  assert.notEqual(moved, initial);
  at(state, `${listPath}/0/0/1/0/0/0`).boundsInScreen!.top++;
  assert.notEqual(parseTreePage(state).signature, moved);
});

test('visible login/verification/loading markers report blocked and ambiguous data throws', () => {
  const state = cached();
  state.a11y_tree.children!.push({ text: '请完成验证', isVisibleToUser: true,
    boundsInScreen: { left: 200, top: 800, right: 500, bottom: 900 } });
  assert.equal(parseTreePage(state).raw.blocked, true);
  const row = at(state, `${listPath}/1`);
  row.children!.push(structuredClone(row.children![2]));
  assert.throws(() => parseTreePage(state), /ambiguous/);
  const duplicate = cached();
  at(duplicate, contentPath).children!.push(structuredClone(at(duplicate, `${contentPath}/1`)));
  assert.throws(() => parseTreePage(duplicate), /ambiguous/);
});

test('all saved entry and collection states are read from their actual raw tree fields', () => {
  let panelCount = 0, rejected = 0, collectionCount = 0;
  for (let round = 1; round <= 5; round++) for (let read = 1; read <= 5; read++) {
    const state = cached(round, read);
    if (read === 5) {
      const result = parseTreePage(state);
      assert.equal(result.raw.atTop, true);
      assert.equal(result.raw.atBottom, false);
      panelCount++;
    } else {
      assert.throws(() => parseTreePage(state), /panel|rows/);
      rejected++;
    }
  }
  const pages = new URL('portal-auto-collection-2026-10-31T11-04-56-118Z/pages/', evidence);
  for (const dir of fs.readdirSync(pages).filter(name => name.startsWith('portal-'))) {
    const folder = new URL(`${dir}/`, pages);
    for (const file of fs.readdirSync(folder).filter(name => name.endsWith('.json')).sort()) {
      const saved = JSON.parse(fs.readFileSync(new URL(file, folder), 'utf8'));
      const result = parseTreePage(saved.observation.portalState);
      assert.equal(result.raw.progress, '9/20');
      assert.equal(result.raw.atTop, true);
      assert.equal(result.raw.atBottom, false);
      assert.equal(result.raw.tasks.length, 8);
      collectionCount++;
    }
  }
  assert.deepEqual({ panelCount, rejected, collectionCount }, { panelCount: 5, rejected: 20, collectionCount: 8 });
});

test('ancestry-derived bounds scale with the saved tree and a single remaining row remains scoped to list', () => {
  const state = cached();
  const scale = (node: any) => {
    if (node.boundsInScreen) for (const k of ['left', 'top', 'right', 'bottom']) node.boundsInScreen[k] /= 2;
    for (const child of node.children ?? []) scale(child);
  };
  scale(state.a11y_tree);
  state.device_context!.screen_bounds = { width: 540, height: 1200 };
  const list = at(state, listPath);
  for (const row of list.children!.slice(2)) row.isVisibleToUser = false;
  const parsed = parseTreePage(state);
  assert.deepEqual(parsed.scrollBounds, { left: 0, top: 287, right: 540, bottom: 1138 });
  assert.equal(parsed.raw.tasks.length, 1);
  assert.equal(parsed.raw.evidence.list.path, listPath);
});

test('saved cached panel yields collector data and matched ancestry without mutating source', () => {
  const state = cached(), before = JSON.stringify(state);
  const { raw, scrollBounds, signature } = parseTreePage(state);
  assert.equal(raw.pageIsTaskPanel, true);
  assert.equal(raw.blocked, false);
  assert.equal(raw.atTop, true);
  assert.equal(raw.atBottom, false);
  assert.equal(raw.progress, '9/20');
  assert.equal(raw.tasks.length, 8);
  assert.deepEqual(raw.tasks.slice(0, 3), [
    { name: '任务到访得金币', instruction: '每日来任务面板', quota: '0/1', reward: 10, button: '领取奖励' },
    { name: '看看#夜胶原', instruction: '浏览', quota: '1/5', reward: 50, button: '去完成' },
    { name: '逛爆款好物抵扣快闪', instruction: '浏览5秒', quota: '0/1', reward: 20, button: '去完成' },
  ]);
  assert.deepEqual(scrollBounds, { left: 0, top: 574, right: 1080, bottom: 2276 });
  assert.equal(raw.evidence.list.path, listPath);
  assert.equal(raw.evidence.container.path, contentPath);
  assert.equal(raw.evidence.tasks[0].title.path, `${listPath}/1/1/0`);
  assert.equal(raw.evidence.tasks[0].button.path, `${listPath}/1/2`);
  assert.ok(raw.evidence.tasks[0].leaves.some(e => e.text === '每日来任务面板' && e.path === `${listPath}/1/1/1`));
  assert.ok(raw.evidence.tasks[0].leaves.some(e => e.text === '+10' && e.path === `${listPath}/1/1/3`));
  assert.equal(raw.evidence.progress?.text, '完成进度 9/20');
  assert.ok(signature.includes('787'));
  assert.equal(JSON.stringify(state), before);
});
