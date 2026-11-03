// Bounded acceptance driver: production main/runtime/device/model, four stages only.
// No task selection, task execution or result-store writes. No production modules edited.
import fs from 'node:fs';
import path from 'node:path';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sequence=['open_app','enter_activity','open_list','collect_list'];
const sessionUrl=pathToFileURL(path.resolve('runner/staged/session.ts')).href;
const source=`import fs from 'node:fs';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
export async function runActivitySession(session,deps){
 const sequence=${JSON.stringify(sequence)},stages=[],timings=[];let cleanup=null,error=null;
 const started=Date.now();let status='stopped';
 try{await deps.prepare();
  if(${JSON.stringify(process.argv.includes('--from-launcher'))}){
   const exec=promisify(execFile),args=['-s',process.env.ADB_SERIAL??'3d8a7934'];
   const home=await exec('adb',[...args,'shell','input','keyevent','KEYCODE_HOME'],{timeout:10000});
   const foreground=await exec('adb',[...args,'shell','dumpsys','activity','activities'],{timeout:10000,maxBuffer:8*1024*1024});
   fs.writeFileSync(path.join(session.evidenceDir,'acceptance-start-from-launcher.json'),JSON.stringify({at:new Date().toISOString(),homeStdout:home.stdout,foreground:foreground.stdout}));
  }
  for(const id of sequence){
   const at=Date.now();const r=await deps.stage(id,{...session,taskAttemptId:session.id+':collection-only',previousCheckpoint:stages.filter(s=>s.status==='completed').at(-1)?.checkpoint,stages:structuredClone(stages)});
   timings.push({stageId:id,ms:Date.now()-at});stages.push({...r,stageId:id});deps.persist?.({acceptanceOnly:true,session,status:'running',stages,timings});
   if(r.status!=='completed')throw Error(r.error??id+' stopped');
  }status='collected';
 }catch(e){error=String(e.message??e);}
 finally{try{cleanup=await deps.cleanup();}catch(e){status='unknown';error=[error,'Cleanup failed: '+String(e.message??e)].filter(Boolean).join('; ');}}
 const result={acceptanceOnly:true,status,error,runId:null,task:null,balanceBefore:null,balanceAfter:null,receipt:null,ledgerWritten:false,session,stages,timings,elapsedMs:Date.now()-started,cleanup};
 deps.persist?.(result);return result;
}`;
registerHooks({load(url,context,next){if(url===sessionUrl)return {format:'module',source,shortCircuit:true};return next(url,context);}});
const configFile=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))??'data/evidence/plans/stable-scripts-20261101/ai-flow-optimized-config.json');
const dry=process.argv.includes('--dry-run');
const {runStaged}=await import('../runner/staged/main.ts');
if(dry){console.log(JSON.stringify({driverStages:sequence,noTaskSelection:true,noStoreWrites:true,config:await runStaged(configFile,{live:false})},null,2));}
else{
 const root=path.resolve('runner/staged');const sources=fs.readdirSync(root).filter(f=>f.endsWith('.ts')).map(file=>{const original=path.join(root,file),bytes=fs.readFileSync(original);return {original,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};});
 const result=await runStaged(configFile,{live:true,startFromApp:true});
 const dir=result.session?.evidenceDir;if(!dir)throw Error('Missing acceptance evidence directory');
 const target=path.join(dir,'acceptance-sources');fs.mkdirSync(target,{recursive:false});
 const manifest=sources.map(s=>{if(createHash('sha256').update(fs.readFileSync(s.original)).digest('hex')!==s.sha256)throw Error('Implementation changed during acceptance');const file=path.join(target,path.basename(s.original));fs.writeFileSync(file,s.bytes,{flag:'wx',mode:0o600});return {original:s.original,path:file,sha256:s.sha256};});
 const driver=fs.readFileSync(import.meta.filename);fs.writeFileSync(path.join(target,'acceptance-driver.ts'),driver,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(dir,'acceptance-source-manifest.json'),JSON.stringify({acceptanceOnly:true,sessionOverride:source,files:manifest,driverSha256:createHash('sha256').update(driver).digest('hex')},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({acceptanceOnly:true,evidenceDir:dir,status:result.status,error:result.error,stages:result.stages.map((s:any)=>({stageId:s.stageId,status:s.status,error:s.error,actions:s.actions?.length??null})),timings:result.timings,elapsedMs:result.elapsedMs,ledgerWritten:false},null,2));
 if(result.status!=='collected')process.exitCode=1;
}
