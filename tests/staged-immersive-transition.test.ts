import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url).pathname;
const load=()=>import('../runner/staged/immersive-transition.ts').catch(()=>null);
const source='evidence/staged-2026-11-01T10-35-22-744Z/';
test('184 exact observed reward transition is source-backed and attempt-bound',async()=>{
 const api=await load();assert.ok(api?.buildImmersiveTransition,'missing transition contract');
 const contract=await api.buildImmersiveTransition(root);
 const before=JSON.parse(fs.readFileSync(root+source+'3a3d237c-00d4-4502-82db-2e85d084e370.json','utf8'));
 const after=JSON.parse(fs.readFileSync(root+source+'33f7f285-7248-432d-8040-13aded9e3ebf.json','utf8'));
 const binding={taskAttemptId:'current',entryDispatched:true,browseFrame:before,receiptFrame:after,browseRewardCoins:20,receiptRewardCoins:35,waitMs:6000};
 assert.equal(await api.verifyImmersiveTransition(contract,binding),true);
 for(const change of [{taskAttemptId:''},{entryDispatched:false},{browseRewardCoins:50},{receiptRewardCoins:20},{waitMs:0},{receiptFrame:{...after,id:before.id}},{receiptFrame:{...after,userId:999}},{receiptFrame:{...after,capturedAt:before.capturedAt-1}}]){
  assert.equal(await api.verifyImmersiveTransition(contract,{...binding,...change}),false,JSON.stringify(change));
 }
 assert.equal(await api.verifyImmersiveTransition({...contract,receiptRewardCoins:50},binding),false);
});
