import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
const root = new URL('../', import.meta.url).pathname;
const load = () => import('../runner/staged/shop-browse.ts').catch(() => null);

test('136/137/138: real multilayer page contracts preserve source ownership and learned gaps', async () => {
  const api = await load();
  assert.ok(api?.planShopBrowse, 'missing executable multilayer shop planner');
  const contract = await api.buildShopBrowseContract(root);
  const replay = await api.loadShopBrowseReplay(contract);
  assert.deepEqual(contract.sourceRunIds, [136, 137]);
  assert.equal(replay.settlement.runId, 138);
  assert.equal(replay.settlement.sourceRunId, 136);
  assert.equal(replay.settlement.recoveryRunId, 137);
  assert.equal(replay.historicalEntryOwnershipVerified, false);
  assert.equal((replay.frames[1].page as any)?.historicalReplay?.originalObservationError, 'OCR capture failed');
  assert.match((replay.frames[1].page as any)?.historicalReplay?.rawOcr?.sha256 ?? '', /^[a-f0-9]{64}$/);
  const [entry, list, child, childDone, listDone, panel] = replay.frames;
  const owner = (f: any) => ({ package: 'com.taobao.taobao', userId: 0, taskAttemptId: replay.taskAttemptId, now: f.capturedAt });
  const start = api.createShopBrowseState(contract, replay.taskAttemptId);
  const open = await api.planShopBrowse(entry, owner(entry), start);
  assert.equal(open.action?.type, 'tap');
  assert.equal((await api.planShopBrowse(entry, owner(entry), open.nextState)).action, undefined, 'no second old-coordinate tap');
  const shops = await api.inspectShopBrowse(list, owner(list), contract);
  assert.equal(shops?.page, 'shopList');
  assert.equal(shops?.cards.length, 3);
  const choose = await api.planShopBrowse(list, owner(list), open.nextState);
  assert.equal(choose.kind, 'needsLearning', 'several fresh cards require explicit current-card selection');
  const selected = shops!.cards[1];
  const enter = await api.planShopBrowse(list, owner(list), { ...open.nextState, selectedCardName: selected.name });
  assert.equal(enter.action?.type, 'tap');
  assert.ok(enter.action!.y! > 1090 && enter.action!.y! < 1150);
  const missing = await api.planShopBrowse(child, owner(child), enter.nextState);
  assert.equal(missing.kind, 'needsLearning');
  assert.match(missing.reason, /gesture|手势/);
  assert.equal(missing.action, undefined);
  const done = await api.planShopBrowse(childDone, owner(childDone), enter.nextState);
  assert.equal(done.receipt?.layer, 'store');
  assert.equal(done.receipt?.amount, 10, 'list reward 20 must not reject owned child +10');
  assert.equal(done.action?.type, 'back');
  const outer = await api.planShopBrowse(listDone, owner(listDone), done.nextState);
  assert.equal(outer.receipt?.layer, 'shopList');
  assert.equal(outer.action?.type, 'back');
  const returned = await api.planShopBrowse(panel, owner(panel), outer.nextState);
  assert.equal(returned.kind, 'awaitSettlement');
  assert.equal(returned.action, undefined);
  assert.equal(returned.nextState.phase, 'awaitSettlement');
});

