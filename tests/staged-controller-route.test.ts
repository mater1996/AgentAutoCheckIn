import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { buildPanelClaimContract, loadPanelClaimReplay } from '../runner/staged/panel-claim.ts';
import { buildShopBrowseContract, loadShopBrowseReplay } from '../runner/staged/shop-browse.ts';
import { runActivitySession } from '../runner/staged/session.ts';
import { runStage } from '../runner/staged/engine.ts';
import { readPanel, stableSettlement } from '../runner/staged/observations.ts';
const root = new URL('../', import.meta.url).pathname;
const scope = { appId:'taobao', accountId:'local', activityId:'coins', userId:0 };
const task = { name:'任务到访得金币', instruction:'每日来任务面板' };
const load = () => import('../runner/staged/controller-route.ts').catch(() => null);
function device(frames:any[]) {
 let clock=100000, serial=0, index=0; const actions:string[]=[], events:any[]=[];
 const fresh=(f:any)=>({...structuredClone(f),id:`route-derived-${++serial}`,capturedAt:++clock,page:{derived:true,original:f.page,originalCapture:{id:f.id,capturedAt:f.capturedAt}}});
 return {actions,events,fresh,now:()=>clock,observe:async()=>fresh(frames[index]),
 dispatch:async(a:any)=>{actions.push(a.type);if(a.type==='wait')clock+=a.ms;else index=Math.min(index+1,frames.length-1);},
 persist:async(e:any)=>{events.push(structuredClone(e));}};
}
function config(contract:any, selected=task) {return {sessionId:'route-session',scope,package:'com.taobao.taobao',budget:{maxMs:30000,maxActions:10,maxAgentCalls:0},candidates:[{family:contract.family,task:selected,contract}]};}
const context=(selected=task)=>({id:'route-session',scope,task:selected,taskAttemptId:'route-attempt',balanceBefore:1430});
test('development route carries policy through slow raw derivation and return-frame checker',async()=>{
 const api=(await load())!,c=await buildPanelClaimContract(root),replay=await loadPanelClaimReplay(c),d=device([replay.frames[0],replay.frames.at(-1)]);
 const cfg={...config(c),executionPolicy:'development-unbounded-v1' as const,budget:{maxMs:null,maxActions:null,maxAgentCalls:null},candidates:[{family:c.family,task,contract:c,capturePolicy:{frames:9,intervalMs:500}}]};
 const route=api.createControllerRoute(cfg as any,{...d,observe:async()=>{const f=await d.observe();await d.dispatch({type:'wait',ms:6000});return f;},captureRawBurst:async()=>{await d.dispatch({type:'wait',ms:6000});return {frames:[d.fresh(replay.frames[1])],status:'complete'} as any;},deriveRawFrames:async(batch:any)=>{await d.dispatch({type:'wait',ms:6000});return batch.frames;}});
 const opened=await route.stage('open_task',context());assert.equal(opened.status,'completed',opened.error);assert.equal((await route.stage('task_receipt',context())).status,'completed');assert.equal((await route.stage('return_list',context())).status,'completed');assert.equal(d.actions.filter(a=>a==='tap').length,1);
});

