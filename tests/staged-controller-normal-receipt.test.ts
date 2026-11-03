import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {buildPanelClaimContract} from '../runner/staged/panel-claim.ts';import {createStagedRuntime} from '../runner/staged/runtime.ts';
const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'evidence/supervised-current-2026-11-03T00-24-30-907Z');
test('config validates explicit semantic panel claim policy instead of silently accepting typos',async()=>{
 const contract=await buildPanelClaimContract(root);
 const cfg:any={scope:{appId:'taobao',accountId:'offline',activityId:'coins',userId:0},package:'com.taobao.taobao',assetId:'coins',model:{baseUrl:'http://unused.invalid',name:'unused'},constraints:['No purchase'],limits:{maxTasks:1,sessionMs:30000,stageMs:15000,agentCalls:8,stageActions:10,inventoryPages:2,maxReturns:2},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}])),controllerCandidates:[{family:'panel-claim',task:{name:'任务到访得金币',instruction:'每日来任务面板'},contract,panelClaimPolicy:'current-semantc-v1'}]};
 const {validateStagedConfig}=await import('../runner/staged/config.ts');assert.throws(()=>validateStagedConfig(cfg),/claim policy/i);
 cfg.controllerCandidates[0].panelClaimPolicy='current-semantic-v1';cfg.controllerCandidates[0].task={name:'Explicit current claim',instruction:'Visit current task panel'};assert.equal(validateStagedConfig(cfg),cfg);
});
test('normal runtime reads original burst PNG receipt through configured model adapter',async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'claim-reader-parent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const before=JSON.parse(fs.readFileSync(path.join(source,'74573ea6-cd52-48de-acda-106927ab46e6.json'),'utf8'));
 const supervision=JSON.parse(fs.readFileSync(path.join(source,'supervision.json'),'utf8'));
 const raw=supervision.burst.frames.find((f:any)=>f.id==='2166262b-7dc0-406e-83f4-845cad0f0f0e');
 const toast={...raw,package:raw.owner.package,userId:0,lines:[]};
 const task={name:'任务到访得金币',instruction:'每日来任务面板'},scope={appId:'taobao',accountId:'offline',activityId:'coins',userId:0};
 const cfg:any={executionPolicy:'development-unbounded-v1',scope,package:before.package,panelMarker:'赚金币抵钱',scriptValidationMode:false,model:{timeoutMs:10000},controllerCandidates:[{family:'panel-claim',task,contract:await buildPanelClaimContract(root),panelClaimPolicy:'current-semantic-v1'}],limits:{stageMs:1,stageActions:1,agentCalls:1},stages:{open_task:{goal:'claim',checkpoint:'receipt'}}};
 let taps=0,calls=0,captures=0,clock=before.capturedAt;const model={query:async(r:any)=>{calls++;assert.equal(r.frame.path,raw.path);assert.equal(r.context.taskAttemptId,'parent-attempt');return {frameId:r.frame.id,pngSha256:raw.pngSha256,taskAttemptId:r.context.taskAttemptId,isPanel:true,blocked:false,quote:'任务完成！获得10淘金币'};}};
 const rt=createStagedRuntime(cfg,{capture:async()=>({...before,id:'offline-derived-'+(++captures)}),act:async(a:any)=>{if(a.type==='tap')taps++;}},model,{sessionId:'parent-session',evidenceDir:dir,plan:[],now:()=>clock,controllerDeps:{captureBurst:async()=>{clock=toast.capturedAt;return [toast];}}});
 const ctx={task,taskAttemptId:'parent-attempt',balanceBefore:2675};
 const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);assert.equal(taps,1);assert.equal(calls,1);
 const received=await rt.stage('task_receipt',ctx);assert.equal(received.status,'completed',received.error);assert.equal(received.receipt.quote,'任务完成！获得10淘金币');
 assert.equal(taps,1);assert.equal(calls,1);assert.ok(fs.existsSync(received.receipt.observation.evidence.path));
});
