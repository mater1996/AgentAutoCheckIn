import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {withDeviceLock} from '../device-lock.ts';
import {validateStagedConfig,loadPlanDecisions} from './config.ts';
import {runActivitySession} from './session.ts';
import {createStagedRuntime} from './runtime.ts';
import {loadStageRecipes} from './recipes.ts';
import Database from 'better-sqlite3';
import {resolveDatabasePath,isStorageMigrated} from '../storage/index.ts';
import {readStructured} from '../storage/structured.ts';
import {validateContinuation} from './continuation.ts';
import {makeSourceReviews,snapshotSources,assertSourcesUnchanged} from './source-archive.ts';

export const interactionSourceFiles=(cfg:any)=>[...(cfg.interactionRoutes?.length?['runner/staged/interaction.ts']:[]),...(cfg.interactionRoutes?.some((r:any)=>r.type==='home-revisit')?['runner/staged/home-revisit.ts','runner/staged/home-revisit-route.ts','runner/staged/raw-capture.ts']:[]),'runner/staged/reward-attribution.ts'];
export const navigationSourceFiles=(cfg:any)=>cfg.localActivityNavigation===true&&cfg.navigationPolicy==='current-text-v1'?['runner/staged/navigation-reader.ts','runner/staged/navigation-records.ts','runner/staged/script-validation.ts','runner/staged/system-observation.ts']:[];
export function archivePlanInput(file:string,evidenceDir:string,bytes=fs.readFileSync(file)){
 const target=path.join(evidenceDir,'plan-input.json');fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
 return {sourcePath:path.resolve(file),path:target,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};
}
export const aiPanelSourceFiles=(cfg:any)=>cfg.aiPanelReader===true?['runner/staged/ai-panel-reader.ts',...(cfg.taskObservationPolicy==='current-components-v1'||cfg.panelReadPolicy==='focused-v1'?['runner/staged/script-validation.ts']:[])]:[];

