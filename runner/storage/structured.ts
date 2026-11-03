import {Storage,isStorageMigrated,rootedPath,documentKey} from './index.ts';
import fs from 'node:fs';import path from 'node:path';
import crypto from 'node:crypto';
/** Structured data uses SQLite after migration; files remain immutable legacy sources. */
export function readStructured(root:string,ref:string):any{
 const file=rootedPath(root,ref),key=documentKey(root,ref);
 if(key.startsWith('data/')&&isStorageMigrated(root)){
  const store=new Storage(root);try{const record=store.getDocumentRecord(key);if(record)return record.value;}finally{store.close();}
  throw Object.assign(Error('Structured document missing in SQLite: '+key),{code:'ENOENT'});
 }
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export function structuredExists(root:string,ref:string){try{readStructured(root,ref);return true;}catch(e:any){if(e.code==='ENOENT')return false;throw e;}}
export function writeStructured(root:string,ref:string,value:any){
 const key=documentKey(root,ref);
 if(!key.startsWith('data/')||!isStorageMigrated(root))throw Error('Unified structured writes require migrated data/checkin.db');
 const store=new Storage(root);try{store.putDocument(key,value);}finally{store.close();}
}

/** Legacy consumers may keep explicit fixture directories; migrated project data has one authority. */
export function usesStructuredStorage(file:string,root=process.cwd()):boolean{
 const base=fs.realpathSync(root),absolute=path.resolve(file),relative=path.relative(base,absolute);
 if(relative==='..'||relative.startsWith('..'+path.sep))return false;
 const key=documentKey(base,absolute);
 return key.startsWith('data/')&&isStorageMigrated(root);
}
export function assertLegacyWriterAllowed(root=process.cwd()):void{
 if(isStorageMigrated(root))throw Error('Legacy JSON writer retired after storage migration; use canonical SQLite storage');
}
export function readStateFile(file:string):any{
 return usesStructuredStorage(file)?readStructured(process.cwd(),file):JSON.parse(fs.readFileSync(file,'utf8'));
}
export function stateFileExists(file:string):boolean{
 return usesStructuredStorage(file)?structuredExists(process.cwd(),file):fs.existsSync(file);
}
export function writeStateFile(file:string,value:any):void{
 if(usesStructuredStorage(file)){writeStructured(process.cwd(),file,value);return;}
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,file);}
 finally{fs.rmSync(temporary,{force:true});}
}
