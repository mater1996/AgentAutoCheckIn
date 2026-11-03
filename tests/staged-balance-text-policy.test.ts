import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import * as balance from '../runner/staged/balance-component.ts';
import {verifiedBalanceValue} from '../runner/staged/observations.ts';
import {verifyAuditBalanceComponent} from '../runner/staged/script-validation.ts';
const project=path.resolve(import.meta.dirname,'..');
const run216='evidence/staged-2026-11-01T19-32-41-877Z/55a6d09a-1b77-4952-91ce-fa867d076087';
const execute=promisify(execFile);
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(t:any,source=run216){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'balance-text-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const originalPaths=['.png','.json','.ocr.json'].map(ext=>path.join(project,source+ext));
 const originalHashes=originalPaths.map(p=>hash(fs.readFileSync(p)));
 t.after(()=>assert.deepEqual(originalPaths.map(p=>hash(fs.readFileSync(p))),originalHashes,'historical source artifacts remain unchanged'));
 const originalPNG=fs.readFileSync(path.join(project,source+'.png'));
 const fullDeviceFrame=JSON.parse(fs.readFileSync(path.join(project,source+'.json'),'utf8'));
 fullDeviceFrame.path=path.join(dir,'frame.png');fs.writeFileSync(fullDeviceFrame.path,originalPNG);
 const raw=JSON.parse(fs.readFileSync(path.join(project,source+'.ocr.json'),'utf8'));
 raw.pages[0].file=fullDeviceFrame.path;
 fs.writeFileSync(fullDeviceFrame.path.replace('.png','.ocr.json'),JSON.stringify(raw));
 return {fullDeviceFrame,originalPNG,evidenceDir:dir,exec:async(file:string,args:string[],limits?:{timeoutMs:number})=>execute(file,args,{timeout:limits?.timeoutMs})};
}
const audit=(f:any,v:number,root=process.env.TMPDIR!)=>verifyAuditBalanceComponent({root,frame:f,expectedValue:v});
test('development balance ignores exhausted optional component budget and retains strict amount proof',async t=>{
 const input={...fixture(t),executionPolicy:'development-unbounded-v1' as const,budgetMs:0};const e=await balance.readBalanceComponent(input);assert.equal(e.status,'accepted',e.reason);assert.equal(e.value,2265);assert.equal(await audit({...input.fullDeviceFrame,balanceEvidence:e},2265),true);
});
test('run216 reads 2265 via actual local crop OCR and replays saved evidence without glyph sources',async t=>{
 const input=fixture(t),before=JSON.stringify(input.fullDeviceFrame);
 const result=await balance.readBalanceComponent(input);
 assert.equal(result.status,'accepted',result.reason);
 assert.equal(result.version,'ocr-region-v5');assert.equal(result.value,2265);
 assert.equal(result.glyphRecognition,undefined);assert.equal(result.referenceProvenance,undefined);
 assert.equal(JSON.stringify(input.fullDeviceFrame),before);
 const f={...input.fullDeviceFrame,balanceEvidence:result};
 assert.equal(verifiedBalanceValue(f),2265);assert.equal(await audit(f,2265),true);
 assert.equal(await audit(f,2266),false);
 assert.equal(result.sourcePngSha256,'ab906d9f27f1f2a34013f92568be6421683a64b8fe3b3f5de7f0df1533ddbb8c');
});

for(const source of [
 'evidence/staged-2026-11-01T11-46-47-689Z/fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7',
 'evidence/staged-2026-11-01T10-27-07-441Z/3b13397e-13fd-46f6-aab9-650a6cbaaaa4',
])test('ambiguous historical full OCR cannot be stripped into a v5 balance '+source,async t=>{
 const input=fixture(t,source),e=await balance.readBalanceComponent(input);assert.equal(e.value,null);assert.match(e.reason!,/conflict\/capacity/);
});

for(const [source,value] of [
 ['evidence/staged-2026-11-01T11-46-47-689Z/25811c26-a30c-4e73-8c1e-9b726e81e9f4',2085],
 ['evidence/staged-2026-11-01T02-12-46-281Z/ab381478-f637-4034-8ca5-6714a017b1f2',1540],
 ['evidence/staged-2026-11-01T07-49-31-673Z/40840c3c-6962-481a-bb42-45ca79804180',1840],
] as const)test(`historical actual local OCR reads ${value}`,async t=>{
 const input=fixture(t,source),e=await balance.readBalanceComponent(input),f={...input.fullDeviceFrame,balanceEvidence:e};
 assert.equal(e.value,value,e.reason);assert.equal(verifiedBalanceValue(f),value);assert.equal(await audit(f,value),true);
});

