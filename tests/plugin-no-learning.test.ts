import test from 'node:test';import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
test('activity execution skips learning reviews while retaining receipt return and settlement',async()=>{
 const seen:string[]=[];const task={name:'browse',instruction:'read',done:0,total:1};
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'u',activityId:'x',userId:0},evidenceDir:'offline',startedAt:new Date().toISOString(),skipReview:true,prepared:{taskAttemptId:'t',nextDecision:true,task,balanceBefore:10,stages:['open_app','enter_activity','open_list','select_task'].map(stageId=>({stageId,status:'completed'}))}}, {prepare:async()=>{},stage:async(stageId)=>{seen.push(stageId);return {status:'completed'}},save:async()=>({runId:1}),cleanup:async()=>({})});
 assert.equal(r.status,'completed');assert.deepEqual(seen,['open_task','task_receipt','return_list','settle']);assert.deepEqual(r.reviews,[]);
});