test('historical panel: real engine/controller/session maps receipt provenance and returns without back',async()=>{
 const api=await load(); assert.ok(api?.createControllerRoute,'missing controller route');
 const contract=await buildPanelClaimContract(root), replay=await loadPanelClaimReplay(contract);
 const d=device([replay.frames[0],replay.frames.at(-1)]); let modelCalls=0, settled=0;
 const throwingModel=async()=>{modelCalls++;throw Error('offline model forbidden');};
 const route=api.createControllerRoute(config(contract),{...d,captureBurst:async()=>[d.fresh(replay.frames[1])]});
 const result=await runActivitySession({id:'route-session',scope,evidenceDir:'offline',startedAt:'replay'}, {
 prepare:async()=>{},cleanup:async()=>{},save:async()=>({runId:1}),
 stage:async(id,ctx)=>{
  const routed=await route.stage(id,ctx);if(routed)return routed;
  if(id==='select_task')return {status:'completed',task,balanceBefore:1430};
  if(id==='settle'){settled++;assert.equal(ctx.receipt.path,replay.frames[1].path);assert.equal(ctx.receipt.version,contract.version);assert.equal(ctx.receipt.taskAttemptId,ctx.taskAttemptId);
   const before=readPanel(replay.frames[0]).tasks.find(t=>t.name===task.name)!;
   const samples=await Promise.all([d.observe(),d.observe()]);
   const settlement=stableSettlement({before,balanceBefore:ctx.balanceBefore,receipt:!!ctx.receipt,samples:samples.map(f=>({...readPanel(f),task:undefined}))});
   assert.equal(settlement.ok,true);assert.equal(settlement.delta,10);return {status:'completed',balanceAfter:settlement.balance};}
  return runStage({sessionId:'route-session',stageId:id,scope,goal:'offline surrounding checkpoint',expectedCheckpoint:id,constraints:{},budget:{maxMs:1000,maxAgentCalls:0,maxActions:0}}, {...d,agentStep:throwingModel,check:async()=>({done:true,checkpoint:id})});
 }});
 assert.equal(result.status,'completed',result.error); assert.equal(settled,1);assert.equal(modelCalls,0);
 assert.equal(d.actions.filter(a=>a==='tap').length,1);assert.equal(d.actions.includes('back'),false);
 assert.equal(result.receipt.quote,'任务完成！获得10淘金币');
 assert.equal(d.events.filter(e=>e.type==='explicit_candidate_authorized').length,1);
 assert.ok(d.events.some(e=>e.type==='controller_route_state'&&e.record.status==='finished'));
});

