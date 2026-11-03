// Offline only: original PNG/OCR are immutable; mutations are scratch replays.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import * as dwell from '../runner/staged/dwell-browse.ts';
import { readDwellReference } from '../runner/staged/dwell-evidence.ts';
import type { DeviceFrame } from '../runner/staged/device.ts';
const root = path.resolve(import.meta.dirname, '..');
const owner = { package: 'com.taobao.taobao', userId: 0 };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const contracts: dwell.DwellContract[] = JSON.parse(await fs.readFile(path.join(root,
  'data/evidence/plans/stable-scripts-20261101/dwell-contracts-full.json'), 'utf8')).dwellBrowse.contracts;
const contract = (run: number) => contracts.find(c => c.sourceRunIds[0] === run)!;
const reversion = (c: dwell.DwellContract) => {
  const canonical = (v:any):string => Array.isArray(v) ? '['+v.map(canonical).join(',')+']'
    : v && typeof v==='object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
  const {version,...body}=c; c.version='dwell-browse-candidate-v1:sha256:'+sha(Buffer.from(canonical(body))); return c;
};
const inspect = (f: DeviceFrame, c: dwell.DwellContract) => {
  assert.equal(typeof dwell.inspectCurrentDwellBrowse, 'function', 'current component API must exist');
  return dwell.inspectCurrentDwellBrowse(f, owner, c);
};
async function scratch(t: any) {
  const dir = await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/dwell-current-test-');
  t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir;
}
async function replay(dir: string, source: DeviceFrame, id: string, change = (_: DeviceFrame) => {}) {
  const f = structuredClone(source); f.id = id; f.path = path.join(dir, id + '.png'); change(f);
  await fs.copyFile(source.path, f.path);
  await fs.writeFile(f.path.replace(/\.png$/, '.json'), JSON.stringify(f));
  await fs.writeFile(f.path.replace(/\.png$/, '.ocr.json'), JSON.stringify({ pages: [{ file: f.path,
    width: f.width, height: f.height, lines: f.lines }] }));
  return f;
}
test('current components accept real 160 browsing and full completion without changing contract bytes', async () => {
  const c = contract(160), before = JSON.stringify(c);
  assert.deepEqual(await inspect(await readDwellReference(c.browsing.reference), c),
    { state: 'browsing', waitMs: 5000, version: c.version });
  const done = await inspect(await readDwellReference(c.receipt.reference), c);
  assert.equal(done?.state, 'completed'); assert.match(done?.quote ?? '', /任务已完成/);
  assert.equal(JSON.stringify(c), before);
});

test('relative component geometry rejects unrelated labels and conflicting requirements', async t => {
  const dir = await scratch(t), c = contract(160), source = await readDwellReference(c.browsing.reference);
  for (const [id, change] of [
    ['detached', (f: DeviceFrame) => { f.lines.find(l => l.text === '得奖励')!.bounds = [100, 900, 200, 940]; }],
    ['wrong-seconds', (f: DeviceFrame) => { f.lines.push({ text: '浏览10秒', bounds: [100, 900, 200, 940] }); }],
    ['partial-done', (f: DeviceFrame) => { f.lines.push({ text: '另一任务已完成', bounds: [100, 900, 300, 940] }); }],
  ] as const) assert.equal(await inspect(await replay(dir, source, id, change), c), null, id);
});

test('independently learned IP requirement authorizes five seconds without changing receiptOnly base', async () => {
  const base = contract(134), p = path.join(root, 'evidence/staged-2026-11-02T00-19-22-514Z/59fd5523-153a-4811-812d-f61d1dc3fdd7.json');
  const f: DeviceFrame = JSON.parse(await fs.readFile(p, 'utf8'));
  const rawPath = f.path.replace(/\.png$/, '.ocr.json');
  const learned = await dwell.buildTextDwellContract(base, { path: f.path, sha256: sha(await fs.readFile(f.path)),
    ocrPath: p, ocrSha256: sha(await fs.readFile(p)), frameId: f.id, rawPath, rawSha256: sha(await fs.readFile(rawPath)) });
  assert.equal(await inspect(f, base), null, 'receiptOnly grants no wait');
  assert.deepEqual(await inspect(f, learned), { state: 'browsing', waitMs: 5000, version: learned.version });
  assert.equal((await inspect(await readDwellReference(base.receipt.reference), learned))?.state, 'completed');
});

test('completion rejects conflicting text, wrong amount and broken current page relationships', async t => {
  const dir = await scratch(t), c = contract(160), source = await readDwellReference(c.receipt.reference);
  for (const [id, change] of [
    ['extra-completion', (f: DeviceFrame) => { f.lines.push({ text: '另一任务已完成', bounds: [100,900,300,940] }); }],
    ['wrong-amount', (f: DeviceFrame) => { f.lines.find(l => l.text === '+30')!.text = '+20'; }],
    ['reversed-page', (f: DeviceFrame) => { f.lines.find(l => l.text === '芭芭农场')!.bounds = [100,900,300,950]; }],
    ['detached-receipt', (f: DeviceFrame) => { f.lines.find(l => l.text === '继续逛逛吧')!.bounds = [100,900,300,940]; }],
  ] as const) assert.equal(await inspect(await replay(dir, source, id, change), c), null, id);
});

