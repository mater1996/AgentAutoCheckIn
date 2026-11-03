import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const root = new URL('../', import.meta.url).pathname;
const owner = { package: 'com.taobao.taobao', userId: 0 };
async function evidence(run: number) {
  const directory = join(root, 'data/stage-records/accounts/taobao/tb_main/tb_coin/sessions');
  for (const file of await readdir(directory)) {
    const session = JSON.parse(await readFile(join(directory, file), 'utf8'));
    if (session.runId !== run) continue;
    const dir = join(root, session.evidenceDir);
    const result = JSON.parse(await readFile(join(dir, 'result.json'), 'utf8'));
    const stages = JSON.parse(await readFile(join(dir, 'stages.json'), 'utf8'));
    const entry = stages.find((s: any) => s.stageId === 'open_task').events
      .filter((e: any) => e.type === 'observed').at(-1).frame;
    const receipt = JSON.parse(await readFile(join(dir, result.receipt.frameId + '.json'), 'utf8'));
    return { entry, receipt, result };
  }
  throw Error('Missing fixture');
}
test('historical contracts replay four original destinations and 134 original receipt without invented waiting', async () => {
  const mod = await load();
  assert.equal(typeof mod.buildHistoricalDwellContract, 'function');
  const { loadHistoricalDwellEvidence } = await import('../runner/staged/dwell-evidence.ts');
  for (const [run, ms] of [[129,15000],[130,5000],[131,10000],[132,5000],[134,1000]]) {
    const source = await loadHistoricalDwellEvidence(root, run);
    const contract = JSON.parse(JSON.stringify(await mod.buildHistoricalDwellContract(root, run)));
    assert.equal(contract.dwellMs, ms);
    assert.equal((await mod.inspectDwellBrowse(source.receipt, owner, contract))?.state, 'completed', String(run));
    assert.equal((await mod.inspectDwellBrowse(source.browsing, owner, contract))?.state, run === 134 ? 'completed' : 'browsing', String(run));
    if (run === 134) {
      assert.equal(contract.receiptOnly, true);
      assert.deepEqual(contract.knownRequirements, []);
      assert.equal(contract.provenance.executionRunId, 133);
    }
  }
});

test('162 stable chrome ignores dynamic voucher/product OCR but rejects a changed destination header', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const c = await buildDwellContract(root, 162), { entry } = await evidence(162);
  assert.ok(c.browsing.identity.every(a => !/193|不锈钢|高硬度/.test(a.pattern)));
  const dynamic = { ...entry, lines: entry.lines.map((l: any) => /193|不锈钢|高硬度/.test(l.text) ? { ...l, text: '当前商品与券动态改变' } : l) };
  assert.equal((await inspectDwellBrowse(dynamic, owner, c))?.state, 'browsing');
  assert.equal(await inspectDwellBrowse({ ...entry, lines: entry.lines.map((l: any) => /找到以下宝贝/.test(l.text) ? { ...l, text: '其他页面' } : l) }, owner, c), null);
});

const load = () => import('../runner/staged/dwell-browse.ts');
const real173 = async () => JSON.parse(await readFile(join(root, 'evidence/staged-2026-11-01T08-52-27-447Z/187cca1e-60c0-4f0b-b6a4-64ec2c2a4524.json'), 'utf8'));

test('173 real destination survives merged chrome OCR and locally misread requirement with different products', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const c = await buildDwellContract(root, 162), frame = await real173();
  assert.equal(c.version, 'dwell-browse-candidate-v1:sha256:cedfd6a323bfae0fa9ce3d3976f239183a8c2e264a494ac37f614fadf35ae7b5');
  assert.deepEqual(await inspectDwellBrowse(frame, owner, c), { state: 'browsing', waitMs: 5000, version: c.version });
  // Same pixels, different OCR segmentation must produce the same decision.
  const split = { ...frame, lines: frame.lines.flatMap((l: any) => l.text === '综合 热销 价格：'
    ? [{ text: '综合', bounds: [704,258,780,300] }, { text: '热销', bounds: [824,258,900,300] }, { text: '价格：', bounds: [946,258,1052,304] }]
    : [{ ...l, text: l.text === '会测览5利' ? '浏览5秒' : l.text }]) };
  assert.deepEqual(await inspectDwellBrowse(split, owner, c), await inspectDwellBrowse(frame, owner, c));
  for (const text of ['浏览10秒', '浏览3秒']) {
    const wrong = { ...frame, lines: frame.lines.map((l: any) => l.text === '会测览5利' ? { ...l, text } : l) };
    assert.equal(await inspectDwellBrowse(wrong, owner, c), null, text);
  }
  assert.equal(await inspectDwellBrowse({ ...frame, lines: [...frame.lines, { text: '浏览5秒', bounds: [300,800,400,840] }] }, owner, c), null);
});

