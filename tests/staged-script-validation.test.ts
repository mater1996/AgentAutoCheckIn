import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

const project = path.resolve(import.meta.dirname, '..');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const write = (root: string, file: string, value: any) => {
  const p = path.resolve(root, file); fs.mkdirSync(path.dirname(p), {recursive:true});
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return file;
};
const load = (root: string, file: string) => JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
const api = () => import('../runner/staged/script-validation.ts');
const scope = {appId:'mock-app',accountId:'main',activityId:'coins',userId:0};
const task = {name:'Observed browse',instruction:'Browse 5 seconds',done:0,total:2};
const core = ['main.ts','runtime.ts','engine.ts','device.ts','session.ts','observations.ts','contracts.ts','config.ts','continuation.ts','browse-revalidation.ts','source-archive.ts','learned-browse.ts'].map(f=>'runner/staged/'+f);
function fixture(t: any, packageName = 'test.mock') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), '.hermes/cache/scratch/script-validation-')));
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
    for (const f of [...core,...(cfg.localActivityNavigation?['runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts'].filter(p=>fs.existsSync(path.join(root,p))):[]),...(cfg.dwellBrowse?['runner/staged/dwell-browse.ts']:[]),...(cfg.immersiveBrowse?['runner/staged/immersive-browse.ts','runner/staged/immersive-ocr-quality.ts',...(cfg.immersiveBrowse.rewardTransitions?.length?['runner/staged/immersive-transition.ts']:[])]:[]),configFile]) {
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

// Immutable bytes from an actual same-frame Apple Vision crop of run 199.
// Embedded to keep replay independent of ephemeral OCR output directories.
const navigationOCR=Buffer.from('ewogICJlbmdpbmUiIDogIkFwcGxlIFZpc2lvbiBWTlJlY29nbml6ZVRleHRSZXF1ZXN0IiwKICAibGFuZ3VhZ2VDb3JyZWN0aW9uIiA6IGZhbHNlLAogICJsYW5ndWFnZXMiIDogWwogICAgInpoLUhhbnMiLAogICAgImVuLVVTIgogIF0sCiAgInBhZ2VzIiA6IFsKICAgIHsKICAgICAgImZpbGUiIDogIlwvdmFyXC9mb2xkZXJzXC9tX1wvd3d0dmpoaDUzcnpfZjNkenJzaHBoODV3MDAwMGduXC9UXC9hY3Rpdml0eS1jaHJvbWUtUE1WN3VpXC90YW8ucG5nIiwKICAgICAgImhlaWdodCIgOiAyMzAsCiAgICAgICJsaW5lcyIgOiBbCiAgICAgICAgewogICAgICAgICAgImJvdW5kcyIgOiBbCiAgICAgICAgICAgIDU5Ljk5OTk5OTkxNDI4NTcyMywKICAgICAgICAgICAgNTEuOTk5OTk5Nzk2NDI4NTY4LAogICAgICAgICAgICAxOTUuOTk5OTk5OTE0Mjg1NzIsCiAgICAgICAgICAgIDE2NS45OTk5OTk3OTY0Mjg1NwogICAgICAgICAgXSwKICAgICAgICAgICJjb25maWRlbmNlIiA6IDAuNSwKICAgICAgICAgICJ0ZXh0IiA6ICLmt5giCiAgICAgICAgfQogICAgICBdLAogICAgICAicmVjb2duaXRpb25NcyIgOiAyNTMuMjg1MDUwMzkyMTUwODgsCiAgICAgICJyZXZpc2lvbiIgOiAzLAogICAgICAid2lkdGgiIDogMjUwCiAgICB9CiAgXQp9','base64');

// Synthetic full audit session: real 199 home -> real 195 panel is a cross-run
// fixture, not a device transition or an additional independent validation.
async function navigationFixture(t:any,missingTao=true) {
 const f=fixture(t,'com.taobao.taobao');f.cfg.localActivityNavigation=true;
 const nav=await import('../runner/staged/activity-navigation.ts');
 for(const file of [...core,'runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts'])write(f.root,file,fs.readFileSync(path.join(project,file),'utf8'));
 for(const ref of [...nav.activityNavigationSource.files,...nav.activityPanelSource.files]){
  const dest=path.join(f.root,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,ref.path),dest);
 }
 const a=f.add('synthetic-navigation-199-to-195',199);
 const homePath='evidence/staged-2026-11-01T12-48-57-664Z/'+(missingTao?'11e3c401-c043-4db0-a3ce-e97948a31973':'31fc0e2c-e563-45ba-a0e2-fc3bb4b29c9f')+'.json';
 const copy=(source:string,id:string,at:number)=>{
  const raw={...load(project,source),id,path:path.join(f.root,a.dir,id+'.png'),capturedAt:at};
  const bytes=fs.readFileSync(path.join(project,source.replace('.json','.png')));fs.writeFileSync(raw.path,bytes);
  const originalOCR=load(project,source.replace(/\.json$/,'.ocr.json'));originalOCR.pages[0].file=raw.path;write(f.root,raw.path.replace(/\.png$/,'.ocr.json'),originalOCR);
  write(f.root,raw.path.replace('.png','.json'),raw);return raw;
 };
 const home=copy(homePath,'nav-home',1793491202000),entered=copy(nav.activityPanelSource.files[1].path,'nav-entered',1793491203000),opened=copy(nav.activityPanelSource.files[1].path,'nav-opened',1793491204000);
 const action={type:'tap',x:862,y:487};
 Object.assign(a.stages[1],{usedScriptVersion:nav.activityNavigationSource.version,actions:[{source:'script',status:'verified',proposal:{frameId:home.id,action}}],events:[{type:'observed',frame:home},{type:'observed',frame:entered}]});
 a.stages[2].events=[{type:'observed',frame:opened}];
 const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
 const event:any={kind:'activity_navigation_attempted',at:new Date(home.capturedAt+500).toISOString(),frameId:home.id,action,provenance:nav.activityNavigationSource};events.push(event);
 if(missingTao){
  const png=fs.readFileSync(home.path),crop=await sharp(png).extract({left:40,top:2160,width:125,height:115}).resize(250,230).png().toBuffer();
  const dir=path.join(f.root,a.dir,'navigation-refinements',home.id);fs.mkdirSync(dir,{recursive:true});
  const ocr=JSON.parse(navigationOCR.toString()),page=ocr.pages[0];
  assert.equal(sha(navigationOCR),'9e06648e435408a1daea9c0da312e6b15baba2cfff2b7c3d2629c1afb64f3161');
  fs.writeFileSync(path.join(dir,'frame.png'),png);fs.writeFileSync(path.join(dir,'tao.png'),crop);fs.writeFileSync(path.join(dir,'ocr.json'),navigationOCR);
  event.chromeRefinement={frameId:home.id,sourceSha:sha(png),roi:[40,2160,165,2275],scale:2,cropSha:sha(crop),path:path.join(dir,'tao.png'),rawPath:path.join(dir,'frame.png'),ocrPath:path.join(dir,'ocr.json'),ocrInputPath:page.file,ocrSha:sha(navigationOCR),bounds:page.lines[0].bounds.map((n:number,k:number)=>n/2+[40,2160][k%2]),elapsedMs:400,engine:ocr.engine};
 }
 const replay=await(await api()).verifyAuditActivityNavigation({root:f.root,frame:home,owner:{package:f.cfg.package,userId:0},refinement:event.chromeRefinement});
 assert.equal(replay?.state,'home','Synthetic fixture must derive its actual component witness');
 event.matchedComponents=replay.matchedComponents;
 const sync=()=>{
  for(const raw of [home,entered,opened])write(f.root,raw.path.replace('.png','.json'),raw);
  write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);
  write(f.root,a.dir+'/runtime.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));f.flush();
 };
 sync();return {...f,...a,home,entered,opened,event,events,sync};
}

