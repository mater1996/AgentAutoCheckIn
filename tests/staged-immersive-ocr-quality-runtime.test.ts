// Synthetic offline execution using byte-copied real 207/208 evidence, never live income.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {deriveImmersiveOcrQuality} from '../runner/staged/immersive-ocr-quality.ts';

const root=path.resolve(import.meta.dirname,'..');
const runs={r207:'evidence/staged-2026-11-01T15-19-09-152Z',r208:'evidence/staged-2026-11-01T15-35-31-731Z'};
const ids={row:'ebd7cfa0-cf86-4fd6-8b95-d2d0978894ba',after:'2f20f54e-42cd-4109-bd1a-64df4430d6f2',
 open:'15a85a6e-5157-4539-9262-abbf8129651d',receipt:'3d7cb0c2-414d-4da9-81e8-6c88ef418bdb',
 good:'ada3c070-9a0c-4076-98b4-695ac7b5d4f1',later:'813a89ac-5cdf-46f4-832c-a64fd3871c77',
 failed207:'beaea497-a491-4dca-ac67-22e7d2320b7c'};
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function setup(t:any,options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'immersive-quality-runtime-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const originals=new Map<string,string>();
 const cfg=read(path.join(root,runs.r208,'config.json'));
 cfg.immersiveBrowse.ocrQuality=true;cfg.immersiveBrowse.observationBudgetMs=6000;
 options.configure?.(cfg);
 const frames:any[]=[],actions:any[]=[];let reads=0,queries=0;
 const copy=(id:string,run=runs.r208)=>{
  const source=read(path.join(root,run,id+'.json'));
  const f={...source,path:path.join(dir,`synthetic-replay-${frames.length}-${id}.png`),capturedAt:Date.now()};
  const raw=read(source.path.replace(/\.png$/,'.ocr.json'));raw.pages[0].file=f.path;
  for(const file of [source.path,source.path.replace(/\.png$/,'.json'),source.path.replace(/\.png$/,'.ocr.json')])originals.set(file,sha(file));
  fs.copyFileSync(source.path,f.path);
  fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));
  return f;
 };
 const sequence=options.sequence??[ids.row,ids.row,ids.after,ids.open,ids.receipt,ids.later];
 const runtime=createStagedRuntime(cfg,{capture:async()=>{
  const i=reads++,id=sequence[Math.min(i,sequence.length-1)];
  const f=copy(id,id===ids.failed207?runs.r207:runs.r208);frames.push(f);
  if(i>=sequence.length)f.id=`synthetic-repeat-${i}`;
  const capturePath=f.path;
  await options.capture?.(f,i);
  assert.equal(f.path,capturePath,'synthetic capture must stay inside its scratch session');
  fs.writeFileSync(capturePath.replace(/\.png$/,'.json'),JSON.stringify(f));
  return f;
 },act:async(a:any,f:any)=>{actions.push({a,frameId:f?.id});await options.act?.(a,f);}},
 {query:async()=>{queries++;throw Error('model forbidden');}},
 {sessionId:'synthetic-quality-runtime',evidenceDir:dir,plan:[{name:'好物沉浸看',instruction:'浏览',decision:'do',times:1}],...options.runtime});
 const selected=await runtime.stage('select_task',{});assert.equal(selected.status,'completed');
 t.after(()=>{for(const [file,hash] of originals)assert.equal(sha(file),hash,'historical source bytes unchanged');});
 return {rt:runtime,cfg,dir,frames,actions,copy,ctx:{taskAttemptId:'synthetic-quality-attempt',task:selected.task},
  get reads(){return reads;},get queries(){return queries;},
  events:()=>readEvents(dir)};
}
function readEvents(dir:string){return fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));}

