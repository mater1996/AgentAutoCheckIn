import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {VisionClient} from '../runner/staged/vision-client.ts';
import {readAiPanel,loadAiPanel} from '../runner/staged/ai-panel-reader.ts';

const root=path.resolve(import.meta.dirname,'..');
const configFile=path.resolve(root,'data/evidence/plans/stable-scripts-20261101/available-entry-recovery-config.json');
const cfg=JSON.parse(fs.readFileSync(configFile,'utf8'));
const sourceDir=path.resolve(root,'evidence/staged-2026-11-01T23-38-18-381Z');
const ids=['4cfce720-55ce-4c26-bdbd-4f11d5d73eaf','e0880d1a-6cb5-41af-b16d-bae14f6a286a','04f46a15-6cc3-47ab-a0fc-f3450cd66a6d'];
const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// Match main's existing local fallback without printing, persisting or importing credentials.
function credential(){
 if(process.env.CHECKIN_VISION_API_KEY)return process.env.CHECKIN_VISION_API_KEY;
 const main=fs.readFileSync(path.join(root,'runner/staged/main.ts'),'utf8');
 const expression=main.match(/apiKey:(.*?),timeoutMs/)?.[1];
 const envName=expression?.match(/process\.env\.([A-Z_]+)/)?.[1];
 if(envName&&process.env[envName])return process.env[envName]!;
 const literal=expression?.match(/\?\?\s*(['"])([^'"]+)\1/)?.[2];
 if(literal&&new URL(cfg.model.baseUrl).hostname==='127.0.0.1')return literal;
 throw Error('Configured vision credential unavailable');
}
function relocate(value:any,dir:string):any{
 if(typeof value==='string'&&value.startsWith(sourceDir+path.sep))return dir+value.slice(sourceDir.length);
 if(Array.isArray(value))return value.map(v=>relocate(v,dir));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,relocate(v,dir)]));
 return value;
}
async function main(){
 const dir=path.join(root,'evidence','ai-panel-reader-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const write=(name:string,value:any)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
 const original=Object.fromEntries(ids.flatMap(id=>['png','json'].map(ext=>[id+'.'+ext,hash(path.join(sourceDir,id+'.'+ext))])));
 const report:any={kind:'real-configured-vision-offline-images',configFile,modelName:cfg.model.name,sourceDir,evidenceDir:dir,startedAt:new Date().toISOString(),maxMs:45000,actionFreshMs:15000,results:[],originalHashes:original};
 const model=new VisionClient({baseUrl:cfg.model.baseUrl,model:cfg.model.name,apiKey:credential(),timeoutMs:45000});
 try{
  for(const id of ids){
   fs.copyFileSync(path.join(sourceDir,id+'.png'),path.join(dir,id+'.png'));
   const frame=relocate(JSON.parse(fs.readFileSync(path.join(sourceDir,id+'.json'),'utf8')),dir);
   if(path.dirname(path.resolve(frame.path))!==dir)throw Error('Replay write target escaped session');
   write(id+'.json',frame);
   const start=Date.now();const evidence=await readAiPanel({frame,owner:{package:cfg.package,userId:cfg.scope.userId},model,modelName:cfg.model.name,evidenceDir:dir,maxMs:45000});
   frame.aiPanelEvidence=evidence;write(id+'.json',frame);
   const panel=loadAiPanel(frame),elapsedMs=Date.now()-start;
   const result={id,status:evidence.status,elapsedMs,exceedsActionFreshness:elapsedMs>15000,usage:evidence.usage,panel,evidencePath:evidence.path,error:evidence.error};
   report.results.push(result);write('report.json',report);
   console.log(JSON.stringify({id,status:evidence.status,elapsedMs,exceedsActionFreshness:elapsedMs>15000,usage:evidence.usage,balance:panel?.balance,tasks:panel?.tasks.length,evidenceDir:dir}));
   if(!panel||evidence.status!=='accepted')throw Error('Real model query/schema failed; stopped without retry or provider change');
   const u=model.usage.at(-1);if(u?.promptTokens===null||!u||u.promptTokens<2000)throw Error('Image token evidence unexpectedly small or missing; stop');
   if(panel.balance!==2265)throw Error('Real model balance differs from independent saved-image review; stop');
  }
 }catch(e){report.error=e instanceof Error?e.message:'Probe failed';process.exitCode=1;console.error(report.error);}
 finally{
  report.originalsUnchanged=Object.entries(original).every(([file,sha])=>hash(path.join(sourceDir,file))===sha);report.finishedAt=new Date().toISOString();report.usage=model.usage;
  write('report.json',report);console.log(JSON.stringify({evidenceDir:dir,completedImages:report.results.length,originalsUnchanged:report.originalsUnchanged,error:report.error??null}));
 }
}
main().catch(()=>{console.error('AI panel probe initialization failed');process.exitCode=1;});
