import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import Database from 'better-sqlite3';
import {validateSplitTaskRecords} from '../runner/task-records-v2.ts';

const project = path.resolve(import.meta.dirname, '..');
const load = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));
function fixture(t: any) {
  const scratch = path.join(os.homedir(), '.hermes/cache/scratch');
  fs.mkdirSync(scratch, {recursive:true});
  const root = fs.realpathSync(fs.mkdtempSync(path.join(scratch, 'staged-store-')));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.mkdirSync(path.join(root, 'data'), {recursive: true});
  const db = new Database(path.join(root, 'data/checkin.db'));
  const client = fs.readFileSync(path.join(project, 'runner/storage/client.ts'), 'utf8');
  db.exec(client.split('const DDL = `')[1].split('`;')[0]);
  db.prepare('INSERT INTO account(id,app,package,user_id,cache_id) VALUES(?,?,?,?,?)').run('mock-account','mock-app','test.mock',10,'mock');
  db.prepare('INSERT INTO activity(id,account_id,name,steps_json,verify_any,asset_id) VALUES(?,?,?,?,?,?)').run('mock-activity','mock-account','Mock','[]','[]','mock-coins');
  db.close();
  const scope = {appId:'mock-app', accountId:'mock-account', activityId:'mock-activity'};
  const ks = {appId:scope.appId,activityId:scope.activityId};
  const knowledge = {schemaVersion:2,scope:ks,application:{id:scope.appId,package:'test.mock'},activity:{id:scope.activityId,appId:scope.appId,assetId:'mock-coins'},taskDefinitions:[],scriptVersions:[],experienceVersions:[]};
  const accountData = {schemaVersion:2,scope,account:{id:scope.accountId,appId:scope.appId,userId:10},activity:{id:scope.activityId,accountId:scope.accountId,activityDefinitionId:scope.activityId,assetId:'mock-coins'},tasks:[],inventories:[],snapshots:[],plans:[],executions:[],progress:[]};
  const manifest = {schemaVersion:2,knowledgeBundle:'data/task-knowledge/mock-app/mock-activity/bundle.json',accountBundle:'data/account-task-data/mock-app/mock-account/mock-activity/bundle.json',knowledgeRecords:{taskDefinitions:[],scriptVersions:[],experienceVersions:[]},accountRecords:{tasks:[],inventories:[],snapshots:[],plans:[],executions:[],progress:[]}};
  for (const [file,value] of [[manifest.knowledgeBundle,knowledge],[manifest.accountBundle,accountData],['data/task-records-v2/index.json',manifest]] as const) {
    const f=path.join(root,file); fs.mkdirSync(path.dirname(f),{recursive:true}); fs.writeFileSync(f,JSON.stringify(value));
  }
  const evidenceDir = path.join(root,'evidence/mock-session'); fs.mkdirSync(evidenceDir,{recursive:true});
  fs.writeFileSync(path.join(evidenceDir,'before.png'),'mock image bytes unchanged');
  fs.writeFileSync(path.join(evidenceDir,'before.json'),JSON.stringify({pages:[]}));
  fs.writeFileSync(path.join(evidenceDir,'receipt.png'),'mock receipt bytes');
  const input: any = {root,session:{id:'mock-session',evidenceDir,scope:{...scope,userId:10},startedAt:'2026-11-01T18:00:00.000Z'},result:{status:'completed' as const,task:{name:'Mock browse',instruction:'Browse for a round',done:0,total:1,displayRewardCoins:5,button:'Go',beforeFrame:{path:path.join(evidenceDir,'before.png'),ocrPath:path.join(evidenceDir,'before.json')},afterDone:1,afterTotal:1},balanceBefore:100,balanceAfter:105,taskAttemptId:'attempt-1',receipt:{frameId:'receipt',path:path.join(evidenceDir,'receipt.png'),quote:'Completed',taskAttemptId:'attempt-1'}},stages:[{stage:'task',status:'completed'},{stage:'return_list',status:'completed'},{stage:'settle',status:'completed'}],reviews:[] as any[]};
  return {root,input,manifest,open:()=>new Database(path.join(root,'data/checkin.db'))};
}
const save = async (input: any) => (await import('../runner/staged/store.ts')).saveStagedResult(input);
test('existing exact task definition retains historical identity basis when a new session reuses it',async t=>{
 const f=fixture(t);await save(f.input);
 const file=path.join(f.root,f.manifest.knowledgeBundle),k=load(file);k.taskDefinitions[0].identityBasis='observed name and requirement; uncertain continuity';
 fs.writeFileSync(file,JSON.stringify(k));const idx=load(path.join(f.root,'data/task-records-v2/index.json'));fs.writeFileSync(path.join(f.root,idx.knowledgeRecords.taskDefinitions[0]),JSON.stringify(k.taskDefinitions[0],null,2)+'\n');
 const dir=path.join(f.root,'evidence/next');fs.mkdirSync(dir);f.input.session={...f.input.session,id:'next',evidenceDir:dir};f.input.result={...f.input.result,status:'unknown',receipt:undefined,taskAttemptId:'next',balanceAfter:null};
 assert.equal((await save(f.input)).v2Archived,true);assert.equal(load(file).taskDefinitions[0].identityBasis,'observed name and requirement; uncertain continuity');
});

