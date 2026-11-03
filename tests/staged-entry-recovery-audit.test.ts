import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';

const project=path.resolve(import.meta.dirname,'..');
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const api=()=>import('../runner/staged/script-validation.ts');
const owner={package:'com.taobao.taobao',userId:0};

// Real runtime + engine + AdbOcrDevice persistence, with only OS commands replaced.
// Arrival PNG/OCR comes from different historical runs: this is synthetic replay,
// never evidence of a new device run or a completed task.
async function durableDeviceRecovery(t:any,state='home') {
 const f=await recoveryFixture(t),{createStagedRuntime}=await import('../runner/staged/runtime.ts');
 const {AdbOcrDevice}=await import('../runner/staged/device.ts');
 const nav=await import('../runner/staged/activity-navigation.ts');
 const refs=[sourceFiles[1].path,({home:nav.activityNavigationSource,landing:nav.activityRenderedLandingSource,panel:nav.activityPanelSource} as any)[state].files[1].path,nav.activityPanelSource.files[1].path];
 const evidenceDir='evidence/device-session',dir=path.join(f.root,evidenceDir),sessionId='device-'+state+'-'+path.basename(f.root),taskAttemptId='offline-attempt';
 fs.mkdirSync(dir,{recursive:true});
 const config={entryRecovery:true,localActivityNavigation:true,...owner,scope:{appId:'taobao',accountId:'local',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:8000,sessionMs:20000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 save(path.join(dir,'session.json'),{id:sessionId,evidenceDir,startedAt:new Date().toISOString()});save(path.join(dir,'config.json'),config);
 let index=0;const commands:string[][]=[];
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   commands.push(args);
   if(args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{offline u0 com.taobao.taobao/.MainActivity}'};
   if(args.includes('screencap'))return {stdout:fs.readFileSync(path.join(project,refs[index].replace(/\.json$/,'.png')))};
   if(args.includes('tap')){index=Math.min(index+1,refs.length-1);return {stdout:''};}
   throw Error('Forbidden offline command '+args.join(' '));
  }
  assert.equal(args.length,2);const raw=read(path.join(project,refs[index].replace(/\.json$/,'.ocr.json')));
  raw.pages[0].file=args[1];save(args[0],raw);return {stdout:''};
 }});
 const runtime=createStagedRuntime(config,device,{query:async()=>{throw Error('model forbidden');}},{sessionId,plan:[],evidenceDir:dir});
 const stages=[await runtime.stage('enter_activity',{taskAttemptId})];
 assert.equal(stages[0].status,'completed',stages[0].error);
 // Include the unchanged navigation/list gate, including the two device taps for home.
 stages.push(await runtime.stage('open_list',{taskAttemptId}));
 assert.equal(stages[1].status,'completed',stages[1].error);
 save(path.join(dir,'stages.json'),stages);
 assert.equal(runtime.calls,0);
 const options={root:f.root,evidenceDir,config:read(path.join(dir,'config.json')),stages:read(path.join(dir,'stages.json')),
  runtime:fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)),sessionId,taskAttemptId};
 const verify=async()=>(await api()).verifyAuditEntryRecovery(options);
 return {...f,options,dir,commands,verify};
}

for(const state of ['home','landing','panel'])test('durable real engine/device replay accepts 1000ms settling after intermediate '+state,async t=>{
 const f=await durableDeviceRecovery(t,state),stage=f.options.stages[0];
 const settling=stage.events.find((e:any)=>e.type==='tap_settling');assert.equal(settling.ms,1000);
 const before=stage.events.find((e:any)=>e.type==='observed'&&e.frame.id===settling.frameId);
 assert.ok(before,'settling must bind to the actual intermediate capture');
 assert.equal((await(await import('../runner/staged/activity-navigation.ts')).inspectLearnedActivityNavigation(before.frame,owner,f.root,{exec:async()=>{throw Error('No live OCR');}}))?.state,state);
 assert.equal(f.commands.filter(args=>args.includes('tap')).length, state==='panel'?1:2);
 const proof=await f.verify();assert.ok(proof,'durable real runtime recovery must independently verify');assert.equal(proof.state,state);
 assert.equal(await(await api()).verifyAuditNavigationStages(f.options),true,'ordinary navigation gate must accept the same persisted records');
});

