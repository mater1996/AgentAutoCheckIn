import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(import.meta.dirname,'..');
const fixture=JSON.parse(await readFile(resolve(root,'data/evidence/home-revisit-integration/saved-page-observations.json'),'utf8'));
const modulePath=resolve(root,'runner/staged/home-revisit-route.ts');
const cfg={sessionId:'offline-route',package:fixture.owner.package,scope:{userId:0},panelMarker:'赚金币抵钱'};
const route={type:'home-revisit',task:fixture.task,transitionWaitMs:0,loadingWaitsMs:[],returnSteps:['visible-exit'],refreshReturnedPanel:false,
 homeRevisit:{taskSteps:[{from:'guide',role:'guide-home',to:'home'},{from:'home',role:'home-coin',to:'activity'}],returnSteps:[{from:'activity',role:'open-panel',to:'owning-panel'}]}};
const ctx={task:{...fixture.task,done:0,total:1},taskAttemptId:fixture.owner.taskAttemptId,balanceBefore:2705};
async function load(){const m=await import(modulePath).catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));assert.equal(typeof m.createHomeRevisitRoute,'function','formal action adapter must exist');return m;}
async function saved(index:number){const p=fixture.pages[index];for(const s of p.sources)assert.equal(createHash('sha256').update(await readFile(resolve(root,s.path))).digest('hex'),s.sha256);const raw=JSON.parse(await readFile(resolve(root,p.sources[1].path),'utf8'));return {...raw,path:resolve(root,p.sources[0].path),package:raw.owner?.package??raw.package,userId:raw.owner?.userId??raw.userId,lines:raw.lines??[],pngSha256:p.sources[0].sha256};}
async function harness(options:any={}){
 const frames=await Promise.all([0,1,2,3,4,5].map(saved)),events:any[]=[],actions:any[]=[],queries:any[]=[];
 let current=0;
 const targets:any={guide:{role:'guide-home',quote:'回淘宝首页领取',point:[542,2130],bounds:[260,2080,820,2180]},home:{role:'home-coin',quote:'领淘金币',point:[884,413],bounds:[790,350,980,485]},activity:{role:'open-panel',quote:'去赚金币',point:[115,996],bounds:[10,920,225,1050]}};
 const deps={observe:async()=>frames[current],persist:async(e:any)=>{events.push(structuredClone(e));await options.persist?.(e);},query:async(prompt:string,f:any,context:any)=>{
  queries.push({prompt,frameId:f.id,context});const p=fixture.pages.find((p:any)=>p.id===f.id);
  const value={...p.observation,binding:context.binding,blocked:false,requiredInteraction:'home-revisit',requirementsQuote:'offline human reviewed saved-page annotation',target:targets[p.observation.page]??null};
  return options.query?options.query(value,f,context):value;
 },dispatch:async(a:any,f:any)=>{actions.push({action:a,frameId:f?.id});await options.dispatch?.(a,f);if(a.type==='tap')current=current===0?1:current===1?2:current===2?3:5;}};
 return {frames,events,actions,queries,deps,advance:(n:number)=>{current=n;}};
}

test('raw burst captures short toast immediately after home entry and before ordinary observation; synthetic selected receipt stays separate',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness({query:(v:any,f:any)=>{
  if(f.id===fixture.pages[4].id)v.rewards=[{role:'selected',kind:'home-revisit',coins:10,quote:'SYNTHETIC TEST ONLY: 回访成功 获得10淘金币',proof:'received',independent:true,task:fixture.task}];return v;
 }});
 const batch={id:h.frames[3].batchId,status:'complete',frames:[3,4].map(i=>({...h.frames[i],owner:fixture.owner,sidecarPath:resolve(root,fixture.pages[i].sources[1].path)}))};
 let captured=0;
 const deps={...h.deps,captureRawBurst:async(request:any)=>{captured++;assert.equal(h.actions.length,3);assert.equal(request.frame.id,h.frames[2].id);return batch;}};
 const adapter=createHomeRevisitRoute(cfg,{...route,homeRevisit:{...route.homeRevisit,capturePolicy:{frames:2,intervalMs:0}}},deps);
 assert.equal((await adapter.stage('open_task',ctx)).status,'completed');
 const receipt=await adapter.stage('task_receipt',ctx);assert.equal(captured,1);assert.equal(receipt.status,'completed');assert.match(receipt.receipt.quote,/SYNTHETIC/);
 const returned=await adapter.stage('return_list',ctx);assert.equal(returned.status,'completed');assert.equal(returned.gainCoins,10,JSON.stringify({issues:returned.issues,assessment:returned.assessment}));assert.equal(returned.unexplainedDelta,0);
 assert.equal(returned.rewardAttribution.incidentalRewards.length,1);assert.equal(returned.rewardAttribution.incidentalRewards[0].coins,100);
 assert.equal(h.queries.filter(q=>q.context.phase==='transient').length,2);
 const duplicate=await adapter.stage('return_list',ctx);assert.notEqual(duplicate.status,'completed','stored attribution cannot overwrite consumed-stage failure');
});