test('reported incidental receipt without explicit attribution cannot silently credit the whole delta',async t=>{
 const f=fixture(t);f.input.result.balanceAfter=210;
 f.input.stages.find((s:any)=>s.stage==='settle').review={incidentalReceipt:{frameId:'incidental',quote:'签到成功 获得100淘金币'}};
 const saved=await save(f.input),db=f.open();t.after(()=>db.close());
 assert.equal(saved.gainCoins,null);assert.equal((db.prepare('SELECT count(*) n FROM gain_event').get()as any).n,0);
});

test('mixed automatic sign-in and selected reward never books the entire balance delta',async t=>{
 const f=fixture(t);f.input.result.balanceAfter=210;
 f.input.result.rewardAttribution={version:'separate-rewards-v1',selectedRewardCoins:10,incidentalRewards:[{kind:'daily-sign-in',coins:100,receipt:{frameId:'incidental',path:f.input.result.receipt.path,quote:'签到成功 获得100淘金币',taskAttemptId:'attempt-1'}}]};
 const saved=await save(f.input),db=f.open();t.after(()=>db.close());
 assert.equal(saved.gainCoins,10);assert.equal((db.prepare('SELECT sum(units) n FROM gain_event').get()as any).n,10);
 assert.equal((db.prepare('SELECT balance_after FROM run').get()as any).balance_after,210);
});

for(const [label,change] of Object.entries({
 'unresolved selected amount':(x:any)=>x.rewardAttribution.selectedRewardCoins=null,
 'missing selected receipt':(x:any)=>x.receipt=undefined,
 'unexplained additional coins':(x:any)=>x.balanceAfter=211,
 'another attempt incidental receipt':(x:any)=>x.rewardAttribution.incidentalRewards[0].receipt.taskAttemptId='other-attempt',
 'reused selected receipt frame':(x:any)=>x.rewardAttribution.incidentalRewards[0].receipt.frameId='receipt',
 'missing incidental screenshot':(x:any)=>x.rewardAttribution.incidentalRewards[0].receipt.path=x.receipt.path.replace('receipt.png','missing.png'),
}))test('mixed rewards refuse credit: '+label,async t=>{
 const f=fixture(t);Object.assign(f.input.result,{balanceAfter:210,rewardAttribution:{version:'separate-rewards-v1',selectedRewardCoins:10,incidentalRewards:[{kind:'daily-sign-in',coins:100,receipt:{frameId:'incidental',path:f.input.result.receipt.path,quote:'签到成功 获得100淘金币',taskAttemptId:'attempt-1'}}]}});change(f.input.result);
 const saved=await save(f.input),db=f.open();t.after(()=>db.close());assert.equal(saved.gainCoins,null);assert.equal((db.prepare('SELECT count(*) n FROM gain_event').get()as any).n,0);
});

test('completed session persists diagnostic ledger, immutable evidence and valid v2 graph', async t => {
  const f=fixture(t), saved=await save(f.input), db=f.open(); t.after(()=>db.close());
  assert.equal(saved.runId,1); assert.equal(saved.gainCoins,5); assert.equal(saved.v2Archived,true);
  const run:any=db.prepare('SELECT * FROM run').get();
  assert.equal(run.status,'DIAGNOSTIC'); assert.equal(run.day,'2026-11-02');
  assert.equal(run.prompt_tokens,null); assert.equal(run.model_calls,null);
  assert.equal((db.prepare('SELECT sum(units) n FROM gain_event').get() as any).n,5);
  assert.equal((db.prepare('SELECT count(*) n FROM asset_snapshot').get() as any).n,2);
  const backupFile=path.join(f.root,'.backups',fs.readdirSync(path.join(f.root,'.backups'))[0]);
  const backupDb=new Database(backupFile,{readonly:true});
  try {assert.equal((backupDb.prepare('SELECT count(*) n FROM run').get() as any).n,0);} finally {backupDb.close();}
  for(const name of ['result.json','stages.json','reviews.json']) assert.ok(fs.existsSync(path.join(f.input.session.evidenceDir,name)));
  assert.equal(fs.readFileSync(path.join(f.input.session.evidenceDir,'before.png'),'utf8'),'mock image bytes unchanged');
  const index=load(path.join(f.root,'data/task-records-v2/index.json'));
  const k=load(path.join(f.root,index.knowledgeBundle)),a=load(path.join(f.root,index.accountBundle));
  validateSplitTaskRecords({schemaVersion:2,knowledge:k,accountData:a});
  assert.equal(a.executions.length,1); assert.equal(a.inventories[0].complete,false); assert.equal(k.experienceVersions.length,0);
  assert.equal(a.executions[0].result.gainCoins,5); assert.equal(path.isAbsolute(a.executions[0].evidenceDir),false);
  const check=execFileSync(process.execPath,[path.join(project,'node_modules/tsx/dist/cli.mjs'),path.join(project,'tools/validate-task-records-v2.ts')],{cwd:f.root,encoding:'utf8'});
  assert.equal(JSON.parse(check).valid,true);
});

