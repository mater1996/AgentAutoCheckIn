// Offline session seam: synthetic stage observations, no live systems.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
const base={id:'round-blocked',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'offline',startedAt:new Date().toISOString()};
test('known prepared task with unknown input does not navigate back',async()=>{
 const calls:string[]=[];
 const r=await runActivitySession(base,{prepare:async()=>{},stage:async(id)=>{calls.push(id);if(id==='select_task')return {status:'completed',task:{name:'A',instruction:'浏览',done:0,total:1},balanceBefore:10};if(id==='open_task')return {status:'unknown',error:'input uncertainty'};return {status:'completed'};},canReturn:()=>false,save:async()=>({runId:1}),cleanup:async()=>({deferred:true})});
 assert.equal(r.status,'unknown');assert.equal(calls.includes('return_list'),false);
});
