import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import * as learned from '../runner/staged/learned-browse.ts';
import * as immersive from '../runner/staged/immersive-browse.ts';
import { selectContinuousContract, inspectSelectedContinuousContract } from '../runner/staged/continuous-contract.ts';
import { revalidateBrowseSwipe } from '../runner/staged/browse-revalidation.ts';
const root = resolve(import.meta.dirname, '..');
const owner = { package: 'com.taobao.taobao', userId: 0 };
const policy = { policy: 'current-components-v1' } as const;
const refs = {
  fifty: 'continuous-supervised-2026-11-01T05-18-43-216Z/bfbc7cc8-510d-4133-82f7-1a432fa97af7',
  receipt50: 'continuous-supervised-2026-11-01T05-18-43-216Z/17cbd398-0659-40fc-90d7-79d3ee3c188f',
  twenty: 'staged-2026-11-01T08-46-52-728Z/84707f78-82f4-414c-9664-d72f8e681624',
  receipt20: 'staged-2026-11-01T11-50-22-744Z/1c143332-c14b-48b1-97a0-18124fc338d3',
  long: 'staged-2026-11-01T11-01-03-757Z/3b776de9-f796-4337-875e-f1aec45bfb17',
  video20: 'staged-2026-11-01T04-08-28-272Z/fb612cbe-6736-4d77-8463-fc7848c70ce0',
  videoDone20: 'staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d',
  video35: 'staged-2026-11-01T11-23-10-672Z/a87ba7da-87a6-4f13-a756-3b0b0970dc97',
  videoDone35: 'staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf',
  video50: 'staged-2026-11-01T08-50-08-755Z/50a8f18d-ec2e-47ed-a615-6ca435769c67',
};
async function fixture(key: keyof typeof refs) {
  return JSON.parse(await readFile(join(root, 'evidence', refs[key] + '.json'), 'utf8'));
}
// All mutations are labelled synthetic and confined to scratch, including embedded raw paths.
async function replay(base: any, run: (f: any, save: () => Promise<void>) => Promise<void>) {
  const dir = await mkdtemp('/Users/mater/.hermes/cache/scratch/current-browse-');
  const before = await Promise.all(['.png', '.json', '.ocr.json'].map(ext => readFile(base.path.replace(/\.png$/, ext))));
  try {
    const f = structuredClone(base); f.id += '-synthetic'; f.capturedAt += 1000; f.path = join(dir, 'synthetic.png');
    await writeFile(f.path, before[0]);
    const raw = JSON.parse(before[2].toString());
    const save = async () => {
      assert.ok(resolve(f.path).startsWith(dir + '/'));
      raw.pages[0].file = f.path; raw.pages[0].lines = f.lines.map((l: any) => ({ ...l, confidence: 1 }));
      await writeFile(f.path.replace(/\.png$/, '.json'), JSON.stringify(f));
      await writeFile(f.path.replace(/\.png$/, '.ocr.json'), JSON.stringify(raw));
    };
    await save(); await run(f, save);
  } finally {
    const after = await Promise.all(['.png', '.json', '.ocr.json'].map(ext => readFile(base.path.replace(/\.png$/, ext))));
    assert.deepEqual(after.map(sha), before.map(sha), 'historical originals must remain immutable');
    await rm(dir, { recursive: true, force: true });
  }
}
test('current continuous component rejects partial occlusion even when saved and raw text agree', async () => {
  const base = await fixture('fifty');
  await replay(base, async f => {
    const b = f.lines.find((l: any) => l.text.includes('秒可领')).bounds;
    const patch = await sharp({ create: { width: 60, height: Math.ceil(b[3] - b[1]), channels: 3, background: '#ffffff' } }).png().toBuffer();
    const bytes = await sharp(f.path).composite([{ input: patch, left: Math.round((b[0] + b[2]) / 2), top: Math.floor(b[1]) }]).png().toBuffer();
    await writeFile(f.path, bytes);
    assert.equal(await learned.inspectCurrentLearnedBrowse(f, owner), null);
  });
});