// Synthetic full audit only: unchanged real 198 home, 200 landing and 195 panel
// pixels come from separate runs. This is not a device transition or stability evidence.
async function twoStageNavigationFixture(t:any) {
 const f=fixture(t,'com.taobao.taobao');f.cfg.localActivityNavigation=true;
 const nav=await import('../runner/staged/activity-navigation.ts');
 for(const file of [...core,'runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts'])write(f.root,file,fs.readFileSync(path.join(project,file),'utf8'));
 for(const ref of [...nav.activityNavigationSource.files,...nav.activityLandingSource.files,...nav.activityRenderedLandingSource.files,...nav.activityPanelSource.files]){
  const dest=path.join(f.root,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,ref.path),dest);
 }
 const a=f.add('synthetic-navigation-198-200-195',198);
 const copy=(source:string,id:string,capturedAt:number)=>{
  const raw={...load(project,source),id,path:path.join(f.root,a.dir,id+'.png'),capturedAt};
  const bytes=fs.readFileSync(path.join(project,source.replace('.json','.png')));fs.writeFileSync(raw.path,bytes);
  const originalOCR=load(project,source.replace(/\.json$/,'.ocr.json'));originalOCR.pages[0].file=raw.path;write(f.root,raw.path.replace(/\.png$/,'.ocr.json'),originalOCR);
  assert.equal(sha(fs.readFileSync(raw.path)),sha(bytes));return raw;
 };
 const home=copy(nav.activityNavigationSource.files[1].path,'nav-home',1793491202000);
 const entered=copy(nav.activityLandingSource.files[1].path,'nav-landing',1793491203000);
 const landing=copy(nav.activityLandingSource.files[1].path,'nav-list-source',1793491204000);
 const opened=copy(nav.activityPanelSource.files[1].path,'nav-panel',1793491205000);
 const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
 const configure=(index:number,source:any,arrival:any,action:any,provenance:any)=>{
  const stage=a.stages[index];Object.assign(stage,{usedScriptVersion:provenance.version,
   actions:[{source:'script',status:'verified',proposal:{frameId:source.id,action}}],
   events:[{type:'observed',frame:source},{type:'observed',frame:arrival}]});
  const event={kind:'activity_navigation_attempted',stageId:stage.stageId,at:new Date(source.capturedAt+500).toISOString(),frameId:source.id,action,provenance};
  events.push(event);return event;
 };
 const enterEvent=configure(1,home,entered,{type:'tap',x:864,y:487},nav.activityNavigationSource);
 const homeInspection=await nav.inspectLearnedActivityNavigation(home,{package:f.cfg.package,userId:0},f.root,{exec:async()=>{throw Error('No live OCR in full-home fixture');}});
 assert.equal(homeInspection?.state,'home');Object.assign(enterEvent,{matchedComponents:homeInspection.matchedComponents});
 const listEvent=configure(2,landing,opened,{type:'tap',x:115,y:998},nav.activityLandingSource);
 const sync=()=>{
  for(const raw of [home,entered,landing,opened])write(f.root,raw.path.replace('.png','.json'),raw);
  write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);
  write(f.root,a.dir+'/runtime.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));f.flush();
 };
 sync();return {...f,...a,home,entered,landing,opened,enterEvent,listEvent,events,sync};
}

test('synthetic two-stage navigation audit accepts real 198 home to 200 landing to 195 panel',async t=>{
 const f=await twoStageNavigationFixture(t),report=await(await api()).auditStableScripts({root:f.root});
 assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);
 assert.equal(report.tasks[0].attempts[0].qualified,true);
 assert.equal(report.stableCount,0,'cross-run synthetic navigation is not a real independent device validation');
});

for(const label of ['cross-stage event','duplicate list tap','wrong landing provenance','wrong landing owner','missing panel arrival','unlearned list back'])test('two-stage audit refuses '+label,async t=>{
 const f=await twoStageNavigationFixture(t);
 if(label==='cross-stage event')f.listEvent.stageId='enter_activity';
 if(label==='duplicate list tap')f.stages[2].actions.push(structuredClone(f.stages[2].actions[0]));
 if(label==='wrong landing provenance')f.listEvent.provenance=f.enterEvent.provenance;
 if(label==='wrong landing owner')f.landing.userId=999;
 if(label==='missing panel arrival')f.stages[2].events.pop();
 if(label==='unlearned list back')f.stages[2].actions.push({source:'script',status:'verified',proposal:{frameId:f.landing.id,action:{type:'back'}}});
 f.sync();const report=await(await api()).auditStableScripts({root:f.root});
 assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='activity_navigation_unverified'),JSON.stringify(report.tasks[0].attempts[0].blockers));
});
test('two-stage audit accepts initial landing with no home tap',async t=>{
 const f=await twoStageNavigationFixture(t);f.stages[1].actions=[];f.stages[1].events=[{type:'observed',frame:f.entered}];f.events.splice(f.events.indexOf(f.enterEvent),1);f.sync();
 const report=await(await api()).auditStableScripts({root:f.root});assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);
});
test('synthetic full navigation audit independently replays saved same-frame refinement without OCR',async t=>{
 const f=await navigationFixture(t),checker=await api();
 assert.equal(typeof checker.verifyAuditActivityNavigation,'function','saved refinement requires an independent offline verifier');
 const before=[f.home.path,f.event.chromeRefinement.rawPath,f.event.chromeRefinement.path,f.event.chromeRefinement.ocrPath].map(p=>sha(fs.readFileSync(p)));
 const replay=await checker.verifyAuditActivityNavigation({root:f.root,frame:f.home,owner:{package:f.cfg.package,userId:0},refinement:f.event.chromeRefinement});
 assert.equal(replay?.state,'home');assert.deepEqual(replay?.action,{type:'tap',x:862,y:487});
 const report=await checker.auditStableScripts({root:f.root});
 assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);assert.equal(report.tasks[0].attempts[0].qualified,true);
 assert.equal(report.stableCount,0,'synthetic cross-run pixels establish no real device stability');
 assert.equal(f.home.lines.filter((l:any)=>l.text==='淘').length,0);
 assert.deepEqual([f.home.path,f.event.chromeRefinement.rawPath,f.event.chromeRefinement.path,f.event.chromeRefinement.ocrPath].map(p=>sha(fs.readFileSync(p))),before);
});

test('synthetic full navigation audit rejects fabricated refinement when original OCR already has tao',async t=>{
 const f=await navigationFixture(t,false);f.event.chromeRefinement={frameId:f.home.id};f.sync();
 const report=await(await api()).auditStableScripts({root:f.root});
 assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='activity_navigation_unverified'));
});

test('synthetic full navigation audit accepts original home OCR without refinement',async t=>{
 const f=await navigationFixture(t,false),report=await(await api()).auditStableScripts({root:f.root});
 assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);assert.equal(report.tasks[0].attempts[0].qualified,true);assert.equal(report.stableCount,0);
});

const rewriteNavigationOCR=(f:any,mutate:(o:any)=>void)=>{
 const r=f.event.chromeRefinement,ocr=load(f.root,r.ocrPath);mutate(ocr);write(f.root,r.ocrPath,ocr);r.ocrSha=sha(fs.readFileSync(r.ocrPath));
};
for(const [label,mutate] of [
 ['missing refinement',(f:any)=>{delete f.event.chromeRefinement;}],
 ['covered stable pixels with consistent hashes',async(f:any)=>{
  const r=f.event.chromeRefinement,png=await sharp(f.home.path).composite([{input:await sharp({create:{width:125,height:115,channels:3,background:'#777'}}).png().toBuffer(),left:40,top:2160}]).png().toBuffer();
  fs.writeFileSync(f.home.path,png);fs.writeFileSync(r.rawPath,png);r.sourceSha=sha(png);
  const crop=await sharp(png).extract({left:40,top:2160,width:125,height:115}).resize(250,230).png().toBuffer();fs.writeFileSync(r.path,crop);r.cropSha=sha(crop);
 }],
 ['other source frame',(f:any)=>{f.event.chromeRefinement.frameId='other';}],
 ['wrong source sha',(f:any)=>{f.event.chromeRefinement.sourceSha='0'.repeat(64);}],
 ['changed raw PNG',(f:any)=>{fs.appendFileSync(f.event.chromeRefinement.rawPath,'tamper');}],
 ['changed current PNG',(f:any)=>{fs.appendFileSync(f.home.path,'tamper');}],
 ['changed crop',(f:any)=>{fs.appendFileSync(f.event.chromeRefinement.path,'tamper');}],
 ['changed crop with updated hash',(f:any)=>{const r=f.event.chromeRefinement;fs.appendFileSync(r.path,'tamper');r.cropSha=sha(fs.readFileSync(r.path));}],
 ['wrong crop sha',(f:any)=>{f.event.chromeRefinement.cropSha='0'.repeat(64);}],
 ['changed OCR bytes',(f:any)=>{fs.appendFileSync(f.event.chromeRefinement.ocrPath,' ');}],
 ['wrong OCR sha',(f:any)=>{f.event.chromeRefinement.ocrSha='0'.repeat(64);}],
 ['missing raw PNG',(f:any)=>{fs.rmSync(f.event.chromeRefinement.rawPath);}],
 ['missing crop',(f:any)=>{fs.rmSync(f.event.chromeRefinement.path);}],
 ['missing OCR',(f:any)=>{fs.rmSync(f.event.chromeRefinement.ocrPath);}],
 ['wrong ROI',(f:any)=>{f.event.chromeRefinement.roi=[40,2150,165,2275];}],
 ['wrong scale',(f:any)=>{f.event.chromeRefinement.scale=1;}],
 ['wrong mapped bounds',(f:any)=>{f.event.chromeRefinement.bounds[0]+=1;}],
 ['elapsed over budget',(f:any)=>{f.event.chromeRefinement.elapsedMs=2501;}],
 ['negative elapsed',(f:any)=>{f.event.chromeRefinement.elapsedMs=-1;}],
 ['missing elapsed',(f:any)=>{delete f.event.chromeRefinement.elapsedMs;}],
 ['wrong event engine',(f:any)=>{f.event.chromeRefinement.engine='another OCR';}],
 ['wrong OCR engine',(f:any)=>rewriteNavigationOCR(f,o=>{o.engine='another OCR';})],
 ['missing OCR input path',(f:any)=>{delete f.event.chromeRefinement.ocrInputPath;}],
 ['wrong OCR input path',(f:any)=>{f.event.chromeRefinement.ocrInputPath='/different.png';}],
 ['wrong original OCR file',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages[0].file=f.event.chromeRefinement.path;})],
 ['no exact tao',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages[0].lines[0].text='掏';})],
 ['duplicate tao',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages[0].lines.push(structuredClone(o.pages[0].lines[0]));})],
 ['extra OCR page',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages.push(structuredClone(o.pages[0]));})],
 ['wrong OCR dimensions',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages[0].width=125;})],
 ['invalid OCR bounds',(f:any)=>rewriteNavigationOCR(f,o=>{o.pages[0].lines[0].bounds=[-1,0,50,50];})],
 ['valid mapping outside learned bounds',(f:any)=>{rewriteNavigationOCR(f,o=>{o.pages[0].lines[0].bounds=[0,0,50,50];});f.event.chromeRefinement.bounds=[40,2160,65,2185];}],
 ['crop path outside root',(f:any)=>{f.event.chromeRefinement.path=path.join(project,'evidence/staged-2026-11-01T12-48-57-664Z/11e3c401-c043-4db0-a3ce-e97948a31973.png');}],
 ['raw path symlink outside root',(f:any)=>{const r=f.event.chromeRefinement;fs.rmSync(r.rawPath);fs.symlinkSync(path.join(project,'evidence/staged-2026-11-01T12-48-57-664Z/11e3c401-c043-4db0-a3ce-e97948a31973.png'),r.rawPath);}],
 ['event before source capture',(f:any)=>{f.event.at=new Date(f.home.capturedAt-1).toISOString();}],
 ['event after arrival',(f:any)=>{f.event.at=new Date(f.entered.capturedAt+1).toISOString();}],
 ['elapsed beyond dispatch interval',(f:any)=>{f.event.chromeRefinement.elapsedMs=501;}],
 ['missing event time',(f:any)=>{delete f.event.at;}],
 ['reversed arrival order',(f:any)=>{f.opened.capturedAt=f.entered.capturedAt-1;}],
 ['unobserved source before arrival',(f:any)=>{f.stages[1].events.reverse();f.stages[1].events.push({type:'observed',frame:f.entered});}],
 ['duplicate navigation attempt',(f:any)=>{f.events.push(structuredClone(f.event));}],
 ['wrong dispatched action',(f:any)=>{f.event.action={type:'tap',x:10,y:10};}],
 ['wrong source provenance',(f:any)=>{f.event.provenance={};}],
 ['refinement outside session',(f:any)=>{const r=f.event.chromeRefinement;for(const key of ['path','rawPath','ocrPath']){const dest=path.join(f.root,'another-session',path.basename(r[key]));fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(r[key],dest);r[key]=dest;}}],
] as const)test('synthetic full navigation audit rejects '+label,async t=>{
 const f=await navigationFixture(t);await mutate(f);f.sync();
 const report=await(await api()).auditStableScripts({root:f.root}),attempt=report.tasks[0].attempts[0];
 assert.equal(attempt.qualified,false);assert.ok(attempt.blockers.some(b=>b.code==='activity_navigation_unverified'),JSON.stringify(attempt.blockers));
});

