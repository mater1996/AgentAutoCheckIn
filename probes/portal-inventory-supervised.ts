import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PortalHttpClient,parsePortalEnvelope} from '../runner/portal-client.ts';
import {withDeviceLock} from '../runner/device-lock.ts';
async function withLocalPortalSession(fn:(c:PortalHttpClient)=>Promise<void>,_opts:unknown){
 return withDeviceLock(async()=>{
  let port='', started=false;
  try{
   // Supervised fallback: default service was independently observed stopped.
   const toggle=await adb('shell','content','insert','--uri','content://com.mobilerun.portal/toggle_socket_server','--bind','enabled:b:true');
   started=true;
   if(toggle.trim()&&!toggle.includes('Inserted content://com.mobilerun.portal/toggle_socket_server')){
    const response=parsePortalEnvelope(toggle);if(response.status!=='success')throw Error('Server startup rejected');
   }
   port=(await adb('forward','tcp:0','tcp:8080')).trim();if(!/^\d+$/.test(port))throw Error('Invalid forward');
   const auth=parsePortalEnvelope(await adb('shell','content','query','--uri','content://com.mobilerun.portal/auth_token'));
   if(auth.status!=='success'||typeof auth.result!=='string')throw Error('Auth unavailable');
   const client=new PortalHttpClient({baseUrl:`http://127.0.0.1:${port}`,token:auth.result,timeoutMs:8000});
   await client.ping();await fn(client);
  }finally{
   if(started)await adb('shell','content','insert','--uri','content://com.mobilerun.portal/toggle_socket_server','--bind','enabled:b:false');
   if(port)await adb('forward','--remove',`tcp:${port}`);
  }
 });
}
import {extractPortalRows,portalNodes, type PortalState} from '../runner/portal-observation.ts';
const exec=promisify(execFile);
const dir=path.resolve(process.env.PORTAL_SCAN_DIR || 'evidence/portal-inventory-supervised-2026-10-31');
fs.mkdirSync(dir,{recursive:true});
const label=process.argv[2]; if(!label||!/^[a-z0-9-]+$/.test(label))throw Error('label required');
const rules={panelText:'赚金币抵钱',titlePattern:'^(.+)[(]([0-9]+)/([0-9]+)[)]$',buttonTexts:['领取奖励','去完成','去逛逛','逛一逛']};
const adb=async(...a:string[])=>(await exec('adb',['-s','3d8a7934',...a],{timeout:12000,maxBuffer:4*1024*1024})).stdout;
try {
 await withLocalPortalSession(async client=>{
  const fg=async()=>{const s=await adb('shell','dumpsys','activity','activities');const line=s.split('\n').find(l=>/topResumedActivity/.test(l))||'';if(!line.includes('com.taobao.taobao/'))throw Error('Target app not foreground');return line.trim();};
  const before=await fg();
  const power=await adb('shell','dumpsys','power');if(!/mWakefulness=Awake/.test(power))throw Error('Screen not awake');
  if(process.argv[3]==='swipe'){
   const source=process.argv[4]; const p=JSON.parse(fs.readFileSync(path.join(dir,source+'.json'),'utf8'));
   if(Date.now()-p.capturedAt>180000||p.state.degraded||p.state.degradedReason)throw Error('Source expired or degraded');
   const [startX,startY,endX,endY]=process.argv.slice(5).map(Number);
   if([startX,startY,endX,endY].some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid swipe');
   const receipt=await client.swipe({startX,startY,endX,endY,duration:450});
   fs.writeFileSync(path.join(dir,label+'-action.json'),JSON.stringify({source,receipt,startX,startY,endX,endY}));
   if(receipt.portalStatus!=='success')throw Error('Swipe rejected; do not retry');
  }
  let state:PortalState|undefined;const attempts=[];
  for(let i=1;i<=3;i++){
   const started=Date.now(); let s:PortalState;
   try { s=await client.readState() as PortalState; }
   catch {attempts.push({i,durationMs:Date.now()-started,error:'Read rejected or unavailable'});continue;}
   const capturedAt=Date.now();
   fs.writeFileSync(path.join(dir,`${label}-read-${i}.json`),JSON.stringify({started,capturedAt,state:s},null,2));
   attempts.push({i,durationMs:capturedAt-started,degraded:s.degraded,reason:s.degradedReason,age:s.snapshotAgeMs});
   if(!s.degraded&&!s.degradedReason){state=s;break;}
  }
  if(!state)throw Error('No normal response within 3 reads');
  if(state.phone_state.packageName!=='com.taobao.taobao')throw Error('Portal package mismatch');
  const rows=extractPortalRows(state,rules); const after=await fg();
  const shot=await exec('adb',['-s','3d8a7934','exec-out','screencap','-p'],{encoding:'buffer',timeout:12000,maxBuffer:12*1024*1024});
  fs.writeFileSync(path.join(dir,label+'.png'),shot.stdout);
  const report={label,capturedAt:Date.now(),before,after,attempts,state,rows};
  fs.writeFileSync(path.join(dir,label+'.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({dir,label,attempts,rows,texts:portalNodes(state.a11y_tree).filter(x=>x.node.isVisibleToUser).map(x=>x.node.text||x.node.contentDescription).filter(Boolean).slice(-60)},null,2));
 },{startServer:true,requestTimeoutMs:8000});
 console.log('SESSION_CLEANUP_OK');
}catch(e){console.log('STOP',e instanceof Error?e.message:'unknown');process.exitCode=1;}
