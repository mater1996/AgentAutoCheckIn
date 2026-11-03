import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { inspectImmersiveBrowse, immersiveBrowseSource } from '../runner/staged/immersive-browse.ts';
import type { DeviceFrame } from '../runner/staged/device.ts';

const root = new URL('../', import.meta.url);
const owner = { package: 'com.taobao.taobao', userId: 0 };
const failedPaths = [
  'evidence/staged-2026-11-01T15-19-09-152Z/beaea497-a491-4dca-ac67-22e7d2320b7c.json',
  'evidence/staged-2026-11-01T15-35-31-731Z/15a85a6e-5157-4539-9262-abbf8129651d.json',
  'evidence/staged-2026-11-01T15-35-31-731Z/3d7cb0c2-414d-4da9-81e8-6c88ef418bdb.json',
];
const read = (p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const load = async () => {
  const url = new URL('../runner/staged/immersive-ocr-quality.ts', import.meta.url);
  assert.ok(existsSync(url), 'Implement the independent raw OCR geometry sidecar');
  return import(url.href);
};

test('real 207/208 error frames require an explicit independently verified sidecar for browsing50', async () => {
  const { deriveImmersiveOcrQuality, verifyImmersiveOcrQuality, rederiveImmersiveOcrQuality } = await load();
  for (const [i, path] of failedPaths.entries()) {
    const frame: DeviceFrame = read(path), before = structuredClone(frame);
    const sources = [frame.path, frame.path.replace(/\.png$/, '.json'), frame.path.replace(/\.png$/, '.ocr.json')];
    const hashes = sources.map(sha);
    const quality = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
    assert.ok(quality);
    assert.equal(quality.version, 'immersive-ocr-quality-v1-left3');
    assert.equal(quality.frameId, frame.id);
    assert.equal(quality.capturedAt, frame.capturedAt);
    assert.equal(quality.package, owner.package);
    assert.equal(quality.userId, 0);
    assert.equal(quality.sourcePngSha256, hashes[0]);
    assert.equal(quality.sourceFrameJsonSha256, hashes[1]);
    assert.equal(quality.rawOcrPath, sources[2]);
    assert.equal(quality.rawOcrSha256, hashes[2]);
    assert.deepEqual(quality.rawLines, JSON.parse(readFileSync(sources[2], 'utf8')).pages[0].lines);
    assert.equal(quality.invalidLines.length, [2, 5, 2][i]);
    assert.equal(quality.validIndices.length + quality.invalidLines.length, quality.rawLines.length);
    assert.ok(quality.invalidLines.every((l: any) => l.geometryValid === false && l.reason === 'noncritical-left-edge'
      && l.bounds[0] < 0 && l.overshootPx[0] > 0 && l.intersects.length === 0));
    assert.deepEqual(JSON.parse(JSON.stringify(quality)), quality);
    assert.deepEqual(await rederiveImmersiveOcrQuality(frame, { rewardCoins: 50 }), quality);
    assert.deepEqual(await verifyImmersiveOcrQuality(frame, { rewardCoins: 50 }, quality), quality);
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }), null);
    assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, quality), {
      state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 50, waitMs: 3000,
    });
    assert.deepEqual(frame, before);
    assert.deepEqual(sources.map(sha), hashes, 'source PNG, capture JSON and raw OCR bytes remain unchanged');
  }
});

