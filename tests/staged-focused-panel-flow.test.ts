// Entirely synthetic offline frames/model; exercises the real runtime and engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {readAiPanel,loadAiPanel} from '../runner/staged/ai-panel-reader.ts';
import {readPanel,validateProposedAction} from '../runner/staged/observations.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
const owner={package:'com.taobao.taobao',userId:0};
const task={name:'合成普通任务',instruction:'浏览5秒',done:0,total:1,reward:20,rewardMin:null,rewardMax:null,rewardOffers:[{condition:'浏览5秒',reward:20,rewardMin:null,rewardMax:null}],button:'去完成',bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]};
const identity=({name,instruction,done,total}:any)=>({name,instruction,done,total});
function png(){
 const crc=(b:Buffer)=>{let n=0xffffffff;for(const x of b){n^=x;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(type:string,b:Buffer)=>{const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([name,b])));return Buffer.concat([size,name,b,sum]);};
 const h=Buffer.alloc(13);h.writeUInt32BE(1080);h.writeUInt32BE(2400,4);h[8]=8;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(1081*2400))),chunk('IEND',Buffer.alloc(0))]);
}
function config(extra:any={}){return {scope:{appId:'a',accountId:'synthetic',activityId:'c',userId:0},package:owner.package,assetId:'coins',model:{baseUrl:'http://127.0.0.1:1',name:'synthetic'},panelMarker:'赚金币抵钱',aiPanelReader:true,panelReadPolicy:'focused-v1',scriptValidationMode:false,balanceComponent:false,selectionAllowNew:false,constraints:['ordinary browse only'],learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},limits:{maxTasks:1,sessionMs:60000,stageMs:10000,agentCalls:15,stageActions:4,maxReturns:3,inventoryPages:2},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}])),...extra};}
function fixture(t:any){const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'focused-flow-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let serial=0;return {dir,frame(){const f={id:'synthetic-'+(++serial),path:path.join(dir,`synthetic-${serial}.png`),width:1080,height:2400,capturedAt:Date.now(),...owner,lines:[]};fs.writeFileSync(f.path,png());fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;}};}
function full(done=0,balance=2265){return {isPanel:true,balance,blocked:false,top:true,bottom:true,tasks:[{...task,done}],clippedRows:[]};}
async function harness(t:any,options:any={}){
 const f=fixture(t);let page='panel',captures=0;const requests:any[]=[],actions:any[]=[],cfg=config(options.config);
 const model={usage:[] as any[],query:async(request:any)=>{requests.push(request);model.usage.push({calls:1});return options.answer?.(request,page)??(request.panelReadMode?{isPanel:page!=='browse',balance:page==='browse'?null:page==='returned'?2285:2265,blocked:false,taskStatus:page==='browse'?'not-panel':page==='returned'?'absent':'visible',task:page==='panel'?{...task}:null}:full());}};
 const rt=createStagedRuntime(cfg,{capture:async()=>{captures++;return options.capture?.(page,()=>f.frame())??f.frame();},act:async(a:any)=>{actions.push(a);if(a.type==='tap')page='browse';if(a.type==='back')page='returned';await options.afterAct?.(a,(value:string)=>{page=value;});}},model,{sessionId:'synthetic-session',evidenceDir:f.dir,plan:options.plan??[{name:task.name,instruction:task.instruction,decision:'do',times:1}],completed:options.completed,inspectLearnedBrowse:async()=>({state:'completed',quote:'合成本次任务已完成',version:'synthetic-local'})});
 return {...f,rt,requests,actions,cfg,setPage(v:string){page=v},get captures(){return captures}};
}

test('batch selection uses live quota and explicit remaining attempt budget',async t=>{
 const h=await harness(t,{config:{selectionPolicy:'batch-attempts-v1'},completed:[task.name]});
 assert.equal((await h.rt.stage('select_task',{})).status,'completed');
});
test('batch selection does not choose an already attempted do row',async t=>{
 const h=await harness(t,{config:{selectionPolicy:'batch-attempts-v1'},plan:[{name:task.name,instruction:task.instruction,decision:'do',initialExecutions:1,attemptsThisBatch:1}]});
 assert.equal((await h.rt.stage('select_task',{})).status,'stopped');
 assert.ok(h.actions.every(a=>a.type!=='tap'));
});

test('offline focused prompt distinguishes ordinary non-panel overlays from actual security blockers for every read purpose',async t=>{
 const h=fixture(t);
 for(const purpose of ['selected-row','return-status','settlement'] as const){
  const frame=h.frame();let prompt='';
  const e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose,task:identity(task)},model:{query:async(r:any)=>{prompt=r.prompt;return {isPanel:false,balance:null,blocked:false,taskStatus:'not-panel',task:null};}}});
  assert.equal(e.status,'accepted');
  assert.match(prompt,/blocked=true ONLY when.*actual login.*CAPTCHA.*slider\/security verification.*required authorization/s);
  assert.match(prompt,/normal non-panel destination.*ordinary promotional\/retention popup.*not a blocker/s);
  assert.match(prompt,/isPanel=false.*does not imply blocked=true/s);
  assert.match(prompt,/blocked=false.*existing bounded return.*not authorize.*tap/s);
  assert.equal(loadAiPanel({...frame,aiPanelEvidence:e})?.blocked,false);
 }
});