test('different attempt cannot inherit a previously observed synthetic receipt',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness({query:(v:any,f:any)=>{if(f.id===fixture.pages[3].id)v.rewards=[{role:'selected',kind:'home-revisit',coins:10,quote:'SYNTHETIC TEST ONLY selected receipt',proof:'received',independent:true,task:fixture.task}];return v;}}),adapter=createHomeRevisitRoute(cfg,route,h.deps);
 await adapter.stage('open_task',ctx);const receipt=await adapter.stage('task_receipt',ctx);assert.ok(receipt.receipt);
 const foreign=await adapter.stage('return_list',{...ctx,taskAttemptId:'foreign'});assert.equal(foreign.status,'unknown');assert.equal(foreign.receipt,undefined);assert.equal(foreign.rewardAttribution,undefined);
});

test('configured loading waits reobserve the original page without replaying its entry',async()=>{
 const {createHomeRevisitRoute}=await load();let pending=true;
 const h=await harness({query:(v:any)=>{if(v.page==='guide'&&pending){pending=false;return {...v,page:'loading',target:null,rewards:[]};}return v;}});
 const a=createHomeRevisitRoute(cfg,{...route,loadingWaitsMs:[1000]},h.deps);
 const opened=await a.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);assert.deepEqual(h.actions.map(a=>a.action.type),['tap','wait']);
});

test('configured transient capture must be available before consuming the selected entry',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness();
 const adapter=createHomeRevisitRoute(cfg,{...route,homeRevisit:{...route.homeRevisit,capturePolicy:{frames:2,intervalMs:0}}},h.deps);
 const r=await adapter.stage('open_task',ctx);assert.equal(r.status,'stopped');assert.equal(h.actions.length,0);
});

test('saved-page action replay enters once, follows guide/home, returns safely with incidental100 and unexplained10',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness();
 const batch={id:h.frames[3].batchId,status:'complete',frames:[3,4].map(i=>({...h.frames[i],owner:fixture.owner,sidecarPath:resolve(root,fixture.pages[i].sources[1].path)}))};
 const adapter=createHomeRevisitRoute(cfg,{...route,homeRevisit:{...route.homeRevisit,capturePolicy:{frames:2,intervalMs:0}}},{...h.deps,captureRawBurst:async()=>batch});
 const opened=await adapter.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
 assert.equal(adapter.ownsEntry,true);
 const reward=await adapter.stage('task_receipt',ctx);
 assert.equal(reward.status,'unknown');assert.equal(reward.gainCoins,null);assert.equal(reward.receipt,undefined);
 const returned=await adapter.stage('return_list',ctx);
 assert.equal(returned.status,'completed');assert.equal(returned.balanceAfter,2815);
 assert.equal(returned.rewardAttribution.selectedRewardCoins,null);assert.equal(returned.rewardAttribution.incidentalRewards[0].coins,100);assert.equal(returned.unexplainedDelta,10);
 assert.deepEqual(h.actions.map(a=>a.action.type),['tap','tap','tap','tap']);
 assert.deepEqual(h.actions.map(a=>a.frameId),[h.frames[0].id,h.frames[1].id,h.frames[2].id,h.frames[3].id]);
 assert.equal(h.events.filter(e=>e.kind==='home_revisit_dispatch_reserved'&&e.key==='entry').length,1);
 assert.ok(h.queries.every(q=>q.context.binding.pngSha256&&q.prompt.includes('ORIGINAL PNG')));
 const count=h.actions.length;assert.notEqual((await adapter.stage('open_task',ctx)).status,'completed');assert.equal(h.actions.length,count);
 await writeFile(resolve(root,'data/evidence/home-revisit-integration/route-saved-replay-result.json'),JSON.stringify({mode:'offline-human-reviewed-saved-pages-action-replay',note:'Six archived image annotations; never live model output. No device or ledger used.',actions:h.actions,result:returned},null,2)+'\n');
});

