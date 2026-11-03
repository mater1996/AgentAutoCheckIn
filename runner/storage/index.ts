import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import Database from 'better-sqlite3';

export const MIGRATION_MARKER = 'legacy_storage_v1';
export function rootedPath(root: string, file: string): string {
 const base=fs.realpathSync(path.resolve(root)), target=path.resolve(base,file), rel=path.relative(base,target);
 if(!rel || rel==='..' || rel.startsWith('..'+path.sep))throw Error('Path outside root: '+file);
 let ancestor=target;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
 const realRel=path.relative(base,fs.realpathSync(ancestor));
 if(realRel==='..'||realRel.startsWith('..'+path.sep))throw Error('Path outside root via symlink: '+file);
 if(fs.realpathSync(ancestor)!==ancestor)throw Error('Workspace symlink alias rejected: '+file);
 return target;
}
export function documentKey(root: string, key: string): string {
 if(key.includes('\\')||key.split('/').includes('..'))throw Error('Invalid document path');
 return path.relative(fs.realpathSync(path.resolve(root)),rootedPath(root,key)).split(path.sep).join('/');
}
export function resolveDatabasePath(root=process.cwd()): string {
 const canonical=rootedPath(root,'data/checkin.db'), legacy=rootedPath(root,'db/checkin.db');
 const override=fs.realpathSync(root)===fs.realpathSync(process.cwd())?(process.env.CHECKIN_DB_PATH||process.env.CHECKIN_DB):undefined;
 if(override){
  const explicit=path.resolve(override);
  if(explicit===legacy||(fs.existsSync(explicit)&&fs.existsSync(legacy)&&fs.realpathSync(explicit)===fs.realpathSync(legacy)))throw Error('Legacy SQLite path is retired; migrate to data/checkin.db');
  if(isStorageMigrated(root)){
   if(explicit!==canonical&&(!fs.existsSync(explicit)||fs.realpathSync(explicit)!==fs.realpathSync(canonical)))throw Error('Database override conflicts with canonical storage authority: data/checkin.db');
   return canonical;
  }
  return explicit;
 }
 if(fs.existsSync(legacy)&&!fs.existsSync(canonical))throw Error('Legacy SQLite database requires storage migration to data/checkin.db');
 if(fs.existsSync(legacy)&&fs.existsSync(canonical)&&!isStorageMigrated(root))throw Error('Canonical database has no completed storage migration marker');
 return canonical;
}
export function isStorageMigrated(root=process.cwd()): boolean {
 const file=rootedPath(root,'data/checkin.db');if(!fs.existsSync(file))return false;
 const db=new Database(file,{readonly:true,fileMustExist:true});
 try{return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_meta'").get()&&!!db.prepare('SELECT value FROM storage_meta WHERE key=?').get(MIGRATION_MARKER);}finally{db.close();}
}
export const STORAGE_DDL=`
CREATE TABLE IF NOT EXISTS storage_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS legacy_document(
 key TEXT PRIMARY KEY,json TEXT NOT NULL CHECK(json_valid(json)),source_path TEXT,source_hash TEXT,
 content_hash TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_source(
 path TEXT PRIMARY KEY,source_hash TEXT NOT NULL,format TEXT NOT NULL,document_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS round_state(
 key TEXT PRIMARY KEY,batch_id TEXT NOT NULL,scope_json TEXT NOT NULL,json TEXT NOT NULL CHECK(json_valid(json)),updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_reservation(
 key TEXT PRIMARY KEY,document_key TEXT NOT NULL REFERENCES legacy_document(key),status TEXT NOT NULL,
 source_path TEXT NOT NULL,source_hash TEXT NOT NULL,json TEXT NOT NULL CHECK(json_valid(json))
);
CREATE TABLE IF NOT EXISTS document_evidence(
 document_key TEXT NOT NULL REFERENCES legacy_document(key),path TEXT NOT NULL,source_hash TEXT,
 PRIMARY KEY(document_key,path)
);`;
export type Provenance={sourcePath?:string;sourceHash?:string;expectedRevision?:number;evidencePaths?:string[]};
const digest=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export class Storage {
 readonly sqlite: Database.Database;
 constructor(readonly root: string,options:{databasePath?:string}={}){
  const file=options.databasePath?rootedPath(root,options.databasePath):resolveDatabasePath(root);
  fs.mkdirSync(path.dirname(file),{recursive:true});this.sqlite=new Database(file);
  this.sqlite.pragma('busy_timeout=5000');this.sqlite.pragma('journal_mode=WAL');this.sqlite.pragma('synchronous=FULL');this.sqlite.pragma('foreign_keys=ON');
  this.sqlite.exec(STORAGE_DDL);
 }
 close(){this.sqlite.close();}
 transaction<T>(fn:()=>T):T{return this.sqlite.transaction(fn).immediate();}
 getDocumentRecord(key:string){
  const row:any=this.sqlite.prepare('SELECT * FROM legacy_document WHERE key=?').get(documentKey(this.root,key));
  return row?{key:row.key,value:JSON.parse(row.json),sourcePath:row.source_path,sourceHash:row.source_hash,contentHash:row.content_hash,revision:row.revision}:null;
 }
 getDocument<T=any>(key:string):T|null{return this.getDocumentRecord(key)?.value??null;}
 listDocuments(prefix=''):string[]{return (this.sqlite.prepare('SELECT key FROM legacy_document ORDER BY key').all() as any[]).map(r=>r.key).filter(k=>k.startsWith(prefix));}
 putDocument(key:string,value:unknown,provenance:Provenance={}){
  key=documentKey(this.root,key);const bytes=JSON.stringify(value);if(bytes===undefined)throw Error('Document must be JSON');
  const sourcePath=provenance.sourcePath?documentKey(this.root,provenance.sourcePath):null;
  if(provenance.sourceHash&&!/^[a-f0-9]{64}$/.test(provenance.sourceHash))throw Error('Invalid source hash');
  const paths=(provenance.evidencePaths??[]).map(p=>documentKey(this.root,p));
  return this.transaction(()=>{
   const prior=this.getDocumentRecord(key);
   if(provenance.expectedRevision!==undefined&&(prior?.revision??0)!==provenance.expectedRevision)throw Error('Document revision conflict');
   this.sqlite.prepare(`INSERT INTO legacy_document(key,json,source_path,source_hash,content_hash,updated_at) VALUES(?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET json=excluded.json,content_hash=excluded.content_hash,revision=legacy_document.revision+1,updated_at=excluded.updated_at,
    source_path=COALESCE(legacy_document.source_path,excluded.source_path),source_hash=COALESCE(legacy_document.source_hash,excluded.source_hash)`).run(key,bytes,sourcePath,provenance.sourceHash??null,digest(bytes),new Date().toISOString());
   for(const p of paths){const file=rootedPath(this.root,p);this.sqlite.prepare('INSERT OR IGNORE INTO document_evidence(document_key,path,source_hash) VALUES(?,?,?)').run(key,p,fs.existsSync(file)&&fs.statSync(file).isFile()?digest(fs.readFileSync(file)):null);}
  });
 }
 putRoundState(key:string,value:any){
  key=documentKey(this.root,key);if(!value?.batchId||!value.scope)throw Error('Round state batch/scope required');
  this.transaction(()=>{
   const old=this.getRoundState(key);
   const ids=new Set<string>();for(const a of value.attempts??[]){if(!a.reservationId||ids.has(a.reservationId))throw Error('Duplicate or missing reservation identity');ids.add(a.reservationId);}
   if(old&&(old.batchId!==value.batchId||!isDeepStrictEqual(old.scope,value.scope)))throw Error('Round state batch/scope mismatch');
   for(const attempt of old?.attempts??[]){
    const next=value.attempts?.find((a:any)=>a.reservationId===attempt.reservationId);
    if(!next)throw Error('Cannot discard pending/consumed reservation');
    for(const binding of ['identity','name','instruction'])if(attempt[binding]!==next[binding])throw Error('Reservation identity binding cannot change');
    if(attempt.status==='consumed'&&next.status!=='consumed')throw Error('Consumed reservation cannot reopen');
    if(attempt.status==='unknown'&&next.status!=='unknown'&&next.status!=='consumed')throw Error('Unknown reservation cannot reopen');
   }
   this.sqlite.prepare(`INSERT INTO round_state(key,batch_id,scope_json,json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET json=excluded.json,updated_at=excluded.updated_at`).run(key,value.batchId,JSON.stringify(value.scope),JSON.stringify(value),new Date().toISOString());
  });
 }
 getRoundState<T=any>(key:string,batchId?:string,scope?:unknown):T|null{
  const row:any=this.sqlite.prepare('SELECT * FROM round_state WHERE key=?').get(documentKey(this.root,key));if(!row)return null;
  if((batchId!==undefined&&row.batch_id!==batchId)||(scope!==undefined&&!isDeepStrictEqual(JSON.parse(row.scope_json),scope)))throw Error('Round state batch/scope mismatch');
  return JSON.parse(row.json);
 }
}
export const openStorage=(root=process.cwd(),options:{databasePath?:string}={})=>new Storage(root,options);
export function getDocument<T=any>(root:string,key:string):T|null{const store=openStorage(root);try{return store.getDocument<T>(key);}finally{store.close();}}
export function putDocument(root:string,key:string,value:unknown,provenance:Provenance={}){const store=openStorage(root);try{return store.putDocument(key,value,provenance);}finally{store.close();}}
export function getRoundState(root:string,key:string,batchId?:string,scope?:unknown){const store=openStorage(root);try{return store.getRoundState(key,batchId,scope);}finally{store.close();}}
export function putRoundState(root:string,key:string,value:unknown){const store=openStorage(root);try{return store.putRoundState(key,value);}finally{store.close();}}
