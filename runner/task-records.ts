import {createHash} from 'node:crypto';
export type TaskScope={appId:string;accountId:string;activityId:string};
export function scopedId(kind:string,scope:TaskScope,identity:unknown[]):string{
 if(!kind||!scope||Object.values(scope).some(v=>typeof v!=='string'||!v.trim()))throw Error('Invalid scope');
 return kind+'_'+createHash('sha256').update(JSON.stringify([scope.appId,scope.accountId,scope.activityId,...identity])).digest('hex');
}
/** Offline ownership/relationship validator; does not dispatch actions or promote recipes. */
export function validateTaskRecords(b:any):void{
 if(b?.schemaVersion!==1)throw Error('Unsupported schema');
 const s=b.scope;
 const equal=(x:TaskScope)=>x?.appId===s?.appId&&x?.accountId===s?.accountId&&x?.activityId===s?.activityId;
 if(!s?.appId||!s.accountId||!s.activityId||b.app?.id!==s.appId||b.account?.id!==s.accountId||b.account.appId!==s.appId||b.activity?.id!==s.activityId||b.activity.accountId!==s.accountId)throw Error('Invalid scope chain');
 const maps:Record<string,Map<string,any>>={};const seen=new Set<string>();
 for(const key of ['tasks','inventories','snapshots','plans','executions','experiences','scripts','progress']){
  if(!Array.isArray(b[key]))throw Error('Missing '+key);maps[key]=new Map();
  for(const row of b[key]){
   if(!equal(row.scope))throw Error('Record scope mismatch');
   if(typeof row.id!=='string'||!row.id||seen.has(row.id))throw Error('Duplicate or missing id');
   seen.add(row.id);maps[key].set(row.id,row);
  }
 }
 const ref=(key:string,id:string)=>{const row=maps[key].get(id);if(!row)throw Error('Missing '+key+' reference');return row;};
 for(const t of b.tasks)if(!t.name?.trim()||typeof t.instruction!=='string')throw Error('Invalid task identity');
 for(const inv of b.inventories){
  if(typeof inv.complete!=='boolean'||!inv.source||!Array.isArray(inv.taskSnapshotIds)||new Set(inv.taskSnapshotIds).size!==inv.taskSnapshotIds.length)throw Error('Invalid inventory');
  for(const id of inv.taskSnapshotIds)if(ref('snapshots',id).inventoryId!==inv.id)throw Error('Inventory snapshot mismatch');
 }
 for(const snap of b.snapshots){
  ref('tasks',snap.taskId);const inv=ref('inventories',snap.inventoryId);
  if(!inv.taskSnapshotIds.includes(snap.id)||!Number.isInteger(snap.done)||!Number.isInteger(snap.total)||snap.done<0||snap.total<=0||snap.done>snap.total)throw Error('Invalid task snapshot');
 }
 for(const p of b.plans){
  const inv=ref('inventories',p.inventoryId);if(!Array.isArray(p.decisions)||p.decisions.length!==inv.taskSnapshotIds.length)throw Error('Incomplete plan decisions');
  const ids=new Set();for(const d of p.decisions){
   if(ids.has(d.taskSnapshotId)||!inv.taskSnapshotIds.includes(d.taskSnapshotId)||!['do','pending','skip'].includes(d.decision))throw Error('Invalid plan decision');ids.add(d.taskSnapshotId);
  }
 }
 const runIds=new Set();
 for(const e of b.executions){
  if(!Number.isSafeInteger(e.runId)||e.runId<1||runIds.has(e.runId))throw Error('Duplicate or invalid execution run');runIds.add(e.runId);
  const snap=ref('snapshots',e.taskSnapshotId),p=ref('plans',e.planId);
  if(!p.decisions.some((d:any)=>d.taskSnapshotId===e.decisionTaskSnapshotId&&d.decision==='do'))throw Error('Invalid execution decision');
  if(ref('snapshots',e.decisionTaskSnapshotId).taskId!==snap.taskId)throw Error('Execution task identity mismatch');
  if(e.assetId!==b.activity.assetId)throw Error('Execution asset mismatch');
  if(!e.evidenceDir||!e.resultFile||!e.status)throw Error('Missing execution evidence');
 }
 for(const x of b.experiences){
  if(!x.sourceExecutionIds?.length||!x.taskIds?.length)throw Error('Missing experience evidence');
  for(const id of x.taskIds)ref('tasks',id);
  for(const id of x.sourceExecutionIds){const e=ref('executions',id);if(!x.taskIds.includes(ref('snapshots',e.taskSnapshotId).taskId))throw Error('Experience task identity mismatch');}
  ref('scripts',x.scriptId);
 }
 for(const script of b.scripts)if(!script.path||!['interactive_probe','proposed','independently_validated'].includes(script.mode))throw Error('Invalid script');
 for(const p of b.progress){ref('plans',p.planId);for(const id of p.executionIds){if(ref('executions',id).planId!==p.planId)throw Error('Progress plan mismatch');}}
}
