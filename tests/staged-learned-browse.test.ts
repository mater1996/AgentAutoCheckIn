import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const successful = new URL('../evidence/continuous-supervised-2026-11-01T05-18-43-216Z/', import.meta.url);
const candidate = new URL('../evidence/staged-2026-11-01T06-31-13-908Z/', import.meta.url);
const fixture = (directory: URL, id: string) => ({
  ...JSON.parse(readFileSync(new URL(id + '.json', directory), 'utf8')),
  path: new URL(id + '.png', directory).pathname,
});
const entry = () => fixture(successful, 'bfbc7cc8-510d-4133-82f7-1a432fa97af7');
const owner = { package: 'com.taobao.taobao', userId: 0 };
const completed = () => fixture(successful, '17cbd398-0659-40fc-90d7-79d3ee3c188f');
// Duplicated offline replay: new id/time does not claim an independent capture.
const recapture = (frame: any) => ({ ...structuredClone(frame), id: frame.id + '-duplicated-replay', capturedAt: frame.capturedAt + 20000 });
const load = async () => {
  const module = new URL('../runner/staged/learned-browse.ts', import.meta.url);
  assert.ok(existsSync(module), 'Implement the learned browse inspector');
  return import(module.href);
};

const run171 = new URL('../evidence/staged-2026-11-01T08-46-52-728Z/', import.meta.url);
const twenty = () => fixture(run171, '84707f78-82f4-414c-9664-d72f8e681624');
const run187 = new URL('../evidence/staged-2026-11-01T11-01-03-757Z/', import.meta.url);
const twentyFive = () => fixture(run187, '3b776de9-f796-4337-875e-f1aec45bfb17');
const options25 = { rewardCoins: 50, requiredMs: 25000 } as const;
const run194 = new URL('../evidence/staged-2026-11-01T11-50-22-744Z/', import.meta.url);
const completed20 = () => fixture(run194, '1c143332-c14b-48b1-97a0-18124fc338d3');

test('194 original complete 20 component requires explicit reward contract', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = completed20(), before = JSON.stringify(frame);
  const result = await inspectLearnedBrowse(frame, owner, { rewardCoins: 20 });
  assert.equal(result?.state, 'completed');
  assert.equal(result.rewardCoins, 20);
  assert.equal(result.quote, '已得币20|下单再得币500');
  assert.equal(result.action, undefined);
  assert.equal(JSON.stringify(frame), before);
  assert.equal(await inspectLearnedBrowse(frame, owner), null);
  assert.equal(await inspectLearnedBrowse(frame, owner, { rewardCoins: 50 }), null);
  assert.equal(await inspectLearnedBrowse(frame, owner, options25), null);
});

