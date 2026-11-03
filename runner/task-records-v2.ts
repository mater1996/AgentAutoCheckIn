import {createHash} from 'node:crypto';
import {validateTaskRecords} from './task-records.ts';
const digest=(kind:string,parts:unknown[])=>kind+'_'+createHash('sha256').update(JSON.stringify(parts)).digest('hex');
/** Split shared definitions/procedures from account observations; preserve source links only. */
export function splitTaskRecords(old:any):any{
 validateTaskRecords(old);
 const scope={appId:old.scope.appId,activityId:old.scope.activityId};
 const id=(kind:string,...parts:unknown[])=>digest(kind,[scope.appId,scope.activityId,...parts]);
 const definitions=new Map<string,any>(),taskDefinitions=new Map<string,string>();
 for(const t of old.tasks){const key=id('definition',t.name,t.instruction);definitions.set(key,{id:key,scope,name:t.name,instruction:t.instruction,providerTaskId:null,identityBasis:'observed name and requirement, not a provider permanent ID'});taskDefinitions.set(t.id,key);}
 const scripts=old.scripts.map((s:any)=>({id:id('scriptversion',s.path,s.fileSha256),scope,path:s.path,fileSha256:s.fileSha256,mode:s.mode,crossAccountValidated:false,notes:'Existing interactive probe; device/target assumptions must be checked before reuse, not an autonomous cross-account script.'}));
 const scriptIds=new Map(old.scripts.map((s:any,i:number)=>[s.id,scripts[i].id]));
 const experienceVersions=old.experiences.map((e:any)=>{
  const l=e.learned;
  const procedure={orderedSteps:l.orderedSteps,completionQuotes:l.completionQuotes,reusePreconditions:l.reusePreconditions,validation:'supervised_only',crossAccountValidated:false,knownLimits:['Observed under parent supervision; autonomous replay not validated.','Capture raw frames before OCR; transient messages can be missed.','Read stable balance on owning asset page; discard animated or conflicting values.','Progress may update after a delay; task replacements do not inherit completion.']};
  const taskDefinitionIds=e.taskIds.map((t:string)=>taskDefinitions.get(t));
  return {id:id('experienceversion',taskDefinitionIds,scriptIds.get(e.scriptId),procedure),scope,taskDefinitionIds,scriptVersionId:scriptIds.get(e.scriptId),...procedure,sources:e.sourceExecutionIds.map((eid:string)=>{const ex=old.executions.find((x:any)=>x.id===eid);return {appId:scope.appId,activityId:scope.activityId,accountId:old.scope.accountId,executionId:ex.id,runId:ex.runId,resultFile:ex.resultFile,legacyExperienceId:e.id};})};
 });
 const accountData=structuredClone(old);accountData.schemaVersion=2;delete accountData.app;delete accountData.experiences;delete accountData.scripts;
 accountData.activity={id:old.activity.id,accountId:old.scope.accountId,activityDefinitionId:scope.activityId,assetId:old.activity.assetId};
 accountData.tasks=old.tasks.map((t:any)=>({...t,taskDefinitionId:taskDefinitions.get(t.id)}));
 accountData.executions=old.executions.map((e:any)=>({...e,usedExperienceVersionId:null,derivedExperienceVersionIds:experienceVersions.filter((x:any)=>x.sources.some((s:any)=>s.executionId===e.id)).map((x:any)=>x.id)}));
 accountData.migration={...old.migration,schemaVersion:2,note:'Shared knowledge extracted; history contains provenance, not evidence that old runs used newly created experience versions.'};
 return {schemaVersion:2,knowledge:{schemaVersion:2,scope,application:old.app,activity:{id:scope.activityId,appId:scope.appId,name:old.activity.name,assetId:old.activity.assetId},taskDefinitions:[...definitions.values()],scriptVersions:scripts,experienceVersions},accountData};
}
export function validateSplitTaskRecords(v:any):void{
 if(v?.schemaVersion!==2||v.knowledge?.schemaVersion!==2||v.accountData?.schemaVersion!==2)throw Error('Schema version');
 const k=v.knowledge,a=v.accountData,s=k.scope;
 const eq=(x:any)=>x?.appId===s.appId&&x?.activityId===s.activityId&&x.accountId===undefined;
 if(!eq(s)||a.scope.appId!==s.appId||a.scope.activityId!==s.activityId||k.application.id!==s.appId||k.activity.id!==s.activityId||k.activity.appId!==s.appId||a.activity.activityDefinitionId!==s.activityId||a.activity.assetId!==k.activity.assetId)throw Error('Knowledge scope mismatch');
 const noOperational=(obj:any)=>{if(!obj||typeof obj!=='object')return;for(const [key,value]of Object.entries(obj)){if(['accountId','done','total','balanceBefore','balanceAfter','gainCoins','observedBalance','learned','decision','executionStatus'].includes(key))throw Error('Shared operational data '+key);noOperational(value);}};
 const maps:any={};const seen=new Set();
 for(const name of ['taskDefinitions','scriptVersions','experienceVersions']){if(!Array.isArray(k[name]))throw Error('Missing knowledge records');maps[name]=new Map();for(const x of k[name]){if(!x.id||seen.has(x.id))throw Error('Duplicate knowledge id');seen.add(x.id);if(!eq(x.scope))throw Error('Knowledge scope mismatch');const {sources,...body}=x;noOperational(body);maps[name].set(x.id,x);}}
 for(const t of a.tasks)if(!maps.taskDefinitions.has(t.taskDefinitionId))throw Error('Missing task definition');
 for(const t of a.tasks){const d=maps.taskDefinitions.get(t.taskDefinitionId);if(d.name!==t.name||d.instruction!==t.instruction)throw Error('Task definition mismatch');}
 for(const x of k.experienceVersions){
  if(!maps.scriptVersions.has(x.scriptVersionId)||!x.taskDefinitionIds?.length||!x.sources?.length)throw Error('Missing experience references');
  for(const id of x.taskDefinitionIds)if(!maps.taskDefinitions.has(id))throw Error('Experience definition mismatch');
  if(x.crossAccountValidated!==false||x.validation!=='supervised_only')throw Error('Unverified experience promoted');
  for(const src of x.sources){const e=a.executions.find((e:any)=>e.id===src.executionId);const snap=e&&a.snapshots.find((x:any)=>x.id===e.taskSnapshotId);const task=snap&&a.tasks.find((x:any)=>x.id===snap.taskId);if(!e||src.accountId!==a.scope.accountId||src.appId!==s.appId||src.activityId!==s.activityId||src.runId!==e.runId||src.resultFile!==e.resultFile||!x.taskDefinitionIds.includes(task?.taskDefinitionId))throw Error('Experience source mismatch');}
 }
 for(const e of a.executions){if(e.usedExperienceVersionId!==null&&!maps.experienceVersions.has(e.usedExperienceVersionId))throw Error('Missing used experience');for(const id of e.derivedExperienceVersionIds??[]){const x=maps.experienceVersions.get(id);if(!x?.sources.some((src:any)=>src.executionId===e.id))throw Error('Derived experience mismatch');}}
 // Reuse original account graph constraints without account-owned knowledge objects.
 validateTaskRecords({...a,schemaVersion:1,app:k.application,experiences:[],scripts:[]});
}