test('durable recovery mutations retain intermediate page, wait, timing and authority gates',async t=>{
 const f=await durableDeviceRecovery(t,'panel'),baseline=structuredClone(f.options);
 assert.ok(await f.verify());
 const stage=()=>f.options.stages[0];
 const events=()=>f.options.runtime.filter((e:any)=>e.kind?.startsWith('entry_recovery_'));
 const settling=()=>stage().events.find((e:any)=>e.type==='tap_settling');
 const intermediate=()=>stage().events.find((e:any)=>e.type==='observed'&&e.frame.id===settling().frameId).frame;
 const paths=[intermediate().path.replace('.png','.json'),intermediate().path.replace('.png','.ocr.json')];
 const originalFiles=paths.map(file=>fs.readFileSync(file));
 const changeFrame=(change:(frame:any)=>void)=>{
  const frame=intermediate();change(frame);save(frame.path.replace('.png','.json'),frame);
  const raw=read(frame.path.replace('.png','.ocr.json'));raw.pages[0].lines=frame.lines;save(frame.path.replace('.png','.ocr.json'),raw);
 };
 for(const [label,mutate] of [
  ['settling bound to another frame',()=>{settling().frameId=events()[0].sourceFrameId;}],
  ['settling before observation',()=>{settling().at=intermediate().capturedAt-1;}],
  ['settling extends beyond arrival',()=>{settling().at=events()[3].frame.capturedAt-1;}],
  ['settling greater than 1000ms',()=>{settling().ms=1001;}],
  ['combined 1000ms settling plus explicit 500ms wait',()=>{
   const frame=intermediate(),at=settling().at;
   stage().actions.push({source:'script',status:'verified',proposal:{frameId:frame.id,action:{type:'wait',ms:500}}});
   stage().events.splice(stage().events.indexOf(settling())+1,0,{type:'authority_consumed',at:at+1,frameId:frame.id,actionAttempt:2});
  }],
  ['unknown intermediate with consistent raw OCR',()=>changeFrame(frame=>{frame.lines=[];})],
  ['risky known intermediate with consistent raw OCR',()=>changeFrame(frame=>{frame.lines.push({text:'登录',bounds:[0,0,100,30]});})],
  ['future intermediate capture',()=>changeFrame(frame=>{frame.capturedAt=events()[3].frame.capturedAt+1;})],
  ['stale intermediate capture',()=>changeFrame(frame=>{frame.capturedAt=settling().at-1501;})],
  ['wrong skip action binding',()=>{stage().actions[0].proposal.frameId=intermediate().id;}],
  ['wrong engine authority index',()=>{stage().events.find((e:any)=>e.type==='authority_consumed').actionAttempt=2;}],
  ['recognition before first observation',()=>{for(const e of events())e.startedAt=stage().events[0].at-1;}],
  ['extended recovery deadline',()=>{for(const e of events())e.deadline=e.startedAt+3001;}],
  ['late confirmation',()=>{events()[3].at=new Date(events()[3].deadline).toISOString();}],
  ['expired skip dispatch',()=>{events()[2].dispatchedAt=events()[0].sourceCapturedAt+1501;events()[2].at=new Date(events()[2].dispatchedAt).toISOString();}],
  ['missing fsync',()=>{delete events()[1].fsynced;}],
  ['missing confirmation',()=>{f.options.runtime=f.options.runtime.filter((e:any)=>e.kind!=='entry_recovery_confirmed');}],
 ] as const)await t.test(label,async()=>{
  Object.assign(f.options,structuredClone(baseline));paths.forEach((file,i)=>save(file,originalFiles[i]));
  mutate();assert.equal(await f.verify(),null,label);
 });
 Object.assign(f.options,structuredClone(baseline));paths.forEach((file,i)=>save(file,originalFiles[i]));
 assert.ok(await f.verify(),'restored original persisted trace must still verify');
});

