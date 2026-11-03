import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';
import {readRoundState,writeRoundState} from '../runner/staged/round-state.ts';

const scope={appId:'tb',accountId:'fixture',activityId:'coins',userId:0};
const sha=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
function fixture(t:any){
 const previous=process.cwd(),root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'staged-storage-')));
 process.chdir(root);const store=new Storage(root);store.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'{}');
 t.after(()=>{store.close();process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});});return {root,store};
}
function raw(root:string,key:string,value:any){const file=path.join(root,key);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');return file;}

test('round-state helpers resume SQLite reservations and cannot reopen unknown input',t=>{
 const {root,store}=fixture(t),key='data/evidence/round/state.json';
 const old={batchId:'batch',scope,attempts:[]},file=raw(root,key,old);
 const state={...old,attempts:[{reservationId:'reservation',identity:'task',name:'task',instruction:'browse',status:'unknown'}]};
 store.putRoundState(key,state);store.putDocument(key,old);
 assert.deepEqual(readRoundState(file,'batch',scope),state);
 assert.throws(()=>readRoundState(file,'other',scope),/mismatch/);
 assert.throws(()=>writeRoundState(file,old),/discard/);
 assert.throws(()=>writeRoundState(file,{...state,attempts:[{...state.attempts[0],status:'pending'}]}),/Unknown/);
 const next={...state,note:'persisted'};writeRoundState(file,next);
 assert.deepEqual(store.getRoundState(key),next);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),old);
 fs.unlinkSync(file);assert.deepEqual(readRoundState(file,'batch',scope),next);
 store.sqlite.prepare('DELETE FROM round_state WHERE key=?').run(key);
 raw(root,key,old);assert.equal(readRoundState(file,'batch',scope),null);
});

function nextOptions(root:string){
 const evidenceDir=path.join(root,'data/evidence/search');let captures=0,queries=0,inputs=0;
 const options:any={sessionId:'session',taskAttemptId:'attempt',scope,evidenceDir,cfg:{package:'fixture.app',learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},aiTaskRecovery:true,aiPanelReader:true,scriptValidationMode:false},
 device:{capture:async()=>{captures++;const bytes=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);bytes.writeUInt32BE(13,8);bytes.write('IHDR',12);bytes.writeUInt32BE(100,16);bytes.writeUInt32BE(200,20);const file=path.join(evidenceDir,'frame.png');fs.writeFileSync(file,bytes);return {id:'frame',path:file,width:100,height:200,capturedAt:Date.now(),package:'fixture.app',userId:0};},act:async()=>{inputs++;throw Error('fixture unknown transport');}},
 model:{query:async(r:any)=>{queries++;return {frameId:r.frame.id,state:{isList:true,blocked:false,top:true,bottom:false,balance:100,viewportKey:'task'},decision:'scroll',task:null,plan:null,nextAction:{type:'swipe',fromX:40,fromY:150,toX:40,toY:50,ms:600},reason:'continue'};}}};
 return {options,get captures(){return captures;},get queries(){return queries;},get inputs(){return inputs;}};
}
test('next-decision resumes unresolved SQLite inputs without capture or replay',async t=>{
 const {root,store}=fixture(t),h=nextOptions(root),key='data/evidence/search/next-decision-'+sha('session:attempt')+'.inputs.json';
 const binding={sessionId:'session',taskAttemptId:'attempt',scope};raw(root,key,{...binding,actions:[]});store.putDocument(key,{...binding,actions:[{status:'unknown'}]});
 const {findNextTask}=await import('../runner/staged/next-decision.ts');const result=await findNextTask(h.options);
 assert.equal(result.decision,'stop');assert.equal(result.inputUnknown,true);assert.match(result.error!,/prior search input/);
 assert.equal(h.captures,0);assert.equal(h.queries,0);assert.equal(h.inputs,0);
});
test('next-decision persists unknown input in SQLite and archives query evidence as raw files',async t=>{
 const {root,store}=fixture(t),h=nextOptions(root),key='data/evidence/search/next-decision-'+sha('session:attempt')+'.inputs.json';
 const {findNextTask}=await import('../runner/staged/next-decision.ts');const first=await findNextTask(h.options);
 assert.equal(first.inputUnknown,true);assert.equal(store.getDocument<any>(key).actions[0].status,'unknown');assert.equal(fs.existsSync(path.join(root,key)),false);
 const files=fs.readdirSync(h.options.evidenceDir);assert.ok(files.some(f=>f.endsWith('.request.json')));assert.ok(files.some(f=>f.endsWith('.response.json')));
 const second=await findNextTask(h.options);assert.equal(second.inputUnknown,true);assert.match(second.error!,/prior search input/);assert.equal(h.inputs,1);assert.equal(h.queries,1);assert.equal(h.captures,1);
});
test('next-decision selection hash binds raw archived bytes under migrated data',async t=>{
 const {root,store}=fixture(t),h=nextOptions(root);
 h.options.model.query=async(r:any)=>({frameId:r.frame.id,state:{isList:true,blocked:false,top:true,bottom:false,balance:100,viewportKey:'task'},decision:'select',task:{name:'task',instruction:'browse',done:0,total:1,category:'ordinary-in-app',actionType:'browse',button:'go'},plan:{steps:['observe'],stopConditions:['unknown input']},nextAction:{type:'tap',x:50,y:100,bounds:[40,90,60,110]},reason:'first eligible'});
 const {findNextTask}=await import('../runner/staged/next-decision.ts');const result=await findNextTask(h.options);
 assert.equal(result.decision,'task',result.error??'selection failed');const evidence=result.selection!.evidence;
 assert.equal(evidence.sha256,sha(fs.readFileSync(evidence.path)));assert.equal(store.getDocument(path.relative(root,evidence.path)),null);
});