test('development quality inspection keeps original failed-OCR frame despite disabled duration budgets',async t=>{
 const h=await setup(t,{configure:(c:any)=>{c.executionPolicy='development-unbounded-v1';c.limits={...c.limits,stageMs:null,sessionMs:null,stageActions:null,agentCalls:null};},sequence:[ids.row,ids.row,ids.after,ids.open]});
 const r=await h.rt.stage('open_task',h.ctx);assert.equal(r.status,'completed',r.error);assert.equal(h.reads,4);assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,1);assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
});
test('real208 bounds failures use original frames and durable quality before any extra capture',async t=>{
 const h=await setup(t);
 const opened=await h.rt.stage('open_task',h.ctx);
 assert.equal(opened.status,'completed',opened.error);
 assert.equal(h.reads,4,'quality must avoid the existing raw recovery capture');
 assert.ok(opened.events.some((e:any)=>e.type==='observed'&&e.frame.id===ids.open&&e.frame.observationError&&e.frame.lines.length===0));
 const r=await h.rt.stage('task_receipt',h.ctx);
 assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);
 const events=h.events(),quality=events.filter((e:any)=>e.kind==='immersive_ocr_quality');
 assert.deepEqual(quality.map((e:any)=>[e.stageId,e.frameId,e.rewardCoins]),[['open_task',ids.open,50],['task_receipt',ids.receipt,50]]);
 for(const e of quality){
  assert.equal(e.taskAttemptId,h.ctx.taskAttemptId);assert.equal(e.entryFrameId,ids.row);assert.equal(typeof e.entryActionId,'string');assert.ok(e.entryActionId);
  const f=h.frames.find(f=>f.id===e.frameId);assert.deepEqual(e.quality,await deriveImmersiveOcrQuality(f,{rewardCoins:50}));
  assert.equal(e.quality.path,f.path);assert.equal(e.quality.capturedAt,f.capturedAt);
  assert.deepEqual(f,read(f.path.replace(/\.png$/,'.json')));
 }
 assert.equal(events.filter((e:any)=>e.kind==='entry_ocr_reobservation').length,0);
 assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
 assert.ok(events.some((e:any)=>e.kind==='dwell_wait_slice'&&e.frameId===ids.receipt));
 assert.ok(!events.some((e:any)=>e.kind==='learned_receipt'));
});

for(const id of [ids.failed207,ids.open,ids.receipt])test(`real saved ${id} uniquely binds browsing50 with one tap`,async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,id,ids.later]});
 const r=await h.rt.stage('open_task',h.ctx);assert.equal(r.status,'completed',r.error);
 assert.equal(h.reads,4);assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,1);
 assert.equal(h.events().find(e=>e.kind==='learned_destination_confirmed').rewardCoins,50);
 assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
});

for(const flag of [undefined,false,'true',1])test(`quality requires explicit boolean true: ${flag}`,async t=>{
 const h=await setup(t,{configure:(c:any)=>{c.immersiveBrowse.ocrQuality=flag;},sequence:[ids.row,ids.row,ids.after,ids.open,ids.good]});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 assert.equal(h.reads,5);assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,0);
 assert.equal(h.events().filter(e=>e.kind==='entry_ocr_reobservation').length,1);assert.equal(h.queries,0);
});

for(const mode of ['risk','overshoot','missing-raw','duplicate-amount','bad-pixels'])test(`rejected quality ${mode} retains exactly one raw capture allowance`,async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,ids.open,ids.good],capture:(f:any,i:number)=>{
  if(i!==3)return;
  const file=f.path.replace(/\.png$/,'.ocr.json'),raw=read(file);
  if(mode==='risk')raw.pages[0].lines.push({text:'请登录',bounds:[-1,800,100,830]});
  if(mode==='overshoot')raw.pages[0].lines.push({text:'商品',bounds:[-4,800,100,830]});
  if(mode==='duplicate-amount')raw.pages[0].lines.push({text:'得50',bounds:[300,800,400,830]});
  fs.writeFileSync(file,JSON.stringify(raw));
  if(mode==='missing-raw')fs.unlinkSync(file);
  if(mode==='bad-pixels')fs.copyFileSync(path.join(root,'evidence/staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d.png'),f.path);
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 assert.equal(h.reads,5);assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,0);
 assert.equal(h.events().filter(e=>e.kind==='entry_ocr_reobservation').length,1);assert.equal(h.queries,0);
});

