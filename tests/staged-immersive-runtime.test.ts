import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
const v2='immersive-browse-candidate-v2';
test('immersive v2 accepts unique allowed component and locks browsing amount across frames',async()=>{
 for(const mode of ['ok','switched','ambiguous','wrong-version']){
  let frames=0,last='',calls:number[]=[];
  const h=harness({opts:{inspectImmersiveBrowse:async(f:any,_owner:any,requirement:any)=>{
   if(last!==f.id){frames++;last=f.id;}
   const rewardCoins=requirement?.rewardCoins;calls.push(rewardCoins);
   if(mode!=='ambiguous'&&rewardCoins!==(mode==='switched'&&frames>1?20:50))return null;
   return {state:frames>1?'completed':'browsing',waitMs:3000,quote:'已得'+rewardCoins,rewardCoins,version:mode==='wrong-version'?version:v2};
  }}});
  try{
   h.cfg.immersiveBrowse={...h.cfg.immersiveBrowse,version:v2,allowedRewardCoins:[20,50]};
   const {ctx,opened}=await open(h);const r=await h.rt.stage('task_receipt',ctx);
   if(mode==='ok'){assert.equal(opened.status,'completed',opened.error);assert.equal(r.status,'completed',r.error);assert.equal(r.receipt.quote,'已得50');assert.equal(r.receipt.rewardCoins,50);assert.equal(r.receipt.version,v2);assert.equal(r.review.candidate.sourceRunId,145);assert.deepEqual(calls.slice(0,2),[20,50]);const events=fs.readFileSync(path.join(h.root,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.ok(events.some(e=>e.kind==='learned_destination_confirmed'&&e.rewardCoins===50));assert.ok(events.some(e=>e.kind==='learned_receipt'&&e.rewardCoins===50));}
   else assert.notEqual(r.status,'completed',mode);
   assert.equal(h.queries,0);assert.equal(h.continuousChecks,0);
  }finally{h.close();}
 }
});
test('immersive v2 config requires a unique nonempty subset of captured amounts',()=>{
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'p',assetId:'coins',model:{baseUrl:'http://offline',name:'offline'},constraints:['no pay'],limits:{maxTasks:1,sessionMs:1000,stageMs:1000,agentCalls:5,stageActions:3,inventoryPages:3,maxReturns:3},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(s=>[s,{goal:s,checkpoint:s}])),immersiveBrowse:{enabled:true,version:v2,sourceRunId:145,task:{name:'好物沉浸看',instruction:'浏览'},observationBudgetMs:20000,allowedRewardCoins:[20,50]}};
 assert.equal(validateStagedConfig(cfg),cfg);
 for(const allowedRewardCoins of [undefined,null,[],[20,20],[500],['20'],[20,50,20]])assert.throws(()=>validateStagedConfig({...cfg,immersiveBrowse:{...cfg.immersiveBrowse,allowedRewardCoins}}),/immersive browse/i);
});

