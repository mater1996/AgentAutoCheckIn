import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {ActivityService} from '../runner/mcp/service.ts';
import {Storage,MIGRATION_MARKER} from '../runner/storage/index.ts';

const decode=(r:any)=>JSON.parse(r.content[0].text);
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return {promise,resolve};}
function fixture(t:any,options:any={}){
 const root=fs.mkdtempSync(path.join(process.env.TMPDIR!,'plugin-lifecycle-'));
 const oldSerial=process.env.ADB_SERIAL,oldLocks=process.env.CHECKIN_DEVICE_LOCK_DIR;
 process.env.ADB_SERIAL='offline-lifecycle-'+randomUUID();process.env.CHECKIN_DEVICE_LOCK_DIR=path.join(root,'locks');
 fs.mkdirSync(path.join(root,'data'));new Database(path.join(root,'data/checkin.db')).close();
 fs.mkdirSync(path.join(root,'runner/staged'),{recursive:true});fs.writeFileSync(path.join(root,'runner/staged/offline.ts'),'// fixture');
 const cfg=JSON.parse(fs.readFileSync('config/plugin/taobao-coin.json','utf8'));
 cfg.round.priorPlanFiles=[];delete cfg.round.stateFile;cfg.round.batchId='offline';cfg.knowledgeIndex='data/index.json';
 const write=(ref:string,v:any)=>{const f=path.join(root,ref);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v));};
 write('data/config.json',cfg);write('data/index.json',{knowledgeBundle:'data/knowledge.json'});write('data/knowledge.json',{});
 const stats={devices:0,prepare:0,cleanup:0,act:0,restart:0,home:0};
 const entered=deferred(),release=deferred();
 let hold:string|undefined;
 const wait=async(key:string)=>{if(hold===key){entered.resolve();await release.promise;}};
 const service=new ActivityService({root,allowDevice:true,allowRestart:true,deviceFactory:(dir)=>{
  stats.devices++;return {
   prepare:async()=>{stats.prepare++;await wait('prepare');},
   cleanup:async()=>{stats.cleanup++;await wait('cleanup');return {errors:[]};},
   capture:async()=>{await wait('capture');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,randomUUID()+'.png'),b=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(1080,16);b.writeUInt32BE(2400,20);fs.writeFileSync(file,b);return {id:randomUUID(),path:file,width:1080,height:2400,capturedAt:Date.now(),package:cfg.package,userId:cfg.scope.userId,lines:[]};},
   act:async(_a:any,_f:any,o:any)=>{await wait('beforeInput');o?.beforeInput?.();stats.act++;await wait('act');},
   restartApp:async()=>{stats.restart++;await wait('restart');return {dispatchStatus:'dispatched'};},
   returnHome:async()=>{stats.home++;await wait('home');return {confirmed:true,dispatchStatus:'dispatched'};},
  };
 },...options});
 t.after(async()=>{release.resolve();try{await service.close();}finally{if(oldSerial===undefined)delete process.env.ADB_SERIAL;else process.env.ADB_SERIAL=oldSerial;if(oldLocks===undefined)delete process.env.CHECKIN_DEVICE_LOCK_DIR;else process.env.CHECKIN_DEVICE_LOCK_DIR=oldLocks;fs.rmSync(root,{recursive:true,force:true});}});
 return {root,cfg,service,stats,write,entered,release,hold:(key:string)=>{hold=key;},begin:()=>service.call('begin_execution',{configFile:'data/config.json',live:true})};
}

