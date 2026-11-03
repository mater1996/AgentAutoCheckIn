import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
const root=new URL('../',import.meta.url).pathname;
const adPath='evidence/staged-2026-11-01T17-01-55-133Z/68bb8b03-bd5d-48e3-b6f8-e64af551261c.json';
const homePath='evidence/staged-2026-11-01T12-38-29-524Z/beac16b7-c76b-412f-8197-df8defaac7b6.json';
const landingPath='evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.json';
const panelPath='evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json';
async function setup(mode='home',options:any={}){
 const dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-runtime-');
 const originals=await Promise.all([adPath,homePath,landingPath,panelPath].map(async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'))));
 let index=0,captures=0,modelCalls=0;const actions:any[]=[];
 const cfg:any={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'local',activityId:'tb_coin',userId:0},entryRecovery:true,localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:8000,sessionMs:20000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}},...options.cfg};
 const sessionId=options.sessionId??randomUUID();
 const device={capture:async()=>{
  const base=originals[index],f=structuredClone(base);f.id=randomUUID();f.path=path.join(dir,f.id+'.png');f.capturedAt=Date.now();captures++;
  const raw=JSON.parse(await fs.readFile(base.path.replace(/\.png$/,'.ocr.json'),'utf8'));raw.pages[0].file=f.path;
  if(mode==='wrong-owner')f.userId=999;
  if(mode==='expired'&&index===0)f.capturedAt-=1501;
  if(mode==='old-arrival'&&index!==0)f.capturedAt=1;
  if(mode==='unknown'&&index!==0)f.lines=[];
  if(mode==='risk') {f.lines.push({text:'登录',bounds:[0,0,100,30]});raw.pages[0].lines.push(f.lines.at(-1));}
  await fs.copyFile(base.path,f.path);await fs.writeFile(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));await fs.writeFile(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));return f;
 },act:async(a:any,f:any)=>{
  actions.push({a,f});
  if(a.type==='wait'){await new Promise(r=>setTimeout(r,a.ms));return;}
  if(a.type==='tap'){
   const records=(await fs.readFile(path.join(dir,'runtime.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
   if(index===0){assert.ok(records.some(x=>x.kind==='entry_recovery_consumed'),'consume must be durable before skip');if(mode==='uncertain')throw Error('uncertain tap');index=mode==='landing'?2:mode==='panel'?3:mode==='still-ad'?0:1;}
   else index=3;
  }
 }};
 const runtime=createStagedRuntime(cfg,device,{query:async()=>{modelCalls++;throw Error('model forbidden');}},{sessionId,plan:[],evidenceDir:dir,...options.opts});
 return {runtime,actions,dir,sessionId,cfg,device,get captures(){return captures;},get modelCalls(){return modelCalls;},async records(){return (await fs.readFile(path.join(dir,'runtime.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));}};
}
test('development entry recovery accepts slow proof and more than two read-only waits without repeating skip',async()=>{
 const d=await setup('still-ad',{cfg:{executionPolicy:'development-unbounded-v1',limits:{stageMs:null,sessionMs:null,stageActions:null,agentCalls:null}},opts:{persistEntryRecovery:async(e:any)=>{if(e.kind==='entry_recovery_prepared')await new Promise(r=>setTimeout(r,1600));}}});
 let waits=0;const act=d.device.act;d.device.act=async(a:any,f:any)=>{if(a.type==='wait'&&++waits>=4){const panel=JSON.parse(await fs.readFile(path.join(root,panelPath),'utf8'));d.device.capture=async()=>({...panel,id:randomUUID(),capturedAt:Date.now()});}await act(a,f);};
 try{const r=await d.runtime.stage('enter_activity',{taskAttemptId:'development-recovery'});assert.equal(r.status,'completed',r.error);assert.equal(d.actions.filter((x:any)=>x.a.type==='tap'&&x.a.x===920).length,1);assert.ok(waits>=4);assert.equal((await d.records()).find((e:any)=>e.kind==='entry_recovery_prepared').deadline,null);}finally{await fs.rm(d.dir,{recursive:true,force:true});}
});
for(const mode of ['home','landing','panel'])test(`run210 synthetic cross-run ${mode} arrival uses real inspector and real engine`,async()=>{
 const d=await setup(mode),r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});
 assert.equal(r.status,'completed',r.error);assert.equal(d.modelCalls,0);
 const taps=d.actions.filter(x=>x.a.type==='tap');assert.equal(taps.length,mode==='home'?2:1);assert.deepEqual(taps[0].a,{type:'tap',x:920,y:157});
 const records=await d.records(),events=records.filter(x=>x.kind?.startsWith('entry_recovery_'));
 assert.deepEqual(events.map(x=>x.kind),['entry_recovery_prepared','entry_recovery_consumed','entry_recovery_dispatched','entry_recovery_confirmed']);
 for(const e of events){for(const k of ['stageId','sessionId','taskAttemptId','recoveryId','version','sourceFrameId','sourceCapturedAt','deadline','sourceManifestDigest','action','pngSha256','frameJsonSha256','rawOcrSha256','provenance','proof'])assert.ok(e[k]!==undefined,k);assert.equal(e.stageId,'enter_activity');assert.equal(e.taskAttemptId,'a');}
 assert.equal(events[3].state,mode);assert.equal(events[3].arrivalFrameId,events[3].frame.id);assert.ok(events[3].frame.capturedAt>events[2].dispatchedAt);
 const observed=r.events.filter((e:any)=>e.type==='observed');assert.ok(observed.some((e:any)=>e.frame.id===taps[0].f.id));
 assert.equal(r.actions.filter((x:any)=>x.proposal.action.type==='tap').length,taps.length);
 if(mode==='home'){const nav=records.filter(x=>x.kind==='activity_navigation_attempted');assert.equal(nav.length,1);assert.equal(nav[0].frameId,taps[1].f.id);assert.notEqual(taps[1].f.id,events[3].arrivalFrameId);}
 await d.runtime.stage('enter_activity',{taskAttemptId:'other'});assert.equal(d.actions.filter(x=>x.a.type==='tap').length,taps.length);
});
for(const mode of ['wrong-owner','risk','expired','old-arrival','unknown','uncertain','still-ad'])test(`runtime ${mode} fails closed without second skip or model`,async()=>{
 const d=await setup(mode),r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});
 assert.notEqual(r.status,'completed');const taps=d.actions.filter(x=>x.a.type==='tap');assert.equal(taps.length,['wrong-owner','risk','expired'].includes(mode)?0:1);
 await d.runtime.stage('enter_activity',{taskAttemptId:'a'});await d.runtime.stage('enter_activity',{taskAttemptId:'b'});
 assert.equal(d.actions.filter(x=>x.a.type==='tap').length,taps.length);assert.equal(d.modelCalls,0);
 if(mode==='unknown')assert.equal(d.actions.filter(x=>x.a.type==='wait').length,0,'unknown intermediate capture must stop before settling');
 if(mode==='still-ad'){const waits=d.actions.filter(x=>x.a.type==='wait').map(x=>x.a.ms);assert.ok(waits.filter(x=>x===500).length<=2);assert.equal(waits.filter(x=>x===1000).length,1);assert.ok(waits.reduce((n,x)=>n+x,0)<=1000,'engine settling and explicit waits share one 1000ms allowance');}
 if(taps.length){const e=(await d.records()).filter(x=>x.kind?.startsWith('entry_recovery_'));assert.equal(e.filter(x=>x.kind==='entry_recovery_consumed').length,1);assert.ok(e.some(x=>['entry_recovery_stopped','entry_recovery_unknown'].includes(x.kind)));}
});
for(const point of ['entry_recovery_prepared','entry_recovery_consumed'])test(`persistence failure at ${point} prevents device tap`,async()=>{
 const d=await setup('home',{opts:{persistEntryRecovery:async(e:any)=>{if(e.kind===point)throw Error('fsync/persistence failed');}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
 await d.runtime.stage('enter_activity',{taskAttemptId:'b'});assert.equal(d.actions.length,0);
});
test('late consume persistence rechecks source freshness before device act',async()=>{
 const d=await setup('home',{opts:{persistEntryRecovery:async(e:any)=>{if(e.kind==='entry_recovery_consumed')await new Promise(r=>setTimeout(r,1501));}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
test('late prepared persistence cannot send an expired source',async()=>{
 const d=await setup('home',{opts:{persistEntryRecovery:async(e:any)=>{if(e.kind==='entry_recovery_prepared')await new Promise(r=>setTimeout(r,1501));}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
for(const cfg of [{entryRecovery:false},{entryRecovery:'true'}])test(`entry recovery must be boolean true (${String(cfg.entryRecovery)})`,async()=>{
 const d=await setup('home',{cfg}),r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
test('resume refuses recovery even before any allowance exists',async()=>{
 const d=await setup('home',{opts:{resume:{runId:210}}}),r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
test('runtime reconstruction with same session cannot reset consumed allowance',async()=>{
 const d=await setup('uncertain');await d.runtime.stage('enter_activity',{taskAttemptId:'a'});
 const second=await setup('home',{sessionId:d.sessionId});const r=await second.runtime.stage('enter_activity',{taskAttemptId:'b'});assert.notEqual(r.status,'completed');assert.equal(second.actions.length,0);
});
for(const mode of ['clone-action','clone-frame','changed-action','late-checker'])test(`runtime rejects ${mode} through explicit engine boundary`,async()=>{
 const d=await setup('home',{opts:{runStage:async(input:any,deps:any)=>{
  const frame=await deps.observe(),c={frame,remaining:{ms:8000},signal:new AbortController().signal};
  const checked=await deps.check(c);assert.equal(checked.blocked,undefined);
  const p=await deps.scriptStep(c);
  if(mode==='late-checker')await new Promise(r=>setTimeout(r,1501));
  await assert.rejects(()=>deps.dispatch(mode==='clone-action'?{...p.action}:mode==='changed-action'?{...p.action,x:5}:p.action,mode==='clone-frame'?{...frame}:frame));
  return {status:'stopped',actions:[],events:[]};
 }}});await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.equal(d.actions.length,0);
});
test('post-consume source byte change prevents dispatch',async()=>{
 const d=await setup('home',{opts:{persistEntryRecovery:async(e:any)=>{if(e.kind==='entry_recovery_consumed')await fs.appendFile(e.frame.path.replace(/\.png$/,'.ocr.json'),' ');}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
test('stage deadline caps the recovery and settling wait',async()=>{
 const d=await setup('home',{cfg:{limits:{stageMs:900,sessionMs:20000,stageActions:3,agentCalls:0}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(d.actions.filter(x=>x.a.type==='wait').length,0);
});
test('unchanged real home navigation does not consume recovery allowance',async()=>{
 const d=await setup('home',{opts:{runStage:async(_i:any,deps:any)=>{let f=await deps.observe();f=JSON.parse(await fs.readFile(path.join(root,homePath),'utf8'));f.id='normal-home';f.capturedAt=Date.now();const c={frame:f};assert.equal((await deps.check(c)).blocked,undefined);const p=await deps.scriptStep(c);assert.equal(p.action.type,'tap');return {status:'stopped',actions:[],events:[]};}}});
 await d.runtime.stage('enter_activity',{taskAttemptId:'a'});await assert.rejects(()=>fs.readFile(path.join(d.dir,'runtime.jsonl')),/ENOENT/);
});
test('durable session consume without memory state cannot reconstruct a fresh allowance',async()=>{
 const d=await setup('home');await fs.writeFile(path.join(d.dir,'runtime.jsonl'),JSON.stringify({kind:'entry_recovery_consumed',sessionId:d.sessionId,taskAttemptId:'prior'})+'\n');
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'new'});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);
});
test('late tap completion after engine timeout never restores dispatched authority',async()=>{
 const d=await setup('home',{cfg:{limits:{stageMs:500,sessionMs:20000,stageActions:3,agentCalls:0}}});
 const act=d.device.act;d.device.act=async(a:any,f:any)=>{await act(a,f);if(a.type==='tap')await new Promise(r=>setTimeout(r,650));};
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');
 await new Promise(r=>setTimeout(r,700));
 const e=await d.records();assert.equal(e.filter(x=>x.kind==='entry_recovery_dispatched').length,0);
 await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.equal(d.actions.filter(x=>x.a.type==='tap').length,1);
});
test('actual fsync failure prevents the skip before device act',async()=>{
 const sync=fsSync.fsyncSync;let calls=0;
 const d=await setup('home');
 fsSync.fsyncSync=()=>{calls++;throw Error('offline fsync failure');};
 try{const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');}finally{fsSync.fsyncSync=sync;}
 assert.ok(calls>0);assert.equal(d.actions.length,0);
 await d.runtime.stage('enter_activity',{taskAttemptId:'b'});assert.equal(d.actions.length,0);
});
test('session deadline bounds recovery even when stage budget is larger',async()=>{
 const d=await setup('home',{cfg:{limits:{stageMs:8000,sessionMs:900,stageActions:3,agentCalls:0}}});
 const r=await d.runtime.stage('enter_activity',{taskAttemptId:'a'});assert.notEqual(r.status,'completed');assert.equal(d.actions.filter(x=>x.a.type==='wait').length,0);
 const e=(await d.records()).find(x=>x.kind==='entry_recovery_prepared');assert.ok(e.deadline-e.startedAt<=900);
});
test('concurrent runtime instances share one session recovery allowance',async()=>{
 const id=randomUUID(),a=await setup('uncertain',{sessionId:id}),b=await setup('uncertain',{sessionId:id});
 await Promise.all([a.runtime.stage('enter_activity',{taskAttemptId:'a'}),b.runtime.stage('enter_activity',{taskAttemptId:'b'})]);
 assert.equal([...a.actions,...b.actions].filter(x=>x.a.type==='tap').length,1);
});
test('real AdbOcrDevice capture/act boundary replays command fixtures without invoking adb or model',async()=>{
 const dir=await fs.mkdtemp('/Users/mater/.hermes/cache/scratch/entry-device-');
 const refs=await Promise.all([adPath,homePath,panelPath].map(async p=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'))));
 const commands:string[][]=[];let index=0;
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   commands.push(args);
   if(args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{offline u0 com.taobao.taobao/.MainActivity}'};
   if(args.includes('screencap'))return {stdout:await fs.readFile(refs[index].path)};
   if(args.includes('tap')){index++;return {stdout:''};}
   throw Error('Forbidden offline command '+args.join(' '));
  }
  assert.equal(args.length,2);const raw=JSON.parse(await fs.readFile(refs[index].path.replace(/\.png$/,'.ocr.json'),'utf8'));raw.pages[0].file=args[1];await fs.writeFile(args[0],JSON.stringify(raw));return {stdout:''};
 }});
 const cfg={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'local',activityId:'tb_coin',userId:0},entryRecovery:true,localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:8000,sessionMs:20000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'}}};
 const runtime=createStagedRuntime(cfg,device,{query:async()=>{throw Error('model forbidden');}},{sessionId:randomUUID(),plan:[],evidenceDir:dir});
 const r=await runtime.stage('enter_activity',{taskAttemptId:'offline'});assert.equal(r.status,'completed',r.error);
 assert.deepEqual(commands.filter(x=>x.includes('tap')).map(x=>x.slice(-2)),[['920','157'],['864','487']]);
 assert.equal(runtime.calls,0);
});
