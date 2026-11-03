import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
import {readPanel} from '../runner/staged/observations.ts';

const version='continuous-browse-candidate-v1';
const directory=new URL('../evidence/continuous-supervised-2026-11-01T05-18-43-216Z/',import.meta.url);
const fixture=(id:string,dir=directory)=>{
 const frame=JSON.parse(fs.readFileSync(new URL(id+'.json',dir),'utf8'));
 frame.path=new URL(id+'.png',dir).pathname;
 assert.ok(fs.existsSync(frame.path),'Original replay PNG must exist');return frame;
};
const originals={
 panel:fixture('9caa6d17-0375-4f3d-9a27-272bf7090f2f'),
 browsing:fixture('bfbc7cc8-510d-4133-82f7-1a432fa97af7'),
 completed:fixture('17cbd398-0659-40fc-90d7-79d3ee3c188f'),
 returned:fixture('68f914e4-8a4d-4763-98eb-62c3fa3ae19f'),
 unknown:fixture('d600b43c-956a-4cd8-a32a-f682968ebe3d',new URL('../evidence/staged-2026-11-01T05-11-55-681Z/',import.meta.url)),
 run155:fixture('d65dc20f-fa2d-44eb-9280-09f46eda12e0',new URL('../evidence/staged-2026-11-01T06-31-13-908Z/',import.meta.url)),
};
// Only frame ids/timestamps are replay metadata. Original PNG/OCR are unchanged.
function harness(options:any={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR??'/Users/mater/.hermes/cache/scratch','learned-runtime-'));
 const cfg:any={package:originals.panel.package,scope:{appId:'a',accountId:'b',activityId:'c',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
  learnedBrowse:{enabled:true,version,sourceRunId:153},limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:4,maxReturns:3},
  stages:Object.fromEntries(['enter_activity','open_list','open_task','task_receipt','return_list'].map(stage=>[stage,{goal:stage,checkpoint:stage==='open_task'?'destination':stage==='task_receipt'?'receipt':'list',...(stage==='task_receipt'?{continuousScroll:{maxMs:18000,maxSwipes:16},revalidateBeforeScroll:true}:{})}]))};
 Object.assign(cfg,options.cfg??{});
 let page='panel',current:any=null,serial=0,queries=0,bursts=0,backs=0;const actions:any[]=[],inspected:string[]=[];
 const device={capture:async()=>{
  let source=page==='panel'?originals.panel:page==='returned'?originals.returned:page==='completed'?originals.completed:page==='unknown'?originals.unknown:options.destination??originals.browsing;
  if(options.capture)source=options.capture(page,source);
  current={...structuredClone(source),id:'replay-'+(++serial),capturedAt:Date.now()};return current;
 },act:async(action:any,frame?:any)=>{
  if(frame)assert.equal(frame.id,current?.id,'Device authority must bind the current unconsumed capture');
  actions.push({action,frameId:frame?.id});current=null;
  if(action.type==='tap'){assert.equal(page,'panel');page=options.entryCompleted?'completed':'browsing';if(options.entryUnknown){page='unknown';throw Error('entry dispatch unknown');}}
  if(action.type==='back'){backs++;page='returning';}
  if(action.type==='wait'&&page==='returning'){assert.ok(action.ms>0&&action.ms<=1000);page='returned';}
 },scrollContinuously:async(action:any,frame:any,limits:any)=>{
  assert.equal(frame.id,current?.id);assert.equal(action.type,'swipe');assert.equal(limits.maxSwipes,options.expectedSwipes??16);
  actions.push({action,frameId:frame.id,continuous:true});current=null;bursts++;
  page=options.afterScroll??'completed';if(options.scrollUnknown)throw Error('scroll dispatch unknown');
 }};
 const model={query:async()=>{queries++;throw Error('MODEL BOUNDARY MUST NOT BE USED');}};
 const opts:any={sessionId:'offline',evidenceDir:root,plan:[{name:'看看#精致面霜',instruction:'浏览',decision:'do',times:1}],...options.opts};
 const rt=createStagedRuntime(cfg,device,model,opts);
 return {rt,cfg,root,actions,inspected,get queries(){return queries},get bursts(){return bursts},get backs(){return backs},setPage:(p:string)=>{page=p},close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
async function selectAndOpen(h:ReturnType<typeof harness>,attempt='attempt-1'){
 const selected=await h.rt.stage('select_task',{});assert.equal(selected.status,'completed');
 const ctx={taskAttemptId:attempt,task:selected.task};
 const opened=await h.rt.stage('open_task',ctx);return {ctx,opened};
}

test('25 second configuration requires its exact bounded segment',()=>{
 const c=JSON.parse(fs.readFileSync('data/evidence/plans/stable-scripts-20261101/featured-current-config.json','utf8'));
 c.learnedBrowse.contract={rewardCoins:50,requiredMs:25000};c.stages.task_receipt.continuousScroll={maxSwipes:30,maxMs:35000,requiredMs:25000};assert.equal(validateStagedConfig(c),c);
 for(const contract of [{rewardCoins:20,requiredMs:25000},{rewardCoins:50,requiredMs:26000}])assert.throws(()=>validateStagedConfig({...c,learnedBrowse:{...c.learnedBrowse,contract}}),/continuous|contract/i);
 assert.throws(()=>validateStagedConfig({...c,stages:{...c.stages,task_receipt:{...c.stages.task_receipt,continuousScroll:{maxSwipes:16,maxMs:18000}}}}),/continuous|contract/i);
});

test('explicit 25 second contract passes the same options through entry inspection and swipe revalidation',async()=>{
 const seen:any[]=[];const options={rewardCoins:50,requiredMs:25000};
 const h=harness({expectedSwipes:30,opts:{inspectLearnedBrowse:async(f:any,_o:any,opts:any)=>{
  seen.push(opts);if(JSON.stringify(opts)!==JSON.stringify(options))return null;
  return f.path===originals.completed.path?{state:'completed',quote:'已得50',version:'learned-browse-187-25-v1',...opts}:{state:'browsing',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:1000,ms:900},version:'learned-browse-187-25-v1',...opts};
 },revalidateLearnedBrowse:async(_old:any,_fresh:any,action:any,_owner:any,opts:any)=>JSON.stringify(opts)===JSON.stringify(options)?{action,reason:'explicit25'}:null}});
 h.cfg.learnedBrowse.contract=options;h.cfg.stages.task_receipt.continuousScroll={maxSwipes:30,maxMs:35000,requiredMs:25000};
 try{const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed',opened.error);const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed',r.error);assert.equal(h.bursts,1);assert.equal(h.queries,0);assert.ok(seen.every(x=>x.requiredMs===25000));}finally{h.close();}
});