// Derived integration fixture: moves original shop card PNG and OCR together.
// Historical run 136 did not prove ownership of the second-card tap.
async function reorderedList(list:any,path:string) {
 const parts=await Promise.all([510,1055].map(top=>sharp(list.path).extract({left:90,top,width:950,height:110}).png().toBuffer()));
 await sharp(list.path).composite([{input:parts[1],left:90,top:510},{input:parts[0],left:90,top:1055}]).png().toFile(path);
 return {...list,path,lines:list.lines.map((l:any)=>{const top=l.bounds[1],dy=top>=510&&top<620?545:top>=1055&&top<1165?-545:0;return {...l,bounds:l.bounds.map((n:number,i:number)=>n+(i%2?dy:0))};}),page:{derived:true,transform:'swap original card strips',original:list.page}};
}
test('derived shop chain routes both real receipt layers through session and never adds a third back',async()=>{
 const api=(await load())!,contract=await buildShopBrowseContract(root),replay=await loadShopBrowseReplay(contract);
 const dir=await mkdtemp('/Users/mater/.hermes/cache/scratch/route-shop-');
 try {
  const selected={name:'逛好店赚一大波金币',instruction:'浏览15秒'};
  const d=device([replay.frames[0],await reorderedList(replay.frames[1],join(dir,'derived.png')),...replay.frames.slice(2)]);
  const cfg=config(contract,selected);Object.assign(cfg.candidates[0],{learningBudget:{status:'candidate',maxGestures:1,gestureMs:900,observationBudgetMs:10000}});
  const route=api.createControllerRoute(cfg,d);let settles=0;
  const result=await runActivitySession({id:'route-session',scope,evidenceDir:dir,startedAt:'replay'}, {prepare:async()=>{},save:async()=>({runId:2}),cleanup:async()=>{},stage:async(id,ctx)=>{
   const r=await route.stage(id,ctx);if(r)return r;
   if(id==='select_task')return {status:'completed',task:selected,balanceBefore:1430};
   if(id==='settle'){settles++;assert.deepEqual(ctx.receipt.layers.map((l:any)=>l.layer),['store','shopList']);assert.ok(ctx.receipt.layers.every((l:any)=>l.path&&l.version===contract.version&&l.taskAttemptId===ctx.taskAttemptId));assert.equal(ctx.receipt.returnedToActivity,true);return {status:'completed',balanceAfter:1460};}
   return {status:'completed'};
  }});
  assert.equal(result.status,'completed',result.error);assert.equal(settles,1);assert.equal(d.actions.filter(a=>a==='back').length,2);
  assert.deepEqual(d.actions,['tap','wait','tap','wait','swipe','back','back']);
  for(const layer of ['store','shopList']) {
   const records=route.snapshot();records[0].result.receipt.layers=records[0].result.receipt.layers.filter((r:any)=>r.layer!==layer);
   const restored=api.createControllerRoute({...cfg,initialRecords:records},d);
   assert.equal((await restored.stage('task_receipt',{...context(selected),taskAttemptId:result.taskAttemptId})).status,'unknown');
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('exact matching leaves ordinary paths alone; conflicts and no capture cannot dispatch',async()=>{
 const api=(await load())!,c=await buildPanelClaimContract(root),replay=await loadPanelClaimReplay(c),d=device(replay.frames);
 const route=api.createControllerRoute(config(c),d);
 assert.equal(await route.stage('open_task',context({...task,instruction:task.instruction+' '})),null);
 assert.equal(await route.stage('settle',context()),null);
 const cfg=config(c);cfg.candidates.push(cfg.candidates[0]);
 assert.equal((await api.createControllerRoute(cfg,d).stage('open_task',context())).status,'stopped');
 const result=await route.stage('open_task',context());assert.equal(result.status,'stopped');assert.match(result.error,/capture/i);assert.equal(d.actions.length,0);
});

test('uncertain dispatch, persistence failure and restored reservations never replay controller actions',async()=>{
 const api=(await load())!,c=await buildPanelClaimContract(root),r=await loadPanelClaimReplay(c);
 for(const mode of ['dispatch','persist']) {
  const d=device(r.frames);let taps=0;
  const deps={...d,captureBurst:async()=>[d.fresh(r.frames[1])],dispatch:async(a:any)=>{if(a.type==='tap'){taps++;throw Error('uncertain transport');}},persist:async(e:any)=>{if(mode==='persist')throw Error('disk failed');await d.persist(e);}};
  const route=api.createControllerRoute(config(c),deps);
  const first=await route.stage('open_task',context());assert.equal(first.status,'unknown');
  await route.stage('open_task',context());await route.stage('return_list',context());
  assert.equal(taps,mode==='dispatch'?1:0);
  const restarted=api.createControllerRoute({...config(c),initialRecords:route.snapshot()},deps);
  assert.equal((await restarted.stage('open_task',context())).status,'unknown');assert.equal(taps,mode==='dispatch'?1:0);
 }
});

test('receipt validation failure poisons the attempt even if a later observation would recover',async()=>{
 const api=(await load())!,c=await buildPanelClaimContract(root),r=await loadPanelClaimReplay(c),d=device([r.frames[0],r.frames.at(-1)]);
 const route=api.createControllerRoute(config(c),{...d,captureBurst:async()=>[d.fresh(r.frames[1])]});
 await route.stage('open_task',context());
 const broken=api.createControllerRoute({...config(c),initialRecords:route.snapshot()},{...d,observe:async()=>({...await d.observe(),package:'wrong.app'})});
 assert.equal((await broken.stage('return_list',context())).status,'unknown');
 assert.equal(broken.snapshot()[0].status,'unknown','validation errors must be durably cached');
});

test('original frame ambiguity, missing path, wrong attempt/version and wrong current panel fail closed',async()=>{
 const api=(await load())!,c=await buildPanelClaimContract(root),r=await loadPanelClaimReplay(c),d=device([r.frames[0],r.frames.at(-1)]);
 const deps={...d,captureBurst:async()=>[d.fresh(r.frames[1])]};const route=api.createControllerRoute(config(c),deps);
 assert.equal((await route.stage('open_task',context())).status,'completed');
 for(const corrupt of [
  (record:any)=>{record.result.receipt.taskAttemptId='other';},
  (record:any)=>{record.result.stages[0].usedScriptVersion='other';},
  (record:any)=>{record.result.stages[0].events=record.result.stages[0].events.filter((e:any)=>e.frame?.id!==record.result.receipt.frameId);},
  (record:any)=>{const e=record.result.stages[0].events.find((e:any)=>e.frame?.id===record.result.receipt.frameId);record.result.stages[0].events.push({...e,frame:{...e.frame,path:'ambiguous.png'}});},
 ]) {
  const records=route.snapshot();corrupt(records[0]);const restored=api.createControllerRoute({...config(c),initialRecords:records},deps);
  assert.equal((await restored.stage('task_receipt',context())).status,'unknown');
 }
 const wrong=api.createControllerRoute({...config(c),initialRecords:route.snapshot()},{...deps,observe:async()=>({...await d.observe(),package:'other.app'})});
 assert.equal((await wrong.stage('return_list',context())).status,'unknown');assert.equal(d.actions.filter(a=>a==='tap').length,1);
});
