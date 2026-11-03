// Offline audit only: real saved PNG copies; fake model only builds sidecars.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as observations from '../runner/staged/observations.ts';
import * as audit from '../runner/staged/script-validation.ts';
import {readAiPanel} from '../runner/staged/ai-panel-reader.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const project=path.resolve(import.meta.dirname,'..');
const owner={package:'com.taobao.taobao',userId:0};
const task={name:'审计合成任务',instruction:'浏览5秒',done:0,total:1,reward:20,rewardMin:null,rewardMax:null,rewardOffers:[],button:'去完成',bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]};
const selected=({name,instruction,done,total}:any)=>({name,instruction,done,total});
const config:any={...owner,scope:{userId:0},aiPanelReader:true,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',learnedBrowse:{enabled:true}};
const refs={browse:'continuous-supervised-2026-11-01T05-18-43-216Z/bfbc7cc8-510d-4133-82f7-1a432fa97af7',done:'continuous-supervised-2026-11-01T05-18-43-216Z/17cbd398-0659-40fc-90d7-79d3ee3c188f'};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function fixture(t:any){const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'current-audit-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let n=0;const originals=new Map<string,string>();t.after(()=>{for(const [p,h]of originals)assert.equal(sha(fs.readFileSync(p)),h);});return {root,copy(ref=refs.browse){const src=path.join(project,'evidence',ref+'.json'),base=JSON.parse(fs.readFileSync(src,'utf8'));for(const ext of ['.png','.json','.ocr.json']){const p=src.replace(/\.json$/,ext);if(fs.existsSync(p))originals.set(p,sha(fs.readFileSync(p)));}const f={...base,id:'audit-copy-'+(++n),path:path.join(root,'copy-'+n+'.png'),capturedAt:Date.now()+n};fs.copyFileSync(src.replace(/\.json$/,'.png'),f.path);const rawFile=src.replace(/\.json$/,'.ocr.json'),raw=fs.existsSync(rawFile)?JSON.parse(fs.readFileSync(rawFile,'utf8')):{pages:[{width:base.width,height:base.height,lines:base.lines}]};raw.pages[0].file=f.path;fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;},save(f:any){assert.equal(path.dirname(f.path),root);fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));}};}
async function wholeFixture(t:any,keywords=false){
 const h=fixture(t),moduleFile=path.join(h.root,'audit-fixture.ts');
 const prefix=fs.readFileSync(path.join(project,'tests/staged-script-validation.test.ts'),'utf8').split('// Immutable bytes')[0]
  .replace("import sharp from 'sharp';",'').replace("path.resolve(import.meta.dirname, '..')",JSON.stringify(project))
  .replace("import('../runner/staged/script-validation.ts')",`import(${JSON.stringify(path.join(project,'runner/staged/script-validation.ts'))})`);
 fs.writeFileSync(moduleFile,prefix+'\nexport {fixture};');
 const base=(await import(moduleFile)).fixture(t,owner.package);
 Object.assign(base.cfg,{aiPanelReader:true,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',balanceComponent:false,scriptValidationMode:false});
 if(keywords)base.cfg.taskCompletionPolicy='current-keywords-v1';
 base.cfg.learnedBrowse.autoContract=true;base.cfg.limits.agentCalls=30;base.cfg.limits.sessionMs=180000;base.cfg.limits.stageMs=90000;
 base.cfg.stages.task_receipt.continuousScroll={requiredMs:25000,maxSwipes:30,maxMs:35000};
 const a=base.add('current-real-engine',300),dir=path.join(base.root,a.dir);let page='panel',n=0;
 const actualTask={...task,name:a.result.task.name,instruction:a.result.task.instruction,total:2};
 const copy=()=>{
  const source=h.copy(keywords&&page==='keyword-receipt'?'staged-2026-11-02T11-52-57-317Z/55bcb1f8-20b2-4b96-ad45-69bd3864bf07':page==='done'?refs.done:refs.browse),f={...source,id:'engine-'+(++n),path:path.join(dir,'engine-'+n+'.png'),capturedAt:Date.now()};
  fs.copyFileSync(source.path,f.path);const raw=JSON.parse(fs.readFileSync(source.path.replace(/\.png$/,'.ocr.json'),'utf8'));raw.pages[0].file=f.path;
  if(keywords&&page==='keyword-receipt'){const {splitOcrObservation}=observations;Object.assign(f,splitOcrObservation(raw.pages[0].lines,f.width,f.height));delete f.observationError;}
  fs.writeFileSync(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;
 };
 const rt=createStagedRuntime(base.cfg,{capture:async()=>copy(),act:async(action:any)=>{if(action.type==='tap')page='browse';if(action.type==='back')page='returned';},scrollContinuously:async()=>{page='done';}},
 {usage:[],query:async(r:any)=>r.panelReadMode?{isPanel:true,balance:105,blocked:false,taskStatus:'visible',task:{...actualTask,done:1}}:{isPanel:true,balance:100,blocked:false,top:true,bottom:true,tasks:[actualTask],clippedRows:[]}},
 {sessionId:'current-real-engine',evidenceDir:dir,plan:[{name:actualTask.name,instruction:actualTask.instruction,decision:'do',times:1}]});
 fs.writeFileSync(path.join(dir,'runtime.jsonl'),'');
 const chosen=await rt.stage('select_task',{});assert.equal(chosen.status,'completed',chosen.error);
 const ctx={task:chosen.task,taskAttemptId:a.result.taskAttemptId};a.stages[4]={stageId:'select_task',...chosen};
 for(const [i,id]of [[5,'open_task'],[6,'task_receipt'],[7,'return_list'],[8,'settle']] as const){if(keywords&&id==='task_receipt')page='keyword-receipt';const r=await rt.stage(id,ctx);assert.equal(r.status,'completed',r.error);a.stages[i]={stageId:id,...r};}
 Object.assign(a.result,{task:chosen.task,receipt:a.stages[6].receipt,balanceAfter:a.stages[8].balanceAfter});
 for(const name of ['ai-panel-reader.ts','script-validation.ts','continuous-contract.ts','learned-browse.ts']){
  const p='runner/staged/'+name,bytes=fs.readFileSync(path.join(project,p)),hash=sha(bytes),archive='data/stage-records/script-sources/'+hash+'.ts';
  fs.writeFileSync(path.join(base.root,p),bytes);fs.writeFileSync(path.join(base.root,archive),bytes);
  const reviewFile=path.join(dir,'reviews.json'),reviews=JSON.parse(fs.readFileSync(reviewFile,'utf8')),reviewIndex=reviews.length;
  reviews.push({stageId:'task_receipt',review:{candidateScript:{path:p}}});fs.writeFileSync(reviewFile,JSON.stringify(reviews));
  const candidateFile='data/stage-records/candidates/current-extra-'+name+'.json';
  fs.writeFileSync(path.join(base.root,candidateFile),JSON.stringify({scope:{appId:base.cfg.scope.appId,activityId:base.cfg.scope.activityId},candidateScript:{path:archive,originalPath:p,fileSha256:hash},sources:[{sessionId:'current-real-engine',runId:300,evidenceDir:a.dir,reviewFile:a.dir+'/reviews.json',reviewIndex}]}));
  base.index.candidates=base.index.candidates.filter((c:any)=>JSON.parse(fs.readFileSync(path.join(base.root,c.path),'utf8')).candidateScript.originalPath!==p);
  base.index.candidates.push({path:candidateFile,sessionId:'current-real-engine',runId:300});
 }
 const sync=()=>{
  for(const p of [a.configFile,a.dir+'/config.json'])fs.writeFileSync(path.join(base.root,p),JSON.stringify(base.cfg));
  for(const c of base.index.candidates){const v=JSON.parse(fs.readFileSync(path.join(base.root,c.path),'utf8'));if(v.candidateScript.originalPath===a.configFile){const bytes=fs.readFileSync(path.join(base.root,a.configFile)),hash=sha(bytes);v.candidateScript.path='data/stage-records/script-sources/'+hash+'.json';v.candidateScript.fileSha256=hash;fs.writeFileSync(path.join(base.root,v.candidateScript.path),bytes);fs.writeFileSync(path.join(base.root,c.path),JSON.stringify(v));}}
  fs.writeFileSync(path.join(dir,'stages.json'),JSON.stringify(a.stages));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(a.result));
  const final=JSON.parse(fs.readFileSync(path.join(dir,'final.json'),'utf8'));Object.assign(final,a.result,{stages:a.stages});fs.writeFileSync(path.join(dir,'final.json'),JSON.stringify(final));base.flush();
 };
 sync();return {...base,...a,rt,dir,sync};
}

for(const kind of ['ai_task_destination_confirmed','ai_task_receipt'])test('whole zero-model audit rejects '+kind+' provenance even if usage and agent_result are omitted',async t=>{
 const f=await wholeFixture(t,true),file=path.join(f.dir,'runtime.jsonl');
 fs.appendFileSync(file,JSON.stringify({kind,version:'ai-task-recovery-v1',taskAttemptId:f.result.taskAttemptId,requirements:'浏览5秒'})+'\n');
 const report=await audit.auditStableScripts({root:f.root}),attempt=report.tasks[0].attempts[0];
 assert.equal(attempt.qualified,false);assert.ok(attempt.blockers.some(b=>b.code==='non_script_runtime'));
});

test('whole keyword audit accepts run225 receipt without requiring a redundant scroll or historical reward',async t=>{
 const f=await wholeFixture(t,true);assert.equal(f.result.receipt.version,'current-keywords-v1');assert.equal(f.stages[6].actions.length,0);
 const report=await audit.auditStableScripts({root:f.root});assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);
});

for(const kind of ['raw-text','observation-text','wrong-attempt','duplicate-event','stale-settlement'])test('whole keyword audit rejects '+kind,async t=>{
 const f=await wholeFixture(t,true),rf=f.stages[6].events.find((e:any)=>e.type==='observed'&&e.frame.id===f.result.receipt.frameId).frame;
 if(kind==='raw-text'){const p=rf.path.replace(/\.png$/,'.ocr.json'),raw=JSON.parse(fs.readFileSync(p,'utf8'));raw.pages[0].lines=raw.pages[0].lines.filter((l:any)=>l.text!=='任务已完成');fs.writeFileSync(p,JSON.stringify(raw));}
 if(kind==='observation-text'){rf.ocrObservation.texts=['任务已完成','forged'];fs.writeFileSync(rf.path.replace(/\.png$/,'.json'),JSON.stringify(rf));}
 if(kind==='wrong-attempt'){f.result.receipt.taskAttemptId='old';f.stages[6].receipt=f.result.receipt;}
 if(kind==='duplicate-event'){const p=path.join(f.dir,'runtime.jsonl'),rows=fs.readFileSync(p,'utf8').trim().split('\n').map(s=>JSON.parse(s));rows.push(rows.find((e:any)=>e.kind==='learned_receipt'));fs.writeFileSync(p,rows.map((e:any)=>JSON.stringify(e)).join('\n'));}
 if(kind==='stale-settlement')f.stages[8].review.samples[1]=f.stages[8].review.samples[0];
 f.sync();assert.equal((await audit.auditStableScripts({root:f.root})).tasks[0].attempts[0].qualified,false);
});

test('whole audit consumes real current runtime engine trace while retaining whole-session zero-model standard',async t=>{const f=await wholeFixture(t),report=await audit.auditStableScripts({root:f.root});assert.deepEqual(report.tasks[0].attempts[0].blockers,[]);assert.equal(report.tasks[0].attempts[0].qualified,true);});

for(const kind of ['settlement-purpose','receipt-version','destination-version','fresh-coordinates','duplicate-settlement','nonzero-model'])test('whole current audit rejects '+kind,async t=>{
 const f=await wholeFixture(t);
 if(kind==='settlement-purpose'){
  const samples=f.stages[8].review.samples;
  const target=path.join(f.dir,samples[0].frameId+'.json'),frame=JSON.parse(fs.readFileSync(target,'utf8'));
  // Valid read of the same identity, but wrong observation purpose.
  frame.aiPanelEvidence=await readAiPanel({frame,owner,evidenceDir:f.dir,maxMs:1000,readMode:{purpose:'return-status',task:selected(f.result.task)},model:{query:async()=>({isPanel:true,balance:105,blocked:false,taskStatus:'visible',task:{...task,name:f.result.task.name,instruction:f.result.task.instruction,total:2,done:1}})}});
  fs.writeFileSync(target,JSON.stringify(frame));
 }
 if(kind==='receipt-version'){f.result.receipt.version='continuous-browse-candidate-v1';f.stages[6].receipt=f.result.receipt;}
 if(kind==='destination-version'){const p=path.join(f.dir,'runtime.jsonl'),rows=fs.readFileSync(p,'utf8').trim().split('\n').map(s=>JSON.parse(s));for(const r of rows)if(r.kind==='learned_destination_confirmed')r.version='legacy';fs.writeFileSync(p,rows.map(r=>JSON.stringify(r)).join('\n'));}
 if(kind==='fresh-coordinates'){const e=f.stages[6].events.find((e:any)=>e.type==='before_dispatch_revalidated');e.proposal.action.toY+=20;}
 if(kind==='duplicate-settlement')f.stages[8].review.samples[1]=f.stages[8].review.samples[0];
 if(kind==='nonzero-model')fs.writeFileSync(path.join(f.dir,'usage.json'),JSON.stringify([{calls:1,tokens:100}]));
 f.sync();const report=await audit.auditStableScripts({root:f.root});assert.equal(report.tasks[0].attempts[0].qualified,false,kind);assert.ok(report.tasks[0].attempts[0].blockers.length);
});

for(const field of ['taskCompletionPolicy','taskObservationPolicy','panelReadPolicy','aiTaskRecovery','aiPanelReader'])test('implementation fingerprint includes '+field,async t=>{const f=await wholeFixture(t),p=path.join(f.root,f.configFile),cfg=JSON.parse(fs.readFileSync(p,'utf8'));if(field==='aiTaskRecovery')cfg[field]=true;else if(field==='taskCompletionPolicy')cfg[field]='current-keywords-v1';else delete cfg[field];fs.writeFileSync(p,JSON.stringify(cfg));const r=await audit.auditStableScripts({root:f.root});assert.ok(r.tasks[0].attempts[0].blockers.some(b=>b.code==='script_source_invalid'),field);});
for(const name of ['ai-panel-reader.ts','script-validation.ts'])test('current policy requires source archive '+name,async t=>{const f=await wholeFixture(t);f.index.candidates=f.index.candidates.filter((c:any)=>JSON.parse(fs.readFileSync(path.join(f.root,c.path),'utf8')).candidateScript.originalPath!=='runner/staged/'+name);f.flush();const r=await audit.auditStableScripts({root:f.root});assert.ok(r.tasks[0].attempts[0].blockers.some(b=>b.code==='script_archive_missing'&&b.detail.includes(name)));});

test('current dwell audit replays original contracts and preserves incomplete receipt unknown',async t=>{
 const contracts=JSON.parse(fs.readFileSync(path.join(project,'data/evidence/plans/stable-scripts-20261101/dwell-contracts-full.json'),'utf8')).dwellBrowse.contracts;
 const {readDwellReference}=await import('../runner/staged/dwell-evidence.ts');const h=fixture(t);
 for(const run of [160,131,165]){const c=contracts.find((c:any)=>c.sourceRunIds[0]===run),source=await readDwellReference(c.receipt.reference),frame=source.id&&Array.isArray(JSON.parse(fs.readFileSync(source.path.replace(/\.png$/,'.json'),'utf8')).lines)?h.copy(path.relative(path.join(project,'evidence'),source.path).replace(/\.png$/,'')):{...source,id:'dwell-'+run,path:path.join(h.root,'dwell-'+run+'.png')},cfg={...config,dwellBrowse:{contracts:[c]}};
  if(frame.id==='dwell-'+run){fs.copyFileSync(source.path,frame.path);fs.writeFileSync(frame.path.replace(/\.png$/,'.json'),JSON.stringify(frame));fs.writeFileSync(frame.path.replace(/\.png$/,'.ocr.json'),JSON.stringify({pages:[{file:frame.path,width:frame.width,height:frame.height,lines:frame.lines}]}));}
  const proof=await audit.verifyAuditTaskComponent({root:h.root,frame,config:cfg,stageId:'task_receipt',task:c.task});assert.equal(proof?.inspection.state,run===160?'completed':undefined,String(run));
 }
});
test('current immersive audit keeps new inspection version and explicitly rejects unmigrated quality and transition combinations',async t=>{
 const h=fixture(t),f=h.copy('staged-2026-11-01T04-08-28-272Z/bac64856-dcf1-4bf4-9db9-fe960e2af71d'),immersiveBrowse={enabled:true,task:selected(task),version:'immersive-browse-candidate-v2',allowedRewardCoins:[20]},cfg={...config,immersiveBrowse};
 assert.equal((await audit.verifyAuditTaskComponent({root:h.root,frame:f,config:cfg,stageId:'task_receipt',task}))?.inspection.version,'immersive-browse-current-components-v1');
 for(const extra of [{ocrQuality:true},{rewardTransitions:[{version:'legacy'}]}])assert.equal(await audit.verifyAuditTaskComponent({root:h.root,frame:f,config:{...cfg,immersiveBrowse:{...immersiveBrowse,...extra}},stageId:'task_receipt',task}),null);
});

for(const kind of ['wrong-owner','wrong-task','wrong-attempt','return-purpose','stale-settlement'])test('whole current audit rejects '+kind,async t=>{
 const f=await wholeFixture(t);
 if(kind==='wrong-owner'){const e=f.stages[6].events.find((e:any)=>e.type==='observed');e.frame.userId=999;fs.writeFileSync(e.frame.path.replace(/\.png$/,'.json'),JSON.stringify(e.frame));}
 if(kind==='wrong-task'){f.result.task.name='other';}
 if(kind==='wrong-attempt'){f.result.receipt.taskAttemptId='other';f.stages[6].receipt=f.result.receipt;}
 if(kind==='return-purpose'){for(const e of f.stages[7].events.filter((e:any)=>e.type==='observed'&&e.frame.aiPanelEvidence?.readMode)){const frame=e.frame;frame.aiPanelEvidence=await readAiPanel({frame,owner,evidenceDir:f.dir,maxMs:1000,readMode:{purpose:'settlement',task:selected(f.result.task)},model:{query:async()=>({isPanel:true,balance:105,blocked:false,taskStatus:'visible',task:{...task,name:f.result.task.name,instruction:f.result.task.instruction,total:2,done:1}})}});fs.writeFileSync(frame.path.replace(/\.png$/,'.json'),JSON.stringify(frame));}}
 if(kind==='stale-settlement'){const p=path.join(f.dir,f.stages[8].review.samples[0].frameId+'.json'),frame=JSON.parse(fs.readFileSync(p,'utf8'));frame.capturedAt=f.result.task.beforeFrame.capturedAt??1;fs.writeFileSync(p,JSON.stringify(frame));}
 f.sync();assert.equal((await audit.auditStableScripts({root:f.root})).tasks[0].attempts[0].qualified,false,kind);
});

test('focused settlement rejects coherent sidecars captured before receipt even with distinct frame IDs',async t=>{
 const f=await wholeFixture(t),receiptFrame=f.stages[6].events.find((e:any)=>e.type==='observed'&&e.frame.id===f.result.receipt.frameId).frame;
 for(const sample of f.stages[8].review.samples){const p=path.join(f.dir,sample.frameId+'.json'),frame=JSON.parse(fs.readFileSync(p,'utf8'));frame.capturedAt=receiptFrame.capturedAt-1000;frame.aiPanelEvidence=await readAiPanel({frame,owner,evidenceDir:f.dir,maxMs:1000,readMode:{purpose:'settlement',task:selected(f.result.task)},model:{query:async()=>({isPanel:true,balance:105,blocked:false,taskStatus:'visible',task:{...task,name:f.result.task.name,instruction:f.result.task.instruction,total:2,done:1}})}});fs.writeFileSync(p,JSON.stringify(frame));}
 f.sync();assert.equal((await audit.auditStableScripts({root:f.root})).tasks[0].attempts[0].qualified,false);
});

test('whole focused audit refuses a partial read placed in selection observations',async t=>{const f=await wholeFixture(t),p=path.join(f.dir,f.stages[8].review.samples[0].frameId+'.json'),frame=JSON.parse(fs.readFileSync(p,'utf8'));f.stages[4].events=[{type:'observed',frame}];f.sync();assert.equal((await audit.auditStableScripts({root:f.root})).tasks[0].attempts[0].qualified,false);});
test('whole audit labels current immersive quality combination unsupported rather than silently migrating it',async t=>{const f=await wholeFixture(t);f.cfg.immersiveBrowse={enabled:true,version:'immersive-browse-candidate-v2',sourceRunId:145,task:selected(f.result.task),allowedRewardCoins:[20],observationBudgetMs:10000,ocrQuality:true};f.sync();const r=await audit.auditStableScripts({root:f.root});assert.ok(r.tasks[0].attempts[0].blockers.some(b=>b.code==='current_policy_unsupported'));});

for(const kind of ['wrong-receipt-event','duplicate-receipt-event'])test('whole current audit rejects '+kind,async t=>{const f=await wholeFixture(t),p=path.join(f.dir,'runtime.jsonl'),rows=fs.readFileSync(p,'utf8').trim().split('\n').map(s=>JSON.parse(s)),event=rows.find(r=>r.kind==='learned_receipt');if(kind==='wrong-receipt-event')event.version='legacy';else rows.push(structuredClone(event));fs.writeFileSync(p,rows.map(r=>JSON.stringify(r)).join('\n'));f.sync();assert.equal((await audit.auditStableScripts({root:f.root})).tasks[0].attempts[0].qualified,false);});

test('focused audit does not grant inventory authority to partial status',async t=>{const h=await panel(t);for(const stageId of ['collect_list','select_task','open_list'])assert.equal(audit.verifyAuditFocusedPanel({root:h.root,frame:h.frame,config,stageId,task}),null);});

async function panel(t:any,purpose='settlement',status='absent'){const h=fixture(t),frame=h.copy(),mode={purpose,task:selected(task)};frame.aiPanelEvidence=await readAiPanel({frame,owner,evidenceDir:h.root,maxMs:1000,readMode:mode as any,model:{query:async()=>({isPanel:true,balance:120,blocked:false,taskStatus:status,task:status==='visible'?task:null})}});h.save(frame);return {...h,frame};}

test('current task audit selects once and keeps current policy and version through completion',async t=>{const h=fixture(t),f=h.copy(),done=h.copy(refs.done),cfg={...config,learnedBrowse:{enabled:true,autoContract:true}};assert.equal(typeof (audit as any).verifyAuditTaskComponent,'function','export component audit');const proof=await (audit as any).verifyAuditTaskComponent({root:h.root,frame:f,config:cfg,stageId:'open_task',task});assert.equal(proof?.inspection.state,'browsing');assert.equal(proof.inspection.version,'learned-browse-current-components-v1');assert.ok(proof.selectedContract);const result=await (audit as any).verifyAuditTaskComponent({root:h.root,frame:done,config:cfg,stageId:'task_receipt',task,selectedContract:proof.selectedContract});assert.equal(result?.inspection.state,'completed');assert.equal(await (audit as any).verifyAuditTaskComponent({root:h.root,frame:done,config:cfg,stageId:'task_receipt',task}),null,'receipt cannot reselect');assert.equal(await (audit as any).verifyAuditTaskComponent({root:h.root,frame:f,config:cfg,stageId:'settle',task}),null);});

test('focused audit binds settlement purpose and selected quota without inventing a complete inventory',async t=>{const h=await panel(t);assert.equal(typeof (audit as any).verifyAuditFocusedPanel,'function','export focused audit');const p=await (audit as any).verifyAuditFocusedPanel({root:h.root,frame:h.frame,config,stageId:'settle',task});assert.ok(p);assert.deepEqual(p.tasks,[]);assert.equal(p.inventoryComplete,false);for(const [key,value]of [['stageId','open_task'],['task',{...task,total:2}],['task',{...task,name:'other'}]] as [string,any][])assert.equal(await (audit as any).verifyAuditFocusedPanel({root:h.root,frame:h.frame,config,stageId:'settle',task,[key]:value}),null);});