test('durable reservation finishes before entry dispatch and reservation failure never sends input',async()=>{
 const {createHomeRevisitRoute}=await load();let released=false,release!:()=>void,reserved!:()=>void;
 const gate=new Promise<void>(r=>{release=()=>{released=true;r();};}),seen=new Promise<void>(r=>{reserved=r;});
 const h=await harness({persist:async(e:any)=>{if(e.kind==='home_revisit_dispatch_reserved'){reserved();await gate;}},dispatch:async()=>assert.equal(released,true)});
 const adapter=createHomeRevisitRoute(cfg,route,h.deps),opening=adapter.stage('open_task',ctx);await seen;assert.equal(h.actions.length,0);
 assert.equal((await adapter.stage('open_task',ctx)).status,'stopped');release();assert.equal((await opening).status,'completed');assert.equal(h.actions.length,1);
 const failed=await harness({persist:async(e:any)=>{if(e.kind==='home_revisit_dispatch_reserved')throw Error('offline disk failure');}}),a=createHomeRevisitRoute(cfg,route,failed.deps);
 assert.equal((await a.stage('open_task',ctx)).status,'unknown');assert.equal(failed.actions.length,0);await a.stage('open_task',ctx);assert.equal(failed.actions.length,0);
});

test('unknown dispatch never replays any task or return action',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness({dispatch:async()=>{throw Error('offline transport outcome unknown');}}),a=createHomeRevisitRoute(cfg,route,h.deps);
 assert.equal((await a.stage('open_task',ctx)).status,'unknown');assert.equal(a.unknown,true);
 for(const id of ['open_task','task_receipt','return_list'])assert.notEqual((await a.stage(id,ctx)).status,'completed');assert.equal(h.actions.length,1);
});

test('no navigation progress consumes the phase and never repeats a guide action',async()=>{
 const {createHomeRevisitRoute}=await load(),h=await harness(),base=h.deps.dispatch;
 h.deps.dispatch=async(a:any,f:any)=>{await base(a,f);if(h.actions.length===2)h.advance(1);};
 const adapter=createHomeRevisitRoute(cfg,route,h.deps);await adapter.stage('open_task',ctx);
 const r=await adapter.stage('task_receipt',ctx);assert.equal(r.status,'unknown');assert.match(r.error,/no navigation progress/);
 await adapter.stage('task_receipt',ctx);assert.equal(h.actions.length,2);
});

test('foreign model binding, blocked page, wrong target role and unsafe geometry grant no guide action',async()=>{
 const {createHomeRevisitRoute}=await load();
 for(const mutation of [(v:any)=>({...v,binding:{...v.binding,frameId:'foreign'}}),(v:any)=>({...v,blocked:true}),(v:any)=>({...v,target:{...v.target,role:'home-coin'}}),(v:any)=>({...v,target:{...v.target,point:[-1,2130]}})]){
  let armed=false;const h=await harness({query:(v:any)=>armed&&v.page==='guide'?mutation(v):v}),a=createHomeRevisitRoute(cfg,route,h.deps);
  assert.equal((await a.stage('open_task',ctx)).status,'completed');armed=true;assert.equal((await a.stage('task_receipt',ctx)).status,'unknown');assert.equal(h.actions.length,1);
 }
});

test('resume and changed session/scope/task/baseline cannot consume entry',async()=>{
 const {createHomeRevisitRoute}=await load();
 for(const [config,context] of [[{...cfg,resume:true},ctx],[cfg,{...ctx,id:'foreign'}],[cfg,{...ctx,scope:{userId:1}}],[cfg,{...ctx,task:{...ctx.task,instruction:'different'}}],[cfg,{...ctx,balanceBefore:2800}]]){
  const h=await harness(),a=createHomeRevisitRoute(config,route,h.deps);assert.equal((await a.stage('open_task',context)).status,'stopped');assert.equal(h.actions.length,0);
 }
});
