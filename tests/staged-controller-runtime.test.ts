import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanelClaimContract, loadPanelClaimReplay, createPanelClaimState } from '../runner/staged/panel-claim.ts';
import { buildShopBrowseContract, loadShopBrowseReplay } from '../runner/staged/shop-browse.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DeviceFrame } from '../runner/staged/device.ts';
const root = new URL('../', import.meta.url).pathname;
const load = () => import('../runner/staged/controller-runtime.ts').catch(() => null);
const scope = { appId: 'taobao', accountId: 'local', activityId: 'coins', userId: 0 };
const base = (family: 'panel-claim' | 'shop-browse', contract: any) => ({ family, contract, sessionId: 'replay-session', attemptId: 'replay-attempt', taskAttemptId: 'replay-task', scope, package: 'com.taobao.taobao', task: family === 'panel-claim' ? { name: '任务到访得金币', instruction: '每日来任务面板' } : { name: '逛好店赚一大波金币', instruction: '浏览15秒' }, budget: { maxMs: 30000, maxActions: 10, maxAgentCalls: 0 }, balanceBefore: 1430 });
// Original PNG/OCR are retained. Only injected clock/id are derived replay data.
function fakeDevice(frames: DeviceFrame[]) {
  let clock = 100000, serial = 0, index = 0;
  const actions: string[] = [], events: any[] = [];
  const fresh = (f: DeviceFrame) => ({ ...structuredClone(f), id: `derived-${++serial}`, capturedAt: ++clock, page: { historicalReplay: f.page, derived: true, originalCapture: { id: f.id, capturedAt: f.capturedAt } } });
  return { actions, events, fresh, now: () => clock,
    observe: async () => fresh(frames[index]),
    dispatch: async (action: any) => { actions.push(action.type); if (action.type === 'wait') clock += action.ms; else index = Math.min(index + 1, frames.length - 1); },
    persist: async (event: any) => { events.push(structuredClone(event)); },
  };
}
test('real engine panel replay persists consumed intent before tap and captures missed-OCR toast immediately', async () => {
  const api = await load();
  assert.ok(api?.runControllerStage, 'missing real engine controller adapter');
  const contract = await buildPanelClaimContract(root), replay = await loadPanelClaimReplay(contract);
  const device = fakeDevice([replay.frames[0], replay.frames.at(-1)!]);
  const order: string[] = [];
  const result = await api.runControllerStage(base('panel-claim', contract), { ...device,
    persist: async (event: any) => { if (event.type === 'controller_state') order.push(`persist:${event.state.phase}`); await device.persist(event); },
    dispatch: async (action: any) => { if (action.type === 'tap') assert.ok(order.includes('persist:awaitReceipt')); order.push(action.type); await device.dispatch(action); },
    captureTransient: async () => { order.push('captureTransient'); return device.fresh(replay.frames[1]); },
  });
  assert.equal(result.status, 'receipt');
  assert.equal(result.state.phase, 'awaitStableBalance');
  assert.ok(result.receipt && 'quote' in result.receipt);
  assert.equal(result.receipt.quote, '任务完成！获得10淘金币');
  assert.deepEqual(order.slice(order.indexOf('tap'), order.indexOf('tap') + 2), ['tap', 'captureTransient']);
  assert.equal(device.actions.filter(a => a === 'tap').length, 1);
  assert.equal(result.stages[0].status, 'completed');
  assert.ok(result.stages[0].events.some((e: any) => e.type === 'authority_consumed'));
  assert.equal(contract.status, 'candidate');
  assert.equal(result.stages[0].usedScriptVersion, contract.version, 'actual candidate contract version');
  assert.ok(result.stages[0].actions.every(a => a.source === 'script'));
  assert.ok(device.events.some(e => e.type === 'explicit_candidate_authorized' && e.registryValidated === false));
});