test('explicit current policy selects one continuous contract and preserves it through receipts', async () => {
  const f = await fixture('fifty');
  await replay(f, async (moved, save) => {
    // Synthetic component translation and removed merchandise; real originals unchanged.
    const bytes = await sharp(f.path).extract({ left: 0, top: 102, width: 1080, height: 158 }).png().toBuffer();
    await writeFile(moved.path, await sharp({ create: { width: 1080, height: 2400, channels: 3, background: '#5b798d' } })
      .composite([{ input: bytes, left: 0, top: 202 }]).png().toBuffer());
    moved.lines = moved.lines.filter((l: any) => /秒可领/.test(l.text)).map((l: any) => ({ ...l, bounds: l.bounds.map((v: number, i: number) => i % 2 ? v + 100 : v) }));
    await save();
    assert.equal(await selectContinuousContract(moved, owner), null, 'legacy default remains pixel based');
    const selected = await selectContinuousContract(moved, owner, {}, policy);
    assert.ok(selected, 'current component must select without historical position or merchandise');
    assert.equal(selected.option.rewardCoins, 50);
    assert.equal(selected.budget.maxSwipes, 16);
    assert.equal(selected.budget.maxMs, 18000);
    assert.ok(selected.provenance.every(s => /^[a-f0-9]{64}$/.test(s.pngSha256)));
    const done = await inspectSelectedContinuousContract(await fixture('receipt50'), owner, selected, policy);
    assert.equal(done.inspection?.state, 'completed');
    assert.equal((await inspectSelectedContinuousContract(await fixture('receipt20'), owner, selected, policy)).inspection, null);
    assert.equal((await inspectSelectedContinuousContract(await fixture('receipt50'), owner, selected)).inspection, null, 'cannot change selected policy');
    assert.equal((await inspectSelectedContinuousContract(await fixture('receipt50'), { ...owner, userId: 999 }, selected, policy)).inspection, null);
  });
});

test('current dispatch revalidation uses the selected contract and current geometry across product changes', async () => {
  const old = await fixture('fifty');
  const selectedContract = await selectContinuousContract(old, owner, {}, policy);
  assert.ok(selectedContract);
  await replay(old, async (fresh, save) => {
    fresh.lines = fresh.lines.filter((l: any) => /秒可领/.test(l.text));
    await save();
    const action = { type: 'swipe', fromX: 20, fromY: 2000, toX: 20, toY: 600, ms: 500 };
    const result = await revalidateBrowseSwipe(old, fresh, action, owner, { ...policy, selectedContract });
    assert.ok(result, 'fresh current text should regenerate the swipe');
    assert.notDeepEqual(result.action, action);
    assert.equal(result.action.type, 'swipe');
    assert.match(result.reason, /current-components-v1/);
    assert.equal(await revalidateBrowseSwipe(old, fresh, action, owner, policy as any), null, 'selected contract is mandatory');
    assert.equal(await revalidateBrowseSwipe(old, fresh, { ...action, ms: 0 }, owner, { ...policy, selectedContract }), null);
    assert.equal(await revalidateBrowseSwipe(old, old, action, owner, { ...policy, selectedContract }), null);
    const done = await fixture('receipt50');
    assert.equal(await revalidateBrowseSwipe(old, done, action, owner, { ...policy, selectedContract }), null);
    assert.equal(await revalidateBrowseSwipe(old, fresh, action, { ...owner, userId: 999 }, { ...policy, selectedContract }), null);
  });
});

test('current immersive inspector accepts multiple real components with unchanged reward boundaries', async () => {
  assert.equal(typeof immersive.inspectCurrentImmersiveBrowse, 'function');
  for (const [key, rewardCoins, state] of [
    ['video20', 20, 'browsing'], ['video35', 35, 'browsing'], ['video50', 50, 'browsing'],
    ['videoDone20', 20, 'completed'], ['videoDone35', 35, 'completed'],
  ] as const) {
    const f = await fixture(key);
    const result = await immersive.inspectCurrentImmersiveBrowse(f, owner, { rewardCoins });
    assert.equal(result?.state, state, key);
    assert.equal(result.rewardCoins, rewardCoins);
    assert.match(result.version, /current-components-v1/);
    if (state === 'browsing') assert.equal(result.waitMs, 3000);
    else assert.equal(result.quote, `已得${rewardCoins}`);
  }
});

