import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPanelClaimContract, createPanelClaimState, planPanelClaim, sha256 } from '../runner/staged/panel-claim.ts';
import { createControllerRoute } from '../runner/staged/controller-route.ts';
import { runActivitySession } from '../runner/staged/session.ts';
import { readPanel, stableSettlement } from '../runner/staged/observations.ts';
const root = new URL('../', import.meta.url).pathname;
const evidence = join(root, 'evidence/supervised-current-2026-11-03T00-24-30-907Z');
const task = { name: '任务到访得金币', instruction: '每日来任务面板' };
const load = async (id: string) => JSON.parse(await readFile(join(evidence, `${id}.json`), 'utf8'));
const owner = (frame: any) => ({ package: frame.package, userId: 0, taskAttemptId: 'semantic-attempt', now: frame.capturedAt, executionPolicy: 'development-unbounded-v1' as const });
const initial = async (selected = task) => createPanelClaimState(await buildPanelClaimContract(root), 'semantic-attempt', 2675, { policy: 'current-semantic-v1', task: selected });

test('saved current panel locates selected claim by current row semantics instead of historical coordinates', async () => {
 const frame = await load('74573ea6-cd52-48de-acda-106927ab46e6');
 const state = await initial();
 const plan = await planPanelClaim(frame, owner(frame), state);
 assert.equal(plan.kind, 'action', plan.reason);
 const button = frame.lines.find((line: any) => line.text === '领取奖励').bounds;
 assert.deepEqual(plan.action, { type: 'tap', x: Math.round((button[0]+button[2])/2), y: Math.round((button[1]+button[3])/2) });
 assert.equal(plan.nextState.phase, 'awaitReceipt');
 assert.equal(state.phase, 'ready');
 assert.equal((await planPanelClaim(frame, owner(frame), plan.nextState)).action, undefined);
 const noisy = { ...frame, lines: [...frame.lines, { text: '无关促销文字', bounds: [-12, 2000, 1200, 2401] }] };
 assert.equal((await planPanelClaim(noisy, owner(noisy), state)).kind, 'action', 'unrelated invalid OCR is observation only');
 for (const mutate of [
   (f: any) => { f.lines.push(f.lines.find((l: any) => l.text === '领取奖励')); },
   (f: any) => { f.lines.find((l: any) => l.text === '领取奖励').bounds[0] = -1; },
   (f: any) => { f.lines.find((l: any) => /任务到访/.test(l.text)).text = '任务到访得金币（1/1）'; },
   (f: any) => { f.userId = 10; },
   (f: any) => { f.lines.push({ text: '请先登录', bounds: [100, 100, 400, 200] }); f.ocrObservation = undefined; },
 ]) {
   const f = structuredClone(frame); mutate(f);
   assert.equal((await planPanelClaim(f, owner(frame), state)).action, undefined);
 }
});

test('current receipt replays the archived original-image observation with original frame and attempt binding', async () => {
 const frame = await load('74573ea6-cd52-48de-acda-106927ab46e6');
 const claim = await planPanelClaim(frame, owner(frame), await initial());
 const acceptance = await load('supervised-acceptance');
 const supervision = await load('supervision');
 const raw = supervision.burst.frames.find((f: any) => f.id === acceptance.result.receipt.frameId);
 const receiptFrame = { id: raw.id, path: raw.path, capturedAt: raw.capturedAt, package: raw.owner.package, userId: raw.owner.userId, width: raw.width, height: raw.height, lines: [] };
 const { sha256 } = await import('../runner/staged/panel-claim.ts');
 const observation = { frameId: raw.id, pngSha256: raw.pngSha256, taskAttemptId: 'semantic-attempt', isPanel: true, blocked: false,
   quote: acceptance.result.receipt.quote, evidence: { path: join(evidence, 'supervised-acceptance.json'), sha256: sha256(await readFile(join(evidence, 'supervised-acceptance.json'))) } };
 let calls = 0;
 const receipt = await planPanelClaim(receiptFrame, owner(receiptFrame), claim.nextState, { readReceipt: async request => {
   calls++; assert.equal(request.frame.path, raw.path); assert.deepEqual(request.task, task); assert.equal(request.taskAttemptId, 'semantic-attempt'); return observation;
 } });
 assert.equal(calls, 1);
 assert.equal(receipt.kind, 'receipt', receipt.reason);
 assert.equal(receipt.receipt?.quote, acceptance.result.receipt.quote);
 assert.equal(receipt.receipt?.method, 'original-image-observer');
 assert.equal(receipt.receipt?.pngSha256, raw.pngSha256);
 assert.equal(receipt.action, undefined);
 const after = await load('76b036a9-a609-44b6-a24e-5baa7f9252f7');
 assert.equal((await planPanelClaim(after, owner(after), receipt.nextState)).kind, 'observe');
 const missing = await planPanelClaim(receiptFrame, owner(receiptFrame), claim.nextState);
 assert.equal(missing.kind, 'needsLearning');
 assert.equal(missing.receipt, undefined);
 for (const change of [ { taskAttemptId: 'other' }, { frameId: 'other' }, { pngSha256: '0'.repeat(64) }, { blocked: true }, { isPanel: false }, { quote: '如果任务完成后可获得10淘金币' }, { quote: '+10' }, { evidence: { path: observation.evidence.path, sha256: '0'.repeat(64) } } ]) {
   const rejected = await planPanelClaim(receiptFrame, owner(receiptFrame), claim.nextState, { readReceipt: async () => ({ ...observation, ...change }) });
   assert.equal(rejected.receipt, undefined); assert.equal(rejected.action, undefined);
 }
 const deniedOwner = { ...owner(receiptFrame), userId: 10 };
 let forbiddenReads = 0;
 const denied = await planPanelClaim(receiptFrame, deniedOwner, claim.nextState, { readReceipt: async () => { forbiddenReads++; return observation; } });
 assert.equal(denied.receipt, undefined); assert.equal(forbiddenReads, 0);
});

