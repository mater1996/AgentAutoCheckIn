import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';import {runActivitySession} from '../runner/staged/session.ts';
const root=path.resolve(import.meta.dirname,'..');const fixture=JSON.parse(fs.readFileSync(path.join(root,'data/evidence/home-revisit-integration/saved-page-observations.json'),'utf8'));
async function run(t:any){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'home-normal-parent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const originals=fixture.pages.map((p:any)=>{const raw=JSON.parse(fs.readFileSync(path.resolve(root,p.sources[1].path),'utf8'));return {...raw,path:path.resolve(root,p.sources[0].path),package:raw.owner?.package??raw.package,userId:raw.owner?.userId??raw.userId,lines:raw.lines??[]};});
 const scope={appId:'taobao',accountId:'offline',activityId:'coins',userId:0},task={...fixture.task,done:0,total:1};
 const route={type:'home-revisit',task:fixture.task,transitionWaitMs:0,loadingWaitsMs:[],returnSteps:['visible-exit'],refreshReturnedPanel:false,homeRevisit:{capturePolicy:{frames:2,intervalMs:0}}};
 const cfg:any={executionPolicy:'development-unbounded-v1',scope,package:fixture.owner.package,panelMarker:'赚金币抵钱',model:{timeoutMs:30000},scriptValidationMode:false,interactionRoutes:[route],limits:{stageMs:1},stages:{}};
 let page=0,count=0,saved:any;const frames=new Map<string,number>(),actions:any[]=[];
 const device={capture:async()=>{const f={...structuredClone(originals[page]),id:'derived-normal-'+(++count)};frames.set(f.id,page);return f;},act:async(a:any)=>{actions.push(a);if(a.type==='tap')page=page===0?1:page===1?2:page===2?3:5;}};
 const targets:any={guide:{role:'guide-home',quote:'回淘宝首页领取',point:[542,2130],bounds:[260,2080,820,2180]},home:{role:'home-coin',quote:'领淘金币',point:[884,413],bounds:[790,350,980,485]},activity:{role:'open-panel',quote:'去赚金币',point:[115,996],bounds:[10,920,225,1050]}};
 const model={query:async(r:any)=>{const i=frames.get(r.frame.id)??fixture.pages.findIndex((p:any)=>p.id===r.frame.id);assert.ok(i>=0);const o=structuredClone(fixture.pages[i].observation);return {...o,blocked:false,binding:r.context.binding,requiredInteraction:'home-revisit',requirementsQuote:'offline saved page annotation, not live model output',target:targets[o.page]??null};}};
 const ctxProviders=(ctx:any)=>({captureRawBurst:async()=>{const originalsRaw=fixture.pages.slice(3,5).map((p:any)=>JSON.parse(fs.readFileSync(path.resolve(root,p.sources[1].path),'utf8')));const batchId='derived-batch-'+ctx.taskAttemptId;const raw=originalsRaw.map((f:any)=>{const x={...f,batchId,owner:{...f.owner,taskAttemptId:ctx.taskAttemptId},sidecarPath:path.join(dir,f.id+'.sidecar.json')};fs.writeFileSync(x.sidecarPath,JSON.stringify(x));return x;});return {id:batchId,status:'complete',frames:raw};}});
 const rt=createStagedRuntime(cfg,device,model,{sessionId:'home-normal-parent',evidenceDir:dir,plan:[],controllerDeps:ctxProviders});
 const result=await runActivitySession({id:'home-normal-parent',scope,evidenceDir:dir,startedAt:new Date().toISOString()},{prepare:async()=>{},stage:async(id,ctx)=>id==='select_task'?{status:'completed',task,balanceBefore:2705}:['open_task','task_receipt','return_list','settle'].includes(id)?rt.stage(id,ctx):{status:'completed'},save:async v=>{saved=v;return {};},cleanup:async()=>({offline:true})});
 return {result,saved,actions,dir,rt,task,cfg,device,model,ctxProviders,scope};
}
test('normal runtime delegates home stages and saves real mixed reward after catch-return without credit',async t=>{
 const h=await run(t);assert.equal(h.result.status,'unknown',h.result.error);assert.match(h.result.error,/Independent home revisit receipt missing/);
 assert.equal(h.saved.result.balanceAfter,2815);assert.equal(h.saved.result.rewardAttribution.incidentalRewards[0].coins,100);assert.equal(h.saved.result.rewardAttribution.selectedRewardCoins,null);assert.equal(h.saved.result.unexplainedDelta,10);
 assert.equal(h.actions.filter((a:any)=>a.type==='tap').length,4);assert.equal(h.saved.stages.find((s:any)=>s.stageId==='return_list').status,'completed');
 assert.equal(fs.readdirSync(path.join(h.dir,'interaction-reservations')).length,4);
 const original=fixture.pages[0],raw=JSON.parse(fs.readFileSync(path.resolve(root,original.sources[1].path),'utf8'));
 const replayDevice={capture:async()=>({...raw,path:path.resolve(root,original.sources[0].path)}),act:async()=>{throw Error('duplicate input must never dispatch');}};
 const restarted=createStagedRuntime(h.cfg,replayDevice,h.model,{sessionId:'home-normal-parent',evidenceDir:h.dir,plan:[],controllerDeps:h.ctxProviders});
 const prior=h.saved.result,count=h.actions.length;
 const duplicate=await restarted.stage('open_task',{task:h.task,taskAttemptId:prior.taskAttemptId,balanceBefore:2705});
 assert.equal(duplicate.status,'unknown');assert.match(duplicate.error,/EEXIST/);assert.equal(h.actions.length,count);
});