test('offline ordinary non-panel focused return reaches the owning panel through the existing first bounded back',async t=>{
 const h=await harness(t),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'offline-normal-return'};
 assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
 const before=h.actions.length,queries=h.requests.length;
 const result=await h.rt.stage('return_list',ctx);assert.equal(result.status,'completed',result.error);
 assert.deepEqual(h.actions.slice(before).map(a=>a.type),['back','wait']);
 assert.deepEqual(h.requests.slice(queries).map(r=>r.panelReadMode?.purpose),['return-status','return-status']);
 const observed=result.events.filter((e:any)=>e.type==='observed').map((e:any)=>readPanel(e.frame));
 assert.equal(observed[0].isPanel,false);assert.equal(observed[0].blocked,false);assert.equal(observed.at(-1).isPanel,true);
 assert.equal(h.actions.filter(a=>a.type==='tap').length,1,'return must never replay entry or tap a promotion');
});

test('offline true focused non-panel blocker stops before any return input and is never coerced false',async t=>{
 const raw={isPanel:false,balance:null,blocked:true,taskStatus:'not-panel',task:null};
 const h=await harness(t,{answer:(r:any)=>r.panelReadMode?raw:undefined}),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'offline-blocked-return'};
 assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
 const before=h.actions.length,queries=h.requests.length,result=await h.rt.stage('return_list',ctx);
 assert.equal(result.status,'stopped');assert.match(result.error,/Login\/verification/);assert.deepEqual(h.actions.slice(before),[]);
 assert.equal(h.requests.length-queries,1,'blocker must stop before any fallback query');
 const frame=h.rt.frames.at(-1);assert.equal(loadAiPanel(frame)?.blocked,true);
 assert.deepEqual(JSON.parse(fs.readFileSync(frame.aiPanelEvidence.rawResponse.path,'utf8')),raw);
});

test('offline focused return checks the post-back modal and uses only the existing bound recovery path',async t=>{
 for(const blocked of [false,true]){
  let backs=0,recoveryQueries=0;
  const h=await harness(t,{config:{aiTaskRecovery:true},afterAct:(a:any,setPage:(page:string)=>void)=>{if(a.type==='back'&&++backs===1)setPage('modal');},answer:(r:any,page:string)=>{
   if(r.context){
    recoveryQueries++;const c=r.context;
    return {stageDone:false,pageIdentity:'offline ordinary retention modal',blocked:false,stopReason:null,ordinaryBrowseOnly:false,requirements:'',completionQuote:'',taskBinding:{taskAttemptId:c.taskAttemptId,name:c.task.name,instruction:c.task.instruction,frameId:r.frame.id,entryFrameId:c.actualEntry.sourceFrameId,entryActionId:c.actualEntry.entryActionId},next:{action:{type:'back'},reason:'offline safe system return',expected:'owning panel'}};
   }
   if(r.panelReadMode&&(page==='browse'||page==='modal'))return {isPanel:false,balance:null,blocked:page==='modal'&&blocked,taskStatus:'not-panel',task:null};
   return undefined;
  }}),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'offline-bound-return-'+blocked};
  assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
  const before=h.actions.length,result=await h.rt.stage('return_list',ctx);
  if(blocked){assert.equal(result.status,'stopped');assert.match(result.error,/Login\/verification/);assert.equal(backs,1);assert.equal(recoveryQueries,0);}
  else {assert.equal(result.status,'completed',result.error);assert.equal(backs,2);assert.equal(recoveryQueries,1);assert.ok(result.actions.some((a:any)=>a.source==='agent'&&a.proposal.action?.type==='back'));}
  assert.ok(h.actions.slice(before).every(a=>['back','wait'].includes(a.type)));
 }
});

