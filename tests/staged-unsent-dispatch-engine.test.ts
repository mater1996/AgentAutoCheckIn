import test from 'node:test';
import assert from 'node:assert/strict';
import {runStage} from '../runner/staged/engine.ts';
const f=(id:string)=>({id,path:'/synthetic/'+id+'.png',capturedAt:Date.now(),width:100,height:100,package:'com.offline',userId:0,lines:[]});
test('engine records the actual recovered proposal while preserving the consumed unsent source',async()=>{
 const first=f('first'),fresh=f('fresh');const error=Error('unsent');let observations=0;const sent:any[]=[];
 const r=await runStage({sessionId:'s',stageId:'enter_activity',taskAttemptId:'a',scope:{appId:'app',accountId:'offline',activityId:'coins',userId:0},goal:'arrive',expectedCheckpoint:'arrived',constraints:{allowedActions:['tap','wait']},budget:{maxMs:2000,maxActions:1,maxAgentCalls:0},script:{id:'local',version:'v1',validated:true}},{
  observe:async()=>++observations===1?first:f('arrival-'+observations),
  scriptStep:async()=>({frameId:first.id,action:{type:'tap',x:10,y:20},reason:'source',expected:'arrived'}),
  agentStep:async()=>{throw Error('No model');},
  dispatch:async(a:any,frame:any)=>{if(a.type==='wait')return;if(frame.id===first.id)throw error;sent.push({a,frame});},
  recoverUnsentDispatch:async(c:any,p:any,e:any)=>{assert.equal(e,error);assert.equal(c.frame.id,first.id);return {frame:fresh,proposal:{...p,frameId:fresh.id,action:{type:'tap',x:30,y:40}},proof:{inputSent:false}};},
  check:async(c:any)=>({done:c.frame.id.startsWith('arrival'),checkpoint:c.frame.id.startsWith('arrival')?'arrived':undefined}),
 } as any);
 assert.equal(r.status,'completed',r.error);assert.equal(sent.length,1);assert.equal(r.actions.length,1);assert.equal(r.actions[0].proposal.frameId,'fresh');
 const e=r.events.find(e=>e.type==='dispatch_not_sent_revalidated');assert.ok(e);assert.equal(e.sourceFrameId,'first');assert.equal((e.sourceProposal as any).action.x,10);assert.equal((e.proposal as any).action.x,30);
});
