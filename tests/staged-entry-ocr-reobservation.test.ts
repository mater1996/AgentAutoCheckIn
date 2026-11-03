// Real saved run207 frames; simulated freshness and memory-only device dispatch.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {inspectImmersiveBrowse} from '../runner/staged/immersive-browse.ts';
const directory='evidence/staged-2026-11-01T15-19-09-152Z';
const ids=['e15cfab6-bcb3-42ee-8165-d74952c70ed2','dbac162d-2b6e-4c6d-9b4f-db3494a4cb11','db0b8520-ea82-4384-b0f9-544bdfcb2240','beaea497-a491-4dca-ac67-22e7d2320b7c','982d904e-bdc4-41c7-9953-3d40bbc2b736'];
const load=(id:string)=>JSON.parse(fs.readFileSync(`${directory}/${id}.json`,'utf8'));
async function setup(mode='normal',development=false){
 const cfg=JSON.parse(fs.readFileSync(directory+'/config.json','utf8'));let reads=0,queries=0;const actions:any[]=[];
 if(development){cfg.executionPolicy='development-unbounded-v1';cfg.limits={...cfg.limits,stageMs:null,sessionMs:null,stageActions:null,agentCalls:null};}
 const evidenceDir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/entry-ocr-test-');
 const rt=createStagedRuntime(cfg,{capture:async()=>{let i=reads++;const f=load(ids[Math.min(i,4)]);f.capturedAt=Date.now()-(development?20000:0);
  if(i===3&&mode==='foreign')f.userId=999;
  if(i===3&&mode==='foreground-error')f.observationError='Foreground changed during capture';
  if(i===3&&mode==='ordinary-unknown'){delete f.observationError;f.lines=[{text:'unrecognized ordinary page',bounds:[100,100,300,150]}];}
  if(i>=4&&mode==='repeat-error')return {...load(ids[3]),id:'another-failed',capturedAt:Date.now()};
  if(i>=4&&mode==='reused-id')f.id=ids[3];
  if(i>=4&&mode==='stale')f.capturedAt=Date.now()-20000;
  if(i>=4&&mode==='login')f.lines.push({text:'请登录',bounds:[100,600,300,680]});
  if(i>=4&&mode==='capture-error')throw Error('capture failed');
  return f;},act:async(a:any,f:any)=>{actions.push({a,frameId:f?.id});if(mode==='dispatch-unknown'&&a.type==='tap')throw Error('dispatch uncertain');}},
 {query:async()=>{queries++;throw Error('model forbidden');}},{sessionId:'synthetic-entry-reobservation',evidenceDir,plan:[{name:'好物沉浸看',instruction:'浏览',decision:'do',times:1}]});
 const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);
 return {rt,ctx:{taskAttemptId:'one-ocr-attempt',task:selected.task},actions,evidenceDir,get reads(){return reads;},get queries(){return queries;}};
}
test('development OCR reobservation accepts slow original frame with disabled budgets',async()=>{
 const h=await setup('stale',true);try{const r=await h.rt.stage('open_task',h.ctx);assert.equal(r.status,'completed',r.error);assert.equal(h.reads,5);assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);}finally{fs.rmSync(h.evidenceDir,{recursive:true,force:true});}
});
test('one confirmed entry retries a bounds OCR failure once and verifies real later browsing50 without receipt',async()=>{
 const h=await setup(),r=await h.rt.stage('open_task',h.ctx);
 assert.equal(r.status,'completed',r.error);assert.equal(h.reads,5);assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);assert.equal(r.receipt,undefined);
 assert.ok(r.events.some((e:any)=>e.type==='observed'&&e.frame.id===ids[4]));
 const events=fs.readFileSync(path.join(h.evidenceDir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 const retry=events.filter(x=>x.kind==='entry_ocr_reobservation');assert.equal(retry.length,1);assert.equal(retry[0].failedFrame.id,ids[3]);assert.equal(retry[0].freshFrameId,ids[4]);
 assert.equal(events.find(x=>x.kind==='learned_destination_confirmed').rewardCoins,50);
});
for(const mode of ['foreign','foreground-error','ordinary-unknown','repeat-error','reused-id','stale','login','capture-error','dispatch-unknown'])test('OCR recovery '+mode+' stops with no second tap or model',async()=>{
 const h=await setup(mode),r=await h.rt.stage('open_task',h.ctx);assert.notEqual(r.status,'completed');
 const count=h.reads;await h.rt.stage('open_task',h.ctx);assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
 if(['foreign','foreground-error','ordinary-unknown'].includes(mode))assert.equal(count,4);
 if(mode==='dispatch-unknown')assert.ok(count<4);
 const events=fs.readFileSync(path.join(h.evidenceDir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 assert.ok(events.filter(x=>x.kind==='entry_ocr_reobservation').length<=1);assert.ok(!events.some(x=>x.kind==='learned_receipt'));
});

// Run208 source bytes stay immutable. Sequence/timestamps and device are offline replay.
const run208='evidence/staged-2026-11-01T15-35-31-731Z';
const source208={row:'ebd7cfa0-cf86-4fd6-8b95-d2d0978894ba',afterTap:'2f20f54e-42cd-4109-bd1a-64df4430d6f2',
 failedOpen:'15a85a6e-5157-4539-9262-abbf8129651d',open:'ada3c070-9a0c-4076-98b4-695ac7b5d4f1',
 failedReceipt:'3d7cb0c2-414d-4da9-81e8-6c88ef418bdb',laterBrowse:'813a89ac-5cdf-46f4-832c-a64fd3871c77'};
const frame208=(id:string)=>JSON.parse(fs.readFileSync(`${run208}/${id}.json`,'utf8'));
const readRuntimeEvents=(dir:string)=>fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
async function replay208(options:any={}){
 const cfg=JSON.parse(fs.readFileSync(run208+'/config.json','utf8'));
 cfg.immersiveBrowse.observationBudgetMs=3000;
 options.configure?.(cfg);
 const sequence=[source208.row,source208.row,source208.afterTap,...(options.openRetry?[source208.failedOpen]:[]),source208.open,
 source208.failedReceipt,source208.laterBrowse];
 let reads=0,queries=0;const actions:any[]=[],captured:string[]=[];
 const evidenceDir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/ocr208-replay-');
 const rt=createStagedRuntime(cfg,{capture:async()=>{
  const i=reads++,id=sequence[Math.min(i,sequence.length-1)],f=frame208(id);
  f.capturedAt=Date.now();if(i>=sequence.length)f.id=`synthetic-repeat-browsing-${i}`;
  captured.push(f.id);await options.capture?.(f,i);return f;
 },act:async(a:any,f:any)=>{actions.push({a,frameId:f?.id});await options.act?.(a,f);}},
 {query:async()=>{queries++;throw Error('model forbidden');}},
 {sessionId:'offline-208-replay',evidenceDir,plan:[{name:'好物沉浸看',instruction:'浏览',decision:'do',times:1}],...options.runtime});
 const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);
 const ctx={taskAttemptId:'offline-208-attempt',task:selected.task};
 return {rt,cfg,ctx,actions,captured,evidenceDir,get reads(){return reads;},get queries(){return queries;},
 events:()=>fs.readFileSync(path.join(evidenceDir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x))};
}
test('unused attempt allowance recovers receipt observation to real208 browsing50 then stops at wait budget without receipt',async()=>{
 const h=await replay208();const opened=await h.rt.stage('open_task',h.ctx);assert.equal(opened.status,'completed',opened.error);
 const r=await h.rt.stage('task_receipt',h.ctx);
 const recovery=h.events().filter(x=>x.kind==='entry_ocr_reobservation');assert.equal(recovery.length,1);
 assert.equal(recovery[0].failedFrame.id,source208.failedReceipt);assert.equal(recovery[0].freshFrameId,source208.laterBrowse);
 assert.equal(recovery[0].acceptedObservation,true);assert.equal(recovery[0].extraWaitMs,0);
 assert.ok(r.events.some((e:any)=>e.type==='observed'&&e.frame.id===source208.laterBrowse));
 assert.match(r.error,/budget exhausted/);assert.equal(r.receipt,undefined);
 assert.deepEqual(h.actions.map(x=>x.a.type),['tap','wait','wait']);assert.equal(h.actions.at(-1).a.ms,2000);
 assert.equal(h.queries,0);assert.ok(!h.events().some(x=>x.kind==='learned_receipt'));
});

test('late rejection of original receipt capture cannot start an exception retry after engine deadline',async()=>{
 let rejectCapture:(e:Error)=>void=()=>{};
 const h=await replay208({capture:async(f:any)=>{if(f.id===source208.failedReceipt)await new Promise((_resolve,reject)=>{rejectCapture=reject;});}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.cfg.limits.stageMs=40;
 const r=await h.rt.stage('task_receipt',h.ctx);assert.match(r.error,/deadline/);
 const count=h.reads;rejectCapture(Error('capture failed after deadline'));await new Promise(r=>setTimeout(r,20));
 assert.equal(h.reads,count);assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
 assert.ok(!h.events().some(x=>x.kind==='entry_ocr_reobservation'));
});

test('an uncertain entry settling wait cannot authorize OCR recovery on stage reentry',async()=>{
 let first=true;
 const h=await replay208({openRetry:true,act:async(a:any)=>{if(a.type==='wait'&&first){first=false;throw Error('settling dispatch unknown');}}});
 const opened=await h.rt.stage('open_task',h.ctx);assert.equal(opened.status,'unknown');
 // The next saved capture is failed OCR. The uncertain wait forbids extra capture.
 await h.rt.stage('open_task',h.ctx);
 assert.ok(!h.events().some(x=>x.kind==='entry_ocr_reobservation'));
 assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(h.queries,0);
});

test('timed out receipt wait stays unknown on reentry even before the device promise drains',async()=>{
 let release:()=>void=()=>{};
 const h=await replay208({runtime:{inspectImmersiveBrowse:async(f:any,o:any,r:any)=>{const result=await inspectImmersiveBrowse(f,o,r);return result?{...result,waitMs:1}:null;}},configure:(cfg:any)=>{cfg.immersiveBrowse.observationBudgetMs=20000;},capture:async(f:any)=>{
  if(f.id===source208.failedReceipt){Object.assign(f,frame208(source208.open),{id:'synthetic-browse-before-wait',capturedAt:Date.now()});delete f.observationError;}
  else if(f.id===source208.laterBrowse)Object.assign(f,frame208(source208.failedReceipt),{id:'synthetic-error-after-unknown-wait',capturedAt:Date.now()});},
 act:async(a:any)=>{if(a.type==='wait'&&a.ms===1)await new Promise<void>(r=>{release=r;});}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.cfg.limits.stageMs=1000;
 const r=await h.rt.stage('task_receipt',h.ctx);assert.equal(r.status,'unknown');
 // Reenter while previous device wait is still unresolved; failed OCR cannot recover.
 h.cfg.limits.stageMs=100;
 const count=h.actions.length;await h.rt.stage('task_receipt',h.ctx);
 assert.equal(h.actions.length,count);assert.ok(!h.events().some(x=>x.kind==='entry_ocr_reobservation'));
 release();await new Promise(r=>setImmediate(r));assert.equal(h.queries,0);
});

test('real208 replay spends its single allowance in open_task and stops at the second fault without reading return frame',async()=>{
 const historical=readRuntimeEvents(run208).filter(x=>x.kind==='entry_ocr_reobservation');assert.equal(historical.length,1);
 assert.equal(historical[0].failedFrame.id,source208.failedOpen);assert.equal(historical[0].freshFrameId,source208.open);
 assert.equal(historical[0].acceptedObservation,true);assert.equal(historical[0].observationWaitMs,1000);
 const h=await replay208({openRetry:true,configure:(cfg:any)=>{cfg.immersiveBrowse.observationBudgetMs=20000;}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const before=h.actions.length,r=await h.rt.stage('task_receipt',h.ctx);
 assert.equal(r.status,'stopped');assert.equal(r.actions.length,0);assert.equal(r.receipt,undefined);
 assert.equal(h.actions.length,before);assert.equal(h.reads,6);assert.equal(h.captured.at(-1),source208.failedReceipt);
 assert.ok(!h.captured.includes(source208.laterBrowse));assert.equal(h.events().filter(x=>x.kind==='entry_ocr_reobservation').length,1);assert.equal(h.queries,0);
});

test('real208 later frame matches exactly browsing50 under unchanged 20/35/50 contracts',async()=>{
 const f=frame208(source208.laterBrowse),owner={package:f.package,userId:f.userId};
 const results=await Promise.all([20,35,50].map(rewardCoins=>inspectImmersiveBrowse(f,owner,{rewardCoins})));
 assert.deepEqual(results,[null,null,{state:'browsing',version:'immersive-browse-candidate-v2',rewardCoins:50,waitMs:3000}]);
});

for(const mode of ['foreign','foreground-error','ordinary-unknown','login','repeat-error','reused-id','stale','future','capture-error','different-attempt','no-entry','unconfirmed-destination','wait-budget','invalid-budget'])
 test(`receipt recovery rejects ${mode} without extra action or model`,async()=>{
 const h=await replay208({capture:async(f:any)=>{
  if(f.id===source208.failedReceipt){
   if(mode==='foreign')f.userId=999;
   if(mode==='foreground-error')f.observationError='Foreground changed during capture';
   if(mode==='ordinary-unknown'){delete f.observationError;f.lines=[{text:'unknown page',bounds:[100,100,300,150]}];}
   if(mode==='login')f.lines=[{text:'请登录',bounds:[100,100,300,150]}];
  }
  if(f.id===source208.laterBrowse){
   if(mode==='repeat-error')f.observationError='OCR capture failed: Invalid OCR frame or bounds';
   if(mode==='reused-id')f.id=source208.failedReceipt;
   if(mode==='stale')f.capturedAt-=20000;
   if(mode==='future')f.capturedAt+=20000;
   if(mode==='capture-error')throw Error('raw recovery capture failed');
  }
  if(mode==='unconfirmed-destination'&&f.id===source208.open)f.lines=[];
 }});
 if(mode!=='no-entry')await h.rt.stage('open_task',h.ctx);
 if(mode==='wait-budget')h.cfg.immersiveBrowse.observationBudgetMs=1000;
 if(mode==='invalid-budget')h.cfg.immersiveBrowse.observationBudgetMs=0;
 const ctx=mode==='different-attempt'?{...h.ctx,taskAttemptId:'different-attempt'}:h.ctx;
 const before=h.actions.length,r=await h.rt.stage('task_receipt',ctx);
 assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);assert.equal(h.actions.length,before);assert.equal(h.queries,0);
 const recoveries=h.events().filter(x=>x.kind==='entry_ocr_reobservation');
 if(['foreign','foreground-error','ordinary-unknown','login','different-attempt','no-entry','unconfirmed-destination','wait-budget','invalid-budget'].includes(mode))assert.equal(recoveries.length,0);
 else {assert.equal(recoveries.length,1);assert.equal(recoveries[0].acceptedObservation,false);}
 assert.ok(!h.events().some(x=>x.kind==='learned_receipt'));
 });

for(const budget of ['stage','session'])for(const capture of ['original','recovery'])
 test(`${budget} deadline during ${capture} capture rejects late frame and never grants receipt or another capture`,async()=>{
 let release:()=>void=()=>{},entered:()=>void=()=>{};
 const startedCapture=new Promise<void>(r=>{entered=r;});
 const h=await replay208({capture:async(f:any)=>{
  if(f.id===(capture==='original'?source208.failedReceipt:source208.laterBrowse)){entered();await new Promise<void>(r=>{release=r;});}
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 h.cfg.limits.stageMs=50;
 const pending=h.rt.stage('task_receipt',h.ctx);await startedCapture;
 if(budget==='session'){
  h.cfg.limits.sessionMs=1;release();const r=await pending;
  assert.match(r.error,/deadline/);assert.equal(r.receipt,undefined);
  const count=h.reads;await new Promise(r=>setImmediate(r));assert.equal(h.reads,count);
  const recoveries=h.events().filter(x=>x.kind==='entry_ocr_reobservation');
  if(capture==='original')assert.equal(recoveries.length,0);
  else {assert.equal(recoveries.length,1);assert.equal(recoveries[0].acceptedObservation,false);}
  return;
 }
 const r=await pending;assert.match(r.error,/deadline/);const count=h.reads;
 release();await new Promise(r=>setTimeout(r,10));
 assert.equal(h.reads,count);assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
 const recoveries=h.events().filter(x=>x.kind==='entry_ocr_reobservation');
 if(capture==='original')assert.equal(recoveries.length,0);
 else {assert.equal(recoveries.length,1);assert.equal(recoveries[0].acceptedObservation,false);assert.ok(!h.rt.frames.some(f=>f.id===source208.laterBrowse));}
 });

test('late completion inspection after recovery cannot emit a receipt after stage timeout',async()=>{
 let release:()=>void=()=>{};
 const h=await replay208({runtime:{inspectImmersiveBrowse:async(f:any,o:any,requirement:any)=>{
  if(f.id!==source208.laterBrowse)return inspectImmersiveBrowse(f,o,requirement);
  if(requirement.rewardCoins!==50)return null;
  await new Promise<void>(r=>{release=r;});
  return {state:'completed',version:'immersive-browse-candidate-v2',rewardCoins:50,quote:'synthetic completed quote; not live income'};
 }}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.cfg.limits.stageMs=100;
 const r=await h.rt.stage('task_receipt',h.ctx);assert.match(r.error,/deadline/);
 release();await new Promise(r=>setTimeout(r,10));
 assert.ok(!h.events().some(x=>x.kind==='learned_receipt'));assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
});

test('receipt recovery can complete only from original inspector completed quote on an explicitly synthetic cross-run sequence',async()=>{
 const browsing=JSON.parse(fs.readFileSync('evidence/staged-2026-11-01T11-23-10-672Z/a87ba7da-87a6-4f13-a756-3b0b0970dc97.json','utf8'));
 const completed=JSON.parse(fs.readFileSync('evidence/staged-2026-11-01T10-35-22-744Z/33f7f285-7248-432d-8040-13aded9e3ebf.json','utf8'));
 const h=await replay208({capture:async(f:any)=>{
  if(f.id===source208.open)Object.assign(f,browsing,{capturedAt:Date.now()});
  else if(f.id===source208.laterBrowse)Object.assign(f,completed,{capturedAt:Date.now()});
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.equal(r.status,'completed',r.error);
 assert.equal(r.receipt.quote,'已得35');assert.equal(r.receipt.frameId,completed.id);assert.equal(r.receipt.taskAttemptId,h.ctx.taskAttemptId);
 assert.equal(r.actions.length,0);assert.deepEqual(h.actions.map(x=>x.a.type),['tap','wait']);assert.equal(h.queries,0);
 assert.equal(h.events().filter(x=>x.kind==='entry_ocr_reobservation').length,1);
});

test('receipt stage reentry cannot replenish the consumed observation allowance',async()=>{
 const h=await replay208({capture:async(f:any,i:number)=>{if(i>=5)f.observationError='OCR capture failed: Invalid OCR frame or bounds';}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 await h.rt.stage('task_receipt',h.ctx);const count=h.reads;
 await h.rt.stage('task_receipt',h.ctx);assert.equal(h.reads,count+1);
 assert.equal(h.events().filter(x=>x.kind==='entry_ocr_reobservation').length,1);assert.equal(h.queries,0);
});

test('OCR capture wall time does not supply dwell duration or manufacture completion',async()=>{
 const h=await replay208({capture:async(f:any)=>{if(f.id===source208.laterBrowse)await new Promise(r=>setTimeout(r,30));}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const r=await h.rt.stage('task_receipt',h.ctx),events=h.events();
 assert.equal(events.find(x=>x.kind==='entry_ocr_reobservation').observationWaitMs,1000);
 const waits=events.filter(x=>x.kind==='dwell_wait_slice');assert.equal(waits.length,1);assert.equal(waits[0].ms,2000);assert.equal(waits[0].totalMs,3000);
 assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
});

test('entry tap acknowledgement after timeout cannot regain dispatched authority or start OCR recovery',async()=>{
 let release:()=>void=()=>{};
 const h=await replay208({openRetry:true,act:async(a:any)=>{if(a.type==='tap')await new Promise<void>(r=>{release=r;});}});
 h.cfg.limits.stageMs=50;const opened=await h.rt.stage('open_task',h.ctx);assert.equal(opened.status,'unknown');
 release();await new Promise(r=>setTimeout(r,10));h.cfg.limits.stageMs=90000;
 await h.rt.stage('open_task',h.ctx);await h.rt.stage('open_task',h.ctx);
 assert.ok(!h.events().some(x=>x.kind==='entry_ocr_reobservation'));
 assert.ok(!h.events().some(x=>x.kind==='learned_entry_dispatched'));assert.equal(h.actions.filter(x=>x.a.type==='tap').length,1);
});