test('injected inspection exercises real engine without depending on module development',async()=>{
 const seen=new Map<string,number>();
 const h=harness({opts:{inspectLearnedBrowse:async(f:any)=>{
  seen.set(f.id,(seen.get(f.id)??0)+1);
  return f.path===originals.completed.path?{state:'completed',quote:originals.completed.lines.find((l:any)=>l.text.includes('已得币50')).text,version:'injected-contract'}:{state:'browsing',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:1000,ms:900},version:'injected-contract'};
 },revalidateLearnedBrowse:async(_old:any,fresh:any,action:any)=>({action:{...action,fromX:530,toX:530},reason:'fresh injected contract'})}});
 try{const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed',opened.error);
  const receipt=await h.rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);
  assert.equal(h.bursts,1);assert.equal(h.queries,0);assert.equal(receipt.actions[0].proposal.action.fromX,530);
  assert.ok([...seen.values()].every(n=>n===1),'check/script share one per-frame inspection');
 }finally{h.close();}
});

test('inspection errors hand the current destination to model recovery without scrolling',async()=>{
 const h=harness({opts:{inspectLearnedBrowse:async()=>{throw Error('local decode failed');}}});
 try{const {opened}=await selectAndOpen(h);assert.equal(opened.status,'unknown');assert.match(opened.error,/MODEL BOUNDARY/);assert.equal(h.queries,1);assert.equal(h.bursts,0);}finally{h.close();}
});

