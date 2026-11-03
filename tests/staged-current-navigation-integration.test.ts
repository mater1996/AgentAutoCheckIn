import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {verifyAuditActivityNavigation,verifyAuditNavigationStages} from '../runner/staged/script-validation.ts';
import {navigationSourceFiles,archivePlanInput} from '../runner/staged/main.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
const owner={package:'com.taobao.taobao',userId:0};
function config(extra:any={}){return {scope:{appId:'taobao',accountId:'offline',activityId:'coins',userId:0},package:owner.package,assetId:'coins',model:{baseUrl:'http://127.0.0.1:1/v1',name:'offline'},navigationPolicy:'current-text-v1',localActivityNavigation:true,aiPanelReader:true,aiTaskRecovery:false,scriptValidationMode:false,balanceComponent:false,panelMarker:'赚金币抵钱',constraints:['ordinary approved navigation'],limits:{maxTasks:1,sessionMs:60000,stageMs:10000,agentCalls:8,stageActions:3,inventoryPages:3,maxReturns:2},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}])),...extra};}
test('current navigation policy requires explicit local navigation and preserves AI panel permissions',()=>{
 const c=config();assert.equal(validateStagedConfig(c),c);
 for(const navigationPolicy of [null,true,1,{},'legacy','current-text-v2'])assert.throws(()=>validateStagedConfig({...c,navigationPolicy}),/navigation policy/i);
 for(const localActivityNavigation of [false,undefined])assert.throws(()=>validateStagedConfig({...c,localActivityNavigation}),/navigation policy/i);
 assert.equal(validateStagedConfig({...c,navigationPolicy:undefined,localActivityNavigation:false}).navigationPolicy,undefined);
 assert.equal(validateStagedConfig({...c,aiPanelReader:false,scriptValidationMode:true}).scriptValidationMode,true);
});
const sources={home:'evidence/staged-2026-11-02T01-25-13-762Z/8481bb37-6035-4ee2-87bb-f41b989c4a78.json',landing:'evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.json',panel:'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json'};
// Real historical image/OCR bytes; only paths, ids, timestamps and transitions are synthetic.
export async function fixture(mode='normal',extra:any={},options:any={}){
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/current-navigation-runtime-');
 let state:'home'|'landing'|'panel'='home',id=0,calls=0;const actions:any[]=[],queries:any[]=[];
 const capture=async()=>{
  const f=JSON.parse(fs.readFileSync(sources[state],'utf8')),raw=JSON.parse(fs.readFileSync(f.path.replace(/\.png$/,'.ocr.json'),'utf8'));
  const original=f.path;f.id='synthetic-'+(++id);f.path=path.join(dir,f.id+'.png');f.capturedAt=Date.now();
  delete f.aiPanelEvidence;f.systemObservation={version:'android-system-v1',before:null,after:null};fs.copyFileSync(original,f.path);raw.pages[0].file=f.path;
  if(mode==='wrong-owner')f.userId=999;
  if(mode==='stale')f.capturedAt-=20000;
  if(mode==='ambiguous'&&state==='home'){f.lines=[];raw.pages[0].lines=[];}
  fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 };
 const model=options.model??{usage:[],query:async(q:any)=>{calls++;queries.push(q);throw Error('offline model forbidden');}};
 const rt=createStagedRuntime(config({aiPanelReader:false,scriptValidationMode:true,...extra}),{capture,act:async(a:any,f:any)=>{actions.push({action:a,frame:f});if(a.type==='tap'){if(mode==='unknown')throw Error('uncertain dispatch');if(mode!=='no-effect')state=state==='home'?'landing':'panel';}}},model,{sessionId:'offline-current',evidenceDir:dir,plan:[],...options});
 return {rt,actions,queries,dir,get calls(){return calls}};
}
test('run223 home to historical landing to panel uses real engine with no model and actual route records',async()=>{
 const d=await fixture();
 for(const stage of ['enter_activity','open_list']){const r=await d.rt.stage(stage,{taskAttemptId:'offline-attempt'});assert.equal(r.status,'completed',r.error);}
 assert.equal(d.calls,0);assert.equal(d.actions.filter(a=>a.action.type==='tap').length,2);
 const records=fs.readFileSync(path.join(d.dir,'navigation-records.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.ok(records.some(r=>r.kind==='observation'&&r.pageKind==='home'&&r.stageId==='enter_activity'&&r.taskAttemptId==='offline-attempt'&&r.expectedCheckpoint==='enter_activity'&&r.systemObservation.version==='android-system-v1'));
 assert.ok(records.some(r=>r.kind==='observation'&&r.pageKind==='landing'&&r.stageId==='enter_activity'));
 const routes=records.filter(r=>r.kind==='arrival');assert.deepEqual(routes.map(r=>[r.before.pageKind,r.after.pageKind,r.status]),[['home','landing','confirmed'],['landing','panel','confirmed']]);
});
for(const mode of ['wrong-owner','stale','unknown','no-effect'])test('current navigation '+mode+' never replays or confirms missing arrival',async()=>{
 const d=await fixture(mode);assert.notEqual((await d.rt.stage('enter_activity',{})).status,'completed');await d.rt.stage('enter_activity',{});
 assert.equal(d.actions.filter(a=>a.action.type==='tap').length,['unknown','no-effect'].includes(mode)?1:0);assert.equal(d.calls,0);
 const file=path.join(d.dir,'navigation-records.jsonl');if(fs.existsSync(file))assert.ok(!fs.readFileSync(file,'utf8').includes('"status":"confirmed"'));
});
test('known navigation checkpoints bypass full AI panel schema until collection',async()=>{
 const d=await fixture('normal',{aiPanelReader:true,scriptValidationMode:false});
 assert.equal((await d.rt.stage('enter_activity',{})).status,'completed');assert.equal(d.calls,0);
 assert.equal((await d.rt.stage('open_list',{})).status,'completed');assert.equal(d.calls,0);
 assert.equal(d.actions.filter(a=>a.action.type==='tap').length,2);
});
test('ambiguous current home uses one original PNG navigation query and revalidates same proof at dispatch',async()=>{
 let calls=0;const requests:any[]=[];
 const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage:[],query:async(q:any)=>{calls++;requests.push(q);return {pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]}]};}}});
 const r=await d.rt.stage('enter_activity',{});assert.equal(r.status,'completed',r.error);assert.equal(calls,1);assert.equal(d.actions.filter(a=>a.action.type==='tap').length,1);
 assert.match(requests[0].prompt,/observation only/i);assert.ok(!requests[0].prompt.includes('balance'));
 assert.ok(fs.readdirSync(d.dir).some(f=>f.startsWith('navigation-reader-')&&f.endsWith('.response.json')));
});
test('current policy audit replays actual offline engine source and arrivals without historical templates',async()=>{
 const d=await fixture();const stages=[];
 fs.writeFileSync(path.join(d.dir,'session.json'),JSON.stringify({startedAt:new Date(Date.now()-1000).toISOString()}));
 for(const stage of ['enter_activity','open_list'])stages.push(await d.rt.stage(stage,{}));
 const frame=stages[0].events.find((e:any)=>e.type==='observed').frame;
 assert.equal((await verifyAuditActivityNavigation({root:d.dir,frame,owner,policy:'current-text-v1'}))?.state,'home');
 assert.equal(await verifyAuditActivityNavigation({root:d.dir,frame,owner}),null);
 const runtime=fs.readFileSync(path.join(d.dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(await verifyAuditNavigationStages({root:d.dir,evidenceDir:d.dir,config:config(),stages,runtime,sessionId:'offline-current',taskAttemptId:'offline-attempt'}),true);
});
test('main archives enabled navigation dependencies and exact plan input bytes',()=>{
 assert.deepEqual(navigationSourceFiles(config()),['runner/staged/navigation-reader.ts','runner/staged/navigation-records.ts','runner/staged/script-validation.ts','runner/staged/system-observation.ts']);assert.deepEqual(navigationSourceFiles(config({navigationPolicy:undefined})),[]);
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/navigation-plan-'),file=path.join(dir,'input.json'),bytes=Buffer.from(' {"tasks": []} \n');fs.writeFileSync(file,bytes);
 const manifest=archivePlanInput(file,dir);assert.deepEqual(fs.readFileSync(manifest.path),bytes);assert.equal(manifest.sha256,createHash('sha256').update(bytes).digest('hex'));
});
for(const mutation of ['owner','png','stage','response','stale'])test('reader dispatch revalidates '+mutation+' without another model call',async()=>{
 let calls=0;
 const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage:[],query:async()=>{calls++;return {pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]}]};}},runStage:async(input:any,deps:any)=>{
  const frame=await deps.observe(),proposal=await deps.scriptStep({frame});assert.ok(proposal.action);
  if(mutation==='owner')frame.userId=999;
  if(mutation==='stage')frame.navigationEvidence.stageId='open_list';
  if(mutation==='stale')frame.capturedAt-=20000;
  if(mutation==='png')fs.appendFileSync(frame.path,'changed');
  if(mutation==='response')fs.appendFileSync(frame.navigationEvidence.rawResponse.path,'changed');
  await assert.rejects(()=>deps.dispatch(proposal.action,frame),/mismatch|expired/);return {status:'stopped',events:[],actions:[]};
 }});
 await d.rt.stage('enter_activity',{});assert.equal(calls,1);assert.equal(d.actions.length,0);
});
test('saved ambiguous reader audit uses the original accepted proof and rejects wrong stage',async()=>{
 const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage:[],query:async()=>({pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]}]})}});
 const result=await d.rt.stage('enter_activity',{}),frame=result.events.find((e:any)=>e.type==='observed').frame;
 assert.equal((await verifyAuditActivityNavigation({root:d.dir,frame,owner,policy:'current-text-v1',stageId:'enter_activity',expectedCheckpoint:'enter_activity'}))?.state,'home');
 assert.equal(await verifyAuditActivityNavigation({root:d.dir,frame,owner,policy:'current-text-v1',stageId:'open_list',expectedCheckpoint:'open_list'}),null);
});
test('actual panel still uses approved AI panel data after local navigation',async()=>{
 const calls:any[]=[];const usage:any[]=[];
 const d=await fixture('normal',{aiPanelReader:true,scriptValidationMode:false},{model:{usage,query:async(q:any)=>{calls.push(q);usage.push({tokens:17});return {isPanel:true,balance:123456,blocked:false,top:false,bottom:false,tasks:[],clippedRows:[]};}}});
 assert.equal((await d.rt.stage('enter_activity',{})).status,'completed');assert.equal(calls.length,0);
 assert.equal((await d.rt.stage('open_list',{})).status,'completed');assert.equal(calls.length,0);
 const collected=await d.rt.stage('collect_list',{});assert.equal(collected.status,'stopped','synthetic answer intentionally has no top');assert.ok(calls.length>0);
 assert.ok(calls.every(q=>q.prompt.includes('isPanel')));
 const final=d.rt.frames.at(-1);assert.equal(final.aiPanelEvidence.status,'accepted');assert.equal(final.aiPanelEvidence.usage.length,1);
});
for(const raw of [{pageKind:'blocked',targets:[]},{pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]},{text:'领淘金币',bounds:[770,630,965,825]}]},{pageKind:'home',targets:[{text:'领淘金币',bounds:[-1,330,965,525]}]}] )test('reader rejects blocked/duplicate/unsafe observation '+JSON.stringify(raw),async()=>{
 let calls=0;const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage:[],query:async()=>{calls++;return raw;}}});
 assert.notEqual((await d.rt.stage('enter_activity',{})).status,'completed');assert.equal(calls,1);assert.equal(d.actions.length,0);
});
test('navigation reader charges usage and never calls twice for one frame',async()=>{
 const usage:any[]=[];let calls=0;
 const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage,query:async(q:any)=>{assert.ok(q.maxMs>0&&q.maxMs<=10000);calls++;usage.push({tokens:23});return {pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]}]};}},runStage:async(input:any,deps:any)=>{
  const frame=await deps.observe();for(let i=0;i<3;i++)await deps.check({frame});await deps.scriptStep({frame});
  assert.equal(frame.navigationEvidence.usage.length,1);return {status:'stopped',events:[],actions:[]};
 }});
 await d.rt.stage('enter_activity',{});assert.equal(calls,1);assert.equal(d.rt.calls,1);assert.equal(d.actions.length,0);
});
test('navigation reader obeys zero session model allowance',async()=>{
 let calls=0;const d=await fixture('ambiguous',{scriptValidationMode:false,limits:{stageMs:10000,sessionMs:60000,stageActions:3,agentCalls:0}},{model:{usage:[],query:async()=>{calls++;throw Error('must not call');}}});
 assert.notEqual((await d.rt.stage('enter_activity',{})).status,'completed');assert.equal(calls,0);assert.equal(d.actions.length,0);
});
test('late navigation reader result cannot dispatch beyond stage deadline',async()=>{
 let calls=0;const d=await fixture('ambiguous',{scriptValidationMode:false,limits:{stageMs:20,sessionMs:60000,stageActions:3,agentCalls:1}},{model:{usage:[],query:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,45));return {pageKind:'home',targets:[{text:'领淘金币',bounds:[770,330,965,525]}]};}}});
 assert.notEqual((await d.rt.stage('enter_activity',{})).status,'completed');await new Promise(resolve=>setTimeout(resolve,55));assert.equal(calls,1);assert.equal(d.actions.length,0);
});
test('ambiguous reader cannot use a panel-shaped response as home tap authority',async()=>{
 let calls=0;const d=await fixture('ambiguous',{scriptValidationMode:false},{model:{usage:[],query:async()=>{calls++;return {isPanel:false,balance:null,tasks:[],next:{action:{type:'tap',x:850,y:400}}};}}});
 const r=await d.rt.stage('enter_activity',{});assert.notEqual(r.status,'completed');assert.equal(calls,1);assert.equal(d.actions.length,0);
});

