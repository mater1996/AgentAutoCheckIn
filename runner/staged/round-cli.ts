import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {resolveDatabasePath,isStorageMigrated,getRoundState,putRoundState} from '../storage/index.ts';
import {readStructured} from '../storage/structured.ts';
import {withDeviceLock} from '../device-lock.ts';
import {validateStagedConfig} from './config.ts';
import {runActivityRound,taskIdentity} from './round.ts';
import {planRoundInventory} from './round-planner.ts';
import {writeRoundState,readRoundState} from './round-state.ts';
import {loadStageRecipes} from './recipes.ts';
import {snapshotSources,assertSourcesUnchanged,makeSourceReviews} from './source-archive.ts';
import {AdbOcrDevice} from './device.ts';
import {VisionClient} from './vision-client.ts';
import {RawCapture} from './raw-capture.ts';
import {saveStagedResult} from './store.ts';
import {createRoundAdapters} from './round-main.ts';
import {mergePriorRoundPlans,priorAttemptFromRun} from './round-adapter.ts';
import {createExecutionWorkspace,inheritRoundAttempts} from './execution-workspace.ts';
export async function runStagedRound(configFile:string,options:{live:boolean;resumeExecution?:boolean}){
 const root=process.cwd(),read=(ref:string)=>readStructured(root,ref);
 const cfg=validateStagedConfig(read(configFile)),r=cfg.round;
 if(r?.version!=='dynamic-round-v1'||typeof r.batchId!=='string'||!r.batchId.trim()||typeof r.stateFile!=='string'||!Array.isArray(r.priorPlanFiles)||cfg.localLaunch!==true||cfg.selectionAllowNew!==false||cfg.selectionPolicy!=='batch-attempts-v1')throw Error('Explicit round configuration required');
 const priorPlans=r.priorPlanFiles.map((file:string)=>({path:file,plan:read(file)}));
 if(!options.live)return {configValid:true,live:false,mode:r.loopPolicy==='next-decision-v1'?'next-decision-v1':'dynamic-round-v1',batchId:r.batchId,priorPlanFiles:priorPlans.length};
 return withDeviceLock(async()=>{
  const day=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
  const prior=mergePriorRoundPlans(priorPlans,day),db=new Database(resolveDatabasePath(root),{readonly:true});
  try{for(const row of db.prepare('SELECT id,day,evidence_dir FROM run WHERE account_id=? AND activity_id=? AND day=?').all(cfg.scope.accountId,cfg.scope.activityId,day) as any[]){
   try{const result=JSON.parse(fs.readFileSync(path.join(row.evidence_dir,'result.json'),'utf8')),stages=JSON.parse(fs.readFileSync(path.join(row.evidence_dir,'stages.json'),'utf8')),attempt=priorAttemptFromRun(row,result,stages);if(attempt&&!prior.attempts.some((a:any)=>a.attemptRunId===attempt.attemptRunId))prior.attempts.push(attempt);}catch(error:any){if(error.code!=='ENOENT')throw error;}
  }}finally{db.close();}
  const saved=isStorageMigrated(root)?getRoundState(root,r.stateFile,r.batchId,cfg.scope):readRoundState(r.stateFile,r.batchId,cfg.scope),resume=options.resumeExecution?saved:null;
  if(options.resumeExecution&&!saved)throw Error('No execution state to resume');
  const id=resume?.id??randomUUID();
  const workspace=createExecutionWorkspace({evidenceRoot:cfg.evidenceRoot,id,batchId:r.batchId,scope:cfg.scope,...(resume?{evidenceDir:resume.evidenceDir}:{})});
  const {evidenceDir}=workspace,detach=workspace.captureProcessOutput();
  try{
  const round={id,batchId:r.batchId,scope:cfg.scope,evidenceDir,startedAt:resume?.startedAt??new Date().toISOString(),configFile:path.resolve(configFile)};
  const scriptFiles=[...fs.readdirSync('runner/staged').filter(f=>f.endsWith('.ts')).map(f=>'runner/staged/'+f),'runner/device-lock.ts','runner/task-records-v2.ts','runner/task-records.ts',path.resolve(configFile)];
  const sourceSnapshot=snapshotSources(scriptFiles),save=(name:string,v:any)=>writeRoundState(path.join(evidenceDir,name),v);
  save('config.json',{...cfg,model:{baseUrl:cfg.model.baseUrl,name:cfg.model.name,timeoutMs:cfg.model.timeoutMs}});save('prior-attempts.json',prior);
  const manifest=read(cfg.knowledgeIndex),knowledge=read(manifest.knowledgeBundle);
  const model=new VisionClient({baseUrl:cfg.model.baseUrl,model:cfg.model.name,apiKey:process.env[cfg.model.apiKeyEnv]??process.env.MIDSCENE_MODEL_API_KEY??cfg.model.apiKey,timeoutMs:cfg.model.timeoutMs});
  const device=new AdbOcrDevice({executionPolicy:cfg.executionPolicy,serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir,frameMaxAgeMs:15000,allowVisualFallback:true,balanceComponent:cfg.balanceComponent===true});
  const backupDb=new Database(resolveDatabasePath(root),{readonly:true}),backupFile=path.resolve('data/backups','pre-round-live-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');fs.mkdirSync(path.dirname(backupFile),{recursive:true});
  try{await backupDb.backup(backupFile);}finally{backupDb.close();}
  const verify=new Database(backupFile,{readonly:true});let check;try{check=verify.pragma('quick_check',{simple:true});}finally{verify.close();}if(check!=='ok')throw Error('Round backup quick_check failed');save('backup.json',{path:backupFile,quickCheck:check});
  const raws=new Map<string,RawCapture>();
  if(r.loopPolicy!==undefined&&r.loopPolicy!=='next-decision-v1')throw Error('Invalid loop policy');
  const nextOptions=r.loopPolicy==='next-decision-v1'?{nextDecision:true,nextFinder:(await import('./next-decision.ts')).findNextTask,priorPlans,policy:{...r,userSkips:prior.userSkips}}:{};
  const adapters=createRoundAdapters({cfg,round,device,model,knowledge,scriptFiles,...nextOptions,event:workspace.event,registerTask:workspace.registerTask,
   taskDeviceFactory:(dir:string)=>new AdbOcrDevice({executionPolicy:cfg.executionPolicy,serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true,balanceComponent:cfg.balanceComponent===true}),
   recipes:loadStageRecipes(cfg.recipeRoot??'data/stage-records/recipes',cfg.scope),controllerDeps:(ctx:any,dir:string)=>{
   let raw=raws.get(dir);if(!raw){raw=new RawCapture({executionPolicy:cfg.executionPolicy,serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir:dir});raws.set(dir,raw);}
   const owner={package:cfg.package,userId:cfg.scope.userId,taskAttemptId:ctx.taskAttemptId};
   return {captureRawBurst:(req:any)=>raw!.captureBurst(owner,{frames:req.frames,intervalMs:req.intervalMs,budgetMs:req.maxMs}),deriveRawFrames:(batch:any,limits:any)=>raw!.deriveFrames(batch,{ocrBinary:cfg.rawCapture?.ocrBinary??'/Users/mater/.hermes/cache/scratch/checkin-apple-ocr'},limits)};
  },saveTask:async(v:any)=>{assertSourcesUnchanged(sourceSnapshot);save('source-snapshot.json',sourceSnapshot);const archived=await saveStagedResult({...v,reviews:[...v.reviews,...makeSourceReviews(scriptFiles,v.reviews,cfg.scope)]});
   if(archived.gainCoins!==null){const ledger=new Database(resolveDatabasePath(root),{readonly:true});try{const entries=ledger.prepare('SELECT units FROM gain_event WHERE run_id=?').all(archived.runId) as any[];if(entries.length!==1||entries[0].units!==archived.gainCoins)throw Error('Task ledger readback mismatch');}finally{ledger.close();}}
   return archived;
  }});
  const attempts=inheritRoundAttempts(saved,prior.attempts.map((a:any)=>({identity:taskIdentity(a),name:a.name,instruction:a.instruction,reservationId:'legacy:'+a.attemptRunId,status:'consumed' as const,evidenceKey:'legacy'})));
  let planRevision=resume?.revisions?.length??0;
  const state=await runActivityRound({...round,attempts,...(resume?{resume}:{})},{...adapters,
   plan:async(inventory,state)=>{const context={inventory,cfg:{...cfg,model:{name:cfg.model.name}},priorPlans,knowledge,attempts:state.attempts,policy:{...r,userSkips:prior.userSkips},context:{roundId:id,day}};workspace.event('planning_started',{revision:++planRevision});save('plans/'+String(planRevision).padStart(4,'0')+'-input.json',context);const plan=await planRoundInventory({...context,model});save('plans/'+String(planRevision).padStart(4,'0')+'.json',{inventory,plan});workspace.event('planning_finished',{revision:planRevision,items:plan.items});return plan;},
   persist:state=>{const value={...state,...round};if(isStorageMigrated(root))putRoundState(root,r.stateFile,value);else writeRoundState(r.stateFile,value);save('state.json',value);save('usage.json',model.usage);},
  });
  save('final.json',state);save('usage.json',model.usage);workspace.finalize(state);
  console.log(JSON.stringify({evidenceDir,status:state.status,reason:state.reason,attempts:state.attempts.filter(a=>a.result?.roundId===id).length,errors:state.errors,desktop:state.finish,cleanup:state.cleanup},null,2));
  return state;
  }catch(error){workspace.event('execution_error',{error:String(error)});workspace.finalize({status:'unknown',errors:[String(error)],attempts:[]});throw error;}finally{detach();}
 });
}
