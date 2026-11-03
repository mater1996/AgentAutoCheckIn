// Offline synthetic replay of historical pixels: no device, model, live OCR or ledger.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';

const project=path.resolve(import.meta.dirname,'..');
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p:string,v:any)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v));};
const owner={package:'com.taobao.taobao',userId:0};
// Replace only the OS process boundary before loading the production checker.
// The fixed crop and its exact persisted OCR are checked on every replay call.
const report=read(path.join(project,'docs/probes/run213-home-gates.results.json'));
const savedOCR=Buffer.from(report.ocr.rawBase64,'base64');
assert.equal(sha(savedOCR),'6cd2ef40646feb26ec9551497ed67f386caae900e2f8434e35a2ed391e06686e');
const originalExec=childProcess.execFile;
let replayOcrCalls=0;
const offlineExec:any=()=>{throw Error('External process forbidden');};
offlineExec[promisify.custom]=async(file:string,args:string[])=>{
 assert.ok(file.endsWith('/checkin-apple-ocr'),'only saved crop OCR replay is allowed');
 assert.equal(args.length,2);args.forEach(p=>assert.ok(path.resolve(p).startsWith(scratch+path.sep)));
 assert.equal(sha(fs.readFileSync(args[1])),report.ocr.cropSha256);
 const raw=JSON.parse(savedOCR.toString());raw.pages[0].file=args[1];save(args[0],raw);replayOcrCalls++;return {stdout:''};
};
childProcess.execFile=offlineExec;syncBuiltinESMExports();
const scratch=fs.realpathSync(fs.mkdtempSync(path.join('/Users/mater/.hermes/cache/scratch','home-components-integration-')));
const previousTmp=process.env.TMPDIR;process.env.TMPDIR=scratch;
const nav=await import('../runner/staged/activity-navigation.ts');
const {createStagedRuntime}=await import('../runner/staged/runtime.ts');
const {AdbOcrDevice}=await import('../runner/staged/device.ts');
const audit=await import('../runner/staged/script-validation.ts');
const refs=[...nav.activityNavigationSource.files,...nav.activityLandingSource.files,...nav.activityRenderedLandingSource.files,...nav.activityPanelSource.files];
const run213='evidence/staged-2026-11-01T18-41-05-697Z/4dd2680a-fbbe-4211-a578-15d1dded50a4.json';
const ad='evidence/staged-2026-11-01T17-01-55-133Z/68bb8b03-bd5d-48e3-b6f8-e64af551261c.json';
const protectedPaths=[...new Set([...refs.map(r=>r.path),...refs.filter(r=>r.path.endsWith('.json')).map(r=>r.path.replace(/\.json$/,'.ocr.json')),run213,run213.replace(/\.json$/,'.png'),run213.replace(/\.json$/,'.ocr.json'),ad,ad.replace(/\.json$/,'.png'),ad.replace(/\.json$/,'.ocr.json'),'docs/probes/run213-home-gates.results.json'])];
const protectedHashes=protectedPaths.map(p=>[p,sha(fs.readFileSync(path.join(project,p)))]);
after(()=>{
 childProcess.execFile=originalExec;syncBuiltinESMExports();
 if(previousTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previousTmp;
 for(const [p,h]of protectedHashes)assert.equal(sha(fs.readFileSync(path.join(project,p))),h,p);
 fs.rmSync(scratch,{recursive:true,force:true});
});
async function replay(t:any,{heldOut=false,recovery=false,initialLanding=false,opts={}}:{heldOut?:boolean;recovery?:boolean;initialLanding?:boolean;opts?:any}={}){
 const root=fs.mkdtempSync(path.join(scratch,'session-')),evidenceDir='evidence/offline-session',dir=path.join(root,evidenceDir),sessionId=randomUUID(),taskAttemptId='offline-components';
 fs.mkdirSync(dir,{recursive:true});
 for(const ref of refs){const dest=path.join(root,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,ref.path),dest);assert.equal(sha(fs.readFileSync(dest)),ref.sha256);}
 if(recovery){const {entryRecoverySource}=await import('../runner/staged/entry-recovery.ts');for(const ref of entryRecoverySource.files){const dest=path.join(root,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,ref.path),dest);}}
 const home=heldOut?run213:nav.activityNavigationSource.files[1].path;
 const sources=recovery?[ad,initialLanding?nav.activityLandingSource.files[1].path:home,nav.activityPanelSource.files[1].path]:initialLanding?[nav.activityLandingSource.files[1].path,nav.activityPanelSource.files[1].path]:[home,nav.activityLandingSource.files[1].path,nav.activityPanelSource.files[1].path];
 let index=0,modelCalls=0;const commands:string[][]=[];
 const config={...owner,scope:{appId:'taobao',accountId:'offline',activityId:'tb_coin',userId:0},localActivityNavigation:true,entryRecovery:recovery,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:10000,sessionMs:30000,stageActions:4,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 save(path.join(dir,'session.json'),{id:sessionId,evidenceDir,startedAt:new Date().toISOString()});
 const device=new AdbOcrDevice({serial:'OFFLINE-NO-DEVICE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   commands.push(args);
   if(args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{offline u0 com.taobao.taobao/.MainActivity}'};
   if(args.includes('screencap'))return {stdout:fs.readFileSync(path.join(project,sources[index].replace(/\.json$/,'.png')))};
   if(args.includes('tap')){index=Math.min(index+1,sources.length-1);return {stdout:''};}
   throw Error('Forbidden offline command '+args.join(' '));
  }
  assert.equal(args.length,2);args.forEach(p=>assert.ok(p.startsWith(dir+path.sep)));
  const raw=read(path.join(project,sources[index].replace(/\.json$/,'.ocr.json')));raw.pages[0].file=args[1];save(args[0],raw);return {stdout:''};
 }});
 const runtime=createStagedRuntime(config,device,{query:async()=>{modelCalls++;throw Error('model forbidden');}},{sessionId,evidenceDir:dir,plan:[],...opts});
 const stages=[await runtime.stage('enter_activity',{taskAttemptId,matchedComponents:{forged:'context'}}),await runtime.stage('open_list',{taskAttemptId})];
 save(path.join(dir,'stages.json'),stages);
 const records=()=>fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s));
 const options={root,evidenceDir,config,stages:read(path.join(dir,'stages.json')),runtime:records(),sessionId,taskAttemptId};
 return {root,dir,runtime,commands,stages,options,records,get modelCalls(){return modelCalls;}};
}