test('focused policy reuses unconsumed collection and selection through real entry, then reads only return and settlement fields',async t=>{
 const h=await harness(t);
 assert.equal((await h.rt.stage('collect_list',{})).status,'completed');
 const selected=await h.rt.stage('select_task',{});assert.equal(selected.status,'completed');
 assert.equal(h.captures,1,'collection to selection must reuse the unconsumed frame');
 const ctx={task:selected.task,taskAttemptId:'synthetic-attempt'};
 assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');
 assert.equal(h.captures,3,'entry uses selected frame; arrival and post-settling each need a new capture');
 assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
 assert.equal((await h.rt.stage('return_list',ctx)).status,'completed');
 const result=await h.rt.stage('settle',ctx);assert.equal(result.status,'completed',result.error);assert.equal(result.balanceAfter,2285);
 assert.equal(h.requests.filter(r=>!r.panelReadMode).length,1,'only inventory requests the complete table');
 assert.deepEqual(h.requests.filter(r=>r.panelReadMode).map(r=>r.panelReadMode.purpose),['return-status','return-status','settlement','settlement']);
 assert.ok(h.requests.filter(r=>r.panelReadMode).every(r=>JSON.stringify(r.panelReadMode.task)===JSON.stringify(identity(task))));
 assert.notEqual(result.review.samples[0].frameId,result.review.samples[1].frameId);
 assert.equal(h.actions.filter(a=>a.type==='tap').length,1);
});

test('a reused selection missing its row is rebound on a fresh frame instead of borrowing coordinates',async t=>{
 const h=await harness(t);const chosen=await h.rt.stage('select_task',{});assert.equal(chosen.status,'completed');
 // Replace the selected frame with valid immutable evidence of a different viewport.
 const f=h.rt.frames[0],e=await readAiPanel({frame:f,owner,evidenceDir:h.dir,maxMs:1000,model:{query:async()=>({...full(),tasks:[]})}});f.aiPanelEvidence=e;
 fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));
 assert.equal((await h.rt.stage('open_task',{task:chosen.task,taskAttemptId:'rebind'})).status,'completed');
 assert.deepEqual(h.requests.map(r=>r.panelReadMode?.purpose??'inventory'),['inventory','selected-row']);
});

test('an expired selected frame is captured again with only its exact row read',async t=>{
 const h=await harness(t);const chosen=await h.rt.stage('select_task',{});assert.equal(chosen.status,'completed');
 const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
 try{clock+=15001;assert.equal((await h.rt.stage('open_task',{task:chosen.task,taskAttemptId:'fresh-entry'})).status,'completed');}finally{Date.now=realNow;}
 assert.deepEqual(h.requests.map(r=>r.panelReadMode?.purpose??'inventory'),['inventory','selected-row']);
 assert.deepEqual(h.requests[1].panelReadMode.task,identity(task));
 assert.equal(h.actions.filter(a=>a.type==='tap').length,1);
});

test('focused raw response and purpose/task manifest remain bound without model calls at load',async t=>{
 const h=fixture(t),frame=h.frame(),mode={purpose:'selected-row' as const,task:identity(task)};let calls=0;
 const e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:mode,model:{query:async()=>{calls++;return {isPanel:true,balance:2265,blocked:false,taskStatus:'visible',task};}}});
 const bound={...frame,aiPanelEvidence:e};assert.equal(loadAiPanel(bound,mode)?.tasks[0].frameId,frame.id);
 assert.equal(loadAiPanel(bound,{...mode,purpose:'settlement'}),null);
 assert.equal(loadAiPanel(bound,{...mode,task:{...mode.task,total:2}}),null);
 assert.equal(loadAiPanel({...bound,aiPanelEvidence:{...e,readMode:{...mode,purpose:'settlement'}}}),null);
 const raw=fs.readFileSync(e.rawResponse!.path,'utf8');fs.writeFileSync(e.rawResponse!.path,raw+' ');assert.equal(loadAiPanel(bound),null);
 assert.equal(calls,1);
});