test('current immersive rejects a partially covered amount with stale saved OCR', async () => {
  const base = await fixture('video20');
  await replay(base, async f => {
    const b = f.lines.find((l: any) => l.text === '得20').bounds;
    const bytes = await sharp(f.path).composite([{ input: await sharp({ create: { width: 35, height: 35, channels: 3, background: '#eeeeee' } }).png().toBuffer(), left: 972, top: 1296 }]).png().toBuffer();
    await writeFile(f.path, bytes);
    assert.equal(await immersive.inspectCurrentImmersiveBrowse(f, owner), null);
  });
});

test('split raw risk text blocks both current policies', async () => {
  for (const key of ['fifty', 'video20'] as const) await replay(await fixture(key), async (f, save) => {
    f.lines.push({ text: '请登', bounds: [100, 700, 180, 750] }, { text: '录', bounds: [185, 700, 225, 750] });
    await save();
    const result = key === 'fifty' ? await learned.inspectCurrentLearnedBrowse(f, owner)
      : await immersive.inspectCurrentImmersiveBrowse(f, owner);
    assert.equal(result, null, key);
  });
});

test('current inspectors reject owner, raw/saved contradictions, ambiguity and unsupported requirements', async () => {
  for (const key of ['fifty', 'video20'] as const) {
    const f = await fixture(key);
    const inspect = (frame: any, scope = owner, options?: any) => key === 'fifty'
      ? learned.inspectCurrentLearnedBrowse(frame, scope, options) : immersive.inspectCurrentImmersiveBrowse(frame, scope, options);
    assert.equal(await inspect(f, { ...owner, userId: 999 }), null);
    for (const change of [{ package: 'other' }, { userId: 999 }, { id: '' }, { capturedAt: NaN }, { width: 720 }, { observationError: 'failed' }])
      assert.equal(await inspect({ ...f, ...change }), null);
    await replay(f, async (s, save) => {
      const original = structuredClone(s.lines);
      for (const text of ['请登录', '安全验证', '确认', '允许授权', '任务列表']) {
        s.lines = [...original, { text, bounds: [100, 600, 300, 650] }]; await save();
        assert.equal(await inspect(s), null, text);
      }
      s.lines = original; await save();
      const component = s.lines.find((l: any) => key === 'fifty' ? /秒可领/.test(l.text) : l.text === '得20');
      s.lines = [...original, component]; await save();
      assert.equal(await inspect(s), null, 'multiple targets');
      s.lines = original; await save();
      const rawPath = s.path.replace(/\.png$/, '.ocr.json');
      const raw = JSON.parse(await readFile(rawPath, 'utf8'));
      raw.pages[0].lines.push({ text: '请登录', bounds: [100, 600, 300, 650] });
      await writeFile(rawPath, JSON.stringify(raw));
      assert.equal(await inspect(s), null, 'hidden raw risk');
      await save();
      s.lines = s.lines.map((l: any) => l === component ? { ...l, text: 'wrong requirement' } : l);
      assert.equal(await inspect(s), null, 'in-memory cannot override saved lines');
    });
  }
  const long = await fixture('long');
  assert.equal(await learned.inspectCurrentLearnedBrowse(long, owner), null);
  assert.equal((await learned.inspectCurrentLearnedBrowse(long, owner, { rewardCoins: 50, requiredMs: 25000 }))?.requiredMs, 25000);
  assert.equal(await learned.inspectCurrentLearnedBrowse(long, owner, { rewardCoins: 20, requiredMs: 25000 } as any), null);
  assert.equal(await learned.inspectCurrentLearnedBrowse(await fixture('twenty'), owner), null);
  assert.equal(await immersive.inspectCurrentImmersiveBrowse(await fixture('videoDone35'), owner), null, 'no automatic 20 to 35 transition');
});

