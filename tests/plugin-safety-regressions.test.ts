import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {ActivityService} from '../runner/mcp/service.ts';
import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';

const decode=(r:any)=>JSON.parse(r.content[0].text);
function fixture(t:any,options:any={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR??'/Users/mater/.hermes/cache/scratch','plugin-safety-'));
 const serial=process.env.ADB_SERIAL;process.env.ADB_SERIAL='offline-safety-'+randomUUID();
 fs.mkdirSync(path.join(root,'data'),{recursive:true});new Database(path.join(root,'data/checkin.db')).close();
 fs.mkdirSync(path.join(root,'runner/staged'),{recursive:true});fs.writeFileSync(path.join(root,'runner/staged/fixture.ts'),'// offline fixture');
 const cfg=JSON.parse(fs.readFileSync('config/plugin/taobao-coin.json','utf8'));
 cfg.round.priorPlanFiles=[];delete cfg.round.stateFile;cfg.round.batchId='offline-safety';cfg.knowledgeIndex='data/index.json';
 const write=(ref:string,value:any)=>{const file=path.join(root,ref);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));};
 write('data/config.json',cfg);write('data/index.json',{knowledgeBundle:'data/knowledge.json'});write('data/knowledge.json',{});
 const stats={prepared:0,actions:[]as any[],home:0};
 const service=new ActivityService({root,allowDevice:true,deviceFactory:(dir)=>({
  prepare:async()=>{stats.prepared++;},cleanup:async()=>({errors:[]}),
  capture:async()=>{fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,randomUUID()+'.png'),b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(1080,16);b.writeUInt32BE(2400,20);fs.writeFileSync(file,b);return {id:randomUUID(),path:file,width:1080,height:2400,capturedAt:Date.now(),package:cfg.package,userId:cfg.scope.userId,lines:[],...options.frame};},
  act:async(a:any,_f:any,limits:any)=>{limits?.beforeInput?.();stats.actions.push(a);return options.actResult;},
  returnHome:async()=>{stats.home++;return options.homeResult??{confirmed:true,dispatchStatus:'dispatched'};},
 }),...options.service});
 t.after(async()=>{try{await service.close();}finally{if(serial===undefined)delete process.env.ADB_SERIAL;else process.env.ADB_SERIAL=serial;fs.rmSync(root,{recursive:true,force:true});}});
 return {root,cfg,service,stats,write,begin:()=>service.call('begin_execution',{configFile:'data/config.json',live:true})};
}

for(const target of [
 {name:'sensitive control',lines:[{text:'购买',bounds:[800,700,1000,800]}],error:/prohibited/},
 {name:'task entry without panel title',lines:[{text:'随便看看',bounds:[800,700,1000,800]}],error:/tap.*contract|execute-task/i},
 {name:'unlabelled task entry during exploration',lines:[],mode:'explore',error:/tap.*contract|execute-task/i},
])test('ordinary act rejects '+target.name+' before device dispatch',async t=>{
 const {service,stats,root}=fixture(t,{frame:{lines:target.lines}});
 await service.call('begin_execution',{configFile:'data/config.json',live:true,mode:target.mode??'run'});
 const frame=decode(await service.call('observe')).frame;
 await assert.rejects(()=>service.call('act',{frameId:frame.id,action:{type:'tap',purpose:target.mode==='explore'?'exploration':'ordinary-ui',x:900,y:750}}),target.error);
 assert.equal(stats.actions.length,0);
 const db=new Database(path.join(root,'data/checkin.db'),{readonly:true});try{assert.equal((db.prepare('SELECT count(*) AS n FROM plugin_action').get()as any).n,0);assert.equal((db.prepare('SELECT count(*) AS n FROM plugin_attempt').get()as any).n,0);}finally{db.close();}
});

for(const frame of [{package:'com.other.app'},{userId:999},{observationError:'owner observation failed'}])test('ordinary act rejects unverified configured owner '+JSON.stringify(frame),async t=>{
 const {service,stats,begin}=fixture(t,{frame});await begin();const observed=decode(await service.call('observe')).frame;
 await assert.rejects(()=>service.call('act',{frameId:observed.id,action:{type:'back'}}),/owner|observation/i);
 assert.equal(stats.actions.length,0);
});