for(const stop of ['close','cancel'])for(const worker of ['prepare','capture','act','restart','home','cleanup'])test(`${stop} waits for actual ${worker} worker before releasing resources`,async t=>{
 const f=fixture(t);let frame:any;
 if(worker!=='prepare')await f.begin();
 if(worker==='act')frame=decode(await f.service.call('observe')).frame;
 f.hold(worker);
 const work=worker==='prepare'?f.begin():worker==='capture'?f.service.call('observe'):worker==='act'?f.service.call('act',{frameId:frame.id,action:{type:'back'}}):worker==='restart'?f.service.call('recover',{strategy:'restart-app',reason:'offline'}):f.service.call('finish_activity',{reason:'offline'});
 // Attach the rejection handler immediately: shutdown may legitimately reject a worker.
 const outcome=work.then(value=>({value}),error=>({error}));
 await f.entered.promise;
 let settled=false;const stopping=(stop==='close'?f.service.close():f.service.call('cancel_execution',{reason:'offline stop'})).then(()=>{settled=true;});
 try{
  await tick();await tick();
  assert.equal(settled,false,'stop resolved while the actual worker was held');
  assert.equal(fs.readdirSync(path.join(f.root,'locks')).length,1,'device lease released early');
  assert.equal((f.service as any).db.open,true,'service database closed while a worker was held');
  assert.equal(f.stats.cleanup,worker==='cleanup'?1:0,'cleanup overlapped the held worker');
  const db=new Database(path.join(f.root,'data/checkin.db'));try{assert.equal((db.prepare('SELECT count(*) AS n FROM plugin_execution').get()as any).n,1);}finally{db.close();}
  if(stop==='close')await assert.rejects(()=>f.service.call('list_recipes'),/closed/i);
  else await assert.rejects(()=>f.service.call('observe'),/cancel|owns/i);
 }finally{f.release.resolve();await outcome;await stopping;}
 assert.equal(settled,true);
 if(stop==='close')assert.equal(fs.readdirSync(path.join(f.root,'locks')).length,0);
 else{
  await assert.rejects(()=>f.service.call('recover',{strategy:'restart-app',reason:'after cancel'}),/cancel|stopped/i);
  if(!['home','cleanup'].includes(worker)){assert.equal(f.stats.cleanup,0);assert.equal(fs.readdirSync(path.join(f.root,'locks')).length,1);await f.service.call('finish_activity',{reason:'cancelled'});}
 }
});

test('cancellation blocks a deferred beforeInput callback before physical dispatch',async t=>{
 const f=fixture(t);await f.begin();const frame=decode(await f.service.call('observe')).frame;f.hold('beforeInput');
 const work=f.service.call('act',{frameId:frame.id,action:{type:'swipe',fromX:500,fromY:1700,toX:500,toY:700,ms:300}});
 const rejected=assert.rejects(work,/cancel/i);await f.entered.promise;
 const cancel=f.service.call('cancel_execution',{reason:'before physical input'});f.release.resolve();await rejected;await cancel;
 assert.equal(f.stats.act,0);
 const db=new Database(path.join(f.root,'data/checkin.db'));try{assert.equal((db.prepare('SELECT status FROM plugin_action').get()as any).status,'not-sent');}finally{db.close();}
});

test('cancellation during backup prevents later device construction and preparation',async t=>{
 const f=fixture(t),entered=deferred(),release=deferred();
 const db=(f.service as any).db,backup=db.backup.bind(db);
 db.backup=async(file:string)=>{entered.resolve();await release.promise;return backup(file);};
 const work=f.begin().then(value=>({value}),error=>({error}));await entered.promise;
 const cancel=f.service.call('cancel_execution',{reason:'before prepare'});release.resolve();
 const result=await work;await cancel;assert('error' in result);assert.equal(f.stats.devices,0);assert.equal(f.stats.prepare,0);
});

for(const ref of ['evidence','data/backups'])test('artifact ancestor '+ref+' cannot escape through a symlink',async t=>{
 const f=fixture(t),outside=fs.mkdtempSync(path.join(process.env.TMPDIR!,'plugin-outside-'));
 t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(f.root,ref));
 await assert.rejects(f.begin,/outside workspace|symlink/i);
 assert.deepEqual(fs.readdirSync(outside),[]);assert.equal(f.stats.devices,0);assert.equal(f.stats.prepare,0);
 assert.equal(fs.existsSync(path.join(f.root,ref==='evidence'?'data/backups':'evidence')),false,'other artifacts were written before validation');
});

