import {resolveDatabasePath} from '../runner/storage/index.ts';
import {assertLegacyWriterAllowed} from '../runner/storage/structured.ts';
assertLegacyWriterAllowed();
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {scopedId,validateTaskRecords} from '../runner/task-records.ts';
const root=process.cwd(),read=(f:string)=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8'));
const planFile='data/evidence/plans/ocr-inventory-20261101-review-v2.json',p=read(planFile);
const db=new Database(resolveDatabasePath(root),{readonly:true});
try{
 const account:any=db.prepare('select id,app,package,user_id from account where id=?').get(p.accountId);
 const activity:any=db.prepare('select id,account_id,name,asset_id from activity where id=?').get(p.activityId);
 if(!account||!activity||activity.account_id!==account.id)throw Error('Database ownership mismatch');
 const scope={appId:account.app,accountId:account.id,activityId:activity.id};
 const id=(kind:string,...parts:unknown[])=>scopedId(kind,scope,parts);
 const wrap=(kind:string,identity:unknown[],fields:any)=>({id:id(kind,...identity),scope,...fields});
 const invId=id('inventory',p.sourceInventory);
 const b:any={schemaVersion:1,scope,app:{id:account.app,package:account.package},account:{id:account.id,appId:account.app,userId:account.user_id},activity:{id:activity.id,accountId:account.id,name:activity.name,assetId:activity.asset_id},tasks:[],inventories:[],snapshots:[],plans:[],executions:[],experiences:[],scripts:[],progress:[],migration:{sourcePlan:planFile,sourceSnapshotDateLocal:p.sourceSnapshotDateLocal,mode:'offline_import_preserving_legacy_files',automaticRunnerIntegrated:false}};
 const taskMap=new Map<number,any>(),snapMap=new Map<number,any>();
 for(const item of p.items){
  // No provider task ID was exposed. A scoped occurrence gets its own ID; semantic match is separate.
  const task=wrap('task',[invId,item.id,item.name,item.instruction],{name:item.name,instruction:item.instruction,providerTaskId:null,occurrenceSource:invId,semanticKey:id('tasksemantics',item.name,item.instruction),legacyOrdinal:item.id});b.tasks.push(task);taskMap.set(item.id,task);
  const snap=wrap('snapshot',[invId,task.id],{inventoryId:invId,taskId:task.id,done:item.done,total:item.total,instruction:item.instruction,displayRewardCoins:item.displayRewardCoins,button:item.button,evidence:item.evidence,source:'saved_screenshot_audit_and_ocr_titles',positionAuthority:false});b.snapshots.push(snap);snapMap.set(item.id,snap);
 }
 b.inventories.push({id:invId,scope,complete:true,source:p.sourceInventory,taskSnapshotIds:b.snapshots.map((s:any)=>s.id),completenessEvidence:'evidence/appium-inventory-2026-10-31T23-34-47-389Z/visual-truth.json',capturedDateLocal:p.sourceSnapshotDateLocal});
 const plan=wrap('plan',[planFile],{inventoryId:invId,legacySource:planFile,revision:2,status:'historical_offline_review',decisions:p.items.map((t:any)=>({...t,taskSnapshotId:snapMap.get(t.id).id,taskId:taskMap.get(t.id).id,legacyOrdinal:t.id})),executionOrder:p.executionOrder.map((i:number)=>snapMap.get(i).id)});b.plans.push(plan);
 for(const [ordinal,stem,learningFile] of [[1,'ocr-arrival-2026-11-01T00-05-01-247Z','arrival-claim'],[2,'ocr-browse-2026-11-01T00-08-18-455Z','browse-return']] as const){
  const evidenceDir='evidence/'+stem,resultFile=evidenceDir+'/result.json',result=read(resultFile),summary=read(evidenceDir+'/summary.json'),learn=read('data/task-learning/'+learningFile+'.json');
  const run:any=db.prepare('select id,account_id,activity_id,evidence_dir from run where id=?').get(result.runId);
  if(!run||run.account_id!==scope.accountId||run.activity_id!==scope.activityId||path.resolve(run.evidence_dir)!==path.join(root,evidenceDir))throw Error('Run ownership/evidence mismatch');
  const task=taskMap.get(ordinal),item=p.items.find((x:any)=>x.id===ordinal);
  if(result.task!==task.name)throw Error('Result task mismatch');
  const raw=read(evidenceDir+'/frame-1.json').pages[0];
  const title=raw.lines.filter((l:any)=>l.text.normalize('NFKC')===task.name+'(0/1)');
  if(title.length!==1||!raw.lines.some((l:any)=>l.text==='赚金币抵钱'))throw Error('Actual before-frame target missing');
  const localInvId=id('inventory',evidenceDir,'before_target_only');
  const snap=wrap('snapshot',[localInvId,task.id],{inventoryId:localInvId,taskId:task.id,done:0,total:1,instruction:item.instruction,instructionSource:'same plan requirement; actual target/heading checked in frame-1',evidence:evidenceDir+'/frame-1.png',ocrSource:evidenceDir+'/frame-1.json',positionAuthority:false});
  b.snapshots.push(snap);b.inventories.push({id:localInvId,scope,complete:false,source:evidenceDir+'/frame-1.json',taskSnapshotIds:[snap.id],note:'Only actual selected task imported from pre-execution frame; not a full inventory refresh.'});
  const execution=wrap('execution',['run',result.runId],{runId:result.runId,taskSnapshotId:snap.id,planId:plan.id,decisionTaskSnapshotId:snapMap.get(ordinal).id,status:result.status,evidenceDir,resultFile,summaryFile:evidenceDir+'/summary.json',assetId:activity.asset_id,result,actions:summary.actions,legacyRunStatus:'DIAGNOSTIC',automaticRunnerAcceptance:false,linkProvenance:'retrospective association by exact target, observed requirement and database run; runtime did not consume this graph'});b.executions.push(execution);
  const script=wrap('script',[learn.existingProbe],{path:learn.existingProbe,mode:'interactive_probe',fileSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,learn.existingProbe))).digest('hex')});b.scripts.push(script);
  const experience=wrap('experience',[learningFile,execution.id],{sourceExecutionIds:[execution.id],taskIds:[task.id],scriptId:script.id,validation:'supervised_only',legacySource:'data/task-learning/'+learningFile+'.json',learned:learn});b.experiences.push(experience);
 }
 b.progress.push(wrap('progress',[plan.id,'after-run129'],{planId:plan.id,executionIds:b.executions.map((e:any)=>e.id),requiresInventoryRefresh:true,status:'paused_after_task2',legacySource:'data/evidence/plans/ocr-inventory-20261101-progress-task2.json',note:'No fresh complete plan after run129; replacements remain evidence only, not executed or implicitly completed.'}));
 validateTaskRecords(b);
 const base=path.join(root,'data/task-records',scope.appId,scope.accountId,scope.activityId);
 const relative=(f:string)=>path.relative(root,f);
 const payloads=new Map<string,string>();
 const add=(file:string,body:any)=>payloads.set(file,JSON.stringify(body,null,2)+'\n');
 const links:any={schemaVersion:1,scope,bundle:'bundle.json',records:{}};
 for(const kind of ['tasks','inventories','snapshots','plans','executions','experiences','scripts','progress']){
  links.records[kind]=[];
  for(const row of b[kind]){const rel=kind+'/'+row.id+'.json';add(path.join(base,rel),row);links.records[kind].push(rel);}
 }
 add(path.join(base,'bundle.json'),b);add(path.join(base,'index.json'),links);
 // Conflict detection before writing anything: re-running an identical import is a no-op.
 for(const [f,text] of payloads)if(fs.existsSync(f)&&fs.readFileSync(f,'utf8')!==text)throw Error('Existing archive differs; refuse overwrite '+relative(f));
 const sources=[planFile,p.sourceInventory,'data/task-learning/index.json','data/task-learning/arrival-claim.json','data/task-learning/browse-return.json',...b.executions.flatMap((e:any)=>[e.resultFile,e.summaryFile])];
 const backup=path.join(root,'.backups/task-records-ownership-v1');const manifest:any=[];
 for(const rel of sources){const bytes=fs.readFileSync(path.join(root,rel)),f=path.join(backup,rel);fs.mkdirSync(path.dirname(f),{recursive:true});if(fs.existsSync(f)&&!fs.readFileSync(f).equals(bytes))throw Error('Backup differs');if(!fs.existsSync(f))fs.writeFileSync(f,bytes,{flag:'wx'});manifest.push({file:rel,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
 const mf=path.join(backup,'manifest.json');if(!fs.existsSync(mf))fs.writeFileSync(mf,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 for(const [f,text] of payloads){if(fs.existsSync(f))continue;fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp-'+process.pid;fs.writeFileSync(tmp,text,{flag:'wx'});fs.renameSync(tmp,f);}
 console.log(JSON.stringify({archive:relative(base),backup:relative(backup),files:payloads.size,counts:Object.fromEntries(Object.keys(links.records).map(k=>[k,b[k].length])),databaseMode:'read_only',phoneUsed:false},null,2));
}finally{db.close();}