test('development shop ignores elapsed observation ceiling but executes only explicitly requested finite gestures',async()=>{
 const api=(await load())!,c=await api.buildShopBrowseContract(root),r=await api.loadShopBrowseReplay(c),[entry,list,child]=r.frames;
 const owner=(f:any)=>({package:f.package,userId:0,taskAttemptId:r.taskAttemptId,now:f.capturedAt+60000,executionPolicy:'development-unbounded-v1' as const});
 const opened=await api.planShopBrowse(entry,owner(entry),api.createShopBrowseState(c,r.taskAttemptId));const shops=(await api.inspectShopBrowse(list,owner(list),c))!;
 const entered=await api.planShopBrowse(list,owner(list),{...opened.nextState,selectedCardName:shops.cards[1].name});
 const state={...entered.nextState,learningBudget:{status:'candidate' as const,maxGestures:6,gestureMs:900,observationBudgetMs:1}};
 const first=await api.planShopBrowse(child,owner(child),state);assert.equal(first.action?.type,'swipe');
 const exhausted=await api.planShopBrowse({...child,id:'later-finite-end',capturedAt:child.capturedAt+1},owner(child),{...first.nextState,gesturesProposed:6});assert.equal(exhausted.kind,'needsLearning');
});
test('store gestures are explicitly bounded candidate learning and returning cannot skip either receipt layer', async () => {
  const api = (await load())!;
  const c = await api.buildShopBrowseContract(root);
  const r = await api.loadShopBrowseReplay(c);
  const [entry, list, child, done, listDone, panel] = r.frames;
  const owner = (f: any) => ({ package: f.package, userId: 0, taskAttemptId: r.taskAttemptId, now: f.capturedAt });
  const opened = await api.planShopBrowse(entry, owner(entry), api.createShopBrowseState(c, r.taskAttemptId));
  const shops = (await api.inspectShopBrowse(list, owner(list), c))!;
  const entered = await api.planShopBrowse(list, owner(list), { ...opened.nextState, selectedCardName: shops.cards[1].name });
  const state = { ...entered.nextState, learningBudget: { status: 'candidate' as const, maxGestures: 1, gestureMs: 900, observationBudgetMs: 10000 } };
  const gesture = await api.planShopBrowse(child, owner(child), state);
  assert.equal(gesture.action?.type, 'swipe');
  assert.equal(gesture.learning?.status, 'candidate');
  assert.equal(gesture.learning?.remainingGestures, 0);
  assert.equal((await api.planShopBrowse(child, owner(child), gesture.nextState)).action, undefined);
  const next = { ...child, id: 'derived-next-observation', capturedAt: child.capturedAt + 1000 };
  const exhausted = await api.planShopBrowse(next, owner(next), gesture.nextState);
  assert.equal(exhausted.kind, 'needsLearning');
  for (const wrong of [panel, listDone]) {
    const p = await api.planShopBrowse(wrong, owner(wrong), entered.nextState);
    assert.equal(p.kind, 'unknown');
    assert.equal(p.action, undefined);
  }
  const wrongAttempt = await api.planShopBrowse(done, { ...owner(done), taskAttemptId: 'other' }, entered.nextState);
  assert.equal(wrongAttempt.kind, 'unknown');
  const wrongStore = await api.planShopBrowse(done, owner(done), { ...entered.nextState, selected: { ...entered.nextState.selected!, name: 'unowned' } });
  assert.equal(wrongStore.kind, 'unknown');
  assert.equal(wrongStore.action, undefined);
});

test('shop PNG/OCR replay rejects stale receipt text, occluded badges, wrong pages, and duplicate current-card names', async () => {
  const api = (await load())!;
  const c = await api.buildShopBrowseContract(root);
  const r = await api.loadShopBrowseReplay(c);
  const [, list, child, done, outer] = r.frames;
  const owner = (f: any) => ({ package: f.package, userId: 0, taskAttemptId: r.taskAttemptId, now: f.capturedAt });
  for (const f of [
    { ...outer, path: list.path },
    { ...done, path: child.path },
    { ...done, lines: done.lines.map(l => l.text === '+10' ? { ...l, text: '+20' } : l) },
    { ...done, userId: 10 },
    { ...outer, path: '/unreadable.png' },
    { ...list, lines: [...list.lines, list.lines.find(l => /勇哥美妆正品店/.test(l.text))!] },
  ]) assert.equal(await api.inspectShopBrowse(f, owner(f), c), null);
  const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/shop-contract-');
  try {
    for (const [base, box] of [[done, { left: 638, top: 132, width: 302, height: 70 }],
      [outer, { left: 894, top: 1825, width: 154, height: 93 }]] as const) {
      const path = join(dir, base.id + '.png');
      await sharp(base.path).composite([{ input: { create: { width: box.width, height: box.height, channels: 3, background: '#ffffff' } }, left: box.left, top: box.top }]).png().toFile(path);
      assert.equal(await api.inspectShopBrowse({ ...base, path }, owner(base), c), null);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
