import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { DeviceFrame } from '../runner/staged/device.ts';
import type { CandidateOwner, PanelClaimState } from '../runner/staged/panel-claim.ts';

const root = new URL('../', import.meta.url).pathname;
const load = () => import('../runner/staged/panel-claim.ts').catch(() => null);

test('128: real original PNG/OCR gives one current-row claim and image-backed missed-OCR receipt', async () => {
  const api = await load();
  assert.ok(api?.planPanelClaim, 'missing executable pure panel claim planner');
  const contract = await api.buildPanelClaimContract(root);
  const replay = await api.loadPanelClaimReplay(contract);
  const [entry, toast, after] = replay.frames;
  assert.equal(toast.lines.some(l => /任务完成/.test(l.text)), false, 'original OCR must stay unchanged');
  const owner = (frame: any) => ({ package: 'com.taobao.taobao', userId: 0, taskAttemptId: replay.taskAttemptId, now: frame.capturedAt });
  const initial = api.createPanelClaimState(contract, replay.taskAttemptId, 1430);
  const claim = await api.planPanelClaim(entry, owner(entry), initial);
  assert.equal(claim.kind, 'action');
  assert.equal(claim.action?.type, 'tap');
  assert.ok(claim.captureBudget!.frames * claim.captureBudget!.intervalMs >= toast.capturedAt - entry.capturedAt,
    'fast capture window must cover the observed original toast latency');
  assert.equal(initial.phase, 'ready', 'caller state is immutable');
  const repeated = await api.planPanelClaim(entry, owner(entry), claim.nextState);
  assert.equal(repeated.action, undefined, 'dispatch intent consumes the one-shot before runtime taps');
  const receipt = await api.planPanelClaim(toast, owner(toast), claim.nextState);
  assert.equal(receipt.kind, 'receipt');
  assert.equal(receipt.receipt?.quote, '任务完成！获得10淘金币');
  assert.equal(receipt.receipt?.method, 'png-component-template');
  assert.equal(receipt.receipt?.frameId, toast.id);
  assert.match(receipt.receipt?.pngSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(receipt.action, undefined);
  const settle = await api.planPanelClaim(after, owner(after), receipt.nextState);
  assert.equal(settle.kind, 'observe', 'one post-claim balance is not stable settlement');
  assert.equal(settle.action, undefined);
});

test('arrival rejects wrong provenance, stale/duplicate row, unreadable and occluded real PNG; cannot claim visible toast initially', async () => {
  const api = (await load())!;
  const c = await api.buildPanelClaimContract(root);
  const replay = await api.loadPanelClaimReplay(c);
  const [entry, toast, after] = replay.frames;
  const owner = { package: entry.package, userId: 0, taskAttemptId: replay.taskAttemptId, now: entry.capturedAt };
  const initial = api.createPanelClaimState(c, replay.taskAttemptId, 1430);
  const proposed = await api.planPanelClaim(entry, owner, initial);
  for (const [f, o, s] of [
    [entry, { ...owner, taskAttemptId: 'other' }, initial],
    [entry, { ...owner, now: owner.now + 5001 }, initial],
    [{ ...entry, userId: 10 }, owner, initial],
    [{ ...entry, path: '/missing/image.png' }, owner, initial],
    [{ ...entry, lines: [...entry.lines, entry.lines.find(l => /任务到访/.test(l.text))!] }, owner, initial],
    [toast, { ...owner, now: toast.capturedAt }, { ...proposed.nextState, entry: { ...proposed.nextState.entry!, frameId: toast.id } }],
    [after, { ...owner, now: after.capturedAt }, proposed.nextState],
  ] as [DeviceFrame, CandidateOwner, PanelClaimState][]) {
    const plan = await api.planPanelClaim(f, o, s);
    assert.equal(plan.kind, 'unknown');
    assert.equal(plan.action, undefined);
    assert.equal(plan.receipt, undefined);
  }
  const preexisting = await api.planPanelClaim(toast, { ...owner, now: toast.capturedAt }, initial);
  assert.equal(preexisting.action, undefined, 'preexisting success toast cannot authorize a new claim');
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/panel-claim-');
  try {
    const path = join(directory, 'covered.png');
    await sharp(toast.path).composite([{ input: { create: { width: 540, height: 210, channels: 3, background: '#ffffff' } }, left: 270, top: 930 }]).png().toFile(path);
    const plan = await api.planPanelClaim({ ...toast, path }, { ...owner, now: toast.capturedAt }, proposed.nextState);
    assert.equal(plan.receipt, undefined, 'stale OCR cannot recover covered toast');
    assert.equal(plan.action, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
