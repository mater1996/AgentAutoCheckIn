import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';

const version='dwell-browse-candidate-v1';
const task={name:'本地浏览任务',instruction:'浏览5秒',done:0,total:2};
function harness(options:any={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'dwell-runtime-'));
 const contract={task:{name:task.name,instruction:task.instruction},dwellMs:options.dwellMs??5000,version:'injected-dwell-contract'};
 const cfg:any={package:'p',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},dwellBrowse:{version,contracts:[contract]},scriptValidationMode:true,
  limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:10,maxReturns:3},
  stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(s=>[s,{goal:s,checkpoint:s==='open_task'?'destination':s==='task_receipt'?'receipt':'list',...(s==='task_receipt'?{continuousScroll:{maxMs:18000,maxSwipes:16},revalidateBeforeScroll:true}:{})}]))};
 Object.assign(cfg,options.cfg??{});
 let page='panel',serial=0,queries=0,elapsed=0,continuous=0,current:any=null;
 const actions:any[]=[],order:string[]=[],checks=new Map<string,number>();
 const device={capture:async()=>{
  current={id:'capture-'+(++serial),path:page+'.png',width:1080,height:2400,capturedAt:Date.now(),package:'p',userId:options.foreign&&page!=='panel'?10:0,
   lines:page==='panel'?[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1550',bounds:[90,240,210,300]},
    {text:task.name+`（${options.done??0}/2）`,bounds:[230,900,650,950]},{text:task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]}]:options.blocked?[{text:'请完成验证',bounds:[100,100,500,200]}]:[]};
  order.push('capture:'+current.id);return current;
 },act:async(action:any,f?:any)=>{
  if(f)assert.equal(f.id,current?.id,'dispatch must use latest capture');
  order.push('act:'+action.type);actions.push({...action,page});current=null;
  if(action.type==='tap'){page='destination';if(options.entryUnknown)throw Error('entry dispatch unknown');}
  if(action.type==='wait'&&page==='destination'){
   // The engine also performs a <=1000ms settling wait after tapping.
   if(action.ms>1000){elapsed+=action.ms;if(options.waitUnknown)throw Error('wait dispatch unknown');}
  }
 },scrollContinuously:async()=>{continuous++;throw Error('dwell must not scroll');}};
 const opts:any={sessionId:'offline-dwell',evidenceDir:root,plan:[{name:task.name,instruction:task.instruction,decision:'do',times:1}],
  inspectLearnedBrowse:async()=>{throw Error('continuous inspector must not inspect dwell contract');},
  inspectDwellBrowse:async(f:any,owner:any,c:any)=>{
   assert.deepEqual(owner,{package:'p',userId:0});assert.equal(c,contract);order.push('inspect:'+f.id);checks.set(f.id,(checks.get(f.id)??0)+1);
   if(options.unknown)return null;
   return elapsed>=(options.completeAfter??10000)?{state:'completed',quote:'本次任务已完成',version:c.version}:{state:'browsing',waitMs:options.waitMs??5000,version:c.version};
  },...options.opts};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('MODEL CALLED');}},opts);
 return {rt,cfg,opts,root,contract,actions,order,checks,get elapsed(){return elapsed},get queries(){return queries},get continuous(){return continuous},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function open(h:ReturnType<typeof harness>){
 const selected=await h.rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);
 const ctx={taskAttemptId:'attempt-dwell',task:selected.task};
 const opened=await h.rt.stage('open_task',ctx);return {ctx,opened};
}

test('development dwell follows current browsing beyond old duration and slice caps until receipt',async()=>{
 const h=harness({completeAfter:35000,waitMs:2500,cfg:{executionPolicy:'development-unbounded-v1',limits:{stageMs:null,sessionMs:null,stageActions:null,agentCalls:null,maxReturns:null}}});try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'completed',result.error);assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);
  assert.equal(result.actions.length,14);assert.equal(h.elapsed,35000);assert.equal(h.actions.filter(a=>a.type==='tap').length,1);assert.equal(h.continuous,0);
 }finally{h.close();}
});