// All mutations live in scratch and are explicitly negative/synthetic fixtures.
async function negativeFixture(run: (frame: DeviceFrame, raw: any, saveRaw: () => Promise<void>) => Promise<void>) {
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-quality-negative-');
  try {
    const original: DeviceFrame = read(failedPaths[0]);
    const frame = { ...original, path: join(directory, 'synthetic-negative.png') };
    const raw = JSON.parse(readFileSync(original.path.replace(/\.png$/, '.ocr.json'), 'utf8'));
    raw.pages[0].file = frame.path;
    const saveRaw = () => writeFile(frame.path.replace(/\.png$/, '.ocr.json'), JSON.stringify(raw));
    await copyFile(original.path, frame.path);
    await writeFile(frame.path.replace(/\.png$/, '.json'), JSON.stringify(frame));
    await saveRaw();
    await run(frame, raw, saveRaw);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('normal historical completed20/35 retain defaults and do not derive quality', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const [file, rewardCoins] of [[immersiveBrowseSource.files.completedFrame.path, 20],
    [immersiveBrowseSource.files.completed35Frame.path, 35]] as const) {
    const frame: DeviceFrame = read(file), before = structuredClone(frame);
    assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins }), null);
    assert.equal((await inspectImmersiveBrowse(frame, owner, { rewardCoins }))?.state, 'completed');
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins }, { accepted: true } as any), null);
    assert.deepEqual(frame, before);
  }
});

test('exact original error, frame equality and Taobao u0 scope are mandatory', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  const original: DeviceFrame = read(failedPaths[0]);
  for (const change of [{ id: 'altered' }, { capturedAt: original.capturedAt + 1 }, { package: 'other' }, { userId: 10 },
    { width: 720 }, { observationError: undefined }, { observationError: 'OCR pending' },
    { observationError: 'OCR capture failed' }, { observationError: 'OCR capture failed: Invalid OCR frame or bounds ' },
    { lines: [{ text: '商品', bounds: [0, 400, 100, 430] }] }])
    assert.equal(await deriveImmersiveOcrQuality({ ...original, ...change }, { rewardCoins: 50 }), null);
  await negativeFixture(async (frame) => {
    for (const change of [{ capturedAt: frame.capturedAt + 1 }, { id: 'altered' }, { userId: 10 }, { package: 'other' }]) {
      const altered = { ...frame, ...change };
      await writeFile(frame.path.replace(/\.png$/, '.json'), JSON.stringify(altered));
      assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null);
      if ('userId' in change || 'package' in change)
        assert.equal(await deriveImmersiveOcrQuality(altered, { rewardCoins: 50 }), null);
    }
  });
  assert.equal(await deriveImmersiveOcrQuality(original, { rewardCoins: 30 } as any), null);
});

test('full raw risk words reject at invalid coordinates and across rows after NFKC', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const text of ['登录', '登陆', '验证', '验证码', '授权', '允许', '隐私', '温馨提示', '确认', '取消', '同意',
    '任务列表', '赚金币抵钱', '当前页下单', '再得５００金币', '去完成', '确定要离开'])
    for (const parts of [[text], [text.slice(0, 1), text.slice(1)]])
      await negativeFixture(async (frame, raw, saveRaw) => {
        raw.pages[0].lines.push(...parts.map((part, i) => ({ text: ` ${part} `, bounds: [-1, 800 + 50 * i, 100, 830 + 50 * i] })));
        await saveRaw();
        assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null, parts.join('/'));
      });
});

test('invalid geometry cannot contribute critical task, reward or browsing text', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const text of ['浏览', '已得50', '得50', '得20', '下单得500', '奖励', '收益', '金币', '任务', '完成'])
    await negativeFixture(async (frame, raw, saveRaw) => {
      raw.pages[0].lines.push({ text, bounds: [-1, 800, 100, 830] });
      await saveRaw();
      assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null, text);
    });
});

