import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {withLocalPortalSession} from '../runner/portal-client.ts';import {portalNodes} from '../runner/portal-observation.ts';
const dir=path.resolve('evidence/portal-read-retries-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const reads:any[]=[];let failure:string|null=null;
const adb=(...a:string[])=>execFileSync('adb',['-s','3d8a7934',...a],{encoding:'utf8',timeout:12000,maxBuffer:5*1024*1024});
try{await withLocalPortalSession(async c=>{
 if(!/mWakefulness=Awake/.test(adb('shell','dumpsys','power')))throw Error('Screen asleep');
 if(!adb('shell','dumpsys','activity','activities').split('\n').some(l=>l.includes('topResumedActivity')&&l.includes('u0 com.taobao.taobao/')))throw Error('Wrong foreground');
 await new Promise(r=>setTimeout(r,6000));
 const shot=async(n:string)=>{const d=await c.screenshot();fs.writeFileSync(path.join(dir,n+'.png'),Buffer.from(d.split(',')[1],'base64'));};
 await shot('before');
 for(let i=1;i<=5;i++){
  if(i>1)await new Promise(r=>setTimeout(r,2000));
  const start=Date.now();let result:any;
  try{const s:any=await c.readState();fs.writeFileSync(path.join(dir,`read-${i}.json`),JSON.stringify({at:Date.now(),state:s},null,2));
   const ns=portalNodes(s.a11y_tree),texts=ns.filter(x=>x.node.isVisibleToUser).map(x=>x.node.text||x.node.contentDescription).filter(Boolean);
   result={i,elapsedMs:Date.now()-start,kind:s.degraded||s.degradedReason?'degraded':'normal-shape',reason:s.degradedReason??null,snapshotAgeMs:s.snapshotAgeMs??null,package:s.phone_state?.packageName,nodeCount:ns.length,texts};
  }catch(e){result={i,elapsedMs:Date.now()-start,kind:'error',error:e instanceof Error?e.message:'unknown'};}
  reads.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(dir,'reads.json'),JSON.stringify(reads,null,2));
 }
 await shot('after');
},{startServer:true,requestTimeoutMs:8000});}catch(e){failure=e instanceof Error?e.message:'unknown';}
const summary={dir,failure,total:reads.length,counts:Object.fromEntries(['normal-shape','degraded','error'].map(k=>[k,reads.filter(x=>x.kind===k).length])),reads};fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));console.log('SUMMARY',JSON.stringify({dir,failure,total:summary.total,counts:summary.counts}));