test('focused absence and row ambiguity preserve panel identity and independent blockers',async t=>{
 const h=fixture(t);for(const taskStatus of ['absent','ambiguous'] as const)for(const blocked of [false,true]){
  const frame=h.frame(),e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose:'settlement',task:identity(task)},model:{query:async()=>({isPanel:true,balance:2285,blocked,taskStatus,task:null})}}),p=readPanel({...frame,aiPanelEvidence:e});
  assert.equal(e.status,'accepted');assert.equal(p.isPanel,true);assert.equal(p.balance,2285);assert.equal(p.tasks.length,0);assert.equal(p.top,false);assert.equal(p.bottom,false);assert.equal(p.blocked,blocked);
 }
});

test('return and settlement read current counters without click geometry or reward metadata',async t=>{
 const h=fixture(t);
 for(const purpose of ['return-status','settlement'] as const)for(const row of [
  {...identity(task),done:1,total:2},
  {...task,done:1,total:2,point:[0,0],bounds:[-4,0,2,2],buttonBounds:[0,0,1,1],reward:-1,rewardOffers:'unreadable'},
 ]){
  const frame=h.frame();let prompt='';const raw={isPanel:true,balance:2285,blocked:false,taskStatus:'visible',task:row};
  const e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose,task:identity(task)},model:{query:async(r:any)=>{prompt=r.prompt;return raw;}}});
  assert.equal(e.status,'accepted');const p=loadAiPanel({...frame,aiPanelEvidence:e})!;
  assert.equal(p.balance,2285);assert.equal(p.tasks[0].done,1);assert.equal(p.tasks[0].total,2);assert.equal(p.tasks[0].point,undefined);
  assert.equal(p.blocked,false);assert.deepEqual(JSON.parse(fs.readFileSync(e.rawResponse!.path,'utf8')),raw);
  assert.match(prompt,/do not require.*button.*geometry.*reward/i);assert.doesNotMatch(prompt,/but same total/);
  assert.throws(()=>validateProposedAction({type:'tap',x:925,y:750},{...frame,aiPanelEvidence:e}),/purpose/);
 }
});

test('uncertain status rows affect only task state while selected-row retains exact actionable validation',async t=>{
 const h=fixture(t);
 for(const row of [{...task,name:'replacement'},{...task,done:3,total:2},{...task,total:'unknown'}]){
  const frame=h.frame(),e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose:'settlement',task:identity(task)},model:{query:async()=>({isPanel:true,balance:2285,blocked:false,taskStatus:'visible',task:row})}});
  assert.equal(e.status,'accepted');const p=loadAiPanel({...frame,aiPanelEvidence:e})!;assert.equal(p.isPanel,true);assert.equal(p.balance,2285);assert.equal(p.taskStatus,'ambiguous');assert.deepEqual(p.tasks,[]);assert.equal(p.blocked,false);
 }
 for(const row of [{...task,total:2},{...task,done:1},{...task,point:[0,0]},{...task,reward:-1},{...identity(task)}]){
  const frame=h.frame(),e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose:'selected-row',task:identity(task)},model:{query:async()=>({isPanel:true,balance:2265,blocked:false,taskStatus:'visible',task:row})}});
  assert.equal(e.status,'rejected');
 }
});

test('focused return accepts ambiguous row state and settlement consumes counters without geometry',async t=>{
 for(const state of ['ambiguous','advanced','unchanged','changed-total'] as const){
  const h=await harness(t,{answer:(r:any,page:string)=>{
   if(!r.panelReadMode||page!=='returned')return undefined;
   return {isPanel:true,balance:2285,blocked:false,taskStatus:state==='ambiguous'?'ambiguous':'visible',task:state==='ambiguous'?null:{...identity(task),done:state==='unchanged'?0:1,total:state==='changed-total'?2:1}};
  }}),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'status-only-'+state};
  assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
  assert.equal((await h.rt.stage('return_list',ctx)).status,'completed');
  const result=await h.rt.stage('settle',ctx);
  if(state==='unchanged'||state==='changed-total'){assert.notEqual(result.status,'completed');assert.match(result.error,/did not reconcile/);}
  else {assert.equal(result.status,'completed',result.error);assert.equal(result.balanceAfter,2285);}
  assert.equal(h.actions.filter(a=>a.type==='tap').length,1);
 }
});