const version='immersive-browse-candidate-v1';
const task={name:'好物沉浸看',instruction:'浏览',done:0,total:2};
function harness(options:any={}){
 const root=fs.mkdtempSync(path.join('/Users/mater/.hermes/cache/scratch','immersive-runtime-'));
 const cfg:any={package:'p',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},
  immersiveBrowse:{enabled:true,version,sourceRunId:145,task:{name:task.name,instruction:task.instruction},observationBudgetMs:20000},scriptValidationMode:true,
  limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:12,maxReturns:3},
  stages:Object.fromEntries(['open_list','open_task','task_receipt','return_list'].map(s=>[s,{goal:s,checkpoint:s==='open_task'?'destination':s==='task_receipt'?'receipt':'list',...(s==='task_receipt'?{continuousScroll:{maxMs:18000,maxSwipes:16},revalidateBeforeScroll:true}:{})}]))};
 Object.assign(cfg,options.cfg??{});
 let page='panel',serial=0,queries=0,elapsed=0,continuous=0,continuousChecks=0,current:any=null;
 const actions:any[]=[],order:string[]=[],checks=new Map<string,number>();
 const device={capture:async()=>{
  current={id:'capture-'+(++serial),path:page+'.png',width:1080,height:2400,capturedAt:Date.now(),package:options.foreignPackage&&page!=='panel'?'other':'p',userId:options.foreign&&page!=='panel'?10:0,
   lines:page==='panel'?[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1550',bounds:[90,240,210,300]},
    {text:task.name+'（0/2）',bounds:[230,900,650,950]},{text:task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]},
    ...(options.duplicate?[{text:task.name+'（0/2）',bounds:[230,1300,650,1350]},{text:task.instruction,bounds:[230,1370,600,1410]},{text:'去完成',bounds:[880,1320,1000,1360]}]:[])]:options.blocked?[{text:'请完成验证',bounds:[100,100,500,200]}]:[]};
  order.push('capture:'+current.id);return current;
 },act:async(action:any,f?:any)=>{
  if(f)assert.equal(f.id,current?.id,'dispatch must use latest capture');
  order.push('act:'+action.type);actions.push({...action,page});current=null;
  if(action.type==='tap'){page='destination';if(options.entryUnknown)throw Error('entry dispatch unknown');}
  if(action.type==='wait'&&page==='destination'&&action.ms>1000){elapsed+=action.ms;if(options.waitUnknown)throw Error('wait dispatch unknown');}
 },scrollContinuously:async()=>{continuous++;throw Error('immersive must not scroll');}};
 const opts:any={sessionId:'offline-immersive',evidenceDir:root,plan:[{name:task.name,instruction:task.instruction,decision:'do',times:1}],
  inspectLearnedBrowse:async()=>{continuousChecks++;return {state:'completed',quote:'unrelated continuous receipt',version:'continuous-test'};},
  inspectDwellBrowse:async()=>{throw Error('dwell must not inspect immersive task');},
  inspectImmersiveBrowse:async(f:any,owner:any)=>{
   assert.deepEqual(owner,{package:'p',userId:0});order.push('inspect:'+f.id);checks.set(f.id,(checks.get(f.id)??0)+1);
   if(options.inspectionError)throw Error('decode failed');
   if(options.unknown)return null;
   return elapsed>=(options.completeAfter??10000)?{state:'completed',quote:options.quote??'已得20',version}:{state:'browsing',waitMs:options.waitMs??5000,version};
  },...options.opts};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('MODEL CALLED');}},opts);
 return {rt,cfg,root,actions,order,checks,get elapsed(){return elapsed},get queries(){return queries},get continuous(){return continuous},get continuousChecks(){return continuousChecks},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function open(h:ReturnType<typeof harness>){
 const selected=await h.rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);
 const ctx={taskAttemptId:'attempt-immersive',task:selected.task};
 const opened=await h.rt.stage('open_task',ctx);return {ctx,opened};
}

