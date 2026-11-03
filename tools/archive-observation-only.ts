import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validateSplitTaskRecords} from '../runner/task-records-v2.ts';
import {assertLegacyWriterAllowed} from '../runner/storage/structured.ts';
assertLegacyWriterAllowed();
const rf=process.argv[2];if(!rf)throw Error('Result file required');
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const r=read(rf);if(r.status!=='stopped_before_entry'||r.entryActions!==0||r.runId!==null)throw Error('Observation-only result required');
const mf='data/task-records-v2/index.json',m=read(mf),k=read(m.knowledgeBundle),a=read(m.accountBundle);
const id=(kind:string,...p:unknown[])=>kind+'_'+crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex');
const put=(rows:any[],row:any)=>{const old=rows.find(x=>x.id===row.id);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('Conflicting record');if(!old)rows.push(row);};
const plans:string[]=[];
for(const obs of r.observations){
 const pg=read(obs.source).pages[0];const text=(obs.name+`(${obs.done}/${obs.total})`).normalize('NFKC');
 if(!pg.lines.some((l:any)=>l.text.normalize('NFKC')===text))throw Error('Missing observed row');
 const did=id('definition',k.scope,obs.name,obs.instruction),iid=id('inventory',a.scope,obs.source),tid=id('task',a.scope,obs.source,obs.name),sid=id('snapshot',a.scope,iid,tid),pid=id('plan',a.scope,rf,obs.source);
 put(k.taskDefinitions,{id:did,scope:k.scope,name:obs.name,instruction:obs.instruction,providerTaskId:null,identityBasis:'observed name and requirement; uncertain continuity across changing frames'});
 put(a.tasks,{id:tid,scope:a.scope,name:obs.name,instruction:obs.instruction,providerTaskId:null,occurrenceSource:iid,taskDefinitionId:did});
 put(a.snapshots,{id:sid,scope:a.scope,inventoryId:iid,taskId:tid,done:obs.done,total:obs.total,instruction:obs.instruction,displayRewardCoins:obs.displayRewardCoins,button:obs.button,evidence:obs.source.replace(/\.json$/,'.png'),ocrSource:obs.source,positionAuthority:false});
 put(a.inventories,{id:iid,scope:a.scope,complete:false,source:obs.source,taskSnapshotIds:[sid],note:'Only current target; task identity and quota changed before entry.'});
 put(a.plans,{id:pid,scope:a.scope,inventoryId:iid,revision:1,status:'stopped_before_entry',sourceResult:rf,decisions:[{taskId:tid,taskSnapshotId:sid,name:obs.name,decision:'pending',reason:r.reason,executionStatus:'not_started',maximumCompletions:1,procedure:['Refresh full current task context','Require observed permitted ordinary-browse path before single entry','Capture receipt and verify actual owning-panel balance','Stop on changed identity or unresolved action']}],executionOrder:[]});
 plans.push(pid);
}
const sp=r.scriptPath,bytes=fs.readFileSync(sp),sha=crypto.createHash('sha256').update(bytes).digest('hex'),vid=id('scriptversion',k.scope,sp,sha),dest=path.dirname(m.knowledgeBundle)+'/script-sources/'+vid+'.ts';
put(k.scriptVersions,{id:vid,scope:k.scope,path:dest,originalPath:sp,fileSha256:sha,mode:'interactive_probe',crossAccountValidated:false});
put(a.progress,{id:id('progress',a.scope,rf),scope:a.scope,planId:plans[plans.length-1],executionIds:[],requiresInventoryRefresh:true,status:'paused_before_entry_dynamic_task',sourceResult:rf,learned:r.learned,scriptVersionId:vid,nextTask:null,note:'Original 发现精选好物 remains unexecuted; no gain or execution inserted.'});
validateSplitTaskRecords({schemaVersion:2,knowledge:k,accountData:a});
const out=new Map<string,Buffer>();const add=(p:string,v:any)=>out.set(p,Buffer.from(JSON.stringify(v,null,2)+'\n'));
add(m.knowledgeBundle,k);add(m.accountBundle,a);out.set(dest,bytes);
for(const [part,key,base]of [[k,'knowledgeRecords',path.dirname(m.knowledgeBundle)],[a,'accountRecords',path.dirname(m.accountBundle)]]as any[]){for(const kind of Object.keys(m[key]))m[key][kind]=part[kind].map((row:any)=>{const f=base+'/'+kind+'/'+row.id+'.json';add(f,row);return f;});}add(mf,m);
const mutable=new Set([mf,m.knowledgeBundle,m.accountBundle]);for(const [f,b]of out)if(fs.existsSync(f)&&!mutable.has(f)&&!fs.readFileSync(f).equals(b))throw Error('Immutable conflict '+f);
for(const [f,b]of out){if(fs.existsSync(f)){const prev=fs.readFileSync(f);if(prev.equals(b))continue;const backup=path.join('.backups/observation-only-20261101-0125',f);fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,prev,{flag:'wx'});}fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp-'+process.pid;fs.writeFileSync(tmp,b,{flag:'wx'});fs.renameSync(tmp,f);}
console.log(JSON.stringify({archived:true,observations:r.observations.length,executionInserted:false,incomeInserted:false,resultFile:rf}));