test('candidate settlement rejects another attempt and wrong owning account',async()=>{
 const injected={inspectLearnedBrowse:async(f:any)=>f.path===originals.completed.path?{state:'completed',quote:'已得币50',version:'test'}:{state:'browsing',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:1000,ms:900},version:'test'},revalidateLearnedBrowse:async(_a:any,_b:any,action:any)=>({action,reason:'test'})};
 const h=harness({opts:injected,capture:(page:string,f:any)=>page==='returned'?{...f,userId:10}:f});
 try{const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed');assert.equal((await h.rt.stage('task_receipt',ctx)).status,'completed');
  h.setPage('returned');const other=await h.rt.stage('settle',{...ctx,taskAttemptId:'other-attempt'});assert.equal(other.status,'stopped');
  const wrongOwner=await h.rt.stage('settle',ctx);assert.notEqual(wrongOwner.status,'completed');
 }finally{h.close();}
});

test('revalidation must leave the full continuous gesture budget after local inspection',async()=>{
 const h=harness({opts:{inspectLearnedBrowse:async()=>({state:'browsing',version:'test',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:1000,ms:900}}),revalidateLearnedBrowse:async(_a:any,_b:any,action:any)=>{await new Promise(resolve=>setTimeout(resolve,900));return {action,reason:'slow revalidation'};}}});
 h.cfg.limits.stageMs=26700;
 try{const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed');const result=await h.rt.stage('task_receipt',ctx);
  assert.equal(h.bursts,0);assert.equal(result.status,'stopped');assert.match(result.error,/revalidation stopped/);
 }finally{h.close();}
});

const injectedContract={
 inspectLearnedBrowse:async(f:any)=>f.path===originals.completed.path?{state:'completed',quote:originals.completed.lines.find((l:any)=>l.text.includes('已得币50')).text,version:'offline-injected-contract'}:
  f.path===originals.browsing.path?{state:'browsing',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:1000,ms:900},version:'offline-injected-contract'}:null,
 revalidateLearnedBrowse:async(old:any,fresh:any,action:any,owner:any)=>fresh.id!==old.id&&fresh.path===old.path&&fresh.package===owner.package&&fresh.userId===owner.userId?{action,reason:'Injected offline current-frame contract'}:null,
};

test('real engine/runtime execute injected learned candidate entry, swipe, receipt, return and settlement with zero model calls',async()=>{
 const h=harness({opts:injectedContract});try{
  for(const stage of ['enter_activity','open_list'])assert.equal((await h.rt.stage(stage,{})).status,'completed');
  const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed',opened.error);
  assert.equal(opened.actions.length,1);assert.equal(opened.actions[0].source,'script');
  const result=await h.rt.stage('task_receipt',ctx);
  assert.equal(result.status,'completed',result.error);assert.equal(h.bursts,1);
  assert.equal(result.actions.length,1);assert.equal(result.actions[0].source,'script');
  assert.equal(result.usedScriptVersion,version);assert.match(result.receipt.quote,/已得.*50/);
  assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);
  assert.equal(result.events.filter((e:any)=>e.type==='before_dispatch_revalidated').length,1);
  const returned=await h.rt.stage('return_list',ctx);assert.equal(returned.status,'completed',returned.error);assert.equal(h.backs,1);
  const back=h.actions.findIndex(a=>a.action.type==='back');assert.equal(h.actions[back+1].action.type,'wait');
  assert.ok(h.actions[back+1].action.ms<=1000);
  const settlement=await h.rt.stage('settle',ctx);assert.equal(settlement.status,'completed',settlement.error);assert.equal(settlement.balanceAfter,1650);
  const review=await h.rt.stage('review_task',ctx);assert.equal(review.status,'completed');
  assert.equal(result.review.candidate.state,'candidate');assert.equal(result.review.candidate.version,version);
  assert.deepEqual(result.review.orderedSteps.map((s:any)=>s.action),result.actions.map((a:any)=>a.proposal.action));
  assert.equal(review.review.stages.find((s:any)=>s.stageId==='task_receipt').status,'completed');
  assert.equal(h.queries,0);assert.equal(h.rt.calls,0);
  assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
  assert.equal(h.actions.filter(a=>a.action.type==='swipe').length,1);
  assert.equal(readPanel(originals.returned).balance,1650);
 }finally{h.close();}
});

