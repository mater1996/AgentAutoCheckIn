import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {observeHomeRewardAttribution} from '../runner/staged/home-revisit.ts';
const root=resolve(import.meta.dirname,'..');
const fixturePath=resolve(root,'data/evidence/home-revisit-integration/saved-page-observations.json');

test('hash-bound saved 110 replay preserves real receipt and unknown selected attribution',async()=>{
 const exists=await access(fixturePath).then(()=>true,()=>false);
 assert.equal(exists,true,'saved-page observation replay must be available');
 const fixture=JSON.parse(await readFile(fixturePath,'utf8'));
 const frames=[];
 for(const entry of fixture.pages){
  for(const ref of entry.sources)assert.equal(createHash('sha256').update(await readFile(resolve(root,ref.path))).digest('hex'),ref.sha256,'saved evidence was changed');
  const raw=JSON.parse(await readFile(resolve(root,entry.sources[1].path),'utf8'));
  if(raw.owner)assert.deepEqual(raw.owner,fixture.owner);
  frames.push({...raw,package:raw.owner?.package??raw.package,userId:raw.owner?.userId??raw.userId,taskAttemptId:fixture.owner.taskAttemptId,pngSha256:entry.sources[0].sha256});
 }
 let reads=0;
 const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task:fixture.task,owner:fixture.owner,balanceBefore:fixture.balanceBefore,frames},{readCurrentPage:async request=>{
  reads++;
  const page=fixture.pages.find((p:any)=>p.id===request.frame.id);
  assert.equal(request.pngSha256,page.sources[0].sha256);
  return {...fixture.owner,frameId:page.id,pngSha256:request.pngSha256,blocked:false,...page.observation};
 }});
 assert.equal(reads,fixture.pages.length);
 assert.equal(result.status,'unknown');assert.equal(result.gainCoins,null);assert.equal(result.balanceAfter,2815);
 assert.equal(result.rewardAttribution.selectedRewardCoins,null);assert.equal(result.receipt,undefined);
 assert.equal(result.rewardAttribution.incidentalRewards.length,1);
 assert.equal(result.rewardAttribution.incidentalRewards[0].coins,100);
 assert.equal(result.rewardAttribution.incidentalRewards[0].receipt.frameId,'03b01f93-b39d-4cc2-9b10-2ea07e3f1a64');
 assert.equal(result.unexplainedDelta,10);
 assert.deepEqual(result.issues,[]);
 const expected=JSON.parse(await readFile(resolve(root,'data/evidence/home-revisit-integration/replay-result.json'),'utf8'));
 assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
});
