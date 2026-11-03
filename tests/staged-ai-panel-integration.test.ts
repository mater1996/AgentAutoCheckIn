// Offline integration. Model responses below are explicitly synthetic; no ADB/network/DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as main from '../runner/staged/main.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {VisionClient} from '../runner/staged/vision-client.ts';
import {readPanel,bindTask,validateProposedAction} from '../runner/staged/observations.ts';
const owner={package:'com.taobao.taobao',userId:0};
const source=path.resolve('evidence/staged-2026-11-01T23-38-18-381Z/4cfce720-55ce-4c26-bdbd-4f11d5d73eaf.png');
function synthetic(){return {isPanel:true,balance:2265,blocked:false,top:true,bottom:true,tasks:[{name:'合成获准浏览',instruction:'浏览5秒',done:0,total:1,reward:20,rewardMin:null,rewardMax:null,rewardOffers:[{condition:'浏览5秒',reward:20,rewardMin:null,rewardMax:null}],button:'去完成',bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]}],clippedRows:[]};}
function temp(t:any){const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'ai-panel-integration-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function vision(response:any,onQuery:(p:any)=>void=()=>{}){return new VisionClient({baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic-offline-key',model:'synthetic-vision',fetch:async(_url,request)=>{onQuery(JSON.parse(String(request?.body)));return new Response(JSON.stringify({model:'synthetic-vision',choices:[{message:{content:JSON.stringify(response)}}],usage:{total_tokens:53,prompt_tokens:50,completion_tokens:3}}));}});}
function config(extra:any={}){return {scope:{appId:'taobao',accountId:'synthetic',activityId:'coins',userId:0},package:owner.package,assetId:'coins',model:{baseUrl:'http://127.0.0.1:1/v1',name:'synthetic-vision'},aiPanelReader:true,scriptValidationMode:false,balanceComponent:false,selectionAllowNew:false,localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:['ordinary approved browse only'],limits:{maxTasks:1,sessionMs:30000,stageMs:10000,agentCalls:8,stageActions:3,inventoryPages:3,maxReturns:2},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}])),...extra};}
test('AI mode requires explicit boolean and disables both zero-model and balance OCR modes',()=>{
 const c=config();assert.equal(validateStagedConfig(c),c);
 for(const aiPanelReader of ['true',1,null,{}])assert.throws(()=>validateStagedConfig({...c,aiPanelReader}),/AI panel/i);
 for(const scriptValidationMode of [true,undefined])assert.throws(()=>validateStagedConfig({...c,scriptValidationMode}),/AI panel/i);
 for(const balanceComponent of [true,undefined])assert.throws(()=>validateStagedConfig({...c,balanceComponent}),/AI panel/i);
 assert.equal(validateStagedConfig({...c,aiPanelReader:false,scriptValidationMode:true,balanceComponent:true}).aiPanelReader,false);
 assert.equal(validateStagedConfig({...c,aiTaskRecovery:true}).aiTaskRecovery,true);
 for(const aiTaskRecovery of ['true',1,null,{}])assert.throws(()=>validateStagedConfig({...c,aiTaskRecovery}),/AI task recovery/i);
 assert.throws(()=>validateStagedConfig({...c,aiTaskRecovery:true,aiPanelReader:false}),/AI task recovery/i);
});
test('real runtime engine device use AI panel after OCR failure, persist original frame plus sidecar and provenance',async t=>{
 const dir=temp(t),actions:string[]=[];let queryCount=0;
 const model=vision(synthetic(),()=>queryCount++);
 const device=new AdbOcrDevice({serial:'SYNTHETIC-OFFLINE',evidenceDir:dir,allowVisualFallback:true,frameMaxAgeMs:15000,exec:async(file,args)=>{
  if(file==='adb'&&args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};
  if(file==='adb'&&args.includes('screencap'))return {stdout:fs.readFileSync(source)};
  if(file==='adb'){actions.push(args.join(' '));throw Error('offline device action not expected');}
  throw Error('synthetic OCR failure');
 }});
 const rt=createStagedRuntime(config(),device,model,{sessionId:'synthetic',evidenceDir:dir,plan:[]});
 const result=await rt.stage('open_list',{taskAttemptId:'synthetic-attempt'});
 assert.equal(result.status,'completed',result.error);assert.equal(queryCount,1);assert.equal(rt.calls,1);assert.equal(model.usage.length,1);assert.equal(model.usage[0].calls,1);
 assert.deepEqual(actions,[]);
 const frame=rt.frames[0],saved=JSON.parse(fs.readFileSync(frame.path.replace(/\.png$/,'.json'),'utf8'));
 assert.equal(saved.aiPanelEvidence.version,'ai-panel-v1');assert.equal(saved.capturedAt,frame.capturedAt);assert.deepEqual(saved.lines,[]);assert.match(saved.observationError,/synthetic OCR failure/);
 assert.equal(readPanel(saved).balance,2265);assert.equal(bindTask(saved,readPanel(saved).tasks[0])?.name,'合成获准浏览');
 assert.equal(result.review.candidate.version,'ai-panel-v1');
 const invalid={...saved,aiPanelEvidence:{...saved.aiPanelEvidence,sha256:'0'.repeat(64)},lines:[{text:'赚金币抵钱',bounds:[0,0,1,1]}]};
 assert.equal(readPanel(invalid).isPanel,false,'invalid AI sidecar cannot regain OCR panel authority');
});
function replayFrame(t:any,extra:any={}){const dir=temp(t),file=path.join(dir,'frame.png');fs.copyFileSync(source,file);const frame={id:'synthetic-frame',path:file,width:1080,height:2400,capturedAt:Date.now(),...owner,lines:[],...extra};fs.writeFileSync(path.join(dir,'frame.json'),JSON.stringify(frame));return {dir,frame};}
const plan=[{name:'合成获准浏览',instruction:'浏览5秒',decision:'do'}];
test('same frame ID queries once, approved-only selection retains reward conditions and failures consume allowance',async t=>{
 const {dir,frame}=replayFrame(t);let requests=0;const response=synthetic();response.tasks[0].rewardOffers.push({condition:'下单最高',reward:null as any,rewardMin:null,rewardMax:1000 as any});
 const model=vision(response,()=>requests++),cfg=config();
 const rt=createStagedRuntime(cfg,{capture:async()=>structuredClone(frame),act:async()=>{}},model,{evidenceDir:dir,plan});
 const inventory=await rt.stage('collect_list',{});assert.equal(inventory.status,'completed');assert.match(inventory.review.summary,/ai-panel-v1/);
 const result=await rt.stage('select_task',{});assert.equal(result.status,'completed');assert.equal(result.task.reward,20);assert.equal(result.task.rewardOffers[1].rewardMax,1000);
 assert.equal(requests,1);assert.equal(rt.calls,1);assert.equal(result.balanceBefore,2265);
 const unapproved=createStagedRuntime(cfg,{capture:async()=>structuredClone(frame),act:async()=>{}},vision(response),{evidenceDir:dir,plan:[]});
 assert.equal((await unapproved.stage('select_task',{})).status,'stopped');assert.equal(unapproved.calls,1);
 const failed=vision(null);const bad=createStagedRuntime({...cfg,limits:{...cfg.limits,agentCalls:1}},{capture:async()=>structuredClone(frame),act:async()=>{}},failed,{evidenceDir:dir,plan});
 assert.equal((await bad.stage('select_task',{})).status,'stopped');assert.equal(bad.calls,1);
 await bad.stage('select_task',{});assert.equal(bad.calls,1);assert.equal(failed.usage.length,1);
});
test('AI panel uses remaining deadline and stops after a slow response without refreshing capturedAt or clicking',async t=>{
 const {dir,frame}=replayFrame(t);let limit=Infinity,actions=0;
 const model={usage:[],query:async(p:any)=>{limit=p.maxMs;await new Promise(r=>setTimeout(r,30));return synthetic();}};
 const cfg=config({limits:{...config().limits,stageMs:15,sessionMs:25}});
 const rt=createStagedRuntime(cfg,{capture:async()=>structuredClone(frame),act:async()=>{actions++;}},model,{evidenceDir:dir,plan});
 await assert.rejects(rt.stage('select_task',{}),/deadline/);assert.ok(limit>0&&limit<=15);assert.equal(actions,0);assert.equal(rt.calls,1);
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'frame.json'),'utf8'));assert.equal(saved.capturedAt,frame.capturedAt);assert.equal(saved.aiPanelEvidence.version,'ai-panel-v1');
});
test('AI main source archive includes reader only in the explicit AI mode',()=>{
 assert.equal(typeof (main as any).aiPanelSourceFiles,'function');
 assert.deepEqual((main as any).aiPanelSourceFiles({aiPanelReader:true}),['runner/staged/ai-panel-reader.ts']);
 assert.deepEqual((main as any).aiPanelSourceFiles({}),[]);
});
test('AI mode cannot select unapproved names even when selectionAllowNew is true',async t=>{
 const {dir,frame}=replayFrame(t);let queries=0;const model=vision(synthetic(),()=>queries++);
 const rt=createStagedRuntime(config({selectionAllowNew:true}),{capture:async()=>structuredClone(frame),act:async()=>{}},model,{evidenceDir:dir,plan:[]});
 const r=await rt.stage('select_task',{});assert.equal(r.status,'stopped');assert.equal(queries,1,'only one panel query; no candidate expansion query');
});
test('AI approved row supplies tap authority despite conflicting OCR control text',async t=>{
 const {dir,frame}=replayFrame(t,{lines:[{text:'支付',bounds:[850,710,1000,790]}]});
 const rt=createStagedRuntime(config(),{capture:async()=>structuredClone(frame),act:async()=>{}},vision(synthetic()),{evidenceDir:dir,plan});
 assert.equal((await rt.stage('select_task',{})).status,'completed');
 const f=rt.frames[0];assert.doesNotThrow(()=>validateProposedAction({type:'tap',x:925,y:750},f));
 assert.throws(()=>validateProposedAction({type:'tap',x:900,y:710},{...f,aiPanelEvidence:{...f.aiPanelEvidence,sha256:'bad'}}),/AI|prohibited/);
});
test('AI panel entry binds the approved row and does not query again inside confirmed browse or receipt',async t=>{
 const {dir,frame}=replayFrame(t);let page='panel',serial=0,queries=0;const actions:any[]=[];
 const model=vision(synthetic(),()=>queries++);
 const cfg=config({learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153}});
 const rt=createStagedRuntime(cfg,{capture:async()=>{
  const f={...structuredClone(frame),id:'synthetic-'+(++serial),capturedAt:Date.now(),path:path.join(dir,`synthetic-${serial}.png`),lines:page==='panel'?[]:[{text:'合成浏览页',bounds:[0,0,100,100]}]};
  fs.copyFileSync(source,f.path);fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 },act:async(a:any)=>{actions.push(a);if(a.type==='tap')page='browse';}},model,{evidenceDir:dir,plan,inspectLearnedBrowse:async()=>({state:'completed',quote:'合成回执，仅用于离线测试',version:'synthetic-receipt'})});
 const chosen=await rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'synthetic-entry'};
 assert.equal(chosen.status,'completed');const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
 const receipt=await rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);
 assert.equal(queries,2,'selection and entry panel only');assert.equal(actions.filter(a=>a.type==='tap').length,1);
});
test('AI nonpanel result cannot acquire panel authority from contradictory OCR',async t=>{
 const original=JSON.parse(fs.readFileSync('evidence/staged-2026-11-01T19-32-41-877Z/55a6d09a-1b77-4952-91ce-fa867d076087.json','utf8'));
 const {dir,frame}=replayFrame(t,{lines:original.lines});const response={...synthetic(),isPanel:false,balance:null,tasks:[],top:false,bottom:false};
 const rt=createStagedRuntime(config(),{capture:async()=>structuredClone(frame)},vision(response),{evidenceDir:dir,plan});
 const r=await rt.stage('open_list',{});assert.equal(r.status,'stopped');assert.equal(rt.calls,1);assert.equal(readPanel(rt.frames[0]).isPanel,false);
});
test('AI failure on a new frame cannot exceed session call allowance',async t=>{
 const {dir,frame}=replayFrame(t);let serial=0;const model=vision(null),cfg=config({limits:{...config().limits,agentCalls:1}});
 const rt=createStagedRuntime(cfg,{capture:async()=>{const f={...frame,id:'budget-'+(++serial),path:path.join(dir,`budget-${serial}.png`)};fs.copyFileSync(source,f.path);return f;}},model,{evidenceDir:dir,plan});
 assert.equal((await rt.stage('select_task',{})).status,'stopped');assert.equal((await rt.stage('select_task',{})).status,'stopped');assert.equal(rt.calls,1);assert.equal(model.usage.length,1);
});
test('AI nonpanel home retains original navigation action safety and cannot grant panel proof',async t=>{
 const {dir,frame}=replayFrame(t);const response={...synthetic(),isPanel:false,balance:null,tasks:[],top:false,bottom:false};
 const rt=createStagedRuntime(config(),{capture:async()=>frame},vision(response),{evidenceDir:dir,plan});
 await rt.stage('select_task',{});
 assert.doesNotThrow(()=>validateProposedAction({type:'tap',x:300,y:200},rt.frames[0]));
});
test('AI stable settlement requires two owning panel balances and keeps receipt attempt binding',async t=>{
 const {dir,frame}=replayFrame(t);let page='panel',serial=0,queries=0,settleFrames=0;
 const model=vision(synthetic(),()=>queries++);
 const boundary={usage:model.usage,query:async(p:any)=>{
  if(page!=='returned')return model.query(p);
  const response=synthetic();response.balance=2285;response.tasks[0].done=1;settleFrames++;
  return vision(response).query(p);
 }};
 const rt=createStagedRuntime(config({learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153}}),{capture:async()=>{
  const f={...structuredClone(frame),id:'settle-'+(++serial),capturedAt:Date.now(),path:path.join(dir,`settle-${serial}.png`)};fs.copyFileSync(source,f.path);fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 },act:async(a:any)=>{if(a.type==='tap')page='browse';}},boundary,{evidenceDir:dir,plan,inspectLearnedBrowse:async()=>({state:'completed',quote:'合成完成回执',version:'synthetic-receipt'})});
 const chosen=await rt.stage('select_task',{}),ctx={task:chosen.task,taskAttemptId:'synthetic-settlement'};
 assert.equal((await rt.stage('open_task',ctx)).status,'completed');assert.equal((await rt.stage('task_receipt',ctx)).status,'completed');
 page='returned';assert.equal((await rt.stage('settle',{...ctx,taskAttemptId:'other'})).status,'stopped');
 const settled=await rt.stage('settle',ctx);assert.equal(settled.status,'completed',settled.error);assert.equal(settled.balanceAfter,2285);assert.equal(settleFrames,2);assert.equal(rt.calls,4);
});
test('AI panel mode stops unknown confirmed task evidence without a model fallback interruption',async t=>{
 const {dir,frame}=replayFrame(t);let serial=0,queries=0;
 const rt=createStagedRuntime(config({learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153}}),{capture:async()=>{
  const f={...frame,id:'unknown-'+(++serial),path:path.join(dir,`unknown-${serial}.png`)};fs.copyFileSync(source,f.path);return f;
 },act:async()=>{}},vision(synthetic(),()=>queries++),{evidenceDir:dir,plan,inspectLearnedBrowse:async()=>null});
 const chosen=await rt.stage('select_task',{}),opened=await rt.stage('open_task',{task:chosen.task,taskAttemptId:'unknown-attempt'});
 assert.notEqual(opened.status,'completed');assert.equal(queries,2,'no model recovery within dispatched attempt');
});
test('model latency cannot turn a 15-second-old frame into fresh selection authority',async t=>{
 const {dir,frame}=replayFrame(t);const clock=Date.now;let actions=0;
 const rt=createStagedRuntime(config({limits:{...config().limits,stageMs:60000,sessionMs:60000}}),{capture:async()=>frame,act:async()=>{actions++;}}, {query:async()=>{Date.now=()=>frame.capturedAt+15001;return synthetic();}}, {evidenceDir:dir,plan});
 try{await assert.rejects(rt.stage('select_task',{}),/expired/);assert.equal(actions,0);assert.equal(rt.calls,1);}finally{Date.now=clock;}
});
test('AI selection rejects stale source and owner capture errors without retries or model calls',async t=>{
 const {dir,frame}=replayFrame(t,{capturedAt:Date.now()-15001});let requests=0,captures=0;
 const model=vision(synthetic(),()=>requests++);
 const rt=createStagedRuntime(config(),{capture:async()=>frame},model,{evidenceDir:dir,plan});
 await assert.rejects(rt.stage('select_task',{}),/expired/);assert.equal(requests,0);
 const broken=createStagedRuntime(config(),{capture:async()=>{captures++;throw Error('Foreground changed during capture');}},model,{evidenceDir:dir,plan});
 await assert.rejects(broken.stage('select_task',{}),/Foreground/);assert.equal(captures,1);assert.equal(requests,0);
});