test('navigation audit accepts initial real panel frames and rejects a tampered arrival',async t=>{
 const f=fixture(t,'com.taobao.taobao');f.cfg.localActivityNavigation=true;const a=f.add('navigation-arrival',124);
 const {activityPanelSource}=await import('../runner/staged/activity-navigation.ts');
 for(const s of activityPanelSource.files){const dest=path.join(f.root,s.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(project,s.path),dest);}
 const original=load(project,activityPanelSource.files[1].path);
 for(const [stageId,id]of [['enter_activity','nav-entered'],['open_list','nav-opened']]){
  const frame={...original,id,path:path.join(f.root,a.dir,id+'.png'),capturedAt:1793491202000};fs.copyFileSync(path.join(project,activityPanelSource.files[0].path),frame.path);write(f.root,frame.path.replace('.png','.json'),frame);
  const originalOCR=load(project,activityPanelSource.files[1].path.replace(/\.json$/,'.ocr.json'));originalOCR.pages[0].file=frame.path;write(f.root,frame.path.replace(/\.png$/,'.ocr.json'),originalOCR);
  a.stages.find((s:any)=>s.stageId===stageId).events=[{type:'observed',frame}];
 }
 const sync=()=>{write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);};sync();
 let report=await(await api()).auditStableScripts({root:f.root});assert.ok(!report.tasks[0].attempts[0].blockers.some((b:any)=>b.code==='activity_navigation_unverified'));
 a.stages.find((s:any)=>s.stageId==='open_list').events[0].frame.userId=999;sync();
 report=await(await api()).auditStableScripts({root:f.root});assert.ok(report.tasks[0].attempts[0].blockers.some((b:any)=>b.code==='activity_navigation_unverified'));
});

test('navigation audit refuses enabled navigation without actual learned arrival evidence',async t=>{
 const f=fixture(t);f.cfg.localActivityNavigation=true;f.add('navigation-no-arrival',123);
 const report=await(await api()).auditStableScripts({root:f.root});
 assert.ok(report.tasks[0].attempts[0].blockers.some((b:any)=>b.code==='activity_navigation_unverified'));
});
test('navigation audit requires actual session archives of checker and shared pixel comparator',async t=>{
 const f=fixture(t);f.cfg.localActivityNavigation=true;f.add('navigation-missing',121);
 const report=await(await api()).auditStableScripts({root:f.root});const a=report.tasks[0].attempts[0];
 assert.equal(a.qualified,false);
 for(const file of ['activity-navigation.ts','panel-claim.ts'])assert.ok(a.blockers.some((b:any)=>b.code==='script_archive_missing'&&b.detail.includes(file)));
});
for(const flag of ['localLaunch','localActivityNavigation'])test('audit implementation config retains '+flag,async t=>{
 const f=fixture(t);const a=f.add('navigation-config',122);const c=load(f.root,a.dir+'/config.json');c[flag]=true;write(f.root,a.dir+'/config.json',c);
 const report=await(await api()).auditStableScripts({root:f.root});assert.ok(report.tasks[0].attempts[0].blockers.some((b:any)=>b.code==='config_archive_missing'));
});

test('automatic continuous audit refuses missing contract selection and missing selector source even with other complete synthetic records',async t=>{
 const f=fixture(t);Object.assign(f.cfg.learnedBrowse,{autoContract:true});f.cfg.stages.task_receipt.continuousScroll={maxSwipes:30,maxMs:35000,requiredMs:25000};
 f.add('auto-contract',101);
 const report=await(await api()).auditStableScripts({root:f.root});
 const attempt=report.tasks[0].attempts[0];
 assert.equal(attempt.qualified,false);
 assert.ok(attempt.blockers.some((b:any)=>b.code==='continuous_contract_unverified'));
 assert.ok(attempt.blockers.some((b:any)=>b.code==='script_archive_missing'&&b.detail.includes('continuous-contract.ts')));
});