test('synthetic moved immersive components ignore product and promotion decoration', async () => {
  const base = await fixture('video20');
  await replay(base, async (f, save) => {
    const component = await sharp(base.path).extract({ left: 878, top: 1230, width: 182, height: 146 }).png().toBuffer();
    await writeFile(f.path, await sharp({ create: { width: 1080, height: 2400, channels: 3, background: '#29444c' } })
      .composite([{ input: component, left: 578, top: 1030 }]).png().toBuffer());
    f.lines = f.lines.filter((l: any) => l.text === '浏览' || l.text === '得20')
      .map((l: any) => ({ ...l, bounds: l.bounds.map((v: number, i: number) => v - (i % 2 ? 200 : 300)) }));
    await save();
    assert.equal((await immersive.inspectCurrentImmersiveBrowse(f, owner))?.state, 'browsing');
    assert.equal(await immersive.inspectImmersiveBrowse(f, owner), null, 'legacy position stays strict');
  });
});

test('synthetic completed50 is unknown under current immersive policy', async () => {
  const base = await fixture('videoDone20');
  await replay(base, async (f, save) => {
    f.lines = f.lines.map((l: any) => l.text === '已得20' ? { ...l, text: '已得50' } : l);
    await save();
    assert.equal(await immersive.inspectCurrentImmersiveBrowse(f, owner, { rewardCoins: 50 }), null);
    assert.equal(await immersive.inspectCurrentImmersiveBrowse(f, owner), null);
  });
});

test('current immersive rejects an extra competing reward embedded in another raw line', async () => {
  await replay(await fixture('video20'), async (f, save) => {
    f.lines.push({ text: '奖励得50', bounds: [100, 600, 300, 650] }); await save();
    assert.equal(await immersive.inspectCurrentImmersiveBrowse(f, owner), null);
  });
});

test('current continuous accepts additional real product layouts with ordinary raw edge rounding', async () => {
  for (const ref of [
    'staged-2026-11-01T05-11-55-681Z/58f3ce35-4196-44e5-830d-371f19ea6058',
    'staged-2026-11-01T11-30-56-472Z/d974083a-8310-49d9-ac1d-7ccc99bd511c',
    'staged-2026-11-01T06-31-13-908Z/d65dc20f-fa2d-44eb-9280-09f46eda12e0',
    'staged-2026-11-01T06-31-13-908Z/6a0e048e-a3bd-4fac-96f5-acd802d3196d',
  ]) {
    const f = JSON.parse(await readFile(join(root, 'evidence', ref + '.json'), 'utf8'));
    const rewardCoins = ref.includes('11-30-56') ? 20 : 50;
    assert.equal((await learned.inspectCurrentLearnedBrowse(f, owner, { rewardCoins }))?.state, 'browsing', ref);
  }
});

test('current continuous raw binding reproduces the existing device float-edge rule', async () => {
  await replay(await fixture('fifty'), async (f, save) => {
    f.lines.push({ text: 'edge background', bounds: [0, 600, 200, 640] }); await save();
    const rawPath = f.path.replace(/\.png$/, '.ocr.json');
    const raw = JSON.parse(await readFile(rawPath, 'utf8'));
    raw.pages[0].lines.at(-1).bounds[0] = -0.000002;
    await writeFile(rawPath, JSON.stringify(raw));
    assert.equal((await learned.inspectCurrentLearnedBrowse(f, owner))?.state, 'browsing');
    raw.pages[0].lines.at(-1).bounds[0] = -0.002;
    await writeFile(rawPath, JSON.stringify(raw));
    assert.equal(await learned.inspectCurrentLearnedBrowse(f, owner), null);
  });
});

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('current continuous inspector accepts real browsing and receipts without merchandise authority', async () => {
  assert.equal(typeof learned.inspectCurrentLearnedBrowse, 'function');
  for (const [key, rewardCoins, state] of [
    ['fifty', 50, 'browsing'], ['twenty', 20, 'browsing'], ['receipt50', 50, 'completed'], ['receipt20', 20, 'completed'],
  ] as const) {
    const frame = await fixture(key);
    const result = await learned.inspectCurrentLearnedBrowse(frame, owner, { rewardCoins });
    assert.equal(result?.state, state, key);
    assert.equal(result.rewardCoins, rewardCoins);
    assert.match(result.version, /current-components-v1/);
    if (state === 'completed') assert.equal(result.action, undefined);
  }
});
