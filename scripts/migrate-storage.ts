import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {acquireDeviceLock} from '../runner/device-lock.ts';
import {migrateStorage} from '../runner/storage/migrate.ts';

/** Acquires only the shared exclusion lock; no device/model/job execution. --target creates a validation copy. */
export async function main(args=process.argv.slice(2)){
 const options:Record<string,string>={};
 for(let i=0;i<args.length;i+=2){if(!['--root','--target','--manifest'].includes(args[i])||!args[i+1])throw Error('Usage: tsx scripts/migrate-storage.ts --root PROJECT [--target data/validation.db] [--manifest REPORT.json]');options[args[i]]=args[i+1];}
 const root=path.resolve(options['--root']??process.cwd());
 const lock=await acquireDeviceLock({lockRoot:path.join(root,'data/device-locks')});
 let manifest:any;
 try{manifest=await migrateStorage({root,target:options['--target']});}finally{lock.release();}
 const bytes=JSON.stringify(manifest,null,2)+'\n';
 if(options['--manifest']){const file=path.resolve(options['--manifest']);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes,{flag:'wx'});}
 console.log(JSON.stringify({target:manifest.target,quickCheck:manifest.quickCheck,documents:manifest.documents,reservations:manifest.reservations,roundStates:manifest.roundStates,alreadyMigrated:manifest.alreadyMigrated,manifest:options['--manifest']??'storage_meta.legacy_storage_v1'},null,2));return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(String(error));process.exitCode=1;});
