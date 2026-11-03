import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {saveStagedResult} from '../runner/staged/store.ts';
import {runActivitySession} from '../runner/staged/session.ts';
import {sharedReviewKnowledge} from '../runner/staged/source-archive.ts';

const project=path.resolve(import.meta.dirname,'..');
const evidence=path.join(project,'evidence/staged-2026-11-01T18-01-26-451Z');
const load=(file:string)=>JSON.parse(fs.readFileSync(file,'utf8'));
const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(t:any){
 const scratch=path.join(os.homedir(),'.hermes/cache/scratch');fs.mkdirSync(scratch,{recursive:true});
 const root=fs.realpathSync(fs.mkdtempSync(path.join(scratch,'failed-archive-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 // Read actual captured input; the only relocation is the archive destination.
 const captured=load(path.join(evidence,'session-state.json'));
 const input={root,session:{...captured.session,evidenceDir:path.join(root,'evidence/replay')},result:captured.result,stages:captured.stages,reviews:captured.reviews};
 fs.mkdirSync(path.join(root,'data'),{recursive:true});
 const db=new Database(path.join(root,'data/checkin.db'));
 db.exec(fs.readFileSync(path.join(project,'runner/storage/client.ts'),'utf8').split('const DDL = `')[1].split('`;')[0]);
 const s=input.session.scope;
 db.prepare('INSERT INTO account(id,app,package,user_id,cache_id) VALUES(?,?,?,?,?)').run(s.accountId,s.appId,'com.taobao.taobao',s.userId,'offline');
 db.prepare('INSERT INTO activity(id,account_id,name,steps_json,verify_any,asset_id) VALUES(?,?,?,?,?,?)').run(s.activityId,s.accountId,'Offline','[]','[]','offline-coins');db.close();
 return {root,input,open:()=>new Database(path.join(root,'data/checkin.db'),{readonly:true})};
}
function noIncome(f:ReturnType<typeof fixture>){const db=f.open();try{
 for(const table of ['gain_event','asset_snapshot'])assert.equal((db.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n,0);
 }finally{db.close();}}

test('actual failed open_app archives raw evidence and error without sharing execution actions',async t=>{
 const originalFiles=fs.readdirSync(evidence,{recursive:true}).map(String).filter(p=>fs.statSync(path.join(evidence,p)).isFile());
 const hashes=originalFiles.map(p=>[p,sha(path.join(evidence,p))]);
 const f=fixture(t),before=structuredClone(f.input);
 assert.equal(f.input.reviews[0].review.candidateConfig.steps[0].action.userId,0);
 const saved=await saveStagedResult(f.input);
 assert.equal(saved.partial,false);assert.equal(saved.gainCoins,null);assert.equal(saved.v2Archived,false);
 assert.deepEqual(f.input,before);
 const result=load(path.join(f.root,saved.resultFile));
 assert.equal(result.status,'unknown');assert.equal(result.error,f.input.result.error);
 assert.equal(result.task,null);assert.equal(result.receipt,null);
 assert.deepEqual(load(path.join(f.input.session.evidenceDir,'stages.json')),f.input.stages);
 assert.deepEqual(load(path.join(f.input.session.evidenceDir,'reviews.json')),f.input.reviews);
 const index=load(path.join(f.root,saved.stageIndexFile));assert.equal(index.sessions.length,1);assert.equal(index.candidates.length,1);
 const session=load(path.join(f.root,index.sessions[0].path));assert.deepEqual(session.scope,f.input.session.scope);
 const candidate=load(path.join(f.root,index.candidates[0].path));
 assert.deepEqual(candidate.scope,{appId:'taobao',stage:'open_app'});
 assert.equal(candidate.validation,'candidate');assert.equal(candidate.crossAccountValidated,false);
 assert.deepEqual(candidate.orderedSteps,[]);
 const config=load(path.join(f.root,candidate.candidateConfig.path));
 assert.deepEqual(config,{...f.input.reviews[0].review.candidateConfig,steps:[]});
 const {sources,...body}=candidate;
 assert.doesNotMatch(JSON.stringify(body)+JSON.stringify(config),/"(?:userId|accountId|frameId|capturedAt|events|actions)"/);
 assert.equal(sources[0].reviewFile,path.join('evidence/replay','reviews.json'));assert.equal(sources[0].reviewIndex,0);
 assert.equal(sources[0].sessionId,f.input.session.id);
 const db=f.open();try{const row:any=db.prepare('SELECT * FROM run').get();assert.equal(row.status,'UNKNOWN');assert.equal(row.error,f.input.result.error);}finally{db.close();}
 noIncome(f);
 assert.deepEqual(await saveStagedResult(f.input),saved);
 assert.deepEqual(originalFiles.map(p=>[p,sha(path.join(evidence,p))]),hashes);
 assert.equal(fs.existsSync(path.join(evidence,'result.json')),false);
 assert.equal(fs.existsSync(path.join(evidence,'stages.json')),false);
});

test('all engine execution states stay session-only while learned procedure and config remain unchanged',()=>{
 const raw=load(path.join(evidence,'session-state.json')).reviews[0].review;
 const learned={kind:'wait',ms:1000,expected:'fresh owning frame'};
 for(const status of ['pending','verified','observed','rejected','unknown']){
  const step={...raw.orderedSteps[0],status};
  const review={...raw,orderedSteps:[learned,step],candidateConfig:{...raw.candidateConfig,steps:[step,learned]}};
  const original=structuredClone(review),shared=sharedReviewKnowledge(review);
  assert.deepEqual(shared.orderedSteps,[learned],status);
  assert.deepEqual(shared.candidateConfig,{...review.candidateConfig,steps:[learned]},status);
  assert.deepEqual(review,original);
 }
 const ordinary={summary:'Reusable observation',orderedSteps:['Read title',learned],candidateConfig:{requireText:['Entry'],steps:[learned]}};
 assert.deepEqual(sharedReviewKnowledge(ordinary),ordinary);
});

test('unrecognized runtime frame payload cannot become a shared config',async t=>{
 const f=fixture(t);f.input.reviews=[{stageId:'open_app',review:{candidateConfig:{frameId:'captured-frame',capturedAt:123}}}];
 await assert.rejects(saveStagedResult(f.input),/Operational data in shared candidate/);
 noIncome(f);const db=f.open();try{assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,0);}finally{db.close();}
});

test('review scope cannot silently discard an operational userId',async t=>{
 const f=fixture(t);f.input.reviews[0].scope={appId:'taobao',userId:99};
 await assert.rejects(saveStagedResult(f.input),/Review scope mismatch/);noIncome(f);
});

test('empty review envelopes keep the existing ignored-review behavior',async t=>{
 const f=fixture(t);f.input.reviews=[null,{},false];
 const saved=await saveStagedResult(f.input);assert.equal(saved.gainCoins,null);noIncome(f);
 assert.deepEqual(load(path.join(f.input.session.evidenceDir,'reviews.json')),f.input.reviews);
 assert.deepEqual(load(path.join(f.root,saved.stageIndexFile)).candidates,[]);
});

test('session save boundary keeps foreground failure and complete raw review',async t=>{
 const f=fixture(t),captured=structuredClone(f.input);let finalState:any;
 const result=await runActivitySession(f.input.session,{
  prepare:async()=>{},stage:async id=>{assert.equal(id,'open_app');return structuredClone(f.input.stages[0]);},
  save:async payload=>saveStagedResult({...payload,root:f.root}),
  cleanup:async()=>({errors:[]}),persist:state=>{finalState=structuredClone(state);}
 });
 assert.equal(result.status,'unknown');assert.equal(result.error,'Foreground missing or ambiguous');
 assert.equal(result.task,null);assert.equal(result.receipt,null);assert.deepEqual(result.stages,captured.stages);
 assert.deepEqual(finalState.reviews,captured.reviews);assert.equal(finalState.archived.partial,false);
 assert.equal(load(path.join(f.input.session.evidenceDir,'result.json')).error,result.error);noIncome(f);
});

for(const [name,change] of Object.entries({
 user:(x:any)=>x.session.scope.userId=99,
 account:(x:any)=>x.session.scope.accountId='another-account',
 stage:(x:any)=>x.stages[0].scope={accountId:'another-account'},
 review:(x:any)=>x.reviews[0].scope={appId:'another-app'},
 config:(x:any)=>x.reviews[0].review.candidateConfig.owner={userId:99},
 procedure:(x:any)=>x.reviews[0].review.orderedSteps.push({balanceAfter:999})
}))test('archive rejection preserves final error and books no gain: '+name,async t=>{
 const f=fixture(t),raw=structuredClone(f.input.stages[0]);let finalState:any;
 const result=await runActivitySession(f.input.session,{
  prepare:async()=>{},stage:async()=>raw,
  save:async payload=>{const input=structuredClone({...payload,root:f.root});change(input);return saveStagedResult(input);},
  cleanup:async()=>({errors:[]}),persist:state=>{finalState=structuredClone(state);}
 });
 assert.equal(result.status,'unknown');assert.match(result.error,/^Foreground missing or ambiguous; Archive failed: /);
 assert.equal(result.runId,null);assert.equal(finalState.archived,null);
 assert.deepEqual(finalState.stages,[raw]);assert.deepEqual(finalState.reviews,f.input.reviews);noIncome(f);
 assert.equal(fs.existsSync(path.join(f.input.session.evidenceDir,'result.json')),false);
 const db=f.open();try{assert.equal((db.prepare('SELECT count(*) n FROM run').get() as any).n,0);}finally{db.close();}
});
