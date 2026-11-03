import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {activityLandingSource} from '../runner/staged/activity-navigation.ts';
const sources=['evidence/staged-2026-11-01T12-38-29-524Z/beac16b7-c76b-412f-8197-df8defaac7b6.json','evidence/staged-2026-11-01T13-18-06-815Z/ecf85474-b64c-4ad4-ac55-b38df98ef5f4.json','evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json'];
async function setup(mode='normal',initial=0){
 const frames=await Promise.all(sources.map(async p=>JSON.parse(await readFile(p,'utf8'))));let index=initial,id=0,calls=0;const actions:any[]=[];
 const cfg={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'local',activityId:'tb_coin',userId:0},localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:5000,sessionMs:30000,stageActions:4,agentCalls:3},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 const evidenceDir=await mkdtemp('/Users/mater/.hermes/cache/scratch/landing-runtime-');
 const runtime=createStagedRuntime(cfg,{capture:async()=>{const f=structuredClone(frames[index]);f.id='synthetic-landing-'+(++id);f.capturedAt=Date.now();if(mode==='wrong-owner'&&index===1)f.userId=999;return f;},act:async(a:any,f:any)=>{actions.push({a,f});if(a.type==='tap'){if(index===1&&mode==='uncertain')throw Error('unknown dispatch');if(index!==1||mode!=='no-effect')index++;}}},{query:async()=>{calls++;throw Error('model forbidden');}},{sessionId:'synthetic-cross-run-landing',evidenceDir,plan:[]});
 return {runtime,actions,evidenceDir,get calls(){return calls;}};
}
test('synthetic historical home to landing to panel uses one tap per owning stage',async()=>{
 const d=await setup(),entry=await d.runtime.stage('enter_activity',{});assert.equal(entry.status,'completed',entry.error);
 assert.deepEqual(d.actions.filter(x=>x.a.type==='tap').map(x=>x.a),[{type:'tap',x:864,y:487}]);
 const list=await d.runtime.stage('open_list',{});assert.equal(list.status,'completed',list.error);assert.equal(list.usedScriptVersion,activityLandingSource.version);
 assert.deepEqual(d.actions.filter(x=>x.a.type==='tap').map(x=>x.a),[{type:'tap',x:864,y:487},{type:'tap',x:115,y:998}]);
 await d.runtime.stage('enter_activity',{});await d.runtime.stage('open_list',{});assert.equal(d.actions.filter(x=>x.a.type==='tap').length,2);assert.equal(d.calls,0);
 const events=(await readFile(d.evidenceDir+'/runtime.jsonl','utf8')).trim().split('\n').map(x=>JSON.parse(x)).filter(x=>x.kind==='activity_navigation_attempted');assert.deepEqual(events.map(x=>x.stageId),['enter_activity','open_list']);
});
test('initial landing completes activity without tap and only open_list owns coin tap',async()=>{
 const d=await setup('normal',1);const entry=await d.runtime.stage('enter_activity',{});assert.equal(entry.status,'completed',entry.error);assert.equal(d.actions.length,0);
 const list=await d.runtime.stage('open_list',{});assert.equal(list.status,'completed',list.error);assert.equal(list.usedScriptVersion,activityLandingSource.version);assert.deepEqual(d.actions.filter(x=>x.a.type==='tap').map(x=>x.a),[{type:'tap',x:115,y:998}]);assert.equal(d.calls,0);
});
for(const mode of ['no-effect','uncertain','wrong-owner'])test('landing '+mode+' refuses repeat or model fallback',async()=>{
 const d=await setup(mode,1);const r=await d.runtime.stage('open_list',{});assert.notEqual(r.status,'completed');await d.runtime.stage('open_list',{});
 assert.equal(d.actions.filter(x=>x.a.type==='tap').length,mode==='wrong-owner'?0:1);assert.equal(d.calls,0);
});