test('194 complete 20 keeps exact OCR, owner, whole header, badge and content gates', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = completed20(), options = { rewardCoins: 20 } as const;
  const receipt = frame.lines.find((l: any) => l.text.includes('已得'));
  for (const change of [
    { package: 'other' }, { userId: 999 }, { observationError: 'OCR failure' },
    { lines: frame.lines.filter((l: any) => l !== receipt) },
    { lines: [...frame.lines, receipt] },
    { lines: frame.lines.filter((l: any) => l.text !== '金币热卖价') },
    { path: completed().path }, { path: twenty().path },
    ...['已得币50|下单再得币500', '已得币500|下单再得币500', '下单再得币500',
      '已得币20', '已得币020|下单再得币500', '已得币20|下单再得币5000'].map(text => ({
      lines: frame.lines.map((l: any) => l === receipt ? { ...l, text } : l),
    })),
    ...['请登录', '安全验证', '确认', '任务列表'].map(text => ({
      lines: [...frame.lines, { text, bounds: [100, 800, 600, 850] }],
    })),
  ]) assert.equal(await inspectLearnedBrowse({ ...frame, ...change }, owner, options), null, JSON.stringify(change));
  assert.equal(await inspectLearnedBrowse(frame, { ...owner, userId: 999 }, options), null);
  const wrong50 = frame.lines.map((l: any) => l === receipt ? { ...l, text: '已得币50|下单再得币500' } : l);
  assert.equal(await inspectLearnedBrowse({ ...frame, lines: wrong50 }, owner, { rewardCoins: 50 }), null);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-194-');
  try {
    // Synthetic negative occlusions only; original PNG/OCR remain immutable.
    for (const [i, region] of [
      { left: 420, top: 154, width: 200, height: 55 },
      { left: 620, top: 154, width: 90, height: 55 },
      { left: 800, top: 154, width: 220, height: 55 },
      { left: 334, top: 499, width: 176, height: 30 },
      { left: 327, top: 2233, width: 176, height: 30 },
      { left: 100, top: 800, width: 880, height: 700 },
    ].entries()) {
      const path = join(directory, `synthetic-overlay-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: { width: region.width,
        height: region.height, channels: 3, background: '#ffffff' } }, left: region.left, top: region.top }]).png().toFile(path);
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner, options), null, `194 overlay ${i}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('190 real independent captures revalidate unchanged content despite merchandise OCR jitter', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const run190 = new URL('../evidence/staged-2026-11-01T11-17-14-195Z/', import.meta.url);
  const old = fixture(run190, 'e2d357a1-52e5-430b-bf07-283aa074022f');
  const fresh = fixture(run190, 'e0fdd0c1-426d-472a-ae31-3b83c37c4924');
  const before = JSON.stringify([old, fresh]);
  const content = (f: any) => f.lines.filter((l: any) => l.bounds[1] >= 260 && l.bounds[3] <= 2280);
  assert.equal(content(old).length, 61);
  assert.equal(content(fresh).length, 61);
  assert.notDeepEqual(content(old), content(fresh));
  const crop = (path: string) => sharp(path).extract({ left: 0, top: 260, width: 1080, height: 2020 })
    .removeAlpha().toColourspace('srgb').raw().toBuffer();
  assert.deepEqual(await crop(old.path), await crop(fresh.path));
  const first = await inspectLearnedBrowse(old, owner, options25);
  const second = await inspectLearnedBrowse(fresh, owner, options25);
  assert.equal(first?.state, 'browsing');
  assert.equal(second?.state, 'browsing');
  assert.deepEqual(first.action, second.action);
  const renewed = await revalidateLearnedBrowse(old, fresh, first.action, owner, options25);
  assert.ok(renewed, 'unchanged pixels and independently valid page contracts must survive OCR jitter');
  assert.deepEqual(renewed.action, second.action);
  assert.equal(JSON.stringify([old, fresh]), before);
});

test('187 original PNG/OCR requires explicit 25-second/50 contract', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = twentyFive(), before = JSON.stringify(frame);
  const result = await inspectLearnedBrowse(frame, owner, options25);
  assert.equal(result?.state, 'browsing');
  assert.equal(result.requiredMs, 25000);
  assert.equal(result.observedRemainingMs, 25000);
  assert.equal(result.rewardCoins, 50);
  assert.equal(result.version, 'learned-browse-187-25-v1');
  assert.equal(JSON.stringify(frame), before);
  assert.equal(await inspectLearnedBrowse(frame, owner), null);
  assert.equal(await inspectLearnedBrowse(frame, owner, { rewardCoins: 50 }), null);
  assert.equal(await inspectLearnedBrowse(frame, owner, { rewardCoins: 20 }), null);
});

test('187 explicit contract revalidates only fresh continuous frames under the same options', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const old = twentyFive();
  const action = (await inspectLearnedBrowse(old, owner, options25)).action;
  // Synthetic duplicated replay; 187 has no independent second capture here.
  const fresh = recapture(old);
  assert.ok(await revalidateLearnedBrowse(old, fresh, action, owner, options25));
  assert.equal(await revalidateLearnedBrowse(old, fresh, action, owner), null);
  assert.equal(await revalidateLearnedBrowse(old, fresh, action, owner, { rewardCoins: 50 }), null);
  assert.equal(await revalidateLearnedBrowse(old, old, action, owner, options25), null);
  assert.equal(await revalidateLearnedBrowse(old, { ...fresh, capturedAt: old.capturedAt }, action, owner, options25), null);
  assert.equal(await revalidateLearnedBrowse(old, { ...fresh, userId: 10 }, action, owner, options25), null);
  // Synthetic OCR-only wording change over identical PNG is not a visual change.
  const changed = structuredClone(fresh);
  changed.lines.find((l: any) => l.bounds[1] > 500).text = 'changed product';
  assert.ok(await revalidateLearnedBrowse(old, changed, action, owner, options25));
  const changedLayout = structuredClone(fresh);
  const moved = changedLayout.lines.find((l: any) => l.bounds[1] > 500);
  moved.bounds = moved.bounds.map((v: number) => v + 12);
  assert.equal(await revalidateLearnedBrowse(old, changedLayout, action, owner, options25), null);
  const shifted = structuredClone(fresh);
  shifted.lines = shifted.lines.map((l: any) => ({ ...l, bounds: l.bounds.map((v: number) => v + 1) }));
  const renewed = await revalidateLearnedBrowse(old, shifted, action, owner, options25);
  assert.ok(renewed);
  assert.equal(renewed.action.fromX, action.fromX + 1);
  assert.equal(renewed.action.toY, action.toY + 1);
});

test('187 rejects unsupported durations, rewards, mixed requirements and synthetic wrong OCR', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const frame = twentyFive();
  const requirement = frame.lines.find((l: any) => l.text.includes('浏览25秒'));
  assert.ok(requirement);
  const action = (await inspectLearnedBrowse(frame, owner, options25)).action;
  // Synthetic OCR mutations preserve the original PNG; none are new captures.
  for (const quote of [
    ...Array.from({ length: 25 }, (_, n) => `浏览${n}秒可领币50～`),
    '浏览26秒可领币50～', '浏览025秒可领币50～', '浏览25秒可领币20～',
    '浏览25秒可领币500～', '浏览25秒可领币50～下单500', '浏览25秒可领市50～',
  ]) {
    const wrong = { ...frame, lines: frame.lines.map((l: any) => l === requirement ? { ...l, text: quote } : l) };
    assert.equal(await inspectLearnedBrowse(wrong, owner, options25), null, quote);
    assert.equal(await revalidateLearnedBrowse(frame, recapture(wrong), action, owner, options25), null, quote);
  }
  for (const options of [{ rewardCoins: 20, requiredMs: 25000 }, { rewardCoins: 50, requiredMs: 26000 },
    { rewardCoins: 50, requiredMs: 0 }])
    assert.equal(await inspectLearnedBrowse(frame, owner, options), null);
  for (const extra of ['浏览10秒可领币50～', '浏览25秒可领币20～', '请登录', '确认'])
    assert.equal(await inspectLearnedBrowse({ ...frame, lines: [...frame.lines,
      { text: extra, bounds: [100, 800, 900, 850] }] }, owner, options25), null);
  assert.equal(await inspectLearnedBrowse(entry(), owner, options25), null);
  assert.equal(await inspectLearnedBrowse(twenty(), owner, options25), null);
  // A forged 50 OCR amount over the original 20 image still fails pixels.
  const wrongAmount = twenty();
  wrongAmount.lines = wrongAmount.lines.map((l: any) => l.text.includes('浏览10秒')
    ? { ...l, text: '浏览25秒可领币50～' } : l);
  assert.equal(await inspectLearnedBrowse(wrongAmount, owner, options25), null);
});