test('scratch replay moves current text/components and replaces decoration without historical pixels', async t => {
  const dir = await scratch(t), c = contract(160), source = await readDwellReference(c.browsing.reference);
  const f = await replay(dir, source, 'moved', f => {
    for (const l of f.lines) if (c.browsing.identity.some(a=>new RegExp(a.pattern,'u').test(l.text.replace(/\s/g,'')))
      || /浏览5秒|得奖励/.test(l.text)) l.bounds = l.bounds.map((v,i) => v + (i % 2 ? 80 : -90));
  });
  await sharp({ create: { width:1080, height:2400, channels:3, background:'#406080' } }).png().toFile(f.path);
  assert.equal((await inspect(f,c))?.state,'browsing');
  assert.equal(await dwell.inspectDwellBrowse(f,owner,c),null,'legacy keeps pixel/location policy');
});

test('current binding rejects owner, login, duplicate target, raw conflict and foreign PNG metadata', async t => {
  const dir = await scratch(t), c = contract(160), source = await readDwellReference(c.browsing.reference);
  const changes: [string,(f:DeviceFrame)=>void][] = [
    ['wrong-owner',f=>{f.userId=10;}], ['login',f=>{f.lines.push({text:'请登录',bounds:[100,900,300,940]});}],
    ['duplicate',f=>{f.lines.push(structuredClone(f.lines.find(l=>l.text==='浏览5秒')!));}],
    ['duplicate-title',f=>{f.lines.push(structuredClone(f.lines.find(l=>new RegExp(c.browsing.identity[0].pattern,'u').test(l.text.replace(/\s/g,'')))!));}],
    ['missing-reward',f=>{f.lines=f.lines.filter(l=>l.text!=='得奖励');}],
    ['wrong-requirement',f=>{f.lines.find(l=>l.text==='浏览5秒')!.text='浏览10秒';}],
  ];
  for(const [id,change] of changes) assert.equal(await inspect(await replay(dir,source,id,change),c),null,id);
  for(const kind of ['raw','saved','file','png']) {
    const f=await replay(dir,source,'conflict-'+kind);
    if(kind==='png') await fs.writeFile(f.path,'invalid PNG');
    else {
      const p=f.path.replace(/\.png$/,kind==='saved'?'.json':'.ocr.json');
      const data=JSON.parse(await fs.readFile(p,'utf8'));
      if(kind==='file') data.pages[0].file=source.path;
      else (kind==='saved'?data.lines:data.pages[0].lines).push({text:'验证码',bounds:[100,900,300,940]});
      await fs.writeFile(p,JSON.stringify(data));
    }
    assert.equal(await inspect(f,c),null,kind);
  }
});

test('waiting requires the pinned browsing source to contain an actual full requirement', async t => {
  const dir=await scratch(t), c=structuredClone(contract(164));
  const original=await readDwellReference(c.browsing.reference);
  const current=await replay(dir,original,'full-current',f=>{f.lines.push({text:'浏览5秒',bounds:[916,1842,1014,1873]});});
  assert.equal(await inspect(current,c),null,'list requirement and historical pixels cannot invent browsing source OCR');
});

test('source and reference hashes are checked even after recomputing contract version', async t => {
  const dir=await scratch(t), original=contract(160), f=await readDwellReference(original.browsing.reference);
  for(const kind of ['result','session','png','ocr']) {
    const c=structuredClone(original), p=path.join(dir,kind);
    await fs.writeFile(p,'tampered');
    if(kind==='result')c.source.resultPath=p;
    if(kind==='session')c.source.sessionPath=p;
    if(kind==='png')c.browsing.reference.path=p;
    if(kind==='ocr')c.browsing.reference.ocrPath=p;
    assert.equal(await inspect(f,reversion(c)),null,kind);
  }
  assert.equal(await inspect(f,{...original,version:'invented'}),null);
  assert.equal(await inspect(await readDwellReference(contract(161).receipt.reference),original),null);
});

test('receiptOnly cannot acquire waiting authority from a fully readable current replay', async t => {
  const dir=await scratch(t), c=contract(134);
  const source=await readDwellReference(c.receipt.reference);
  const f=await replay(dir,source,'receipt-only-with-requirement',f=>{
    f.lines=f.lines.filter(l=>!/完成|继续逛逛/.test(l.text));
    f.lines.push({text:'浏览5秒',bounds:[916,1842,1014,1873]},{text:'得奖励',bounds:[927,1877,1007,1905]});
  });
  assert.equal(await inspect(f,c),null);
});

test('a recomputed version cannot replace source identity anchors with unrelated OCR', async () => {
  const c=structuredClone(contract(160)), f=await readDwellReference(c.browsing.reference);
  c.browsing.identity[0].pattern='^3:40$';
  assert.equal(await inspect(f,reversion(c)),null);
});

test('ten source contracts keep exact readable completions and unknown partial OCR distinct', async () => {
  assert.equal(contracts.length, 10);
  for (const c of contracts) {
    const run = c.sourceRunIds[0], f = await readDwellReference(c.receipt.reference);
    assert.equal((await inspect(f, c))?.state ?? null, [131,165].includes(run) ? null : 'completed', 'receipt ' + run);
  }
  for (const run of [129,130,131,132,161,162]) {
    const c = contract(run);
    assert.equal((await inspect(await readDwellReference(c.browsing.reference), c))?.state, 'browsing', 'browsing ' + run);
  }
  for (const run of [164,165]) {
    const c = contract(run);
    assert.equal(await inspect(await readDwellReference(c.browsing.reference), c), null, 'partial source ' + run);
  }
});