// Synthetic audit session: historical PNG/OCR are copied unchanged in content;
// IDs, paths and capture times describe replay metadata, never a new device run.
async function automaticContinuousFixture(t:any) {
  const f=fixture(t,'com.taobao.taobao');
  f.cfg.learnedBrowse.autoContract=true;
  f.cfg.stages.task_receipt.continuousScroll={maxSwipes:30,maxMs:35000,requiredMs:25000};
  const selector='runner/staged/continuous-contract.ts';
  for(const source of [...core,selector])write(f.root,source,fs.readFileSync(path.join(project,source),'utf8'));
  const a=f.add('synthetic-auto-153',101);
  const historical='evidence/continuous-supervised-2026-11-01T05-18-43-216Z/';
  const copy=(sourceId:string,id:string,capturedAt:number)=>{
    const original=load(project,historical+sourceId+'.json');
    const raw={...original,id,path:a.dir+'/'+id+'.png',capturedAt,package:f.cfg.package,userId:0};
    fs.copyFileSync(path.join(project,historical+sourceId+'.png'),path.join(f.root,raw.path));
    assert.equal(sha(fs.readFileSync(path.join(f.root,raw.path))),sha(fs.readFileSync(path.join(project,historical+sourceId+'.png'))));
    write(f.root,raw.path.replace('.png','.json'),raw);return raw;
  };
  const initial=copy('bfbc7cc8-510d-4133-82f7-1a432fa97af7','destination',1793491202000);
  const fresh=copy('bfbc7cc8-510d-4133-82f7-1a432fa97af7','fresh',1793491203000);
  const completed=copy('17cbd398-0659-40fc-90d7-79d3ee3c188f','receipt',1793491208000);
  const {selectContinuousContract,inspectSelectedContinuousContract}=await import('../runner/staged/continuous-contract.ts');
  const owner={package:f.cfg.package,userId:0};
  const selected=await selectContinuousContract({...initial,path:path.join(f.root,initial.path)},owner);
  assert.ok(selected,'real 153 browse PNG must select the legacy contract');
  assert.deepEqual(selected.option,{rewardCoins:50});assert.deepEqual(selected.budget,{maxSwipes:16,maxMs:18000});
  const checked=await inspectSelectedContinuousContract({...completed,path:path.join(f.root,completed.path)},owner,selected);
  assert.equal(checked.inspection?.state,'completed');
  Object.assign(a.result.receipt,{quote:checked.inspection!.quote,rewardCoins:50});
  Object.assign(a.result,{balanceAfter:150,gainCoins:50});
  Object.assign(a.stages[8],{balanceAfter:150});
  for(const sample of a.stages[8].review.samples) {
    sample.balance=150;
    const raw=load(f.root,a.dir+'/'+sample.frameId+'.json');raw.lines[1].text='150';
    write(f.root,raw.path.replace('.png','.json'),raw);
    for(const stage of a.stages)for(const event of stage.events??[])if(event.frame?.id===raw.id)event.frame=raw;
  }
  const state=load(f.root,a.dir+'/session-state.json');state.archived.gainCoins=50;write(f.root,a.dir+'/session-state.json',state);
  a.stages[6].receipt=a.result.receipt;
  for(const stage of a.stages)for(const event of stage.events??[])if(event.type==='observed'){
    if(event.frame.id==='destination')event.frame=initial;if(event.frame.id==='receipt')event.frame=completed;
  }
  a.stages[6].events=[{type:'observed',at:fresh.capturedAt+10,frame:fresh},{type:'observed',at:completed.capturedAt+10,frame:completed}];
  const action=selected.inspection.action!;
  a.stages[6].actions=[{source:'script',status:'verified',proposal:{frameId:fresh.id,action}}];
  const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
  Object.assign(events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);
  events.splice(events.length-1,0,
    {kind:'continuous_contract_selected',taskAttemptId:a.result.taskAttemptId,frameId:initial.id,option:selected.option,budget:selected.budget,provenance:selected.provenance},
    {kind:'continuous_scroll_started',sourceFrameId:fresh.id,limits:selected.budget,action},
    {kind:'continuous_scroll_finished',sourceFrameId:fresh.id});
  // The selector must be bound through the same review/candidate archive chain.
  const bytes=fs.readFileSync(path.join(f.root,selector)),hash=sha(bytes),archived='data/stage-records/script-sources/'+hash+'.ts';
  write(f.root,archived,bytes.toString());
  const reviews=load(f.root,a.dir+'/reviews.json'),reviewIndex=reviews.length;
  reviews.push({stageId:'task_receipt',review:{candidateScript:{path:selector}}});write(f.root,a.dir+'/reviews.json',reviews);
  const candidateFile='data/stage-records/candidates/synthetic-auto-selector.json';
  write(f.root,candidateFile,{scope:{appId:scope.appId,activityId:scope.activityId,stage:'task_receipt'},candidateScript:{path:archived,originalPath:selector,fileSha256:hash},sources:[{sessionId:a.result.sessionId,runId:101,evidenceDir:a.dir,resultFile:a.dir+'/result.json',reviewFile:a.dir+'/reviews.json',reviewIndex}]});
  f.index.candidates.push({path:candidateFile,sessionId:a.result.sessionId,runId:101});
  const sync=()=>{
    write(f.root,a.dir+'/result.json',a.result);write(f.root,a.dir+'/stages.json',a.stages);
    const final=load(f.root,a.dir+'/final.json');Object.assign(final,a.result,{stages:a.stages});write(f.root,a.dir+'/final.json',final);
    write(f.root,a.dir+'/runtime.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));f.flush();
  };
  sync();return {...f,...a,events,initial,fresh,completed,selected,sync};
}

test('synthetic autoContract audit accepts fresh authority preserved in real engine revalidation event',async t=>{
 const f=await automaticContinuousFixture(t);
 const stage=f.stages[6];stage.events=stage.events.filter((e:any)=>e.frame?.id!==f.fresh.id);
 stage.events.unshift({type:'before_dispatch_revalidated',sourceFrameId:f.initial.id,newFrameId:f.fresh.id,frame:f.fresh,proposal:stage.actions[0].proposal});
 f.sync();
 const report=await(await api()).auditStableScripts({root:f.root});
 assert.equal(report.tasks[0].attempts[0].qualified,true,JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('synthetic autoContract audit accepts complete real-PNG source-backed session',async t=>{
  const f=await automaticContinuousFixture(t);
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);
  assert.equal(report.tasks[0].attempts[0].qualified,true);
  assert.equal(report.stableCount,0,'one synthetic session cannot establish independent stability');
});

for(const [label,mutate,code] of [
  ['missing selection',(f:any)=>{f.events.splice(f.events.findIndex((e:any)=>e.kind==='continuous_contract_selected'),1);},'continuous_contract_unverified'],
  ['duplicate selection',(f:any)=>{f.events.push(structuredClone(f.events.find((e:any)=>e.kind==='continuous_contract_selected')));},'continuous_contract_unverified'],
  ['wrong option',(f:any)=>{f.events.find((e:any)=>e.kind==='continuous_contract_selected').option={rewardCoins:20};},'continuous_contract_unverified'],
  ['wrong budget',(f:any)=>{f.events.find((e:any)=>e.kind==='continuous_contract_selected').budget={maxSwipes:30,maxMs:35000,requiredMs:25000};},'continuous_contract_unverified'],
  ['wrong provenance',(f:any)=>{f.events.find((e:any)=>e.kind==='continuous_contract_selected').provenance=[];},'continuous_contract_unverified'],
  ['other attempt selection',(f:any)=>{f.events.find((e:any)=>e.kind==='continuous_contract_selected').taskAttemptId='other-attempt';},'continuous_contract_unverified'],
  ['wrong fresh frame',(f:any)=>{f.events.find((e:any)=>e.kind==='continuous_scroll_started').sourceFrameId=f.initial.id;},'continuous_contract_unverified'],
  ['unrefreshed swipe frame',(f:any)=>{for(const e of f.events)if(/^continuous_scroll_/.test(e.kind))e.sourceFrameId=f.initial.id;f.stages[6].actions[0].proposal.frameId=f.initial.id;f.stages[6].events.unshift({type:'observed',at:f.initial.capturedAt+10,frame:f.initial});},'continuous_contract_unverified'],
  ['wrong receipt amount',(f:any)=>{f.result.receipt.rewardCoins=20;Object.assign(f.events.find((e:any)=>e.kind==='learned_receipt'),f.result.receipt);},'continuous_contract_unverified'],
  ['missing selector archive',(f:any)=>{f.index.candidates=f.index.candidates.filter((c:any)=>load(f.root,c.path).candidateScript.originalPath!=='runner/staged/continuous-contract.ts');},'script_archive_missing'],
] as const)test('synthetic autoContract audit rejects '+label,async t=>{
  const f=await automaticContinuousFixture(t);mutate(f);f.sync();
  const report=await(await api()).auditStableScripts({root:f.root}),attempt=report.tasks[0].attempts[0];
  assert.equal(attempt.qualified,false);assert.ok(attempt.blockers.some(b=>b.code===code),JSON.stringify(attempt.blockers));
});

function immersiveFixture(t:any) {
  const f=fixture(t);
  f.cfg.immersiveBrowse={enabled:true,version:'immersive-browse-candidate-v1',sourceRunId:145,task:{name:task.name,instruction:task.instruction},observationBudgetMs:20000};
  f.cfg.scriptValidationMode=true;
  write(f.root,'runner/staged/immersive-ocr-quality.ts',fs.readFileSync(path.join(project,'runner/staged/immersive-ocr-quality.ts'),'utf8'));
  write(f.root,'runner/staged/immersive-browse.ts',fs.readFileSync(path.join(project,'runner/staged/immersive-browse.ts'),'utf8'));
  return f;
}

function immersiveV2Fixture(t:any,amount=20) {
  const f=immersiveFixture(t);Object.assign(f.cfg.immersiveBrowse,{version:'immersive-browse-candidate-v2',allowedRewardCoins:amount===35?[20,35,50]:[20,50]});
  const add=(id:string,runId:number)=>{
    const a=f.add(id,runId),destination=load(f.root,a.dir+'/destination.json'),receiptFrame=load(f.root,a.dir+'/receipt.json');
    destination.lines=[{text:'浏览',bounds:[934,1263,996,1294]},{text:'得'+amount,bounds:[930,1298,1007,1329]}];
    receiptFrame.lines=[{text:'已得'+amount,bounds:[920,1270,1014,1301]}];
    Object.assign(a.result.receipt,{quote:'已得'+amount,rewardCoins:amount});
    for(const stage of a.stages)for(const event of stage.events??[])if(event.type==='observed'){
      if(event.frame.id==='destination')event.frame=destination;if(event.frame.id==='receipt')event.frame=receiptFrame;
    }
    write(f.root,destination.path.replace('.png','.json'),destination);write(f.root,receiptFrame.path.replace('.png','.json'),receiptFrame);
    const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
    Object.assign(events.find((e:any)=>e.kind==='learned_destination_confirmed'),{state:'browsing',rewardCoins:amount});
    Object.assign(events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);
    const sync=()=>{
      write(f.root,a.dir+'/result.json',a.result);write(f.root,a.dir+'/stages.json',a.stages);
      const final=load(f.root,a.dir+'/final.json');Object.assign(final,{receipt:a.result.receipt,stages:a.stages});write(f.root,a.dir+'/final.json',final);
      write(f.root,a.dir+'/runtime.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));f.flush();
    };
    sync();return {...a,events,sync,receiptFrame};
  };
  return {...f,add};
}

// Synthetic audit sessions only: copied historical pixels are not new device captures.
async function transitionFixture(t:any) {
  const {buildImmersiveTransition}=await import('../runner/staged/immersive-transition.ts');
  const f=immersiveV2Fixture(t,35),contract=await buildImmersiveTransition(project);
  // Keep the original source paths/hash/version; source bytes remain immutable.
  for(const source of contract.files) {
    const relative=path.relative(project,source.path);
    fs.mkdirSync(path.dirname(path.join(f.root,relative)),{recursive:true});
    fs.copyFileSync(source.path,path.join(f.root,relative));
  }
  const relocated={...contract,files:contract.files.map(s=>({...s,path:path.resolve(f.root,path.relative(project,s.path))}))};
  relocated.version='immersive-reward-transition-v1:'+sha(JSON.stringify({...relocated,version:''}));
  f.cfg.immersiveBrowse.rewardTransitions=[relocated];
  write(f.root,'runner/staged/immersive-transition.ts',fs.readFileSync(path.join(project,'runner/staged/immersive-transition.ts'),'utf8'));
  const add=(id:string,runId:number)=>{
    const a=f.add(id,runId),before=load(project,path.relative(project,contract.files[3].path)),after=load(project,path.relative(project,contract.files[5].path));
    const destination=load(f.root,a.dir+'/destination.json');
    Object.assign(destination,{lines:before.lines,package:f.cfg.package,capturedAt:1793491202000});
    Object.assign(a.receiptFrame,{lines:after.lines,capturedAt:1793491208000});
    Object.assign(a.result.receipt,{requirementRewardCoins:20,rewardTransitionVersion:relocated.version});
    for(const stage of a.stages)for(const e of stage.events??[])if(e.type==='observed') {
      if(e.frame.id==='destination')e.frame=destination;
      if(e.frame.id==='receipt')e.frame=a.receiptFrame;
    }
    // Mock account ownership, while retaining real pixel components.
    f.cfg.package='com.taobao.taobao';
    for(const name of ['before','destination','receipt','after','after2']) {
      const raw= name==='destination'?destination:name==='receipt'?a.receiptFrame:load(f.root,a.dir+'/'+name+'.json');
      raw.package=f.cfg.package;
      write(f.root,raw.path.replace('.png','.json'),raw);
      for(const stage of a.stages)for(const e of stage.events??[])if(e.frame?.id===raw.id)e.frame=raw;
    }
    fs.copyFileSync(contract.files[2].path,path.join(f.root,destination.path));
    fs.copyFileSync(contract.files[4].path,path.join(f.root,a.receiptFrame.path));
    Object.assign(a.events.find((e:any)=>e.kind==='learned_destination_confirmed'),{rewardCoins:20});
    Object.assign(a.events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);
    a.stages[6].actions[0].proposal.action.ms=6000;
    a.stages[6].events.splice(1,0,{type:'authority_consumed',at:1793491202100,frameId:'destination',actionAttempt:1});
    a.events.splice(a.events.length-1,0,{kind:'immersive_reward_transition',taskAttemptId:a.result.taskAttemptId,fromRewardCoins:20,toRewardCoins:35,browseFrameId:'destination',receiptFrameId:'receipt',waitMs:6000,version:relocated.version});
    a.sync();return {...a,destination};
  };
  // Must be set before source/config archives are created.
  f.cfg.package='com.taobao.taobao';
  const originalFlush=f.flush;
  f.flush=()=>{originalFlush();write(f.root,'data/knowledge.json',{application:{package:f.cfg.package}});};
  return {...f,contract:relocated,add};
}

test('synthetic mock audit accepts only complete source-backed 20 to 35 chains',async t=>{
  const f=await transitionFixture(t);f.add('one',1);f.add('two',2);f.flush();
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1,JSON.stringify(report.tasks[0].attempts.map(a=>a.blockers)));
});

for(const [label,mutate,code] of [
  ['conflicting receipt-stage browse frame',(_f:any,a:any)=>{a.stages[6].events[0]={...a.stages[6].events[0],frame:{...a.destination,userId:999}};},'reward_transition_unverified'],
  ['wait dispatch timestamp outside receipt interval',(_f:any,a:any)=>{a.stages[6].events.find((e:any)=>e.type==='authority_consumed').at=a.receiptFrame.capturedAt+1;},'reward_transition_unverified'],
  ['missing transition config',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');delete cfg.immersiveBrowse.rewardTransitions;write(f.root,a.dir+'/config.json',cfg);},'receipt_unverified'],
  ['source bytes tampered',(f:any)=>fs.appendFileSync(f.contract.files[0].path,' '),'reward_transition_unverified'],
  ['source frame hash tampered',(f:any)=>fs.appendFileSync(f.contract.files[3].path,' '),'reward_transition_unverified'],
  ['source PNG tampered',(f:any)=>fs.appendFileSync(f.contract.files[4].path,' '),'reward_transition_unverified'],
  ['missing wait actions',(_f:any,a:any)=>{a.stages[6].actions=[];},'reward_transition_unverified'],
  ['missing wait dispatch event',(_f:any,a:any)=>{a.stages[6].events=a.stages[6].events.filter((e:any)=>e.type!=='authority_consumed');},'reward_transition_unverified'],
  ['wait event after receipt',(_f:any,a:any)=>{a.stages[6].events.push(a.stages[6].events.splice(1,1)[0]);},'reward_transition_unverified'],
  ['zero wait',(_f:any,a:any)=>{a.stages[6].actions[0].proposal.action.ms=0;},'reward_transition_unverified'],
  ['excess wait',(_f:any,a:any)=>{a.stages[6].actions[0].proposal.action.ms=20001;},'reward_transition_unverified'],
  ['wrong wait total',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='immersive_reward_transition').waitMs=3000;},'reward_transition_unverified'],
  ['wrong transition attempt',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='immersive_reward_transition').taskAttemptId='other';},'reward_transition_unverified'],
  ['wrong transition browse frame',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='immersive_reward_transition').browseFrameId='before';},'reward_transition_unverified'],
  ['wrong transition receipt frame',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='immersive_reward_transition').receiptFrameId='destination';},'reward_transition_unverified'],
  ['wrong transition version',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='immersive_reward_transition').version='invented';},'reward_transition_unverified'],
  ['missing receipt variant version',(_f:any,a:any)=>{delete a.result.receipt.rewardTransitionVersion;},'reward_transition_unverified'],
  ['missing receipt requirement',(_f:any,a:any)=>{delete a.result.receipt.requirementRewardCoins;},'reward_transition_unverified'],
  ['wrong learned receipt requirement',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='learned_receipt').requirementRewardCoins=35;},'receipt_unverified'],
  ['wrong learned receipt variant version',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='learned_receipt').rewardTransitionVersion='invented';},'receipt_unverified'],
  ['wrong pinned amount',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='learned_destination_confirmed').rewardCoins=35;},'reward_transition_unverified'],
  ['missing entry dispatch',(_f:any,a:any)=>{a.events.find((e:any)=>e.kind==='learned_entry_dispatched').dispatched=false;},'actual_entry_missing'],
  ['out of order capture',(f:any,a:any)=>{a.receiptFrame.capturedAt=a.destination.capturedAt-1;write(f.root,a.receiptFrame.path.replace('.png','.json'),a.receiptFrame);},'reward_transition_unverified'],
  ['wrong current owner',(f:any,a:any)=>{a.receiptFrame.userId=999;write(f.root,a.receiptFrame.path.replace('.png','.json'),a.receiptFrame);},'frame_unverified'],
  ['changed current PNG',(f:any,a:any)=>write(f.root,a.receiptFrame.path,'synthetic invalid PNG'),'reward_transition_unverified'],
  ['missing transition archive',(f:any)=>{f.index.candidates=f.index.candidates.filter((c:any)=>load(f.root,c.path).candidateScript.originalPath!=='runner/staged/immersive-transition.ts');},'script_archive_missing'],
  ['unknown stage action',(_f:any,a:any)=>{a.stages[6].actions[0].status='observed';},'non_script_action'],
  ['missing settlement',(f:any,a:any)=>{a.stages[8].review.samples=[];},'settlement_unverified'],
  ['nonzero model usage',(f:any,a:any)=>write(f.root,a.dir+'/usage.json',[{calls:1,tokens:12}]),'model_usage'],
] as const)test('synthetic 20 to 35 audit rejects '+label,async t=>{
  const f=await transitionFixture(t),a=f.add('one',1);f.add('two',2);mutate(f,a);a.sync();f.flush();
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code===code),JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('real stopped 184 remains ineligible and its evidence is never backfilled',async()=>{
  const dir='evidence/staged-2026-11-01T10-35-22-744Z';
  const files=['result.json','stages.json','runtime.jsonl','final.json'].map(f=>path.join(project,dir,f));
  const before=files.map(f=>sha(fs.readFileSync(f)));
  const result=load(project,dir+'/result.json');assert.equal(result.receipt,null);assert.equal(result.balanceAfter,null);
  const report=await(await api()).auditStableScripts({root:project});
  const attempt=report.tasks.flatMap(t=>t.attempts).find(a=>a.runId===184);
  assert.ok(attempt);assert.equal(attempt.qualified,false);assert.ok(attempt.blockers.length>0);
  assert.deepEqual(files.map(f=>sha(fs.readFileSync(f))),before);
});

for(const amount of [20,35,50])test('immersive v2 accepts explicit amount '+amount+' with pinned observation and source 145',async t=>{
  const f=immersiveV2Fixture(t,amount);f.add('one',1);f.add('two',2);
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1,JSON.stringify(report.tasks[0].attempts.map(a=>a.blockers)));
});

