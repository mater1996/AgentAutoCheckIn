import {resolveDatabasePath} from '../runner/storage/index.ts';
import {readStructured} from '../runner/storage/structured.ts';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import Database from 'better-sqlite3';import {validateTaskRecords} from '../runner/task-records.ts';
const root=process.cwd();const base=path.resolve(process.argv[2]??'data/task-records/taobao/tb_main/tb_coin');
const read=(f:string)=>readStructured(root,f);
const b=read(path.join(base,'bundle.json')),index=read(path.join(base,'index.json'));validateTaskRecords(b);
if(JSON.stringify(index.scope)!==JSON.stringify(b.scope))throw Error('Index scope mismatch');
for(const kind of ['tasks','inventories','snapshots','plans','executions','experiences','scripts','progress']){
 const files=index.records[kind];if(!Array.isArray(files)||files.length!==b[kind].length)throw Error('Index count mismatch');
 for(let i=0;i<files.length;i++){
  const f=path.resolve(base,files[i]);if(!f.startsWith(base+path.sep))throw Error('Unsafe record path');
  if(JSON.stringify(read(f))!==JSON.stringify(b[kind][i]))throw Error('Record mismatch '+files[i]);
 }
}
const local=(rel:string)=>{const f=path.resolve(root,rel);if(!f.startsWith(root+path.sep)||!fs.existsSync(f))throw Error('Missing or unsafe evidence '+rel);return f;};
for(const inv of b.inventories)local(inv.source);
for(const snap of b.snapshots)if(snap.evidence)local(snap.evidence);
const db=new Database(resolveDatabasePath(root),{readonly:true});
try{
 const a:any=db.prepare('select app,package,user_id from account where id=?').get(b.scope.accountId);
 const act:any=db.prepare('select account_id,asset_id from activity where id=?').get(b.scope.activityId);
 if(a?.app!==b.scope.appId||a.package!==b.app.package||a.user_id!==b.account.userId||act?.account_id!==b.scope.accountId||act.asset_id!==b.activity.assetId)throw Error('Database ownership mismatch');
 for(const e of b.executions){
  const run:any=db.prepare('select * from run where id=?').get(e.runId);const r=read(local(e.resultFile));
  if(run?.account_id!==e.scope.accountId||run.activity_id!==e.scope.activityId||path.resolve(run.evidence_dir)!==local(e.evidenceDir))throw Error('Run ownership mismatch');
  if(r.runId!==e.runId||run.balance_before!==r.balanceBefore||run.balance_after!==r.balanceAfter||JSON.stringify(r)!==JSON.stringify(e.result))throw Error('Result/ledger mismatch');
  const gains:any=db.prepare('select sum(units) as units from gain_event where run_id=? and asset_id=?').get(e.runId,e.assetId);
  if(gains.units!==r.gainCoins)throw Error('Gain mismatch');
 }
 for(const s of b.scripts){const hash=crypto.createHash('sha256').update(fs.readFileSync(local(s.path))).digest('hex');if(hash!==s.fileSha256)throw Error('Script version changed; archive still references old version');}
 console.log(JSON.stringify({valid:true,scope:b.scope,tasks:b.tasks.length,completeInventories:b.inventories.filter((x:any)=>x.complete).length,partialInventories:b.inventories.filter((x:any)=>!x.complete).length,executions:b.executions.map((e:any)=>e.runId),experienceCount:b.experiences.length,filesAndLedgerVerified:true,scriptVersionsVerified:true,automaticRunnerIntegrated:b.migration.automaticRunnerIntegrated},null,2));
}finally{db.close();}
