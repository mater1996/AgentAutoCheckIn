import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DeviceFrame } from '../runner/staged/device.ts';

const history = new URL('../evidence/staged-2026-11-01T04-08-28-272Z/', import.meta.url);
const owner = { package: 'com.taobao.taobao', userId: 0 };
const ids = {
  browsing: 'fb612cbe-6736-4d77-8463-fc7848c70ce0',
  completed: 'bac64856-dcf1-4bf4-9db9-fe960e2af71d',
};
const fixture = (id: string): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(id + '.json', history), 'utf8')),
  path: new URL(id + '.png', history).pathname,
});
const load = async () => {
  const url = new URL('../runner/staged/immersive-browse.ts', import.meta.url);
  assert.ok(existsSync(url), 'Implement the immersive video component inspector');
  return import(url.href);
};

const browsing35History = new URL('../evidence/staged-2026-11-01T11-23-10-672Z/', import.meta.url);
const browsing35Id = 'a87ba7da-87a6-4f13-a756-3b0b0970dc97';
const browsing35Fixture = (): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(browsing35Id + '.json', browsing35History), 'utf8')),
  path: new URL(browsing35Id + '.png', browsing35History).pathname,
});

test('191 real complete browsing35 accepts only explicit 35 without mutating evidence', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = browsing35Fixture(), before = JSON.stringify(frame);
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 35 }), {
    state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 35, waitMs: 3000,
  });
  assert.equal(await inspectImmersiveBrowse(frame, owner), null);
  assert.equal(await inspectImmersiveBrowse({ ...frame, path: thirtyFiveFixture().path }, owner, { rewardCoins: 35 }), null);
  const completed = thirtyFiveFixture();
  assert.equal(await inspectImmersiveBrowse({ ...completed, path: frame.path }, owner, { rewardCoins: 35 }), null);
  for (const rewardCoins of [20, 30, 50]) {
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins }), null);
    const lines = frame.lines.map(l => l.text === '得35' ? { ...l, text: `得${rewardCoins}` } : l);
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins }), null);
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins: 35 }), null);
  }
  for (const scope of [{ ...owner, userId: 10 }, { ...owner, package: 'other' }, { ...owner, userId: -1 }])
    assert.equal(await inspectImmersiveBrowse(frame, scope, { rewardCoins: 35 }), null);
  for (const text of ['浏览', '得35']) {
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines: frame.lines.filter(l => l.text !== text) }, owner, { rewardCoins: 35 }), null);
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines: [...frame.lines, ...frame.lines.filter(l => l.text === text)] }, owner, { rewardCoins: 35 }), null);
  }
  assert.equal(JSON.stringify(frame), before);
});