export function createControllerCaptureDeps(raw:any,cfg:any,ctx:any,track:<T>(work:Promise<T>)=>Promise<T>=(work)=>work){
 const owner={package:cfg.package,userId:cfg.scope.userId,taskAttemptId:ctx.taskAttemptId};
 if(typeof owner.taskAttemptId!=='string'||!owner.taskAttemptId.trim())throw Error('Missing raw capture owning attempt');
 return {captureRawBurst:(request:any)=>track(raw.captureBurst(owner,{frames:request.frames,intervalMs:request.intervalMs,budgetMs:request.maxMs})),
  deriveRawFrames:(batch:any,limits:any)=>track(raw.deriveFrames(batch,{ocrBinary:cfg.rawCapture?.ocrBinary??'/Users/mater/.hermes/cache/scratch/checkin-apple-ocr'},limits))};
}
export async function runStaged(configFile:string,options:{live:boolean;startFromApp?:boolean;resumeResult?:string;round?:boolean;resumeExecution?:boolean}){
 if(options.round){if(options.resumeResult)throw Error('Round continuation uses its durable state, not --resume-result');return (await import('./round-cli.ts')).runStagedRound(configFile,{live:options.live,resumeExecution:options.resumeExecution});}
 const root=process.cwd(),read=(ref:string)=>readStructured(root,ref);
 const cfg=validateStagedConfig(read(configFile));
 if(options.startFromApp&&cfg.localLaunch!==true)throw Error('--start-from-app requires localLaunch=true; launch is owned by open_app');
 const source=read(cfg.planFile),planBytes=isStorageMigrated(root)?Buffer.from(JSON.stringify(source,null,2)+'\n'):fs.readFileSync(cfg.planFile);const plan=loadPlanDecisions(source);
 if(!options.live)return {configValid:true,stages:Object.keys(cfg.stages),planTasks:plan.length,live:false};
 const controllerFiles=cfg.controllerCandidates?.length?['runner/staged/controller-route.ts','runner/staged/controller-runtime.ts','runner/staged/panel-claim.ts','runner/staged/shop-browse.ts','runner/staged/raw-capture.ts']:[];
 const scriptFiles=[...interactionSourceFiles(cfg),...navigationSourceFiles(cfg),...aiPanelSourceFiles(cfg),...(cfg.entryRecovery===true?['runner/staged/entry-recovery.ts']:[]),...(cfg.localActivityNavigation===true?['runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts']:[]),...(cfg.balanceComponent===true?['runner/staged/balance-component.ts']:[]),...controllerFiles,'runner/staged/main.ts','runner/staged/runtime.ts','runner/staged/session.ts','runner/staged/observations.ts','runner/staged/engine.ts','runner/staged/device.ts','runner/staged/system-observation.ts','runner/staged/continuation.ts','runner/staged/contracts.ts','runner/staged/browse-revalidation.ts','runner/staged/config.ts','runner/staged/source-archive.ts','runner/staged/store.ts','runner/staged/recipes.ts','runner/staged/vision-client.ts','runner/device-lock.ts','runner/task-records-v2.ts','runner/task-records.ts',...(cfg.learnedBrowse?.enabled?['runner/staged/learned-browse.ts',...(cfg.learnedBrowse.autoContract===true?['runner/staged/continuous-contract.ts']:[])]:[]),...(cfg.returnContracts?.length?['runner/staged/flash-return.ts']:[]),...(cfg.immersiveBrowse?.enabled?['runner/staged/immersive-browse.ts','runner/staged/immersive-ocr-quality.ts',...(cfg.immersiveBrowse.rewardTransitions?.length?['runner/staged/immersive-transition.ts']:[])]:[]),...(cfg.dwellBrowse?['runner/staged/dwell-browse.ts',...(cfg.dwellBrowse.contracts.some((c:any)=>c.historical===true||c.provenance?.kind==='historical-dwell-v1')&&fs.existsSync('runner/staged/dwell-evidence.ts')?['runner/staged/dwell-evidence.ts']:[])]:[]),path.resolve(configFile)];
 const sourceSnapshot=snapshotSources([...scriptFiles,path.resolve(cfg.planFile)]);
 if(!isStorageMigrated(root)&&sourceSnapshot.find(s=>s.file===path.resolve(cfg.planFile))?.sha256!==createHash('sha256').update(planBytes).digest('hex'))throw Error('Plan changed while loading session input');
 const [{AdbOcrDevice},{VisionClient},{saveStagedResult}]=await Promise.all([import('./device.ts'),import('./vision-client.ts'),import('./store.ts')]);
 const id=randomUUID(),evidenceDir=path.resolve(cfg.evidenceRoot,'staged-'+new Date().toISOString().replace(/[:.]/g,'-'));
 fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});
 const planInput=archivePlanInput(cfg.planFile,evidenceDir,planBytes);
 fs.writeFileSync(path.join(evidenceDir,'plan-input-manifest.json'),JSON.stringify(planInput,null,2)+'\n',{mode:0o600});
 let resume:any;
 if(options.resumeResult){
  if(options.startFromApp)throw Error('Continuation cannot reset the starting page');
  const sourceFile=path.resolve(options.resumeResult),old=JSON.parse(fs.readFileSync(sourceFile,'utf8')),prior=JSON.parse(fs.readFileSync(path.join(path.dirname(sourceFile),'session.json'),'utf8'));
  const db=new Database(resolveDatabasePath(),{readonly:true});
  try{resume=validateContinuation(old,prior,cfg.scope,new Date().toISOString(),!!db.prepare('select 1 from gain_event where run_id=? limit 1').get(old.runId));const stageFile=path.join(path.dirname(sourceFile),'stages.json');resume={...resume,priorStages:JSON.parse(fs.readFileSync(stageFile,'utf8')).filter((s:any)=>['open_task','task_receipt','return_list'].includes(s.stageId)).map((s:any)=>({stageId:s.stageId,status:s.status,error:s.error,actions:s.actions}))};}finally{db.close();}
 }
 const session={id,evidenceDir,scope:cfg.scope,startedAt:new Date().toISOString(),configFile:path.resolve(configFile),...(resume?{resume}:{})};
 const save=(file:string,value:any)=>fs.writeFileSync(path.join(evidenceDir,file),JSON.stringify(value,null,2)+'\n',{mode:0o600});
 const model=new VisionClient({baseUrl:cfg.model.baseUrl,model:cfg.model.name,apiKey:process.env[cfg.model.apiKeyEnv]??process.env.MIDSCENE_MODEL_API_KEY??'',timeoutMs:cfg.model.timeoutMs});
 const device=new AdbOcrDevice({executionPolicy:cfg.executionPolicy,serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir,frameMaxAgeMs:15000,allowVisualFallback:true,balanceComponent:cfg.balanceComponent===true});
 const m=read(cfg.knowledgeIndex),k=read(m.knowledgeBundle),a=read(m.accountBundle);
 const localDay=(value:string)=>new Date(Date.parse(value)+8*3600_000).toISOString().slice(0,10);
 const today=localDay(session.startedAt);
 const ledger=new Database(resolveDatabasePath(),{readonly:true});
 const completed=a.executions.filter((e:any)=>['completed','supervised_success'].includes(e.result?.status)&&e.result?.gainCoins>0&&(ledger.prepare('select day from run where id=?').get(e.runId)as any)?.day===today).map((e:any)=>a.tasks.find((t:any)=>t.id===a.snapshots.find((s:any)=>s.id===e.taskSnapshotId)?.taskId)?.name).filter(Boolean);
 ledger.close();
 save('config.json',{...cfg,model:{baseUrl:cfg.model.baseUrl,name:cfg.model.name,timeoutMs:cfg.model.timeoutMs}});save('session.json',session);
 return withDeviceLock(async()=>{
  const pending=new Set<Promise<unknown>>();
  const track=<T>(work:Promise<T>):Promise<T>=>{pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;};
  const drain=async()=>{while(pending.size)await Promise.allSettled([...pending]);};
  let raw:any;
  if(cfg.controllerCandidates?.length||cfg.interactionRoutes?.some((r:any)=>r.type==='home-revisit')){
   const [{RawCapture},{execFile},{promisify}]=await Promise.all([import('./raw-capture.ts'),import('node:child_process'),import('node:util')]);
   const execute=promisify(execFile);
   raw=new RawCapture({executionPolicy:cfg.executionPolicy,serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir,exec:(file,args,limits)=>track(execute(file,args,{encoding:'buffer',timeout:limits!.timeoutMs,killSignal:'SIGKILL',maxBuffer:20*1024*1024}))});
  }
  try {
  const rt=createStagedRuntime(cfg,device,model,{sessionId:id,evidenceDir,plan,completed,resume,...(raw?{controllerDeps:(ctx:any)=>createControllerCaptureDeps(raw,cfg,ctx,track)}:{}),experiences:k.experienceVersions,recipes:loadStageRecipes(cfg.recipeRoot??'data/stage-records/recipes',cfg.scope)});
  const result=await runActivitySession(session,{
   prepare:async()=>{await device.prepare();},
   stage:(stageId,context)=>rt.stage(stageId,context),
   save:async(v)=>{
    save('usage.json',model.usage);
    // Refuse to label changed run-end bytes as this session's implementation.
    assertSourcesUnchanged(sourceSnapshot);
    save('source-snapshot.json',sourceSnapshot);
    return saveStagedResult({...v,reviews:[...v.reviews,...makeSourceReviews(scriptFiles,v.reviews,cfg.scope)],scriptFiles,usage:model.usage});
   },
   cleanup:async()=>{await drain();const value=await device.cleanup();save('cleanup.json',value);return value;},
   persist:v=>save('session-state.json',v),
  });
  save('final.json',result);save('usage.json',model.usage);
  console.log(JSON.stringify({evidenceDir,status:result.status,runId:result.runId,balanceBefore:result.balanceBefore,balanceAfter:result.balanceAfter,error:result.error,cleanup:result.cleanup},null,2));
  return result;
  }finally{await drain();}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const file=process.argv[2]??'config/staged/taobao.json';
 runStaged(file,{live:process.argv.includes('--live'),round:process.argv.includes('--round'),resumeExecution:process.argv.includes('--resume-execution'),startFromApp:process.argv.includes('--start-from-app'),resumeResult:process.argv.includes('--resume-result')?process.argv[process.argv.indexOf('--resume-result')+1]:undefined}).then(r=>{if(!process.argv.includes('--live'))console.log(JSON.stringify(r,null,2));if(r.status&&r.status!=='completed')process.exitCode=1;}).catch(e=>{console.error('Staged session failed:',e.message);process.exitCode=1;});
}
