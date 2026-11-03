import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {saveStagedResult} from '../runner/staged/store.ts';

const project=path.resolve(import.meta.dirname,'..');
const scope={appId:'mock-app',accountId:'mock-account',activityId:'mock-activity',userId:10};
const load=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function fixture(t:any){
 const scratch=path.join(os.homedir(),'.hermes/cache/scratch');fs.mkdirSync(scratch,{recursive:true});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(scratch,'staged-source-archive-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const write=(file:string,value:string)=>{const f=path.join(root,file);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);};
 write('data/checkin.db','');const db=new Database(path.join(root,'data/checkin.db'));
 db.exec(fs.readFileSync(path.join(project,'runner/storage/client.ts'),'utf8').split('const DDL = `')[1].split('`;')[0]);
 db.prepare('INSERT INTO account(id,app,package,user_id,cache_id) VALUES(?,?,?,?,?)').run(scope.accountId,scope.appId,'test.mock',10,'mock');
 db.prepare('INSERT INTO activity(id,account_id,name,steps_json,verify_any,asset_id) VALUES(?,?,?,?,?,?)').run(scope.activityId,scope.accountId,'Mock','[]','[]','mock-coins');db.close();
 const evidenceDir=path.join(root,'evidence/source-session');fs.mkdirSync(evidenceDir,{recursive:true});
 const input={root,session:{id:'source-session',evidenceDir,scope,startedAt:'2026-11-01T18:00:00.000Z',configFile:path.join(root,'config/staged/mock.json')},result:{status:'stopped' as const,balanceBefore:null,balanceAfter:null},stages:[],reviews:[] as any[]};
 return {root,write,input};
}

test('source reviews bind every supplied source and absolute config to real immutable store archives',async t=>{
 const f=fixture(t);
 const files=['runner/staged/main.ts','runner/staged/source-archive.ts','config/staged/mock.json'];
 const bytes=new Map(files.map((file,i)=>{const value=i===2?JSON.stringify({scope,package:'test.mock'}):'export const source = '+i+';\n';f.write(file,value);return [file,Buffer.from(value)] as const;}));
 const existing=[{stageId:'review_task',review:{summary:'Recorded local review',candidateConfig:{state:'candidate'}}}];
 const before=structuredClone(existing);
 const api=await import('../runner/staged/source-archive.ts');
 assert.equal(typeof api.makeSourceReviews,'function');
 const supplied=[files[0],files[1],f.input.session.configFile,{path:files[0]}];
 const sources=api.makeSourceReviews(supplied,existing,scope,f.root);
 assert.deepEqual(existing,before);assert.equal(sources.length,3);
 for(const review of sources){
  assert.equal(review.stageId,'script_sources');
  assert.deepEqual(review.scope,{appId:scope.appId,activityId:scope.activityId,stage:'script_sources'});
  assert.match(review.summary,/source/i);assert.equal(review.validation,undefined);
 }
 const reviews=[...existing,...sources];
 const saved=await saveStagedResult({...f.input,reviews,scriptFiles:supplied});
 assert.equal(saved.partial,false);assert.equal(saved.runId,null);
 const index=load(path.join(f.root,saved.stageIndexFile));
 const candidates=index.candidates.map((c:any)=>load(path.join(f.root,c.path))).filter((c:any)=>c.candidateScript);
 assert.equal(candidates.length,files.length);
 assert.deepEqual(candidates.map((c:any)=>c.candidateScript.originalPath).sort(),files.toSorted());
 for(const candidate of candidates){
  const script=candidate.candidateScript,source=candidate.sources[0];
  assert.equal(candidate.validation,'candidate');assert.equal(candidate.crossAccountValidated,false);
  assert.equal(candidate.scope.accountId,undefined);assert.equal(candidate.scope.userId,undefined);
  assert.equal(source.sessionId,f.input.session.id);assert.equal(source.runId,null);
  const review=load(path.join(f.root,source.reviewFile))[source.reviewIndex];
  assert.equal(review.candidateScript,script.originalPath);
  assert.equal(script.fileSha256,sha(bytes.get(script.originalPath)!));
  assert.deepEqual(fs.readFileSync(path.join(f.root,script.path)),bytes.get(script.originalPath));
  f.write(script.originalPath,'changed after archive');
  assert.deepEqual(fs.readFileSync(path.join(f.root,script.path)),bytes.get(script.originalPath));
 }
 const db=new Database(path.join(f.root,'data/checkin.db'),{readonly:true});
 try{assert.equal((db.prepare('select count(*) n from gain_event').get() as any).n,0);}finally{db.close();}
});

test('source snapshot rejects changed or missing runtime bytes before archival',async t=>{
 const f=fixture(t);f.write('runner/staged/runtime.ts','original runtime');f.write('config/staged/mock.json','{}');
 const api=await import('../runner/staged/source-archive.ts');
 assert.equal(typeof api.snapshotSources,'function');assert.equal(typeof api.assertSourcesUnchanged,'function');
 const snapshot=api.snapshotSources(['runner/staged/runtime.ts',f.input.session.configFile],f.root);
 assert.doesNotThrow(()=>api.assertSourcesUnchanged(snapshot));
 f.write('runner/staged/runtime.ts','changed runtime');
 assert.throws(()=>api.assertSourcesUnchanged(snapshot),/Source changed during session/);
 f.write('runner/staged/runtime.ts','original runtime');fs.unlinkSync(f.input.session.configFile);
 assert.throws(()=>api.assertSourcesUnchanged(snapshot),/Source changed during session/);
});

test('existing normalized source references are retained without mutating runtime reviews',async()=>{
 const {makeSourceReviews}=await import('../runner/staged/source-archive.ts');
 const reviews=[{stageId:'task_receipt',review:{candidateScript:{path:'runner/staged/main.ts'}}}];
 const original=structuredClone(reviews);
 assert.deepEqual(makeSourceReviews(['runner/staged/main.ts'],reviews,scope,project),[]);
 assert.deepEqual(reviews,original);
 assert.equal(makeSourceReviews([path.join(project,'runner/staged/main.ts')],[{stageId:'review_task',candidateScript:path.join(project,'runner/staged/main.ts')}],scope,project).length,1);
});

for(const mode of ['disabled','learned','continuous-auto','balance-component','local-launch-start','activity-navigation','entry-recovery','historical-dwell','immersive','immersive-transition','immersive-quality','flash-return','controller-panel','controller-shop','flow-optimization','mutated'] as const)test('normal main save callback archives actual implementation and config: '+mode,async t=>{
 const f=fixture(t);
 const cfg={scope,package:'test.mock',assetId:'mock-coins',panelMarker:'mock',model:{baseUrl:'http://unused.invalid',name:'unused'},limits:{maxTasks:1,sessionMs:100000,stageMs:10000,agentCalls:2,stageActions:5,inventoryPages:3,maxReturns:2},constraints:['browse only'],planFile:'plan.json',knowledgeIndex:'knowledge-index.json',evidenceRoot:'evidence',stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id+'_ok'}])),...(mode!=='disabled'?{learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153}}:{}),...(mode==='flash-return'?{returnContracts:[{task:{name:'Mock flash',instruction:'Browse'},version:'flash-return-candidate-v1',sourceRunId:131}]}:{}),...(mode==='historical-dwell'?{dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[{task:{name:'Mock',instruction:'Browse'},dwellMs:5000,provenance:{kind:'historical-dwell-v1'}}]}}:{})};
 if(mode==='flow-optimization')Object.assign(cfg,{aiPanelReader:true,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',aiTaskRecovery:true,scriptValidationMode:false,balanceComponent:false});
 if(mode==='activity-navigation')Object.assign(cfg,{localActivityNavigation:true});
 if(mode==='entry-recovery')Object.assign(cfg,{localActivityNavigation:true,entryRecovery:true});
 if(mode==='local-launch-start')Object.assign(cfg,{localLaunch:true});
 if(mode==='balance-component')Object.assign(cfg,{balanceComponent:true});
 if(mode==='continuous-auto')Object.assign(cfg,{learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153,autoContract:true},stages:{...cfg.stages,task_receipt:{...cfg.stages.task_receipt,continuousScroll:{maxSwipes:30,maxMs:35000,requiredMs:25000}}}});
 if(mode==='controller-panel'||mode==='controller-shop'){const contract=mode==='controller-panel'?await (await import('../runner/staged/panel-claim.ts')).buildPanelClaimContract(project):await (await import('../runner/staged/shop-browse.ts')).buildShopBrowseContract(project);Object.assign(cfg,{controllerCandidates:[{family:contract.family,task:mode==='controller-panel'?{name:'任务到访得金币',instruction:'每日来任务面板'}:{name:'逛好店赚一大波金币',instruction:'浏览15秒'},contract,...(mode==='controller-shop'?{learningBudget:{status:'candidate',maxGestures:1,gestureMs:900,observationBudgetMs:10000}}:{})}]});}
 if(mode==='immersive-quality')Object.assign(cfg,{immersiveBrowse:{enabled:true,ocrQuality:true,version:'immersive-browse-candidate-v2',sourceRunId:145,task:{name:'Mock immersive',instruction:'Browse'},observationBudgetMs:10000,allowedRewardCoins:[20,50]}});
 if(mode==='immersive-transition')Object.assign(cfg,{immersiveBrowse:{enabled:true,version:'immersive-browse-candidate-v2',sourceRunId:145,task:{name:'Mock immersive',instruction:'Browse'},observationBudgetMs:10000,allowedRewardCoins:[20,50],rewardTransitions:[await(await import('../runner/staged/immersive-transition.ts')).buildImmersiveTransition(project)]}});
 f.write('config/staged/mock.json',JSON.stringify({...cfg,...(mode==='immersive'?{immersiveBrowse:{enabled:true,version:'immersive-browse-candidate-v1',sourceRunId:145,task:{name:'Mock immersive',instruction:'Browse'},observationBudgetMs:10000}}:{})}));f.write('plan.json','[]');
 f.write('knowledge-index.json',JSON.stringify({knowledgeBundle:'knowledge.json',accountBundle:'account.json'}));
 f.write('knowledge.json',JSON.stringify({experienceVersions:[]}));f.write('account.json',JSON.stringify({executions:[]}));
 const core=['runner/staged/reward-attribution.ts','runner/staged/main.ts','runner/staged/runtime.ts','runner/staged/session.ts','runner/staged/observations.ts','runner/staged/engine.ts','runner/staged/device.ts','runner/staged/system-observation.ts','runner/staged/continuation.ts','runner/staged/contracts.ts','runner/staged/browse-revalidation.ts','runner/staged/config.ts','runner/staged/source-archive.ts','runner/staged/store.ts','runner/staged/recipes.ts','runner/staged/vision-client.ts','runner/device-lock.ts','runner/task-records-v2.ts','runner/task-records.ts'];
 const controllerFiles=mode==='controller-panel'||mode==='controller-shop'?['runner/staged/controller-route.ts','runner/staged/controller-runtime.ts','runner/staged/panel-claim.ts','runner/staged/shop-browse.ts','runner/staged/raw-capture.ts']:[];
 for(const file of [...core,...controllerFiles,'runner/staged/ai-panel-reader.ts','runner/staged/script-validation.ts','runner/staged/learned-browse.ts','runner/staged/continuous-contract.ts','runner/staged/balance-component.ts','runner/staged/dwell-browse.ts']){
  const source=path.join(project,file);if(fs.existsSync(source))f.write(file,fs.readFileSync(source,'utf8'));
 }
 if(mode==='activity-navigation'){f.write('runner/staged/activity-navigation.ts','// isolated navigation source archive fixture');f.write('runner/staged/panel-claim.ts','// shared pixel comparator implementation');}
 if(mode==='entry-recovery'){f.write('runner/staged/activity-navigation.ts','// isolated navigation source archive fixture');f.write('runner/staged/panel-claim.ts','// shared pixel comparator implementation');f.write('runner/staged/entry-recovery.ts','// isolated entry recovery implementation');}
 if(mode==='flash-return')f.write('runner/staged/flash-return.ts','// fixture flash return checker');
 if(mode==='immersive-quality')for(const file of ['immersive-browse.ts','immersive-ocr-quality.ts'])f.write('runner/staged/'+file,fs.readFileSync(path.join(project,'runner/staged',file),'utf8'));
 if(mode==='immersive-transition')for(const file of ['immersive-browse.ts','immersive-transition.ts','immersive-ocr-quality.ts'])f.write('runner/staged/'+file,fs.readFileSync(path.join(project,'runner/staged',file),'utf8'));
 if(mode==='immersive'){f.write('runner/staged/immersive-browse.ts','// fixture immersive checker implementation\n');f.write('runner/staged/immersive-ocr-quality.ts','// fixture implicit checker dependency\n');}
 if(mode==='historical-dwell')f.write('runner/staged/dwell-evidence.ts','// fixture historical contract adapter implementation\n');
 const probe=`import childProcess from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
 if(${JSON.stringify(mode==='local-launch-start')}){childProcess.execFileSync=()=>{throw Error('Prepare must not execute external HOME/launch');};syncBuiltinESMExports();}
 import {registerHooks} from 'node:module';
 const staged=${JSON.stringify(pathToFileURL(path.join(project,'runner/staged/')).href)};
 registerHooks({load(url,context,next){
  let source;
  if(url===staged+'device.ts')source='export class AdbOcrDevice {constructor(options){if('+${JSON.stringify(mode==='balance-component')}+' && options.balanceComponent!==true)throw Error("Balance component config did not reach device");}async prepare(){}async act(){throw Error("Prepare must not launch outside open_app");}async cleanup(){return {errors:[]}}}';
  if(url===staged+'vision-client.ts')source='export class VisionClient {usage=[]}';
  if(url===staged+'session.ts')source='import fs from "node:fs";export async function runActivitySession(session,deps){if('+${JSON.stringify(mode==='local-launch-start')}+')await deps.prepare();if('+${JSON.stringify(mode==='mutated')}+')fs.appendFileSync("runner/staged/runtime.ts","/* mutation during run */");try{const archived=await deps.save({session,result:{status:"stopped",balanceBefore:null,balanceAfter:null},stages:[],reviews:[{stageId:"review_task",review:{summary:"local callback fixture"}}]});return {status:"stopped",...archived}}catch(e){if('+${JSON.stringify(mode==='mutated')}+')return {status:"unknown",error:e.message};throw e;}}';
  return source===undefined?next(url,context):{format:'module',source,shortCircuit:true};
 }});
 const {runStaged}=await import(${JSON.stringify(pathToFileURL(path.join(project,'runner/staged/main.ts')).href)});
 const mainResult=await runStaged('config/staged/mock.json',{live:true,startFromApp:${JSON.stringify(mode==='local-launch-start')}});
 ${mode==='mutated'?'if(mainResult.status!=="unknown"||!mainResult.error?.includes("Source changed during session"))throw Error("Changed source was archived as executing version");':''}`;
 f.write('probe.mjs',probe);
 execFileSync(process.execPath,['--import',pathToFileURL(path.join(project,'node_modules/tsx/dist/loader.mjs')).href,'probe.mjs'],{cwd:f.root,encoding:'utf8',env:{...process.env,CHECKIN_DEVICE_LOCK_DIR:path.join(f.root,'locks')}});
 if(mode==='mutated'){assert.equal(fs.existsSync(path.join(f.root,'data/stage-records/index.json')),false);return;}
 const index=load(path.join(f.root,'data/stage-records/index.json'));
 const candidates=index.candidates.map((c:any)=>load(path.join(f.root,c.path))).filter((c:any)=>c.candidateScript);
 const expected=[...core,...(mode==='flow-optimization'?['runner/staged/ai-panel-reader.ts','runner/staged/script-validation.ts']:[]),...(['activity-navigation','entry-recovery'].includes(mode)?['runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts']:[]),...(mode==='entry-recovery'?['runner/staged/entry-recovery.ts']:[]),...(mode==='balance-component'?['runner/staged/balance-component.ts']:[]),...(mode==='continuous-auto'?['runner/staged/continuous-contract.ts']:[]),...controllerFiles,'config/staged/mock.json',...(mode!=='disabled'?['runner/staged/learned-browse.ts']:[]),...(mode==='historical-dwell'?['runner/staged/dwell-browse.ts','runner/staged/dwell-evidence.ts']:[]),...(mode==='flash-return'?['runner/staged/flash-return.ts']:[]),...(mode==='immersive'?['runner/staged/immersive-browse.ts','runner/staged/immersive-ocr-quality.ts']:[]),...(mode==='immersive-quality'?['runner/staged/immersive-browse.ts','runner/staged/immersive-ocr-quality.ts']:[]),...(mode==='immersive-transition'?['runner/staged/immersive-browse.ts','runner/staged/immersive-transition.ts','runner/staged/immersive-ocr-quality.ts']:[])];
 assert.deepEqual(candidates.map((c:any)=>c.candidateScript.originalPath).sort(),expected.toSorted());
 const session=load(path.join(f.root,index.sessions[0].path));
 assert.equal(path.isAbsolute(session.configFile),true);
 for(const candidate of candidates){
  assert.equal(candidate.sources[0].sessionId,session.sessionId);
  const script=candidate.candidateScript;
  assert.deepEqual(fs.readFileSync(path.join(f.root,script.path)),fs.readFileSync(path.join(f.root,script.originalPath)));
  assert.equal(load(path.join(f.root,candidate.sources[0].reviewFile))[candidate.sources[0].reviewIndex].candidateScript,script.originalPath);
 }
});
