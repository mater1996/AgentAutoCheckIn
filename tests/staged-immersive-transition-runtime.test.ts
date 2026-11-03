import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {buildImmersiveTransition} from '../runner/staged/immersive-transition.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
const project=path.resolve(import.meta.dirname,'..');
test('transition config rejects unsealed or unsupported changes',async()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(project,'data/evidence/plans/stable-scripts-20261101/immersive-v2-config.json'),'utf8'));
 const rule=await buildImmersiveTransition(project);
 cfg.immersiveBrowse.rewardTransitions=[rule];assert.equal(validateStagedConfig(cfg),cfg);
 for(const rules of [null,[rule,rule],[{...rule,receiptRewardCoins:50}],[{...rule,version:'invalid'}]]){
  assert.throws(()=>validateStagedConfig({...cfg,immersiveBrowse:{...cfg.immersiveBrowse,rewardTransitions:rules}}),/transition/i);
 }
});
for(const enabled of [true,false])test(`real 184 reward change is ${enabled?'accepted with explicit contract':'rejected without explicit contract'}`,async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'immersive-transition-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const evidence=path.join(project,'evidence/staged-2026-11-01T10-35-22-744Z');
 const source=(id:string)=>JSON.parse(fs.readFileSync(path.join(evidence,id+'.json'),'utf8'));
 const browsing=source('3a3d237c-00d4-4502-82db-2e85d084e370'),completed=source('33f7f285-7248-432d-8040-13aded9e3ebf');
 const task={name:'好物沉浸看',instruction:'浏览'};let destination=false,waited=0,serial=0,queries=0;const actions:any[]=[];
 const device={capture:async()=>destination?{...(waited>=6000?completed:browsing),id:'derived-replay-'+(++serial),capturedAt:Date.now()-1000+serial,page:{derived:true,original:waited>=6000?completed.id:browsing.id}}:{
  id:'panel-'+(++serial),path:'synthetic-panel.png',capturedAt:Date.now()-1000+serial,width:1080,height:2400,package:'com.taobao.taobao',userId:0,
  lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'2050',bounds:[90,240,210,300]},
   {text:task.name+'（1/5）',bounds:[230,900,750,950]},{text:task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]}]},
 act:async(a:any)=>{actions.push(a);if(a.type==='tap')destination=true;if(a.type==='wait'&&a.ms>1000)waited+=a.ms;},scrollContinuously:async()=>{throw Error('Video must not scroll');}};
 const transition=await buildImmersiveTransition(project);
 const cfg:any={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,scriptValidationMode:true,
 learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},immersiveBrowse:{enabled:true,version:'immersive-browse-candidate-v2',allowedRewardCoins:[20,50],sourceRunId:145,task,observationBudgetMs:20000,...(enabled?{rewardTransitions:[transition]}:{})},
 limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3},stages:Object.fromEntries(['open_task','task_receipt'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Forbidden model call');}},{sessionId:'offline-184-replay',evidenceDir:dir,plan:[{...task,decision:'do',times:1}]});
 const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed');const ctx={taskAttemptId:'offline-184-attempt',task:selected.task};
 const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
 const result=await rt.stage('task_receipt',ctx);
 if(enabled){assert.equal(result.status,'completed',result.error);assert.equal(result.receipt.quote,'已得35');assert.equal(result.receipt.rewardCoins,35);assert.equal(result.receipt.requirementRewardCoins,20);assert.equal(result.receipt.rewardTransitionVersion,transition.version);
 const events=fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const e=events.find(e=>e.kind==='immersive_reward_transition');assert.ok(e);assert.equal(e.taskAttemptId,ctx.taskAttemptId);assert.equal(e.fromRewardCoins,20);assert.equal(e.toRewardCoins,35);assert.equal(e.waitMs,6000);assert.notEqual(e.browseFrameId,e.receiptFrameId);
 }else{assert.notEqual(result.status,'completed');assert.equal(result.receipt,undefined);}
 assert.equal(queries,0);assert.equal(actions.filter(a=>a.type==='tap').length,1);assert.equal(waited,6000);
 // Real original destination images; synthetic navigation/id/clock. Never a live validation.
});
