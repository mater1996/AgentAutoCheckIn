import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {buildDwellContract} from '../runner/staged/dwell-browse.ts';

test('actual runtime and dwell inspector replay original 162 destination and receipt without a model',async t=>{
 const root=path.resolve(import.meta.dirname,'..'),dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'real-dwell-runtime-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const contract=await buildDwellContract(root,162);
 const before=JSON.parse(fs.readFileSync(contract.browsing.reference.ocrPath,'utf8'));
 const done=JSON.parse(fs.readFileSync(contract.receipt.reference.ocrPath,'utf8'));
 let state='panel',serial=0,queries=0,waited=0;const actions:any[]=[];
 const device={capture:async()=>state==='panel'?{
  id:'panel-'+(++serial),path:'offline-panel.png',width:1080,height:2400,capturedAt:Date.now(),package:'com.taobao.taobao',userId:0,
  lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1870',bounds:[90,240,210,300]},
   {text:contract.task.name+'（0/5）',bounds:[230,900,750,950]},{text:contract.task.instruction,bounds:[230,970,600,1010]},{text:'去完成',bounds:[880,920,1000,960]}]
 }:{...(waited>=5000?done:before),id:'replay-'+(++serial),capturedAt:Date.now()},
 act:async(a:any)=>{actions.push(a);if(a.type==='tap')state='destination';if(a.type==='wait'&&a.ms>1000)waited+=a.ms;},
 scrollContinuously:async()=>{throw Error('Dwell must not scroll');}};
 const cfg:any={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[contract]},scriptValidationMode:true,
  limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3},
  stages:Object.fromEntries(['open_task','task_receipt'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Forbidden model call');}},{sessionId:'offline-real-dwell',evidenceDir:dir,plan:[{...contract.task,decision:'do',times:1}]});
 const selection=await rt.stage('select_task',{});assert.equal(selection.status,'completed');
 const ctx={task:selection.task,taskAttemptId:'offline-attempt-162'};
 const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
 const receipt=await rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);
 assert.equal(receipt.receipt.quote,contract.receipt.quote);assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);
 assert.equal(actions.filter(a=>a.type==='tap').length,1);assert.deepEqual(actions.filter(a=>a.type==='wait'&&a.ms>1000),[{type:'wait',ms:5000}]);
 assert.equal(queries,0);assert.equal(rt.calls,0);
 // Original PNG/OCR replay exercises integration only; it is not a new live session.
});