test('entry recovery audit accepts exactly 1000ms combined engine settling and explicit wait',async t=>{
 const f=await recoveryFixture(t),dispatch=f.runtime[2].dispatchedAt;
 const make=(id:string,capturedAt:number)=>{
  const frame={...structuredClone(f.frame),id,capturedAt,path:path.join(f.root,f.evidenceDir,id+'.png')};
  save(frame.path,fs.readFileSync(f.frame.path));save(frame.path.replace('.png','.json'),frame);
  const raw=read(f.frame.path.replace('.png','.ocr.json'));raw.pages[0].file=frame.path;save(frame.path.replace('.png','.ocr.json'),raw);return frame;
 };
 const before=make('before-settling',dispatch+10),waiting=make('explicit-wait',dispatch+550);
 f.arrival.capturedAt=dispatch+1300;save(f.arrival.path.replace('.png','.json'),f.arrival);
 f.stage.events.at(-1)!.at=f.arrival.capturedAt+1;f.runtime[3].at=new Date(f.arrival.capturedAt+20).toISOString();
 f.stage.events.splice(2,0,{type:'observed',at:before.capturedAt+1,frame:before},
  {type:'tap_settling',at:dispatch+20,frameId:before.id,ms:500} as any,
  {type:'observed',at:waiting.capturedAt+1,frame:waiting},
  {type:'authority_consumed',at:dispatch+600,frameId:waiting.id,actionAttempt:2} as any);
 f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:waiting.id,action:{type:'wait',ms:500}}});
 assert.ok(await f.verify());
});

test('entry recovery audit measures its three seconds from recognition after first observation',async t=>{
 const f=await recoveryFixture(t);
 for(const e of f.runtime){e.startedAt+=5;e.deadline+=5;}
 f.runtime[0].at=new Date(f.runtime[0].startedAt+10).toISOString();
 assert.ok(await f.verify());
});

test('entry recovery audit compares persisted frame objects independent of JSON key order',async t=>{
 const f=await recoveryFixture(t);
 for(const e of f.runtime)if(e.frame)e.frame=Object.fromEntries(Object.entries(e.frame).reverse());
 assert.ok(await f.verify());
});

test('entry recovery audit replays saved same-frame home refinement for intermediate and arrival',async t=>{
 const f=await recoveryFixture(t),{default:sharp}=await import('sharp');
 // Reuse the actual run199 crop OCR bytes already frozen by the navigation audit.
 const fixtureSource=fs.readFileSync(path.join(project,'tests/staged-script-validation.test.ts'),'utf8');
 const encoded=fixtureSource.match(/const navigationOCR=Buffer.from\('([^']+)','base64'\)/)?.[1];assert.ok(encoded);
 const rawBytes=Buffer.from(encoded,'base64');assert.equal(sha(rawBytes),'9e06648e435408a1daea9c0da312e6b15baba2cfff2b7c3d2629c1afb64f3161');
 const source='evidence/staged-2026-11-01T12-48-57-664Z/11e3c401-c043-4db0-a3ce-e97948a31973.json';
 const png=fs.readFileSync(path.join(project,source.replace('.json','.png')));
 const crop=await sharp(png).extract({left:40,top:2160,width:125,height:115}).resize(250,230).png().toBuffer();
 const make=(id:string,at:number)=>{
  const frame={...read(path.join(project,source)),id,path:path.join(f.root,f.evidenceDir,id+'.png'),capturedAt:at};
  save(frame.path,png);save(frame.path.replace('.png','.json'),frame);
  const original=read(path.join(project,source.replace('.json','.ocr.json')));original.pages[0].file=frame.path;save(frame.path.replace('.png','.ocr.json'),original);
  const dir=path.join(f.root,f.evidenceDir,id+'-refinement');
  const raw=JSON.parse(rawBytes.toString()),page=raw.pages[0];
  const refinement={frameId:id,sourceSha:sha(png),roi:[40,2160,165,2275],scale:2,cropSha:sha(crop),path:path.join(dir,'crop.png'),rawPath:path.join(dir,'frame.png'),ocrPath:path.join(dir,'ocr.json'),ocrInputPath:page.file,ocrSha:sha(rawBytes),bounds:page.lines[0].bounds.map((n:number,k:number)=>n/2+[40,2160][k%2]),elapsedMs:400,engine:raw.engine};
  save(refinement.path,crop);save(refinement.rawPath,png);save(refinement.ocrPath,rawBytes);
  return {frame,refinement};
 };
 const dispatch=f.runtime[2].dispatchedAt;
 const before=make('refined-intermediate',dispatch+10),after=make('refined-arrival',dispatch+1300);
 f.stage.events.splice(2,1,{type:'observed',at:before.frame.capturedAt+1,frame:before.frame},
  {type:'tap_settling',at:before.frame.capturedAt+500,frameId:before.frame.id,ms:500} as any,
  {type:'observed',at:after.frame.capturedAt+1,frame:after.frame});
 const arrivalInspection=await(await api()).verifyAuditActivityNavigation({root:f.root,frame:after.frame,owner,refinement:after.refinement});
 assert.equal(arrivalInspection?.state,'home');
 Object.assign(f.runtime[3],{arrivalFrameId:after.frame.id,frame:after.frame,arrivalProof:{...arrivalInspection,frameId:after.frame.id,chromeRefinement:after.refinement},at:new Date(after.frame.capturedAt+500).toISOString()});
 // Synthetic same-frame saved refinement witness; no navigation action authority.
 f.runtime.push({kind:'activity_navigation_attempted',frameId:before.frame.id,chromeRefinement:before.refinement});
 assert.ok(await f.verify(),'independent existing navigation/refinement checker must replay both pages');
 before.refinement.cropSha='0'.repeat(64);assert.equal(await f.verify(),null,'changed saved refinement must fail closed');
});