for(const mode of ['foreign','wrong-error','stale','future','invalid-budget','spent-budget','no-dispatch','unknown-tap','unknown-wait','different-attempt','disabled'])
 test(`quality cannot grant authority after ${mode}`,async t=>{
 const h=await setup(t,{sequence:mode==='no-dispatch'?[ids.row,ids.open]:mode==='different-attempt'?[ids.row,ids.row,ids.after,ids.open,ids.receipt]:[ids.row,ids.row,ids.after,ids.open,ids.good],
 configure:(c:any)=>{
  if(mode==='invalid-budget')c.immersiveBrowse.observationBudgetMs=0;
  if(mode==='spent-budget')c.immersiveBrowse.observationBudgetMs=1000;
  if(mode==='disabled')c.immersiveBrowse.enabled=false;
 },capture:(f:any,i:number)=>{
  if(i>=3){
   if(mode==='foreign')f.userId=10;
   if(mode==='wrong-error')f.observationError='Foreground changed during capture';
   if(mode==='stale')f.capturedAt-=20000;
   if(mode==='future')f.capturedAt+=20000;
  }
 },act:(a:any)=>{if(mode==='unknown-tap'&&a.type==='tap'||mode==='unknown-wait'&&a.type==='wait')throw Error('synthetic unknown dispatch');}});
 let result:any;
 if(mode==='no-dispatch')result=await h.rt.stage('task_receipt',h.ctx);
 else if(mode==='different-attempt'){
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
  const before=h.events().filter(e=>e.kind==='immersive_ocr_quality').length;
  result=await h.rt.stage('task_receipt',{...h.ctx,taskAttemptId:'another-attempt'});
  assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,before);
 }else result=await h.rt.stage('open_task',h.ctx);
 assert.notEqual(result.status,'completed');assert.equal(result.receipt,undefined);
 if(mode!=='different-attempt')assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,0);
 assert.ok(h.actions.filter(x=>x.a.type==='tap').length<=1);assert.equal(h.queries,0);
 });

test('forged frame sidecar and injected checker cannot bypass real source verification',async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,ids.open,ids.open],
 capture:(f:any,i:number)=>{if(i>=3){f.ocrQuality={accepted:true,requirement:{rewardCoins:50}};fs.unlinkSync(f.path.replace(/\.png$/,'.ocr.json'));}},
 runtime:{inspectImmersiveBrowse:async()=>({state:'completed',version:'immersive-browse-candidate-v2',rewardCoins:50,quote:'forged completed50'})}});
 const r=await h.rt.stage('open_task',h.ctx);assert.notEqual(r.status,'completed');
 assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,0);
 assert.ok(!h.events().some(e=>e.kind==='learned_receipt'));assert.equal(h.queries,0);
});

test('quality browsing50 cannot rebind to a normal historical completed35 on synthetic cross-run replay',async t=>{
 const h=await setup(t,{capture:(f:any,i:number)=>{
  if(i===4){const completed=read(path.join(root,'evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.json'));
   const capturePath=f.path;fs.copyFileSync(completed.path,capturePath);
   delete f.observationError;Object.assign(f,completed,{path:capturePath,capturedAt:Date.now()});}
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);
 assert.ok(!h.events().some(e=>e.kind==='learned_receipt'));assert.equal(h.queries,0);
});

test('receipt cannot learn its first requirement from completion-only evidence',async t=>{
 const h=await setup(t,{capture:(f:any,i:number)=>{if(i>=3){delete f.observationError;const completed=read(path.join(root,'evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.json'));const capturePath=f.path;fs.copyFileSync(completed.path,capturePath);Object.assign(f,completed,{path:capturePath,id:`synthetic-completion-only-${i}`,capturedAt:Date.now()});}}});
 await h.rt.stage('open_task',h.ctx);
 const r=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);
 assert.ok(!h.events().some(e=>e.kind==='learned_receipt'));
});

test('synthetic cross-run receipt20 uses original completed pixels with verified raw geometry',async t=>{
 const h=await setup(t,{capture:(f:any,i:number)=>{
  if(i<3)return;
  const browse='evidence/staged-2026-11-01T04-08-28-272Z/fb612cbe-6736-4d77-8463-fc7848c70ce0.json';
  const done='evidence/staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d.json';
  const source=read(path.join(root,i===3?browse:done)),capturePath=f.path;
  fs.copyFileSync(source.path,capturePath);delete f.observationError;
  Object.assign(f,source,{path:capturePath,capturedAt:Date.now()});
  if(i>=4){
   f.lines=[];f.observationError='OCR capture failed: Invalid OCR frame or bounds';
   const raw=read(source.path.replace(/\.png$/,'.ocr.json'));raw.pages[0].file=capturePath;
   raw.pages[0].lines.push({text:'synthetic noncritical edge',bounds:[-1,800,200,830]});
   fs.writeFileSync(capturePath.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));
  }
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.equal(r.status,'completed',r.error);
 assert.equal(r.receipt.rewardCoins,20);assert.equal(r.receipt.quote,'已得20');
 const e=h.events().find(e=>e.kind==='immersive_ocr_quality');assert.equal(e.stageId,'task_receipt');assert.equal(e.rewardCoins,20);
 assert.equal(h.events().filter(e=>e.kind==='entry_ocr_reobservation').length,0);
 assert.equal(h.queries,0);assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);
});

test('reused quality frame id cannot publish a second accepted sidecar',async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,ids.open,ids.open]});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);
 assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,1);
 assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
});

