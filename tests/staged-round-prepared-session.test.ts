// Offline orchestration boundary: no device, model or ledger access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
const prefix=['open_app','enter_activity','open_list','collect_list'].map(stageId=>({stageId,status:'completed'}));
const base={id:'round-child',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'offline',startedAt:new Date().toISOString()};
test('prepared task continues collected runtime with the same attempt and archives the prefix without relaunching',async()=>{
 const calls:string[]=[];
 const r=await runActivitySession({...base,prepared:{taskAttemptId:'round-attempt',stages:prefix}},{prepare:async()=>{throw Error('must not prepare twice')},stage:async(id,c)=>{calls.push(id);assert.equal(c.taskAttemptId,'round-attempt');return {status:'completed',...(id==='select_task'?{task:{name:'A',instruction:'浏览',done:0,total:1},balanceBefore:10}:{}),...(id==='task_receipt'?{receipt:{quote:'完成',taskAttemptId:c.taskAttemptId}}:{}),...(id==='settle'?{balanceAfter:20}:{})};},save:async(v)=>{assert.deepEqual(v.stages.slice(0,4),prefix);return {runId:1}},cleanup:async()=>({deferred:true})});
 assert.equal(r.status,'completed');assert.deepEqual(calls,['select_task','open_task','task_receipt','return_list','settle','review_task']);
});
test('round can prohibit navigation after uncertain input while still persisting and cleaning up',async()=>{
 const calls:string[]=[];let saved=false,cleaned=false;
 const r=await runActivitySession({...base,prepared:{taskAttemptId:'round-attempt',stages:prefix}},{prepare:async()=>{},stage:async(id:string)=>{calls.push(id);return id==='select_task'?{status:'completed',task:{name:'A',instruction:'浏览',done:0,total:1},balanceBefore:10}:{status:'unknown',error:'input uncertainty'};},canReturn:()=>false,save:async()=>{saved=true;return {runId:1}},cleanup:async()=>{cleaned=true;return {deferred:true}}} as any);
 assert.equal(r.status,'unknown');assert.equal(calls.includes('return_list'),false);assert.equal(saved,true);assert.equal(cleaned,true);
});