test('180 merged brand and sort row uses exact same-frame local sort evidence', async () => {
  const {buildDwellContract,inspectDwellBrowse}=await load();
  const c=await buildDwellContract(root,162);
  const frame=JSON.parse(await readFile(join(root,'evidence/staged-2026-11-01T10-16-43-937Z/0836c792-2d3d-428c-9164-57e581ff94df.json'),'utf8'));
  assert.deepEqual(await inspectDwellBrowse(frame,owner,c),{state:'browsing',waitMs:5000,version:c.version});
  assert.equal(await inspectDwellBrowse({...frame,lines:frame.lines.filter((l:any)=>!l.text.includes('综合'))},owner,c),null);
  assert.equal(await inspectDwellBrowse({...frame,lines:[...frame.lines,{text:'综合',bounds:[100,800,200,840]}]},owner,c),null);
  const directory=await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-180-');
  try {
    const path=join(directory,'occluded-sort.png');
    await sharp(frame.path).composite([{input:{create:{width:76,height:42,channels:3,background:'#ffffff'}},left:704,top:258}]).png().toFile(path);
    assert.equal(await inspectDwellBrowse({...frame,path},owner,c),null);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('178 real translucent reward text is read locally without a misspelling whitelist', async () => {
  const {buildDwellContract,inspectDwellBrowse}=await load();
  const c=await buildDwellContract(root,162);
  const frame=JSON.parse(await readFile(join(root,'evidence/staged-2026-11-01T10-09-45-444Z/5fd94b9d-862b-498f-9d8b-84daee8a8a93.json'),'utf8'));
  assert.deepEqual(await inspectDwellBrowse(frame,owner,c),{state:'browsing',waitMs:5000,version:c.version});
  for(const text of ['浏览10秒','浏览3秒'])assert.equal(await inspectDwellBrowse({...frame,lines:frame.lines.map((l:any)=>l.text==='量刘览5秒'?{...l,text}:l)},owner,c),null);
});

test('photo destination does not bind product OCR contrast or component line segmentation', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const c = await buildDwellContract(root, 162), frame = await real173();
  const faintProduct = { ...frame, lines: [...frame.lines, { text: '商品浅色水印', bounds: [532,630,540,640] }] };
  assert.equal((await inspectDwellBrowse(faintProduct, owner, c))?.state, 'browsing');
  const grouped = { ...frame, lines: frame.lines.filter((l: any) => !/会测览5利|得奖励/.test(l.text))
    .concat([{ text: '浏览5秒 得奖励', bounds: [916,1841,1014,1905] }]) };
  assert.equal((await inspectDwellBrowse(grouped, owner, c))?.state, 'browsing');
});

test('175 real receipt replays source 162 despite merged sort OCR and translucent product background', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const c = await buildDwellContract(root, 162);
  const frame = JSON.parse(await readFile(join(root, 'evidence/staged-2026-11-01T09-25-55-016Z/8dee42ce-b9be-478e-9447-e1cf24f918d5.json'), 'utf8'));
  assert.equal(c.version, 'dwell-browse-candidate-v1:sha256:cedfd6a323bfae0fa9ce3d3976f239183a8c2e264a494ac37f614fadf35ae7b5');
  const expected = { state: 'completed', quote: '+20 任务已完成 继续逛逛吧', version: c.version };
  assert.deepEqual(await inspectDwellBrowse(frame, owner, c), expected);
  const split = { ...frame, lines: frame.lines.flatMap((l: any) => l.text === '综合 热销 价格：'
    ? [{ text: '综合', bounds: [704,258,780,300] }, { text: '热销', bounds: [824,258,900,300] }, { text: '价格：', bounds: [946,258,1052,304] }]
    : [l]) };
  assert.deepEqual(await inspectDwellBrowse(split, owner, c), expected);
  for (const text of ['+20', '任务已完成', '继续逛逛吧']) {
    assert.equal(await inspectDwellBrowse({ ...frame, lines: frame.lines.filter((l: any) => l.text !== text) }, owner, c), null, text);
    assert.equal(await inspectDwellBrowse({ ...frame, lines: [...frame.lines, { text, bounds: [100,800,300,840] }] }, owner, c), null, 'duplicate ' + text);
  }
  assert.equal(await inspectDwellBrowse({ ...frame, userId: 10 }, owner, c), null);
  assert.equal(await inspectDwellBrowse({ ...frame, lines: frame.lines.map((l: any) => l.text === '+20' ? { ...l, text: '+30' } : l) }, owner, c), null);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-175-');
  try {
    for (const [i, b] of [[931,1689,1006,1726], [926,1740,1006,1800], [900,1834,1048,1918], [960,1844,976,1860], [900,1874,1040,1908], [704,258,780,300]].entries()) {
      const path = join(directory, `occluded-${i}.png`);
      await sharp(frame.path).composite([{ input: { create: { width: b[2]-b[0], height: b[3]-b[1], channels: 3, background: '#777777' } }, left: b[0], top: b[1] }]).png().toFile(path);
      assert.equal(await inspectDwellBrowse({ ...frame, path }, owner, c), null, 'stale OCR over obstruction ' + i);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('all historical component crops reject obstruction, list identity, wrong owner and promotional text alone', async () => {
  const { buildHistoricalDwellContract, inspectDwellBrowse } = await load();
  const { loadHistoricalDwellEvidence } = await import('../runner/staged/dwell-evidence.ts');
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-history-pixels-');
  try {
    for (const run of [129,130,131,132,134]) {
      const s = await loadHistoricalDwellEvidence(root, run), c = await buildHistoricalDwellContract(root, run);
      for (const frame of [s.browsing, s.receipt]) {
        assert.equal(await inspectDwellBrowse({ ...frame, userId: 10 }, owner, c), null);
        assert.equal(await inspectDwellBrowse({ ...frame, lines: [...frame.lines, { text: '赚金币抵钱', bounds: [100,500,400,550] }] }, owner, c), null);
        assert.equal(await inspectDwellBrowse({ ...frame, lines: frame.lines.filter(l => !/任务已完成|继续逛逛吧|得奖励|浏览\d+秒/.test(l.text)) }, owner, c), null);
        const b = c.receipt.visualBoxes[0], path = join(directory, `${run}-${frame.id}.png`);
        await sharp(frame.path).composite([{ input: { create: { width: b[2]-b[0], height: b[3]-b[1], channels: 3, background: '#ffffff' } }, left: b[0], top: b[1] }]).png().toFile(path);
        assert.equal(await inspectDwellBrowse({ ...frame, path }, owner, c), null);
      }
      const other = await loadHistoricalDwellEvidence(root, run === 129 ? 130 : 129);
      assert.equal(await inspectDwellBrowse(other.receipt, owner, c), null);
    }
    // Historical flash exit overlay remains a return proposal, never a dwell completion.
    const s = await loadHistoricalDwellEvidence(root, 131), c = await buildHistoricalDwellContract(root, 131);
    const p = join(root, 'evidence/ocr-browse-2026-11-01T00-53-49-661Z/frame-15.json');
    const old = JSON.parse(await readFile(p, 'utf8')).pages[0];
    assert.equal(await inspectDwellBrowse({ ...s.receipt, path: old.file, lines: old.lines }, owner, c), null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source-specific contracts cover 160/161 and preserve obstructed 168 rejection', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  for (const run of [160, 161]) {
    const contract = await buildDwellContract(root, run);
    const { entry, receipt } = await evidence(run);
    assert.equal((await inspectDwellBrowse(entry, owner, contract))?.state, 'browsing', String(run));
    assert.equal((await inspectDwellBrowse(receipt, owner, contract))?.state, 'completed', String(run));
  }
  for (const run of [164, 165]) {
    const contract = await buildDwellContract(root, run);
    const { entry, receipt } = await evidence(run);
    assert.equal((await inspectDwellBrowse(entry, owner, contract))?.state, 'browsing');
    assert.equal((await inspectDwellBrowse(receipt, owner, contract))?.state, 'completed');
    assert.equal(contract.dwellMs, 5000);
    assert.ok(contract.knownRequirements.length);
  }
  // Real 168 receipt is under a dimmed tutorial overlay: fail closed even though
  // the reward badge itself says completed.
  await assert.rejects(buildDwellContract(root, 168), /Source contract does not replay/);
});

test('rejects wrong scope, panels, login, advertisements and incomplete or relocated OCR', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const contract = await buildDwellContract(root, 162);
  const { entry, receipt, result } = await evidence(162);
  const panel = JSON.parse(await readFile(result.task.beforeFrame.ocrPath, 'utf8'));
  for (const base of [entry, receipt]) {
    for (const mutation of [
      { package: 'other.app' }, { userId: 10 }, { observationError: 'OCR failed' }, { lines: [] },
      { lines: [...base.lines, { text: '登录', bounds: [100, 800, 400, 850] }] },
      { lines: [...base.lines, { text: '请登录', bounds: [100, 800, 400, 850] }] },
      { lines: [...base.lines, { text: '广告', bounds: [100, 800, 400, 850] }] },
      { lines: base.lines.filter((l: any) => !/得奖励|继续逛逛吧/.test(l.text)) },
      { lines: base.lines.map((l: any) => /浏览5秒|任务已完成/.test(l.text) ? { ...l, bounds: [300, 800, 600, 850] } : l) },
      { path: panel.path }, { path: '/missing/dwell.png' },
    ]) assert.equal(await inspectDwellBrowse({ ...base, ...mutation }, owner, contract), null);
  }
  assert.equal(await inspectDwellBrowse(panel, owner, contract), null);
  assert.equal(await inspectDwellBrowse({ ...receipt, lines: [{ text: '任务已完成', bounds: [902, 1841, 1035, 1874] }] }, owner, contract), null);
  assert.equal(await inspectDwellBrowse(receipt, owner, { ...contract, dwellMs: 1 }), null);
});

test('real PNG occlusions fail with stale OCR and another destination cannot share identity', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const contract = await buildDwellContract(root, 162);
  const { entry, receipt } = await evidence(162);
  assert.equal(await inspectDwellBrowse((await evidence(161)).receipt, owner, contract), null);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-browse-');
  try {
    for (const [i, b] of [
      { left: 900, top: 1834, width: 148, height: 84 },
      { left: 926, top: 1740, width: 80, height: 60 },
      { left: 100, top: 500, width: 750, height: 900 },
    ].entries()) {
      const path = join(directory, `occlusion-${i}.png`);
      for (const base of [entry, receipt]) {
        await sharp(base.path).composite([{ input: { create: { width: b.width, height: b.height, channels: 3, background: '#ffffff' } }, left: b.left, top: b.top }]).png().toFile(path);
        assert.equal(await inspectDwellBrowse({ ...base, path }, owner, contract), null, String(i));
      }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('ambiguous reward OCR cannot turn a valid receipt into completion', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const contract = await buildDwellContract(root, 162);
  const { receipt } = await evidence(162);
  const duplicate = { ...receipt, lines: [...receipt.lines, { text: '任务已完成', bounds: [100, 900, 400, 950] }] };
  assert.equal(await inspectDwellBrowse(duplicate, owner, contract), null);
});

test('source generation rejects altered gain and source/ref hashes fail closed after configuration', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const contract = await buildDwellContract(root, 162);
  const { entry, result } = await evidence(162);
  const directory = await mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-source-');
  try {
    const sessions = join(directory, 'data/stage-records/accounts/taobao/tb_main/tb_coin/sessions');
    await mkdir(sessions, { recursive: true });
    await mkdir(join(directory, 'evidence'), { recursive: true });
    const originalSession = JSON.parse(await readFile(contract.source.sessionPath, 'utf8'));
    await writeFile(join(sessions, 'session.json'), JSON.stringify({ ...originalSession, evidenceDir: 'evidence' }));
    await writeFile(join(directory, 'evidence/result.json'), JSON.stringify({ ...result, gainCoins: 999 }));
    await assert.rejects(buildDwellContract(directory, 162), /positive-gain success/);
    assert.equal(await inspectDwellBrowse(entry, owner, { ...contract, version: 'invented' }), null);
    assert.equal(await inspectDwellBrowse(entry, owner, null as any), null);
    for (const path of ['corrupt.png', 'wrong-size.png']) {
      if (path === 'corrupt.png') await writeFile(join(directory, path), 'not PNG');
      else await sharp(entry.path).resize(540, 1200).png().toFile(join(directory, path));
      assert.equal(await inspectDwellBrowse({ ...entry, path: join(directory, path) }, owner, contract), null);
    }
    const before = JSON.stringify(entry);
    await inspectDwellBrowse(entry, owner, contract);
    assert.equal(JSON.stringify(entry), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('source 162 builds a JSON contract and checks real destination and full receipt', async () => {
  const { buildDwellContract, inspectDwellBrowse } = await load();
  const contract = JSON.parse(JSON.stringify(await buildDwellContract(root, 162)));
  const { entry, receipt, result } = await evidence(162);
  assert.deepEqual(contract.task, { name: result.task.name, instruction: result.task.instruction });
  assert.deepEqual(contract.sourceRunIds, [162]);
  assert.equal(contract.dwellMs, 5000);
  assert.match(contract.version, /^dwell-browse-candidate-v1:sha256:[a-f0-9]{64}$/);
  assert.deepEqual(await inspectDwellBrowse(entry, owner, contract), { state: 'browsing', waitMs: 5000, version: contract.version });
  const done = await inspectDwellBrowse(receipt, owner, contract);
  assert.equal(done?.state, 'completed');
  assert.match(done?.quote ?? '', /任务已完成/);
});
