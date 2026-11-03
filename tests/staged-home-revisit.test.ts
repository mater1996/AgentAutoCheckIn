import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const modulePath=resolve(import.meta.dirname,'../runner/staged/home-revisit.ts');
const source=resolve(import.meta.dirname,'../evidence/supervised-current-2026-11-03T00-31-24-821Z');
const task={name:'从首页回访',instruction:'从首页入口或搜索回访'};
const owner={package:'com.taobao.taobao',userId:0,taskAttemptId:'offline-attempt'};
const selectedId='b9c92c18-9008-4325-8ad2-e54b626cf35e';
const incidentalId='03b01f93-b39d-4cc2-9b10-2ea07e3f1a64';
async function loadModule(){
 const loaded=await import(modulePath).catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?{}:Promise.reject(e));
 assert.equal(typeof loaded.observeHomeRewardAttribution,'function','home reward observer must exist');
 return loaded;
}
async function frame(id:string){return {...owner,id,path:resolve(source,id+'.png'),width:1080,height:2400,capturedAt:1,pngSha256:createHash('sha256').update(await readFile(resolve(source,id+'.png'))).digest('hex')};}
function decision(request:any,overrides:any={}){return {frameId:request.frame.id,pngSha256:request.pngSha256,...owner,page:'activity',blocked:false,rewards:[],...overrides};}

test('110 mixed delta remains unknown with only independent daily sign-in receipt',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const frames=[await frame(incidentalId),await frame(selectedId)];
 const requests:any[]=[];
 const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames},{readCurrentPage:async(request:any)=>{
  requests.push(request);
  return request.frame.id===incidentalId?decision(request,{rewards:[{role:'incidental',kind:'daily-sign-in',coins:100,quote:'签到成功 获得100淘金币',proof:'received',independent:true}]}):decision(request,{page:'owning-panel',balance:2815,selectedTaskState:'absent'});
 }});
 assert.equal(result.status,'unknown');
 assert.equal(result.balanceAfter,2815);
 assert.equal(result.assessment.balanceDelta,110);
 assert.equal(result.rewardAttribution.selectedRewardCoins,null);
 assert.equal(result.rewardAttribution.incidentalRewards[0].coins,100);
 assert.equal(result.unexplainedDelta,10);
 assert.equal(result.receipt,undefined);
 assert.equal(result.gainCoins,null);
 assert.equal(requests.length,2);
 assert.deepEqual(requests[0].task,task);
 assert.equal(requests[1].history.length,1);
 assert.equal(requests[0].interactionType,'home-revisit');
});

test('repeated sign-in banner is one incidental reward and selected offer is never a receipt',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const banner=await frame(incidentalId),panel=await frame(selectedId);
 const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[banner,{...banner,id:'next-banner'},panel]},{readCurrentPage:async(request:any)=>decision(request,request.frame.id===panel.id?{page:'owning-panel',balance:2815,rewards:[{role:'selected',kind:'home-revisit',coins:10,quote:'+10',proof:'offered',independent:true}]}:{rewards:[{role:'incidental',kind:'daily-sign-in',coins:100,quote:'签到成功 获得100淘金币',proof:'received',independent:true}]})});
 assert.equal(result.rewardAttribution.incidentalRewards.length,1);
 assert.equal(result.rewardAttribution.incidentalRewards[0].receipt.frameId,incidentalId);
 assert.equal(result.unexplainedDelta,10);
 assert.equal(result.rewardAttribution.selectedRewardCoins,null);
 assert.equal(result.status,'unknown');
});

test('ambiguous or malformed receipts poison attribution instead of crediting delta',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const current=await frame(selectedId);
 const selected={role:'selected',kind:'home-revisit',coins:110,quote:'OFFLINE ONLY: 回访成功 获得110淘金币',proof:'received',independent:true,task};
 for(const rewards of [[{...selected,task:{...task,instruction:'other'}}],[{...selected,coins:-1}],[{...selected,quote:''}],[selected,{...selected,coins:10}],null]){
  const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[current]},{readCurrentPage:async(request:any)=>decision(request,{page:'owning-panel',balance:2815,rewards})});
  assert.equal(result.status,'unknown');assert.equal(result.gainCoins,null);assert.ok(result.issues.length);
  assert.equal(result.assessment.accepted,false,'malformed observations cannot expose creditable assessment');
  assert.equal(result.rewardAttribution.selectedRewardCoins,null);
 }
});