function owners(f:any){
 const db=new Database(path.join(f.root,'data/checkin.db'));
 db.exec('CREATE TABLE account(id TEXT PRIMARY KEY,app TEXT,package TEXT,user_id INTEGER);CREATE TABLE activity(id TEXT PRIMARY KEY,account_id TEXT,asset_id TEXT);CREATE TABLE asset(id TEXT PRIMARY KEY,platform TEXT)');
 db.prepare('INSERT INTO account VALUES(?,?,?,?)').run(f.cfg.scope.accountId,f.cfg.scope.appId,f.cfg.package,f.cfg.scope.userId);
 db.prepare('INSERT INTO activity VALUES(?,?,?)').run(f.cfg.scope.activityId,f.cfg.scope.accountId,f.cfg.assetId);
 db.prepare('INSERT INTO asset VALUES(?,?)').run(f.cfg.assetId,f.cfg.scope.appId);return db;
}
for(const sql of [
 "UPDATE account SET app='wrong'", "UPDATE account SET package='wrong'", 'UPDATE account SET user_id=999',
 "UPDATE activity SET account_id='wrong'", "UPDATE activity SET asset_id='wrong'", "UPDATE asset SET platform='wrong'",
 'DELETE FROM account', 'DELETE FROM activity', 'DELETE FROM asset', 'DROP TABLE asset',
])test('database ownership rejects '+sql+' before any device construction',async t=>{
 const f=fixture(t),db=owners(f);try{db.exec(sql);}finally{db.close();}
 await assert.rejects(f.begin,/scope|owner|asset/i);assert.equal(f.stats.devices,0);assert.equal(f.stats.prepare,0);
 assert.equal(fs.existsSync(path.join(f.root,'evidence')),false);
});
test('database owner bindings permit the configured device',async t=>{
 const f=fixture(t);owners(f).close();await f.begin();assert.equal(f.stats.prepare,1);
});
test('owner rows changed during backup are revalidated before device construction',async t=>{
 const f=fixture(t);owners(f).close();const db=(f.service as any).db,backup=db.backup.bind(db);
 db.backup=async(file:string)=>{const result=await backup(file);db.prepare("UPDATE account SET package='changed'").run();return result;};
 await assert.rejects(f.begin,/owner scope mismatch/i);assert.equal(f.stats.devices,0);assert.equal(f.stats.prepare,0);
});

test('production device construction requires domain ownership tables',async t=>{
 const f=fixture(t);(f.service as any).options.deviceFactory=undefined;
 await assert.rejects(f.begin,/ownership tables required/i);assert.equal(fs.existsSync(path.join(f.root,'evidence')),false);
});
for(const scope of [{appId:'wrong',activityId:'tb_coin'},{appId:'taobao',activityId:'wrong'},{appId:'taobao',activityId:'tb_coin',accountId:'wrong'},{appId:'taobao',activityId:'tb_coin',userId:999}])test('knowledge bundle scope rejects '+JSON.stringify(scope)+' before prepare',async t=>{
 const f=fixture(t);f.write('data/knowledge.json',{scope});
 await assert.rejects(f.begin,/knowledge.*scope/i);assert.equal(f.stats.devices,0);assert.equal(f.stats.prepare,0);
});
test('shared activity knowledge accepts its matching app and activity scope',async t=>{
 const f=fixture(t);f.write('data/knowledge.json',{scope:{appId:f.cfg.scope.appId,activityId:f.cfg.scope.activityId}});await f.begin();assert.equal(f.stats.prepare,1);
});

for(const kind of ['execution','action'])test('unresolved '+kind+' created after the first check is rejected under the device lease',async t=>{
 const f=fixture(t),db=(f.service as any).db,prepare=db.prepare.bind(db);let scheduled=false;
 db.prepare=(sql:string)=>{const statement=prepare(sql);if(!scheduled&&sql.includes("SELECT id FROM plugin_execution WHERE status='running'")){scheduled=true;const get=statement.get.bind(statement);statement.get=(...args:any[])=>{const result=get(...args);queueMicrotask(()=>{if(kind==='execution')prepare('INSERT INTO plugin_execution VALUES(?,?,?,?,?,?)').run('other','batch','{}','evidence/other','running','{}');else prepare('INSERT INTO plugin_action VALUES(?,?,?,?,?,?)').run('other','other',null,'act','unknown','{}');});return result;};}return statement;};
 await assert.rejects(f.begin,/unresolved prior execution/i);assert.equal(f.stats.devices,0);assert.equal(fs.existsSync(path.join(f.root,'evidence')),false);assert.equal(fs.readdirSync(path.join(f.root,'locks')).length,0);
});

