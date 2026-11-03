// Real run203 originals. Cross-frame replay does not establish device stability.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile}from'node:fs/promises';import sharp from'sharp';
import{execFile}from'node:child_process';import{promisify}from'node:util';
import{inspectLearnedActivityNavigation}from'../runner/staged/activity-navigation.ts';
import{readLegacyBalanceComponent as readBalanceComponent}from'../runner/staged/balance-component.ts';
const execute=promisify(execFile),dir='evidence/staged-2026-11-01T14-46-46-914Z';
async function load(id='b1e5d975-9728-48db-adf6-4f777155f149'){return JSON.parse(await readFile(`${dir}/${id}.json`,'utf8'));}
for(const id of ['b1e5d975-9728-48db-adf6-4f777155f149','add5897a-ae5e-4912-9d3a-753aa812e40b'])test('203 real panel and historical v4 balance '+id,async()=>{
 const f=await load(id),before=JSON.stringify(f),r=await inspectLearnedActivityNavigation(f,{package:f.package,userId:f.userId});assert.equal(r?.state,'panel');assert.equal(r.action,undefined);
 const b=await readBalanceComponent({fullDeviceFrame:f,originalPNG:await readFile(f.path),evidenceDir:await mkdtemp('/Users/mater/.hermes/cache/scratch/203-replay-'),exec:async(file,args,l)=>execute(file,args,{timeout:l.timeoutMs})});
 assert.equal(b.status,'accepted',b.reason);assert.equal(b.value,2155);assert.equal(JSON.stringify(f),before);
});
for(const [name,left,top,width,height]of [['title',394,478,290,60],['close',975,480,60,50],['sound',20,478,180,59],['digit',100,260,10,15],['coin',35,255,40,40],['arrow',216,250,20,45]]as const)test('203 rejects synthetic '+name+' occlusion',async()=>{
 const f=await load(),out=await mkdtemp('/Users/mater/.hermes/cache/scratch/203-negative-');const bytes=await sharp(f.path).composite([{input:await sharp({create:{width,height,channels:3,background:'#f00'}}).png().toBuffer(),left,top}]).png().toBuffer();f.path=out+'/frame.png';await writeFile(f.path,bytes);
 if(['title','close','sound'].includes(name))assert.equal(await inspectLearnedActivityNavigation(f,{package:f.package,userId:f.userId}),null);
 if(['title','digit','coin','arrow'].includes(name)){const r=await readBalanceComponent({fullDeviceFrame:f,originalPNG:bytes,evidenceDir:out,exec:async()=>{throw Error('OCR forbidden');}});assert.equal(r.status,'rejected');}
});
