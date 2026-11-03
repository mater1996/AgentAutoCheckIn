import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileStagedSession} from '../runner/staged/reconcile.ts';
test('reconciliation never dispatches a task and preserves source failure and original receipt identity',async()=>{
 let saved:any;let clean=false;
 const old:any={status:'unknown',runId:133,task:{name:'T',instruction:'浏览',done:0,total:1,beforeFrame:{path:'before.png'}},taskAttemptId:'at',receipt:{taskAttemptId:'at',frameId:'r',path:'r.png',quote:'任务已完成'},balanceBefore:1540};
 const d:any={capture:async()=>({id:'f',path:'f.png',width:1080,height:2400,capturedAt:Date.now(),package:'p',userId:0,lines:[{text:'赚金币抵钱',bounds:[390,470,680,540]},{text:'1550',bounds:[90,240,200,300]}]}),prepare:async()=>{},cleanup:async()=>{clean=true;return {power:'Asleep'}}};
 const r=await reconcileStagedSession(old,{id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},startedAt:'2026-11-01T01:00:00Z',evidenceDir:'e'},d,async(x:any)=>{saved=x;return {runId:134,gainCoins:10}}, {package:'p',panelMarker:'赚金币抵钱'});
 assert.equal(r.runId,134);assert.equal(saved.result.receipt.taskAttemptId,'at');assert.equal(saved.result.sourceRunId,133);assert.equal(saved.result.recoveredAfterError,true);assert.equal(saved.result.balanceAfter,1550);assert.equal(clean,true);
});