test('reviews create stage scoped candidates with immutable script/config and source session', async t => {
  const f=fixture(t);
  const script=path.join(f.root,'mock-stage.ts'); fs.writeFileSync(script,'export const mock = true;\n');
  f.input.reviews.push({stage:'return_list',scope:{appId:'mock-app',activityId:'mock-activity'},summary:'Confirm list after return',candidateScript:{path:'mock-stage.ts'},candidateConfig:{requireText:['Mock task']}});
  const saved=await save({...f.input,scriptFiles:[script]});
  const idx=load(path.join(f.root,saved.stageIndexFile)); assert.equal(idx.candidates.length,1);
  const candidate=load(path.join(f.root,idx.candidates[0].path));
  assert.deepEqual(candidate.scope,{appId:'mock-app',activityId:'mock-activity',stage:'return_list'});
  assert.equal(candidate.validation,'candidate'); assert.equal(candidate.crossAccountValidated,false);
  assert.equal(candidate.sources[0].runId,1); assert.equal(candidate.sources[0].sessionId,'mock-session');
  assert.equal(candidate.candidateScript.fileSha256.length,64);
  assert.equal(fs.readFileSync(path.join(f.root,candidate.candidateScript.path),'utf8'),'export const mock = true;\n');
  assert.deepEqual(load(path.join(f.root,candidate.candidateConfig.path)),{requireText:['Mock task']});
  assert.equal(candidate.balanceBefore,undefined);
});

test('engine stageId records and reviews retain exact stage scope', async t => {
  const f=fixture(t);
  const input:any={...f.input,stages:f.input.stages.map(({stage,...s}:any)=>({...s,stageId:stage})),reviews:[{stageId:'open_app',scope:{appId:'mock-app'},summary:'Check foreground'}]};
  const saved=await save(input); assert.equal(saved.gainCoins,5);
  const idx=load(path.join(f.root,saved.stageIndexFile)); assert.equal(idx.candidates.length,1);
  assert.deepEqual(idx.candidates[0].scope,{appId:'mock-app',stage:'open_app'});
});

for (const [name,mutate] of Object.entries({
  'wrong attempt receipt':(x:any): any =>x.result.receipt.taskAttemptId='other',
  'missing receipt':(x:any): any =>delete x.result.receipt,
  'reverse quota':(x:any): any =>{x.result.task.done=1;x.result.task.total=2;x.result.task.afterDone=0;x.result.task.afterTotal=2;},
  'changed quota':(x:any): any =>x.result.task.afterTotal=2,
  'unchanged quota':(x:any): any =>x.result.task.afterDone=0,
  'missing after total':(x:any): any =>delete x.result.task.afterTotal,
  'missing after done':(x:any): any =>delete x.result.task.afterDone,
  'missing return confirmation':(x:any): any =>x.stages=x.stages.filter((s:any)=>s.stage!=='return_list'),
  'missing settle confirmation':(x:any): any =>x.stages=x.stages.filter((s:any)=>s.stage!=='settle'),
  'unknown before balance':(x:any): any =>x.result.balanceBefore=null,
  'zero before balance':(x:any): any =>x.result.balanceBefore=0,
  'reverse balance':(x:any): any =>x.result.balanceAfter=90,
  'stopped attempt':(x:any): any =>x.result.status='stopped',
  'unknown attempt':(x:any): any =>x.result.status='unknown',
})) test(name+' never books income or asset snapshot',async t=>{
  const f=fixture(t); mutate(f.input); const saved=await save(f.input),db=f.open();t.after(()=>db.close());
  assert.equal(saved.gainCoins,null); assert.equal(saved.runId,1);
  assert.equal((db.prepare('SELECT count(*) n FROM gain_event').get() as any).n,0);
  assert.equal((db.prepare('SELECT count(*) n FROM asset_snapshot').get() as any).n,0);
  const row:any=db.prepare('SELECT * FROM run').get(); assert.equal(row.balance_after,f.input.result.balanceAfter);
  assert.equal(row.status,f.input.result.status==='stopped'?'STOPPED':'UNKNOWN');
  const index=load(path.join(f.root,'data/task-records-v2/index.json')),a=load(path.join(f.root,index.accountBundle));
  assert.equal(a.executions[0].result.gainCoins,null);
  const check=execFileSync(process.execPath,[path.join(project,'node_modules/tsx/dist/cli.mjs'),path.join(project,'tools/validate-task-records-v2.ts')],{cwd:f.root,encoding:'utf8'});
  assert.equal(JSON.parse(check).ledgerVerified,true);
});

