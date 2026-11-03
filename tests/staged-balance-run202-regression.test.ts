// Historical v4 replay regression for the run202 glyph variant.
// Run explicitly: node --import tsx --test tests/staged-balance-run202-regression.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readLegacyBalanceComponent as readBalanceComponent, LEGACY_BALANCE_COMPONENT_VERSION as BALANCE_COMPONENT_VERSION } from '../runner/staged/balance-component.ts';
import path from 'node:path';
const project = path.resolve(import.meta.dirname, '..');
const relocate = (value:any,dir:string):any => Array.isArray(value)?value.map(v=>relocate(v,dir))
 :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v,dir)]))
 :typeof value==='string'&&value.startsWith(project+path.sep)?path.join(dir,'source',path.relative(project,value)):value;
const execute = promisify(execFile);
const directory = 'evidence/staged-2026-11-01T14-28-53-024Z';
for (const [id, pngSha256] of [
 ['fe1dce16-9782-4b0e-a70f-87b0c82b8f09', 'bb13541fde0147fb944bf1614dc128af50bc9463465cbb7d58c6d98f61758dcd'],
 ['47070135-ab74-4da0-a320-b1099389f39b', 'e7f56bcb29a15a8c498f6a5c19d4f49d80786572b98c53fe6de5cad46b94ee61'],
] as const) test(`historical v4: run202 real complete balance ${id} is accepted from its own pixels and local OCR`, async () => {
 const evidenceDir = await mkdtemp('/Users/mater/.hermes/cache/scratch/run202-regression-');
 const fullDeviceFrame = relocate(JSON.parse(await readFile(`${directory}/${id}.json`, 'utf8')),evidenceDir);
 const originalPNG = await readFile(`${directory}/${id}.png`);
 assert.equal(createHash('sha256').update(originalPNG).digest('hex'), pngSha256);
 fullDeviceFrame.path=path.join(evidenceDir,'original.png'); await writeFile(fullDeviceFrame.path,originalPNG);
 const before = JSON.stringify(fullDeviceFrame);
 const result = await readBalanceComponent({ fullDeviceFrame, originalPNG, evidenceDir,
  exec: async (file, args, limits) => execute(file, args, {timeout:limits?.timeoutMs}) });
 console.log(JSON.stringify({id,status:result.status,value:result.value,reason:result.reason}));
 assert.equal(JSON.stringify(fullDeviceFrame), before, 'preserve recorded OCR/evidence');
 assert.equal(result.sourcePngSha256, pngSha256);
 assert.equal(result.frameId, id);
 assert.equal(result.status, 'accepted', result.reason ?? 'Historical v4 balance rejected');
 assert.equal(result.version, BALANCE_COMPONENT_VERSION);
 assert.equal(result.value, 2155); // Human reading of THIS original crop, never a runtime whitelist.
 assert.equal(result.glyphRecognition?.text, '2155');
 assert.equal(result.ocrEvidence?.text, '2155');
});
for(const text of ['2135','2155.50','2155 50','¥2155','2155無','-2155'])test('historical v4: new glyph reference still rejects synthetic OCR '+text,async()=>{
 const evidenceDir=await mkdtemp('/Users/mater/.hermes/cache/scratch/run202-negative-');
 const id='fe1dce16-9782-4b0e-a70f-87b0c82b8f09',fullDeviceFrame=relocate(JSON.parse(await readFile(`${directory}/${id}.json`,'utf8')),evidenceDir);
 const originalPNG=await readFile(`${directory}/${id}.png`);fullDeviceFrame.path=path.join(evidenceDir,'original.png');await writeFile(fullDeviceFrame.path,originalPNG);
 const r=await readBalanceComponent({fullDeviceFrame,originalPNG,evidenceDir,exec:async(_file,[out,crop])=>{await writeFile(out,JSON.stringify({pages:[{file:crop,width:512,height:280,lines:[{text,bounds:[17,66,493,230]}]}]}));return {stdout:''};}});
 assert.equal(r.status,'rejected');assert.match(r.reason!,/Unsafe integer/);
});
for(const [name,left,top,width,height]of [['digit',100,260,10,15],['coin',35,255,40,40],['arrow',216,250,20,45],['title',394,478,290,60]] as const)test('historical v4: new glyph reference rejects synthetic '+name+' occlusion',async()=>{
 const evidenceDir=await mkdtemp('/Users/mater/.hermes/cache/scratch/run202-negative-');
 const id='fe1dce16-9782-4b0e-a70f-87b0c82b8f09',fullDeviceFrame=relocate(JSON.parse(await readFile(`${directory}/${id}.json`,'utf8')),evidenceDir);
 const originalPNG=await sharp(await readFile(`${directory}/${id}.png`)).composite([{input:await sharp({create:{width,height,channels:3,background:'#f00'}}).png().toBuffer(),left,top}]).png().toBuffer();
 fullDeviceFrame.path=path.join(evidenceDir,'original.png');await writeFile(fullDeviceFrame.path,originalPNG);
 const r=await readBalanceComponent({fullDeviceFrame,originalPNG,evidenceDir,exec:async()=>{throw Error('OCR forbidden for occlusion');}});
 assert.equal(r.status,'rejected');assert.match(r.reason!,/pixels differ/);
});
