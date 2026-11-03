// Offline next-decision control flow: no device/model/SQLite.
import test from 'node:test';import assert from 'node:assert/strict';
import {runActivityRound} from '../runner/staged/round.ts';
test('next-decision loop executes selected tasks immediately without bulk collect or global planning',async()=>{
 let n=0;const actions:string[]=[];const tasks=['A','B'];const r=await runActivityRound({id:'next',batchId:'b'},{prepare:async()=>{},collect:async()=>{throw Error('bulk collect forbidden')},plan:async()=>{throw Error('global planner forbidden')},next:async()=>n<2?{decision:'task',item:{name:tasks[n],instruction:'浏览',done:0,total:1,decision:'do',times:1,reason:'current screenshot'},selection:{frame:{id:'fresh'+n}}}:{decision:'finish',coverage:{top:true,bottom:true}},execute:async(i:any)=>{actions.push(i.name);n++;return {status:'completed',entryDispatched:true,inputUnknown:false,blocked:false,returned:true,persistenceVerified:true,gainCoins:10}},finish:async()=>({confirmed:true}),cleanup:async()=>({errors:[]}),persist:()=>{}} as any);
 assert.equal(r.status,'completed');assert.deepEqual(actions,['A','B']);assert.equal(r.attempts.length,2);
});
test('next-decision loop refuses an already consumed candidate without replaying input',async()=>{
 let calls=0;const r=await runActivityRound({id:'n',attempts:[{identity:'["A","浏览"]',name:'A',instruction:'浏览',status:'consumed',reservationId:'old',evidenceKey:'old'}]},{prepare:async()=>{},next:async()=>({decision:'task',item:{name:'A',instruction:'浏览',done:0,total:2,decision:'do',times:1}}),execute:async()=>{calls++;},finish:async()=>{},cleanup:async()=>{},persist:()=>{}} as any);
 assert.equal(calls,0);assert.notEqual(r.status,'completed');
});
test('current screen without proven full search cannot terminate as all done',async()=>{
 let finish=0;const r=await runActivityRound({id:'n'},{prepare:async()=>{},next:async()=>({decision:'finish',coverage:{top:false,bottom:true}}),finish:async()=>{finish++},cleanup:async()=>{},persist:()=>{}} as any);
 assert.equal(finish,0);assert.equal(r.status,'unknown');assert.match(r.errors[0],/coverage/);
});
test('next-decision unknown input stops without selecting another task or HOME input',async()=>{
 let next=0,finish=0,clean=0;const r=await runActivityRound({id:'n'},{prepare:async()=>{},next:async()=>{next++;return {decision:'stop',inputUnknown:true,error:'scroll dispatch unknown'}},finish:async()=>{finish++},cleanup:async()=>{clean++},persist:()=>{}} as any);
 assert.equal(next,1);assert.equal(finish,0);assert.equal(clean,1);assert.equal(r.status,'unknown');
});