for(const [label,mutate] of [
  ['unknown amount',(a:any)=>{a.result.receipt.rewardCoins=30;a.result.receipt.quote='已得30';a.receiptFrame.lines[0].text='已得30';Object.assign(a.events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);}],
  ['wrong completed amount',(a:any)=>{a.result.receipt.rewardCoins=50;a.result.receipt.quote='已得50';a.receiptFrame.lines[0].text='已得50';Object.assign(a.events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);}],
  ['missing reward',(a:any)=>{delete a.result.receipt.rewardCoins;}],
  ['wrong quote amount',(a:any)=>{a.result.receipt.quote='已得50';a.receiptFrame.lines[0].text='已得50';Object.assign(a.events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);}],
  ['wrong receipt event amount',(a:any)=>{a.events.find((e:any)=>e.kind==='learned_receipt').rewardCoins=50;}],
  ['wrong receipt source',(a:any)=>{a.events.find((e:any)=>e.kind==='learned_receipt').sourceRunId=153;}],
  ['wrong receipt version',(a:any)=>{a.result.receipt.version='immersive-browse-candidate-v1';Object.assign(a.events.find((e:any)=>e.kind==='learned_receipt'),a.result.receipt);}],
  ['missing pinned observation',(a:any)=>{a.events.find((e:any)=>e.kind==='learned_destination_confirmed').rewardCoins=undefined;}],
] as const)test('immersive v2 rejects '+label,async t=>{
  const f=immersiveV2Fixture(t),a=f.add('one',1);f.add('two',2);mutate(a);
  write(f.root,a.receiptFrame.path.replace('.png','.json'),a.receiptFrame);a.sync();
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='receipt_unverified'),JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('immersive v2 authorization must match both configured version and source',async t=>{
  const f=immersiveV2Fixture(t),a=f.add('one',1);f.add('two',2);
  for(const change of [{sourceRunId:153},{version:'immersive-browse-candidate-v1'}]) {
    for(const e of a.events.filter((e:any)=>e.kind==='explicit_candidate_authorized'))Object.assign(e,{version:f.cfg.immersiveBrowse.version,sourceRunId:145},change);
    a.sync();const report=await(await api()).auditStableScripts({root:f.root});
    assert.equal(report.stableCount,0);assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='local_authorization_missing'));
  }
});