test('real 187 initial requirement integrates with engine/runtime and reuses only historical completed50 component',async()=>{
 const destination=fixture('3b776de9-f796-4337-875e-f1aec45bfb17',new URL('../evidence/staged-2026-11-01T11-01-03-757Z/',import.meta.url));
 const h=harness({destination,expectedSwipes:30});
 h.cfg.learnedBrowse.contract={rewardCoins:50,requiredMs:25000};h.cfg.stages.task_receipt.continuousScroll={maxSwipes:30,maxMs:35000,requiredMs:25000};
 try{
  const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed',opened.error);
  const r=await h.rt.stage('task_receipt',ctx);assert.equal(r.status,'completed',r.error);assert.equal(h.bursts,1);assert.equal(h.queries,0);assert.match(r.receipt.quote,/已得.*50/);
  // Original187 browsing plus original153 receipt is a cross-run offline replay, never a live187 completion.
 }finally{h.close();}
});

test('actual learned module integrates with real engine/runtime using original 153 and 155 screenshots',async()=>{
 for(const destination of [originals.browsing,originals.run155]){
  const h=harness({destination});try{
   const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed',opened.error);
   const receipt=await h.rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);
   assert.equal(h.bursts,1);assert.match(receipt.receipt.quote,/已得.*50/);
   assert.equal((await h.rt.stage('return_list',ctx)).status,'completed');
   assert.equal((await h.rt.stage('settle',ctx)).status,'completed');
   assert.equal(h.queries,0);
  }finally{h.close();}
 }
});

test('entry completed receipt is captured without a second browse round',async()=>{
 const h=harness({opts:injectedContract,entryCompleted:true});try{
  const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'completed');
  const result=await h.rt.stage('task_receipt',ctx);assert.equal(result.status,'completed');assert.equal(result.actions.length,0);
  assert.equal(result.receipt.taskAttemptId,ctx.taskAttemptId);assert.equal(h.bursts,0);assert.equal(h.queries,0);
 }finally{h.close();}
});

test('unknown entry dispatch is not replayed or granted local destination authority',async()=>{
 const h=harness({opts:injectedContract,entryUnknown:true});try{
  const {ctx,opened}=await selectAndOpen(h);assert.equal(opened.status,'unknown');assert.equal(opened.actions.length,1);
  await h.rt.stage('open_task',ctx);await h.rt.stage('task_receipt',ctx);
  assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);assert.equal(h.bursts,0);
 }finally{h.close();}
});

test('unknown continuous dispatch and unchanged browsing never start another gesture round',async()=>{
 for(const options of [{afterScroll:'browsing'},{afterScroll:'browsing',scrollUnknown:true}]){
  const h=harness({...options,opts:injectedContract});try{
   const {ctx}=await selectAndOpen(h);const result=await h.rt.stage('task_receipt',ctx);assert.notEqual(result.status,'completed');
   await h.rt.stage('task_receipt',ctx);assert.equal(h.bursts,1);assert.equal(result.receipt,undefined);
  }finally{h.close();}
 }
});

test('foreign scope and unknown destination frames cannot obtain candidate swipes',async()=>{
 for(const options of [{destination:originals.unknown},{capture:(page:string,f:any)=>page==='browsing'?{...f,userId:10}:f}]){
  const h=harness({...options,opts:injectedContract});try{
   const {ctx,opened}=await selectAndOpen(h);assert.notEqual(opened.status,'completed');
   await h.rt.stage('task_receipt',ctx);assert.equal(h.bursts,0);
  }finally{h.close();}
 }
});
