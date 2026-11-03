import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
test('session reports persistence rejection even if every device stage claimed complete',async()=>{
 const r=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'e',startedAt:new Date().toISOString()}, {
 prepare:async()=>{},stage:async(id:string)=>id==='select_task'?{status:'completed',task:{name:'T',instruction:'浏览',done:0,total:1}}:{status:'completed'},save:async()=>({runId:1,gainCoins:null,partial:true,issues:['archive pending']}),cleanup:async()=>({asleep:true})
 }as any);
 assert.equal(r.status,'unknown');assert.match(r.error,/archive pending/);
});
