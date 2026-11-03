// Saved real frames; these offline checks confer no live action or income.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
import {createHash}from'node:crypto';
import {inspectLearnedActivityNavigation,activityPanelSource}from'../runner/staged/activity-navigation.ts';
const owner={package:'com.taobao.taobao',userId:0},root=path.resolve(import.meta.dirname,'..');
const dir='evidence/staged-2026-11-01T17-44-14-464Z/';
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const sha=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const id of ['22896774-c78d-4f24-8702-ccbc8d53182b','5dd27530-e642-4df8-99c5-c79dfa2234fa'])test('211 real full panel header is recognized without an action: '+id,async()=>{
 const f=read(dir+id+'.json'),before=JSON.stringify(f),hash=sha(f.path);
 const r=await inspectLearnedActivityNavigation(f,owner);assert.equal(r?.state,'panel');assert.equal(r.action,undefined);
 assert.equal(JSON.stringify(f),before);assert.equal(sha(f.path),hash);
});
test('211 header variant retains all full component and text guards',async t=>{
 const f=read(dir+'5dd27530-e642-4df8-99c5-c79dfa2234fa.json');
 const scratch=fs.mkdtempSync(path.join(process.env.TMPDIR!,'panel211-'));t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
 for(const [name,left,top,width,height]of [['title',380,468,320,82],['close',960,460,100,100],['sound-text',20,478,102,59],['sound-toggle',122,478,83,59],['card-edge',34,577,1014,3]]as const){
  const file=path.join(scratch,name+'.png');await sharp(f.path).composite([{input:{create:{width,height,channels:3,background:'#777'}},left,top}]).png().toFile(file);
  assert.equal(await inspectLearnedActivityNavigation({...f,path:file},owner),null,name);
 }
 for(const change of [{userId:999},{lines:f.lines.filter((l:any)=>l.text!=='赚金币抵钱')},{lines:[...f.lines,...f.lines.filter((l:any)=>l.text==='赚金币抵钱')]},{lines:[...f.lines,{text:'请登录',bounds:[20,900,100,940]}]}])assert.equal(await inspectLearnedActivityNavigation({...f,...change},owner),null);
});
test('211 added original header reference bytes stay pinned',()=>{
 const refs=activityPanelSource.files.filter(f=>f.path.includes('e80b88ec-0c1f-44c1-809d-907cc20963c4'));assert.equal(refs.length,2);
 for(const f of refs)assert.equal(sha(path.join(root,f.path)),f.sha256);
});