test('ordinary back swipe and wait retain current-frame support',async t=>{
 const {service,stats,begin}=fixture(t);await begin();
 for(const action of [{type:'back'},{type:'swipe',fromX:500,fromY:1700,toX:500,toY:700,ms:300},{type:'wait',ms:1}]){
  const frame=decode(await service.call('observe')).frame;
  assert.equal(decode(await service.call('act',{frameId:frame.id,action})).status,'dispatched');
  await assert.rejects(()=>service.call('act',{frameId:frame.id,action}),/current observed frame/i);
 }
 assert.equal(stats.actions.length,3);
});

const item={name:'fixture task',instruction:'browse once'};
const identity=JSON.stringify([item.name,item.instruction]);
function retained(f:any,sql:any,saved?:any){
 const day=new Date(Date.now()+8*3600_000).toISOString().slice(0,10);
 f.cfg.round.priorPlanFiles=['data/plan.json'];f.write('data/plan.json',{day,items:[{...item,attemptRunId:42,attemptsThisBatch:1}]});
 if(saved){f.cfg.round.stateFile='data/state.json';f.write('data/state.json',{batchId:f.cfg.round.batchId,scope:f.cfg.scope,attempts:[],...saved});}
 f.write('data/config.json',f.cfg);
 const db=new Database(path.join(f.root,'data/checkin.db'));
 try{db.prepare('INSERT INTO plugin_attempt VALUES(?,?,?,?,?,?,?)').run(f.cfg.round.batchId,JSON.stringify(f.cfg.scope),identity,'durable-attempt','old-execution',sql.status??'consumed',sql.result?JSON.stringify(sql.result):null);}finally{db.close();}
}
for(const unsafe of [
 {status:'reserved'},
 {status:'unknown'},
 {result:{inputUnknown:true,returned:true,persistenceVerified:true}},
 {result:{blocked:true,returned:true,persistenceVerified:true}},
 {result:{returned:false,persistenceVerified:true}},
 {result:{returned:true,persistenceVerified:false}},
])test('legacy placeholder cannot shadow unsafe plugin attempt '+JSON.stringify(unsafe),async t=>{
 const f=fixture(t);retained(f,unsafe);
 await assert.rejects(f.begin,/unsafe retained attempt/i);assert.equal(f.stats.prepared,0);
});

test('plugin attempt supplies authoritative reservation result and status for duplicate legacy identity',async t=>{
 const f=fixture(t),result={status:'completed',roundId:'old-execution',returned:true,persistenceVerified:true,inputUnknown:false,blocked:false};
 retained(f,{status:'pending',result},{attempts:[{...item,identity,reservationId:'old-state',status:'consumed',evidenceKey:'old-state'}]});
 await f.begin();const attempts=decode(await f.service.call('get_run_state')).attempts;
 assert.equal(attempts.length,1);assert.equal(attempts[0].reservationId,'durable-attempt');assert.equal(attempts[0].status,'pending');assert.deepEqual(attempts[0].result,result);
});
for(const saved of [
 {inputUnknown:true},
 {blocked:true},
 {attempts:[{...item,identity,reservationId:'retained-unsafe',status:'reserved'}]},
 ...[{inputUnknown:true},{blocked:true},{returned:false},{persistenceVerified:false}].map(unsafe=>({attempts:[{...item,identity,reservationId:'retained-unsafe',status:'consumed',result:{returned:true,persistenceVerified:true,...unsafe}}]})),
])test('safe plugin row cannot erase retained safety barrier '+JSON.stringify(saved),async t=>{
 const f=fixture(t);retained(f,{result:{returned:true,persistenceVerified:true,inputUnknown:false,blocked:false}},saved);
 await assert.rejects(f.begin,/unsafe retained attempt/i);assert.equal(f.stats.prepared,0);
});

