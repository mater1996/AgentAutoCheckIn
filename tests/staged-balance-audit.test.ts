import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readLegacyBalanceComponent as readBalanceComponent, LEGACY_BALANCE_COMPONENT_VERSION as BALANCE_COMPONENT_VERSION} from '../runner/staged/balance-component.ts';
import * as audit from '../runner/staged/script-validation.ts';
const root=path.resolve(import.meta.dirname,'..');
const scratch = fs.realpathSync(process.env.TMPDIR!);
// Keep every embedded historical path in the derived fixture inside scratch.
const relocate = (value:any,dir:string):any => Array.isArray(value)?value.map(v=>relocate(v,dir))
 :value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v,dir)]))
 :typeof value==='string'&&value.startsWith(root+path.sep)?path.join(dir,'source',path.relative(root,value)):value;
const verify=(frame:any,value:number)=>(audit as any).verifyAuditBalanceComponent({root:scratch,frame,expectedValue:value});
test('historical v4: enabled audit refuses missing component evidence despite a readable OCR balance',async()=>{
 assert.equal(typeof (audit as any).verifyAuditBalanceComponent,'function');
 assert.equal(await verify({id:'unproven',lines:[{text:'2155',bounds:[90,245,210,300]}]},2155),false);
});
test('historical v4: real saved component is replayed and tampered evidence rejects',async t=>{
 const dir=fs.mkdtempSync(path.join(scratch,'balance-audit-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source='evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca';
 const frame=relocate(JSON.parse(fs.readFileSync(path.join(root,source+'.json'),'utf8')),dir);
 const {BALANCE_GLYPH_SOURCES}=await import('../runner/staged/balance-component.ts');
 for(const s of BALANCE_GLYPH_SOURCES){const target=path.join(dir,s.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,s.path),target);}
 const verify=(frame:any,value:number)=>audit.verifyAuditBalanceComponent({root:dir,frame,expectedValue:value});
 const bytes=fs.readFileSync(path.join(root,source+'.png'));
 frame.path=path.join(dir,'original.png');fs.writeFileSync(frame.path,bytes);
 frame.balanceEvidence=await readBalanceComponent({fullDeviceFrame:frame,originalPNG:bytes,evidenceDir:dir,exec:async(file,args,limits)=>promisify(execFile)(file,args,{timeout:limits?.timeoutMs})});
 assert.equal(frame.balanceEvidence.status,'accepted',frame.balanceEvidence.reason);
 assert.equal(frame.balanceEvidence.version,BALANCE_COMPONENT_VERSION);
 assert.equal(await verify(frame,2155),true);
 const snapshot=JSON.stringify(frame);
 // Rehashing a forged artifact must not bypass pixel reconstruction.
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const sharp=(await import('sharp')).default;
 const changed=await sharp(bytes).composite([{input:await sharp({create:{width:116,height:56,channels:3,background:'#ff0000'}}).png().toBuffer(),left:90,top:245}]).png().toBuffer();
 fs.writeFileSync(frame.path,changed);
 const forged=JSON.parse(snapshot);forged.balanceEvidence.sourcePngSha256=hash(changed);
 assert.equal(await verify(forged,2155),false);fs.writeFileSync(frame.path,bytes);
 const cropPath=frame.balanceEvidence.ocrEvidence.cropPath,originalCrop=fs.readFileSync(cropPath);
 const fakeCrop=await sharp({create:{width:512,height:280,channels:3,background:'white'}}).png().toBuffer();
 fs.writeFileSync(cropPath,fakeCrop);const cropForged=JSON.parse(snapshot);cropForged.balanceEvidence.cropHash=hash(fakeCrop);
 assert.equal(await verify(cropForged,2155),false);fs.writeFileSync(cropPath,originalCrop);
 const ocrPath=frame.balanceEvidence.ocrEvidence.path,originalOcr=fs.readFileSync(ocrPath),fakeOcr=JSON.parse(originalOcr.toString());
 fakeOcr.pages[0].lines[0].text='2135';const ocrBytes=Buffer.from(JSON.stringify(fakeOcr));fs.writeFileSync(ocrPath,ocrBytes);
 const ocrForged=JSON.parse(snapshot);ocrForged.balanceEvidence.ocrEvidence.sha256=hash(ocrBytes);ocrForged.balanceEvidence.ocrEvidence.text='2135';ocrForged.balanceEvidence.value=2135;
 assert.equal(await verify(ocrForged,2135),false);fs.writeFileSync(ocrPath,originalOcr);
 for(const mutate of [
  (f:any)=>f.balanceEvidence.value=2135,
  (f:any)=>f.balanceEvidence.glyphRecognition.glyphs[0].digit='9',
  (f:any)=>f.balanceEvidence.version='self-verified',
  (f:any)=>f.userId=999,
  (f:any)=>f.balanceEvidence.ocrEvidence.path='/etc/passwd',
  (f:any)=>f.balanceEvidence.referenceProvenance[0].sha256='0'.repeat(64),
 ]) {const f=JSON.parse(snapshot);mutate(f);assert.equal(await verify(f,2155),false);}
 for(const target of [frame.path,frame.balanceEvidence.ocrEvidence.cropPath,frame.balanceEvidence.ocrEvidence.path]){
  const original=fs.readFileSync(target);fs.writeFileSync(target,Buffer.concat([original,Buffer.from('tampered')]));
  assert.equal(await verify(frame,2155),false);fs.writeFileSync(target,original);
 }
 assert.equal(await verify(frame,2155),true);
});
// Synthetic full audit session copied from the existing fixture; no device claim.
const project = path.resolve(import.meta.dirname, '..');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const write = (root: string, file: string, value: any) => {
  const p = path.resolve(root, file); fs.mkdirSync(path.dirname(p), {recursive:true});
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return file;
};
const load = (root: string, file: string) => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));