test('panel raw capture and later OCR have separate budgets without refreshing capture time', async () => {
  const api=(await load())!,contract=await buildPanelClaimContract(root),replay=await loadPanelClaimReplay(contract);
  const d=fakeDevice([replay.frames[0],replay.frames.at(-1)!]);
  const order:string[]=[];let originalTime=0;
  const result=await api.runControllerStage(base('panel-claim',contract),{...d,
    captureRawBurst:async()=>{order.push('raw');const f=d.fresh(replay.frames[1]);originalTime=f.capturedAt;return {frames:[f],status:'complete'};},
    deriveRawFrames:async(batch:any)=>{order.push('ocr');await d.dispatch({type:'wait',ms:2200} as any);return batch.frames;},
  } as any);
  assert.equal(result.status,'receipt',result.reason);
  assert.deepEqual(order,['raw','ocr']);
  assert.equal(result.receipt!.capturedAt,originalTime);
  assert.equal(d.actions.filter(x=>x==='tap').length,1);
  const late=fakeDevice([replay.frames[0],replay.frames.at(-1)!]);
  const stale=await api.runControllerStage(base('panel-claim',contract),{...late,
    captureRawBurst:async()=>({frames:[late.fresh(replay.frames[1])],status:'complete'}),
    deriveRawFrames:async(batch:any)=>{await late.dispatch({type:'wait',ms:5100} as any);return batch.frames;},
  } as any);
  assert.notEqual(stale.status,'receipt');
  assert.equal(late.actions.filter(x=>x==='tap').length,1);
});

test('panel capture uses explicit measured frame count and rejects invalid policy before tap',async()=>{
 const api=(await load())!,contract=await buildPanelClaimContract(root),replay=await loadPanelClaimReplay(contract);
 const d=fakeDevice([replay.frames[0],replay.frames.at(-1)!]);let request:any;
 const result=await api.runControllerStage({...base('panel-claim',contract),capturePolicy:{frames:2,intervalMs:250}} as any,{...d,captureTransient:async r=>{request=r;return d.fresh(replay.frames[1]);}});
 assert.equal(result.status,'receipt',result.reason);assert.equal(request.frames,2);assert.equal(request.maxMs,2000);
 for(const frames of [0,9,1.5]){const bad=fakeDevice(replay.frames);const r=await api.runControllerStage({...base('panel-claim',contract),capturePolicy:{frames,intervalMs:250}} as any,{...bad,captureTransient:async()=>bad.fresh(replay.frames[1])});assert.equal(r.status,'stopped');assert.equal(bad.actions.length,0);}
});

test('scope and exact selected target gate run before observation; absent fast capture refuses claim', async () => {
  const api = (await load())!, contract = await buildPanelClaimContract(root);
  const replay = await loadPanelClaimReplay(contract);
  for (const change of [{ task: { name: '任务到访得金币', instruction: '每日来任务面板 ' } },
    { package: 'other.app' }, { scope: { ...scope, userId: -1 } }, { sessionId: '' }]) {
    const device = fakeDevice(replay.frames); let observed = 0;
    const result = await api.runControllerStage({ ...base('panel-claim', contract), ...change }, { ...device, observe: async () => { observed++; return device.observe(); } });
    assert.equal(result.status, 'stopped'); assert.equal(observed, 0); assert.equal(device.actions.length, 0);
  }
  const d = fakeDevice(replay.frames);
  assert.equal((await api.runControllerStage(base('panel-claim', contract), d)).status, 'needsLearning');
  assert.equal(d.actions.length, 0);
});

test('unknown dispatch and unknown planner result remain durably stopped across adapter restarts', async () => {
  const api = (await load())!, contract = await buildPanelClaimContract(root), replay = await loadPanelClaimReplay(contract);
  for (const unknownDispatch of [true, false]) {
    const d = fakeDevice(replay.frames); let taps = 0;
    const deps = { ...d, captureTransient: async () => d.fresh(replay.frames[1]),
      observe: unknownDispatch ? d.observe : async () => ({ ...await d.observe(), package: 'other.app' }),
      dispatch: async (action: any) => { if (action.type === 'tap') { taps++; throw Error('transport uncertain'); } } };
    const result = await api.runControllerStage(base('panel-claim', contract), deps);
    assert.equal(result.status, 'unknown');
    assert.equal(result.state.controller?.status, 'unknown');
    const resumed = await api.runControllerStage({ ...base('panel-claim', contract), initialState: result.state }, { ...d, captureTransient: async () => d.fresh(replay.frames[1]) });
    assert.equal(resumed.status, 'unknown'); assert.equal(d.actions.length, 0); assert.equal(taps, unknownDispatch ? 1 : 0);
  }
});

