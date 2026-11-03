import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PortalHybrid } from '../runner/portal-hybrid.ts';
const state = () => JSON.parse(fs.readFileSync(new URL('../evidence/portal-task-supervised-2026-10-31/before-read-3.json', import.meta.url),'utf8')).state;
const row = { name:'抢更多超级秒杀好物',instruction:'浏览5秒',quota:'0/1',reward:20,button:{text:'去完成',bounds:{left:853,top:1199,right:1034,bottom:1283}} };
function harness(overrides:any={}, failAction=false,slowVision=false) {
 let time=1000, queries=0;const actions:any[]=[];
 const page={pageIdentity:'赚金币抵钱',blocked:false,balance:1410,progress:'8/20',rows:[row],scrollBounds:{left:0,top:750,right:1080,bottom:2280},...overrides};
 const bridge=new PortalHybrid({
  portal:{readState:async()=>state(),tap:async(x,y)=>{actions.push(['tap',x,y]);if(failAction)throw Error('network secret');return {portalStatus:'success'};},swipe:async(p)=>{actions.push(['swipe',p]);return {portalStatus:'success'};},back:async()=>{actions.push(['back']);return {portalStatus:'success'};}},
  capture:async()=>({id:'f-'+time,dataUrl:'data:image/png;base64,fixture',width:1080,height:2400,capturedAt:time}),
  foreground:async()=>'com.taobao.taobao',vision:{query:async(f,p)=>{queries++;if(slowVision)time+=6000;assert.match(p,/完整/);assert.match(f.id,/^f-/);return structuredClone(page);}},
  now:()=>time,expectedPackage:'com.taobao.taobao',panelText:'赚金币抵钱',maxModelCalls:2,maxAgeMs:5000,
  rowRules:{panelText:'赚金币抵钱',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['去完成','领取奖励','去逛逛','逛一逛']},
 });
 return {bridge,actions,get queries(){return queries;},advance:()=>{time+=6000;}};
}
test('blocked, malformed, out-of-frame visual facts never authorize a Portal tap',async()=>{
 for(const bad of [{blocked:true},{blocked:null},{rows:null},{rows:[{...row,quota:'6/5'}]},
  {rows:[{...row,button:{text:'去完成',bounds:{left:1,top:1,right:2000,bottom:80}}}]},
  {balance:Infinity},{progress:'unknown'}]){
  const h=harness(bad);await assert.rejects(h.bridge.observe());assert.equal(h.actions.length,0);
 }
});

test('observations expire, mutation invalidates them, and model budget is enforced',async()=>{
 const h=harness();const o=await h.bridge.observe();o.rows[0].name='changed';
 await assert.rejects(h.bridge.tapTask(o,o.rows[0]),/invalid/);
 const good=await h.bridge.observe();h.advance();await assert.rejects(h.bridge.tapTask(good,row),/expired/);
 await assert.rejects(h.bridge.observe(),/budget/);assert.equal(h.actions.length,0);assert.equal(h.queries,2);
});
test('swipe and back share the dispatcher and invalidate every prior target',async()=>{
 const h=harness();const o=await h.bridge.observe();await h.bridge.swipe(o,{startX:540,startY:2080,endX:540,endY:1180,duration:450});
 await assert.rejects(h.bridge.back(o),/invalid|consumed/);assert.equal(h.actions.length,1);
 const next=await h.bridge.observe();await h.bridge.back(next);assert.equal(h.actions[1][0],'back');
});
test('a page mismatch, completed quota or invalid scroll cannot dispatch',async()=>{
 const h=harness({pageIdentity:'商品页面'});const o=await h.bridge.observe();await assert.rejects(h.bridge.tapTask(o,row),/panel/);
 const done=harness({rows:[{...row,quota:'1/1'}]});const d=await done.bridge.observe();await assert.rejects(done.bridge.tapTask(d,d.rows[0]),/quota/);
 const s=harness();const p=await s.bridge.observe();await assert.rejects(s.bridge.swipe(p,{startX:540,startY:400,endX:540,endY:1180,duration:450}),/scroll/);
});

test('uncertain action blocks further actions even after re-observation; concurrent taps dispatch once',async()=>{
 const h=harness({},true);const o=await h.bridge.observe();
 const both=await Promise.allSettled([h.bridge.tapTask(o,row),h.bridge.tapTask(o,row)]);
 assert.equal(h.actions.length,1);assert.equal(both.filter(x=>x.status==='rejected').length,1);
 assert.equal((both.find(x=>x.status==='fulfilled') as any).value.status,'unknown');
 const after=await h.bridge.observe();await assert.rejects(h.bridge.tapTask(after,row),/unresolved/);
});

test('concurrent observation is rejected so one frame cannot supersede an action mid-read',async()=>{
 const h=harness();const results=await Promise.allSettled([h.bridge.observe(),h.bridge.observe()]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.queries,1);
});

test('visual output with future or stale frame cannot become current',async()=>{
 const h=harness({},false,true);await assert.rejects(h.bridge.observe(),/expired/);
});

test('duplicate task identity cannot be resolved merely by matching button coordinates',async()=>{
 const h=harness({rows:[row,structuredClone(row)]});const o=await h.bridge.observe();
 await assert.rejects(h.bridge.tapTask(o,row),/ambiguous/);assert.equal(h.actions.length,0);
});

test('collection observation retains explicit top and bottom evidence in the same visual query',async()=>{
 const h=harness({atTop:true,atBottom:false,boundaryEvidence:{top:'今日累计奖励',bottom:''},tiers:[{coin:30,need:'',button:'立即领取'}]});
 const o=await h.bridge.observe();assert.equal(o.atTop,true);assert.equal(o.boundaryEvidence?.top,'今日累计奖励');assert.equal(o.tiers?.[0].coin,30);assert.equal(h.queries,1);
});

test('one shared visual query supplies rows and balance; Portal disagreement uses visual row identity',async()=>{
 const h=harness();const observation=await h.bridge.observe();
 assert.equal(h.queries,1);assert.equal(observation.balance,1410);assert.equal(observation.rowSource,'vision');
 await h.bridge.tapTask(observation,row);assert.deepEqual(h.actions,[['tap',944,1241]]);
 await assert.rejects(h.bridge.tapTask(observation,row),/consumed|invalid/);
});