test('matching receipt can establish completion when after quota is absent',async t=>{
  const f=fixture(t);delete (f.input.result.task as any).afterDone;delete (f.input.result.task as any).afterTotal;
  assert.equal((await save(f.input)).gainCoins,5);
});

test('repeat repairs missing files without duplicate run, snapshots or income',async t=>{
  const f=fixture(t),first=await save(f.input);
  const index=load(path.join(f.root,'data/task-records-v2/index.json'));
  fs.unlinkSync(path.join(f.input.session.evidenceDir,'reviews.json'));
  fs.unlinkSync(path.join(f.root,index.accountRecords.executions[0]));
  fs.unlinkSync(path.join(f.root,'data/stage-records/index.json'));
  assert.deepEqual(await save(f.input),first);
  assert.ok(fs.existsSync(path.join(f.root,index.accountRecords.executions[0])));
  assert.deepEqual(load(path.join(f.input.session.evidenceDir,'reviews.json')),[]);
  const db=f.open();t.after(()=>db.close());
  assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,1);
  assert.equal((db.prepare('SELECT count(*) n FROM gain_event').get() as any).n,1);
  assert.equal((db.prepare('SELECT count(*) n FROM asset_snapshot').get() as any).n,2);
});

test('immutable session conflicts reject changed input without duplicate ledger',async t=>{
  const f=fixture(t);await save(f.input);f.input.result.balanceAfter=106;
  await assert.rejects(save(f.input),/conflict/i);
  const db=f.open();t.after(()=>db.close()); assert.equal((db.prepare('SELECT sum(units) n FROM gain_event').get() as any).n,5);
});

test('existing immutable record conflict rolls back run and gain',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.input.session.evidenceDir,'stages.json'),'conflict');
  await assert.rejects(save(f.input),/immutable conflict/i);
  const db=f.open();t.after(()=>db.close());assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,0);
  assert.equal((db.prepare('SELECT count(*) n FROM gain_event').get() as any).n,0);
});

for (const [name,mutate] of Object.entries({
  account:(x:any): any =>x.session.scope.accountId='other',
  user:(x:any): any =>x.session.scope.userId=99,
  review:(x:any): any =>x.reviews=[{stage:'return_list',scope:{appId:'mock-app',activityId:'other'}}],
  knowledgeLeak:(x:any): any =>x.reviews=[{stage:'return_list',orderedSteps:[{balanceAfter:100}]}],
  escape:(x:any): any =>x.session.evidenceDir=path.join(x.root,'../escape'),
})) test('rejects '+name+' scope conflict before ledger writes',async t=>{
  const f=fixture(t);mutate(f.input);await assert.rejects(save(f.input),/scope|Operational|outside root/i);
  const db=f.open();t.after(()=>db.close());assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,0);
});

test('usage preserves actual call counts and unknown token fields',async t=>{
  const f=fixture(t),usage={modelCalls:3,promptTokens:null,totalTokens:null,modelName:'mock-model',callsByKind:{review:1,execution:2}};
  await save({...f.input,usage});const db=f.open();t.after(()=>db.close());const row:any=db.prepare('SELECT * FROM run').get();
  assert.equal(row.model_calls,3);assert.equal(row.prompt_tokens,null);assert.equal(row.total_tokens,null);assert.deepEqual(JSON.parse(row.usage_json),usage);
});

test('missing v2 index reports partial and a retry can complete archive',async t=>{
  const f=fixture(t),file=path.join(f.root,'data/task-records-v2/index.json'),original=fs.readFileSync(file);fs.unlinkSync(file);
  const first=await save(f.input);assert.equal(first.partial,true);assert.equal(first.v2Archived,false);
  fs.writeFileSync(file,original);const repaired=await save(f.input);assert.equal(repaired.v2Archived,true);assert.equal(repaired.partial,false);assert.equal(repaired.runId,first.runId);
});

