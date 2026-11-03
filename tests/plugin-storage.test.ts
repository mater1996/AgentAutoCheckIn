import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';

const storage = await import('../runner/storage/index.ts').catch(() => null);
function fixture(t: any) { const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || '/Users/mater/.hermes/cache/scratch','plugin-storage-'))); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return root; }

test('canonical path refuses an unmigrated legacy database instead of creating an empty authority', t=>{
 const root=fixture(t); fs.mkdirSync(path.join(root,'db')); new Database(path.join(root,'db/checkin.db')).close();
 assert.ok(storage,'storage API must exist');
 assert.throws(()=>storage!.resolveDatabasePath(root),/migrat/i);
 assert.equal(fs.existsSync(path.join(root,'data/checkin.db')),false);
});

test('canonical resolver rejects a symlink alias to the retired database',t=>{
 const root=fixture(t),previous=process.cwd(),old=process.env.CHECKIN_DB_PATH;
 fs.mkdirSync(path.join(root,'db'));new Database(path.join(root,'db/checkin.db')).close();fs.symlinkSync(path.join(root,'db/checkin.db'),path.join(root,'retired-alias.db'));
 process.chdir(root);process.env.CHECKIN_DB_PATH=path.join(root,'retired-alias.db');
 try{assert.throws(()=>storage!.resolveDatabasePath(root),/retired|legacy/i);}finally{process.chdir(previous);if(old===undefined)delete process.env.CHECKIN_DB_PATH;else process.env.CHECKIN_DB_PATH=old;}
});

test('migrated authority rejects alternate env databases before opening or writing them',t=>{
 const root=fixture(t),s=storage!.openStorage(root);s.sqlite.prepare('INSERT INTO storage_meta VALUES(?,?)').run(storage!.MIGRATION_MARKER,'{}');s.close();
 const previous=process.cwd(),env={CHECKIN_DB_PATH:process.env.CHECKIN_DB_PATH,CHECKIN_DB:process.env.CHECKIN_DB};process.chdir(root);
 try{
  for(const name of ['CHECKIN_DB_PATH','CHECKIN_DB']){
   delete process.env.CHECKIN_DB_PATH;delete process.env.CHECKIN_DB;
   const alternate=path.join(root,'alternate.db');process.env[name]=alternate;
   assert.throws(()=>storage!.openStorage(root),/canonical|authority|override/i);assert.equal(fs.existsSync(alternate),false);
   const existing=new Database(alternate);existing.exec('CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES(\'untouched\')');existing.close();
   const bytes=fs.readFileSync(alternate);assert.throws(()=>storage!.resolveDatabasePath(root),/canonical|authority|override/i);assert.ok(fs.readFileSync(alternate).equals(bytes));fs.rmSync(alternate);
  }
  delete process.env.CHECKIN_DB;const alias=path.join(root,'canonical-alias.db');fs.symlinkSync(path.join(root,'data/checkin.db'),alias);process.env.CHECKIN_DB_PATH=alias;
  assert.equal(storage!.resolveDatabasePath(root),path.join(root,'data/checkin.db'));
  const isolated=storage!.openStorage(root,{databasePath:'migration-fixture.db'});isolated.close();assert.equal(fs.existsSync(path.join(root,'migration-fixture.db')),true);
 }finally{process.chdir(previous);for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('SQLite documents preserve source provenance, enforce root boundaries and commit together',t=>{
 assert.ok(storage,'storage API must exist'); const root=fixture(t), s=storage!.openStorage(root);
 t.after(()=>s.close());
 s.putDocument('data/stage-records/index.json',{n:1},{sourcePath:'data/stage-records/index.json',sourceHash:'a'.repeat(64)});
 assert.deepEqual(s.getDocument('data/stage-records/index.json'),{n:1});
 assert.equal(s.getDocumentRecord('data/stage-records/index.json')!.sourceHash,'a'.repeat(64));
 assert.throws(()=>s.transaction(()=>{s.putDocument('data/a.json',{});throw Error('rollback');}),/rollback/);
 assert.equal(s.getDocument('data/a.json'),null);
 assert.throws(()=>s.putDocument('../escape.json',{}),/root|path/i);
 const outside=fixture(t);fs.symlinkSync(outside,path.join(root,'escape'));
 assert.throws(()=>s.putDocument('escape/a.json',{}),/root|symlink/i);
 s.putRoundState('evidence/round/state.json',{batchId:'b',scope:{appId:'a'},attempts:[{reservationId:'r',status:'pending'}]});
 assert.throws(()=>s.putRoundState('evidence/round/state.json',{batchId:'b',scope:{appId:'a'},attempts:[]}),/pending|reservation/i);
 assert.deepEqual(s.getRoundState('evidence/round/state.json','b',{appId:'a'})!.attempts,[{reservationId:'r',status:'pending'}]);
 s.putRoundState('evidence/round/state.json',{batchId:'b',scope:{appId:'a'},attempts:[{reservationId:'r',status:'consumed'}]});
 assert.throws(()=>s.putRoundState('evidence/round/state.json',{batchId:'b',scope:{appId:'a'},attempts:[{reservationId:'r',status:'pending'}]}),/consumed/i);
});