test('dwell contract enumerates SQLite sessions but hashes original archived bytes',async t=>{
 const {root,store}=fixture(t),project=new URL('../',import.meta.url).pathname,prefix='data/stage-records/accounts/taobao/tb_main/tb_coin/sessions/';
 const sourceFile=fs.readdirSync(path.join(project,prefix)).find(f=>JSON.parse(fs.readFileSync(path.join(project,prefix,f),'utf8')).runId===162)!;
 const session=JSON.parse(fs.readFileSync(path.join(project,prefix,sourceFile),'utf8')),sourceDir=path.resolve(project,session.evidenceDir),targetDir=path.join(root,'evidence/source');
 fs.mkdirSync(targetDir,{recursive:true});
 const relocate=(value:any):any=>typeof value==='string'?value.replaceAll(sourceDir,targetDir):Array.isArray(value)?value.map(relocate):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v)])):value;
 // Only copy this run's archived artifacts into scratch; originals stay read-only.
 for(const f of fs.readdirSync(sourceDir)){const src=path.join(sourceDir,f);if(!fs.statSync(src).isFile())continue;if(f.endsWith('.json'))raw(root,'evidence/source/'+f,relocate(JSON.parse(fs.readFileSync(src,'utf8'))));else fs.copyFileSync(src,path.join(targetDir,f));}
 const key=prefix+'source.json',archived={...session,evidenceDir:'evidence/source'},current={...archived,mutableNote:'SQLite current'},file=raw(root,key,archived);
 store.putDocument(key,current);raw(root,prefix+'stale-only.json',{...current,runId:162});
 const {buildDwellContract}=await import('../runner/staged/dwell-browse.ts');const contract=await buildDwellContract(root,162);
 assert.equal(contract.source.sessionSha256,sha(fs.readFileSync(file)));assert.equal(contract.source.sessionPath,file);
 assert.notEqual(contract.source.sessionSha256,sha(JSON.stringify(current)));assert.equal(contract.source.resultSha256,sha(fs.readFileSync(path.join(targetDir,'result.json'))));
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(key);
 await assert.rejects(buildDwellContract(root,162),/Missing or ambiguous source session/);
});