const sourceDir='evidence/staged-2026-11-01T17-01-55-133Z/';
const sourceFiles=[
 ['68bb8b03-bd5d-48e3-b6f8-e64af551261c.png','062f41a6171fab79c96e74bb5a52e786c94062f89ddbc4ea895efbafc3d3288a'],
 ['68bb8b03-bd5d-48e3-b6f8-e64af551261c.json','00c4c463d0917c6094076feb0025565dd8af8bed4b863af6c120bcb56c90c074'],
 ['68bb8b03-bd5d-48e3-b6f8-e64af551261c.ocr.json','5a545d51a2ae05d9b8ac1917a83f939ea3f7da7b1547aedcd252b8611f7d6491'],
 ['1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.png','1c7646e9a17c4b88d4731bea5ca4bf97d7b215d58be1034da0df80eb9ae007d1'],
 ['1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.json','5cc8a276e172217aec253b3f1cde53624eadf0965f0905481cc52ca119f48368'],
 ['1f9cd4fe-0927-4a6a-90c9-e1f49d934c2b.ocr.json','4e41b2b244cd6aa7bff63df7239b96c93d2abffbb1b6c5ece44a79dd8e28df18'],
].map(([file,sha256])=>({path:sourceDir+file,sha256}));
const save=(file:string,value:any)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
const read=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const recoveryRawSources=[
 {path:'evidence/staged-2026-11-01T12-38-29-524Z/beac16b7-c76b-412f-8197-df8defaac7b6.ocr.json',sha256:'00cd68d25423d381b749516f80b92720341b71f5cdc8b4e0079175cafe535bbc'},
 {path:'evidence/staged-2026-11-01T13-18-06-815Z/ecf85474-b64c-4ad4-ac55-b38df98ef5f4.ocr.json',sha256:'ec79039e928842dd978b096d32eaa662ae699010a218d774f925a5bcfd08b687'},
 {path:'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.ocr.json',sha256:'0e840ffd11a6d47f9d1ca2e832fd6de71af157878298fca765c1b25c76baafea'},
];

function replayFrame(root:string,evidenceDir:string,ref:string,id:string,capturedAt:number) {
 const original=read(path.join(root,ref));
 // Historical crop-operation paths are not replay operations. Retain their
 // refined lines, which panel-text-v4 independently compares to the original raw.
 const {titleRefinement:_historicalRefinement,...metadata}=original;
 const frame={...metadata,id,path:path.join(root,evidenceDir,id+'.png'),capturedAt};
 save(frame.path,fs.readFileSync(path.join(root,ref.replace(/\.json$/,'.png'))));
 save(frame.path.replace(/\.png$/,'.json'),frame);
 const raw=read(path.join(root,ref.replace(/\.json$/,'.ocr.json')));
 assert.equal(raw.pages[0].file,original.path,'raw OCR must belong to the original PNG');
 assert.equal(raw.engine,'Apple Vision VNRecognizeTextRequest');
 assert.equal(raw.pages.length,1);assert.equal(raw.pages[0].width,frame.width);assert.equal(raw.pages[0].height,frame.height);
 raw.pages[0].file=frame.path;
 save(frame.path.replace(/\.png$/,'.ocr.json'),raw);
 return frame;
}

