import test from 'node:test';import assert from 'node:assert/strict';
import {validateContinuation} from '../runner/staged/continuation.ts';
const scope={appId:'a',accountId:'b',activityId:'c',userId:0};
const session={scope,startedAt:'2026-11-01T02:00:00Z'};
const source={runId:136,status:'unknown',taskAttemptId:'attempt',task:{name:'T',instruction:'浏览',done:0,total:1},balanceBefore:1550,gainCoins:null};
test('continuation requires same scope, local day, unfinished source and no credited gain',()=>{
 assert.equal(validateContinuation(source,session,scope,'2026-11-01T03:00:00Z',false).runId,136);
 for(const [s,ss,sc,now,credited] of [[source,session,{...scope,userId:999},'2026-11-01T03:00:00Z',false],[source,session,scope,'2026-11-02T03:00:00Z',false],[{...source,status:'completed'},session,scope,'2026-11-01T03:00:00Z',false],[source,session,scope,'2026-11-01T03:00:00Z',true],[{...source,task:null},session,scope,'2026-11-01T03:00:00Z',false]]as any[]){assert.throws(()=>validateContinuation(s,ss,sc,now,credited),/continuation/i);}
});