test('immersive v2 current allowed amount changes invalidate its archived config',async t=>{
  const f=immersiveV2Fixture(t),a=f.add('one',1);f.add('two',2);
  const current=load(f.root,a.configFile);current.immersiveBrowse.allowedRewardCoins=[20];write(f.root,a.configFile,current);
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='script_source_invalid'));
});

test('immersive v2 rejects an amount excluded by its explicit config',async t=>{
  const f=immersiveV2Fixture(t,50);f.cfg.immersiveBrowse.allowedRewardCoins=[20];f.add('one',1);f.add('two',2);
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);assert.ok(report.tasks[0].attempts.every(a=>a.blockers.some(b=>b.code==='receipt_unverified')));
});

test('immersive v2 allowed amounts participate in implementation fingerprint',async t=>{
  const f=immersiveV2Fixture(t);f.add('one',1);f.cfg.immersiveBrowse.allowedRewardCoins=[20];f.add('two',2);
  const report=await(await api()).auditStableScripts({root:f.root});
  assert.equal(report.tasks[0].fingerprints.length,2);assert.equal(report.stableCount,0);
});

test('two independent immersive sessions bind source 145 and the actual archived checker',async t=>{
  const f=immersiveFixture(t);f.add('one',1);f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1,JSON.stringify(report.tasks[0].attempts.map(a=>a.blockers)));
  assert.equal(report.tasks[0].qualifyingSessionCount,2);
  assert.equal(report.tasks[0].fingerprints.length,1);
  const expected=sha(fs.readFileSync(path.join(project,'runner/staged/immersive-browse.ts')));
  assert.ok(report.tasks[0].attempts.every(a=>a.scriptSources.some(s=>s.originalPath==='runner/staged/immersive-browse.ts'&&s.sha256===expected)));
});

test('matched immersive observation budget participates in implementation fingerprint',async t=>{
  const f=immersiveFixture(t);f.add('one',1);f.cfg.immersiveBrowse.observationBudgetMs=15000;f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);assert.equal(report.tasks[0].qualifyingSessionCount,1);
  assert.equal(report.tasks[0].fingerprints.length,2);
  assert.ok(report.tasks[0].attempts.every(a=>a.qualified));
});

test('current immersive config cannot reuse an archive with a different matched budget',async t=>{
  const f=immersiveFixture(t),one=f.add('one',1);f.add('two',2);
  const current=load(f.root,one.configFile);current.immersiveBrowse.observationBudgetMs=15000;write(f.root,one.configFile,current);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='script_source_invalid'));
});

test('unmatched immersive config does not affect another task fingerprint or require its checker archive',async t=>{
  const f=immersiveFixture(t);f.cfg.immersiveBrowse.task={name:'other',instruction:'other'};f.add('one',1);
  f.cfg.immersiveBrowse.observationBudgetMs=15000;f.add('two',2);
  f.index.candidates=f.index.candidates.filter((c:any)=>load(f.root,c.path).candidateScript.originalPath!=='runner/staged/immersive-browse.ts');f.flush();
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1,JSON.stringify(report.tasks[0].attempts.map(a=>a.blockers)));
  assert.equal(report.tasks[0].fingerprints.length,1);
  assert.ok(report.tasks[0].attempts.every(a=>!a.scriptSources.some(s=>s.originalPath==='runner/staged/immersive-browse.ts')));
});

for(const [label,mutate,code] of [
  ['authorization source 153',(f:any,a:any)=>{
    const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
    for(const e of events)if(e.kind==='explicit_candidate_authorized')e.sourceRunId=153;
    write(f.root,a.dir+'/runtime.jsonl',events.map(e=>JSON.stringify(e)).join('\n'));
  },'local_authorization_missing'],
  ['authorization version',(f:any,a:any)=>{
    const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').replaceAll('immersive-browse-candidate-v1','continuous-browse-candidate-v1');
    write(f.root,a.dir+'/runtime.jsonl',events);
  },'local_authorization_missing'],
  ['disabled immersive',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.immersiveBrowse.enabled=false;write(f.root,a.dir+'/config.json',cfg);},'local_authorization_missing'],
  ['disabled learned browse',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.learnedBrowse.enabled=false;write(f.root,a.dir+'/config.json',cfg);},'local_authorization_missing'],
  ['different task name',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.immersiveBrowse.task.name+='other';write(f.root,a.dir+'/config.json',cfg);},'local_authorization_missing'],
  ['different task instruction',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.immersiveBrowse.task.instruction+=' ';write(f.root,a.dir+'/config.json',cfg);},'local_authorization_missing'],
  ['wrong config source',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.immersiveBrowse.sourceRunId=153;write(f.root,a.dir+'/config.json',cfg);},'invalid_config'],
  ['wrong config version',(f:any,a:any)=>{const cfg=load(f.root,a.dir+'/config.json');cfg.immersiveBrowse.version='continuous-browse-candidate-v1';write(f.root,a.dir+'/config.json',cfg);},'invalid_config'],
  ['changed current checker',(f:any)=>write(f.root,'runner/staged/immersive-browse.ts','// changed checker'),'script_source_invalid'],
  ['corrupt checker archive',(f:any,a:any)=>{
    const ref=f.index.candidates.find((c:any)=>c.sessionId==='one'&&load(f.root,c.path).candidateScript.originalPath==='runner/staged/immersive-browse.ts');
    write(f.root,load(f.root,ref.path).candidateScript.path,'// corrupted archive');
  },'script_source_invalid'],
  ['missing checker binding',(f:any)=>{f.index.candidates=f.index.candidates.filter((c:any)=>load(f.root,c.path).candidateScript.originalPath!=='runner/staged/immersive-browse.ts');f.flush();},'script_archive_missing'],
  ['model usage',(f:any,a:any)=>write(f.root,a.dir+'/usage.json',[{calls:1,tokens:20}]),'model_usage'],
  ['unknown receipt event',(f:any,a:any)=>{a.stages[6].events.push({type:'unknown',at:1793491201000});},'unsafe_stage_event'],
  ['unverified task action',(f:any,a:any)=>{a.stages[6].actions[0].status='unverified';},'non_script_action'],
  ['recovered entry',(f:any,a:any)=>{const session=load(f.root,a.dir+'/session.json');session.resume={runId:145};write(f.root,a.dir+'/session.json',session);},'non_normal_entry'],
] as const)test('immersive audit rejects '+label,async t=>{
  const f=immersiveFixture(t),a=f.add('one',1);f.add('two',2);mutate(f,a);
  write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code===code),JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('malformed per-attempt stage evidence is reported without aborting the other candidates',async t=>{
  const f=fixture(t);const a=f.add('one',1);f.add('two',2);a.stages[5].events={claimed:'completed'};write(f.root,a.dir+'/stages.json',a.stages);
  const r=await (await api()).auditStableScripts({root:f.root});assert.equal(r.tasks[0].attemptCount,2);assert.equal(r.stableCount,0);
  assert.ok(r.tasks[0].attempts[0].blockers.some(b=>b.code==='malformed_evidence'));
});

test('embedded matched contract source requires real bytes and an explicit SHA256',async t=>{
  const f=fixture(t);f.cfg.contracts={source:{resultPath:'evidence/nonexistent/result.json',resultSha256:null}};f.add('one',1);f.add('two',2);
  const r=await (await api()).auditStableScripts({root:f.root});assert.equal(r.stableCount,0);
  assert.ok(r.tasks[0].attempts[0].blockers.some(b=>b.code==='contract_source_invalid'));
});

test('matched dwell contract uses its actual local version and archived checker; other task contracts do not change fingerprint',async t=>{
  const f=fixture(t);write(f.root,'runner/staged/dwell-browse.ts','// dwell checker\n');
  f.cfg.dwellBrowse={version:'dwell-browse-candidate-v1',contracts:[{task:{name:task.name,instruction:task.instruction},version:'contract-v1',dwellMs:5000,knownRequirements:['visible 5 seconds']}]};
  const adapt=(a:any)=>{
    for(const s of a.stages.filter((s:any)=>['open_task','task_receipt'].includes(s.stageId)))s.usedScriptVersion='dwell-browse-candidate-v1';
    write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);
    const events=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').replaceAll('continuous-browse-candidate-v1','dwell-browse-candidate-v1');write(f.root,a.dir+'/runtime.jsonl',events);
  };
  const one=f.add('one',1);adapt(one);
  f.cfg.dwellBrowse.contracts.push({task:{name:'other',instruction:'other'},version:'unrelated',dwellMs:5000});
  const two=f.add('two',2);adapt(two);
  const r=await (await api()).auditStableScripts({root:f.root});assert.equal(r.stableCount,1,JSON.stringify(r.tasks[0].attempts.map(a=>a.blockers)));
  assert.equal(r.tasks[0].fingerprints.length,1);
  assert.ok(r.tasks[0].attempts[0].scriptSources.some(s=>s.originalPath==='runner/staged/dwell-browse.ts'));
});

