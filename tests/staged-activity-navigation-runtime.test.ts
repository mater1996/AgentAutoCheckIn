import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {activityNavigationSource,activityLandingSource} from '../runner/staged/activity-navigation.ts';
const home='evidence/staged-2026-11-01T12-38-29-524Z/beac16b7-c76b-412f-8197-df8defaac7b6.json';
const panel='evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json';
async function setup(mode='normal',extra:any={}){
 const selectedHome=mode==='199-open'?'evidence/staged-2026-11-01T12-48-57-664Z/31fc0e2c-e563-45ba-a0e2-fc3bb4b29c9f.json':mode==='199-enter'?'evidence/staged-2026-11-01T12-48-57-664Z/11e3c401-c043-4db0-a3ce-e97948a31973.json':home;
 const h=JSON.parse(await readFile(selectedHome,'utf8')),p=JSON.parse(await readFile(panel,'utf8'));let index=0,id=0,calls=0;
 const actions:any[]=[];
 const cfg={package:'com.taobao.taobao',scope:{appId:'taobao',accountId:'local',activityId:'tb_coin',userId:0},localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:3000,sessionMs:10000,stageActions:3,agentCalls:3},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 const evidenceDir=await mkdtemp('/Users/mater/.hermes/cache/scratch/nav-runtime-');
 const runtime=createStagedRuntime(cfg,{capture:async()=>{const f=structuredClone(index?p:h);f.id='replay-'+(++id);f.capturedAt=Date.now();if(mode==='wrong-owner')f.userId=999;if(mode==='unknown')f.lines=f.lines.filter((l:any)=>l.text==='领淘金币');return f;},act:async(a:any,f:any)=>{actions.push({a,f});if(a.type==='tap'){if(mode==='uncertain')throw Error('uncertain');if(mode!=='no-effect')index=1;}}},{query:async()=>{calls++;throw Error('model forbidden');}},{sessionId:'nav-replay',plan:[],...extra,evidenceDir});
 return {runtime,actions,evidenceDir,get calls(){return calls;}};
}
for(const [stageId,source]of [['enter_activity',activityNavigationSource],['open_list',activityLandingSource]]as const)test('navigation records current implementation version '+stageId,async()=>{
 let used:any;
 const d=await setup('normal',{runStage:async(input:any,deps:any)=>{used=input.script;const review=await deps.review({status:'stopped',actions:[],events:[]});return {status:'stopped',actions:[],events:[],review};}});
 const r=await d.runtime.stage(stageId,{});
 assert.equal(used.version,source.version,'engine script must identify current implementation');
 assert.equal(r.review.candidate.version,source.version,'review must identify the same implementation');
 assert.equal(r.review.candidate.sourceRunId,source.sourceRunId);
 assert.equal(d.actions.length,0);assert.equal(d.calls,0);
});
test('198 home to real task panel through engine performs one bound tap and no model',async()=>{
 const d=await setup();const r=await d.runtime.stage('enter_activity',{});assert.equal(r.status,'completed',r.error);
 assert.equal(d.actions.filter(x=>x.a.type==='tap').length,1);assert.equal(d.calls,0);
 assert.equal(r.actions[0].proposal.frameId,d.actions[0].f.id);assert.ok(r.events.some((e:any)=>e.type==='authority_consumed'));
 assert.equal((await d.runtime.stage('open_list',{})).status,'completed');
 await d.runtime.stage('enter_activity',{});assert.equal(d.actions.filter(x=>x.a.type==='tap').length,1);
});
for(const mode of ['199-open','199-enter'])test(`${mode} uses default navigation through runtime with one tap and no model`,async()=>{
 const d=await setup(mode),r=await d.runtime.stage('enter_activity',{});
 assert.equal(r.status,'completed',r.error);assert.equal(d.calls,0);const taps=d.actions.filter(x=>x.a.type==='tap');assert.equal(taps.length,1);
 assert.deepEqual(taps[0].a,{type:'tap',x:862,y:487});const action=r.actions.find((x:any)=>x.proposal.action.type==='tap');assert.equal(action.proposal.frameId,taps[0].f.id);
 await d.runtime.stage('enter_activity',{});assert.equal(d.actions.filter(x=>x.a.type==='tap').length,1);
});
test('199 missing glyph refinement is persisted inside session with exact source and hashes',async()=>{
 const d=await setup('199-enter'),r=await d.runtime.stage('enter_activity',{});assert.equal(r.status,'completed',r.error);
 const attempt=d.actions.find(x=>x.a.type==='tap');assert.ok(attempt);
 const evidenceDir=d.evidenceDir;
 const records=(await readFile(path.join(evidenceDir,'runtime.jsonl'),'utf8')).trim().split('\n').map(x=>JSON.parse(x));
 const known=records.find(x=>x.kind==='activity_navigation_attempted'),ref=known?.chromeRefinement;
 assert.ok(ref,'missing same-frame OCR refinement provenance');assert.equal(ref.frameId,attempt.f.id);
 const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 for(const [file,hash]of [[ref.path,ref.cropSha],[ref.rawPath,ref.sourceSha],[ref.ocrPath,ref.ocrSha]]){
  assert.ok(path.resolve(file).startsWith(path.resolve(evidenceDir)+path.sep));assert.equal(sha(await readFile(file)),hash);
 }
 assert.deepEqual(await readFile(ref.rawPath),await readFile(attempt.f.path));
 const raw=JSON.parse(await readFile(ref.ocrPath,'utf8'));assert.equal(raw.pages[0].file,ref.ocrInputPath);
 assert.deepEqual(raw.pages[0].lines.map((x:any)=>x.text),['淘']);assert.equal(attempt.f.lines.filter((x:any)=>x.text==='淘').length,0);
});
test('resumed runtime refuses navigation without durable original authority',async()=>{
 const d=await setup('normal',{resume:{runId:198}});const r=await d.runtime.stage('enter_activity',{});assert.notEqual(r.status,'completed');assert.equal(d.actions.length,0);assert.equal(d.calls,0);
});
for(const mode of ['clone-action','clone-frame','altered-coordinate'])test(`dispatch refuses ${mode} authority`,async()=>{
 const d=await setup('normal',{runStage:async(input:any,deps:any)=>{
  const frame=await deps.observe(),ctx={frame};const p=await deps.scriptStep(ctx);
  await assert.rejects(()=>deps.dispatch(mode==='clone-action'?{...p.action}:mode==='altered-coordinate'?{...p.action,x:100}:p.action,mode==='clone-frame'?{...frame}:frame),/not authorized/);
  return {status:'stopped',actions:[],events:[]};
 }});await d.runtime.stage('enter_activity',{});assert.equal(d.actions.length,0);assert.equal(d.calls,0);
});
test('open_list on home stops because activity landing route is unlearned',async()=>{
 const d=await setup();const r=await d.runtime.stage('open_list',{});assert.notEqual(r.status,'completed');assert.match(r.error,/open_list not learned/);assert.equal(d.actions.length,0);assert.equal(d.calls,0);
});
for(const mode of ['unknown','wrong-owner','no-effect','uncertain'])test(`local navigation ${mode} stops without model or replay`,async()=>{
 const d=await setup(mode);const r=await d.runtime.stage('enter_activity',{});assert.notEqual(r.status,'completed');await d.runtime.stage('enter_activity',{});
 assert.equal(d.calls,0);assert.equal(d.actions.filter(x=>x.a.type==='tap').length,['no-effect','uncertain'].includes(mode)?1:0);
});