test('187 keeps original header, badge and content occlusion gates', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const frame = twentyFive(), action = (await inspectLearnedBrowse(frame, owner, options25)).action;
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-187-');
  try {
    // Synthetic occlusions over original PNG, with unchanged OCR.
    for (const [i, region] of [
      { left: 896, top: 136, width: 72, height: 60 },
      { left: 714, top: 145, width: 12, height: 35 },
      { left: 554, top: 199, width: 400, height: 35 },
      { left: 334, top: 974, width: 176, height: 30 },
      { left: 100, top: 800, width: 880, height: 700 },
    ].entries()) {
      const path = join(directory, `synthetic-overlay-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: { width: region.width,
        height: region.height, channels: 3, background: '#ffffff' } },
        left: region.left, top: region.top }]).png().toFile(path);
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner, options25), null, `overlay ${i}`);
      assert.equal(await revalidateLearnedBrowse(frame, { ...recapture(frame), path }, action, owner, options25), null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('25 options reuse only the original 153 completed-50 component, not a claimed 187 receipt', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = completed();
  const result = await inspectLearnedBrowse(frame, owner, options25);
  assert.equal(result?.state, 'completed');
  assert.equal(result.requiredMs, 25000);
  assert.equal(result.rewardCoins, 50);
  assert.equal(result.version, 'learned-browse-187-25-v1');
  assert.equal(result.quote, frame.lines.find((l: any) => l.text.includes('已得')).text);
  assert.equal(result.action, undefined);
  assert.equal(result.observedRemainingMs, undefined);
});

test('171 original 20 requirement is an explicit contract and revalidates its distinct real capture', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const old = twenty();
  const before = JSON.stringify(old);
  const result = await inspectLearnedBrowse(old, owner, { rewardCoins: 20 });
  assert.equal(result?.state, 'browsing');
  assert.equal(result.rewardCoins, 20);
  assert.equal(JSON.stringify(old), before);
  assert.equal(await inspectLearnedBrowse(old, owner), null);
  assert.equal(await inspectLearnedBrowse(old, owner, { rewardCoins: 50 }), null);
  const fresh = fixture(run171, '0a42b848-9006-4e8b-981d-286a9070c706');
  assert.ok(await revalidateLearnedBrowse(old, fresh, result.action, owner, { rewardCoins: 20 }));
  assert.equal(await revalidateLearnedBrowse(old, fresh, result.action, owner), null);
});

test('explicit reward contracts reject contradictory complete requirements and expose safe diagnostics', async () => {
  const { inspectLearnedBrowse, inspectLearnedBrowseDetailed } = await load();
  assert.equal(typeof inspectLearnedBrowseDetailed, 'function');
  const frame = twenty();
  const requirement = frame.lines.find((l: any) => l.text.includes('浏览10秒'));
  const conflict = { ...frame, lines: [...frame.lines, { ...requirement, text: '浏览10秒可领币50～' }] };
  assert.equal(await inspectLearnedBrowse(conflict, owner, { rewardCoins: 20 }), null);
  assert.equal((await inspectLearnedBrowseDetailed(conflict, owner, { rewardCoins: 20 })).reason, 'ambiguous_requirements');
  const wrongContract = await inspectLearnedBrowseDetailed(frame, owner);
  assert.equal(wrongContract.reason, 'unsupported_reward');
  assert.equal(wrongContract.observedRewardCoins, 20);
  const missing = { ...frame, lines: frame.lines.filter((l: any) => l !== requirement) };
  assert.equal((await inspectLearnedBrowseDetailed(missing, owner, { rewardCoins: 20 })).reason, 'requirements_missing');
  const blocked = { ...frame, lines: [...frame.lines, { text: '请登录', bounds: [100, 800, 400, 850] }] };
  assert.equal((await inspectLearnedBrowseDetailed(blocked, owner, { rewardCoins: 20 })).reason, 'blocked');
  const accepted = await inspectLearnedBrowseDetailed(frame, owner, { rewardCoins: 20 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.inspection.rewardCoins, 20);
  // Synthetic OCR mutation on an original 50 receipt is not real completed-20 evidence.
  const syntheticReceipt = completed();
  syntheticReceipt.lines = syntheticReceipt.lines.map((l: any) => l.text.includes('已得') ? { ...l, text: '•已得币20|下单再得币500' } : l);
  assert.equal(await inspectLearnedBrowse(syntheticReceipt, owner, { rewardCoins: 20 }), null);
  assert.equal((await inspectLearnedBrowseDetailed(syntheticReceipt, owner, { rewardCoins: 20 })).reason, 'image_or_component_mismatch');
});

test('20/50 contracts require exact destination amount in both OCR and original image', async () => {
  const { inspectLearnedBrowse, inspectLearnedBrowseDetailed, revalidateLearnedBrowse } = await load();
  for (const [base, rewardCoins, other] of [[twenty(), 20, entry()], [entry(), 50, twenty()]] as const) {
    const options = { rewardCoins };
    const result = await inspectLearnedBrowse(base, owner, options);
    assert.equal(result?.rewardCoins, rewardCoins);
    const requirement = base.lines.find((l: any) => l.text.includes('浏览10秒'));
    for (const amount of [rewardCoins === 20 ? '50' : '20', '500', `0${rewardCoins}`]) {
      const mutated = { ...base, lines: base.lines.map((l: any) => l === requirement ? { ...l, text: `浏览10秒可领币${amount}～` } : l) };
      assert.equal(await inspectLearnedBrowse(mutated, owner, options), null, `OCR ${amount}`);
    }
    for (const quote of ['浏览10秒', '浏览11秒可领币20～', '浏览0秒可领币20～', '浏览10秒可领币20～下单500', '浏览+20']) {
      const mutated = { ...base, lines: base.lines.map((l: any) => l === requirement ? { ...l, text: quote } : l) };
      assert.equal(await inspectLearnedBrowse(mutated, owner, options), null, quote);
    }
    // Swapping a real image while retaining current OCR must fail the amount pixels.
    const swapped = { ...base, path: other.path };
    assert.equal(await inspectLearnedBrowse(swapped, owner, options), null);
    assert.equal((await inspectLearnedBrowseDetailed(swapped, owner, options)).reason, 'image_or_component_mismatch');
    assert.equal(await revalidateLearnedBrowse(base, { ...recapture(base), path: other.path }, result.action, owner, options), null);
  }
  assert.equal(await inspectLearnedBrowse(twenty(), owner, { rewardCoins: 500 }), null);
  const baseline = await inspectLearnedBrowse(entry(), owner);
  const explicit = await inspectLearnedBrowse(entry(), owner, { rewardCoins: 50 });
  const { rewardCoins, ...compatible } = explicit;
  assert.equal(rewardCoins, 50);
  assert.deepEqual(compatible, baseline);
});

test('20 original header amount, words, badges and content remain checked with stale OCR', async () => {
  const { inspectLearnedBrowse, inspectLearnedBrowseDetailed, revalidateLearnedBrowse } = await load();
  const frame = twenty(), options = { rewardCoins: 20 };
  const action = (await inspectLearnedBrowse(frame, owner, options)).action;
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-20-');
  try {
    // Derived synthetic negatives only; never completed-20 evidence.
    for (const [i, region] of [
      { left: 896, top: 136, width: 72, height: 60 },
      { left: 714, top: 145, width: 12, height: 35 },
      { left: 554, top: 199, width: 400, height: 35 },
      { left: 334, top: 974, width: 176, height: 30 },
      { left: 100, top: 800, width: 880, height: 700 },
    ].entries()) {
      const path = join(directory, `synthetic-overlay-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: {
        width: region.width, height: region.height, channels: 3, background: '#ffffff',
      } }, left: region.left, top: region.top }]).png().toFile(path);
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner, options), null, `overlay ${i}`);
      assert.equal(await revalidateLearnedBrowse(frame, { ...recapture(frame), path }, action, owner, options), null);
    }
    const path = join(directory, 'invalid.png');
    await writeFile(path, 'invalid PNG');
    assert.equal((await inspectLearnedBrowseDetailed({ ...frame, path }, owner, options)).reason, 'image_error');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('153 and both original 155 product pages propose a content-only swipe without a task name', async () => {
  const { inspectLearnedBrowse } = await load();
  for (const frame of [entry(),
    fixture(candidate, '13b1a660-a566-445b-975d-c5c663dfd649'),
    fixture(candidate, 'd65dc20f-fa2d-44eb-9280-09f46eda12e0')]) {
    const before = JSON.stringify(frame);
    const result = await inspectLearnedBrowse(frame, owner);
    assert.equal(result?.state, 'browsing', frame.id);
    assert.ok(result.version);
    assert.equal(result.action.type, 'swipe');
    assert.equal(result.action.fromX, result.action.toX);
    assert.ok(result.action.toY > 260 && result.action.fromY < 2280);
    assert.ok(result.action.fromY - result.action.toY >= 350);
    assert.equal(JSON.stringify(frame), before);
  }
});

