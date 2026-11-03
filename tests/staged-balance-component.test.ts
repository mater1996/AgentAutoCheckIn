import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readLegacyBalanceComponent as readBalanceComponent, BALANCE_GLYPH_SOURCES, LEGACY_BALANCE_COMPONENT_VERSION as BALANCE_COMPONENT_VERSION, type BalanceComponentInput } from '../runner/staged/balance-component.ts';
import path from 'node:path';
// Historical v4 replay only; current capture defaults to ocr-region-v5.
const project = path.resolve(import.meta.dirname, '..');
const relocate = (value: any, dir: string): any => Array.isArray(value) ? value.map(v => relocate(v, dir))
 : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,relocate(v,dir)]))
 : typeof value === 'string' && value.startsWith(project + path.sep) ? path.join(dir,'source',path.relative(project,value)) : value;
const execute = promisify(execFile);
const finalPath = 'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca';
const load = async (source = finalPath): Promise<BalanceComponentInput> => {
 const evidenceDir = await mkdtemp('/Users/mater/.hermes/cache/scratch/balance-test-');
 const fullDeviceFrame = relocate(JSON.parse(await readFile(source + '.json', 'utf8')), evidenceDir);
 const originalPNG = await readFile(source + '.png');
 fullDeviceFrame.path = path.join(evidenceDir,'original.png'); await writeFile(fullDeviceFrame.path,originalPNG);
 return {fullDeviceFrame,originalPNG,evidenceDir,exec:async (file,args,limits) => execute(file,args,{timeout:limits?.timeoutMs})};
};
test('historical v4: real 2155 integer is recovered from the same complete component without mutating OCR', async () => {
 const input = await load(); const before = JSON.stringify(input.fullDeviceFrame);
 const result = await readBalanceComponent(input);
 assert.equal(result.version,BALANCE_COMPONENT_VERSION);
 assert.equal(result?.value, 2155);
 assert.equal(result?.sourcePngSha256, '2463e5d7b76ba37a100845f54ae2076f53a7da8bb44bb1df9ac4ae206e18183d');
 assert.equal(result?.frameId, input.fullDeviceFrame.id);
 assert.equal(JSON.stringify(input.fullDeviceFrame), before);
});

for (const [directory, id, expected] of [
 ['staged-2026-11-01T11-46-47-689Z', '25811c26-a30c-4e73-8c1e-9b726e81e9f4', 2085],
 ['staged-2026-11-01T11-46-47-689Z', 'fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7', 2135],
 ['staged-2026-11-01T11-50-22-744Z', 'a7aaab9d-c2e8-4ac3-b3a0-0340f2d849c0', 2135],
] as const) test(`historical v4: original ${id} reads ${expected}`, async () => {
 const result = await readBalanceComponent(await load(`evidence/${directory}/${id}`));
 assert.equal(result.value, expected, result.reason ?? 'Historical v4 balance mismatch');
});

for (const [path, expected] of [
 ['evidence/staged-2026-11-01T10-27-07-441Z/66360852-0571-4ea9-ba6b-2c9b9393f22b',2030],
 ['evidence/staged-2026-11-01T10-08-39-996Z/30de328e-8448-466a-b29b-575121f6143e',1990],
 ['evidence/staged-2026-11-01T02-12-46-281Z/2857f1d2-673f-4f0b-99f7-cd7634bc677e',1540],
 ['evidence/staged-2026-11-01T07-49-31-673Z/a5187408-32fa-4a74-98e4-50a1ee5e7fdb',1870],
] as const) test(`historical v4: unseen original balance composes ${expected}`,async()=>{
 const result=await readBalanceComponent(await load(path));
 assert.equal(result.value,expected,result.reason ?? 'Historical v4 balance mismatch');
});

