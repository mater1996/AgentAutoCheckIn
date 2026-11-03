import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {inspectImmersiveBrowse,immersiveBrowseSource} from '../runner/staged/immersive-browse.ts';
const root=path.resolve(import.meta.dirname,'..');
const dir=path.join(root,'evidence/staged-2026-11-01T16-45-09-994Z');
const owner={package:'com.taobao.taobao',userId:0};
const ids=['0c820617-d113-48ad-8938-7687b74bcdfd','37185157-ba48-4978-9bbf-125b56cf32d4'];
const load=(id:string)=>JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'));
const sha=(f:string)=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
test('209 real single details shell uniquely supports browsing50 while original bytes remain unchanged',async()=>{
 for(const id of ids){const frame=load(id),before=JSON.stringify(frame),hash=sha(frame.path);
  assert.deepEqual(await inspectImmersiveBrowse(frame,owner,{rewardCoins:50}),{state:'browsing',version:'immersive-browse-candidate-v2',rewardCoins:50,waitMs:3000});
  for(const rewardCoins of [20,35,500])assert.equal(await inspectImmersiveBrowse(frame,owner,{rewardCoins}),null);
  assert.equal(JSON.stringify(frame),before);assert.equal(sha(frame.path),hash);
 }
});
test('209 shell reference has immutable original PNG and frame provenance',()=>{
 const refs=(immersiveBrowseSource as any).files;
 for(const name of ['browsing50DetailsShellPng','browsing50DetailsShellFrame']){assert.ok(refs[name]);assert.equal(sha(path.join(root,refs[name].path)),refs[name].sha256);}
});
test('209 shell still rejects stale OCR over covered components and wrong identity or reward',async t=>{
 const frame=load(ids[0]),scratch=fs.mkdtempSync(path.join(process.env.TMPDIR!,'shell209-negative-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
 const before=sha(frame.path);
 for(const [name,left,top,width,height] of [['shell',316,1924,724,106],['badge',878,1230,182,146],['back',20,120,100,80],['coin',900,1090,90,130]] as const){
  const file=path.join(scratch,name+'.png');await sharp(frame.path).composite([{input:{create:{width,height,channels:3,background:'#555555'}},left,top}]).png().toFile(file);
  assert.equal(await inspectImmersiveBrowse({...frame,path:file},owner,{rewardCoins:50}),null,name);
 }
 for(const change of [{userId:999},{package:'other'}, {lines:[...frame.lines,{text:'请登录',bounds:[10,800,200,840]}]}, {lines:[...frame.lines,{text:'得500',bounds:[10,800,200,840]}]}, {lines:frame.lines.filter((l:any)=>l.text!=='浏览')}])assert.equal(await inspectImmersiveBrowse({...frame,...change},owner,{rewardCoins:50}),null);
 assert.equal(sha(frame.path),before);
});