test('real engine/runtime/device persists actual complete component matches before its single home dispatch',async t=>{
 const f=await replay(t);
 for(const stage of f.stages)assert.equal(stage.status,'completed',stage.error);
 const attempts=f.records().filter(e=>e.kind==='activity_navigation_attempted');
 assert.equal(attempts.length,2);assert.equal(f.commands.filter(a=>a.includes('tap')).length,2);assert.equal(f.modelCalls,0);
 const source=f.stages[0].events.find((e:any)=>e.type==='observed').frame;
 const known=await audit.verifyAuditActivityNavigation({root:f.root,frame:source,owner});
 assert.ok(known?.matchedComponents,'production checker must provide actual component matches');
 assert.deepEqual(attempts[0].matchedComponents,known.matchedComponents,'durable event must carry the freshly checked matches');
 assert.equal(Object.hasOwn(attempts[1],'matchedComponents'),false,'landing supplies no home component witness');
 assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
 await f.runtime.stage('enter_activity',{taskAttemptId:'another'});await f.runtime.stage('open_list',{taskAttemptId:'another'});
 assert.equal(f.commands.filter(a=>a.includes('tap')).length,2,'reentry cannot dispatch again');
});

test('independent audit rejects missing, fabricated or altered actual match witnesses',async t=>{
 const f=await replay(t),baseline=structuredClone(f.options);
 assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
 const attempt=()=>f.options.runtime.find((e:any)=>e.kind==='activity_navigation_attempted'&&e.stageId==='enter_activity');
 const witness=()=>attempt().matchedComponents;
 for(const [label,mutate]of [
  ['missing witness',()=>{delete attempt().matchedComponents;}],
  ['null witness',()=>{attempt().matchedComponents=null;}],
  ['duplicate group',()=>{witness().groups.push(structuredClone(witness().groups[0]));}],
  ['missing group',()=>{witness().groups.pop();}],
  ['group order',()=>{witness().groups.reverse();}],
  ['ROI order',()=>{witness().groups[0].rois.reverse();}],
  ['wrong ROI',()=>{witness().groups[1].rois[0][0]++;}],
  ['wrong source PNG',()=>{witness().groups[0].source.png={...nav.activityNavigationSource.files[2]};}],
  ['wrong source JSON',()=>{witness().groups[1].source.json={...nav.activityNavigationSource.files[3]};}],
  ['wrong source SHA',()=>{witness().groups[2].source.png.sha256='0'.repeat(64);}],
  ['wrong JSON SHA',()=>{witness().groups[2].source.json.sha256='0'.repeat(64);}],
  ['wrong version',()=>{witness().version='another-version';}],
  ['wrong frame',()=>{witness().frameId='another-frame';}],
  ['wrong current PNG',()=>{witness().pngSha256='0'.repeat(64);}],
  ['extra field',()=>{witness().inferred=true;}],
  ['fabricated landing witness',()=>{f.options.runtime.find((e:any)=>e.stageId==='open_list'&&e.kind==='activity_navigation_attempted').matchedComponents=structuredClone(witness());}],
  ['duplicate attempt',()=>{f.options.runtime.push(structuredClone(attempt()));}],
 ] as const)await t.test(label,async()=>{
  Object.assign(f.options,structuredClone(baseline));mutate();
  assert.equal(await audit.verifyAuditNavigationStages(f.options),false,label);
 });
 Object.assign(f.options,structuredClone(baseline));assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
});