test('real run 162 dwell receipt quote is accepted as an ordered component sequence',async t=>{
  const f=fixture(t),a=f.add('one',1);
  const dir='evidence/staged-2026-11-01T07-51-23-154Z';
  const final=load(project,dir+'/final.json'),stages=load(project,dir+'/stages.json');
  const recorded=stages.find((s:any)=>s.stageId==='task_receipt').events.find((e:any)=>e.type==='observed'&&e.frame?.id===final.receipt.frameId).frame;
  assert.deepEqual(recorded,load(project,dir+'/'+final.receipt.frameId+'.json'));
  // Keep the real OCR text, bounds and ordering; mock unrelated session scope.
  const raw={...recorded,package:f.cfg.package,path:a.dir+'/'+recorded.id+'.png'};
  const texts=['+20','任务已完成','继续逛逛吧'];
  const quote=texts.map(text=>raw.lines.find((l:any)=>l.text===text).text).join(' ');
  assert.equal(quote,'+20 任务已完成 继续逛逛吧');
  const receipt={...a.result.receipt,frameId:raw.id,path:raw.path,quote};
  a.result.receipt=receipt;a.stages[6].receipt=receipt;
  a.stages[6].events.push({type:'observed',at:raw.capturedAt+10,frame:raw});
  fs.copyFileSync(path.resolve(project,recorded.path),path.join(f.root,raw.path));
  const sync=()=>{
    write(f.root,raw.path.replace('.png','.json'),raw);
    write(f.root,a.dir+'/result.json',a.result);write(f.root,a.dir+'/stages.json',a.stages);
    const saved=load(f.root,a.dir+'/final.json');Object.assign(saved,{receipt,stages:a.stages});write(f.root,a.dir+'/final.json',saved);
    const runtime=fs.readFileSync(path.join(f.root,a.dir,'runtime.jsonl'),'utf8').split('\n').map(s=>JSON.parse(s));
    Object.assign(runtime.find((e:any)=>e.kind==='learned_receipt'),receipt);
    write(f.root,a.dir+'/runtime.jsonl',runtime.map(e=>JSON.stringify(e)).join('\n'));f.flush();
  };
  sync();
  const audit=async()=> (await (await api()).auditStableScripts({root:f.root})).tasks[0].attempts[0];
  const accepted=await audit();assert.deepEqual(accepted.blockers,[]);assert.equal(accepted.qualified,true);
  const original=structuredClone(raw.lines);
  for(const mutate of [
    ()=>{raw.lines=raw.lines.filter((l:any)=>l.text!=='继续逛逛吧');},
    ()=>{raw.lines.find((l:any)=>l.text==='任务已完成').bounds=[100,800,400,850];},
    ()=>{const reward=raw.lines.find((l:any)=>l.text==='+20'),done=raw.lines.find((l:any)=>l.text==='任务已完成');[reward.bounds,done.bounds]=[done.bounds,reward.bounds];},
    ()=>{raw.lines.push({...raw.lines.find((l:any)=>l.text==='任务已完成'),bounds:[100,800,400,850]});},
  ]) {
    raw.lines=structuredClone(original);mutate();sync();
    const rejected=await audit();assert.equal(rejected.qualified,false);
    assert.ok(rejected.blockers.some(b=>b.code==='receipt_unverified'),JSON.stringify(rejected.blockers));
  }
});

test('historical dwell provenance requires the actual evidence adapter archive',async t=>{
 const f=fixture(t);write(f.root,'runner/staged/dwell-browse.ts','// dwell checker');
 f.cfg.dwellBrowse={version:'dwell-browse-candidate-v1',contracts:[{task:{name:task.name,instruction:task.instruction},version:'candidate',dwellMs:5000,provenance:{kind:'historical-dwell-v1'}}]};
 f.add('one',1);f.add('two',2);
 const r=await(await api()).auditStableScripts({root:f.root});
 assert.ok(r.tasks[0].attempts.every(a=>a.blockers.some(b=>b.code==='script_archive_missing'&&b.detail.includes('dwell-evidence.ts'))));
});

test('remaining quota requires the same returned identity for stability; another named row cannot inherit completion',async t=>{
 const f=fixture(t);const a=f.add('one',1);f.add('two',2);
 for(const id of ['one','two'])for(const name of ['after','after2']){
  const file='evidence/'+id+'/'+name+'.json',raw=load(f.root,file);
  raw.lines=raw.lines.map((l:any)=>l.text===task.name+'（1/2）'?{...l,text:'Different task（1/2）'}:l);
  write(f.root,file,raw);
 }
 const r=await(await api()).auditStableScripts({root:f.root});
 assert.equal(r.stableCount,0);
 assert.ok(r.tasks[0].attempts.every(a=>a.blockers.some(b=>b.code==='remaining_quota_identity_unverified')));
});

test('two execution rows pointing to the same session never become two validations',async t=>{
  const f=fixture(t);const one=f.add('one',1);f.bundle.executions.push({...one.execution,id:'duplicate'});f.flush();
  const r=await (await api()).auditStableScripts({root:f.root});assert.equal(r.stableCount,0);assert.equal(r.tasks[0].qualifyingSessionCount,1);
});

test('live project audit preserves known candidates and includes exactly the successful account identities without changing historical files',async()=>{
  const bundleFile=path.join(project,'data/account-task-data/taobao/tb_main/tb_coin/bundle.json');
  const before=sha(fs.readFileSync(bundleFile));
  const bundle=JSON.parse(fs.readFileSync(bundleFile,'utf8'));
  const expected=new Set<string>();
  for(const execution of bundle.executions){
    if(!['completed','supervised_success'].includes(execution.result?.status)||!Number.isFinite(execution.result?.gainCoins)||execution.result.gainCoins<=0)continue;
    const snapshot=bundle.snapshots.find((s:any)=>s.id===execution.taskSnapshotId);
    const task=bundle.tasks.find((t:any)=>t.id===snapshot?.taskId);
    if(task?.name?.trim()&&task?.instruction?.trim())expected.add(JSON.stringify([task.name,task.instruction]));
  }
  const r=await (await api()).auditStableScripts({root:project});
  const actual=r.tasks.map(t=>JSON.stringify([t.name,t.instruction]));
  assert.equal(new Set(actual).size,actual.length,'No duplicate candidate identities');
  assert.deepEqual([...actual].sort(),[...expected].sort(),'No omitted or unearned candidates');
  assert.equal(r.candidateCount,expected.size);
  const historical=[128,129,130,131,132,134,138,146,153,157,160,161,162,164,165,168];
  const successes=new Set(r.tasks.flatMap(t=>t.historicalSuccessRunIds));
  assert.ok(historical.every(id=>successes.has(id)));
  assert.equal(r.stableCount,r.tasks.filter(t=>t.state==='stable').length);
  for(const task of r.tasks){
    assert.ok(task.attempts.every(a=>a.qualified?a.blockers.length===0:a.blockers.length>0));
    const repeated=task.fingerprints.some(f=>new Set(f.sessionIds).size>=2);
    assert.equal(task.state==='stable',repeated,'stable requires two independent sessions with the same implementation');
  }
  assert.equal(sha(fs.readFileSync(path.join(project,'data/account-task-data/taobao/tb_main/tb_coin/bundle.json'))),before);
});

