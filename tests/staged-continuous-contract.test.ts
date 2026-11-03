import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const owner = { package: 'com.taobao.taobao', userId: 0 };
const fixture = (directory: string, id: string) => ({
  ...JSON.parse(readFileSync(new URL(`../evidence/${directory}/${id}.json`, import.meta.url), 'utf8')),
  path: new URL(`../evidence/${directory}/${id}.png`, import.meta.url).pathname,
});
const twenty = () => fixture('staged-2026-11-01T11-30-56-472Z', 'd974083a-8310-49d9-ac1d-7ccc99bd511c');
const twentyFive = () => fixture('staged-2026-11-01T11-01-03-757Z', '3b776de9-f796-4337-875e-f1aec45bfb17');
const fifty = () => fixture('continuous-supervised-2026-11-01T05-18-43-216Z', 'bfbc7cc8-510d-4133-82f7-1a432fa97af7');
const completed = () => fixture('continuous-supervised-2026-11-01T05-18-43-216Z', '17cbd398-0659-40fc-90d7-79d3ee3c188f');
const load = async () => {
  const url = new URL('../runner/staged/continuous-contract.ts', import.meta.url);
  assert.ok(existsSync(url), 'unique full-frame contract selector must exist');
  return import(url.href);
};

test('187 and 153 original full frames select different budgets; completed frame cannot select', async () => {
  const { selectContinuousContract } = await load();
  const longer = await selectContinuousContract(twentyFive(), owner);
  assert.deepEqual(longer?.option, { rewardCoins: 50, requiredMs: 25000 });
  assert.deepEqual(longer.budget, { maxSwipes: 30, maxMs: 35000, requiredMs: 25000 });
  assert.equal(longer.provenance[0].sourceRunId, 187);
  const legacy = await selectContinuousContract(fifty(), owner);
  assert.deepEqual(legacy?.option, { rewardCoins: 50 });
  assert.deepEqual(legacy.budget, { maxSwipes: 16, maxMs: 18000 });
  assert.equal(legacy.provenance[0].sourceRunId, 153);
  assert.equal(await selectContinuousContract(completed(), owner), null);
});

test('wrong owner, new 26 seconds and OCR/pixel conflicts reject', async () => {
  const { selectContinuousContract } = await load();
  assert.equal(await selectContinuousContract(twenty(), { ...owner, userId: 999 }), null);
  assert.equal(await selectContinuousContract(twenty(), { ...owner, package: 'wrong.app' }), null);
  const changed = twentyFive();
  changed.lines = changed.lines.map((l: any) => l.text.includes('浏览25秒') ? { ...l, text: '浏览26秒可领币50～' } : l);
  assert.equal(await selectContinuousContract(changed, owner), null);
  const forged = twenty();
  forged.lines = forged.lines.map((l: any) => l.text.includes('浏览10秒') ? { ...l, text: '浏览10秒可领币50～' } : l);
  assert.equal(await selectContinuousContract(forged, owner), null);
});

test('ambiguity injection exercises all full-frame candidates and fails closed', async () => {
  const { selectContinuousContract } = await load();
  const frame = twenty(), options: any[] = [];
  assert.equal(await selectContinuousContract(frame, owner, { inspect: async (f: any, o: any, option: any) => {
    assert.equal(f, frame); assert.equal(o, owner); options.push(option);
    return { state: 'browsing', version: 'synthetic-negative-only' };
  } }), null);
  assert.deepEqual(options, [{ rewardCoins: 50, requiredMs: 25000 }, { rewardCoins: 20 }, { rewardCoins: 50 }]);
});

test('later frames use locked 20 with real 194 completion; unknown components still need learning', async () => {
  const { selectContinuousContract, inspectSelectedContinuousContract } = await load();
  const locked20 = await selectContinuousContract(twenty(), owner);
  const real = fixture('staged-2026-11-01T11-50-22-744Z', '1c143332-c14b-48b1-97a0-18124fc338d3');
  const accepted = await inspectSelectedContinuousContract(real, owner, locked20);
  assert.equal(accepted.inspection?.state, 'completed');
  assert.equal(accepted.inspection?.rewardCoins, 20);
  assert.equal(accepted.needsLearning, false);
  assert.ok(locked20.provenance.some((s: any) => s.sourceRunId === 194 && s.role === 'learned'));
  assert.equal(await selectContinuousContract(real, owner), null);
  const receipt = completed();
  receipt.lines = receipt.lines.map((l: any) => l.text.includes('已得') ? { ...l, text: '•已得币20|下单再得币500' } : l);
  const result = await inspectSelectedContinuousContract(receipt, owner, locked20);
  assert.equal(result.inspection, null);
  assert.equal(result.needsLearning, true);
  assert.equal((await inspectSelectedContinuousContract(fifty(), owner, locked20)).inspection, null);
  const locked25 = await selectContinuousContract(twentyFive(), owner);
  assert.equal((await inspectSelectedContinuousContract(completed(), owner, locked25)).inspection.state, 'completed');
  assert.equal((await inspectSelectedContinuousContract(fifty(), owner, locked25)).inspection, null);
  assert.equal((await inspectSelectedContinuousContract(twenty(), { ...owner, userId: 999 }, locked20)).inspection, null);
  assert.equal((await inspectSelectedContinuousContract(twenty(), owner, { ...locked20 })).inspection, null);
});

test('192 real 20 landing uniquely selects explicit 171 contract without task metadata', async () => {
  const { selectContinuousContract } = await load();
  const frame = twenty(), before = JSON.stringify(frame);
  const selected = await selectContinuousContract(frame, owner);
  assert.ok(selected);
  assert.deepEqual(selected.option, { rewardCoins: 20 });
  assert.equal(selected.inspection.state, 'browsing');
  assert.deepEqual(selected.budget, { maxSwipes: 16, maxMs: 18000 });
  assert.equal(selected.provenance[0].sourceRunId, 171);
  assert.ok(selected.provenance.some((s: any) => s.sourceRunId === 192 && s.role === 'regression'));
  for (const s of selected.provenance) for (const [extension, expected] of [['png', s.pngSha256], ['json', s.jsonSha256]]) {
    const bytes = readFileSync(new URL(`../evidence/${s.directory}/${s.frameId}.${extension}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
  assert.equal(JSON.stringify(frame), before);
});
