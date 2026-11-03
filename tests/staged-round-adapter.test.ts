// Offline action boundary tests. No ADB, model HTTP, or SQLite access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoundDeviceBoundary,readRoundTaskOutcome,mergePriorRoundPlans,priorAttemptFromRun} from '../runner/staged/round-adapter.ts';
test('pre-input validation failure does not consume entry; started uncertain input does and forbids return',async()=>{
 let stage='open_task';const log:any[]=[];let failBefore=true;
 const b=createRoundDeviceBoundary({act:async(_a:any,_f:any,l:any)=>{if(failBefore)throw Error('bad frame');l?.beforeInput();throw Error('transport lost');}},()=>stage,e=>{log.push(e)});
 await assert.rejects(()=>b.device.act({type:'tap'},{}));assert.equal(b.state.entryDispatched,false);assert.equal(b.state.inputUnknown,false);
 failBefore=false;await assert.rejects(()=>b.device.act({type:'tap'},{}));assert.equal(b.state.entryDispatched,true);assert.equal(b.state.inputUnknown,true);assert.ok(log.some(e=>e.kind==='input_started'));
});
test('confirmed navigation and missing selected reward can continue other tasks without inventing income',()=>{
 const out=readRoundTaskOutcome({status:'unknown',runId:7,stages:[{stageId:'return_list',status:'completed'}]},{runId:7,partial:false,v2Archived:true,gainCoins:null},{entryDispatched:true,inputUnknown:false,blocked:false});
 assert.equal(out.returned,true);assert.equal(out.persistenceVerified,true);assert.equal(out.gainCoins,null);assert.equal(out.status,'unknown');
});
test('same batch attempts merge by identity and source run without double counting; explicit user skips persist',()=>{
 const t={name:'A',instruction:'浏览',attemptsThisBatch:1,attemptRunId:7};const skip={name:'S',instruction:'浏览',userSkip:true,decision:'skip'};
 const x=mergePriorRoundPlans([{path:'a',plan:{day:'2026-11-03',items:[t,skip]}},{path:'b',plan:{day:'2026-11-03',items:[t]}}],'2026-11-03');
 assert.equal(x.attempts.length,1);assert.equal(x.attempts[0].name,'A');assert.equal(x.userSkips.length,1);
});
test('ledger history consumes only actual task entry, preserving pre-dispatch failures as unattempted',()=>{
 const result={task:{name:'A',instruction:'浏览'},status:'stopped',taskAttemptId:'old'};
 const run={id:9,day:'2026-11-03'};
 assert.equal(priorAttemptFromRun(run,result,[{stageId:'open_task',status:'unknown',error:'geometry differs'}]),null);
 const attempt=priorAttemptFromRun(run,result,[{stageId:'open_task',actions:[{proposal:{action:{type:'tap'}},status:'verified'}]}]);
 assert.equal(attempt.attemptRunId,9);assert.equal(attempt.entryDispatched,true);assert.equal(attempt.status,'stopped');
});
