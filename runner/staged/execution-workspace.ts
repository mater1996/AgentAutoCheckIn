import fs from 'node:fs';
import path from 'node:path';
import {writeRoundState} from './round-state.ts';
export function inheritRoundAttempts(saved:any,additional:any[]){
 const attempts=structuredClone(saved?.attempts??[]);
 for(const a of additional)if(!attempts.some((p:any)=>p.identity===a.identity&&p.status===a.status))attempts.push(structuredClone(a));
 return attempts;
}
/** One root per activity execution; batches and device lifecycle are independent. */
export function createExecutionWorkspace(options:any){
 const evidenceDir=options.evidenceDir?path.resolve(options.evidenceDir):path.resolve(options.evidenceRoot,'round-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+options.id);
 fs.mkdirSync(evidenceDir,{recursive:!!options.evidenceDir,mode:0o700});
 const existing=options.evidenceDir&&fs.existsSync(path.join(evidenceDir,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(evidenceDir,'manifest.json'),'utf8')):null;
 const manifest:any=existing??{schemaVersion:1,id:options.id,batchId:options.batchId,scope:options.scope,evidenceDir,startedAt:new Date().toISOString(),tasks:[],files:[]};
 if(manifest.id!==options.id||manifest.batchId!==options.batchId)throw Error('Execution manifest identity mismatch');
 const target=(name:string)=>{const p=path.resolve(evidenceDir,name);if(!p.startsWith(evidenceDir+path.sep))throw Error('Execution artifact outside root');return p;};
 const save=(name:string,value:any)=>writeRoundState(target(name),value);
 const event=(kind:string,data:any={})=>{const fd=fs.openSync(target('events.jsonl'),'a',0o600);try{fs.writeSync(fd,JSON.stringify({at:new Date().toISOString(),executionId:options.id,kind,...data})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 save('manifest.json',manifest);fs.closeSync(fs.openSync(target('runner.log'),'a',0o600));event('execution_created');
 const registerTask=(task:any)=>{const dir=target(path.relative(evidenceDir,path.resolve(task.evidenceDir)));fs.mkdirSync(dir,{recursive:true});manifest.tasks.push({...task,evidenceDir:path.relative(evidenceDir,dir)});save('manifest.json',manifest);event('task_registered',task);};
 const finalize=(state:any)=>{
  manifest.status=state.status;manifest.finishedAt=new Date().toISOString();
  const walk=(dir:string):any[]=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const p=path.join(dir,e.name);return e.isDirectory()?walk(p):e.isFile()?[{path:path.relative(evidenceDir,p),bytes:fs.statSync(p).size}]:[];});
  manifest.files=walk(evidenceDir);manifest.tasks=manifest.tasks.map((t:any)=>({...t,...(state.attempts??[]).find((a:any)=>a.result?.taskAttemptId===t.taskAttemptId)}));
  const results=(state.attempts??[]).filter((a:any)=>a.result?.roundId===options.id).map((a:any)=>a.result);
  save('summary.json',{executionId:options.id,status:state.status,reason:state.reason,errors:state.errors??[],attempted:results.filter((r:any)=>r.entryDispatched).length,completed:results.filter((r:any)=>r.status==='completed'&&r.gainCoins>0).length,gainCoins:results.reduce((n:number,r:any)=>n+(typeof r.gainCoins==='number'?r.gainCoins:0),0),tasks:results,latestPlan:state.revisions?.at(-1)?.plan??null,finish:state.finish,cleanup:state.cleanup});
  manifest.files=walk(evidenceDir);save('manifest.json',manifest);event('execution_finished',{status:state.status,reason:state.reason});
 };
 const captureProcessOutput=()=>{
  const fd=fs.openSync(target('runner.log'),'a',0o600),originalOut=process.stdout.write,originalErr=process.stderr.write;
  const wrap=(original:any,stream:any)=>(chunk:any,...args:any[])=>{fs.writeSync(fd,Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk),typeof args[0]==='string'?args[0] as BufferEncoding:'utf8'));return original.call(stream,chunk,...args);};
  process.stdout.write=wrap(originalOut,process.stdout) as any;process.stderr.write=wrap(originalErr,process.stderr) as any;
  return ()=>{process.stdout.write=originalOut;process.stderr.write=originalErr;fs.fsyncSync(fd);fs.closeSync(fd);};
 };
 return {evidenceDir,save,event,registerTask,finalize,captureProcessOutput};
}
