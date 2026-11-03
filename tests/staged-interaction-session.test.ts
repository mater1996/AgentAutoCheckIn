import test from 'node:test';
import assert from 'node:assert/strict';
import {runActivitySession} from '../runner/staged/session.ts';
test('session carries settle reward attribution into archive without changing source allocation',async()=>{
 const rewardAttribution={version:'separate-rewards-v1',selectedRewardCoins:10,incidentalRewards:[{kind:'milestone',coins:100,receipt:{frameId:'extra',path:'/offline/extra.png',quote:'额外奖励100金币',taskAttemptId:'attempt'}}]};let saved:any;
 const result=await runActivitySession({id:'offline',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},evidenceDir:'/unused',startedAt:'2026-11-03'}, {prepare:async()=>{},stage:async(id)=>({status:'completed',...(id==='settle'?{rewardAttribution,balanceAfter:110}: {})}),save:async(v)=>{saved=v;return {};},cleanup:async()=>({offline:true})});
 assert.deepEqual(saved.result.rewardAttribution,rewardAttribution);assert.deepEqual(result.rewardAttribution,rewardAttribution);
});