test('empty complete-looking AI table cannot report a complete inventory under focused policy',async t=>{
 const h=await harness(t,{answer:()=>({...full(),tasks:[]})});const r=await h.rt.stage('collect_list',{});assert.equal(r.status,'stopped');assert.match(r.error,/empty|task|inventory/i);
});

test('current-components policy invokes the current inspector and hands AI recovery back at a known checkpoint',async t=>{
 const f=fixture(t);let page='panel',serial=0,currentChecks=0,legacyChecks=0,aiCalls=0;const actions:any[]=[],requests:any[]=[];
 const rt=createStagedRuntime(config({taskObservationPolicy:'current-components-v1',aiTaskRecovery:true}),{capture:async()=>{serial++;return f.frame();},act:async(a:any)=>{actions.push(a);if(a.type==='tap')page='browse';if(a.type==='wait'&&a.ms===500)page='known';}}, {usage:[],query:async(r:any)=>{
  requests.push(r);if(!r.context)return full();aiCalls++;const c=r.context;
  return {stageDone:false,pageIdentity:'当前合成加载页',blocked:false,stopReason:null,ordinaryBrowseOnly:true,requirements:'浏览5秒',completionQuote:'',taskBinding:{taskAttemptId:c.taskAttemptId,name:c.task.name,instruction:c.task.instruction,frameId:r.frame.id,entryFrameId:c.actualEntry.sourceFrameId,entryActionId:c.actualEntry.entryActionId},next:{action:{type:'wait',ms:500},reason:'等待加载',expected:'known'}};
 }},{sessionId:'synthetic-handoff',evidenceDir:f.dir,plan:[{...identity(task),decision:'do',times:1}],inspectLearnedBrowse:async()=>{legacyChecks++;return null;},inspectCurrentLearnedBrowse:async()=>{currentChecks++;return page==='known'?{state:'completed',quote:'本次任务已完成',version:'current-components-v1'}:null;}});
 const chosen=await rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'handoff'};
 assert.equal((await rt.stage('open_task',ctx)).status,'completed');
 assert.equal((await rt.stage('task_receipt',ctx)).status,'completed');
 assert.equal(aiCalls,1,'known checkpoint returns to script with no further model request');assert.equal(legacyChecks,0);assert.ok(currentChecks>0);
 assert.ok(actions.some(a=>a.type==='wait'&&a.ms===500));assert.equal(actions.filter(a=>a.type==='tap').length,1);
});

test('current continuous dispatch revalidates current components and regenerates a fresh swipe',async t=>{
 const f=fixture(t);let page='panel',captures=0,scrolls=0,checks=0;const action={type:'swipe',fromX:540,fromY:2200,toX:540,toY:800,ms:900},sent:any[]=[];
 const cfg=config({taskObservationPolicy:'current-components-v1',limits:{...config().limits,stageMs:60000,sessionMs:120000},stages:{...config().stages,task_receipt:{goal:'receipt',checkpoint:'receipt',continuousScroll:{maxMs:35000,maxSwipes:30}}}});
 const rt=createStagedRuntime(cfg,{capture:async()=>{captures++;return f.frame();},act:async(a:any)=>{if(a.type==='tap')page='browse';},scrollContinuously:async(a:any,frame:any)=>{scrolls++;sent.push({a,frame});page='done';}}, {query:async()=>full()}, {evidenceDir:f.dir,plan:[{...identity(task),decision:'do',times:1}],inspectCurrentLearnedBrowse:async(frame:any)=>{checks++;return page==='done'?{state:'completed',quote:'本次任务已完成',version:'current-components-v1',rewardCoins:50}:{state:'browsing',version:'current-components-v1',rewardCoins:50,action:{...action,toY:800+captures}};},revalidateLearnedBrowse:async()=>{throw Error('legacy revalidation must not run');}});
 const chosen=await rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'current-scroll'};
 assert.equal((await rt.stage('open_task',ctx)).status,'completed');
 const receipt=await rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);
 assert.equal(scrolls,1);assert.ok(checks>=3);assert.equal(sent[0].a.toY,800+Number(sent[0].frame.id.split('-')[1]));
});

test('settlement cannot count repeated capture identities as two fresh samples',async t=>{
 let fixed:any;const h=await harness(t,{capture:(page:string,next:()=>any)=>page==='returned'?(fixed??=next()):next()}),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'duplicates'};
 assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');h.setPage('returned');
 const result=await h.rt.stage('settle',ctx);assert.notEqual(result.status,'completed');assert.match(result.error,/fresh|reused|duplicate/i);
});

