import test from 'node:test';import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
test('next-decision prepared session executes adopted task without collect or select replay',async()=>{
 const task={name:'A',instruction:'浏览',done:0,total:1},order:string[]=[];
 const stages=['open_app','enter_activity','open_list','select_task'].map(stageId=>({stageId,status:'completed',...(stageId==='select_task'?{task,balanceBefore:100}:{})}));
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'offline',startedAt:new Date().toISOString(),prepared:{taskAttemptId:'attempt',nextDecision:true,task,balanceBefore:100,stages}},{prepare:async()=>{throw Error('already prepared')},stage:async(id,c)=>{order.push(id);assert.equal(c.task.name,'A');assert.equal(c.balanceBefore,100);return {status:'completed',...(id==='settle'?{balanceAfter:120}:{})};},save:async()=>({runId:1}),cleanup:async()=>({deferred:true})});
 assert.equal(r.status,'completed');assert.deepEqual(order,['open_task','task_receipt','return_list','settle','review_task']);
});
