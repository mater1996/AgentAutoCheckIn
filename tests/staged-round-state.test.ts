import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {writeRoundState,readRoundState} from '../runner/staged/round-state.ts';
test('round state roundtrips attempts and refuses cross-batch or cross-account reuse',t=>{
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'round-state-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'state.json'),scope={appId:'a',activityId:'b',accountId:'c',userId:0};
 const s={id:'r',batchId:'batch',scope,attempts:[{name:'A',instruction:'浏览',status:'reserved'}]};
 writeRoundState(file,s);assert.deepEqual(readRoundState(file,'batch',scope),s);
 assert.throws(()=>readRoundState(file,'other',scope),/scope|batch/);assert.throws(()=>readRoundState(file,'batch',{...scope,accountId:'d'}),/scope|batch/);
 writeRoundState(file,{...s,attempts:[...s.attempts,{name:'B',instruction:'浏览',status:'completed'}]});assert.equal(readRoundState(file,'batch',scope).attempts.length,2);
});