// Cross-run PNGs and rewritten capture metadata form synthetic replay only.
// Immutable references stay byte exact; their embedded paths are never followed.
async function recoveryFixture(t:any,state='home') {
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(),'.hermes/cache/scratch/entry-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const evidenceDir='evidence/synthetic-session',sessionId='synthetic-session',taskAttemptId='synthetic-attempt';
 fs.mkdirSync(path.join(root,evidenceDir),{recursive:true});
 save(path.join(root,evidenceDir,'session.json'),{id:sessionId,evidenceDir,startedAt:new Date(1793491200000).toISOString()});
 const nav=await import('../runner/staged/activity-navigation.ts');
 const originals=new Map<string,string>();
 for(const ref of [...sourceFiles,...recoveryRawSources,...nav.activityNavigationSource.files,...nav.activityLandingSource.files,...nav.activityRenderedLandingSource.files,...nav.activityPanelSource.files]) {
  const bytes=fs.readFileSync(path.join(project,ref.path));assert.equal(sha(bytes),ref.sha256);
  save(path.join(root,ref.path),bytes);originals.set(ref.path,ref.sha256);
 }
 t.after(()=>{for(const [file,hash]of originals)assert.equal(sha(fs.readFileSync(path.join(project,file))),hash);});
 const copy=(ref:string,id:string,capturedAt:number)=>replayFrame(root,evidenceDir,ref,id,capturedAt);
 const startedAt=1793491202000,deadline=startedAt+3000;
 const frame=copy(sourceFiles[1].path,'ad-source',startedAt-100);
 const refs:any={home:nav.activityNavigationSource,landing:nav.activityLandingSource,panel:nav.activityPanelSource};
 const arrival=copy(refs[state].files[1].path,'recovery-arrival',startedAt+700);
 const action={type:'tap',x:920,y:157};
 const record:any={source:'script',status:'verified',proposal:{frameId:frame.id,action}};
 const stage={stageId:'enter_activity',status:'completed',actions:[record],events:[
  {type:'observed',at:startedAt,frame},{type:'authority_consumed',at:startedAt+100,frameId:frame.id,actionAttempt:1},
  {type:'observed',at:startedAt+800,frame:arrival}]};
 const source=(await import('../runner/staged/entry-recovery.ts')).entryRecoverySource;
 const version=source.version;
 const proof=await(await import('../runner/staged/entry-recovery.ts')).inspectEntryRecovery(frame,owner,root);
 assert.ok(proof,'real run210 bytes must independently inspect as an ad');
 const common={stageId:'enter_activity',sessionId,taskAttemptId,recoveryId:'synthetic-recovery',version,
  sourceFrameId:frame.id,sourceCapturedAt:frame.capturedAt,startedAt,deadline,sourceManifestDigest:sha(JSON.stringify(source)),action};
 const arrivalProof=await nav.inspectLearnedActivityNavigation(arrival,owner,root,{exec:async()=>{throw Error('No live OCR in recovery fixture');}});
 assert.equal(arrivalProof?.state,state);
 const runtime:any[]=[
  {kind:'entry_recovery_prepared',at:new Date(startedAt).toISOString(),...common,proof,frame},
  {kind:'entry_recovery_consumed',at:new Date(startedAt+150).toISOString(),...common,fsynced:true},
  {kind:'entry_recovery_dispatched',at:new Date(startedAt+300).toISOString(),...common,dispatchedAt:startedAt+300},
  {kind:'entry_recovery_confirmed',at:new Date(startedAt+850).toISOString(),...common,arrivalFrameId:arrival.id,state,frame:arrival,arrivalProof},
 ];
 const config={entryRecovery:true,localActivityNavigation:true,package:owner.package,scope:{userId:0},limits:{stageMs:10000,sessionMs:20000}};
 const options={root,evidenceDir,config,stages:[stage],runtime,sessionId,taskAttemptId};
 const verify=async()=> (await api()).verifyAuditEntryRecovery(options);
 return {root,evidenceDir,frame,arrival,stage,runtime,options,verify,record};
}

test('entry recovery audit independently proves one skip and home arrival without completion authority',async t=>{
 const f=await recoveryFixture(t),proof=await f.verify();
 assert.ok(proof,'complete source-bound recovery must verify');
 assert.equal(proof.state,'home');assert.equal(proof.sourceFrameId,f.frame.id);
 assert.equal(proof.arrivalFrame.id,f.arrival.id);assert.equal(proof.actionIndex,0);
 assert.equal(Object.hasOwn(proof,'completed'),false);assert.equal(Object.hasOwn(proof,'gainCoins'),false);
});

