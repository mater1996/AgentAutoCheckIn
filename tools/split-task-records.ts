import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {splitTaskRecords,validateSplitTaskRecords} from '../runner/task-records-v2.ts';
import {assertLegacyWriterAllowed} from '../runner/storage/structured.ts';
assertLegacyWriterAllowed();
const root=process.cwd(),source='data/task-records/taobao/tb_main/tb_coin/bundle.json';
const v=splitTaskRecords(JSON.parse(fs.readFileSync(source,'utf8')));
const kdir='data/task-knowledge/'+v.knowledge.scope.appId+'/'+v.knowledge.scope.activityId;
const adir='data/account-task-data/'+v.accountData.scope.appId+'/'+v.accountData.scope.accountId+'/'+v.accountData.scope.activityId;
const payloads=new Map<string,Buffer>();const add=(f:string,value:any)=>payloads.set(f,Buffer.from(JSON.stringify(value,null,2)+'\n'));
for(const s of v.knowledge.scriptVersions){const old=s.path,archived=kdir+'/script-sources/'+s.id+'.ts';s.originalPath=old;s.path=archived;payloads.set(archived,fs.readFileSync(old));}
validateSplitTaskRecords(v);
const manifest:any={schemaVersion:2,sourceArchive:source,knowledgeBundle:kdir+'/bundle.json',accountBundle:adir+'/bundle.json',knowledgeRecords:{},accountRecords:{},automaticRunnerIntegrated:false};
for(const [part,dir,keys,recordKey]of [[v.knowledge,kdir,['taskDefinitions','scriptVersions','experienceVersions'],'knowledgeRecords'],[v.accountData,adir,['tasks','inventories','snapshots','plans','executions','progress'],'accountRecords']] as any[]){
 for(const key of keys){manifest[recordKey][key]=[];for(const row of part[key]){const file=dir+'/'+key+'/'+row.id+'.json';add(file,row);manifest[recordKey][key].push(file);}}
 add(dir+'/bundle.json',part);
}
add('data/task-records-v2/index.json',manifest);
for(const [f,bytes]of payloads)if(fs.existsSync(f)&&!fs.readFileSync(f).equals(bytes))throw Error('Archive differs; refuse overwrite '+f);
const backup=path.join('.backups','task-records-split-v2');const hashes:any[]=[];
const oldBase=path.dirname(source);const files=(d:string):string[]=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(d,e.name)):[path.join(d,e.name)]);
for(const f of files(oldBase)){const bytes=fs.readFileSync(f),dest=path.join(backup,f);fs.mkdirSync(path.dirname(dest),{recursive:true});if(fs.existsSync(dest)&&!fs.readFileSync(dest).equals(bytes))throw Error('Backup differs');if(!fs.existsSync(dest))fs.writeFileSync(dest,bytes,{flag:'wx'});hashes.push({file:f,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
const mf=path.join(backup,'manifest.json');if(!fs.existsSync(mf))fs.writeFileSync(mf,JSON.stringify(hashes,null,2)+'\n',{flag:'wx'});
for(const [f,bytes]of payloads){if(fs.existsSync(f))continue;fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp-'+process.pid;fs.writeFileSync(tmp,bytes,{flag:'wx'});fs.renameSync(tmp,f);}
console.log(JSON.stringify({knowledge:kdir,accountData:adir,index:'data/task-records-v2/index.json',writtenOrIdentical:payloads.size,backup,taskDefinitions:v.knowledge.taskDefinitions.length,experiences:v.knowledge.experienceVersions.length,executions:v.accountData.executions.map((e:any)=>e.runId),phoneUsed:false,databaseChanged:false},null,2));
