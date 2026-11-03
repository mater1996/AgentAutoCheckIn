import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getRoundState,putRoundState} from '../storage/index.ts';
import {usesStructuredStorage,readStateFile,stateFileExists} from '../storage/structured.ts';
/** Atomic state replacement, flushed before granting the next input authority. */
export function writeRoundState(file:string,value:any){
 if(value?.batchId&&value.scope&&Array.isArray(value.attempts)&&usesStructuredStorage(file)){
  putRoundState(process.cwd(),file,value);
  return;
 }
 fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.pending';
 const fd=fs.openSync(temporary,'wx',0o600);
 try{fs.writeSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,file);
 const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
export function readRoundState(file:string,batchId:string,scope:any){
 if(usesStructuredStorage(file))return getRoundState(process.cwd(),file,batchId,scope);
 if(!stateFileExists(file))return null;
 const value=readStateFile(file);
 if(value.batchId!==batchId||!scope||!['appId','accountId','activityId','userId'].every(k=>value.scope?.[k]===scope[k]))throw Error('Round state batch/scope mismatch');
 return value;
}