test('v4 historical replay retains its version and strict glyph audit',async t=>{
 const input=fixture(t,'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca');
 const e=await balance.readLegacyBalanceComponent(input),f={...input.fullDeviceFrame,balanceEvidence:e};
 assert.equal(e.status,'accepted',e.reason);assert.equal(e.version,'original-glyph-composition-v4');assert.equal(e.value,2155);
 // Legacy audit roots contain the immutable source library; copied evidence remains in scratch.
 const legacyRoot=fs.mkdtempSync(path.join(process.env.TMPDIR!,'balance-legacy-'));t.after(()=>fs.rmSync(legacyRoot,{recursive:true,force:true}));
 for(const ref of balance.BALANCE_GLYPH_SOURCES){const target=path.join(legacyRoot,ref.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,ref.path),target);}
 fs.cpSync(input.evidenceDir,path.join(legacyRoot,'captured'),{recursive:true});
 const remap=(s:string)=>s.replace(input.evidenceDir,path.join(legacyRoot,'captured'));
 f.path=remap(f.path);e.ocrEvidence!.path=remap(e.ocrEvidence!.path);e.ocrEvidence!.cropPath=remap(e.ocrEvidence!.cropPath);
 const raw=JSON.parse(fs.readFileSync(e.ocrEvidence!.path,'utf8'));raw.pages[0].file=e.ocrEvidence!.cropPath;
 const bytes=Buffer.from(JSON.stringify(raw));fs.writeFileSync(e.ocrEvidence!.path,bytes);e.ocrEvidence!.sha256=hash(bytes);
 assert.equal(verifiedBalanceValue(f),2155);assert.equal(await audit(f,2155,legacyRoot),true);
 const forged=structuredClone(f);forged.balanceEvidence.version='ocr-region-v5';assert.equal(await audit(forged,2155,legacyRoot),false);
});

// Explicit executor boundary negatives: corrupt the real OCR response only after Apple OCR completed.
for(const text of ['226','22650','0000','0265','2265.50','¥2265','-2265','+2265','2265›','2265 50',' 2265','２２６５','9007199254740992','2135'])test(`strict crop rejects boundary response ${text}`,async t=>{
 const input=fixture(t),real=input.exec;
 input.exec=async(file,args,limits)=>{const result=await real(file,args,limits),raw=JSON.parse(fs.readFileSync(args[0],'utf8'));raw.pages[0].lines[0].text=text;fs.writeFileSync(args[0],JSON.stringify(raw));return result;};
 assert.equal((await balance.readBalanceComponent(input)).value,null);
});
for(const mode of ['two-lines','clipped-bounds','wrong-engine','wrong-crop','crop-mutated'] as const)test(`executor boundary rejects ${mode}`,async t=>{
 const input=fixture(t),real=input.exec;
 input.exec=async(file,args,limits)=>{const result=await real(file,args,limits),raw=JSON.parse(fs.readFileSync(args[0],'utf8'));
  if(mode==='two-lines')raw.pages[0].lines.push(raw.pages[0].lines[0]);
  if(mode==='clipped-bounds')raw.pages[0].lines[0].bounds=[0,0,512,280];
  if(mode==='wrong-engine')raw.engine='other';if(mode==='wrong-crop')raw.pages[0].file='other.png';
  if(mode==='crop-mutated')fs.appendFileSync(args[1],'changed');
  fs.writeFileSync(args[0],JSON.stringify(raw));return result;};
 assert.equal((await balance.readBalanceComponent(input)).value,null);
});

test('amount occlusion and boundary ink reject using real local OCR path',async t=>{
 for(const region of [{left:90,top:245,width:116,height:56},{left:212,top:250,width:4,height:45}]){
  const input=fixture(t),patch=await sharp({create:{width:region.width,height:region.height,channels:3,background:region.width===4?'white':'#f00'}}).png().toBuffer();
  input.originalPNG=await sharp(input.originalPNG).composite([{input:patch,left:region.left,top:region.top}]).png().toBuffer();fs.writeFileSync(input.fullDeviceFrame.path,input.originalPNG);
  assert.equal((await balance.readBalanceComponent(input)).value,null);
 }
});
test('full-frame conflict, illegal amount, duplicate amount, wrong owner/page and long amount reject',async t=>{
 for(const mode of ['conflict','illegal','long','duplicate','package','user','page','risk','full-raw-differs']){
  const input=fixture(t),f=input.fullDeviceFrame,l=f.lines.find((l:any)=>l.text==='2265›');
  if(mode==='conflict')l.text='2135›';if(mode==='illegal')l.text='¥2265';if(mode==='long')l.text='22650›';if(mode==='duplicate')f.lines.push({...l});
  if(mode==='package')f.package='other.app';if(mode==='user')f.userId=10;if(mode==='page')f.lines=f.lines.filter((l:any)=>l.text!=='赚金币抵钱');if(mode==='risk')f.lines.push({text:'安全验证',bounds:[300,600,700,700]});
  if(mode!=='full-raw-differs'){const p=f.path.replace('.png','.ocr.json'),raw=JSON.parse(fs.readFileSync(p,'utf8'));raw.pages[0].lines=f.lines;fs.writeFileSync(p,JSON.stringify(raw));}
  else l.text='2135›';
  assert.equal((await balance.readBalanceComponent(input)).value,null,mode);
 }
});

