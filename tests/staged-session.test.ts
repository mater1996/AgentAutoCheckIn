import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
test('explicit continuation keeps the failed task attempt and baseline without opening a different task',async()=>{
 const order:string[]=[];
 const resume={status:'unknown',runId:136,taskAttemptId:'original-attempt',task:{name:'T',instruction:'浏览15秒',done:0,total:1},balanceBefore:1550,receipt:null};
 const r=await runActivitySession({id:'resumed',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'e',startedAt:new Date().toISOString(),resume}, {
  prepare:async()=>{},stage:async(id:string,c:any)=>{order.push(id);assert.equal(c.taskAttemptId,'original-attempt');assert.equal(c.task.name,'T');if(id==='task_receipt')return {status:'completed',receipt:{quote:'任务完成',taskAttemptId:c.taskAttemptId,path:'p'}};if(id==='settle')return {status:'completed',balanceAfter:1560};return {status:'completed'};},
  save:async(v:any)=>{assert.equal(v.result.sourceRunId,136);assert.equal(v.result.recoveredAfterError,true);return {runId:137};},cleanup:async()=>({asleep:true})
 }as any);
 assert.equal(r.status,'completed');assert.equal(r.balanceBefore,1550);
 assert.deepEqual(order,['open_app','open_task','task_receipt','return_list','settle','review_task']);
});
test('one-task session carries receipt through return, settlement, archival and cleanup',async()=>{
 const order:string[]=[];const seen:any[]=[];
 const deps:any={
  prepare:async()=>order.push('prepare'),
  stage:async(id:string,context:any)=>{order.push(id);seen.push(structuredClone(context));if(id==='select_task')return {status:'completed',task:{name:'T',instruction:'浏览',done:0,total:3},balanceBefore:100};if(id==='task_receipt')return {status:'completed',receipt:{quote:'完成',taskAttemptId:context.taskAttemptId,path:'receipt.png'}};if(id==='settle')return {status:'completed',balanceAfter:120};return {status:'completed'};},
  save:async(v:any)=>{order.push('save');assert.equal(v.result.receipt.taskAttemptId,v.result.taskAttemptId);return {runId:1};},
  cleanup:async()=>{order.push('cleanup');return {asleep:true};},
 };
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'e',startedAt:new Date().toISOString()},deps);
 assert.equal(r.status,'completed');assert.equal(r.balanceAfter,120);assert.equal(r.runId,1);
 assert.deepEqual(order,['prepare','open_app','enter_activity','open_list','collect_list','select_task','open_task','task_receipt','return_list','settle','review_task','save','cleanup']);
 assert.ok(seen.find(x=>x.receipt)?.receipt);
});
test('failed task retains unknown action, attempts bounded return, never calls settlement as success',async()=>{
 const order:string[]=[];
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'e',startedAt:new Date().toISOString()}, {
  prepare:async()=>{},stage:async(id:string)=>{order.push(id);if(id==='select_task')return {status:'completed',task:{name:'T',instruction:'浏览',done:0,total:1},balanceBefore:100};if(id==='open_task')return {status:'unknown',error:'dispatch timed out'};return {status:'completed'};},save:async(v:any)=>{assert.equal(v.result.status,'unknown');assert.equal(v.result.balanceAfter,null);return {runId:2};},cleanup:async()=>({asleep:true})
 }as any);
 assert.equal(r.status,'unknown');assert.equal(order.includes('task_receipt'),false);assert.equal(order.includes('settle'),false);assert.equal(order.filter(x=>x==='return_list').length,1);
});
test('archive failure still cleans up and reports failure rather than success',async()=>{
 let cleaned=false;
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'e',startedAt:new Date().toISOString()}, {prepare:async()=>{},stage:async()=>({status:'stopped',error:'no task'}),save:async()=>{throw Error('disk failure')},cleanup:async()=>{cleaned=true;return {asleep:true}}}as any);
 assert.equal(cleaned,true);assert.notEqual(r.status,'completed');assert.match(r.error,/disk failure/);
});