test('original shop replay selects first fresh card and rejects historical unproven second-card ownership', async () => {
  const api = (await load())!, c = await buildShopBrowseContract(root), r = await loadShopBrowseReplay(c);
  const d = fakeDevice(r.frames);
  const result = await api.runControllerStage(base('shop-browse', c), d);
  assert.equal(result.status, 'unknown');
  assert.equal((result.state as any).selectedCardName, '阿道夫子慕专卖店');
  assert.equal((result.state as any).selected.name, '阿道夫子慕专卖店');
  assert.deepEqual(d.actions, ['tap', 'wait', 'tap', 'wait']);
  assert.equal(result.receipt, undefined);
});

// Real original card pixels/OCR are moved together to put the observed child first.
// This is a derived integration fixture, never evidence that historical entry was owned.
async function reorderedList(list: DeviceFrame, path: string): Promise<DeviceFrame> {
  const parts = await Promise.all([510, 1055].map(top => sharp(list.path).extract({ left: 90, top, width: 950, height: 110 }).png().toBuffer()));
  await sharp(list.path).composite([{ input: parts[1], left: 90, top: 510 }, { input: parts[0], left: 90, top: 1055 }]).png().toFile(path);
  const lines = list.lines.map(line => {
    const top = line.bounds[1];
    const dy = top >= 510 && top < 620 ? 545 : top >= 1055 && top < 1165 ? -545 : 0;
    return { ...line, bounds: line.bounds.map((n, i) => n + (i % 2 ? dy : 0)) };
  });
  return { ...list, path, lines, page: { derived: true, original: list.page, transform: 'swap two original card name/button strips' } };
}

test('derived original-PNG shop chain includes bounded gesture, both real receipt layers, and return to activity', async () => {
  const api = (await load())!, c = await buildShopBrowseContract(root), r = await loadShopBrowseReplay(c);
  const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/controller-replay-');
  try {
    const list = await reorderedList(r.frames[1], join(dir, 'reordered.png'));
    const d = fakeDevice([r.frames[0], list, ...r.frames.slice(2)]);
    const result = await api.runControllerStage({ ...base('shop-browse', c), learningBudget: { status: 'candidate', maxGestures: 1, gestureMs: 900, observationBudgetMs: 10000 } }, d);
    assert.equal(result.status, 'receipt', result.reason);
    assert.deepEqual(d.actions, ['tap', 'wait', 'tap', 'wait', 'swipe', 'back', 'back']);
    assert.equal((result.state as any).phase, 'awaitSettlement');
    assert.ok(result.receipt && 'layers' in result.receipt);
    assert.deepEqual(result.receipt.layers.map(x => x.layer), ['store', 'shopList']);
    assert.equal(result.receipt.returnedToActivity, true);
    assert.equal('amount' in result.receipt, false);
    assert.equal(result.stages[0].actions.length, 5);
    assert.ok(result.stages[0].actions.every(a => a.status === 'verified'));
    assert.equal(result.stages[0].usedScriptVersion, c.version);
    for (const [i, action] of result.stages[0].actions.entries()) {
      const saved = d.events.filter(e => e.type === 'controller_state');
      assert.ok(saved[i]?.state, `reservation exists for ${action.proposal.action?.type}`);
    }
    const noBudget = fakeDevice([r.frames[0], list, ...r.frames.slice(2)]);
    const missing = await api.runControllerStage(base('shop-browse', c), noBudget);
    assert.equal(missing.status, 'needsLearning'); assert.equal(noBudget.actions.includes('swipe'), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
