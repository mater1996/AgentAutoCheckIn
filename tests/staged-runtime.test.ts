import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const scratch=()=>fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'staged-runtime-'));
test('restricted selection never queries Agent for a newly named candidate',async()=>{
 const root=scratch();const f=JSON.parse(fs.readFileSync(new URL('../evidence/staged-2026-11-01T05-11-55-681Z/b1a55a11-6137-4892-bbf8-0f2abea6858f.json',import.meta.url),'utf8'));let queries=0;
 const rt=createStagedRuntime({selectionAllowNew:false,panelMarker:'赚金币抵钱',limits:{agentCalls:4,stageMs:90000}}, {capture:async()=>f,act:async()=>{}},{query:async()=>{queries++;return {ordinaryBrowse:true,name:'new'};}},{evidenceDir:root,plan:[]});
 try{const r=await rt.stage('select_task',{});assert.equal(r.status,'stopped');assert.equal(queries,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('restricted browse rejects non-swipe refresh requests',async()=>{
 const root=scratch();const f:any={id:'f',path:'f.png',width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0};
 const cfg:any={scope:{userId:0},package:'p',selectionAllowNew:false,limits:{agentCalls:1,stageMs:90000},stages:{task_receipt:{goal:'r',checkpoint:'r',continuousScroll:{maxMs:18000},revalidateBeforeScroll:true}}};
 const rt=createStagedRuntime(cfg,{}, {},{evidenceDir:root,plan:[],runStage:async(_:any,d:any)=>{
  assert.equal(await d.beforeDispatch({frame:f,remaining:{ms:50000}},{action:{type:'wait',ms:1000}}),null);return {status:'stopped'};
 }});
 try{await rt.stage('task_receipt',{});}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('configured browse refreshes after Agent reasoning and dispatches only locally revalidated new coordinates',async()=>{
 const root=scratch();const old:any={id:'old',path:'old',width:1080,height:2400,capturedAt:1,lines:[],package:'p',userId:0};const fresh={...old,id:'new',capturedAt:Date.now()};let checked=0;
 const cfg:any={scope:{userId:0},package:'p',limits:{agentCalls:4,stageMs:90000},stages:{open_task:{goal:'open',checkpoint:'d'},task_receipt:{goal:'receipt',checkpoint:'r',continuousScroll:{maxSwipes:16,maxMs:18000},revalidateBeforeScroll:true}}};
 const rt=createStagedRuntime(cfg,{capture:async()=>fresh},{},{plan:[],evidenceDir:root,revalidateBrowseSwipe:async(a:any,b:any,action:any)=>{checked++;assert.equal(a.id,'old');assert.equal(b.id,'new');return {action:{...action,fromX:500},reason:'verified current region'};},runStage:async(i:any,d:any)=>{
  if(i.stageId==='open_task')return {status:'completed'};
  const p={frameId:'old',action:{type:'swipe',fromX:540,fromY:1800,toX:540,toY:900,ms:900},expected:'r',reason:'model'};const c={frame:old,remaining:{ms:40000}};
  const r=await d.beforeDispatch(c,p);assert.equal(r.frame.id,'new');assert.equal(r.proposal.frameId,'new');assert.equal(r.proposal.action.fromX,500);
  assert.equal(await d.beforeDispatch({...c,remaining:{ms:10000}},p),null);return {status:'stopped'};
 }});
 try{await rt.stage('open_task',{});await rt.stage('task_receipt',{});assert.equal(checked,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('explicit continuous browse config dispatches one bounded gesture sequence then requires fresh verification',async()=>{
 const root=scratch();let bursts=0;const f:any={id:'f',path:'f',width:1080,height:2400,lines:[]};
 const cfg:any={scope:{userId:0},limits:{agentCalls:2,stageMs:90000},stages:{task_receipt:{goal:'receipt',checkpoint:'r',continuousScroll:{maxSwipes:16,maxMs:18000}}}};
 const rt=createStagedRuntime(cfg,{scrollContinuously:async(a:any,frame:any,l:any)=>{bursts++;assert.equal(frame.id,'f');assert.equal(l.maxSwipes,16);},act:async()=>{}},{},{plan:[],evidenceDir:root,runStage:async(_i:any,d:any)=>{await d.dispatch({type:'swipe',fromX:540,fromY:1800,toX:540,toY:900,ms:900},f);return {status:'stopped'};}});
 try{await rt.stage('task_receipt',{});assert.equal(bursts,1);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('long Agent wait executes only a bounded slice before a new observation',async()=>{
 const root=scratch();const actions:any[]=[];
 const f:any={id:'f',path:'f.png',width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0};
 const cfg:any={scope:{userId:0},package:'p',limits:{stageMs:90000,agentCalls:2,stageActions:2},stages:{task_receipt:{goal:'receipt',checkpoint:'receipt'}}};
 const rt=createStagedRuntime(cfg,{act:async(a:any)=>{actions.push(a);}}, {}, {evidenceDir:root,plan:[],runStage:async(_i:any,d:any)=>{await d.dispatch({type:'wait',ms:10000},f);return {status:'stopped'};}});
 try{await rt.stage('task_receipt',{});assert.deepEqual(actions,[{type:'wait',ms:5000}]);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('bounded first return remains available when task receipt identity is unresolved',async()=>{
 const root=scratch();let calls=0;
 const f:any={id:'raw',path:'raw.png',width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0};
 const cfg:any={scope:{userId:0},package:'p',panelMarker:'panel',limits:{stageMs:1000,agentCalls:2,maxReturns:3},stages:{return_list:{goal:'return only',checkpoint:'list'}}};
 const rt=createStagedRuntime(cfg,{}, {query:async()=>{calls++;return {stageDone:false,pageIdentity:'task unknown',blocked:true,stopReason:'receipt uncertain'};}}, {evidenceDir:root,plan:[],runStage:async(_i:any,d:any)=>{const c={frame:f};assert.equal((await d.check(c)).blocked,undefined);assert.equal((await d.scriptStep(c)).action.type,'back');return {status:'stopped'};}});
 try{await rt.stage('return_list',{});assert.equal(calls,0);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('resumed task carries original identity and baseline through visual OCR recovery and settlement',async()=>{
 const root=scratch();let payload:any;
 const resume={runId:136,taskAttemptId:'attempt',task:{name:'T',instruction:'浏览15秒',done:0,total:1},balanceBefore:1550};
 const f:any={id:'raw',path:'raw.png',width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0,observationError:'OCR capture failed'};
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'p',panelMarker:'panel',constraints:[],limits:{stageMs:90000,agentCalls:5,stageActions:2},stages:{open_task:{goal:'observe selected task',checkpoint:'task'}}};
 const rt=createStagedRuntime(cfg,{capture:async()=>f},{query:async(p:any)=>{payload=p;return {stageDone:true,pageIdentity:'task destination',blocked:false,ordinaryBrowseOnly:true};}}, {resume,sessionId:'s',evidenceDir:root,plan:[],runStage:async(_i:any,d:any)=>{const frame=await d.observe();assert.equal((await d.check({frame,remaining:{ms:5000}})).done,true);return {status:'completed'};}});
 try{const r=await rt.stage('open_task',{taskAttemptId:'attempt',task:resume.task});assert.equal(r.task.name,'T');assert.equal(payload.context.observationError,'OCR capture failed');assert.equal(payload.context.continuation.sourceRunId,136);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('runtime sends unknown stage context and same frame to direct model, retaining script failure',async()=>{
 const root=scratch(),file=path.join(root,'f.png');fs.writeFileSync(file,'fixture-not-real-image; injected model boundary');
 const f={id:'f',path:file,width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0};let query:any;
 const device:any={capture:async()=>f,act:async()=>{},prepare:async()=>{},cleanup:async()=>({asleep:true})};
 const model:any={usage:[],query:async(p:any)=>{query=p;return {stageDone:false,pageIdentity:'unknown page',blocked:false,reason:'need screenshot',requirements:'',ordinaryBrowseOnly:false}}};
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'p',panelMarker:'panel',constraints:['no payment'],limits:{stageMs:90000,stageActions:3,agentCalls:5},stages:{open_list:{goal:'show list',checkpoint:'list'}}};
 const runtime=createStagedRuntime(cfg,device,model,{sessionId:'s',evidenceDir:root,plan:[],runStage:async(input:any,deps:any)=>{await deps.check({frame:f,recentActions:[],error:'script missing',remaining:{ms:5000}});assert.equal(query.frame.id,'f');assert.equal(query.context.stageId,'open_list');assert.equal(query.context.error,'script missing');return {status:'stopped',events:[],actions:[],error:'test stop'};}});
 const r=await runtime.stage('open_list',{taskAttemptId:'t',stages:[]});assert.equal(r.status,'stopped');assert.ok(query.prompt.includes('JSON'));
 fs.rmSync(root,{recursive:true,force:true});
});