for(const state of ['landing','panel'])test('entry recovery audit proves direct '+state+' arrival',async t=>{
 const f=await recoveryFixture(t,state);assert.equal((await f.verify())?.state,state);
});

for(const [label,mutate] of [
 ['missing confirmation',(f:any)=>f.runtime.pop()],
 ['duplicate consumed',(f:any)=>f.runtime.splice(2,0,structuredClone(f.runtime[1]))],
 ['unknown',(f:any)=>f.runtime.push({...f.runtime[2],kind:'entry_recovery_unknown'})],
 ['stopped',(f:any)=>f.runtime.push({...f.runtime[2],kind:'entry_recovery_stopped'})],
 ['wrong order',(f:any)=>f.runtime.reverse()],
 ['wrong stage',(f:any)=>{f.runtime[1].stageId='open_list';}],
 ['wrong session',(f:any)=>{f.runtime[1].sessionId='other';}],
 ['wrong attempt',(f:any)=>{f.runtime[1].taskAttemptId='other';}],
 ['wrong recovery',(f:any)=>{f.runtime[1].recoveryId='other';}],
 ['wrong source',(f:any)=>{f.runtime[1].sourceFrameId='other';}],
 ['wrong version',(f:any)=>{f.runtime[1].version='other';}],
 ['wrong manifest',(f:any)=>{for(const e of f.runtime)e.sourceManifestDigest='0'.repeat(64);}],
 ['missing fsync',(f:any)=>{delete f.runtime[1].fsynced;}],
 ['unverified action',(f:any)=>{f.record.status='observed';}],
 ['duplicate skip',(f:any)=>f.stage.actions.push(structuredClone(f.record))],
 ['wrong action',(f:any)=>{f.record.proposal.action.x=500;}],
 ['forged proof',(f:any)=>{f.runtime[0].proof.pngSha256='0'.repeat(64);}],
 ['missing engine authority',(f:any)=>f.stage.events.splice(1,1)],
 ['wrong engine authority',(f:any)=>{f.stage.events[1].actionAttempt=2;}],
 ['future source',(f:any)=>{for(const e of f.runtime)e.sourceCapturedAt=e.startedAt+10;}],
 ['stale source',(f:any)=>{for(const e of f.runtime)e.at=new Date(Date.parse(e.at)+1600).toISOString();f.runtime[2].dispatchedAt+=1600;}],
 ['extended deadline',(f:any)=>{for(const e of f.runtime)e.deadline+=1;}],
 ['stage budget',(f:any)=>{f.options.config.limits.stageMs=2999;}],
 ['session budget',(f:any)=>{f.options.config.limits.sessionMs=4999;}],
 ['arrival before dispatch completed',(f:any)=>{f.arrival.capturedAt=f.runtime[2].dispatchedAt;save(f.arrival.path.replace('.png','.json'),f.arrival);}],
 ['wrong arrival state',(f:any)=>{f.runtime[3].state='panel';}],
 ['missing original observation',(f:any)=>f.stage.events.pop()],
 ['raw OCR changed',(f:any)=>{const file=f.frame.path.replace('.png','.ocr.json'),raw=read(file);raw.pages[0].lines[0].text='fake';save(file,raw);}],
 ['raw OCR outside session',(f:any)=>{const file=f.frame.path.replace('.png','.ocr.json'),raw=read(file);raw.pages[0].file=path.join(project,sourceFiles[0].path);save(file,raw);}],
 ['frame JSON changed',(f:any)=>{const file=f.frame.path.replace('.png','.json'),frame=read(file);frame.userId=9;save(file,frame);}],
 ['source PNG changed',(f:any)=>fs.appendFileSync(f.frame.path,'tampered')],
 ['reference raw changed',(f:any)=>fs.appendFileSync(path.join(f.root,sourceFiles[2].path),' ')],
 ['reference symlink escape',(f:any)=>{const dest=path.join(f.root,sourceFiles[0].path);fs.rmSync(dest);fs.symlinkSync(path.join(project,sourceFiles[0].path),dest);}],
 ['disabled flag',(f:any)=>{f.options.config.entryRecovery=false;}],
 ['truthy flag',(f:any)=>{f.options.config.entryRecovery='true';}],
 ['unsafe event',(f:any)=>f.stage.events.push({type:'dispatch_unknown'})],
 ['excessive observation',(f:any)=>{for(let i=0;i<3;i++)f.stage.events.splice(2,0,{type:'observed',at:f.arrival.capturedAt-1,frame:f.frame});}],
 ['excessive wait',(f:any)=>f.stage.events.splice(2,0,{type:'tap_settling',at:f.runtime[2].dispatchedAt,ms:1001})],
 ['other source root',(f:any)=>{f.options.sourceRoot=project;}],
] as const)test('entry recovery audit refuses '+label,async t=>{
 const f=await recoveryFixture(t);mutate(f);assert.equal(await f.verify(),null);
});