test('held-out run213 same-frame OCR replay persists component matches and independently audits actual runtime events',async t=>{
 const before=replayOcrCalls,f=await replay(t,{heldOut:true});
 for(const stage of f.stages)assert.equal(stage.status,'completed',stage.error);
 assert.ok(replayOcrCalls>before,'runtime must replay the saved crop OCR');
 const attempt=f.options.runtime.find((e:any)=>e.kind==='activity_navigation_attempted'&&e.stageId==='enter_activity');
 assert.deepEqual(attempt.action,{type:'tap',x:862,y:487}); // AdbOcrDevice uses saved raw OCR, not the historical derived frame.
 assert.equal(attempt.matchedComponents.pngSha256,'cb703db52578484c1293b97cbafec5c9f40748750c0027d82b3f662dc4869b9e');
 assert.deepEqual(attempt.matchedComponents.groups.map((g:any)=>g.name),['chrome','coin-entry','bottom-navigation']);
 assert.ok(new Set(attempt.matchedComponents.groups.map((g:any)=>g.source.png.path)).size>1,'held-out page requires distinct whole component sources');
 assert.equal(attempt.chromeRefinement.frameId,attempt.frameId);
 assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
 const saved=structuredClone(attempt.matchedComponents);attempt.matchedComponents.groups[1].source.png.sha256='0'.repeat(64);
 assert.equal(await audit.verifyAuditNavigationStages(f.options),false);attempt.matchedComponents=saved;
 assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
 assert.equal(f.modelCalls,0);assert.equal(f.commands.filter(a=>a.includes('tap')).length,2);
});