test('schema and geometry reject malformed bounds, every other edge and more than 3px left clipping', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  const mutations: [string, (r: any) => void][] = [
    ['engine', r => { r.engine = 'other'; }], ['correction', r => { r.languageCorrection = true; }],
    ['languages', r => { r.languages = ['en-US']; }], ['revision', r => { r.pages[0].revision = 4; }],
    ['wrong file', r => { r.pages[0].file = '/wrong.png'; }], ['width', r => { r.pages[0].width = 720; }],
    ['height', r => { r.pages[0].height = 2399; }], ['extra page', r => { r.pages.push(structuredClone(r.pages[0])); }],
    ['no pages', r => { r.pages = []; }], ['empty lines', r => { r.pages[0].lines = []; }],
    ['null line', r => { r.pages[0].lines.push(null); }], ['text type', r => { r.pages[0].lines[0].text = 7; }],
    ['empty text', r => { r.pages[0].lines[0].text = ' '; }],
    ...[
      [-3.01, 800, 100, 830], [1040, 800, 1081, 830], [10, -1, 100, 30], [10, 2380, 100, 2401],
      [-2, 800, -1, 830], [100, 800, 10, 830], [10, 830, 100, 800], [10, 800, 10, 830],
      ['10', 800, 100, 830], [NaN, 800, 100, 830], [Infinity, 800, 100, 830], [10, 800, 100], null,
    ].map((bounds, i): [string, (r: any) => void] => [`bad bounds ${i}`, r => { r.pages[0].lines.push({ text: '商品', bounds }); }]),
  ];
  for (const [label, mutate] of mutations) await negativeFixture(async (frame, raw, saveRaw) => {
    mutate(raw); await saveRaw();
    assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null, label);
  });
  await negativeFixture(async (frame, raw, saveRaw) => {
    raw.pages[0].lines.push({ text: '商品', bounds: [-3, 800, 100, 830] });
    await saveRaw();
    const q = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
    assert.ok(q);
    assert.deepEqual(q.rawLines.at(-1).bounds, [-3, 800, 100, 830], 'never clamp raw geometry');
  });
});

test('candidate requirement selects protected regions including browsing35 promotions', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  assert.equal(await deriveImmersiveOcrQuality(read(failedPaths[0]), { rewardCoins: 35 }), null,
    'real 207 clipped text intersects promotionLeft for the 35 branch');
  for (const b of [[48, 136, 80, 184], [910, 1100, 980, 1210], [878, 1230, 1060, 1376], [316, 1924, 1040, 2030]])
    await negativeFixture(async (frame, raw, saveRaw) => {
      raw.pages[0].lines.push({ text: '商品', bounds: [-1, b[1], b[2], b[3]] });
      await saveRaw();
      assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null);
    });
  await negativeFixture(async (frame, raw, saveRaw) => {
    raw.pages[0].lines = raw.pages[0].lines.filter((l: any) => !l.text.startsWith('3/支'));
    raw.pages[0].lines.push({ text: '商品', bounds: [-1, 1640, 1048, 1704] });
    await saveRaw();
    assert.ok(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }));
    assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 35 }), null);
  });
  await negativeFixture(async (frame, raw, saveRaw) => {
    raw.pages[0].lines.push({ text: '已得35', bounds: [920, 1297, 1021, 1329] });
    await saveRaw();
    assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 35 }), null,
      'raw receipt text cannot disable the explicit 35 protection contract');
  });
});

test('all raw amount ambiguity rejects including reward fragments split across lines', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const texts of [['得50'], ['得20'], ['已得20'], ['浏览'], ['得', '50'], ['已', '得50'], ['得50额外'], ['额外得20'], ['浏览50']]) {
    await negativeFixture(async (frame, raw, saveRaw) => {
      raw.pages[0].lines.push(...texts.map((text, i) => ({ text, bounds: [300, 800 + i * 50, 450, 830 + i * 50] })));
      await saveRaw();
      const quality = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
      assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, quality as any), null, texts.join('/'));
    });
  }
});

