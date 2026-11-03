import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {z} from 'zod';
import {acquireDeviceLock} from '../device-lock.ts';
import {createExecutionWorkspace} from '../staged/execution-workspace.ts';
import {validateStagedConfig} from '../staged/config.ts';
import {createRoundAdapters} from '../staged/round-main.ts';
import {findNextTask,summarizeAttempts} from '../staged/next-decision.ts';
import {taskIdentity} from '../staged/round.ts';
import {mergePriorRoundPlans,priorAttemptFromRun} from '../staged/round-adapter.ts';
import {AdbOcrDevice} from '../staged/device.ts';
import {RawCapture} from '../staged/raw-capture.ts';
import {saveStagedResult} from '../staged/store.ts';
import {Storage,isStorageMigrated} from '../storage/index.ts';
import {runRecipeStage} from './recipe-bridge.ts';
import {hasIdentityChallenge,observationTexts,validateProposedAction} from '../staged/observations.ts';
import {loadStageRecipes} from '../staged/recipes.ts';
import {snapshotSources,assertSourcesUnchanged} from '../staged/source-archive.ts';

const json=(v:any)=>JSON.stringify(v,null,2)+'\n';
const sha=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const id=z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/);
const definitions:any[]=[
 ['get_activity_context','Read current activity configuration and knowledge. No device access.',{configFile:z.string().min(1)}],
 ['list_recipes','List supported published workflows for this execution.',{}],
 ['begin_execution','Create an activity execution, preserve the configured batch history, and prepare the device. Requires explicit device enablement.',{configFile:z.string().min(1),live:z.literal(true),hostSessionId:z.string().optional(),mode:z.enum(['run','explore']).default('run')}],
 ['observe','Read the current ORIGINAL screenshot; returns an image content part and metadata.',{}],
 ['execute_recipe','Run enter-and-select, execute-task, or return-list. Deterministic steps run until completed or the same Agent must answer a visual question.',{recipeId:z.enum(['find-next-task','execute-task','return-list'])}],
 ['submit_decision','Answer the exact pending visual question. Continue the same operation and task attempt without replaying entry.',{decisionId:id,value:z.record(z.string(),z.unknown())}],
 ['act','Execute back, swipe or wait on a current observed frame owned by the configured app/user. Free taps lack a verified navigation contract; task entry uses execute-task.',{frameId:id,action:z.object({type:z.enum(['tap','swipe','back','wait']),purpose:z.enum(['ordinary-ui','exploration']).optional(),x:z.number().optional(),y:z.number().optional(),fromX:z.number().optional(),fromY:z.number().optional(),toX:z.number().optional(),toY:z.number().optional(),ms:z.number().int().positive().optional()})}],
 ['recover','Recover an ordinary failed task via return-list, or restart the configured app if separately enabled; never clears consumed attempts.',{strategy:z.enum(['return-list','restart-app']),reason:z.string().min(1)}],
 ['cancel_execution','Stop the current recipe, retain uncertain actions and attempts, then allow final cleanup and reporting.',{reason:z.string().min(1)}],
 ['get_run_state','Read current execution, consumed task identities and pending decision. No new device action.',{}],
 ['finish_activity','Finish or stop; persist report and issues, verify HOME when safe, then cleanup. No code or Skill edits.',{reason:z.string().min(1),noRemaining:z.boolean().default(false)}],
 ['review_execution','Review evidence for an entire execution or exact attempt. Read-only; never prepares or controls a device.',{executionId:id,scope:z.enum(['activity','task']).default('activity'),attemptId:id.optional()}],
];
export type ActivityServiceOptions={root:string;allowDevice?:boolean;allowRestart?:boolean;deviceFactory?:(dir:string,cfg:any)=>any;runtimeFactory?:any; nextFinder?:any; saveTask?:any};
/** CLI-independent business service. Importing this module does not open the live DB or device. */
export class ActivityService{
 readonly root:string;private options:ActivityServiceOptions;private db:Database.Database;private active:any=null;private bridge:any=null;private channel:any=null;private closed=false;private cancelled=false;private toolBusy=false;private workers=new Set<Promise<any>>();private cancellation:Promise<void>|null=null;private closing:Promise<void>|null=null;
 constructor(options:ActivityServiceOptions){
  this.root=fs.realpathSync(options.root);this.options=options;
  const file=this.target('data/checkin.db');if(!fs.existsSync(file))throw Error('Run storage migration first: data/checkin.db required');
  this.db=new Database(file,{fileMustExist:true});this.db.pragma('busy_timeout=5000');
  this.db.exec(`CREATE TABLE IF NOT EXISTS plugin_execution(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,scope_json TEXT NOT NULL,evidence_dir TEXT NOT NULL,status TEXT NOT NULL,state_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_attempt(batch_id TEXT NOT NULL,scope_key TEXT NOT NULL,identity TEXT NOT NULL,attempt_id TEXT NOT NULL,execution_id TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT,PRIMARY KEY(batch_id,scope_key,identity));
CREATE TABLE IF NOT EXISTS plugin_action(id TEXT PRIMARY KEY,execution_id TEXT NOT NULL,attempt_id TEXT,kind TEXT NOT NULL,status TEXT NOT NULL,detail_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugin_event(execution_id TEXT NOT NULL,seq INTEGER NOT NULL,kind TEXT NOT NULL,detail_json TEXT NOT NULL,PRIMARY KEY(execution_id,seq));`);
 }
 tools(){return definitions.map(([name,description,inputSchema])=>({name,description,inputSchema}));}
 private target(ref:string){
  if(typeof ref!=='string'||!ref||path.isAbsolute(ref))throw Error('Workspace relative path required');
  const p=path.resolve(this.root,ref),relative=path.relative(this.root,p);if(!relative||relative.startsWith('..'+path.sep)||relative==='..')throw Error('Path outside workspace');
  let parent=p;while(!fs.existsSync(parent))parent=path.dirname(parent);
  const real=fs.realpathSync(parent);if(real!==this.root&&!real.startsWith(this.root+path.sep))throw Error('Path outside workspace via symlink');if(real!==parent)throw Error('Workspace symlink alias rejected');return p;
 }
 private read(ref:string){
  const f=this.target(ref);ref=path.relative(this.root,f).split(path.sep).join('/');
  if(ref.startsWith('data/')&&isStorageMigrated(this.root)){
   const storage=new Storage(this.root);try{const value=storage.getRoundState(ref)??storage.getDocument(ref);if(value!==null)return value;}finally{storage.close();}
   throw Object.assign(Error('Structured document missing in SQLite: '+ref),{code:'ENOENT'});
  }
  return JSON.parse(fs.readFileSync(f,'utf8'));
 }
 private context(configFile:string){
  const cfg=validateStagedConfig(this.read(configFile));
  const safe=structuredClone(cfg);if(safe.model)safe.model={name:safe.model.name,timeoutMs:safe.model.timeoutMs};
  const documents:any[]=[];const dir=path.join('knowledge','apps',cfg.scope.appId,'activities',cfg.scope.activityId);
  for(const ref of ['knowledge/index.md',...['activity.md','task-capabilities.md','lessons.md'].map(n=>path.join(dir,n))]){
   const f=this.target(ref);if(fs.existsSync(f))documents.push({path:ref,sha256:sha(fs.readFileSync(f)),text:fs.readFileSync(f,'utf8')});
  }
  return {cfg,public:{scope:cfg.scope,config:safe,knowledge:documents,executionRules:{modifySource:false,resetAttempts:false,stopOnAuthentication:true,reportToCaller:true}}};
 }
 private text(value:any){return {content:[{type:'text' as const,text:json(value)}]};}
 private need(){if(!this.active)throw Error('No active execution');return this.active;}
 private validateOwner(cfg:any){
  const tables=new Set((this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()as any[]).map(r=>r.name));
  // Only an injected device with no domain schema may use isolated fixture semantics.
  if(!['account','activity','asset'].some(t=>tables.has(t))&&this.options.deviceFactory)return;
  if(!['account','activity','asset'].every(t=>tables.has(t)))throw Error('Account/activity/asset ownership tables required');
  const account=this.db.prepare('SELECT * FROM account WHERE id=?').get(cfg.scope.accountId)as any;
  const activity=this.db.prepare('SELECT * FROM activity WHERE id=?').get(cfg.scope.activityId)as any;
  const asset=this.db.prepare('SELECT * FROM asset WHERE id=?').get(cfg.assetId)as any;
  if(!account||account.app!==cfg.scope.appId||account.package!==cfg.package||account.user_id!==cfg.scope.userId||!activity||activity.account_id!==account.id||activity.asset_id!==cfg.assetId||!asset||asset.platform!==cfg.scope.appId)throw Error('Account/activity/asset owner scope mismatch');
 }
 private loadKnowledge(cfg:any){
  let knowledge:any={};try{const index=this.read(cfg.knowledgeIndex);knowledge=this.read(index.knowledgeBundle);}catch(e:any){if(e.code!=='ENOENT')throw e;}
  if(knowledge.scope!==undefined){const scope=knowledge.scope;if(!scope||scope.appId!==cfg.scope.appId||scope.activityId!==cfg.scope.activityId||['accountId','userId'].some(key=>scope[key]!==undefined&&scope[key]!==cfg.scope[key]))throw Error('Knowledge bundle scope mismatch');}
  return knowledge;
 }
 private guard(){const a=this.need();if(this.closed)throw Error('Service closed');if(this.cancelled)throw Error('Execution cancellation requested');if(a.status!=='running')throw Error('Execution is stopped');if(a.inputUnknown||a.blocked)throw Error('Unresolved input or authentication barrier: device input stopped');if(a.attempts.some((x:any)=>x.result?.roundId===a.id&&x.result.persistenceVerified!==true))throw Error('Persistence unresolved: device input stopped');return a;}
 private event(kind:string,data:any={}){const a=this.need();a.workspace.event(kind,data);if(kind==='recovery_result'){const file=path.join(a.dir,'recoveries.jsonl'),fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),...data})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}const seq=++a.seq;this.db.prepare('INSERT INTO plugin_event VALUES(?,?,?,?)').run(a.id,seq,kind,JSON.stringify(data));}
 private persist(){const a=this.need();const state={id:a.id,batchId:a.batchId,scope:a.cfg.scope,status:a.status,inputUnknown:a.inputUnknown,blocked:a.blocked,attempts:summarizeAttempts(a.attempts),selection:a.selection?{task:a.selection.item}:null,hostSessionId:a.hostSessionId,errors:a.errors};this.db.prepare('INSERT INTO plugin_execution VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,state_json=excluded.state_json').run(a.id,a.batchId,JSON.stringify(a.cfg.scope),path.relative(this.root,a.dir),a.status,JSON.stringify(state));a.workspace.save('state.json',state);}
 private async frameContent(frame:any,value:any){
  if(!frame)return this.text(value);
  const a=this.need(),rel=path.relative(this.root,frame.path),file=this.target(rel),real=fs.realpathSync(file);
  if(!real.startsWith(fs.realpathSync(a.dir)+path.sep))throw Error('Screenshot outside execution evidence');
  const b=fs.readFileSync(real);if(b.length<33||!b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||b.readUInt32BE(16)!==frame.width||b.readUInt32BE(20)!==frame.height)throw Error('Invalid original PNG');
  return {content:[{type:'text' as const,text:json({...value,frame:{...frame,path:rel,sha256:sha(b)}})},{type:'image' as const,data:b.toString('base64'),mimeType:'image/png'}]};
 }
 private async bridgeResult(snapshot:any){
  const a=this.need();
  if(snapshot.status==='stopped'&&snapshot.error){a.errors.push(snapshot.error);this.event('operation_failed',{operation:a.operation,error:snapshot.error});}
  this.persist();
  if(snapshot.status==='needs_decision'){
   const decision=snapshot.decision??snapshot.pending;
   const request=decision.request??decision;
   this.event('agent_decision_requested',{decisionId:decision.id,request});
   return this.frameContent(request.frame,{status:'needs_decision',executionId:a.id,operation:a.operation,decisionId:decision.id,prompt:request.prompt,context:request.context});
  }
  if(snapshot.status==='running')return this.text({status:'running',executionId:a.id,operation:a.operation});
  return this.text({executionId:a.id,...snapshot,state:this.state()});
 }
 private state(){const a=this.need();return {id:a.id,status:a.status,batchId:a.batchId,attempts:summarizeAttempts(a.attempts),inputUnknown:a.inputUnknown,blocked:a.blocked,errors:a.errors,needsRecovery:a.needsRecovery??false,pending:this.bridge?.status?.()??null};}
 private async begin(args:any){
  if(this.closed)throw Error('Service closed');
  if(!this.options.allowDevice)throw Error('Device access not enabled: explicit host opt-in required');
  const assertReconciled=()=>{const unresolved=this.db.prepare("SELECT id FROM plugin_execution WHERE status='running' LIMIT 1").get()??this.db.prepare("SELECT id FROM plugin_action WHERE status IN ('reserved','unknown') LIMIT 1").get();if(unresolved)throw Error('Unresolved prior execution requires caller reconciliation before new device access');};assertReconciled();
  if(this.active)throw Error('An execution already owns this service');
  if(args.live!==true)throw Error('Explicit device execution required');
  const {cfg}=this.context(args.configFile);if(!cfg.round?.batchId)throw Error('Explicit retained batch required');
  this.validateOwner(cfg);const knowledge=this.loadKnowledge(cfg);
  // Validate both real ancestors before either artifact tree is written.
  this.target('evidence');this.target('data/backups');
  const serial=process.env.ADB_SERIAL??'3d8a7934';const lock=await acquireDeviceLock({serial});
  try{
   if(this.closed||this.cancelled)throw Error('Service closed or execution cancellation requested');
   assertReconciled();this.validateOwner(cfg);
   const evidenceRoot=this.target('evidence'),backup=this.target(path.join('data/backups','pre-plugin-'+randomUUID()+'.db'));fs.mkdirSync(path.dirname(backup),{recursive:true});await this.db.backup(backup);const verify=new Database(backup,{readonly:true});try{if(verify.pragma('quick_check',{simple:true})!=='ok')throw Error('Backup quick_check failed');}finally{verify.close();}
   if(this.closed||this.cancelled)throw Error('Service closed or execution cancellation requested');
   fs.mkdirSync(this.target('evidence'),{recursive:true});
   const executionId=randomUUID(),workspace=createExecutionWorkspace({evidenceRoot:this.target(path.relative(this.root,evidenceRoot)),id:executionId,batchId:cfg.round.batchId,scope:cfg.scope});
   const a:any={id:executionId,batchId:cfg.round.batchId,scopeKey:JSON.stringify(cfg.scope),cfg,knowledge,configFile:args.configFile,dir:workspace.evidenceDir,workspace,lock,status:'running',inputUnknown:false,blocked:false,attempts:[],errors:[],seq:0,hostSessionId:args.hostSessionId??null,mode:args.mode??'run',selection:null,operation:null,coverage:null};
   this.active=a;
   const priorPlans=(cfg.round.priorPlanFiles??[]).map((ref:string)=>({path:ref,plan:this.read(ref)}));
   const day=new Date(Date.now()+8*3600_000).toISOString().slice(0,10),prior=mergePriorRoundPlans(priorPlans,day);
   if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run'").get())for(const row of this.db.prepare('SELECT id,day,evidence_dir FROM run WHERE account_id=? AND activity_id=? AND day=?').all(cfg.scope.accountId,cfg.scope.activityId,day)as any[]){
    if(!row.evidence_dir)continue;let rel=path.isAbsolute(row.evidence_dir)?path.relative(this.root,row.evidence_dir):row.evidence_dir;
    try{const attempt=priorAttemptFromRun(row,this.read(path.join(rel,'result.json')),this.read(path.join(rel,'stages.json')));if(attempt)prior.attempts.push(attempt);}catch(e:any){if(e.code!=='ENOENT')throw e;}
   }
   const unsafeAttempt=(x:any)=>['reserved','unknown'].includes(x.status)||x.inputUnknown||x.blocked||x.result?.inputUnknown||x.result?.blocked||x.result&&(!x.result.returned||!x.result.persistenceVerified);
   if(cfg.round.stateFile){const saved=this.read(cfg.round.stateFile);if(saved.batchId!==a.batchId||JSON.stringify(saved.scope)!==JSON.stringify(cfg.scope))throw Error('Retained round state scope mismatch');a.inputUnknown=!!saved.inputUnknown;a.blocked=!!saved.blocked;a.attempts.push(...saved.attempts??[]);}
   // Check retained safety before replacing duplicate identities with authoritative SQLite records.
   if(a.inputUnknown||a.blocked||a.attempts.some(unsafeAttempt))throw Error('Unsafe retained attempt requires caller review; no device prepare');
   for(const p of prior.attempts)if(!a.attempts.some((x:any)=>x.identity===taskIdentity(p)))a.attempts.push({identity:taskIdentity(p),name:p.name,instruction:p.instruction,status:'consumed',reservationId:'legacy:'+p.attemptRunId,evidenceKey:'legacy'});
   for(const row of this.db.prepare('SELECT * FROM plugin_attempt WHERE batch_id=? AND scope_key=?').all(a.batchId,a.scopeKey)as any[]){
    const [name,instruction]=JSON.parse(row.identity),attempt={identity:row.identity,name,instruction,status:row.status,reservationId:row.attempt_id,evidenceKey:'sqlite',...(row.result_json?{result:JSON.parse(row.result_json)}:{})};
    a.attempts=a.attempts.filter((x:any)=>x.identity!==row.identity);a.attempts.push(attempt);
   }
   if(a.attempts.some(unsafeAttempt))throw Error('Unsafe retained attempt requires caller review; no device prepare');
   const bridge=await import('./recipe-bridge.ts');this.guard();this.channel=new bridge.DecisionChannel();this.bridge=new bridge.RecipeBridge(this.channel);
   a.recipes=structuredClone(loadStageRecipes(this.target(cfg.recipeRoot??'data/stage-records/recipes'),cfg.scope,this.root));
   a.priorPlans=priorPlans;a.userSkips=prior.userSkips;
   const configPath=this.target(args.configFile),configRef=path.relative(this.root,configPath).split(path.sep).join('/');
   a.sources=snapshotSources([...fs.readdirSync(path.join(this.root,'runner/staged')).filter(f=>f.endsWith('.ts')).map(f=>path.join(this.root,'runner/staged',f)),...['./service.ts','./recipe-bridge.ts'].map(ref=>fileURLToPath(new URL(ref,import.meta.url))),...(!configRef.startsWith('data/')||!isStorageMigrated(this.root)?[configPath]:[])]);
   const input=(value:any,source:string)=>({source,sha256:sha(JSON.stringify(value)),value:structuredClone(value)});
   workspace.save('sources.json',a.sources);workspace.save('inputs.json',{config:input(cfg,configRef),knowledge:input(a.knowledge,cfg.knowledgeIndex),recipes:input(a.recipes,path.join(cfg.recipeRoot??'data/stage-records/recipes','registry.json'))});
   workspace.save('config.json',{...this.context(args.configFile).public,config:{...cfg,model:{name:cfg.model.name,timeoutMs:cfg.model.timeoutMs}}});workspace.save('backup.json',{path:path.relative(this.root,backup),quickCheck:'ok'});
   this.validateOwner(cfg);a.device=this.makeDevice(path.join(a.dir,'device'),cfg);
   this.setupAdapters();this.persist();await a.device.prepare();this.event('device_prepared');
   return this.text({executionId:a.id,status:'running',context:this.context(args.configFile).public,next:'execute_recipe find-next-task',batchId:a.batchId});
  }catch(e){if(this.active){this.active.status='stopped';this.active.errors.push(String(e));this.persist();if(this.active.device)try{await this.active.device.cleanup();}catch{}this.active=null;}lock.release();throw e;}
 }
 private makeDevice(dir:string,cfg:any){const a=this.need();const raw=this.options.deviceFactory?.(dir,cfg)??new AdbOcrDevice({serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir:dir,executionPolicy:cfg.executionPolicy,allowVisualFallback:true,balanceComponent:cfg.balanceComponent===true});
  return new Proxy(raw,{get:(target,key)=>{const value=Reflect.get(target,key);if(typeof value!=='function')return value;
   if(key==='capture')return async(...args:any[])=>{const frame=await value.apply(target,args);if(hasIdentityChallenge(observationTexts(frame))){a.blocked=true;this.persist();}return frame;};
   if(!['act','scrollContinuously','returnHome','restartApp'].includes(String(key)))return value.bind(target);
   const run=async(...args:any[])=>{this.guard();const actionId=randomUUID();const kind=String(key);const detail={action:args[0],frameId:args[1]?.id};this.db.prepare('INSERT INTO plugin_action VALUES(?,?,?,?,?,?)').run(actionId,a.id,a.selection?.selection?.taskAttemptId??null,kind,'reserved',JSON.stringify(detail));this.event('action_reserved',{actionId,kind,...detail});
    let started=key!=='act'||!['tap','swipe','wait'].includes(args[0]?.type);
    if(key==='act'&&['tap','swipe'].includes(args[0]?.type)){const original=args[2]?.beforeInput;args[2]={...args[2],beforeInput:()=>{this.guard();started=true;original?.();}};}
    try{const r=await value.apply(target,args);if(r?.dispatchStatus==='unknown'){started=true;this.event('action_unknown',{actionId,kind,result:r});throw Error('Device dispatch outcome unknown; further input stopped');}this.db.prepare('UPDATE plugin_action SET status=? WHERE id=?').run('dispatched',actionId);this.event('action_dispatched',{actionId});return r;}catch(e){if(started)a.inputUnknown=true;this.db.prepare('UPDATE plugin_action SET status=? WHERE id=?').run(started?'unknown':'not-sent',actionId);this.persist();throw e;}
   };
   return run;}});
 }
 private setupAdapters(){const a=this.need(),knowledge=structuredClone(a.knowledge);
  a.adapters=createRoundAdapters({cfg:a.cfg,round:{id:a.id,evidenceDir:a.dir,configFile:this.target(a.configFile)},device:a.device,model:{hostManagedDecisions:true,query:async(r:any)=>{const value=await this.channel.query(r);if(value?.blocked===true||value?.state?.blocked===true||value?.state==='blocked'){a.blocked=true;this.persist();}return value;},usage:[]},knowledge,scriptFiles:[],nextDecision:true,nextFinder:this.options.nextFinder??findNextTask,priorPlans:a.priorPlans,policy:{...a.cfg.round,userSkips:a.userSkips},runtimeFactory:this.options.runtimeFactory,event:a.workspace.event,registerTask:a.workspace.registerTask,taskDeviceFactory:(dir:string)=>this.makeDevice(dir,a.cfg),recipes:structuredClone(a.recipes),controllerDeps:(ctx:any,dir:string)=>{const raw=new RawCapture({serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir:dir,executionPolicy:a.cfg.executionPolicy});return {captureRawBurst:(r:any)=>raw.captureBurst({package:a.cfg.package,userId:a.cfg.scope.userId,taskAttemptId:ctx.taskAttemptId},{frames:r.frames,intervalMs:r.intervalMs,budgetMs:r.maxMs}),deriveRawFrames:(batch:any,limits:any)=>raw.deriveFrames(batch,{ocrBinary:a.cfg.rawCapture?.ocrBinary??'/Users/mater/.hermes/cache/scratch/checkin-apple-ocr'},limits)};},skipReview:true,runStage:runRecipeStage,saveTask:async(v:any)=>{assertSourcesUnchanged(a.sources);return this.options.saveTask?this.options.saveTask(v):saveStagedResult({...v,root:this.root,reviews:[],archiveKnowledge:false}as any);}});
 }
 private async runRecipe(recipeId:string){const a=this.guard();if(this.bridge.status().status==='needs_decision'||this.bridge.status().status==='running')throw Error('Operation still pending; submit_decision or get_run_state');a.operation=recipeId;
  const work=async()=>{
   if(recipeId==='find-next-task'){
    if(a.needsRecovery)throw Error('Task return or persistence unverified; recover or stop before selection');
    if(a.selection)throw Error('Selected task must be executed or explicitly reported before new selection');
    const r=await a.adapters.next({attempts:a.attempts});a.coverage=r.coverage;
    if(r.decision==='task')a.selection=r;
    if(r.blocked)a.blocked=true;if(r.inputUnknown)a.inputUnknown=true;
    this.event('next_task_result',r);this.persist();return r;
   }
   if(recipeId==='execute-task'){
    if(!a.selection)throw Error('No selected current task');const selected=a.selection,item=selected.item,key=taskIdentity(item),attemptId=selected.selection.taskAttemptId;
    if(a.attempts.some((x:any)=>x.identity===key))throw Error('Task identity already attempted in retained batch');
    this.db.prepare('INSERT INTO plugin_attempt VALUES(?,?,?,?,?,?,?)').run(a.batchId,a.scopeKey,key,attemptId,a.id,'reserved',null);
    const attempt:any={identity:key,name:item.name,instruction:item.instruction,reservationId:attemptId,status:'reserved',evidenceKey:selected.selection.evidenceKey};a.attempts.push(attempt);this.persist();
    const result=await a.adapters.execute(item,{attempts:a.attempts});attempt.result=result;attempt.status=result.entryDispatched?'consumed':'pending';
    a.blocked ||=result.blocked;a.inputUnknown ||=result.inputUnknown;a.needsRecovery=!result.returned||!result.persistenceVerified;
    if(result.status!=='completed')this.event('task_issue',{attemptId,result});
    this.db.prepare('UPDATE plugin_attempt SET status=?,result_json=? WHERE batch_id=? AND scope_key=? AND identity=?').run(attempt.status,JSON.stringify(result),a.batchId,a.scopeKey,key);
    a.selection=null;this.persist();return result;
   }
   if(recipeId==='return-list'){
    if(a.attempts.some((x:any)=>x.result?.roundId===a.id&&x.result.persistenceVerified!==true))throw Error('Persistence unresolved: recovery cannot dispatch input');
    const r=await a.adapters.recover();
    if(r.status==='completed'){
     const attempt=[...a.attempts].reverse().find((x:any)=>x.result?.roundId===a.id);
     if(attempt){attempt.result.returned=true;attempt.result.recovery=r;this.db.prepare('UPDATE plugin_attempt SET result_json=? WHERE batch_id=? AND scope_key=? AND identity=?').run(JSON.stringify(attempt.result),a.batchId,a.scopeKey,attempt.identity);}
     a.selection=null;a.needsRecovery=false;
    }
    this.event('recovery_result',{strategy:'return-list',result:r});this.persist();return r;
   }
   throw Error('Unknown recipe');
  };
  return this.bridgeResult(await this.bridge.start(randomUUID(),work));
 }
 private async finish(args:any){const a=this.need();if(a.finished)throw Error('Execution already finalized');const pending=this.bridge?.status();if(pending?.status==='running'||pending?.status==='needs_decision')throw Error('Pending operation must be cancelled before finish');
  if(args.noRemaining&&(!a.coverage?.complete||!a.coverage?.topVerified||!a.coverage?.bottomVerified||a.selection))throw Error('Verified full search coverage required before no-remaining completion');
  let home:any=null,cleanup:any=null;
  try{if(!this.cancelled&&!a.inputUnknown&&!a.blocked){home=await a.device.returnHome({package:a.cfg.package,userId:a.cfg.scope.userId});if(home?.confirmed!==true)a.errors.push('Desktop return not confirmed');}}
  catch(e){a.errors.push(String(e));}
  finally{try{cleanup=await a.device.cleanup();}catch(e){a.errors.push(String(e));}}
  a.status=args.noRemaining&&!this.cancelled&&!a.errors.length&&!a.inputUnknown&&!a.blocked?'completed':'stopped';a.reason=args.reason;this.persist();
  const results=a.attempts.filter((x:any)=>x.result?.roundId===a.id),issues=results.filter((x:any)=>x.result?.status!=='completed');
  a.workspace.save('issues.json',issues);a.workspace.save('cleanup.json',cleanup);a.workspace.finalize({status:a.status,reason:args.reason,attempts:a.attempts,errors:a.errors,finish:home,cleanup});
  const gains=results.reduce((n:number,x:any)=>n+(x.result.gainCoins??0),0);
  const report=`# Activity report\n\nExecution: ${a.id}\nStatus: ${a.status}\nReason: ${args.reason}\nConfirmed coins: ${gains}\n\n## Failed or unconfirmed tasks\n\n${issues.map((x:any)=>'- '+x.name+': '+(x.result?.error??x.result?.status)).join('\n')||'None recorded.'}\n\n## Caller review\n\nSee issues.json, events.jsonl and each tasks directory. Failure causes remain unknown unless the saved evidence establishes them. No scripts, Skills or long-term knowledge were modified.\n`;
  fs.writeFileSync(path.join(a.dir,'report.md'),report,{mode:0o600});a.lock.release();a.finished=true;return this.text({executionId:a.id,status:a.status,gainCoins:gains,report:path.relative(this.root,path.join(a.dir,'report.md')),issues,cleanup,home});
 }
 private review(args:any){const executionId=id.parse(args.executionId),scope=args.scope??'activity';if(scope==='task'&&!args.attemptId)throw Error('Exact attempt identifier required');
  const rows=this.db.prepare('SELECT evidence_dir FROM plugin_execution WHERE id=?').get(executionId)as any;
  let dir=rows?.evidence_dir??path.join('evidence',executionId);const manifest=this.read(path.join(dir,'manifest.json'));if(manifest.id!==executionId)throw Error('Execution manifest identity mismatch');
  const summary=this.read(path.join(dir,'summary.json'));let task:any=null;
  if(scope==='task'){id.parse(args.attemptId);const found=(manifest.tasks??[]).find((x:any)=>x.taskAttemptId===args.attemptId);if(!found)throw Error('Attempt not in execution manifest');task={binding:found};for(const file of ['final.json','result.json','stages.json']){const ref=path.join(dir,found.evidenceDir,file);try{task[file]=this.read(ref);}catch(e:any){if(e.code!=='ENOENT')throw e;}}}
  return this.text({executionId,scope,manifest,summary,task,sourceDirectory:dir,readOnly:true,sourceModification:false});
 }
 async call(name:string,args:any={}){
  if(this.closed)throw Error('Service closed');
  if(this.cancelled&&!['get_activity_context','list_recipes','get_run_state','review_execution','cancel_execution','finish_activity'].includes(name))throw Error('Execution cancellation requested');
  const exclusive=!['get_activity_context','list_recipes','get_run_state','review_execution','cancel_execution'].includes(name);
  if(exclusive&&this.toolBusy)throw Error('Another business tool owns this service');
  if(exclusive)this.toolBusy=true;
  // Cancellation is a coordinator, never a worker that could await itself.
  if(name==='cancel_execution')return this.dispatch(name,args);
  const worker=Promise.resolve().then(()=>this.dispatch(name,args));this.workers.add(worker);
  try{return await worker;}finally{this.workers.delete(worker);if(exclusive)this.toolBusy=false;}
 }
 private async settleWorkers(reason:string){
  await this.bridge?.cancel(reason);
  while(this.workers.size)await Promise.allSettled([...this.workers]);
  // begin may have installed a bridge while an awaited preparation settled.
  await this.bridge?.cancel(reason);
 }
 private async dispatch(name:string,args:any={}){
  const def=definitions.find(x=>x[0]===name);if(!def)throw Error('Unknown tool');args=z.object(def[2]).strict().parse(args);
  if(name==='get_activity_context')return this.text(this.context(args.configFile).public);
  if(name==='list_recipes')return this.text({recipes:[{id:'find-next-task',description:'Open app/activity/list on first call; select first allowed task from current real images using the same Agent. Later calls refresh selection.'},{id:'execute-task',description:'Execute selected task, verify receipt, return and settle; no in-run review/Skill writes.'}],source:'runner/staged',immutableDuringExecution:true});
  if(name==='begin_execution')return this.begin(args);
  if(name==='review_execution')return this.review(args);
  if(name==='get_run_state')return this.text(this.state());
  if(name==='cancel_execution'){this.cancelled=true;this.cancellation??=(async()=>{await this.settleWorkers(args.reason);if(this.active){this.event('execution_cancelled',{reason:args.reason});this.persist();}})();await this.cancellation;return this.text({status:'stopped',next:'finish_activity',state:this.active?this.state():null});}
  if(name==='execute_recipe')return this.runRecipe(args.recipeId);
  if(name==='submit_decision'){this.guard();this.event('agent_decision_answered',{decisionId:args.decisionId,value:args.value});return this.bridgeResult(await this.bridge.respond(args.decisionId,args.value));}
  if(name==='observe'){const a=this.guard();if(['running','needs_decision'].includes(this.bridge.status().status))throw Error('Recipe owns the device; use its supplied screenshot');const frame=await a.device.capture();a.frame=frame;this.event('observation',{frame});return this.frameContent(frame,{status:'observed'});}
  if(name==='act'){const a=this.guard();if(['running','needs_decision'].includes(this.bridge.status().status)||a.selection)throw Error('Recipe or selection owns device input');if(!a.frame||a.frame.id!==args.frameId)throw Error('Current observed frame required');if(args.action.type==='tap'&&!args.action.purpose)throw Error('Explicit ordinary UI or authorized exploration purpose required');if(args.action.purpose==='exploration'&&a.mode!=='explore')throw Error('Exploration mode required');const frame=a.frame;if(frame.package!==a.cfg.package||frame.userId!==a.cfg.scope.userId||frame.observationError)throw Error('Current configured frame owner and valid observation required');validateProposedAction(args.action,frame,{package:a.cfg.package,userId:a.cfg.scope.userId});
   // A purpose string supplies no trusted navigation contract: any free tap could enter a task.
   if(args.action.type==='tap')throw Error('Ordinary tap requires a verified navigation contract; task entry uses execute-task');
   a.frame=null;await a.device.act(args.action,frame);this.event('navigation_action',{frameId:args.frameId,action:args.action});return this.text({status:'dispatched',next:'observe'});}
  if(name==='recover'){const a=this.guard();if(args.strategy==='return-list')return this.runRecipe('return-list');if(!this.options.allowRestart)throw Error('App restart recovery not enabled in this installation');if(['running','needs_decision'].includes(this.bridge.status().status))throw Error('Pending recipe must finish or cancel before restart');const result=await a.device.restartApp({package:a.cfg.package,userId:a.cfg.scope.userId});this.event('recovery_result',{strategy:args.strategy,reason:args.reason,result});a.selection=null;a.needsRecovery=false;this.setupAdapters();return this.text({status:'restarted',verifiedList:false,next:'execute_recipe find-next-task',result});}
  if(name==='finish_activity')return this.finish(args);
  throw Error('Unsupported tool');
 }
 close(){if(this.closing)return this.closing;this.closed=true;this.cancelled=true;this.closing=(async()=>{try{await this.cancellation;await this.settleWorkers('MCP connection closed');const a=this.active;if(a&&!a.finished){a.status='stopped';a.errors.push('MCP connection closed');try{this.persist();const cleanup=await a.device?.cleanup();a.workspace.save('cleanup.json',cleanup??{notPrepared:true});a.workspace.finalize({status:'stopped',reason:'connection-closed',attempts:a.attempts,errors:a.errors,cleanup});a.finished=true;}finally{a.lock.release();}}}finally{this.db.close();}})();return this.closing;}
}
