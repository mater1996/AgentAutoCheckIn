import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';

for(const amount of [20,35])test('real immersive inspector and runtime replay original browse and receipt without model assistance: '+amount,async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'immersive-real-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const evidence=path.resolve(import.meta.dirname,'../evidence/staged-2026-11-01T04-08-28-272Z');
 const source=(id:string)=>JSON.parse(fs.readFileSync(path.join(evidence,id+'.json'),'utf8'));
 const real=(run:string,id:string)=>JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname,'../evidence/'+run+'/'+id+'.json'),'utf8'));
 const browsing=amount===35?real('staged-2026-11-01T11-23-10-672Z','a87ba7da-87a6-4f13-a756-3b0b0970dc97'):source('fb612cbe-6736-4d77-8463-fc7848c70ce0'),completed=amount===35?real('staged-2026-11-01T10-35-22-744Z','33f7f285-7248-432d-8040-13aded9e3ebf'):source('bac64856-dcf1-4bf4-9db9-fe960e2af71d');
 const task={name:'好物沉浸看',instruction:'浏览'};let destination=false,waited=0,serial=0,queries=0;const actions:any[]=[];
 const device={capture:async()=>destination?{...(waited>=3000?completed:browsing),id:'replay-'+(++serial),capturedAt:Date.now()}:{
  id:'panel-'+(++serial),path:'synthetic-panel.png',capturedAt:Date.now(),width:1080,height:2400,package:'com.taobao.taobao',userId:0,
  lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1580',bounds:[90,240,210,300]},
   {text:task.name+'（0/5）',bounds:[230,900,750,950]},{text:task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]}]},
  act:async(a:any)=>{actions.push(a);if(a.type==='tap')destination=true;if(a.type==='wait'&&a.ms>1000)waited+=a.ms;},scrollContinuously:async()=>{throw Error('Video browsing does not authorize scrolling');}};
 const cfg:any={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,scriptValidationMode:true,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},immersiveBrowse:{enabled:true,version:'immersive-browse-candidate-v2',allowedRewardCoins:[20,35,50],sourceRunId:145,task,observationBudgetMs:20000},
  limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3},stages:Object.fromEntries(['open_task','task_receipt'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Forbidden model call');}},{sessionId:'offline-145-replay',evidenceDir:dir,plan:[{...task,decision:'do',times:1}]});
 const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed');const ctx={taskAttemptId:'offline-145-attempt',task:selected.task};
 const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
 const receipt=await rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);assert.equal(receipt.receipt.quote,'已得'+amount);
 assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);assert.equal(queries,0);assert.equal(rt.calls,0);
 assert.deepEqual(actions.filter(a=>a.type==='wait'&&a.ms>1000),[{type:'wait',ms:3000}]);assert.equal(actions.filter(a=>a.type==='tap').length,1);
 const events=fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 assert.ok(events.filter(e=>e.kind==='explicit_candidate_authorized').every(e=>e.sourceRunId===145&&e.version==='immersive-browse-candidate-v2'));
 // Synthetic navigation plus original destination/receipt replay: not a live pass.
});
