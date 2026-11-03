import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const successful = new URL('../evidence/continuous-supervised-2026-11-01T05-18-43-216Z/', import.meta.url);
const fixture = (directory: URL, id: string) => {
  const frame = JSON.parse(readFileSync(new URL(id + '.json', directory), 'utf8'));
  frame.path = new URL(id + '.png', directory).pathname;
  assert.ok(existsSync(frame.path), 'Replay requires the original PNG');
  return frame;
};
const entry = () => fixture(successful, 'bfbc7cc8-510d-4133-82f7-1a432fa97af7');
const owner = { package: 'com.taobao.taobao', userId: 0 };
const proposed = { type: 'swipe', fromX: 120, fromY: 2100, toX: 120, toY: 600, ms: 500 };
const load = async () => {
  const module = new URL('../runner/staged/browse-revalidation.ts', import.meta.url);
  assert.ok(existsSync(module), 'The learned browse revalidation module must be implemented');
  return import(module.href);
};
// Offline replay reuses the original PNG/OCR with synthetic id/time metadata;
// it does not assert that an independent second capture or model review occurred.
const recapture = (frame: any) => ({ ...structuredClone(frame), id: frame.id + '-replay', capturedAt: frame.capturedAt + 20000 });

test('153 original OCR and PNG regenerate a content swipe after the old proposal has aged', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry(), fresh = recapture(old);
  const before = JSON.stringify({ old, fresh, proposed });
  const result = await revalidateBrowseSwipe(old, fresh, proposed, owner);
  assert.ok(result, 'The locally unchanged learned destination should be eligible');
  assert.equal(result.action.type, 'swipe');
  assert.equal(result.action.ms, 900);
  assert.ok(result.action.fromX > 520 && result.action.fromX < 560);
  assert.equal(result.action.toX, result.action.fromX);
  assert.ok(result.action.fromY > result.action.toY);
  assert.ok(result.action.toY > 260 && result.action.fromY < 2250);
  assert.notDeepEqual(result.action, proposed, 'Old coordinates must never be renewed');
  assert.match(result.reason, /153/);
  assert.equal(JSON.stringify({ old, fresh, proposed }), before);
});