// All edited PNGs below are explicitly synthetic negatives using unchanged OCR.
for (const [name, region] of [
 ['balance occlusion', {left: 90, top: 245, width: 116, height: 56}],
 ['coin occlusion', {left: 35, top: 255, width: 40, height: 40}],
 ['arrow occlusion', {left: 216, top: 250, width: 20, height: 45}],
 ['changed amount glyph', {left: 110, top: 255, width: 4, height: 20}],
 ['longer amount outside ROI', {left: 207, top: 245, width: 20, height: 55}],
 ['owning marker occlusion', {left: 394, top: 478, width: 290, height: 60}],
] as const) test(`historical v4: stale same OCR cannot authorize ${name}`, async () => {
 const input = await load();
 input.originalPNG = await sharp(input.originalPNG).composite([{input: await sharp({create:{width:region.width,height:region.height,channels:3,background:'#ff0000'}}).png().toBuffer(),left:region.left,top:region.top}]).png().toBuffer();
 input.exec = async () => { throw Error('OCR must not run on different component pixels'); };
 const result = await readBalanceComponent(input);
 assert.equal(result.value, null); assert.match(result.reason!, /pixels differ/);
});
for (const mode of ['wrong-package', 'wrong-user', 'wrong-size', 'no-marker', 'duplicate-marker'] as const) test(`historical v4: rejects ${mode}`, async () => {
 const input = await load(), f = input.fullDeviceFrame;
 if (mode === 'wrong-package') f.package = 'com.other.app';
 if (mode === 'wrong-user') f.userId = 999;
 if (mode === 'wrong-size') f.width = 720;
 if (mode === 'no-marker') f.lines = f.lines.filter((l: any) => l.text !== '赚金币抵钱');
 if (mode === 'duplicate-marker') {const marker=f.lines.find((l: any) => l.text === '赚金币抵钱');assert.ok(marker);f.lines.push(marker);}
 assert.equal((await readBalanceComponent(input)).value, null);
});
for (const text of ['155', '2155 50', '2155.50', '¥2155', '2155無', '-2155', '9007199254740992', '2135']) test(`historical v4: strict crop rejects ${text}`, async () => {
 const input = await load();
 input.exec = async (_file, [output, cropPath]) => { await writeFile(output, JSON.stringify({pages:[{file:cropPath,width:512,height:280,lines:[{text,bounds:[17,66,493,230]}]}]})); return {stdout:''}; };
 assert.equal((await readBalanceComponent(input)).value, null);
});
test('historical v4: OCR bounds crossing crop boundary reject a clipped number', async () => {
 const input = await load(); input.exec = async (_file, [output, cropPath]) => { await writeFile(output, JSON.stringify({pages:[{file:cropPath,width:512,height:280,lines:[{text:'2155',bounds:[0,0,512,280]}]}]})); return {stdout:''}; };
 assert.equal((await readBalanceComponent(input)).value, null);
});
test('historical v4: transparent altered PNG cannot lend hidden RGB pixels as visible evidence', async () => {
 const input = await load(); const {data,info} = await sharp(input.originalPNG).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 for(let y=245;y<300;y++) for(let x=90;x<206;x++) data[(y*info.width+x)*4+3]=0;
 input.originalPNG=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 input.exec = async (_file, [output, cropPath]) => { await writeFile(output, JSON.stringify({pages:[{file:cropPath,width:512,height:280,lines:[{text:'2155',bounds:[17,66,493,230]}]}]})); return {stdout:''}; };
 assert.equal((await readBalanceComponent(input)).value,null);
});
test('historical v4: expired OCR is drained before return', async () => {
 const input = await load(); let settled=false;
 input.exec = async (_file,_args,limits) => { assert.ok(limits);assert.ok(limits.timeoutMs>0&&limits.timeoutMs<1000); await new Promise(r=>setTimeout(r,limits.timeoutMs+30)); settled=true; return {stdout:''}; };
 const result = await readBalanceComponent({...input,budgetMs:1000});
 assert.equal(settled,true);assert.equal(result.value,null);assert.match(result.reason!,/timeout/);
});
test('historical v4: real 2050 composes with strict foreground OCR',async()=>{
 const result=await readBalanceComponent(await load('evidence/staged-2026-11-01T10-27-07-441Z/3b13397e-13fd-46f6-aab9-650a6cbaaaa4'));
 assert.equal(result.value,2050,result.reason ?? 'Historical v4 balance mismatch');assert.equal(result.glyphRecognition?.text,'2050');
 assert.equal(result.version,BALANCE_COMPONENT_VERSION);
 assert.ok(result.glyphRecognition?.glyphs.every(g=>g.referencePngSha256.length===64&&g.referencePath));
 assert.ok(!result.referenceProvenance?.some(p=>p.sha256===result.sourcePngSha256));
});
test('historical v4: original source labels cover all ten real digits',()=>{
 assert.equal([...new Set(BALANCE_GLYPH_SOURCES.flatMap(s=>String(s.value).split('')))].sort().join(''),'0123456789');
});
test('historical v4: actual unseparated 2050 crop OCR error rejects despite correct glyphs',async()=>{
 const input=await load('evidence/staged-2026-11-01T10-27-07-441Z/3b13397e-13fd-46f6-aab9-650a6cbaaaa4');
 input.exec=async(file,args,limits)=>{
  await sharp(input.originalPNG).extract({left:86,top:238,width:128,height:70}).resize(512,280).png().toFile(args[1]);
  return execute(file,args,{timeout:limits?.timeoutMs});
 };
 const result=await readBalanceComponent(input);
 assert.equal(result.value,null);assert.equal(result.glyphRecognition?.text,'2050');assert.match(result.reason!,/OCR/);
});
test('historical v4: neighbor RMB is not balance identity',async()=>{
 const input=await load();input.originalPNG=await sharp(input.originalPNG).composite([{input:await sharp({create:{width:60,height:22,channels:3,background:'#ff0000'}}).png().toBuffer(),left:240,top:285}]).png().toBuffer();
 assert.equal((await readBalanceComponent(input)).value,2155);
});