test('neighbor RMB changes remain excluded and need no old chrome pixels',async t=>{
 const input=fixture(t),patch=await sharp({create:{width:60,height:22,channels:3,background:'#f00'}}).png().toBuffer();
 input.originalPNG=await sharp(input.originalPNG).composite([{input:patch,left:240,top:285}]).png().toBuffer();fs.writeFileSync(input.fullDeviceFrame.path,input.originalPNG);
 const result=await balance.readBalanceComponent(input);assert.equal(result.value,2265,result.reason);
 const f={...input.fullDeviceFrame,balanceEvidence:result};assert.equal(verifiedBalanceValue(f),2265);assert.equal(await audit(f,2265),true);
});

test('an outside-crop amount cannot masquerade as a full number when raw bounds extend',async t=>{
 const input=fixture(t),f=input.fullDeviceFrame,l=f.lines.find((l:any)=>l.text==='2265›');
 l.bounds[2]=270;
 const p=f.path.replace('.png','.ocr.json'),raw=JSON.parse(fs.readFileSync(p,'utf8'));raw.pages[0].lines=f.lines;fs.writeFileSync(p,JSON.stringify(raw));
 const e=await balance.readBalanceComponent(input);assert.equal(e.value,null);
});

test('saved evidence tampering rejects including rehashed crop/raw and frame confusion',async t=>{
 const input=fixture(t),e=await balance.readBalanceComponent(input),f={...input.fullDeviceFrame,balanceEvidence:e};assert.equal(e.value,2265,e.reason);
 for(const mutate of [
  (x:any)=>x.id='other-frame',(x:any)=>x.userId=10,(x:any)=>x.balanceEvidence.value=2135,
  (x:any)=>x.balanceEvidence.roi.width=127,(x:any)=>x.balanceEvidence.ocrEvidence.text='2135',
  (x:any)=>x.balanceEvidence.ocrEvidence.bounds[0]=0,(x:any)=>x.balanceEvidence.version='other',
  (x:any)=>x.lines=x.lines.filter((l:any)=>l.text!=='赚金币抵钱'),
  (x:any)=>x.balanceEvidence.fullFrameOcrEvidence.sha256='0'.repeat(64),
 ]){const changed=structuredClone(f);mutate(changed);assert.equal(verifiedBalanceValue(changed),null);assert.equal(await audit(changed,changed.balanceEvidence.value),false);}
 for(const file of [f.path,e.ocrEvidence!.cropPath,e.ocrEvidence!.path,e.fullFrameOcrEvidence!.path]){
  const original=fs.readFileSync(file);fs.appendFileSync(file,'tampered');assert.equal(verifiedBalanceValue(f),null);assert.equal(await audit(f,2265),false);fs.writeFileSync(file,original);
 }
 const cropPath=e.ocrEvidence!.cropPath,originalCrop=fs.readFileSync(cropPath),blank=await sharp({create:{width:512,height:280,channels:3,background:'white'}}).png().toBuffer();
 fs.writeFileSync(cropPath,blank);const cropForged=structuredClone(f);cropForged.balanceEvidence.cropHash=hash(blank);assert.equal(await audit(cropForged,2265),false);fs.writeFileSync(cropPath,originalCrop);
 const p=e.ocrEvidence!.path,original=fs.readFileSync(p),raw=JSON.parse(original.toString());raw.pages[0].lines[0].text='2135';const forgedRaw=Buffer.from(JSON.stringify(raw));fs.writeFileSync(p,forgedRaw);
 const rawForged=structuredClone(f);Object.assign(rawForged.balanceEvidence.ocrEvidence,{sha256:hash(forgedRaw),text:'2135'});rawForged.balanceEvidence.value=2135;
 assert.equal(verifiedBalanceValue(rawForged),null);assert.equal(await audit(rawForged,2135),false);fs.writeFileSync(p,original);
 const changed=await sharp(input.originalPNG).composite([{input:await sharp({create:{width:116,height:56,channels:3,background:'#f00'}}).png().toBuffer(),left:90,top:245}]).png().toBuffer();
 fs.writeFileSync(f.path,changed);const pngForged=structuredClone(f);pngForged.balanceEvidence.sourcePngSha256=hash(changed);assert.equal(await audit(pngForged,2265),false);fs.writeFileSync(f.path,input.originalPNG);
 assert.equal(await audit(f,2265),true);
});