test('usage arrays aggregate measured calls but preserve unknown token totals',async t=>{
  const f=fixture(t),usage=[{calls:1,tokens:10,promptTokens:7,completionTokens:3},{calls:1,tokens:null,promptTokens:null,completionTokens:null}];
  await save({...f.input,usage}); const db=f.open();t.after(()=>db.close());const row:any=db.prepare('SELECT * FROM run').get();
  assert.equal(row.model_calls,2);assert.equal(row.total_tokens,null);assert.equal(row.prompt_tokens,null);assert.deepEqual(JSON.parse(row.usage_json),usage);
});

test('archive preflight preserves prior immutable files after tampering',async t=>{
  const f=fixture(t);await save(f.input);const idx=load(path.join(f.root,'data/task-records-v2/index.json'));
  fs.writeFileSync(path.join(f.root,idx.accountRecords.executions[0]),'tampered');
  await assert.rejects(save(f.input),/immutable conflict/i);
  assert.equal(fs.readFileSync(path.join(f.root,idx.accountRecords.executions[0]),'utf8'),'tampered');
});

test('no task and no attempt still preserves the session with null runId',async t=>{
  const f=fixture(t),x:any={...f.input,result:{status:'stopped',balanceBefore:null,balanceAfter:null},stages:[]};
  const saved=await save(x);assert.equal(saved.runId,null);assert.equal(saved.gainCoins,null);assert.equal(saved.v2Archived,false);
  assert.equal(load(path.join(f.root,saved.resultFile)).runId,null);
});

test('session review envelopes preserve learned procedure and proposed script config',async t=>{
  const f=fixture(t);f.input.reviews=[{stageId:'enter_activity',review:{summary:'Observe entry button',orderedSteps:['Read activity title'],candidateConfig:{text:'Entry'}}}];
  const saved=await save(f.input),idx=load(path.join(f.root,saved.stageIndexFile));
  const c=load(path.join(f.root,idx.candidates[0].path));assert.equal(c.summary,'Observe entry button');assert.deepEqual(c.orderedSteps,['Read activity title']);
  assert.ok(c.candidateConfig.path);
});

test('stage records with conflicting account scope cannot authorize gain',async t=>{
  const f=fixture(t);f.input.stages[1].scope={...f.input.session.scope,accountId:'other'};
  await assert.rejects(save(f.input),/scope/i);
  const db=f.open();t.after(()=>db.close());assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,0);
});

test('successive sessions append records and retries keep both sessions',async t=>{
  const f=fixture(t);await save(f.input);const second=structuredClone(f.input);second.session.id='mock-session-2';
  second.session.evidenceDir=path.join(f.root,'evidence/mock-session-2');second.result.taskAttemptId='attempt-2';second.result.receipt.taskAttemptId='attempt-2';fs.mkdirSync(second.session.evidenceDir,{recursive:true});
  assert.equal((await save(second)).runId,2);await save(f.input);
  const index=load(path.join(f.root,'data/task-records-v2/index.json')),a=load(path.join(f.root,index.accountBundle));
  assert.equal(a.executions.length,2);assert.equal(a.tasks.length,1);
  assert.equal(load(path.join(f.root,'data/stage-records/index.json')).sessions.length,2);
  assert.equal(JSON.parse(execFileSync(process.execPath,[path.join(project,'node_modules/tsx/dist/cli.mjs'),path.join(project,'tools/validate-task-records-v2.ts')],{cwd:f.root,encoding:'utf8'})).valid,true);
});

test('same receipt attempt cannot be credited again under a new session',async t=>{
 const f=fixture(t);await save(f.input);const second=structuredClone(f.input);second.session.id='copied-receipt';second.session.evidenceDir=path.join(f.root,'evidence/copied-receipt');fs.mkdirSync(second.session.evidenceDir,{recursive:true});
 await assert.rejects(save(second),/already credited/);
 const db=f.open();t.after(()=>db.close());assert.equal((db.prepare('select sum(units) n from gain_event').get()as any).n,5);
});test('session id and evidence directory each have unique immutable ownership',async t=>{
  const f=fixture(t);await save(f.input);
  await assert.rejects(save({...f.input,session:{...f.input.session,id:'different'}}),/conflict/i);
  await assert.rejects(save({...f.input,session:{...f.input.session,evidenceDir:path.join(f.root,'evidence/different')}}),/conflict/i);
});