for(const kind of ['returnHome','act'])test('returned unknown '+kind+' persists a stop barrier and prevents later begin',async t=>{
 const f=fixture(t,kind==='returnHome'?{homeResult:{confirmed:false,dispatchStatus:'unknown',error:'offline ambiguous HOME'}}:{actResult:{dispatchStatus:'unknown'}});
 const begun=decode(await f.begin());
 if(kind==='returnHome')assert.equal(decode(await f.service.call('finish_activity',{reason:'offline finish'})).status,'stopped');
 else{const frame=decode(await f.service.call('observe')).frame;await assert.rejects(()=>f.service.call('act',{frameId:frame.id,action:{type:'back'}}),/unknown/i);await assert.rejects(()=>f.service.call('observe'),/unresolved input/i);}
 assert.equal(decode(await f.service.call('get_run_state')).inputUnknown,true);
 const db=new Database(path.join(f.root,'data/checkin.db'),{readonly:true});
 try{assert.equal((db.prepare('SELECT status FROM plugin_action WHERE kind=?').get(kind)as any).status,'unknown');assert.equal(JSON.parse((db.prepare('SELECT state_json FROM plugin_execution WHERE id=?').get(begun.executionId)as any).state_json).inputUnknown,true);}finally{db.close();}
 await f.service.close();
 const later=new ActivityService({root:f.root,allowDevice:true,deviceFactory:()=>{throw Error('Must not construct another device');}});t.after(()=>later.close());
 await assert.rejects(()=>later.call('begin_execution',{configFile:'data/config.json',live:true}),/unresolved prior execution/i);assert.equal(f.stats.prepared,1);
});

function migrated(f:any){
 const storage=new Storage(f.root);
 storage.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'fixture');
 for(const [ref,value]of [['data/config.json',f.cfg],['data/index.json',{knowledgeBundle:'data/knowledge.json'}],['data/knowledge.json',{}]]as any[])storage.putDocument(ref,value);
 fs.mkdirSync(path.join(f.root,'config'),{recursive:true});fs.mkdirSync(path.join(f.root,'data/config-dir'),{recursive:true});
 return storage;
}
for(const ref of ['./data/config.json','data/config-dir/../config.json','config/../data/config.json'])test('migrated config alias reads canonical SQLite authority '+ref,async t=>{
 const f=fixture(t),storage=migrated(f);
 try{storage.putDocument('data/config.json',{...f.cfg,activityName:'SQLite authority'});}finally{storage.close();}
 const context=decode(await f.service.call('get_activity_context',{configFile:ref}));
 assert.equal(context.config.activityName,'SQLite authority');assert.equal(f.stats.prepared,0);
});

test('migrated alias never falls back to leftover JSON when SQLite document is absent',async t=>{
 const f=fixture(t),storage=migrated(f);try{storage.sqlite.prepare('DELETE FROM legacy_document WHERE key=?').run('data/config.json');}finally{storage.close();}
 await assert.rejects(()=>f.service.call('get_activity_context',{configFile:'./data/config.json'}),/structured document missing in sqlite/i);
});

for(const ref of ['data-alias/state.json'])test('internal data symlink cannot bypass SQLite retained safety '+ref,async t=>{
 const f=fixture(t);f.cfg.round.stateFile=ref;f.write('data/config.json',f.cfg);f.write('data/state.json',{batchId:f.cfg.round.batchId,scope:f.cfg.scope,attempts:[]});
 const storage=migrated(f);try{storage.putRoundState('data/state.json',{batchId:f.cfg.round.batchId,scope:f.cfg.scope,inputUnknown:true,attempts:[]});}finally{storage.close();}
 fs.symlinkSync('data',path.join(f.root,'data-alias'));
 await assert.rejects(f.begin,/symlink|unsafe retained/i);assert.equal(f.stats.prepared,0);
 await assert.rejects(()=>f.service.call('get_activity_context',{configFile:'data-alias/config.json'}),/symlink/i);
});

for(const ref of ['./data/state.json','data/config-dir/../state.json','config/../data/state.json'])test('migrated retained state alias preserves SQLite safety barrier '+ref,async t=>{
 const f=fixture(t);f.cfg.round.stateFile=ref;f.write('data/config.json',f.cfg);f.write('data/state.json',{batchId:f.cfg.round.batchId,scope:f.cfg.scope,attempts:[]});
 const storage=migrated(f);try{storage.putRoundState('data/state.json',{batchId:f.cfg.round.batchId,scope:f.cfg.scope,inputUnknown:true,attempts:[]});}finally{storage.close();}
 await assert.rejects(f.begin,/unsafe retained attempt/i);assert.equal(f.stats.prepared,0);
});