test('explicit interaction selection and failed page reads stop observation without throwing',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const current=await frame(selectedId),base={interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[current]};
 for(const input of [{...base,interactionType:'browse'},{...base,task:{name:'',instruction:''}},{...base,frames:[{...current,path:'/offline/missing-frame.png'}]}]){
  let reads=0;
  const result=await observeHomeRewardAttribution(input,{readCurrentPage:async()=>{reads++;throw Error('must not be called');}});
  assert.equal(result.status,'unknown');assert.equal(reads,0);assert.ok(result.issues.length);
 }
 let reads=0;
 const result=await observeHomeRewardAttribution({...base,frames:[current,{...current,id:'next'}]},{readCurrentPage:async()=>{reads++;throw Error('offline reader failure');}});
 assert.equal(result.status,'unknown');assert.equal(reads,1);assert.match(result.issues.join(' '),/offline reader failure/);
});

test('independent selected receipt plus incidental receipt credits only selected coins',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const banner=await frame(incidentalId),panel=await frame(selectedId);
 // Synthetic reader output exercises a future positive route; this receipt never existed in the saved run.
 const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[banner,panel]},{readCurrentPage:async(request:any)=>decision(request,request.frame.id===banner.id?{rewards:[{role:'incidental',kind:'daily-sign-in',coins:100,quote:'签到成功 获得100淘金币',proof:'received',independent:true}]}:{page:'owning-panel',balance:2815,rewards:[{role:'selected',kind:'home-revisit',coins:10,quote:'SYNTHETIC TEST ONLY: 回访成功 获得10淘金币',proof:'received',independent:true,task}]})});
 assert.equal(result.status,'completed');assert.equal(result.gainCoins,10);assert.equal(result.unexplainedDelta,0);
 assert.equal(result.receipt.frameId,panel.id);assert.equal(result.rewardAttribution.incidentalRewards[0].receipt.frameId,banner.id);
 const signTask={name:'每日签到',instruction:'自动签到领取淘金币'};
 const sign=await observeHomeRewardAttribution({interactionType:'automatic-sign-in',task:signTask,owner,balanceBefore:2705,frames:[banner,panel]},{readCurrentPage:async(request:any)=>decision(request,request.frame.id===banner.id?{rewards:[{role:'selected',kind:'daily-sign-in',coins:100,quote:'签到成功 获得100淘金币',proof:'received',independent:true,task:signTask}]}:{page:'owning-panel',balance:2805})});
 assert.equal(sign.status,'completed');assert.equal(sign.gainCoins,100);
});

test('foreign frame or reader provenance cannot create a selected reward',async()=>{
 const {observeHomeRewardAttribution}=await loadModule();
 const original=await frame(selectedId);
 for(const mutation of [{taskAttemptId:'foreign'},{package:'other.app'},{userId:1},{pngSha256:'0'.repeat(64)},{observationError:'OCR failed'}]){
  let reads=0;
  const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[{...original,...mutation}]},{readCurrentPage:async(request:any)=>{reads++;return decision(request,{page:'owning-panel',balance:2815});}});
  assert.equal(result.status,'unknown',JSON.stringify(mutation));
  assert.equal(reads,0,'invalid input must not reach reader');
  assert.ok(result.issues.length);
 }
 for(const mutation of [{taskAttemptId:'foreign'},{package:'other.app'},{userId:1},{frameId:'other'},{pngSha256:'0'.repeat(64)},{blocked:true}]){
  const result=await observeHomeRewardAttribution({interactionType:'home-revisit',task,owner,balanceBefore:2705,frames:[original]},{readCurrentPage:async(request:any)=>decision(request,{page:'owning-panel',balance:2815,rewards:[{role:'selected',kind:'home-revisit',coins:110,quote:'回访成功 获得110淘金币',proof:'received',independent:true}],...mutation})});
  assert.equal(result.status,'unknown',JSON.stringify(mutation));
  assert.equal(result.gainCoins,null);
  assert.equal(result.rewardAttribution.selectedRewardCoins,null);
  assert.ok(result.issues.length);
 }
});
