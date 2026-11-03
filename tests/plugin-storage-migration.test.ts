import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';
import {openStorage,isStorageMigrated,resolveDatabasePath} from '../runner/storage/index.ts';
const migration=await import('../runner/storage/migrate.ts').catch(()=>null);
function fixture(t:any){const root=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR || '/Users/mater/.hermes/cache/scratch','plugin-storage-migration-')));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'db'));const db=new Database(path.join(root,'db/checkin.db'));db.exec(`CREATE TABLE run(id INTEGER PRIMARY KEY,evidence_dir TEXT);INSERT INTO run VALUES(42,'evidence/round');CREATE TABLE gain_event(id INTEGER PRIMARY KEY,run_id INTEGER,units REAL);INSERT INTO gain_event VALUES(81,42,12.5);CREATE TABLE asset_snapshot(id INTEGER PRIMARY KEY,balance REAL);INSERT INTO asset_snapshot VALUES(99,101.5);`);db.close();return root;}
function write(root:string,p:string,v:unknown){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),JSON.stringify(v));}

test('migration backs up SQLite consistently, imports all documents and keeps pending/consumed reservations',async t=>{
 assert.ok(migration,'migration API must exist'); const root=fixture(t);
 const state={batchId:'batch',scope:{appId:'tb',accountId:'a',activityId:'coin',userId:0},attempts:[{reservationId:'a',status:'pending'},{reservationId:'b',status:'consumed'}]};
 write(root,'data/round/state.json',state);write(root,'data/config.json',{evidencePath:'evidence/frame.png'});
 fs.mkdirSync(path.join(root,'evidence'));fs.writeFileSync(path.join(root,'evidence/frame.png'),'fixture');
 fs.writeFileSync(path.join(root,'data/log.jsonl'),'\n'+JSON.stringify({kind:'dispatch_reserved',key:'reserved'})+'\n'+JSON.stringify({status:'consumed',reservationId:'consumed'})+'\n');
 const source=fs.readFileSync(path.join(root,'db/checkin.db'));
 const result=await migration!.migrateStorage({root});
 assert.equal(result.quickCheck,'ok');assert.deepEqual(result.before,result.after);assert.equal(result.before.gain_event.count,1);assert.equal(result.before.gain_event.sums.units,12.5);
 assert.equal(isStorageMigrated(root),true);assert.equal(resolveDatabasePath(root),path.join(root,'data/checkin.db'));
 const s=openStorage(root);t.after(()=>s.close());assert.equal((s.sqlite.prepare('SELECT id FROM run').get()as any).id,42);
 assert.deepEqual(s.getDocument('data/round/state.json'),state);assert.deepEqual(s.getRoundState('data/round/state.json','batch',state.scope),state);
 assert.equal((s.sqlite.prepare("SELECT count(*) n FROM legacy_reservation WHERE status='pending'").get()as any).n,2);
 assert.equal((s.sqlite.prepare("SELECT count(*) n FROM legacy_reservation WHERE status='consumed'").get()as any).n,2);
 assert.equal(s.getDocumentRecord('data/config.json')!.sourceHash,createHash('sha256').update(fs.readFileSync(path.join(root,'data/config.json'))).digest('hex'));
 assert.equal((s.sqlite.prepare('SELECT path FROM document_evidence').get()as any).path,'evidence/frame.png');
 assert.equal(s.listDocuments().length,4);assert.equal(result.documents,4);
 const again=await migration!.migrateStorage({root});assert.equal(again.alreadyMigrated,true);assert.equal(s.listDocuments().length,4);
 assert.ok(fs.readFileSync(path.join(root,'db/checkin.db')).equals(source));
});

test('migration refuses conflicting targets and changed sources, preserves marker and runtime edits on reentry',async t=>{
 assert.ok(migration);const root=fixture(t);write(root,'data/config.json',{v:1});
 await migration!.migrateStorage({root});const s=openStorage(root);s.putDocument('data/config.json',{v:2});s.close();
 await migration!.migrateStorage({root});const read=openStorage(root);assert.deepEqual(read.getDocument('data/config.json'),{v:2});read.close();
 write(root,'data/config.json',{v:3});await assert.rejects(migration!.migrateStorage({root}),/source.*chang|conflict/i);
 const conflict=fixture(t);fs.mkdirSync(path.join(conflict,'data'));const db=new Database(path.join(conflict,'data/checkin.db'));db.exec('CREATE TABLE important(x)');db.close();
 await assert.rejects(migration!.migrateStorage({root:conflict}),/exist|conflict/i);const preserved=new Database(path.join(conflict,'data/checkin.db'));assert.ok(preserved.prepare("SELECT name FROM sqlite_master WHERE name='important'").get());preserved.close();
});

test('migration rejects malformed inputs and symlinks before publishing; interrupted retry is safe',async t=>{
 assert.ok(migration);const root=fixture(t);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/bad.json'),'{');
 await assert.rejects(migration!.migrateStorage({root}),/JSON|parse/i);assert.equal(isStorageMigrated(root),false);assert.equal(fs.existsSync(path.join(root,'data/checkin.db')),false);
 fs.unlinkSync(path.join(root,'data/bad.json'));write(root,'data/ok.json',{n:1});
 await assert.rejects(migration!.migrateStorage({root,beforePublish:()=>{throw Error('interruption');}}),/interruption/);
 assert.equal(fs.existsSync(path.join(root,'data/checkin.db')),false);await migration!.migrateStorage({root});assert.equal(isStorageMigrated(root),true);
 const links=fixture(t),external=fixture(t);fs.mkdirSync(path.join(links,'data'));fs.symlinkSync(external,path.join(links,'data/outside'));await assert.rejects(migration!.migrateStorage({root:links}),/symlink|root/i);
});

test('migration lock prevents concurrent authority publication and evidence path escapes',async t=>{
 assert.ok(migration);const root=fixture(t);write(root,'data/a.json',{});
 const active=migration!.migrateStorage({root,beforePublish:async()=>{await assert.rejects(migration!.migrateStorage({root}),/lock|progress/i);}});await active;
 const escape=fixture(t);write(escape,'data/a.json',{evidencePath:'../../outside.png'});await assert.rejects(migration!.migrateStorage({root:escape}),/root|path/i);
});

test('historical absolute evidence outside root remains inert provenance without reading or importing outside files',async t=>{
 assert.ok(migration);const root=fixture(t);write(root,'data/a.json',{evidencePath:'/outside/archived-frame.png'});
 const report=await migration!.migrateStorage({root});assert.equal(report.externalEvidence.length,1);
 const s=openStorage(root);try{assert.deepEqual(s.getDocument('data/a.json'),{evidencePath:'/outside/archived-frame.png'});assert.equal((s.sqlite.prepare('SELECT COUNT(*) n FROM document_evidence').get()as any).n,0);}finally{s.close();}
});

test('migration excludes backups exports and device lock metadata from business documents',async t=>{
 assert.ok(migration);const root=fixture(t);write(root,'data/a.json',{});
 for(const folder of ['backups','exports','device-locks'])write(root,'data/'+folder+'/ignored.json',{status:'pending'});
 const report=await migration!.migrateStorage({root});assert.equal(report.documents,1);assert.equal(report.reservations,0);
});