async function navigationRecoveryFixture(t:any,state='home') {
 const f=await recoveryFixture(t,state),nav=await import('../runner/staged/activity-navigation.ts');
 const make=(ref:string,id:string,capturedAt:number)=>replayFrame(f.root,f.evidenceDir,ref,id,capturedAt);
 const entered=make(nav.activityPanelSource.files[1].path,'entered-panel',f.arrival.capturedAt+1000);
 const opened=make(nav.activityPanelSource.files[1].path,'opened-panel',f.arrival.capturedAt+1500);
 const source=state==='home'?make(nav.activityNavigationSource.files[1].path,'recaptured-home',f.arrival.capturedAt+100):null;
 if(source){
  f.stage.events.push({type:'observed',at:source.capturedAt+10,frame:source});
  const known=await nav.inspectLearnedActivityNavigation(source,owner,f.root,{exec:async()=>{throw Error('No live OCR');}});assert.equal(known?.state,'home');
  f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:source.id,action:known!.action}});
  f.stage.events.push({type:'observed',at:entered.capturedAt+10,frame:entered});
  f.runtime.push({kind:'activity_navigation_attempted',stageId:'enter_activity',version:known!.version,at:new Date(source.capturedAt+500).toISOString(),frameId:source.id,action:known!.action,provenance:known!.provenance,...(known!.matchedComponents?{matchedComponents:known!.matchedComponents}:{})});
 }
 const list={stageId:'open_list',status:'completed',actions:[],events:[{type:'observed',at:opened.capturedAt+10,frame:opened}]};
 f.options.stages.push(list as any);
 return {...f,entered,opened,verifyNavigation:async()=>(await api()).verifyAuditNavigationStages(f.options)};
}

test('navigation audit separates proven skip from one original home navigation tap',async t=>{
 const f=await navigationRecoveryFixture(t);assert.equal(f.stage.actions.length,2);assert.equal(await f.verifyNavigation(),true);
});
test('navigation audit refuses home recovery confirmation as completed enter_activity',async t=>{
 const f=await navigationRecoveryFixture(t);f.stage.actions.pop();f.stage.events.pop();f.runtime.pop();assert.equal(await f.verifyNavigation(),false);
});
test('navigation audit never grants a second ordinary home tap',async t=>{
 const f=await navigationRecoveryFixture(t);f.stage.actions.push(structuredClone(f.stage.actions[1]));assert.equal(await f.verifyNavigation(),false);
});
for(const state of ['landing','panel'])test('navigation audit accepts directly recovered '+state+' under original arrival rules',async t=>{
 const f=await navigationRecoveryFixture(t,state);assert.equal(await f.verifyNavigation(),true);
});
test('navigation audit refuses two taps when the recovery proof is absent',async t=>{
 const f=await navigationRecoveryFixture(t);f.runtime.splice(0,4);assert.equal(await f.verifyNavigation(),false);
});

test('entry recovery audit uses dispatch completion epoch even when event write is later',async t=>{
 const f=await recoveryFixture(t);f.runtime[2].at=new Date(f.runtime[2].dispatchedAt+1).toISOString();assert.ok(await f.verify());
});

test('entry recovery audit rejects oversized wait action before confirmed arrival',async t=>{
 const f=await recoveryFixture(t);f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:f.frame.id+'-wait',action:{type:'wait',ms:1001}}} as any);
 assert.equal(await f.verify(),null);
});
test('entry recovery audit rejects replayed arrival home as navigation authority',async t=>{
 const f=await navigationRecoveryFixture(t);
 f.stage.events=f.stage.events.filter((e:any)=>e.frame?.id!=='recaptured-home');
 f.stage.actions[1].proposal.frameId=f.arrival.id;
 f.runtime.at(-1).frameId=f.arrival.id;
 assert.equal(await f.verifyNavigation(),false);
});