test('positive known usage remains measurable while failing zero model acceptance',async t=>{
  const f=fixture(t);const a=f.add('one',1);write(f.root,a.dir+'/usage.json',[{calls:1,tokens:20,promptTokens:15,completionTokens:5}]);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.tasks[0].attempts[0].modelCalls,1);assert.equal(report.tasks[0].attempts[0].tokens,20);
  assert.equal(report.tasks[0].attempts[0].blockers.some(b=>b.code==='usage_unknown'),false);
});

test('changing current matched contract reference cannot reuse historical validation',async t=>{
  const f=fixture(t);f.add('one',1);const current=load(f.root,'configs/one.json');current.contracts={source:'runner/contracts/new.ts'};write(f.root,'configs/one.json',current);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.tasks[0].attempts[0].qualified,false);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='script_source_invalid'));
});

test('same config path may change plan and source provenance without invalidating archived implementation',async t=>{
  const f=fixture(t);const one=f.add('one',1);f.cfg.planFile='different-plan.json';f.cfg.learnedBrowse.sourceRunId=999;const two=f.add('two',2);
  write(f.root,one.configFile,f.cfg);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1);assert.equal(report.tasks[0].fingerprints.length,1);
});

test('provenance and plan changes preserve implementation fingerprint',async t=>{
  const f=fixture(t);f.add('one',1);f.cfg.planFile='next-plan.json';f.cfg.learnedBrowse.sourceRunId=999;
  f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1);assert.equal(report.tasks[0].fingerprints.length,1);
});

test('null scope and null date fail closed instead of coercing to zero or epoch',async t=>{
  const f=fixture(t);const one=f.add('one',1);f.add('two',2);
  const session=load(f.root,one.dir+'/session.json');session.scope.userId=null;session.startedAt=null;write(f.root,one.dir+'/session.json',session);
  const report=await (await api()).auditStableScripts({root:f.root});assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='invalid_date'));
});

for(const [label,mutate,code] of [
  ['usage null',(f:any,a:any)=>write(f.root,a.dir+'/usage.json',null),'usage_unknown'],
  ['partial usage',(f:any,a:any)=>write(f.root,a.dir+'/usage.json',{calls:0,tokens:null}),'usage_unknown'],
  ['model usage',(f:any,a:any)=>write(f.root,a.dir+'/usage.json',[{calls:1,tokens:20}]),'model_usage'],
  ['missing usedScriptVersion',(f:any,a:any)=>{delete a.stages[6].usedScriptVersion;},'script_version_missing'],
  ['unknown action source',(f:any,a:any)=>{a.stages[6].actions[0].source='unknown';},'non_script_action'],
  ['no actual task action',(f:any,a:any)=>{a.stages[6].actions=[];},'task_script_action_missing'],
  ['stopped stage',(f:any,a:any)=>{a.stages[6].status='stopped';},'stage_not_completed'],
  ['awake cleanup',(f:any,a:any)=>write(f.root,a.dir+'/cleanup.json',{power:'mWakefulness=Awake',errors:[]}),'cleanup_unverified'],
  ['missing authorization',(f:any,a:any)=>write(f.root,a.dir+'/runtime.jsonl',''),'local_authorization_missing'],
  ['changed core source',(f:any)=>write(f.root,'runner/staged/engine.ts','// changed implementation'),'script_source_invalid'],
  ['changed archive helper',(f:any)=>write(f.root,'runner/staged/source-archive.ts','// changed archiver'),'script_source_invalid'],
  ['missing archives',(f:any)=>fs.rmSync(path.join(f.root,'data/stage-records/script-sources'),{recursive:true}),'script_source_invalid'],
  ['wrong receipt attempt',(f:any,a:any)=>{a.stages[6].receipt.taskAttemptId='other';},'receipt_unverified'],
  ['wrong entry coordinates',(f:any,a:any)=>{a.stages[5].actions[0].proposal.action.x=10;},'actual_entry_missing'],
  ['unstable actual balance',(f:any,a:any)=>{const raw=load(f.root,a.dir+'/after2.json');raw.lines[1].text='106';write(f.root,a.dir+'/after2.json',raw);},'settlement_unverified'],
] as const) test('rejects '+label,async t=>{
  const f=fixture(t);const a=f.add('one',1);f.add('two',2);mutate(f,a);
  write(f.root,a.dir+'/stages.json',a.stages);const final=load(f.root,a.dir+'/final.json');final.stages=a.stages;write(f.root,a.dir+'/final.json',final);
  const report=await (await api()).auditStableScripts({root:f.root});assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code===code),JSON.stringify(report.tasks[0].attempts[0].blockers));
});

test('source archive helper requires a session-bound archive even when its bytes exist',async t=>{
  const f=fixture(t);f.add('one',1);f.add('two',2);
  f.index.candidates=f.index.candidates.filter((c:any)=>load(f.root,c.path).candidateScript.originalPath!=='runner/staged/source-archive.ts');f.flush();
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts.every(a=>a.blockers.some(b=>b.code==='script_archive_missing'&&b.detail.includes('runner/staged/source-archive.ts'))));
});

test('source archive helper participates in the implementation fingerprint',async t=>{
  const f=fixture(t);f.add('one',1);f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1);
  assert.ok(report.tasks[0].attempts.every(a=>a.scriptSources.some(s=>s.originalPath==='runner/staged/source-archive.ts')));
});

test('contract source bytes participate in fingerprint and require a session archive',async t=>{
  const f=fixture(t);write(f.root,'runner/contracts/current.ts','// matched contract\n');
  f.cfg.contracts={source:'runner/contracts/current.ts'};f.add('one',1);f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='script_archive_missing'&&b.detail.includes('runner/contracts/current.ts')));
});

test('CLI writes JSON and readable per-attempt blockers, and refreshes from new real sessions',async t=>{
  const f=fixture(t);f.add('one',1);
  const run=()=>JSON.parse(execFileSync(process.execPath,['--import','tsx',path.join(project,'tools/audit-stable-scripts.ts'),'--root',f.root],{cwd:project,encoding:'utf8'}));
  assert.equal(run().stableCount,0);
  assert.match(fs.readFileSync(path.join(f.root,'docs/已学任务稳定脚本状态.md'),'utf8'),/Observed browse/);
  f.add('two',2);assert.equal(run().stableCount,1);
  assert.equal(load(f.root,'docs/已学任务稳定脚本状态.json').candidateCount,1);
});

test('v2 snapshot scope and execution result must agree with raw evidence',async t=>{
  const f=fixture(t);const one=f.add('one',1);f.add('two',2);
  one.execution.result={...one.result,balanceAfter:999};
  f.bundle.snapshots[0].scope={...f.bundle.scope,accountId:'other'};f.flush();
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,0);
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='v2_evidence_conflict'));
  assert.ok(report.tasks[0].attempts[0].blockers.some(b=>b.code==='scope_mismatch'));
});

test('two real independent sessions of current archived implementation establish stability without trusting validations',async t=>{
  const f=fixture(t);f.add('one',1);f.add('two',2);
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.stableCount,1);assert.equal(report.tasks[0].qualifyingSessionCount,2);
  assert.deepEqual(report.tasks[0].attempts.map(a=>a.blockers),[[],[]]);
  assert.equal(report.tasks[0].fingerprints.length,1);
  assert.match(report.tasks[0].fingerprints[0].fingerprint,/^[a-f0-9]{64}$/);
  assert.ok(report.tasks[0].attempts[0].notes.includes('learningValidation=diagnostic_only (informational)'));
});

test('audit derives candidates by exact name and instruction; declarations cannot validate missing real evidence',async t=>{
  const f=fixture(t); f.bundle.snapshots.push({id:'s',taskId:'t'});
  const e:any={id:'old',scope:f.bundle.scope,runId:1,taskSnapshotId:'s',result:{status:'supervised_success',gainCoins:5},evidenceDir:'evidence/missing',validations:[{independent:true,status:'completed'}]};
  f.bundle.executions.push(e,{...e,id:'duplicate',runId:2}); f.flush();
  const report=await (await api()).auditStableScripts({root:f.root});
  assert.equal(report.candidateCount,1);assert.equal(report.stableCount,0);assert.equal(report.tasks[0].historicalSuccessCount,2);
  assert.ok(report.tasks[0].attempts[0].blockers.some((b:any)=>b.code==='missing_file'&&b.file.endsWith('final.json')));
  assert.equal(report.tasks[0].state,'candidate');
});