test('current immersive result keeps its policy version through runtime receipt checks',async t=>{
 const f=fixture(t);let page='panel',checks=0;
 const rt=createStagedRuntime(config({taskObservationPolicy:'current-components-v1',immersiveBrowse:{enabled:true,version:'immersive-browse-candidate-v2',sourceRunId:145,task:identity(task),allowedRewardCoins:[20],observationBudgetMs:10000}}),{capture:async()=>f.frame(),act:async(a:any)=>{if(a.type==='tap')page='browse';}}, {query:async()=>full()}, {evidenceDir:f.dir,plan:[{...identity(task),decision:'do',times:1}],inspectCurrentImmersiveBrowse:async()=>{checks++;return {state:'completed',version:'immersive-browse-current-components-v1',rewardCoins:20,quote:'已得20'};}});
 const chosen=await rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'immersive'};
 assert.equal((await rt.stage('open_task',ctx)).status,'completed');
 const received=await rt.stage('task_receipt',ctx);assert.equal(received.status,'completed',received.error);assert.ok(checks>0);assert.equal(received.receipt.version,'immersive-browse-current-components-v1');
});

test('a cached full or failed read cannot masquerade as another stage read purpose',async t=>{
 let fixed:any;const h=await harness(t,{capture:(_page:string,next:()=>any)=>fixed??=next(),answer:()=>full()});
 assert.equal((await h.rt.stage('select_task',{})).status,'completed');h.setPage('returned');
 const returned=await h.rt.stage('return_list',{task:task,taskAttemptId:'purpose'});assert.notEqual(returned.status,'completed');
 assert.equal(h.requests.length,2);assert.equal(h.requests[1].panelReadMode.purpose,'return-status');
 assert.equal(h.rt.frames.at(-1).aiPanelEvidence.status,'rejected');
});

test('selection after a focused return requests full inventory instead of selecting from a partial status read',async t=>{
 const h=await harness(t,{answer:(r:any,page:string)=>r.panelReadMode?{isPanel:page!=='browse',balance:page==='browse'?null:2285,blocked:false,taskStatus:page==='browse'?'not-panel':'visible',task:page==='browse'?null:task}:full()}),chosen=await h.rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'partial-selection'};
 assert.equal((await h.rt.stage('open_task',ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');assert.equal((await h.rt.stage('return_list',ctx)).status,'completed');
 h.setPage('panel');const before=h.requests.length;
 assert.equal((await h.rt.stage('select_task',{})).status,'completed');assert.equal(h.requests[before].panelReadMode,undefined);
});

test('AI recovery configuration requires the learned executor that actually owns entry',()=>{
 assert.throws(()=>validateStagedConfig(config({aiTaskRecovery:true,learnedBrowse:{enabled:false,version:'continuous-browse-candidate-v1',sourceRunId:153}})),/recovery|requires/);
});

test('configuration requires explicit compatible focused and current component policies',()=>{
 assert.equal(validateStagedConfig(config()).panelReadPolicy,'focused-v1');
 for(const extra of [{panelReadPolicy:'other'},{aiPanelReader:false},{panelReadPolicy:'focused-v1',scriptValidationMode:true},{panelReadPolicy:'focused-v1',balanceComponent:true},{taskObservationPolicy:'other'},{taskObservationPolicy:'current-components-v1',learnedBrowse:{enabled:false,version:'continuous-browse-candidate-v1',sourceRunId:153}},{taskObservationPolicy:'current-components-v1',panelReadPolicy:undefined}])assert.throws(()=>validateStagedConfig(config(extra)),/policy|requires/);
 assert.equal(validateStagedConfig(config({taskObservationPolicy:'current-components-v1'})).taskObservationPolicy,'current-components-v1');
});

test('return/settlement evidence never grants row tap authority',async t=>{
 const h=fixture(t),frame=h.frame();
 const e=await readAiPanel({frame,owner,evidenceDir:h.dir,maxMs:1000,readMode:{purpose:'settlement',task:identity(task)},model:{query:async()=>({isPanel:true,balance:2285,blocked:false,taskStatus:'visible',task:{...task,done:0}})}});
 assert.equal(e.status,'accepted');
 assert.throws(()=>validateProposedAction({type:'tap',x:925,y:750},{...frame,aiPanelEvidence:e}),/focused|purpose|settlement/);
});