test('entry recovery audit bounds combined engine settling and explicit waits',async t=>{
 const f=await recoveryFixture(t);
 // Three 500ms waits must not become two independent 1000ms allowances.
 f.stage.events.splice(2,0,{type:'tap_settling',at:f.runtime[2].dispatchedAt,ms:500} as any);
 for(let i=0;i<2;i++){
  const frame=structuredClone(f.frame);frame.id='waiting-'+i;frame.path=path.join(f.root,f.evidenceDir,frame.id+'.png');frame.capturedAt=f.runtime[2].dispatchedAt+10+i;
  save(frame.path,fs.readFileSync(f.frame.path));save(frame.path.replace('.png','.json'),frame);
  const raw=read(f.frame.path.replace('.png','.ocr.json'));raw.pages[0].file=frame.path;save(frame.path.replace('.png','.ocr.json'),raw);
  f.stage.events.splice(f.stage.events.length-1,0,{type:'observed',at:frame.capturedAt+1,frame});
  f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:frame.id,action:{type:'wait',ms:500}}} as any);
 }
 assert.equal(await f.verify(),null);
});

test('entry recovery audit refuses an unbound explicit recovery wait',async t=>{
 const f=await recoveryFixture(t),frame=structuredClone(f.frame);
 frame.id='waiting';frame.path=path.join(f.root,f.evidenceDir,'waiting.png');frame.capturedAt=f.runtime[2].dispatchedAt+10;
 save(frame.path,fs.readFileSync(f.frame.path));save(frame.path.replace('.png','.json'),frame);
 const raw=read(f.frame.path.replace('.png','.ocr.json'));raw.pages[0].file=frame.path;save(frame.path.replace('.png','.ocr.json'),raw);
 f.stage.events.splice(2,0,{type:'observed',at:frame.capturedAt+1,frame});
 f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:frame.id,action:{type:'wait',ms:500}}} as any);
 assert.equal(await f.verify(),null);
});

test('entry recovery audit accepts one original ad observation and engine-bound 500ms wait',async t=>{
 const f=await recoveryFixture(t),frame=structuredClone(f.frame);
 frame.id='waiting';frame.path=path.join(f.root,f.evidenceDir,'waiting.png');frame.capturedAt=f.runtime[2].dispatchedAt+10;
 save(frame.path,fs.readFileSync(f.frame.path));save(frame.path.replace('.png','.json'),frame);
 const raw=read(f.frame.path.replace('.png','.ocr.json'));raw.pages[0].file=frame.path;save(frame.path.replace('.png','.ocr.json'),raw);
 f.arrival.capturedAt+=600;save(f.arrival.path.replace('.png','.json'),f.arrival);
 f.stage.events.at(-1)!.at=f.arrival.capturedAt+10;
 f.runtime[3].at=new Date(f.arrival.capturedAt+20).toISOString();
 f.stage.events.splice(2,0,{type:'observed',at:frame.capturedAt+1,frame},{type:'authority_consumed',at:frame.capturedAt+2,frameId:frame.id,actionAttempt:2} as any);
 f.stage.actions.push({source:'script',status:'verified',proposal:{frameId:frame.id,action:{type:'wait',ms:500}}} as any);
 assert.ok(await f.verify());
});

test('entry recovery audit rejects stale confirmed arrival inside the total deadline',async t=>{
 const f=await recoveryFixture(t);f.runtime[3].at=new Date(f.runtime[3].deadline-1).toISOString();assert.equal(await f.verify(),null);
});

test('entry recovery audit rejects orphan events and disabled configuration',async t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(),'.hermes/cache/scratch/entry-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const checker:any=await api();
 assert.equal(typeof checker.verifyAuditEntryRecovery,'function','independent recovery audit must exist');
 for(const config of [{entryRecovery:false},{entryRecovery:true}]){
  assert.equal(await checker.verifyAuditEntryRecovery({root,evidenceDir:'evidence/session',config,
   stages:[],runtime:[{kind:'entry_recovery_consumed',stageId:'enter_activity'}],sessionId:'session',taskAttemptId:'attempt'}),null);
 }
});