const scope = {appId:'mock-app',accountId:'main',activityId:'coins',userId:0};
const task = {name:'Observed browse',instruction:'Browse 5 seconds',done:0,total:2};
const core = ['main.ts','runtime.ts','engine.ts','device.ts','session.ts','observations.ts','contracts.ts','config.ts','continuation.ts','browse-revalidation.ts','source-archive.ts','learned-browse.ts'].map(f=>'runner/staged/'+f);
function fixture(t: any, packageName = 'test.mock') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(scratch, 'script-validation-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const accountScope = {appId:scope.appId,accountId:scope.accountId,activityId:scope.activityId};
  const bundle: any = {schemaVersion:2,scope:accountScope,account:{id:scope.accountId,userId:0},activity:{id:'coins',assetId:'mock-coins'},tasks:[{id:'t',scope:accountScope,...task}],snapshots:[],executions:[]};
  const index: any = {sessions:[],candidates:[]};
  const cfg: any = {scope,package:packageName,assetId:'mock-coins',panelMarker:'赚金币抵钱',model:{baseUrl:'http://local',name:'model'},limits:{maxTasks:1,sessionMs:100000,stageMs:10000,agentCalls:2,stageActions:5,inventoryPages:3,maxReturns:2},constraints:['browse only'],planFile:'plan.json',learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id+'_ok'}]))};
  for (const f of core) write(root,f,'// fixture implementation '+f+'\n');
  write(root,'plan.json',[{name:task.name,instruction:task.instruction,decision:'do'}]);
  function add(id: string, runId: number) {
    const dir = 'evidence/'+id, attempt = 'attempt-'+id;
    const local=cfg.immersiveBrowse?.enabled===true&&cfg.immersiveBrowse.task.name===task.name&&cfg.immersiveBrowse.task.instruction===task.instruction?cfg.immersiveBrowse:cfg.learnedBrowse;
    const frame = (id: string, lines: any[]) => ({id,path:dir+'/'+id+'.png',package:packageName,userId:0,width:1080,height:2400,capturedAt:1793491201000,lines});
    const lines = [{text:'赚金币抵钱',bounds:[390,480,680,540]},{text:'100',bounds:[90,245,260,300]},{text:task.name+'（0/2）',bounds:[230,800,680,845]},{text:task.instruction,bounds:[230,870,500,905]},{text:'去完成',bounds:[880,820,1000,860]}];
    const before = frame('before',lines), destination=frame('destination',[{text:'Browse content',bounds:[10,300,700,800]}]);
    const receiptFrame = frame('receipt',[{text:'Task completed +5',bounds:[100,200,800,260]}]);
    const after = frame('after',[...lines.slice(0,1),{text:'105',bounds:[90,245,260,300]},{...lines[2],text:task.name+'（1/2）'},...lines.slice(3)]);
    for (const f of [before,destination,receiptFrame,after,{...after,id:'after2',path:dir+'/after2.png'}]) {write(root,f.path,'fixture image');write(root,f.path.replace('.png','.json'),f);}
    const receipt = {frameId:'receipt',path:receiptFrame.path,quote:'Task completed +5',taskAttemptId:attempt,version:local.version};
    const currentTask = {...task,frameId:'before',point:[940,840],beforeFrame:{path:before.path,ocrPath:before.path.replace('.png','.json')}};
    const act = (type: string, frameId: string) => ({source:'script',status:'verified',proposal:{frameId,action:type==='tap'?{type,x:940,y:840}:type==='wait'?{type,ms:5000}:{type}}});
    const observed = (f: any) => ({type:'observed',at:f.capturedAt+10,frame:f});
    const stages: any[] = ['open_app','enter_activity','open_list','collect_list','select_task','open_task','task_receipt','return_list','settle','review_task'].map(stageId=>({stageId,status:'completed',actions:[],events:[]}));
    Object.assign(stages[5],{task:currentTask,usedScriptVersion:local.version,actions:[act('tap','before')],events:[observed(before),observed(destination)]});
    Object.assign(stages[6],{receipt,usedScriptVersion:local.version,actions:[act('wait','destination')],events:[observed(destination),observed(receiptFrame)]});
    Object.assign(stages[7],{usedScriptVersion:'v1',actions:[act('back','receipt')],events:[observed(receiptFrame),observed(after)]});
    Object.assign(stages[8],{balanceAfter:105,review:{samples:[{isPanel:true,balance:105,frameId:'after'},{isPanel:true,balance:105,frameId:'after2'}]}});
    const result: any = {status:'completed',sessionId:id,runId,task:currentTask,taskAttemptId:attempt,receipt,balanceBefore:100,balanceAfter:105,gainCoins:5,learningValidation:'diagnostic_only'};
    const configFile = 'configs/'+id+'.json'; write(root,configFile,cfg); write(root,dir+'/config.json',cfg);
    write(root,dir+'/session.json',{id,scope,startedAt:'2026-11-01T00:00:00.000Z',configFile,evidenceDir:dir});
    write(root,dir+'/usage.json',[]); write(root,dir+'/cleanup.json',{power:'mWakefulness=Dozing',errors:[]});
    write(root,dir+'/result.json',result); write(root,dir+'/stages.json',stages); write(root,dir+'/final.json',{...result,stages,cleanup:{power:'mWakefulness=Dozing',errors:[]}});
    write(root,dir+'/session-state.json',{archived:{runId,gainCoins:5,resultFile:dir+'/result.json',v2Archived:true,partial:false,issues:[]}});
    write(root,dir+'/runtime.jsonl',[
      {kind:'explicit_candidate_authorized',stageId:'open_task',version:local.version,sourceRunId:local.sourceRunId},
      {kind:'explicit_candidate_authorized',stageId:'task_receipt',version:local.version,sourceRunId:local.sourceRunId},
      {kind:'learned_entry_dispatched',taskAttemptId:attempt,name:task.name,instruction:task.instruction,sourceFrameId:'before',dispatched:true},
      {kind:'learned_destination_confirmed',frameId:'destination',taskAttemptId:attempt,version:local.version},
      {kind:'learned_receipt',...receipt,sourceRunId:local.sourceRunId},
    ].map(x=>JSON.stringify(x)).join('\n'));
    const reviews: any[] = [];
    for (const f of [...core,...(cfg.dwellBrowse?['runner/staged/dwell-browse.ts']:[]),...(cfg.immersiveBrowse?['runner/staged/immersive-browse.ts',...(cfg.immersiveBrowse.rewardTransitions?.length?['runner/staged/immersive-transition.ts']:[])]:[]),configFile]) {
      const bytes = fs.readFileSync(path.join(root,f)), hash=sha(bytes), archived='data/stage-records/script-sources/'+hash+path.extname(f);
      write(root,archived,bytes.toString());
      const reviewIndex=reviews.length; reviews.push({stageId:'task_receipt',review:{candidateScript:{path:f}}});
      const candidateFile='data/stage-records/candidates/'+id+'-'+reviewIndex+'.json';
      write(root,candidateFile,{scope:{appId:scope.appId,activityId:scope.activityId,stage:'task_receipt'},candidateScript:{path:archived,originalPath:f,fileSha256:hash},sources:[{sessionId:id,runId,evidenceDir:dir,resultFile:dir+'/result.json',reviewFile:dir+'/reviews.json',reviewIndex}]});
      index.candidates.push({path:candidateFile,sessionId:id,runId});
    }
    write(root,dir+'/reviews.json',reviews);
    bundle.snapshots.push({id:'snapshot-'+id,scope:accountScope,taskId:'t'});
    const execution={id:'execution-'+id,scope:accountScope,runId,taskSnapshotId:'snapshot-'+id,status:'completed',evidenceDir:dir,resultFile:dir+'/result.json',result};
    bundle.executions.push(execution); flush(); return {dir,result,stages,execution,configFile};
  }
  function flush() {write(root,'data/task-records-v2/index.json',{schemaVersion:2,accountBundle:'data/account.json',knowledgeBundle:'data/knowledge.json'});write(root,'data/account.json',bundle);write(root,'data/knowledge.json',{scope:{appId:scope.appId,activityId:scope.activityId},application:{package:packageName}});write(root,'data/stage-records/index.json',index);}
  flush();return {root,bundle,index,cfg,add,flush};
}