// Derivatives are made only in scratch. Historical evidence stays byte-for-byte intact.
async function altered(frame: any, rectangles: { left: number; top: number; width: number; height: number; colour: string }[], run: (path: string) => Promise<void>) {
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/browse-revalidation-');
  try {
    const path = join(directory, 'derived.png');
    await sharp(frame.path).composite(rectangles.map(r => ({
      input: Buffer.from(`<svg width="${r.width}" height="${r.height}"><rect width="100%" height="100%" fill="${r.colour}"/></svg>`),
      left: r.left, top: r.top,
    }))).png().toFile(path);
    await run(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('reviewed old products need only match fresh products, not the 153 template', async () => {
  const { revalidateBrowseSwipe } = await load();
  const source = entry();
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/browse-revalidation-');
  try {
    // Synthetic unit fixture: swap two complete left-column product rows and
    // translate their original OCR with them. This is neither historical 152
    // evidence nor an independently captured/model-reviewed frame. The caller
    // must already have reviewed the full old image and proposed this swipe.
    const rowHeight = 781, top = 260, middle = top + rowHeight;
    const first = await sharp(source.path).extract({ left: 0, top, width: 540, height: rowHeight }).png().toBuffer();
    const second = await sharp(source.path).extract({ left: 0, top: middle, width: 540, height: rowHeight }).png().toBuffer();
    const path = join(directory, 'synthetic-swapped-products.png');
    await sharp(source.path).composite([{ input: second, left: 0, top }, { input: first, left: 0, top: middle }]).png().toFile(path);
    const old = { ...source, path, lines: source.lines.map((l: any) => {
      if (l.bounds[2] >= 540 || l.bounds[1] < top || l.bounds[3] >= middle + rowHeight) return structuredClone(l);
      assert.ok(l.bounds[3] < middle || l.bounds[1] >= middle, 'OCR must not cross swapped row boundaries');
      const dy = l.bounds[1] < middle ? rowHeight : -rowHeight;
      return { ...l, bounds: [l.bounds[0], l.bounds[1] + dy, l.bounds[2], l.bounds[3] + dy] };
    }) };
    assert.notDeepEqual(await sharp(path).raw().toBuffer(), await sharp(source.path).raw().toBuffer());
    const fresh = recapture(old);
    assert.ok(await revalidateBrowseSwipe(old, fresh, proposed, owner), 'Unchanged reviewed products must not be pinned to 153');
    assert.equal(await revalidateBrowseSwipe(source, { ...fresh, lines: source.lines }, proposed, owner), null,
      'Changing the products between old and fresh still rejects, even with stale OCR');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unchanged old/fresh header occlusion still rejects against the learned header', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry();
  await altered(old, [{ left: 552, top: 198, width: 420, height: 40, colour: '#ffffff' }], async path => {
    const covered = { ...old, path };
    assert.equal(await revalidateBrowseSwipe(covered, recapture(covered), proposed, owner), null);
  });
});

test('invalid swipe proposals never gain authority through revalidation', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry(), fresh = recapture(old);
  for (const action of [null, { type: 'tap', x: 10, y: 10 }, { type: 'swipe' },
    { ...proposed, ms: 0 }, { ...proposed, fromX: -1 }, { ...proposed, toY: NaN },
    { ...proposed, fromY: 600, toY: 2100 }, { ...proposed, toX: 600 }]) {
    assert.equal(await revalidateBrowseSwipe(old, fresh, action, owner), null, JSON.stringify(action));
  }
});

test('countdown tolerance never masks the adjacent requirement word 秒', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry();
  await altered(old, [{ left: 714, top: 145, width: 12, height: 35, colour: '#000000' }], async path => {
    assert.equal(await revalidateBrowseSwipe(old, { ...recapture(old), path }, proposed, owner), null);
  });
});

test('original 152 candidate is a replay rejection with a different header chevron and missing left-column description', async () => {
  const { revalidateBrowseSwipe } = await load();
  const normal = new URL('../evidence/staged-2026-11-01T05-11-55-681Z/', import.meta.url);
  const candidate = fixture(normal, '58f3ce35-4196-44e5-830d-371f19ea6058');
  assert.ok(candidate.lines.some((l: any) => l.text === '浏览10秒可领币50～'));
  assert.ok(candidate.lines.some((l: any) => l.text === '任意下单最高另得500淘金币'));
  assert.deepEqual([0, 540].map(left => candidate.lines.filter((l: any) => l.bounds[0] >= left
    && l.bounds[0] < left + 540 && l.bounds[1] > 266 && /正品保证|七天退换/.test(l.text)).length), [1, 2]);
  const pixels = await sharp(candidate.path).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const learned = await sharp(entry().path).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const differentTiles: number[][] = [];
  // Diagnose the real header mismatch with the existing tolerance; do not
  // replace historical pixels/OCR to pretend this is a passing 152 capture.
  for (let y = 102; y < 260; y += 32) for (let x = 0; x < 1080; x += 32) {
    let changed = 0, count = 0;
    for (let yy = y; yy < Math.min(y + 32, 260); yy++) for (let xx = x; xx < Math.min(x + 32, 1080); xx++) {
      if (xx >= 650 && xx <= 705 && yy >= 137 && yy <= 195) continue;
      const i = (yy * 1080 + xx) * 3;
      if ([0, 1, 2].some(k => Math.abs(pixels[i + k] - learned[i + k]) > 20)) changed++;
      count++;
    }
    if (count && changed / count > 0.025) differentTiles.push([x, y]);
  }
  assert.deepEqual(differentTiles, [[960, 134], [992, 134], [960, 166], [992, 166]],
    'The original 152 double chevron differs from the learned 153 header');
  assert.equal(await revalidateBrowseSwipe(candidate, recapture(candidate), proposed, owner), null);
});

test('all original historical frames replay conservatively, including 152 transitions and 153 receipts', async () => {
  const { revalidateBrowseSwipe } = await load();
  const normal = new URL('../evidence/staged-2026-11-01T05-11-55-681Z/', import.meta.url);
  const old = entry();
  let replayed = 0, completed = 0, ocrFailure = 0, taskPanels = 0, otherProducts = 0;
  for (const directory of [successful, normal]) {
    for (const name of readdirSync(directory).filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
      const frame = fixture(directory, name.slice(0, -5));
      if (!Array.isArray(frame.lines) || frame.id === old.id) continue;
      // Self replay proves a stable unrelated page is still ineligible. The
      // second check replays its pixels as a later capture after the learned entry.
      assert.equal(await revalidateBrowseSwipe(frame, recapture(frame), proposed, owner), null, name);
      const newer = { ...frame, capturedAt: old.capturedAt + 20000 };
      assert.equal(await revalidateBrowseSwipe(old, newer, proposed, owner), null, 'destination changed: ' + name);
      replayed++;
      const text = frame.lines.map((l: any) => l.text).join('|');
      if (text.includes('已得币50')) completed++;
      else if (frame.observationError) ocrFailure++;
      else if (text.includes('去完成')) taskPanels++;
      else otherProducts++;
    }
  }
  assert.ok(replayed >= 25, 'Do not silently lose historical coverage');
  assert.ok(completed >= 2 && ocrFailure >= 1 && taskPanels >= 10 && otherProducts >= 5);
});

test('full requirement, fresh scope, dimensions and valid OCR are mandatory', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry(), fresh = recapture(old);
  const changeLine = (predicate: (l: any) => boolean, modify: (l: any) => any) => ({
    ...recapture(old), lines: old.lines.map((l: any) => predicate(l) ? modify(structuredClone(l)) : structuredClone(l)),
  });
  const invalid = [
    null, { ...fresh, package: 'com.example.other' }, { ...fresh, userId: 10 },
    { ...fresh, userId: undefined }, { ...fresh, observationError: 'OCR pending' },
    { ...fresh, width: 720, height: 1600 }, { ...fresh, width: 2400, height: 1080 },
    { ...fresh, lines: [] }, { ...fresh, id: old.id }, { ...fresh, capturedAt: old.capturedAt },
    { ...fresh, capturedAt: NaN }, { ...fresh, path: '' },
    { ...fresh, lines: fresh.lines.filter((l: any) => !l.text.includes('任意下单')) },
    { ...fresh, lines: fresh.lines.filter((l: any) => l.text.includes('浏览10秒')) },
    changeLine(l => l.text.includes('浏览10秒'), l => ({ ...l, text: '浏览10秒可领币500～' })),
    changeLine(l => l.text.includes('浏览10秒'), l => ({ ...l, bounds: [553, 700, 1028, 750] })),
    changeLine(l => l.text === '金币热卖价', l => ({ ...l, bounds: [0, 0, NaN, 20] })),
    { ...fresh, lines: [...fresh.lines, fresh.lines.find((l: any) => l.text.includes('浏览10秒'))] },
    ...['请登录', '请完成安全验证', '允许授权', '确认', '已得币50', '去完成', '任务完成'].map(text => ({
      ...recapture(old), lines: [...old.lines, { text, bounds: [100, 800, 500, 850] }],
    })),
  ];
  for (const frame of invalid) {
    assert.equal(await revalidateBrowseSwipe(old, frame, proposed, owner), null);
    assert.equal(await revalidateBrowseSwipe(frame, fresh, proposed, owner), null);
  }
  for (const scope of [null, {}, { ...owner, package: 'com.example.other' }, { ...owner, userId: -1 }, { ...owner, userId: '0' }]) {
    assert.equal(await revalidateBrowseSwipe(old, fresh, proposed, scope), null);
  }
});

test('fresh OCR anchors regenerate coordinates and small OCR jitter stays bounded', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry(), fresh = recapture(old);
  fresh.lines = fresh.lines.map((l: any) => ({ ...l, bounds: l.bounds.map((v: number) => v + 1) }));
  const original = await revalidateBrowseSwipe(old, recapture(old), proposed, owner);
  const changed = await revalidateBrowseSwipe(old, fresh, proposed, owner);
  assert.ok(original && changed);
  assert.equal(changed.action.fromX, original.action.fromX + 1);
  assert.equal(changed.action.fromY, original.action.fromY + 1);
  assert.equal(changed.action.toY, original.action.toY + 1);
});