test('immersive observation budget persists across stages and never grants elapsed-time completion',async()=>{
 for(const options of [
  {waitMs:9000,expected:[5000,5000,5000,5000]},
  {waitMs:3000,expected:[3000,3000,3000,3000,3000,3000,2000]},
  {waitMs:500,expected:Array(8).fill(500)},
 ]){
  const h=harness({...options,completeAfter:Infinity});try{
   const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
   const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'stopped');assert.equal(r.receipt,undefined);
   assert.deepEqual(r.actions.map((a:any)=>a.proposal.action.ms),options.expected);assert.match(r.error,/Dwell wait budget/);
   const prior=h.actions.length;await h.rt.stage('task_receipt',ctx);assert.equal(h.actions.length,prior);
   assert.equal(h.continuous,0);assert.equal(h.continuousChecks,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('matched immersive null or inspection error stops locally without continuous fallback',async()=>{
 for(const options of [{unknown:true},{inspectionError:true},{unknown:true,cfg:{scriptValidationMode:false}}]){
  const h=harness(options);try{
   const {ctx,opened}=await open(h);assert.equal(opened.status,'stopped');
   await h.rt.stage('task_receipt',ctx);
   assert.equal(h.actions.filter(a=>a.type==='tap').length,1);
   assert.equal(h.actions.filter(a=>a.type==='wait'&&a.ms>1000).length,0);
   assert.ok(h.checks.size>0);assert.equal(h.continuousChecks,0);assert.equal(h.continuous,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('immersive entry and wait unknown outcomes cannot be dispatched again',async()=>{
 for(const options of [{entryUnknown:true},{waitUnknown:true}]){
  const h=harness({...options,completeAfter:Infinity});try{
   const {ctx,opened}=await open(h);
   const r=await h.rt.stage('task_receipt',ctx);assert.equal(options.entryUnknown?opened.status:r.status,'unknown');
   const prior=h.actions.length;await h.rt.stage('open_task',ctx);await h.rt.stage('task_receipt',ctx);
   assert.equal(h.actions.length,prior);assert.equal(h.actions.filter(a=>a.type==='tap').length,1);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('immersive blocks foreign frames, blocked pages and a different attempt',async()=>{
 for(const options of [{foreign:true},{foreignPackage:true},{blocked:true}]){
  const h=harness(options);try{
   const {ctx,opened}=await open(h);assert.notEqual(opened.status,'completed');
   await h.rt.stage('task_receipt',ctx);assert.equal(h.checks.size,0);
   assert.equal(h.actions.filter(a=>a.type==='wait'&&a.ms>1000).length,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
 const h=harness();try{
  const {ctx}=await open(h);const r=await h.rt.stage('task_receipt',{...ctx,taskAttemptId:'old-attempt'});
  assert.notEqual(r.status,'completed');assert.equal(r.actions.length,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('immersive requires exact unique task ownership and preserves continuous for unmatched tasks',async()=>{
 for(const mutate of [(c:any)=>c.immersiveBrowse.task.name+='别的任务',(c:any)=>c.immersiveBrowse.task.instruction='浏览5秒',(c:any)=>c.immersiveBrowse.enabled=false]){
  const h=harness();try{
   mutate(h.cfg);const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
   const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed');assert.equal(r.receipt.quote,'unrelated continuous receipt');
   assert.equal(h.checks.size,0);assert.ok(h.continuousChecks>0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
 for(const options of [{duplicate:true},{cfg:{dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[{task:{name:task.name,instruction:task.instruction},dwellMs:5000}]}}}]){
  const h=harness(options);try{
   const {ctx,opened}=await open(h);assert.notEqual(opened.status,'completed');await h.rt.stage('task_receipt',ctx);
   assert.equal(h.checks.size,0);assert.equal(h.continuousChecks,0);assert.equal(h.continuous,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('immersive immediate receipt needs a nonempty quote and no observation wait',async()=>{
 const h=harness({completeAfter:0});try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
  const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed');assert.equal(r.receipt.quote,'已得20');assert.equal(r.actions.length,0);assert.equal(h.queries,0);
 }finally{h.close();}
 for(const options of [{quote:' '},{opts:{inspectImmersiveBrowse:async()=>({state:'completed',quote:'已得20',version:'foreign-version'})}}]){
  const h=harness({...options,completeAfter:0});try{
   const {ctx}=await open(h);const r=await h.rt.stage('task_receipt',ctx);assert.notEqual(r.status,'completed');assert.equal(r.receipt,undefined);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('immersive waits respect stage remaining time and configured observation budget',async()=>{
 for(const budget of [-1,NaN,Infinity,999,20001]){
  const h=harness();try{
   h.cfg.immersiveBrowse.observationBudgetMs=budget;const {ctx}=await open(h);const r=await h.rt.stage('task_receipt',ctx);
   assert.notEqual(r.status,'completed');assert.equal(r.actions.length,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
 const h=harness();try{
  const {ctx}=await open(h);h.cfg.limits.stageMs=4000;const r=await h.rt.stage('task_receipt',ctx);
  assert.equal(r.status,'stopped');assert.equal(r.actions.length,0);assert.equal(h.queries,0);
 }finally{h.close();}
}
);

test('immersive candidate uses exact entry, fresh wait slices and real receipt with source 145',async()=>{
 const h=harness();try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed',r.error);
  assert.deepEqual(r.actions.map((a:any)=>a.proposal.action),[{type:'wait',ms:5000},{type:'wait',ms:5000}]);
  assert.equal(r.receipt.quote,'已得20');assert.equal(r.receipt.taskAttemptId,ctx.taskAttemptId);assert.equal(r.receipt.version,version);
  assert.equal(r.usedScriptVersion,version);assert.equal(r.review.candidate.version,version);assert.equal(r.review.candidate.sourceRunId,145);
  assert.ok([...h.checks.values()].every(n=>n===1),'check/script share one per-frame inspection');
  for(const a of r.actions){const i=h.order.indexOf('inspect:'+a.proposal.frameId);assert.ok(i>=0);assert.equal(h.order[i+1],'act:wait');assert.match(h.order[i+2],/^capture:/);}
  const records=fs.readFileSync(path.join(h.root,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
  const provenance=records.filter(x=>['explicit_candidate_authorized','learned_receipt'].includes(x.kind));
  assert.ok(provenance.length>=3);assert.ok(provenance.every(x=>x.version===version&&x.sourceRunId===145));
  assert.equal(h.continuous,0);assert.equal(h.continuousChecks,0);assert.equal(h.queries,0);assert.equal(h.rt.calls,0);
 }finally{h.close();}
});
