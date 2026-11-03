import test from 'node:test';import assert from 'node:assert/strict';import {runActivitySession} from '../runner/staged/session.ts';import {createInteractionRoute} from '../runner/staged/interaction.ts';
test('home adapter receives every stage and exposes its receipt and authority',async()=>{
 const task={name:'explicit revisit',instruction:'home visit'},seen:string[]=[];const receipt={taskAttemptId:'a',frameId:'r',quote:'test'};
 const adapter={stage:async(id:string)=>{seen.push(id);return {status:'completed',receipt};},receipt,unknown:false,ownsEntry:true,attribution:{rewardAttribution:{selectedRewardCoins:10}}};
 const route=createInteractionRoute({sessionId:'s'},{type:'home-revisit',task},{homeRevisit:adapter});
 for(const id of ['open_task','task_receipt','return_list'])assert.equal((await route.stage(id,{task,taskAttemptId:'a'})).status,'completed');
 assert.deepEqual(seen,['open_task','task_receipt','return_list']);assert.equal(route.receipt,receipt);assert.equal(route.ownsEntry,true);assert.equal(route.attribution,adapter.attribution);
});
test('unknown home receipt still archives return attribution without promoting navigation to task completion',async()=>{
 let saved:any;const attribution={version:'separate-rewards-v1',selectedRewardCoins:null,incidentalRewards:[{kind:'sign-in',coins:100,receipt:{frameId:'inc',path:'/offline/inc.png',quote:'签到成功 获得100淘金币',taskAttemptId:'a'}}]};
 const result=await runActivitySession({id:'s',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'/offline',startedAt:'2026-11-03'}, {prepare:async()=>{},stage:async(id)=>{
  if(id==='select_task')return {status:'completed',task:{name:'visit',instruction:'home',done:0,total:1},balanceBefore:2705};
  if(id==='task_receipt')return {status:'unknown',error:'missing selected receipt'};
  if(id==='return_list')return {status:'completed',balanceAfter:2815,rewardAttribution:attribution,unexplainedDelta:10,attributionStatus:'unknown'};
  return {status:'completed'};
 },save:async v=>{saved=v;return {};},cleanup:async()=>({offline:true})});
 assert.equal(result.status,'unknown');assert.deepEqual(saved.result.rewardAttribution,attribution);assert.equal(saved.result.unexplainedDelta,10);assert.equal(saved.result.attributionStatus,'unknown');assert.equal(saved.result.balanceAfter,2815);
});
