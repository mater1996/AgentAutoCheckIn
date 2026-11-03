import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const fixture=(dir:string,id:string)=>({...JSON.parse(fs.readFileSync(new URL(`../evidence/${dir}/${id}.json`,import.meta.url),'utf8')),path:new URL(`../evidence/${dir}/${id}.png`,import.meta.url).pathname});
const original='continuous-supervised-2026-11-01T05-18-43-216Z';
const panel=fixture(original,'9caa6d17-0375-4f3d-9a27-272bf7090f2f');
const fifty=fixture(original,'bfbc7cc8-510d-4133-82f7-1a432fa97af7');
const completed=fixture(original,'17cbd398-0659-40fc-90d7-79d3ee3c188f');
const twenty=fixture('staged-2026-11-01T11-30-56-472Z','d974083a-8310-49d9-ac1d-7ccc99bd511c');
const twentyFive=fixture('staged-2026-11-01T11-01-03-757Z','3b776de9-f796-4337-875e-f1aec45bfb17');
const run194='staged-2026-11-01T11-50-22-744Z';
const actual20=fixture(run194,'59931c03-829e-4f50-80d4-4bb575feb82b');
const fresh20=fixture(run194,'010ae3ad-d262-46be-b934-5acc17b13146');
const completed20=fixture(run194,'1c143332-c14b-48b1-97a0-18124fc338d3');
// Original PNG/OCR replay; only ids/timestamps are fresh replay metadata.
function harness(destination:any,options:any={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'continuous-runtime-'));
 const cfg:any={package:panel.package,scope:{appId:'a',accountId:'b',activityId:'c',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,scriptValidationMode:true,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153,autoContract:true},limits:{stageMs:options.stageMs??90000,sessionMs:600000,agentCalls:0,stageActions:4,maxReturns:3},
  stages:{open_task:{goal:'open',checkpoint:'destination'},task_receipt:{goal:'receipt',checkpoint:'receipt',continuousScroll:options.limits??{maxMs:35000,maxSwipes:30,requiredMs:25000}}}};
 Object.assign(cfg,options.cfg??{});
 let page='panel',serial=0,current:any=null,queries=0,bursts=0,taps=0;const limits:any[]=[];
 const device={capture:async()=>{
  let source=page==='panel'?panel:page==='completed'?completed:destination;
  if(options.capture)source=options.capture(page,source,serial);
  current={...structuredClone(source),id:`replay-${++serial}`,capturedAt:Date.now()};return current;
 },act:async(a:any,f:any)=>{if(f)assert.equal(f.id,current?.id);current=null;if(a.type==='tap'){taps++;page='browse';if(options.entryUnknown)throw Error('entry unknown');}},
 scrollContinuously:async(a:any,f:any,l:any)=>{assert.equal(f.id,current?.id);assert.equal(a.type,'swipe');limits.push(l);bursts++;current=null;page=options.afterScroll??'completed';if(options.scrollUnknown)throw Error('scroll unknown');}};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('MODEL MUST NOT RUN');}},{sessionId:'offline',evidenceDir:root,plan:[{name:'看看#精致面霜',instruction:'浏览',decision:'do',times:1}],inspectLearnedBrowse:options.inspect,revalidateLearnedBrowse:options.revalidate});
 return {rt,cfg,limits,get queries(){return queries},get bursts(){return bursts},get taps(){return taps},events:()=>fs.readFileSync(path.join(root,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x)),close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function open(h:ReturnType<typeof harness>){const chosen=await h.rt.stage('select_task',{});assert.equal(chosen.status,'completed');const ctx={task:chosen.task,taskAttemptId:'attempt-1'};return {ctx,opened:await h.rt.stage('open_task',ctx)};}
test('development continuous contract ignores segment and stage ceilings but retains its finite required sequence',async()=>{
 const h=harness(twentyFive,{limits:{maxMs:1,maxSwipes:1},cfg:{executionPolicy:'development-unbounded-v1',limits:{stageMs:null,sessionMs:null,agentCalls:null,stageActions:null,maxReturns:null}}});try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed',r.error);assert.equal(h.bursts,1);
  assert.deepEqual(h.limits,[{maxSwipes:30,maxMs:35000,requiredMs:25000}]);await h.rt.stage('task_receipt',ctx);assert.equal(h.bursts,1);assert.equal(h.taps,1);
 }finally{h.close();}
});
test('real194 original before fresh and completed20 reach runtime receipt under one locked contract',async()=>{
 // Historical original frames exercise orchestration; this is not a new live session.
 const h=harness(actual20,{capture:(page:string,source:any,serial:number)=>page==='completed'?completed20:page==='browse'?(serial===1?actual20:fresh20):source});
 try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'completed',result.error);
  assert.equal(result.receipt.rewardCoins,20);assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);assert.match(result.receipt.quote,/已得.*20/);
  assert.equal(h.bursts,1);assert.deepEqual(h.limits,[{maxSwipes:16,maxMs:18000}]);
  assert.equal(h.events().filter(e=>e.kind==='continuous_contract_selected').length,1);
  assert.equal(h.events().filter(e=>e.kind==='learned_receipt').length,1);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('auto selector binds real 192 landing and refuses a mismatched 50 receipt under the locked 20 contract',async()=>{
 const h=harness(twenty);try{
  const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
  const result=await h.rt.stage('task_receipt',ctx);assert.notEqual(result.status,'completed');assert.equal(result.needsLearning,true);
  assert.equal(h.bursts,1);assert.deepEqual(h.limits,[{maxSwipes:16,maxMs:18000}]);assert.equal(result.receipt,undefined);
  const selected=h.events().filter(e=>e.kind==='continuous_contract_selected');assert.equal(selected.length,1);assert.equal(selected[0].taskAttemptId,ctx.taskAttemptId);assert.ok(selected[0].frameId);assert.deepEqual(selected[0].option,{rewardCoins:20});assert.ok(selected[0].provenance.some((p:any)=>p.sourceRunId===192));
  await h.rt.stage('task_receipt',ctx);assert.equal(h.bursts,1);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('real 187 and 153 replay lock different contracts through fresh revalidation and historical receipt',async()=>{
 for(const [destination,budget] of [[twentyFive,{maxSwipes:30,maxMs:35000,requiredMs:25000}],[fifty,{maxSwipes:16,maxMs:18000}]] as const){
  const h=harness(destination,{inspect:async()=>{throw Error('injected inspection cannot grant auto authority');},revalidate:async()=>{throw Error('injected revalidation cannot grant auto authority');}});
  try{const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);
   const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'completed',result.error);assert.deepEqual(h.limits,[budget]);assert.equal(h.bursts,1);assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);assert.match(result.receipt.quote,/已得.*50/);
   assert.equal(result.events.filter((e:any)=>e.type==='before_dispatch_revalidated').length,1);
   assert.equal(h.events().filter(e=>e.kind==='continuous_contract_selected').length,1);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('selected small budget fits remaining time even with larger configured maximum; selected 25 cannot exceed maximum',async()=>{
 for(const [destination,options,expected] of [[fifty,{stageMs:30000},1],[twentyFive,{limits:{maxSwipes:16,maxMs:18000}},0],[twentyFive,{stageMs:42000},0]] as const){
  const h=harness(destination,options);try{const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);await h.rt.stage('task_receipt',ctx);assert.equal(h.bursts,expected);assert.equal(h.queries,0);}finally{h.close();}
 }
});

test('changed contract or owner during fresh revalidation cannot select again or scroll',async()=>{
 for(const changed of [twenty,fifty,{...twentyFive,userId:999}]){
  let reads=0;const h=harness(twentyFive,{capture:(page:string,source:any)=>page==='browse'&&++reads>=4?changed:source});
  try{const {ctx,opened}=await open(h);assert.equal(opened.status,'completed',opened.error);const r=await h.rt.stage('task_receipt',ctx);assert.notEqual(r.status,'completed');assert.equal(h.bursts,0);assert.equal(h.events().filter(e=>e.kind==='continuous_contract_selected').length,1);assert.equal(h.queries,0);}finally{h.close();}
 }
});

test('another attempt and unknown dispatch never gain a second entry or gesture round',async()=>{
 for(const options of [{entryUnknown:true},{scrollUnknown:true},{afterScroll:'browse'}]){
  const h=harness(fifty,options);try{
   const {ctx}=await open(h);await h.rt.stage('task_receipt',ctx);const count=h.bursts;
   await h.rt.stage('open_task',{...ctx,taskAttemptId:'other'});await h.rt.stage('task_receipt',{...ctx,taskAttemptId:'other'});await h.rt.stage('task_receipt',ctx);
   assert.equal(h.taps,1);assert.equal(h.bursts,count);assert.equal(h.queries,0);
  }finally{h.close();}
 }
});