test('real PNG derivatives permit status clock and countdown digit changes only', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry();
  await altered(old, [{ left: 0, top: 0, width: 1080, height: 100, colour: '#333333' },
    { left: 652, top: 140, width: 52, height: 52, colour: '#ff8800' }], async path => {
    const fresh = { ...recapture(old), path, lines: old.lines.map((l: any) => ({
      ...l, text: l.text.includes('浏览10秒') ? l.text.replace('10秒', '9秒') : l.text,
    })) };
    assert.ok(await revalidateBrowseSwipe(old, fresh, proposed, owner));
  });
});

test('fresh visual overlays and content changes reject even if OCR still reports the old page', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry();
  const changes = [
    { left: 100, top: 900, width: 880, height: 600, colour: '#ffffff' },
    { left: 520, top: 1300, width: 40, height: 40, colour: '#000000' },
    { left: 0, top: 2100, width: 1080, height: 180, colour: '#777777' },
    { left: 552, top: 198, width: 420, height: 40, colour: '#ff8800' },
    { left: 0, top: 102, width: 1080, height: 158, colour: '#ffffff' },
  ];
  for (const rectangle of changes) await altered(old, [rectangle], async path => {
    assert.equal(await revalidateBrowseSwipe(old, { ...recapture(old), path }, proposed, owner), null);
  });
  const completed = fixture(successful, '17cbd398-0659-40fc-90d7-79d3ee3c188f');
  assert.equal(await revalidateBrowseSwipe(old, { ...recapture(old), path: completed.path }, proposed, owner), null);
});

test('missing, corrupt and dimension-mismatched PNGs fail closed', async () => {
  const { revalidateBrowseSwipe } = await load();
  const old = entry(), fresh = recapture(old);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/browse-revalidation-');
  try {
    const corrupt = join(directory, 'corrupt.png'), resized = join(directory, 'resized.png');
    await writeFile(corrupt, 'invalid PNG');
    await sharp(old.path).resize(540, 1200).toFile(resized);
    for (const path of [join(directory, 'missing.png'), corrupt, resized]) {
      assert.equal(await revalidateBrowseSwipe(old, { ...fresh, path }, proposed, owner), null);
      assert.equal(await revalidateBrowseSwipe({ ...old, path }, fresh, proposed, owner), null);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
