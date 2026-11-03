// Full normal adapter + real planner/orchestrator with synthetic external boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {runActivityRound} from '../runner/staged/round.ts';
import {planRoundInventory} from '../runner/staged/round-planner.ts';
import {createRoundAdapters} from '../runner/staged/round-main.ts';
import {writeRoundState} from '../runner/staged/round-state.ts';
test('normal round wiring executes two current tasks through archive, refreshes and finishes once',async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-full-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cfg={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'app',learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},aiTaskRecovery:true,aiPanelReader:true,scriptValidationMode:false};
 const tasks=['A','B'].map(name=>({name,instruction:'浏览',done:0,total:1,button:'去完成'}));let archived=0,prepared=0,home=0,cleanup=0;const stages:string[]=[];
 const model={usage:[],query:async(r:any)=>({items:r.context.inventory.tasks.map((task:any)=>({...task,decision:'do',times:1,reason:'synthetic explicit browse requirement',category:'ordinary-in-app',routeSupported:true,actionType:'browse',stopConditions:['input unknown','auth','receipt missing']}))})};
 const adapters=createRoundAdapters({cfg,round:{id:'r',evidenceDir:dir},model,knowledge:{},scriptFiles:[],device:{act:async(_a:any,_f:any,limits:any)=>{limits.beforeInput();},prepare:async()=>{prepared++},returnHome:async()=>{home++;return {confirmed:true}},cleanup:async()=>{cleanup++;return {errors:[]}}},saveTask:async(v:any)=>{const selected=tasks.find(x=>x.name===v.result.task.name)!;selected.done=1;return {runId:++archived,partial:false,v2Archived:true,gainCoins:10}},runtimeFactory:(_c:any,d:any,_m:any,o:any)=>({stage:async(id:string,c:any)=>{
  stages.push(id);if(id==='collect_list')fs.writeFileSync(path.join(o.evidenceDir,'inventory.json'),JSON.stringify({complete:true,pages:[{tasks:structuredClone(tasks)}]}));
  if(id==='open_task')await d.act({type:'tap'},{id:'frame'});
  return {status:'completed',...(id==='select_task'?{task:{...tasks.find(x=>x.name===o.plan[0].name),beforeFrame:{path:'synthetic'}},balanceBefore:100+archived*10}:{}),...(id==='task_receipt'?{receipt:{quote:'synthetic receipt',taskAttemptId:c.taskAttemptId}}:{}),...(id==='settle'?{balanceAfter:110+archived*10}:{})};
 }})});
 const state=await runActivityRound({id:'r',batchId:'b'},{...adapters,plan:(inventory,s)=>planRoundInventory({inventory,cfg,model,attempts:s.attempts}),persist:s=>writeRoundState(path.join(dir,'state.json'),s)});
 assert.equal(state.status,'completed',JSON.stringify(state.errors));assert.equal(archived,2);assert.equal(prepared,1);assert.equal(home,1);assert.equal(cleanup,1);assert.equal(stages.filter(x=>x==='open_app').length,1);assert.equal(stages.filter(x=>x==='collect_list').length,3);assert.equal(state.attempts.filter(x=>x.status==='consumed').length,2);
});