test('recovery home arrival witness is independently recomputed before original navigation can qualify',async t=>{
 const f=await replay(t,{recovery:true});
 for(const stage of f.stages)assert.equal(stage.status,'completed',stage.error);
 const confirmed=f.options.runtime.find((e:any)=>e.kind==='entry_recovery_confirmed');
 assert.equal(confirmed.state,'home');assert.ok(confirmed.arrivalProof.matchedComponents);
 const known=await audit.verifyAuditActivityNavigation({root:f.root,frame:confirmed.frame,owner});
 assert.deepEqual(confirmed.arrivalProof.matchedComponents,known?.matchedComponents);
 assert.ok(await audit.verifyAuditEntryRecovery(f.options));assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
 const baseline=structuredClone(f.options);
 for(const [label,mutate]of [
  ['missing recovery witness',(e:any)=>{delete e.arrivalProof.matchedComponents;}],
  ['recovery witness from navigation frame',(e:any)=>{e.arrivalProof.matchedComponents=f.options.runtime.find((x:any)=>x.kind==='activity_navigation_attempted').matchedComponents;}],
  ['reordered recovery groups',(e:any)=>{e.arrivalProof.matchedComponents.groups.reverse();}],
  ['wrong recovery source',(e:any)=>{e.arrivalProof.matchedComponents.groups[0].source.json.sha256='0'.repeat(64);}],
 ] as const)await t.test(label,async()=>{
  Object.assign(f.options,structuredClone(baseline));mutate(f.options.runtime.find((e:any)=>e.kind==='entry_recovery_confirmed'));
  assert.equal(await audit.verifyAuditEntryRecovery(f.options),null,label);
  assert.equal(await audit.verifyAuditNavigationStages(f.options),false,label);
 });
 assert.equal(f.modelCalls,0);assert.equal(f.commands.filter(a=>a.includes('tap')).length,2);
});

test('initial landing preserves absent witness and recovery landing refuses fabricated home matches',async t=>{
 for(const recovery of [false,true]){
  const f=await replay(t,{initialLanding:true,recovery});
  for(const stage of f.stages)assert.equal(stage.status,'completed',stage.error);
  assert.equal(await audit.verifyAuditNavigationStages(f.options),true);
  const attempts=f.options.runtime.filter((e:any)=>e.kind==='activity_navigation_attempted');
  assert.equal(attempts.length,1);assert.equal(attempts[0].stageId,'open_list');assert.equal(Object.hasOwn(attempts[0],'matchedComponents'),false);
  if(recovery){
   const confirmed=f.options.runtime.find((e:any)=>e.kind==='entry_recovery_confirmed');
   assert.equal(confirmed.state,'landing');assert.equal(Object.hasOwn(confirmed.arrivalProof,'matchedComponents'),false);
   confirmed.arrivalProof.matchedComponents={version:nav.activityNavigationSource.version,groups:[]};
   assert.equal(await audit.verifyAuditEntryRecovery(f.options),null);
  }
  assert.equal(f.modelCalls,0);assert.equal(f.commands.filter(a=>a.includes('tap')).length,recovery?2:1);
 }
});

test('context and proposal fields cannot supply the dispatched component witness',async t=>{
 let checked:any;
 const f=await replay(t,{opts:{runStage:async(input:any,deps:any)=>{
  if(input.stageId!=='enter_activity')return {status:'stopped',actions:[],events:[]};
  const frame=await deps.observe(),context={frame,matchedComponents:{forged:'context'}};
  const proposal=await deps.scriptStep(context);proposal.matchedComponents={forged:'proposal'};
  checked=await nav.inspectLearnedActivityNavigation(frame,owner,project,{exec:async()=>{throw Error('live OCR forbidden');}});assert.ok(checked);
  await deps.dispatch(proposal.action,frame);
  await assert.rejects(()=>deps.dispatch(proposal.action,frame),/not authorized/);
  return {status:'stopped',actions:[],events:[]};
 }}});
 const event=f.records().find(e=>e.kind==='activity_navigation_attempted');
 assert.deepEqual(event.matchedComponents,checked.matchedComponents);
 assert.equal(f.commands.filter(a=>a.includes('tap')).length,1);assert.equal(f.modelCalls,0);
});