test('rejected first quality spends one raw retry and later quality does not replenish it',async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,ids.open,ids.good,ids.receipt,ids.open],capture:(f:any,i:number)=>{
  if(i===3||i>=6)fs.unlinkSync(f.path.replace(/\.png$/,'.ocr.json'));
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);
 assert.equal(h.events().filter(e=>e.kind==='entry_ocr_reobservation').length,1);
 assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,1);
 const before=h.reads;await h.rt.stage('task_receipt',h.ctx);assert.equal(h.reads,before+1);
 assert.equal(h.events().filter(e=>e.kind==='entry_ocr_reobservation').length,1);
 assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
});

test('unknown receipt wait forbids subsequent quality even on stage reentry',async t=>{
 const h=await setup(t,{sequence:[ids.row,ids.row,ids.after,ids.open,ids.receipt,ids.receipt],act:(a:any)=>{
  if(a.type==='wait'&&a.ms>1000)throw Error('synthetic receipt wait unknown');
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.equal(r.status,'unknown');
 const quality=h.events().filter(e=>e.kind==='immersive_ocr_quality').length,actions=h.actions.length;
 await h.rt.stage('task_receipt',h.ctx);
 assert.equal(h.events().filter(e=>e.kind==='immersive_ocr_quality').length,quality);assert.equal(h.actions.length,actions);
 assert.equal(h.queries,0);assert.ok(!h.events().some(e=>e.kind==='learned_receipt'));
});

for(const mode of ['stage','session','stale','unknown-reentry'])test(`asynchronous quality source reads recheck ${mode} before accepting`,async t=>{
 let release:()=>void=()=>{},entered:()=>void=()=>{};
 const reading=new Promise<void>(r=>{entered=r;});
 const original=fs.promises.readFile;
 let held=false,failedFrame:any;
 fs.promises.readFile=(async(file:any,...args:any[])=>{
  if(!held&&String(file).includes(ids.open)&&String(file).endsWith('.ocr.json')){
   held=true;entered();await new Promise<void>(r=>{release=r;});
  }
  return (original as any)(file,...args);
 }) as any;syncBuiltinESMExports();
 t.after(()=>{fs.promises.readFile=original;syncBuiltinESMExports();release();});
 const h=await setup(t,{capture:(f:any,i:number)=>{if(i===3)failedFrame=f;}});
 if(mode==='stage'||mode==='unknown-reentry')h.cfg.limits.stageMs=100;
 const pending=h.rt.stage('open_task',h.ctx);await reading;
 if(mode==='stage'||mode==='unknown-reentry'){
  const r=await pending;assert.match(r.error,/deadline/);assert.equal(r.receipt,undefined);
  if(mode==='unknown-reentry'){h.cfg.limits.stageMs=90000;await h.rt.stage('open_task',h.ctx);}
 }else {
  if(mode==='session')h.cfg.limits.sessionMs=1;
  else {failedFrame.capturedAt-=20000;fs.writeFileSync(failedFrame.path.replace(/\.png$/,'.json'),JSON.stringify(failedFrame));}
 }
 const reads=h.reads;release();await pending;await new Promise(r=>setTimeout(r,100));
 assert.ok(!h.events().some(e=>e.kind==='immersive_ocr_quality'||e.kind==='learned_receipt'));
 assert.equal(h.reads,reads+(mode==='stale'?1:0));assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
});