test('restart cannot clear the persistence barrier of the original attempt',async t=>{
 let selects=0;
 const f=fixture(t,{runtimeFactory:()=>({adoptSelection:async()=>({status:'completed'}),stage:async()=>({status:'completed'})}),nextFinder:async(o:any)=>{selects++;const task={name:'offline task',instruction:'browse',done:0,total:1};return {decision:'task',item:{...task,decision:'do',times:1},selection:{task,balanceBefore:10,taskAttemptId:o.taskAttemptId,evidenceKey:'fixture'}};},saveTask:async()=>{throw Error('offline archive failure');}});
 await f.begin();await f.service.call('execute_recipe',{recipeId:'find-next-task'});await f.service.call('execute_recipe',{recipeId:'execute-task'});
 const before=decode(await f.service.call('get_run_state'));assert.equal(before.attempts[0].result.returned,true);assert.equal(before.attempts[0].result.persistenceVerified,false);assert.equal(before.needsRecovery,true);
 await assert.rejects(()=>f.service.call('recover',{strategy:'restart-app',reason:'archive failed'}),/persistence/i);
 await assert.rejects(()=>f.service.call('execute_recipe',{recipeId:'find-next-task'}),/persistence/i);
 assert.equal(f.stats.restart,0);assert.equal(selects,1);assert.deepEqual(decode(await f.service.call('get_run_state')).attempts,before.attempts);
});

test('execution snapshots authoritative config knowledge and loaded recipes across restart',async t=>{
 const seen:any[]=[];const f=fixture(t,{runtimeFactory:()=>({stage:async()=>({status:'completed'})}),nextFinder:async(o:any)=>{seen.push(o.knowledge);return {decision:'finish',coverage:{complete:true,topVerified:true,bottomVerified:true}};}});
 f.write('data/knowledge.json',{scope:{appId:f.cfg.scope.appId,activityId:f.cfg.scope.activityId},marker:'original'});
 const begin=decode(await f.begin()),dir=(f.service as any).active.dir,file=path.join(dir,'inputs.json');
 assert.equal(fs.existsSync(file),true);const inputs=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(inputs.knowledge.value.marker,'original');assert.match(inputs.config.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(inputs.recipes.value,[]);
 const sources=JSON.parse(fs.readFileSync(path.join(dir,'sources.json'),'utf8'));
 assert(sources.some((s:any)=>s.file.endsWith('/runner/mcp/service.ts')));assert(sources.some((s:any)=>s.file.endsWith('/runner/mcp/recipe-bridge.ts')));
 f.write('data/knowledge.json',{scope:{appId:'changed',activityId:'changed'},marker:'changed'});
 f.write('data/stage-records/recipes/registry.json',{recipes:'invalid after begin'});
 await f.service.call('recover',{strategy:'restart-app',reason:'offline'});await f.service.call('execute_recipe',{recipeId:'find-next-task'});
 assert.equal(seen[0].marker,'original');assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),inputs);
});

test('provenance stores SQLite-authoritative config even without its stale filesystem export',async t=>{
 const f=fixture(t),storage=new Storage(f.root);
 try{storage.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(MIGRATION_MARKER,'fixture');storage.putDocument('data/config.json',{...f.cfg,activityName:'SQLite authority'});storage.putDocument('data/index.json',{knowledgeBundle:'data/knowledge.json'});storage.putDocument('data/knowledge.json',{marker:'SQLite knowledge'});}finally{storage.close();}
 fs.unlinkSync(path.join(f.root,'data/config.json'));await f.begin();
 const a=(f.service as any).active,inputs=JSON.parse(fs.readFileSync(path.join(a.dir,'inputs.json'),'utf8'));
 assert.equal(inputs.config.value.activityName,'SQLite authority');assert.equal(inputs.knowledge.value.marker,'SQLite knowledge');
 assert(!a.sources.some((s:any)=>s.file===path.join(f.root,'data/config.json')));
});

test('cancel without pending workers does not await itself', {timeout:2000},async t=>{
 const f=fixture(t);await f.begin();await f.service.call('cancel_execution',{reason:'offline'});
 await assert.rejects(()=>f.service.call('observe'),/cancel/i);
 await f.service.call('finish_activity',{reason:'cancelled'});assert.equal(f.stats.home,0);
});