test('historical v4: synthetic complete session accepts real changing balance components through final audit',async t=>{
 const f=fixture(t,'com.taobao.taobao');f.cfg.balanceComponent=true;
 const modulePath='runner/staged/balance-component.ts';write(f.root,modulePath,fs.readFileSync(path.join(project,modulePath),'utf8'));
 const {BALANCE_GLYPH_SOURCES}=await import('../runner/staged/balance-component.ts');
 for(const s of BALANCE_GLYPH_SOURCES){const target=path.join(f.root,s.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,s.path),target);}
 const a=f.add('component-success',112);
 const make=async(id:string,source:string,done:number)=>{
  const original=relocate(load(project,source+'.json'),f.root),bytes=fs.readFileSync(path.join(project,source+'.png'));
  const frame={...original,id,path:path.join(f.root,a.dir,id+'.png'),capturedAt:1793491202000,lines:[...original.lines.filter((l:any)=>l.bounds[3]<550),
   {text:task.name+`（${done}/2）`,bounds:[230,800,680,845]},
   {text:task.instruction,bounds:[230,870,500,905]},{text:'去完成',bounds:[880,820,1000,860]}]};
  fs.writeFileSync(frame.path,bytes);
  frame.balanceEvidence=await readBalanceComponent({fullDeviceFrame:frame,originalPNG:bytes,evidenceDir:path.join(f.root,a.dir),exec:async(file,args,limits)=>promisify(execFile)(file,args,{timeout:limits?.timeoutMs})});
  assert.equal(frame.balanceEvidence.status,'accepted',frame.balanceEvidence.reason);
  assert.equal(frame.balanceEvidence.version,BALANCE_COMPONENT_VERSION);
  write(f.root,frame.path.replace('.png','.json'),frame);return frame;
 };
 const source='evidence/staged-2026-11-01T11-46-47-689Z/';
 const before=await make('before',source+'25811c26-a30c-4e73-8c1e-9b726e81e9f4',0);
 const after=await make('after',source+'fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7',1);
 const after2=await make('after2',source+'fdcbc6b8-2005-4d02-9534-ea9bd8a8d1a7',1);
 // Original pixels remain unchanged; task rows/ids/timestamps are synthetic audit metadata.
 Object.assign(a.result.task,{beforeFrame:{path:before.path,ocrPath:before.path.replace('.png','.json')}});
 Object.assign(a.result,{balanceBefore:2085,balanceAfter:2135,gainCoins:50});
 for(const stage of a.stages)for(const event of stage.events??[]){if(event.frame?.id==='before')event.frame=before;if(event.frame?.id==='after')event.frame=after;}
 Object.assign(a.stages[8],{balanceAfter:2135,review:{samples:[{isPanel:true,balance:2135,frameId:after.id},{isPanel:true,balance:2135,frameId:after2.id}]}});
 write(f.root,a.dir+'/result.json',a.result);write(f.root,a.dir+'/stages.json',a.stages);
 const final=load(f.root,a.dir+'/final.json');Object.assign(final,a.result,{stages:a.stages});write(f.root,a.dir+'/final.json',final);
 const state=load(f.root,a.dir+'/session-state.json');state.archived.gainCoins=50;write(f.root,a.dir+'/session-state.json',state);
 const reviews=load(f.root,a.dir+'/reviews.json'),bytes=fs.readFileSync(path.join(f.root,modulePath)),hash=sha(bytes),archive='data/stage-records/script-sources/'+hash+'.ts';
 write(f.root,archive,bytes.toString());const reviewIndex=reviews.length;reviews.push({stageId:'script_sources',review:{candidateScript:{path:modulePath}}});write(f.root,a.dir+'/reviews.json',reviews);
 const candidate='data/stage-records/candidates/component-source.json';write(f.root,candidate,{scope:{appId:scope.appId,activityId:scope.activityId,stage:'script_sources'},candidateScript:{path:archive,originalPath:modulePath,fileSha256:hash},sources:[{sessionId:a.result.sessionId,runId:112,evidenceDir:a.dir,resultFile:a.dir+'/result.json',reviewFile:a.dir+'/reviews.json',reviewIndex}]});f.index.candidates.push({path:candidate,sessionId:a.result.sessionId,runId:112});f.flush();
 const report=await audit.auditStableScripts({root:f.root});assert.equal(report.tasks[0].attempts[0].qualified,true,JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('historical v4: enabled full session rejects absent baseline and settlement component evidence',async t=>{
 const f=fixture(t);f.cfg.balanceComponent=true;
 f.add('component-missing',111);
 const report=await audit.auditStableScripts({root:f.root});
 const blockers=report.tasks[0].attempts[0].blockers;
 assert.ok(blockers.some(b=>b.code==='balance_baseline_unverified'));
 assert.ok(blockers.some(b=>b.code==='balance_settlement_unverified'));
 assert.ok(blockers.some(b=>b.code==='script_archive_missing'&&b.detail.includes('balance-component.ts')));
});