test('script audit reads mutable graph documents from SQLite without legacy JSON fallback',async t=>{
 const {root,store}=fixture(t),index='data/task-records-v2/index.json';
 raw(root,index,{accountBundle:'missing-stale-account.json'});
 store.putDocument(index,{accountBundle:'data/account.json',knowledgeBundle:'data/knowledge.json'});
 store.putDocument('data/account.json',{schemaVersion:2,scope:{appId:'tb',accountId:'fixture',activityId:'coins'},account:{userId:0},tasks:[],snapshots:[],executions:[]});
 store.putDocument('data/knowledge.json',{application:{package:'fixture.app'}});store.putDocument('data/stage-records/index.json',{sessions:[],candidates:[]});
 const {auditStableScripts}=await import('../runner/staged/script-validation.ts');const audit=await auditStableScripts({root});
 assert.deepEqual(audit.scope,scope);assert.equal(audit.candidateCount,0);assert.equal(audit.stableCount,0);
 store.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run(index);
 await assert.rejects(auditStableScripts({root}),/Structured document missing in SQLite/);
});

test('script audit keeps source code and archived config byte hashes on raw files',async t=>{
 const {root,store}=fixture(t),task={id:'t',name:'task',instruction:'browse',scope},cfg={scope,package:'fixture.app'},dir='evidence/run';
 const result={runId:1,status:'completed',sessionId:'session',taskAttemptId:'attempt',task,gainCoins:5,balanceBefore:100,balanceAfter:105};
 store.putDocument('data/task-records-v2/index.json',{accountBundle:'data/account.json',knowledgeBundle:'data/knowledge.json'});
 store.putDocument('data/account.json',{schemaVersion:2,scope,account:{userId:0},tasks:[task],snapshots:[{id:'snapshot',taskId:'t',scope}],executions:[{runId:1,scope,taskSnapshotId:'snapshot',evidenceDir:dir,result}]});
 store.putDocument('data/knowledge.json',{application:{package:'fixture.app'}});
 for(const [name,value] of Object.entries({'session.json':{id:'session',scope,evidenceDir:dir,startedAt:'2026-11-01T00:00:00.000Z',configFile:'config.json'},'config.json':cfg,'result.json':result,'final.json':result,'stages.json':[],'usage.json':[],'cleanup.json':{},'session-state.json':{}}))raw(root,dir+'/'+name,value);
 raw(root,'config.json',cfg);const code='// original code bytes\n';const original='runner/staged/main.ts';fs.mkdirSync(path.join(root,'runner/staged'),{recursive:true});fs.writeFileSync(path.join(root,original),code);
 const sources=[{original,bytes:code,ext:'.ts'},{original:'config.json',bytes:fs.readFileSync(path.join(root,'config.json'),'utf8'),ext:'.json'}];
 const candidates:any[]=[],reviews:any[]=[];
 for(const [i,source] of sources.entries()){
  const hash=sha(source.bytes),archive='data/stage-records/script-sources/'+hash+source.ext;fs.mkdirSync(path.dirname(path.join(root,archive)),{recursive:true});fs.writeFileSync(path.join(root,archive),source.bytes);
  store.putDocument(archive,{wrong:'SQLite serialization is not archived source bytes'});store.putDocument(source.original,{wrong:'SQLite serialization is not code bytes'});
  const key='data/stage-records/candidates/source-'+i+'.json';store.putDocument(key,{scope,candidateScript:{originalPath:source.original,path:archive,fileSha256:hash},sources:[{sessionId:'session',runId:1,evidenceDir:dir,reviewFile:dir+'/reviews.json',reviewIndex:i}]});
  candidates.push({path:key,sessionId:'session',runId:1});reviews.push({candidateScript:{path:source.original}});
 }
 raw(root,dir+'/reviews.json',reviews);fs.writeFileSync(path.join(root,dir,'runtime.jsonl'),'');store.putDocument('data/stage-records/index.json',{candidates});
 const {auditStableScripts}=await import('../runner/staged/script-validation.ts'),audit=await auditStableScripts({root}),attempt=audit.tasks[0].attempts[0];
 assert.ok(attempt.scriptSources.some(s=>s.originalPath===original));
 assert.deepEqual(attempt.blockers.filter(b=>['script_source_invalid','config_archive_missing'].includes(b.code)),[]);
});