test('current claim traverses real controller and session return/settlement with one dispatch and two saved balances', async () => {
 const entry = await load('74573ea6-cd52-48de-acda-106927ab46e6');
 const samples = await Promise.all(['e313371d-7d99-4caf-9709-3b4bf2bbd1eb','76b036a9-a609-44b6-a24e-5baa7f9252f7'].map(load));
 const acceptance = await load('supervised-acceptance'), supervision = await load('supervision');
 const raw = supervision.burst.frames.find((f: any) => f.id === acceptance.result.receipt.frameId);
 const toast = { id: raw.id, path: raw.path, capturedAt: raw.capturedAt, package: raw.owner.package, userId: raw.owner.userId, width: raw.width, height: raw.height, lines: [] };
 const contract = await buildPanelClaimContract(root), scope = acceptance.session.scope;
 let clock = entry.capturedAt, tapped = false, sampleIndex = 0;
 const actions: any[] = [], events: any[] = [];
 const route = createControllerRoute({ sessionId: 'offline-current', scope, package: entry.package, executionPolicy: 'development-unbounded-v1',
   budget: { maxMs: 1, maxActions: 1, maxAgentCalls: 0 }, candidates: [{ family: 'panel-claim', task, contract, panelClaimPolicy: 'current-semantic-v1' }] }, {
   now: () => clock,
   observe: async () => { const frame = tapped ? samples[Math.min(sampleIndex++, 1)] : entry; clock = Math.max(clock, frame.capturedAt); return frame; },
   dispatch: async action => { actions.push(action); tapped = true; }, persist: async event => { events.push(event); },
   captureBurst: async () => { clock = toast.capturedAt + 60000; return [toast]; },
   readPanelReceipt: async request => ({ frameId: request.frame.id, pngSha256: request.pngSha256, taskAttemptId: request.taskAttemptId,
     isPanel: true, blocked: false, quote: acceptance.result.receipt.quote,
     evidence: { path: join(evidence, 'supervised-acceptance.json'), sha256: sha256(await readFile(join(evidence, 'supervised-acceptance.json'))) } }),
 });
 let settled = 0;
 const result = await runActivitySession({ id: 'offline-current', scope, evidenceDir: 'offline', startedAt: 'replay' }, {
   prepare: async () => {}, cleanup: async () => {}, save: async () => ({ runId: 0 }), stage: async (id, ctx) => {
     const routed = await route.stage(id, ctx); if (routed) return routed;
     if (id === 'select_task') return { status: 'completed', task, balanceBefore: 2675 };
     if (id === 'settle') {
       assert.equal(ctx.receipt.path, toast.path); assert.equal(ctx.receipt.taskAttemptId, ctx.taskAttemptId);
       const settlement = stableSettlement({ before: readPanel(entry).tasks.find(t => t.name === task.name)!, balanceBefore: ctx.balanceBefore,
         receipt: !!ctx.receipt, samples: samples.map(f => ({ ...readPanel(f), task: undefined })) });
       assert.equal(settlement.ok, true); assert.equal(settlement.delta, 10); settled++;
       return { status: 'completed', balanceAfter: settlement.balance };
     }
     return { status: 'completed' };
   },
 });
 assert.equal(result.status, 'completed', result.error);
 assert.equal(settled, 1); assert.equal(result.balanceAfter, 2685);
 assert.equal(actions.filter(a => a.type !== 'wait').length, 1); assert.equal(actions[0].type, 'tap');
 assert.ok(events.some(e => e.type === 'controller_state' && e.state.phase === 'awaitReceipt'));
 assert.ok(events.some(e => e.type === 'controller_route_return_verified'));
 const records = route.snapshot();
 const record = records[0];
 const damaged = { ...record.result!.receipt, quote: '任务完成！获得999淘金币' };
 record.result!.receipt = damaged as any;
 (record.result!.state as any).receipt = damaged;
 const restored = createControllerRoute({ sessionId: 'offline-current', scope, package: entry.package, executionPolicy: 'development-unbounded-v1',
   budget: { maxMs: 1, maxActions: 1, maxAgentCalls: 0 }, candidates: [{ family: 'panel-claim', task, contract, panelClaimPolicy: 'current-semantic-v1' }], initialRecords: records }, {
   now: () => clock, observe: async () => samples[1], dispatch: async () => { throw Error('must not redispatch'); }, persist: async () => {},
 });
 assert.equal((await restored.stage('task_receipt', { id: 'offline-current', scope, task, taskAttemptId: result.taskAttemptId, balanceBefore: 2675 })).status, 'unknown');
});
