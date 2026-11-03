// Offline replay fixtures copy historical bytes; they confer no new capture or income authority.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deriveImmersiveOcrQuality} from '../runner/staged/immersive-ocr-quality.ts';

const project=path.resolve(import.meta.dirname,'..');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const write=(p:string,v:any)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};
const runs=['evidence/staged-2026-11-01T15-19-09-152Z','evidence/staged-2026-11-01T15-35-31-731Z'];
const samples=[['beaea497-a491-4dca-ac67-22e7d2320b7c',0],['15a85a6e-5157-4539-9262-abbf8129651d',1],['3d7cb0c2-414d-4da9-81e8-6c88ef418bdb',1]] as const;
const api=()=>import('../runner/staged/script-validation.ts');
async function fixture(t:any,sample=0){
 const root=fs.realpathSync(fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/immersive-quality-audit-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const evidenceDir=path.join(root,'evidence','synthetic-session');fs.mkdirSync(evidenceDir,{recursive:true});
 const [id,index]=samples[sample],source=read(path.join(project,runs[index],id+'.json'));
 const originals=[source.path,source.path.replace(/\.png$/,'.json'),source.path.replace(/\.png$/,'.ocr.json')];
 const hashes=originals.map(hash);
 t.after(()=>assert.deepEqual(originals.map(hash),hashes,'historical evidence must remain immutable'));
 const frame={...source,path:path.join(evidenceDir,'synthetic-'+id+'.png')};
 const raw=read(source.path.replace(/\.png$/,'.ocr.json'));raw.pages[0].file=frame.path;
 fs.copyFileSync(source.path,frame.path);
 write(frame.path.replace(/\.png$/,'.json'),frame);write(frame.path.replace(/\.png$/,'.ocr.json'),raw);
 const quality=await deriveImmersiveOcrQuality(frame,{rewardCoins:50});assert.ok(quality);
 const task={name:'Synthetic audit browse',instruction:'浏览',done:0,total:2};
 const entry={id:'entry',path:path.join(evidenceDir,'entry.png'),package:frame.package,userId:0,width:1080,height:2400,
  capturedAt:frame.capturedAt-1000,lines:[{text:'赚金币抵钱',bounds:[390,480,680,540]},
   {text:'100',bounds:[90,245,260,300]},{text:task.name+'（0/2）',bounds:[230,800,680,845]},
   {text:task.instruction,bounds:[230,870,500,905]},{text:'去完成',bounds:[880,820,1000,860]}]};
 write(entry.path,'synthetic entry image');write(entry.path.replace(/\.png$/,'.json'),entry);
 const taskAttemptId='synthetic-attempt',entryActionId=`${taskAttemptId}:${entry.id}:tap`;
 const tap={source:'script',status:'verified',proposal:{frameId:entry.id,action:{type:'tap',x:940,y:840}}};
 const stages:any[]=[{stageId:'open_task',actions:[tap],events:[{type:'observed',frame:entry},{type:'observed',frame}]},
  {stageId:'task_receipt',actions:[],events:[]}];
 const config:any={package:frame.package,scope:{userId:0},panelMarker:'赚金币抵钱',immersiveBrowse:{enabled:true,
  version:'immersive-browse-candidate-v2',sourceRunId:145,ocrQuality:true,observationBudgetMs:20000,allowedRewardCoins:[20,50],task}};
 const event:any={kind:'immersive_ocr_quality',stageId:'open_task',taskAttemptId,entryFrameId:entry.id,entryActionId,
  frameId:frame.id,rewardCoins:50,quality};
 const runtime:any[]=[{kind:'learned_entry_dispatched',taskAttemptId,...task,sourceFrameId:entry.id,entryActionId,dispatched:true},event];
 const options:any={root,evidenceDir,config,stages,runtime,taskAttemptId,stageId:'open_task',frameId:frame.id,rewardCoins:50,task};
 return {root,evidenceDir,frame,raw,quality,entry,event,stages,config,runtime,options};
}
function auditFixture(f:any){
 const scope={appId:'synthetic',accountId:'main',activityId:'coins',userId:0};
 const cfg=read(path.join(project,runs[1],'config.json'));
 Object.assign(cfg,{scope,immersiveBrowse:f.config.immersiveBrowse,localActivityNavigation:false,balanceComponent:false});
 f.config=cfg;f.options.config=cfg;
 const dir=f.evidenceDir,sessionId='synthetic-session';
 const result={status:'stopped',sessionId,runId:999,taskAttemptId:f.options.taskAttemptId,task:f.options.task,
  receipt:f.receipt??null,balanceBefore:100,balanceAfter:null,gainCoins:null};
 // A historical success creates the task group; this incomplete current attempt stays stopped.
 const accountScope={appId:scope.appId,accountId:scope.accountId,activityId:scope.activityId};
 write(path.join(f.root,'data/task-records-v2/index.json'),{accountBundle:'data/account.json',knowledgeBundle:'data/knowledge.json'});
 write(path.join(f.root,'data/account.json'),{schemaVersion:2,scope:accountScope,account:{id:'main',userId:0},
  tasks:[{...f.options.task,id:'t',scope:accountScope}],snapshots:[{id:'s',taskId:'t',scope:accountScope}],
  executions:[{runId:998,scope:accountScope,taskSnapshotId:'s',evidenceDir:'missing-historical',result:{status:'completed',gainCoins:1}},
   {runId:999,scope:accountScope,taskSnapshotId:'s',evidenceDir:dir,result}]});
 write(path.join(f.root,'data/knowledge.json'),{application:{package:cfg.package}});
 write(path.join(dir,'session.json'),{id:sessionId,scope,startedAt:new Date(f.entry.capturedAt-1000).toISOString(),evidenceDir:dir,configFile:'config.json'});
 write(path.join(dir,'config.json'),cfg);write(path.join(dir,'result.json'),result);
 write(path.join(dir,'final.json'),{...result,stages:f.stages});write(path.join(dir,'stages.json'),f.stages);
 write(path.join(dir,'runtime.jsonl'),f.runtime.map((e:any)=>JSON.stringify(e)).join('\n'));
 write(path.join(dir,'usage.json'),[]);write(path.join(dir,'cleanup.json'),{errors:[]});write(path.join(dir,'session-state.json'),{});
 return async()=>{
  write(path.join(dir,'runtime.jsonl'),f.runtime.map((e:any)=>JSON.stringify(e)).join('\n'));
  const report=await(await api()).auditStableScripts({root:f.root});
  return {report,attempt:report.tasks[0].attempts.find((a:any)=>a.runId===999)};
 };
}
async function replay(options:any){
 const checker=await api();
 assert.equal(typeof (checker as any).verifyAuditImmersiveOcrQuality,'function','audit must independently replay saved OCR quality');
 return (checker as any).verifyAuditImmersiveOcrQuality(options);
}

for(const [label,mutate] of [
 ['unknown version',(f:any)=>{f.event.quality.version='invented';}],
 ['PNG hash',(f:any)=>{f.event.quality.sourcePngSha256='0'.repeat(64);}],
 ['JSON hash',(f:any)=>{f.event.quality.sourceFrameJsonSha256='0'.repeat(64);}],
 ['raw hash',(f:any)=>{f.event.quality.rawOcrSha256='0'.repeat(64);}],
 ['deleted invalid lines',(f:any)=>{f.event.quality.invalidLines=[];}],
 ['deleted raw lines',(f:any)=>{f.event.quality.rawLines.pop();}],
 ['forged valid indices',(f:any)=>{f.event.quality.validIndices.push(f.quality.invalidLines[0].index);}],
 ['self acceptance',(f:any)=>{f.event.quality.accepted=true;}],
 ['source path',(f:any)=>{f.event.quality.rawOcrPath=f.entry.path;}],
 ['wrong source capture time',(f:any)=>{f.event.quality.capturedAt++;}],
 ['wrong source owner',(f:any)=>{f.event.quality.userId=10;}],
 ['wrong source frame',(f:any)=>{f.event.quality.frameId='other';}],
 ['attempt',(f:any)=>{f.event.taskAttemptId='other';}],
 ['reward',(f:any)=>{f.event.rewardCoins=20;}],
 ['stage',(f:any)=>{f.event.stageId='task_receipt';}],
 ['frame',(f:any)=>{f.event.frameId='other';}],
 ['entry frame',(f:any)=>{f.event.entryFrameId='other';}],
 ['entry action',(f:any)=>{f.event.entryActionId='other';}],
 ['forged matching entry action IDs',(f:any)=>{f.event.entryActionId=f.runtime[0].entryActionId='invented';}],
 ['missing dispatch',(f:any)=>{f.runtime[0].dispatched=false;}],
 ['missing entry action ID',(f:any)=>{delete f.runtime[0].entryActionId;}],
 ['unknown tap outcome',(f:any)=>{f.stages[0].actions[0].status='unknown';}],
 ['wrong tap target',(f:any)=>{f.stages[0].actions[0].proposal.action.x=100;}],
 ['missing event',(f:any)=>{f.runtime.pop();}],
 ['duplicate event',(f:any)=>{f.runtime.push(structuredClone(f.event));}],
 ['duplicate cross-stage event',(f:any)=>{f.stages[1].events=[{type:'observed',frame:f.frame}];f.runtime.push({...f.event,stageId:'task_receipt'});}],
 ['disabled flag',(f:any)=>{f.config.immersiveBrowse.ocrQuality=false;}],
 ['unknown flag',(f:any)=>{f.config.immersiveBrowse.ocrQuality='true';}],
 ['excluded amount',(f:any)=>{f.config.immersiveBrowse.allowedRewardCoins=[20];}],
 ['no observed original',(f:any)=>{f.stages[0].events.pop();}],
 ['quality payload as observed',(f:any)=>{f.stages[0].events[1]={type:'immersive_ocr_quality',frame:f.frame};}],
 ['conflicting original flow',(f:any)=>{f.stages[0].events.push({type:'observed',frame:{...f.frame,capturedAt:f.frame.capturedAt+1}});}],
 ['source JSON equality',(f:any)=>{write(f.quality.sourceFrameJsonPath,{...f.frame,capturedAt:f.frame.capturedAt+1});}],
 ['source JSON bytes',(f:any)=>{fs.appendFileSync(f.quality.sourceFrameJsonPath,' ');}],
 ['source PNG bytes',(f:any)=>{fs.appendFileSync(f.frame.path,' ');}],
 ['source raw bytes',(f:any)=>{fs.appendFileSync(f.quality.rawOcrPath,' ');}],
 ['wrong raw page',(f:any)=>{f.raw.pages[0].file=f.entry.path;write(f.quality.rawOcrPath,f.raw);}],
 ['project root as session',(f:any)=>{f.options.evidenceDir=f.root;}],
 ['cross-session root',(f:any)=>{const other=path.join(f.root,'evidence','other');fs.mkdirSync(other);f.options.evidenceDir=other;}],
 ['PNG symlink to another session',(f:any)=>{const target=path.join(f.root,'outside.png');fs.renameSync(f.frame.path,target);fs.symlinkSync(target,f.frame.path);}],
 ['JSON symlink to another session',(f:any)=>{const target=path.join(f.root,'outside.json');fs.renameSync(f.quality.sourceFrameJsonPath,target);fs.symlinkSync(target,f.quality.sourceFrameJsonPath);}],
 ['raw symlink to another session',(f:any)=>{const target=path.join(f.root,'outside.ocr.json');fs.renameSync(f.quality.rawOcrPath,target);fs.symlinkSync(target,f.quality.rawOcrPath);}],
] as const)test('independent quality audit rejects '+label,async t=>{
 const f=await fixture(t);mutate(f);assert.equal(await replay(f.options),null);
});

test('fresh revalidation flow retains original source frame authority',async t=>{
 const f=await fixture(t);
 f.stages[0].events[1]={type:'before_dispatch_revalidated',newFrameId:f.frame.id,frame:f.frame};
 assert.ok(await replay(f.options));
});

test('full audit requires the imported quality module archive even when the flag is false',async t=>{
 const f=await fixture(t);f.config.immersiveBrowse.ocrQuality=false;
 const audit=auditFixture(f),{attempt}=await audit();
 assert.ok(attempt.blockers.some((b:any)=>b.code==='script_archive_missing'&&b.detail.includes('immersive-ocr-quality.ts')));
});

test('enabled audit replays a raw error receipt through the unchanged completed20 component contract',async t=>{
 const f=await fixture(t);
 const {immersiveBrowseSource}=await import('../runner/staged/immersive-browse.ts');
 const source=read(path.join(project,immersiveBrowseSource.files.completedFrame.path));
 fs.copyFileSync(source.path,f.frame.path);
 f.raw.pages[0].lines=[...source.lines,{text:'商品',bounds:[-1,800,100,830]}];
 write(f.quality.rawOcrPath,f.raw);
 const q=await deriveImmersiveOcrQuality(f.frame,{rewardCoins:20});assert.ok(q);
 Object.assign(f.event,{stageId:'task_receipt',rewardCoins:20,quality:q});
 f.stages[1].events=[f.stages[0].events.pop()];
 Object.assign(f.options,{stageId:'task_receipt',rewardCoins:20});
 const proof=await replay(f.options);assert.equal(proof?.inspection.state,'completed');assert.equal(proof.inspection.quote,'已得20');
 const receipt={taskAttemptId:f.options.taskAttemptId,frameId:f.frame.id,path:f.frame.path,quote:'已得20',rewardCoins:20,version:'immersive-browse-candidate-v2'};
 (f as any).receipt=receipt;f.stages[1].receipt=receipt;
 f.runtime.push({kind:'learned_receipt',...receipt,sourceRunId:145});
 const audit=auditFixture(f),{attempt}=await audit();
 assert.ok(!attempt.blockers.some((b:any)=>b.code==='immersive_ocr_quality_unverified'));
 // Raw receipt visibility can be checked independently of missing full-session accounting.
 assert.ok(!attempt.blockers.some((b:any)=>b.code==='receipt_unverified'&&b.detail.includes('visible in actual raw frame')),
  JSON.stringify(attempt.blockers));
});

for(const ms of [0,-1,3001,20001])test('opted-in audit rejects invalid or exhausted observation wait '+ms,async t=>{
 const f=await fixture(t),audit=auditFixture(f);
 f.stages[1].actions=[{source:'script',status:'verified',proposal:{frameId:f.frame.id,action:{type:'wait',ms}}}];
 write(path.join(f.evidenceDir,'stages.json'),f.stages);
 const {attempt}=await audit();
 assert.ok(attempt.blockers.some((b:any)=>b.code==='immersive_wait_unverified'));
});

test('opted-in full audit independently replays every pinned candidate and rejects a false receipt',async t=>{
 const f=await fixture(t),audit=auditFixture(f);
 const receipt={taskAttemptId:f.options.taskAttemptId,frameId:f.frame.id,path:f.frame.path,quote:'已得50',rewardCoins:50,version:'immersive-browse-candidate-v2'};
 const resultFile=path.join(f.evidenceDir,'result.json'),result=read(resultFile);result.receipt=receipt;write(resultFile,result);
 f.runtime.push({kind:'learned_destination_confirmed',taskAttemptId:f.options.taskAttemptId,frameId:f.frame.id,state:'browsing',rewardCoins:50,version:receipt.version});
 f.stages[1].events=[{type:'observed',frame:f.frame}];f.stages[1].receipt=receipt;
 write(path.join(f.evidenceDir,'stages.json'),f.stages);
 const {attempt}=await audit();
 assert.ok(attempt.blockers.some((b:any)=>b.code==='immersive_inspector_unverified'));
});

test('a dispatched bounded wait replays its original quality frame without granting completion',async t=>{
 const f=await fixture(t),audit=auditFixture(f);
 f.stages[1].events=[{type:'observed',frame:f.frame}];
 f.stages[1].actions=[{source:'script',status:'verified',proposal:{frameId:f.frame.id,action:{type:'wait',ms:3000}}}];
 f.event.stageId='task_receipt';
 f.runtime.push({kind:'dwell_wait_slice',taskAttemptId:f.options.taskAttemptId,frameId:f.frame.id,ms:3000,slices:1,totalMs:3000,limitMs:20000,completionInferred:false});
 write(path.join(f.evidenceDir,'stages.json'),f.stages);
 const {attempt}=await audit();assert.equal(attempt.qualified,false);
 assert.ok(!attempt.blockers.some((b:any)=>b.code==='immersive_wait_unverified'),JSON.stringify(attempt.blockers));
});

test('full audit validates quality events but retains incomplete receipt, gain and settlement blockers',async t=>{
 const f=await fixture(t),audit=auditFixture(f);
 let result=await audit();assert.equal(result.report.stableCount,0);assert.equal(result.attempt.qualified,false);
 assert.ok(result.attempt.blockers.some((b:any)=>b.code==='positive_gain_missing'));
 assert.ok(!result.attempt.blockers.some((b:any)=>b.code==='immersive_ocr_quality_unverified'));
 f.event.quality={...f.quality,invalidLines:[]};result=await audit();
 assert.ok(result.attempt.blockers.some((b:any)=>b.code==='immersive_ocr_quality_unverified'),'whole audit must validate the event');
});

test('local audit replays original 207/208 error frames without clearing errors or granting a receipt',async t=>{
 for(let i=0;i<samples.length;i++){
  const f=await fixture(t,i),before=structuredClone(f.frame);
  const files=[f.frame.path,f.quality.sourceFrameJsonPath,f.quality.rawOcrPath],hashes=files.map(hash);
  const proof=await replay(f.options);assert.ok(proof);
  assert.deepEqual(proof.frame,f.frame);assert.deepEqual(proof.quality,f.quality);
  assert.deepEqual(proof.inspection,{state:'browsing',version:'immersive-browse-candidate-v2',rewardCoins:50,waitMs:3000});
  assert.equal(proof.receipt,undefined);assert.deepEqual(f.frame,before);assert.deepEqual(files.map(hash),hashes);
 }
});