test('actual receipt requires 已得50 in the learned header, including coin OCR variants, and never proposes consumption', async () => {
  const { inspectLearnedBrowse } = await load();
  for (const coin of ['币', '金币', '淘金币', '市', '帀', '']) {
    const frame = completed();
    frame.lines = frame.lines.map((l: any) => l.text.includes('已得') ? { ...l, text: `•已得${coin}50｜下单再得币500灣` } : l);
    const result = await inspectLearnedBrowse(frame, owner);
    assert.equal(result?.state, 'completed', coin);
    assert.equal(result.action, undefined);
    assert.match(result.quote, /已得.*50/);
  }
  for (const quote of ['•已得币500｜下单再得币500灣', '下单再得币500', '已得币5', '已得币50｜下单再得币5000', '任务完成']) {
    const frame = completed();
    frame.lines = frame.lines.map((l: any) => l.text.includes('已得') ? { ...l, text: quote } : l);
    assert.equal(await inspectLearnedBrowse(frame, owner), null, quote);
  }
});

test('157 original completed PNG/OCR recognizes the receipt despite new merchandise and OCR top-edge jitter', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T07-17-55-917Z/', import.meta.url),
    '0cc2fc0b-c222-498a-81d1-94a812d03be7');
  const before = JSON.stringify(frame);
  const result = await inspectLearnedBrowse(frame, owner);
  assert.equal(result?.state, 'completed');
  assert.equal(result.action, undefined);
  assert.equal(result.quote, '•已得币50|下单再得币500');
  assert.equal(JSON.stringify(frame), before);
});

