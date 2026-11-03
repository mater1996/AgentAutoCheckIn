import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {openStorage,rootedPath,MIGRATION_MARKER,documentKey} from './index.ts';

const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"';
export function databaseSummary(db:Database.Database){
 const result:Record<string,any>={};
 for(const {name} of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('storage_meta','legacy_document','document_source','round_state','legacy_reservation','document_evidence') ORDER BY name").all()as any[]){
  const cols=db.prepare(`PRAGMA table_info(${quote(name)})`).all()as any[];
  const order=cols.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>quote(c.name));
  const rows=db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${order.length?order.join(','):cols.map(c=>quote(c.name)).join(',')}`).all()as any[];
  const sums:Record<string,number|null>={};
  for(const c of cols.filter(c=>/INT|REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/i.test(c.type)))sums[c.name]=(db.prepare(`SELECT SUM(${quote(c.name)}) value FROM ${quote(name)}`).get()as any).value;
  result[name]={count:rows.length,sums,sha256:hash(JSON.stringify(rows))};
 }
 return result;
}
type Source={path:string;hash:string;format:string;count:number};
function readValues(root:string,source:Pick<Source,'path'|'format'>){
 const bytes=fs.readFileSync(rootedPath(root,source.path));
 try{return source.format==='jsonl'?bytes.toString('utf8').split(/\r?\n/).flatMap((line,i)=>line.trim()?[{key:source.path+'#line='+String(i+1),value:JSON.parse(line)}]:[]):[{key:source.path,value:JSON.parse(bytes.toString('utf8'))}];}
 catch(e){throw Error('Invalid JSON migration input '+source.path+': '+String(e));}
}
function collectSources(root:string){
 const sources:Source[]=[];
 function walk(dir:string){
  if(!fs.existsSync(dir))return;
  for(const item of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   const file=path.join(dir,item.name),rel=path.relative(root,file).split(path.sep).join('/');
   if(rel==='data/storage-migration.manifest.json'||item.name.startsWith('.storage-migration')||['data/backups','data/exports','data/device-locks'].includes(rel))continue;
   if(item.isSymbolicLink())throw Error('Migration source symlink rejected: '+rel);
   if(item.isDirectory()){walk(file);continue;}
   if(!item.isFile()||!(/\.(json|jsonl|pending|consumed|reservation)$/.test(item.name)))continue;
   // Full images/model transcripts stay in evidence; only durable action reservations cross into state storage.
   if(rel.startsWith('evidence/')&&!/reservation/i.test(rel)&&!['manifest.json','session.json','result.json'].includes(item.name))continue;
   rootedPath(root,rel);const bytes=fs.readFileSync(file),format=item.name.endsWith('.jsonl')?'jsonl':'json';
   const count=readValues(root,{path:rel,format}).length;
   sources.push({path:rel,hash:hash(bytes),format,count});
  }
 }
 walk(rootedPath(root,'data'));walk(rootedPath(root,'evidence'));
 return sources;
}
function extract(root:string,value:any){
 const reservations:{pointer:string;status:string;value:any}[]=[], evidence=new Set<string>(),externalEvidence:string[]=[];
 function visit(v:any,pointer:string){
  if(!v||typeof v!=='object')return;
  if(!Array.isArray(v)){
   const status=typeof v.status==='string'?v.status.toLowerCase():'';
   if(['pending','consumed','unknown','reserved'].includes(status)||typeof v.reservationId==='string'||typeof v.kind==='string'&&/reserved$/.test(v.kind))reservations.push({pointer,status:status||'pending',value:v});
  }
  for(const [k,x]of Object.entries(v)){
   if(typeof x==='string'&&/path|evidenceDir|evidenceKey/i.test(k)&&(/evidence[/\\]|\.(png|jpg|jpeg|webp|jsonl)$/i.test(x)||/evidencePath/i.test(k))){
    if(!x.startsWith('data:')&&!x.startsWith('http')){
     const rel=path.relative(root,x);
     if(path.isAbsolute(x)&&(rel==='..'||rel.startsWith('..'+path.sep)))externalEvidence.push(x);
     else evidence.add(documentKey(root,x));
    }
   }
   if(typeof x==='object')visit(x,pointer+'/'+k.replaceAll('~','~0').replaceAll('/','~1'));
  }
 }
 visit(value,'');return {reservations,evidence:[...evidence],externalEvidence};
}
export type MigrationOptions={root:string;target?:string;beforePublish?:()=>void|Promise<void>};
export async function migrateStorage(options:MigrationOptions):Promise<any>{
 const root=fs.realpathSync(path.resolve(options.root)),target=rootedPath(root,options.target??'data/checkin.db');
 const legacy=rootedPath(root,'db/checkin.db');if(target===legacy)throw Error('Migration target cannot be legacy authority');
 fs.mkdirSync(path.dirname(target),{recursive:true});
 const lock=target+'.migration.lock';let fd:number;
 try{fd=fs.openSync(lock,'wx',0o600);}catch(e:any){
  if(e.code!=='EEXIST')throw e;
  let prior:any;try{prior=JSON.parse(fs.readFileSync(lock,'utf8'));}catch{throw Error('Storage migration lock needs inspection: '+lock);}
  if(prior.host!==os.hostname())throw Error('Storage migration lock belongs to another host');
  let alive=true;try{process.kill(prior.pid,0);}catch(err:any){if(err.code==='ESRCH')alive=false;}
  if(alive)throw Error('Storage migration already in progress (lock): '+lock);
  // Rename, rather than deleting a path a concurrent migration could already own.
  const abandoned=lock+'.abandoned-'+randomUUID();fs.renameSync(lock,abandoned);
  try{fd=fs.openSync(lock,'wx',0o600);}finally{fs.rmSync(abandoned,{force:true});}
 }
 const token=randomUUID();fs.writeSync(fd!,JSON.stringify({pid:process.pid,host:os.hostname(),token}));fs.fsyncSync(fd!);
 const temporary=path.join(path.dirname(target),'.storage-migration-'+token+'.db');let s:ReturnType<typeof openStorage>|undefined;
 try{
  const sources=collectSources(root), sourceIndex=sources.map(x=>({path:x.path,hash:x.hash,format:x.format,documents:x.count}));
  if(fs.existsSync(target)){
   const existing=new Database(target,{readonly:true,fileMustExist:true});let manifest:any;
   try{
    if(!existing.prepare("SELECT name FROM sqlite_master WHERE name='storage_meta'").get())throw Error('Target already exists without migration marker; refusing overwrite');
    const marker:any=existing.prepare('SELECT value FROM storage_meta WHERE key=?').get(MIGRATION_MARKER);
    if(!marker)throw Error('Target exists without completed migration marker');manifest=JSON.parse(marker.value);
    if(JSON.stringify(manifest.sources)!==JSON.stringify(sourceIndex))throw Error('Legacy source changed after migration; conflict requires explicit review');
    if(fs.existsSync(legacy)){
     const old=new Database(legacy,{readonly:true,fileMustExist:true});try{if(JSON.stringify(databaseSummary(old))!==JSON.stringify(manifest.before))throw Error('Legacy SQLite source changed after migration; refusing dual authority');}finally{old.close();}
    }
    if(existing.pragma('quick_check',{simple:true})!=='ok')throw Error('Target quick_check failed');
   }finally{existing.close();}
   return {...manifest,alreadyMigrated:true};
  }
  if(!fs.existsSync(legacy))throw Error('Legacy SQLite source is required for migration');
  const old=new Database(legacy,{readonly:true,fileMustExist:true});let before:any;
  try{
   if(old.pragma('quick_check',{simple:true})!=='ok')throw Error('Legacy database quick_check failed');
   before=databaseSummary(old);await old.backup(temporary);
  }finally{old.close();}
  s=openStorage(root,{databasePath:temporary});
  if(JSON.stringify(databaseSummary(s.sqlite))!==JSON.stringify(before))throw Error('SQLite source changed during backup');
  let documents=0,reservations=0,roundStates=0;const externalEvidence:{document:string;path:string}[]=[];
  s.transaction(()=>{
   for(const source of sources){
    s!.sqlite.prepare('INSERT INTO document_source(path,source_hash,format,document_count) VALUES(?,?,?,?)').run(source.path,source.hash,source.format,source.count);
    for(const {key,value}of readValues(root,source)){
     const extracted=extract(root,value);externalEvidence.push(...extracted.externalEvidence.map(p=>({document:key,path:p})));
     s!.putDocument(key,value,{sourcePath:source.path,sourceHash:source.hash,evidencePaths:extracted.evidence});documents++;
     if(value&&typeof value==='object'&&value.batchId&&value.scope&&Array.isArray(value.attempts)){s!.putRoundState(key,value);roundStates++;}
     for(const r of extracted.reservations){s!.sqlite.prepare('INSERT INTO legacy_reservation(key,document_key,status,source_path,source_hash,json) VALUES(?,?,?,?,?,?)').run(key+'#pointer='+r.pointer,key,r.status,source.path,source.hash,JSON.stringify(r.value));reservations++;}
    }
   }
  });
  const after=databaseSummary(s.sqlite);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('SQLite counts, sums or IDs changed during migration');
  const quickCheck=s.sqlite.pragma('quick_check',{simple:true});if(quickCheck!=='ok')throw Error('Migration quick_check failed');
  const foreignKeys=s.sqlite.pragma('foreign_key_check');if((foreignKeys as any[]).length)throw Error('Migration foreign key check failed');
  const manifest={version:1,target,legacy,migratedAt:new Date().toISOString(),before,after,quickCheck,documents,reservations,roundStates,externalEvidence,sources:sourceIndex};
  await options.beforePublish?.();
  if(JSON.stringify(collectSources(root).map(x=>({path:x.path,hash:x.hash,format:x.format,documents:x.count})))!==JSON.stringify(sourceIndex))throw Error('Structured source changed during migration');
  const finalSource=new Database(legacy,{readonly:true,fileMustExist:true});try{if(JSON.stringify(databaseSummary(finalSource))!==JSON.stringify(before))throw Error('Legacy source changed during migration');}finally{finalSource.close();}
  s.sqlite.prepare('INSERT INTO storage_meta(key,value) VALUES(?,?)').run(MIGRATION_MARKER,JSON.stringify(manifest));
  s.sqlite.pragma('wal_checkpoint(TRUNCATE)');s.close();s=undefined;
  // An exclusive hard-link publishes a closed database atomically without overwriting an existing target.
  const finished=fs.openSync(temporary,'r');try{fs.fsyncSync(finished);}finally{fs.closeSync(finished);}
  fs.linkSync(temporary,target);const parent=fs.openSync(path.dirname(target),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
  return {...manifest,alreadyMigrated:false};
 }finally{
  s?.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(temporary+suffix,{force:true});
  fs.closeSync(fd!);try{if(JSON.parse(fs.readFileSync(lock,'utf8')).token===token)fs.unlinkSync(lock);}catch{}
 }
}