test('candidate audit records the dwell version and validated wait accounting',async()=>{
 const h=harness();try{
  const {ctx}=await open(h);await h.rt.stage('task_receipt',ctx);
  const records=fs.readFileSync(path.join(h.root,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
  assert.ok(records.filter(r=>r.kind==='explicit_candidate_authorized').every(r=>r.version===version));
  assert.deepEqual(records.filter(r=>r.kind==='dwell_wait_slice').map(r=>({ms:r.ms,total:r.totalMs,limit:r.limitMs})),[{ms:5000,total:5000,limit:10000},{ms:5000,total:10000,limit:10000}]);
 }finally{h.close();}
});

test('invalid dwell duration cannot grant wait authority',async()=>{
 for(const dwellMs of [-1,NaN,Infinity]){
  const h=harness({dwellMs,completeAfter:Infinity});try{
   const {ctx}=await open(h);const r=await h.rt.stage('task_receipt',ctx);
   assert.notEqual(r.status,'completed');assert.equal(r.actions.length,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('only a unique exact dwell task contract obtains wait authority',async()=>{
 for(const mutate of [(h:any)=>h.cfg.dwellBrowse.contracts.push(h.contract),(h:any)=>h.cfg.dwellBrowse.contracts[0]={...h.contract,task:{...h.contract.task,instruction:'other requirement'}}]){
  const h=harness();try{
   mutate(h);const {opened}=await open(h);assert.notEqual(opened.status,'completed');assert.equal(h.queries,0);
   assert.equal(h.actions.filter(a=>a.type==='wait'&&a.ms>1000).length,0);assert.equal(h.checks.size,0);
  }finally{h.close();}
 }
});

test('a task without an exact dwell contract still uses the continuous local inspector',async()=>{
 let inspected=0;
 const h=harness({opts:{inspectLearnedBrowse:async()=>{inspected++;return {state:'completed',quote:'continuous receipt',version:'continuous-test'};}}});try{
  h.cfg.dwellBrowse.contracts[0]={...h.contract,task:{...h.contract.task,instruction:'other requirement'}};
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
  const receipt=await h.rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed');assert.equal(receipt.receipt.quote,'continuous receipt');
  assert.ok(inspected>0);assert.equal(h.checks.size,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('strict unrecognized entry navigation fails locally with an auditable stage status',async()=>{
 const h=harness();try{
  const result=await h.rt.stage('open_list',{});assert.equal(result.status,'completed');
  // No recipe or local evidence for an unknown navigation stage.
  h.cfg.stages.unknown_navigation={goal:'unknown',checkpoint:'unknown'};
  const failed=await h.rt.stage('unknown_navigation',{});assert.equal(failed.status,'stopped');
  assert.match(failed.error,/Script validation requires local evidence/);assert.equal(failed.review.status,'stopped');
  assert.ok(failed.events.some((e:any)=>e.type==='stage_finished'&&e.status==='stopped'));assert.equal(h.queries,0);
 }finally{h.close();}
});

test('strict validation stops unmatched local evidence before any model call and retains local review',async()=>{
 for(const options of [{unknown:true},{opts:{inspectDwellBrowse:async()=>{throw Error('decode failed');}}},{cfg:{learnedBrowse:undefined}}]){
  const h=harness(options);try{
   const {opened}=await open(h);assert.notEqual(opened.status,'completed');
   assert.match(opened.error,/Script validation requires local evidence; model fallback disabled/);
   assert.equal(h.queries,0);assert.equal(h.rt.calls,0);assert.equal(opened.review.status,opened.status);
   assert.equal(opened.review.candidate.state,'candidate');
  }finally{h.close();}
 }
});

test('strict selection can revalidate completed history only with exact do plan and remaining current quota',async()=>{
 const h=harness({opts:{completed:[task.name]}});try{
  assert.equal((await h.rt.stage('select_task',{})).status,'completed');assert.equal(h.queries,0);
 }finally{h.close();}
 for(const options of [{cfg:{scriptValidationMode:false}},{done:2},{opts:{plan:[{name:task.name,instruction:'different',decision:'do'}]}},{opts:{plan:[{name:task.name,instruction:task.instruction,decision:'skip'}]}}]){
  const h=harness({...options,opts:{completed:[task.name],...options.opts}});try{
   assert.notEqual((await h.rt.stage('select_task',{})).status,'completed');assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('strict dynamic selection rejects model fallback before calling it',async()=>{
 const h=harness({cfg:{selectionAllowNew:true},opts:{plan:[]}});try{
  await assert.rejects(()=>h.rt.stage('select_task',{}),/Script validation requires local evidence; model fallback disabled/);
  assert.equal(h.queries,0);assert.equal(h.rt.calls,0);
 }finally{h.close();}
});

test('dwell wait time and slice limits persist across repeated task_receipt stages without inventing completion',async()=>{
 for(const options of [{dwellMs:500,waitMs:9000,expected:[5000,500]},{dwellMs:60000,waitMs:2500,expected:[2500,2500,2500,2500]}]){
  const h=harness({...options,completeAfter:Infinity});try{
   const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
   const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'stopped');assert.equal(result.receipt,undefined);
   assert.match(result.error,/Dwell wait budget/);assert.deepEqual(result.actions.map((a:any)=>a.proposal.action.ms),options.expected);
   const prior=h.actions.length;await h.rt.stage('task_receipt',ctx);assert.equal(h.actions.length,prior);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('unknown dwell wait dispatch is not replayed on reentry',async()=>{
 const h=harness({waitUnknown:true,completeAfter:Infinity});try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed');
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'unknown');assert.equal(result.actions[0].status,'unknown');
  const prior=h.actions.length;assert.notEqual((await h.rt.stage('task_receipt',ctx)).status,'completed');assert.equal(h.actions.length,prior);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('unknown entry, foreign owner, blocked page and another attempt cannot authorize dwell wait',async()=>{
 for(const options of [{entryUnknown:true},{foreign:true},{blocked:true}]){
  const h=harness(options);try{
   const {ctx,opened}=await open(h);assert.notEqual(opened.status,'completed');
   await h.rt.stage('open_task',ctx);await h.rt.stage('task_receipt',ctx);
   assert.equal(h.actions.filter(a=>a.type==='tap').length,1);assert.equal(h.actions.filter(a=>a.page==='destination'&&a.type==='wait'&&a.ms>1000).length,0);assert.equal(h.queries,0);
  }finally{h.close();}
 }
 const h=harness();try{
  const {ctx}=await open(h);assert.notEqual((await h.rt.stage('task_receipt',{...ctx,taskAttemptId:'other-attempt'})).status,'completed');
  assert.equal(h.actions.filter(a=>a.type==='wait'&&a.ms>1000).length,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('dwell receipt can complete immediately without any task wait',async()=>{
 const h=harness({completeAfter:0});try{
  const {ctx}=await open(h);const result=await h.rt.stage('task_receipt',ctx);
  assert.equal(result.status,'completed');assert.equal(result.actions.length,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('dwell wait respects the remaining stage time budget',async()=>{
 const h=harness();try{
  const {ctx}=await open(h);h.cfg.limits.stageMs=4000;
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'stopped');assert.equal(result.actions.length,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('dwell contract executes fresh checked wait slices and real receipt with zero model calls',async()=>{
 const h=harness();try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'completed',result.error);
  assert.deepEqual(result.actions.map((a:any)=>a.proposal.action),[{type:'wait',ms:5000},{type:'wait',ms:5000}]);
  assert.ok(result.actions.every((a:any)=>a.source==='script'));
  assert.equal(result.receipt.quote,'本次任务已完成');assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);
  assert.ok([...h.checks.values()].every(n=>n===1),'check and script share one inspection per frame');
  for(const a of result.actions){const i=h.order.indexOf('inspect:'+a.proposal.frameId);assert.ok(i>=0);assert.equal(h.order[i+1],'act:wait');assert.match(h.order[i+2],/^capture:/);}
  assert.equal(result.usedScriptVersion,version);assert.equal(result.review.status,'completed');
  assert.equal(h.continuous,0);assert.equal(h.queries,0);assert.equal(h.rt.calls,0);
 }finally{h.close();}
});