test('191 complete component rejects stale OCR over obstructed words, shell, progress and all controls', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = browsing35Fixture(), directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive191-');
  try {
    for (const [label, left, top, width, height] of [
      ['browse', 934, 1263, 62, 31], ['reward', 930, 1298, 77, 31],
      ['whole-badge', 878, 1230, 182, 146], ['progress', 906, 1336, 127, 17],
      ['arrow', 20, 120, 100, 80], ['coin', 900, 1090, 90, 130],
      ['cart', 316, 1924, 364, 106], ['buy', 680, 1924, 360, 106],
      ['live', 34, 1640, 168, 64], ['live-link', 892, 1640, 156, 64],
    ] as const) for (const background of ['#ffffff', '#000000', '#555555', '#e40010']) {
      const path = join(directory, `${label}-${background.slice(1)}.png`);
      await sharp(frame.path).composite([{ input: { create: { width, height, channels: 3, background } }, left, top }]).png().toFile(path);
      assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner, { rewardCoins: 35 }), null, `${label}:${background}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const thirtyFiveHistory = new URL('../evidence/staged-2026-11-01T10-35-22-744Z/', import.meta.url);
const thirtyFiveId = '33f7f285-7248-432d-8040-13aded9e3ebf';
const thirtyFiveFixture = (): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(thirtyFiveId + '.json', thirtyFiveHistory), 'utf8')),
  path: new URL(thirtyFiveId + '.png', thirtyFiveHistory).pathname,
});

test('184 real retained-browse completed35 is an explicit offline receipt candidate only', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = thirtyFiveFixture(), before = JSON.stringify(frame);
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 35 }), {
    state: 'completed', version: 'immersive-browse-candidate-v2', rewardCoins: 35, quote: '已得35',
  });
  for (const rewardCoins of [20, 50])
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins }), null);
  assert.equal(await inspectImmersiveBrowse(frame, owner), null);
  assert.equal(await inspectImmersiveBrowse(fixture(ids.browsing), owner, { rewardCoins: 35 }), null);
  assert.equal(JSON.stringify(frame), before);
});

test('184 completed35 rejects wrong owner, duplicate/missing words, wrong OCR and other retained-layout amounts', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = thirtyFiveFixture();
  for (const change of [
    { package: 'foreign.package' }, { userId: 10 }, { observationError: 'OCR failed' },
    { lines: frame.lines.filter(l => l.text !== '浏览') },
    ...['浏览', '已得35'].map(text => ({ lines: [...frame.lines, ...frame.lines.filter(l => l.text === text)] })),
    ...['已徳35', '已得350', '得35', '已得35下单得500', '已得20', '已得50'].map(text => ({
      lines: frame.lines.map(l => l.text === '已得35' ? { ...l, text } : l),
    })),
    { lines: frame.lines.map(l => l.text === '浏览' ? { ...l, text: '浏揽' } : l) },
    { lines: frame.lines.map(l => l.text === '已得35' ? { ...l, bounds: [920, 1270, 1014, 1301] } : l) },
  ]) assert.equal(await inspectImmersiveBrowse({ ...frame, ...change }, owner, { rewardCoins: 35 }), null);
  for (const rewardCoins of [20, 50]) {
    const lines = frame.lines.map(l => l.text === '已得35' ? { ...l, text: `已得${rewardCoins}` } : l);
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins }), null);
  }
  assert.equal(await inspectImmersiveBrowse(frame, { ...owner, userId: 10 }, { rewardCoins: 35 }), null);
});

test('184 complete badge words, amount, shell and controls reject occlusion even with stale OCR', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = thirtyFiveFixture(), directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive35-negative-');
  try {
    for (const [label, left, top, width, height] of [
      ['browse', 934, 1263, 62, 31], ['receipt', 920, 1297, 60, 32],
      ['amount', 981, 1297, 40, 32], ['shell', 1025, 1354, 20, 16],
      ['arrow', 20, 120, 100, 80], ['coin', 900, 1090, 90, 130],
      ['lower-controls', 316, 1924, 724, 106],
    ] as const) for (const background of ['#ffffff', '#000000', '#555555', '#e40010']) {
      const path = join(directory, `${label}-${background.slice(1)}.png`);
      await sharp(frame.path).composite([{ input: { create: { width, height, channels: 3, background } }, left, top }]).png().toFile(path);
      assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner, { rewardCoins: 35 }), null, `${label}:${background}`);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const fiftyHistory = new URL('../evidence/staged-2026-11-01T08-50-08-755Z/', import.meta.url);
const fiftyId = '50a8f18d-ec2e-47ed-a615-6ca435769c67';
const fiftyFixture = (): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(fiftyId + '.json', fiftyHistory), 'utf8')),
  path: new URL(fiftyId + '.png', fiftyHistory).pathname,
});

test('172 real browsing 50 badge accepts an explicit component amount and rejects mismatches', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fiftyFixture(), before = JSON.stringify(frame);
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }), {
    state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 50, waitMs: 3000,
  });
  assert.equal(await inspectImmersiveBrowse(frame, owner), null);
  assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 20 }), null);
  assert.equal(await inspectImmersiveBrowse(fixture(ids.completed), owner, { rewardCoins: 50 }), null);
  for (const rewardCoins of [0, -1, 20.5, NaN, Infinity, 500, 200, '50'])
    assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins } as any), null);
  assert.equal(JSON.stringify(frame), before);
});

const brightHistory = new URL('../evidence/staged-2026-11-01T09-23-20-159Z/', import.meta.url);
const brightId = 'a0e3fe73-b731-46ba-a719-c871aa449a26';
const brightFixture = (): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(brightId + '.json', brightHistory), 'utf8')),
  path: new URL(brightId + '.png', brightHistory).pathname,
});

test('174 real browsing 50 retains transparent arrow geometry over bright video', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = brightFixture();
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }), {
    state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 50, waitMs: 3000,
  });
});

const progressHistory = new URL('../evidence/staged-2026-11-01T10-11-27-294Z/', import.meta.url);
const progressId = '47e4c261-9c02-4c5b-b13e-16e4fbd256ff';
const progressFixture = (): DeviceFrame => ({
  ...JSON.parse(readFileSync(new URL(progressId + '.json', progressHistory), 'utf8')),
  path: new URL(progressId + '.png', progressHistory).pathname,
});

test('179 real browsing20 accepts the observed progress endpoint without changing amount or receipt authority', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = progressFixture(), before = JSON.stringify(frame);
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner), {
    state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 20, waitMs: 3000,
  });
  assert.equal(await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }), null);
  assert.equal(JSON.stringify(frame), before);
});

test('archived browsing progress stages preserve the shared slot rim and static badge', async () => {
  const { inspectImmersiveBrowse } = await load();
  for (const [directory, id, rewardCoins] of [
    [fiftyHistory, 'b0533fd3-6920-468b-9461-6a473ce3c822', 50],
    [brightHistory, 'eebccc54-7c52-4e1c-bda1-f6d6daafd406', 50],
    [progressHistory, 'b45c68b1-366e-4ce5-9ee1-b015d1bcc4e2', 20],
  ] as const) {
    const frame = { ...JSON.parse(readFileSync(new URL(id + '.json', directory), 'utf8')),
      path: new URL(id + '.png', directory).pathname };
    assert.deepEqual(await inspectImmersiveBrowse(frame, owner, { rewardCoins }), {
      state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins, waitMs: 3000,
    }, id);
  }
});

test('progress tolerance rejects neutral occlusions, malformed fill, overflow and adjacent text obstruction with stale OCR', async () => {
  const { inspectImmersiveBrowse } = await load();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-progress-negative-');
  try {
    for (const frame of [fixture(ids.browsing), fiftyFixture(), brightFixture(), progressFixture()]) {
      const rewardCoins = frame.id === fiftyId || frame.id === brightId ? 50 : 20;
      const edits = [
        ...['#ffffff', '#000000', '#555555'].flatMap(background => [
          { label: `slot-${background}`, left: 906, top: 1336, width: 127, height: 17, background },
          { label: `endpoint-${background}`, left: 913, top: 1340, width: 9, height: 9, background },
          { label: `text-${background}`, left: 937, top: 1318, width: 20, height: 23, background },
        ]),
        { label: 'rectangle', left: 906, top: 1336, width: 60, height: 17, background: '#feea1b' },
        { label: 'disconnected', left: 970, top: 1340, width: 12, height: 9, background: '#feea1b' },
        { label: 'overflow', left: 1028, top: 1330, width: 16, height: 29, background: '#feea1b' },
        { label: 'rim', left: 950, top: 1333, width: 20, height: 3, background: '#feea1b' },
      ];
      for (const edit of edits) {
        const path = join(directory, `${frame.id}-${edit.label}.png`);
        await sharp(frame.path).composite([{ input: { create: {
          width: edit.width, height: edit.height, channels: 3, background: edit.background,
        } }, left: edit.left, top: edit.top }]).png().toFile(path);
        assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner, { rewardCoins }), null,
          `${frame.id}:${edit.label}`);
      }
      // Moving the real, correctly rounded fill also violates the fixed left anchor.
      const shifted = join(directory, `${frame.id}-shifted.png`);
      const patch = await sharp(frame.path).extract({ left: 906, top: 1336, width: 127, height: 17 }).png().toBuffer();
      await sharp(frame.path).composite([
        { input: { create: { width: 127, height: 17, channels: 3, background: '#980911' } }, left: 906, top: 1336 },
        { input: patch, left: 920, top: 1336 },
      ]).png().toFile(shifted);
      assert.equal(await inspectImmersiveBrowse({ ...frame, path: shifted }, owner, { rewardCoins }), null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('50 requirement separates complete browse words from 500 purchase promotions and conflicting amounts', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fiftyFixture();
  for (const text of ['得500', '得50下单得500', '50', '已得50', '得20']) {
    const lines = frame.lines.map(l => l.text === '得50' ? { ...l, text } : l);
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins: 50 }), null, text);
  }
  for (const text of ['得20', '得500', '已得20']) {
    const lines = [...frame.lines, { text, bounds: [930, 1335, 1007, 1366] }];
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins: 50 }), null, text);
  }
  const stale = fixture(ids.browsing);
  const lines = stale.lines.map(l => l.text === '得20' ? { ...l, text: '得50' } : l);
  assert.equal(await inspectImmersiveBrowse({ ...stale, lines }, owner, { rewardCoins: 50 }), null);
  assert.equal((await inspectImmersiveBrowse(frame, owner, { rewardCoins: 50 }))?.state, 'browsing');
});

test('synthetic completed50 uses captured 50 glyphs, rejects stale amounts and occluded digits', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fixture(ids.completed), directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-synthetic-');
  try {
    // Synthetic edit only: transplant yellow 50 from 172, never a real completed50 observation.
    const digits = await sharp(fiftyFixture().path).extract({ left: 972, top: 1296, width: 35, height: 26 }).png().toBuffer();
    const path = join(directory, 'synthetic-completed50.png');
    await sharp(frame.path).composite([{ input: digits, left: 981, top: 1269 }]).png().toFile(path);
    const lines = frame.lines.map(l => l.text === '已得20' ? { ...l, text: '已得50' } : l);
    const synthetic = { ...frame, path, lines };
    assert.deepEqual(await inspectImmersiveBrowse(synthetic, owner, { rewardCoins: 50 }), {
      state: 'completed', version: 'immersive-browse-candidate-v2', rewardCoins: 50, quote: '已得50',
    });
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines }, owner, { rewardCoins: 50 }), null);
    assert.equal(await inspectImmersiveBrowse({ ...synthetic, lines: frame.lines }, owner), null);
    for (const base of [synthetic, fiftyFixture()]) {
      const top = base === synthetic ? 1270 : 1297;
      for (const background of ['#ffffff', '#e40010']) {
        const hidden = join(directory, `hidden-${top}-${background.slice(1)}.png`);
        await sharp(base.path).composite([{ input: { create: {
          width: 18, height: 26, channels: 3, background,
        } }, left: base === synthetic ? 981 : 972, top }]).png().toFile(hidden);
        assert.equal(await inspectImmersiveBrowse({ ...base, path: hidden }, owner, { rewardCoins: 50 }), null);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('145 original red video receipt returns 已得20 without a task-name requirement or actions', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fixture(ids.completed), before = JSON.stringify(frame);
  assert.ok(!frame.lines.some(l => l.text.includes('好物沉浸看')));
  assert.deepEqual(await inspectImmersiveBrowse(frame, owner), {
    state: 'completed', version: 'immersive-browse-candidate-v2', rewardCoins: 20, quote: '已得20',
  });
  assert.equal(JSON.stringify(frame), before);
});

test('145 original browsing badge supplies a <=3000ms observation slice with no claimed page duration', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fixture(ids.browsing), before = JSON.stringify(frame);
  const result = await inspectImmersiveBrowse(frame, owner);
  assert.deepEqual(result, { state: 'browsing', version: 'immersive-browse-candidate-v2', rewardCoins: 20, waitMs: 3000 });
  assert.equal(JSON.stringify(frame), before);
  assert.ok(!frame.lines.some(l => /浏览\d+秒/.test(l.text)));
});

test('header and badge obstruction reject even while stale OCR remains', async () => {
  const { inspectImmersiveBrowse } = await load();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-negative-');
  try {
    for (const id of [ids.browsing, ids.completed]) {
      const frame = fixture(id);
      for (const [label, region] of [
        ['header', { left: 20, top: 120, width: 100, height: 80 }],
        ['receipt-word', { left: 924, top: 1275, width: 26, height: 22 }],
        ['red-surface', { left: 1025, top: 1354, width: 20, height: 16 }],
      ] as const) {
        const path = join(directory, `${id}-${label}.png`);
        await sharp(frame.path).composite([{ input: { create: {
          width: region.width, height: region.height, channels: 3, background: '#ffffff',
        } }, left: region.left, top: region.top }]).png().toFile(path);
        assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner), null, `${id}:${label}`);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('opaque white black and gray controls reject with stale OCR on real video frames', async () => {
  const { inspectImmersiveBrowse } = await load();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-control-modal-');
  try {
    for (const frame of [fixture(ids.browsing), fixture(ids.completed), fiftyFixture(), brightFixture()]) {
      const rewardCoins = frame.id === fiftyId || frame.id === brightId ? 50 : 20;
      for (const [label, region] of [
        ['arrow', { left: 20, top: 120, width: 100, height: 80 }],
        ['coin', { left: 900, top: 1090, width: 90, height: 130 }],
      ] as const) for (const background of ['#ffffff', '#000000', '#555555']) {
        const path = join(directory, `${frame.id}-${label}-${background.slice(1)}.png`);
        await sharp(frame.path).composite([{ input: { create: {
          width: region.width, height: region.height, channels: 3, background,
        } }, left: region.left, top: region.top }]).png().toFile(path);
        assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner, { rewardCoins }), null,
          `${frame.id}:${label}:${background}`);
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('video texture and creator are not recognition requirements; visible blocked UI rejects', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fixture(ids.completed), directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-modal-');
  try {
    for (const background of ['#000000', '#555555', '#ffffff']) {
      const path = join(directory, background.slice(1) + '.png');
      await sharp(frame.path).composite([{ input: { create: {
        width: 700, height: 700, channels: 3, background,
      } }, left: 100, top: 650 }]).png().toFile(path);
      const changed = { ...frame, path, lines: frame.lines.map(l => l.text === '少得瓷' ? { ...l, text: '另一作者' } : l) };
      assert.equal((await inspectImmersiveBrowse(changed, owner))?.state, 'completed', background);
      assert.equal(await inspectImmersiveBrowse({ ...changed, lines: [...changed.lines,
        { text: '安全验证', bounds: [100, 800, 700, 850] }] }, owner), null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('transparent header and coin controls tolerate changed video behind their preserved glyphs', async () => {
  const { inspectImmersiveBrowse } = await load();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-chrome-');
  try {
    for (const frame of [fixture(ids.completed), fiftyFixture(), browsing35Fixture()]) {
      const raw = await sharp(frame.path).removeAlpha().raw().toBuffer();
      for (const box of [[48, 136, 80, 184], [910, 1100, 980, 1210]]) {
        for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
          const i = (y * 1080 + x) * 3;
          const foreground = box[0] === 48 ? raw[i] > 180 && raw[i + 1] > 180 && raw[i + 2] > 180
            : raw[i] > 180 && raw[i + 1] > 140 && raw[i + 2] < 100;
          if (!foreground) { raw[i] = 30; raw[i + 1] = 70; raw[i + 2] = 110; }
        }
      }
      const path = join(directory, frame.id + '.png');
      await sharp(raw, { raw: { width: 1080, height: 2400, channels: 3 } }).png().toFile(path);
      const rewardCoins = frame.id === browsing35Id ? 35 : frame.id === fiftyId ? 50 : 20;
      assert.ok(await inspectImmersiveBrowse({ ...frame, path }, owner, { rewardCoins }));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source manifest hashes actual JSON/PNGs and traces 146 recovery to the original 145 attempt', async () => {
  const { immersiveBrowseSource: source } = await load();
  assert.ok(source, 'Expose the candidate source manifest for runtime/replay consumers');
  assert.equal(source.sourceRunId, 145);
  assert.equal(source.recoveryRunId, 146);
  assert.deepEqual(source.amount50, { sourceRunId: 172, sourceStatus: 'stopped',
    browsingEvidence: 'real', completedEvidence: 'synthetic_only' });
  const stopped = JSON.parse(readFileSync(new URL('result.json', fiftyHistory), 'utf8'));
  assert.equal(stopped.runId, 172);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.receipt, null);
  assert.equal(stopped.gainCoins, null);
  assert.equal(source.waitPolicy.kind, 'observed_budget');
  assert.equal(source.waitPolicy.maxMs, 20000);
  assert.equal(source.waitPolicy.sliceMs, 3000);
  assert.equal(source.waitPolicy.pageRequiredMs, null);
  for (const file of Object.values(source.files) as any[]) {
    const bytes = readFileSync(new URL('../' + file.path, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
  const read = (key: string) => JSON.parse(readFileSync(new URL('../' + source.files[key].path, import.meta.url), 'utf8'));
  const original = read('executionResult'), recovered = read('recoveryResult'), proposal = read('contractProposal');
  assert.equal(original.runId, 145);
  assert.equal(original.status, 'unknown');
  assert.equal(recovered.runId, 146);
  assert.equal(recovered.sourceRunId, 145);
  assert.equal(recovered.taskAttemptId, original.taskAttemptId);
  assert.equal(recovered.receipt.taskAttemptId, original.taskAttemptId);
  assert.equal(recovered.receipt.frameId, ids.completed);
  assert.equal(recovered.gainCoins, 20);
  const contract = proposal.contracts.find((c: any) => c.sourceRunId === 146);
  assert.deepEqual(contract.executionSourceRunIds, [145]);
  assert.equal(contract.sourceResult.sha256, source.files.recoveryResult.sha256);
  assert.equal(contract.historicalFixtures.find((f: any) => f.png === source.files.completedPng.path).pngSha256,
    source.files.completedPng.sha256);
});

test('184 immutable sources bind real before20 and completed35 to the same stopped attempt without income', async () => {
  const { immersiveBrowseSource: source, inspectImmersiveBrowse } = await load();
  assert.deepEqual(source.amount35, { sourceRunId: 184, sourceStatus: 'stopped', browsingSourceRunId: 191, browsingEvidence: 'real', completedEvidence: 'real' });
  assert.equal(source.files.browsing35Png.path, `evidence/staged-2026-11-01T11-23-10-672Z/${browsing35Id}.png`);
  assert.equal(source.files.browsing35Frame.path, `evidence/staged-2026-11-01T11-23-10-672Z/${browsing35Id}.json`);
  const browsingResult = JSON.parse(readFileSync(new URL('result.json', browsing35History), 'utf8'));
  assert.equal(browsingResult.runId, 191);
  assert.equal(browsingResult.status, 'stopped');
  for (const key of ['receipt', 'gainCoins', 'balanceAfter']) assert.equal(browsingResult[key], null);
  const read = (key: string) => JSON.parse(readFileSync(new URL('../' + source.files[key].path, import.meta.url), 'utf8'));
  const result = read('variant35Result'), stages = read('variant35Stages');
  assert.equal(result.runId, 184);
  assert.equal(result.taskAttemptId, '5584c9b6-8a2b-42c0-b263-b85b32a74890');
  assert.equal(result.status, 'stopped');
  for (const key of ['receipt', 'gainCoins', 'balanceAfter']) assert.equal(result[key], null);
  const selected = stages.find((s: any) => s.stageId === 'select_task').task;
  for (const key of ['name', 'done', 'total', 'instruction', 'reward', 'button']) assert.equal(selected[key], result.task[key]);
  const entry = stages.find((s: any) => s.stageId === 'open_task');
  assert.deepEqual(entry.task, result.task);
  assert.equal(entry.actions[0].proposal.frameId, result.task.frameId);
  assert.equal(entry.actions[0].status, 'verified');
  const stage = stages.find((s: any) => s.stageId === 'task_receipt');
  const observed = stage.events.filter((e: any) => e.type === 'observed').map((e: any) => e.frame);
  assert.deepEqual(observed.map((f: DeviceFrame) => f.id), [
    '3a3d237c-00d4-4502-82db-2e85d084e370', '9d4e78b4-4cbc-4fe8-b02c-71ec163b4dcb', thirtyFiveId,
  ]);
  assert.deepEqual(observed[0], read('variant35BeforeFrame'));
  assert.deepEqual(observed[2], thirtyFiveFixture());
  assert.ok(observed[0].capturedAt < observed[1].capturedAt && observed[1].capturedAt < observed[2].capturedAt);
  assert.deepEqual(stage.actions.map((a: any) => a.proposal.action), [{ type: 'wait', ms: 3000 }, { type: 'wait', ms: 3000 }]);
  assert.deepEqual(stage.actions.map((a: any) => a.proposal.frameId), observed.slice(0, 2).map((f: DeviceFrame) => f.id));
  assert.equal((await inspectImmersiveBrowse(observed[0], owner, { rewardCoins: 20 }))?.state, 'browsing');
  // 184's before frame is genuinely 20; the separate real 191 frame supplies browsing35.
  assert.equal(await inspectImmersiveBrowse(observed[0], owner, { rewardCoins: 35 }), null);
  assert.equal(await inspectImmersiveBrowse(observed[2], owner, { rewardCoins: 20 }), null);
});

test('all original completed video frames retain eligibility across playback changes', async () => {
  const { inspectImmersiveBrowse } = await load();
  for (const id of [ids.completed, 'f8034a17-81c1-45d1-a380-eb92ee485118',
    'ea6d26ac-14a7-4f77-850e-f849aadf74fb', '477961f4-a350-4908-811d-726669d4837b',
    'f6edbcfe-6cbd-42fe-b34c-f9bd5ec7dd83', '2462a432-0e8a-4e4a-b4cc-5ee3bd96c9b6',
    'fb9f9f7f-9818-449f-80af-7339aac40eba'])
    assert.equal((await inspectImmersiveBrowse(fixture(id), owner))?.state, 'completed', id);
});

test('original list, pending navigation, order-only 500 promotion and back transition are unknown even with stale receipt OCR', async () => {
  const { inspectImmersiveBrowse } = await load();
  for (const id of ['3a1c2476-ad2e-4d27-84d4-3ff964daf120', '69807d28-0c87-44d3-a85a-2797f47fae0a',
    '8c99940f-60f4-4895-94f1-12e6f8eeaf48', '53d057a1-91cc-41e8-975e-dbeacf7b908a',
    '310cf687-c761-48af-8b41-e1ac7faaad87', '21668a68-2dd6-4a69-a28f-6a80f920d091']) {
    const frame = fixture(id);
    assert.equal(await inspectImmersiveBrowse(frame, owner), null, id);
    for (const base of [fixture(ids.completed), fixture(ids.browsing)])
      assert.equal(await inspectImmersiveBrowse({ ...base, path: frame.path }, owner), null, `stale:${id}`);
  }
});

test('scope, complete badge words, placement and conflicting UI fail closed', async () => {
  const { inspectImmersiveBrowse } = await load();
  for (const frame of [fixture(ids.completed), fixture(ids.browsing)]) {
    for (const change of [
      { package: 'foreign.package' }, { userId: 10 }, { observationError: 'OCR failed' },
      { lines: [] }, { width: 540 }, { id: '' }, { id: 7 }, { capturedAt: NaN },
      { lines: frame.lines.map((l, i) => i ? l : { ...l, bounds: [NaN, 1, 20, 30] }) },
      { lines: [...frame.lines, { text: '已得50', bounds: [200, 400, 400, 450] }] },
      ...['任务列表', '赚金币抵钱', '请登录', '安全验证', '授权', '确定要离开吗', '当前页下单'].map(text => ({
        lines: [...frame.lines, { text, bounds: [100, 800, 700, 850] }],
      })),
      { lines: frame.lines.map(l => l.text === '已得20' || l.text === '浏览'
        ? { ...l, bounds: [100, 500, 194, 531] } : l) },
      { lines: frame.lines.map(l => l.text === '已得20' || l.text === '得20' ? { ...l, text: '已得500' } : l) },
      { lines: [...frame.lines, ...frame.lines.filter(l => l.text === '已得20' || l.text === '浏览')] },
    ]) assert.equal(await inspectImmersiveBrowse({ ...frame, ...change }, owner), null, JSON.stringify(change));
    for (const scope of [{ package: 'other', userId: 0 }, { ...owner, userId: -1 }, { ...owner, userId: 0.5 }])
      assert.equal(await inspectImmersiveBrowse(frame, scope), null);
  }
  const frame = fixture(ids.completed);
  for (const quote of ['下单再得500', '已得200', '已得20下单再得500', '任务已完成'])
    assert.equal(await inspectImmersiveBrowse({ ...frame, lines: frame.lines.map(l => l.text === '已得20' ? { ...l, text: quote } : l) }, owner), null);
});

test('invalid image bytes, dimensions and unsupported files reject locally', async () => {
  const { inspectImmersiveBrowse } = await load();
  const frame = fixture(ids.completed), directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/immersive-invalid-');
  try {
    const corrupt = join(directory, 'bad.png'), resized = join(directory, 'resized.png'), jpeg = join(directory, 'frame.jpg');
    await writeFile(corrupt, 'invalid PNG');
    await sharp(frame.path).resize(540, 1200).png().toFile(resized);
    await sharp(frame.path).jpeg().toFile(jpeg);
    for (const path of [corrupt, resized, jpeg, join(directory, 'missing.png')])
      assert.equal(await inspectImmersiveBrowse({ ...frame, path }, owner), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