test('sidecar contents, source identities, versions, hashes and requirement cannot be forged', async () => {
  const { deriveImmersiveOcrQuality, verifyImmersiveOcrQuality } = await load();
  const frame: DeviceFrame = read(failedPaths[0]);
  const quality = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
  assert.ok(quality);
  const mutations: [string, (q: any) => void][] = [
    ['version', q => { q.version = 'unknown'; }], ['frameId', q => { q.frameId += 'x'; }],
    ['path', q => { q.path += 'x'; }], ['capturedAt', q => { q.capturedAt++; }],
    ['package', q => { q.package = 'other'; }], ['userId', q => { q.userId = 10; }],
    ['PNG hash', q => { q.sourcePngSha256 = '0'.repeat(64); }],
    ['frame hash', q => { q.sourceFrameJsonSha256 = '0'.repeat(64); }],
    ['frame path', q => { q.sourceFrameJsonPath += 'x'; }], ['raw path', q => { q.rawOcrPath += 'x'; }],
    ['raw hash', q => { q.rawOcrSha256 = '0'.repeat(64); }], ['engine', q => { q.engine = 'other'; }],
    ['revision', q => { q.revision = 4; }], ['languages', q => { q.languages = ['en-US']; }],
    ['correction', q => { q.languageCorrection = true; }], ['requirement', q => { q.requirement.rewardCoins = 35; }],
    ['ROI', q => { q.protectedRegions[0].bounds[0]++; }], ['remove ROI', q => { q.protectedRegions.pop(); }],
    ['text', q => { q.rawLines[0].text = '登录'; }], ['bounds', q => { q.rawLines[0].bounds[0]++; }],
    ['confidence', q => { q.rawLines[0].confidence = 0; }], ['drop raw', q => { q.rawLines.pop(); }],
    ['valid indices', q => { q.validIndices.pop(); }], ['invalid indices', q => { q.invalidLines[0].index++; }],
    ['invalid reason', q => { q.invalidLines[0].reason = 'accepted'; }],
    ['overshoot', q => { q.invalidLines[0].overshootPx[0] = 0; }], ['self accepted', q => { q.accepted = true; }],
  ];
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(quality); mutate(forged);
    assert.equal(await verifyImmersiveOcrQuality(frame, { rewardCoins: 50 }, forged), null, label);
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, forged), null, label);
  }
  for (const forged of [null, {}, { accepted: true }, { ...quality, invalidLines: [] }])
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, forged as any), null);
  assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 35 }, quality), null);
  assert.equal(await inspectImmersiveBrowse(frame, { ...owner, userId: 10 }, { rewardCoins: 50 }, quality), null);
  assert.equal(await inspectImmersiveBrowse({ ...frame, capturedAt: frame.capturedAt + 1 }, owner, { rewardCoins: 50 }, quality), null);
});

test('checker re-reads exact source bytes instead of trusting a previously valid sidecar', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const source of ['frame', 'raw', 'png']) await negativeFixture(async (frame) => {
    const q = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
    assert.ok(q);
    const file = source === 'frame' ? frame.path.replace(/\.png$/, '.json')
      : source === 'raw' ? frame.path.replace(/\.png$/, '.ocr.json') : frame.path;
    await writeFile(file, Buffer.concat([readFileSync(file), Buffer.from(' ')]));
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, q), null, source);
  });
});

test('original pixel gates reject badge, control, shell obstructions and copied text over another PNG', async () => {
  const { deriveImmersiveOcrQuality } = await load();
  for (const [left, top, width, height] of [[878, 1230, 182, 146], [48, 136, 32, 48],
    [910, 1100, 70, 110], [316, 1924, 724, 106], [906, 1336, 127, 17]])
    await negativeFixture(async (frame) => {
      const bytes = await sharp(frame.path).composite([{ input: { create: {
        width, height, channels: 3, background: '#888888',
      } }, left, top }]).png().toBuffer();
      await writeFile(frame.path, bytes);
      const q = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
      assert.ok(q, 'quality is geometry evidence, not pixel acceptance');
      assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, q), null);
    });
  await negativeFixture(async (frame) => {
    await copyFile(new URL(immersiveBrowseSource.files.completedPng.path, root), frame.path);
    const q = await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 });
    assert.ok(q);
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }, q), null);
  });
  for (const format of ['corrupt', 'small', 'jpeg']) await negativeFixture(async frame => {
    const bytes = format === 'corrupt' ? Buffer.from('broken PNG') : format === 'small'
      ? await sharp(frame.path).resize(540, 1200).png().toBuffer() : await sharp(frame.path).jpeg().toBuffer();
    await writeFile(frame.path, bytes);
    assert.equal(await deriveImmersiveOcrQuality(frame, { rewardCoins: 50 }), null, format);
  });
});