test('170 original completed PNG/OCR recognizes the cart icon OCR and header edge jitter', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T08-26-22-002Z/', import.meta.url),
    '5b162824-f6f0-4a7a-a5db-f5cdf514db0f');
  const before = JSON.stringify(frame);
  const result = await inspectLearnedBrowse(frame, owner);
  assert.equal(result?.state, 'completed');
  assert.equal(result.action, undefined);
  assert.equal(result.quote, '！已得币50|下单再得币500');
  assert.equal(JSON.stringify(frame), before);
});

test('170 receipt keeps strict scope, exact reward, static header, price badges and unobstructed content checks', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T08-26-22-002Z/', import.meta.url),
    '5b162824-f6f0-4a7a-a5db-f5cdf514db0f');
  const receipt = frame.lines.find((l: any) => l.text.includes('已得'));
  for (const change of [
    { package: 'other' }, { userId: 10 }, { observationError: 'OCR failure' },
    { lines: frame.lines.filter((l: any) => l !== receipt) },
    { lines: [...frame.lines, receipt] },
    ...['！下单再得币500', '！已得币500|下单再得币500', '！已得币50|下单再得币5000', '！！已得币50|下单再得币500'].map(text => ({
      lines: frame.lines.map((l: any) => l === receipt ? { ...l, text } : l),
    })),
    { lines: frame.lines.map((l: any) => l === receipt ? { ...l, bounds: [369, 800, 1025, 861] } : l) },
    ...['任务列表', '请登录', '安全验证', '确认'].map(text => ({
      lines: [...frame.lines, { text, bounds: [150, 900, 600, 950] }],
    })),
  ]) assert.equal(await inspectLearnedBrowse({ ...frame, ...change }, owner), null, JSON.stringify(change));
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-170-');
  try {
    for (const [i, region] of [
      { left: 420, top: 154, width: 200, height: 55 },
      { left: 334, top: 730, width: 176, height: 30 },
      { left: 100, top: 800, width: 880, height: 700 },
    ].entries()) {
      const path = join(directory, `overlay-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: {
        width: region.width, height: region.height, channels: 3, background: '#ffffff',
      } }, left: region.left, top: region.top }]).png().toFile(path);
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner), null, `170 overlay ${i}`);
    }
    for (const other of [entry(), fixture(candidate, '10cb4b08-627d-4b50-8d04-fb00e9901a3a')])
      assert.equal(await inspectLearnedBrowse({ ...frame, path: other.path }, owner), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('157 pale artwork still rejects stale OCR when its letters are dimmed', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T07-17-55-917Z/', import.meta.url),
    '0cc2fc0b-c222-498a-81d1-94a812d03be7');
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-receipt-');
  try {
    const region = { left: 292, top: 2054, width: 74, height: 26 };
    const input = await sharp(frame.path).extract(region).linear(1, -67).png().toBuffer();
    const path = join(directory, 'dim-artwork.png');
    await sharp(frame.path).composite([{ input, left: region.left, top: region.top }]).png().toFile(path);
    assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('157 receipt rejects lists, promotions, wrong scope, malformed bounds and invalid PNGs', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T07-17-55-917Z/', import.meta.url),
    '0cc2fc0b-c222-498a-81d1-94a812d03be7');
  const receipt = frame.lines.find((l: any) => l.text.includes('已得'));
  for (const change of [
    { package: 'other' }, { userId: 10 }, { observationError: 'OCR failure' },
    { lines: frame.lines.filter((l: any) => l !== receipt) },
    ...['下单再得币500', '已得币500|下单再得币500', '任务完成'].map(text => ({
      lines: frame.lines.map((l: any) => l === receipt ? { ...l, text } : l),
    })),
    ...[[369, 103, 1025, 213], [369, 800, 1025, 861]].map(bounds => ({
      lines: frame.lines.map((l: any) => l === receipt ? { ...l, bounds } : l),
    })),
    ...['任务列表', '请登录', '安全验证', '温馨提示', '确认'].map(text => ({
      lines: [...frame.lines, { text, bounds: [150, 900, 600, 950] }],
    })),
  ]) assert.equal(await inspectLearnedBrowse({ ...frame, ...change }, owner), null, JSON.stringify(change));
  for (const old of [entry(), fixture(candidate, '13b1a660-a566-445b-975d-c5c663dfd649')]) {
    assert.equal((await inspectLearnedBrowse(old, owner))?.state, 'browsing');
    // A promotion page with stale completed OCR cannot substitute for the panel.
    assert.equal(await inspectLearnedBrowse({ ...frame, path: old.path }, owner), null);
  }
  const list = fixture(candidate, '10cb4b08-627d-4b50-8d04-fb00e9901a3a');
  assert.equal(await inspectLearnedBrowse(list, owner), null);
  assert.equal(await inspectLearnedBrowse({ ...frame, path: list.path }, owner), null);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-receipt-');
  try {
    const corrupt = join(directory, 'corrupt.png'), resized = join(directory, 'resized.png');
    await writeFile(corrupt, 'invalid PNG');
    await sharp(frame.path).resize(540, 1200).png().toFile(resized);
    for (const path of [corrupt, resized, join(directory, 'missing.png')])
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('157 receipt rejects header, price badge and content overlays with unchanged OCR', async () => {
  const { inspectLearnedBrowse } = await load();
  const frame = fixture(new URL('../evidence/staged-2026-11-01T07-17-55-917Z/', import.meta.url),
    '0cc2fc0b-c222-498a-81d1-94a812d03be7');
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-receipt-');
  try {
    for (const [i, region] of [
      { left: 420, top: 154, width: 200, height: 55 },
      { left: 334, top: 994, width: 178, height: 43 },
      { left: 100, top: 800, width: 880, height: 700 },
      { left: 292, top: 2054, width: 74, height: 26 },
    ].entries()) {
      const path = join(directory, `overlay-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: {
        width: region.width, height: region.height, channels: 3, background: '#ffffff',
      } }, left: region.left, top: region.top }]).png().toFile(path);
      assert.equal(await inspectLearnedBrowse({ ...frame, path }, owner), null, `overlay ${i}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real runtime consumes the original 157 receipt after continuous browsing with zero model calls', async () => {
  const { createStagedRuntime } = await import('../runner/staged/runtime.ts');
  const receipt = fixture(new URL('../evidence/staged-2026-11-01T07-17-55-917Z/', import.meta.url),
    '0cc2fc0b-c222-498a-81d1-94a812d03be7');
  const panel = fixture(successful, '9caa6d17-0375-4f3d-9a27-272bf7090f2f');
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-157-runtime-');
  const version = 'continuous-browse-candidate-v1';
  const cfg: any = {
    package: owner.package, scope: { appId: 'a', accountId: 'b', activityId: 'c', userId: 0 },
    panelMarker: '赚金币抵钱', constraints: [], selectionAllowNew: false,
    learnedBrowse: { enabled: true, version, sourceRunId: 153 }, scriptValidationMode: true,
    limits: { stageMs: 90000, sessionMs: 600000, agentCalls: 20, stageActions: 4, maxReturns: 3 },
    stages: {
      open_task: { goal: 'open', checkpoint: 'destination' },
      task_receipt: { goal: 'receipt', checkpoint: 'receipt',
        continuousScroll: { maxMs: 18000, maxSwipes: 16 }, revalidateBeforeScroll: true },
    },
  };
  let page = 'panel', serial = 0, queries = 0, bursts = 0, current: any;
  const device: any = {
    capture: async () => {
      const source = page === 'panel' ? panel : page === 'completed' ? receipt : entry();
      current = { ...structuredClone(source), id: `157-replay-${++serial}`, capturedAt: Date.now() };
      return current;
    },
    act: async (action: any, frame: any) => {
      if (frame) assert.equal(frame.id, current.id);
      if (action.type === 'tap') page = 'browsing';
      else assert.equal(action.type, 'wait');
      current = null;
    },
    scrollContinuously: async (action: any, frame: any, limits: any) => {
      assert.equal(frame.id, current.id);
      assert.equal(action.type, 'swipe');
      assert.equal(limits.maxSwipes, 16);
      bursts++; page = 'completed'; current = null;
    },
  };
  try {
    const runtime = createStagedRuntime(cfg, device, { query: async () => {
      queries++; throw Error('157 replay must not query model');
    } }, { sessionId: '157-offline-replay', evidenceDir: directory,
      plan: [{ name: '看看#精致面霜', instruction: '浏览', decision: 'do', times: 1 }] });
    const selected = await runtime.stage('select_task', {});
    assert.equal(selected.status, 'completed', selected.error);
    const ctx = { task: selected.task, taskAttemptId: '157-offline-attempt' };
    assert.equal((await runtime.stage('open_task', ctx)).status, 'completed');
    const result = await runtime.stage('task_receipt', ctx);
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.receipt?.quote, receipt.lines.find((l: any) => l.text.includes('已得')).text);
    assert.equal(result.receipt?.taskAttemptId, ctx.taskAttemptId);
    assert.equal(result.usedScriptVersion, version);
    assert.equal(bursts, 1);
    assert.equal(queries, 0);
    assert.equal(runtime.calls, 0);
    assert.ok(result.actions.every((a: any) => a.source === 'script'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('stable duplicated PNG replay revalidates both layouts and regenerates fresh OCR coordinates', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  assert.equal(typeof revalidateLearnedBrowse, 'function');
  for (const old of [entry(), fixture(candidate, '13b1a660-a566-445b-975d-c5c663dfd649')]) {
    const proposal = (await inspectLearnedBrowse(old, owner)).action;
    const baseline = await revalidateLearnedBrowse(old, recapture(old), proposal, owner);
    assert.ok(baseline);
    const fresh = recapture(old);
    fresh.lines = fresh.lines.map((l: any) => ({ ...l, bounds: l.bounds.map((v: number) => v + 1) }));
    const result = await revalidateLearnedBrowse(old, fresh, proposal, owner);
    assert.ok(result);
    assert.equal(result.action.fromX, baseline.action.fromX + 1);
    assert.equal(result.action.fromY, baseline.action.fromY + 1);
    assert.equal(result.action.toY, baseline.action.toY + 1);
  }
});

test('two distinct original 155 captures keep the learned destination eligible', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const old = fixture(candidate, '13b1a660-a566-445b-975d-c5c663dfd649');
  const fresh = fixture(candidate, 'd65dc20f-fa2d-44eb-9280-09f46eda12e0');
  const action = (await inspectLearnedBrowse(old, owner)).action;
  assert.ok(await revalidateLearnedBrowse(old, fresh, action, owner));
});

test('real task list and exit transition reject, even when transition is paired with stale entry OCR', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const old = entry(), action = (await inspectLearnedBrowse(old, owner)).action;
  for (const id of ['10cb4b08-627d-4b50-8d04-fb00e9901a3a', '9f45e21c-86f7-46d0-b21b-e39c05e84072']) {
    const frame = fixture(candidate, id);
    assert.equal(await inspectLearnedBrowse(frame, owner), null);
    assert.equal(await inspectLearnedBrowse({ ...old, path: frame.path }, owner), null);
    assert.equal(await revalidateLearnedBrowse(old, { ...recapture(old), path: frame.path }, action, owner), null);
  }
});

test('complete requirement, scope and unobstructed receipt are mandatory', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const old = entry(), action = (await inspectLearnedBrowse(old, owner)).action;
  for (const base of [old, completed()]) {
    for (const change of [
      { package: 'other' }, { userId: 10 }, { observationError: 'OCR failure' }, { lines: [] },
      ...['请登录', '安全验证', '去完成'].map(text => ({ lines: [...base.lines, { text, bounds: [150, 900, 600, 950] }] })),
      { lines: base.lines.map((l: any) => /浏览10秒|已得/.test(l.text) ? { ...l, bounds: [300, 800, 1000, 865] } : l) },
    ]) assert.equal(await inspectLearnedBrowse({ ...base, ...change }, owner), null);
  }
  for (const quote of ['浏览11秒可领币50～', '浏览10秒可领币500～', '浏览10秒', '浏览0秒可领币50～']) {
    assert.equal(await inspectLearnedBrowse({ ...old, lines: old.lines.map((l: any) => l.text.includes('浏览10秒') ? { ...l, text: quote } : l) }, owner), null);
  }
  assert.equal(await revalidateLearnedBrowse(old, old, action, owner), null);
  assert.equal(await revalidateLearnedBrowse(old, recapture(old), { type: 'tap', x: 500, y: 500 }, owner), null);
  assert.equal(await revalidateLearnedBrowse(old, { ...completed(), capturedAt: old.capturedAt + 20000 }, action, owner), null);
});

test('countdown 1–9 and coin OCR variants retain the complete learned component', async () => {
  const { inspectLearnedBrowse } = await load();
  for (let n = 1; n <= 9; n++) {
    const old = entry();
    old.lines = old.lines.map((l: any) => l.text.includes('浏览10秒') ? { ...l, text: `浏览${n}秒可领金币50～` } : l);
    assert.equal((await inspectLearnedBrowse(old, owner))?.state, 'browsing');
  }
});

test('PNG overlays, altered products, hidden requirement words and corrupt images fail closed', async () => {
  const { inspectLearnedBrowse, revalidateLearnedBrowse } = await load();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/learned-browse-');
  const old = entry(), action = (await inspectLearnedBrowse(old, owner)).action;
  try {
    // Derived synthetic negatives; historical PNG/OCR stay untouched.
    for (const [i, r] of [
      { left: 100, top: 800, width: 880, height: 700 },
      { left: 554, top: 199, width: 400, height: 35 },
      { left: 714, top: 145, width: 12, height: 35 },
    ].entries()) {
      const path = join(directory, `covered-${i}.png`);
      await sharp(old.path).composite([{ input: { create: { width: r.width, height: r.height, channels: 3, background: '#ffffff' } }, left: r.left, top: r.top }]).png().toFile(path);
      const covered = { ...old, path };
      assert.equal(await inspectLearnedBrowse(covered, owner), null, `unchanged occlusion ${i}`);
      assert.equal(await revalidateLearnedBrowse(old, { ...recapture(old), path }, action, owner), null);
    }
    const path = join(directory, 'tiny-change.png');
    await sharp(old.path).composite([{ input: { create: { width: 40, height: 40, channels: 3, background: '#000000' } }, left: 520, top: 1300 }]).png().toFile(path);
    assert.equal(await revalidateLearnedBrowse(old, { ...recapture(old), path }, action, owner), null);
    const corrupt = join(directory, 'corrupt.png'), resized = join(directory, 'resized.png');
    await writeFile(corrupt, 'invalid PNG');
    await sharp(old.path).resize(540, 1200).png().toFile(resized);
    for (const path of [corrupt, resized, join(directory, 'missing.png')]) {
      assert.equal(await inspectLearnedBrowse({ ...old, path }, owner), null);
      assert.equal(await revalidateLearnedBrowse(old, { ...recapture(old), path }, action, owner), null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
