import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withDeviceLock} from '../runner/device-lock.ts';
import {PortalHttpClient,parsePortalEnvelope} from '../runner/portal-client.ts';
import {portalNodes} from '../runner/portal-observation.ts';
const exec=promisify(execFile), dir=path.resolve('evidence/portal-task-supervised-2026-10-31');
const label=process.argv[2], action=process.argv[3]||'read';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid label');
const adb=async(...a:string[])=>(await exec('adb',['-s','3d8a7934',...a],{timeout:12000,maxBuffer:6*1024*1024})).stdout;
await withDeviceLock(async()=>{
 let port='',started=false;
 const shot=async(suffix:string)=>{const p=path.join(dir,label+suffix+'.png');const r=await exec('adb',['-s','3d8a7934','exec-out','screencap','-p'],{encoding:'buffer',timeout:12000,maxBuffer:12*1024*1024});fs.writeFileSync(p,r.stdout);return p;};
 try{
  const fg=(await adb('shell','dumpsys','activity','activities')).split('\n').filter(l=>/topResumedActivity/.test(l));
  if(!fg.some(l=>l.includes('com.taobao.taobao/')))throw Error('Wrong foreground');
  if(!/mWakefulness=Awake/.test(await adb('shell','dumpsys','power')))throw Error('Screen asleep');
  await adb('shell','content','insert','--uri','content://com.mobilerun.portal/toggle_socket_server','--bind','enabled:b:true');started=true;
  port=(await adb('forward','tcp:0','tcp:8080')).trim();if(!/^\d+$/.test(port))throw Error('Invalid port');
  const a=parsePortalEnvelope(await adb('shell','content','query','--uri','content://com.mobilerun.portal/auth_token'));
  if(a.status!=='success'||typeof a.result!=='string')throw Error('Auth unavailable');
  const client=new PortalHttpClient({baseUrl:`http://127.0.0.1:${port}`,token:a.result,timeoutMs:8000});await client.ping();
  if(action==='open'){
   const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json'),'utf8'));
   if(Date.now()-before.capturedAt>180000)throw Error('Supervised confirmation expired');
   const matches=before.rows.filter((r:any)=>r.name==='抢更多超级秒杀好物'&&r.instruction==='浏览5秒'&&r.quota==='0/1'&&r.reward===20);
   if(matches.length!==1)throw Error('Task identity mismatch');
   const file=path.join(dir,'open-dispatch.json');fs.writeFileSync(file,JSON.stringify({at:Date.now(),target:matches[0],status:'dispatching'}),{flag:'wx'});
   const b=matches[0].button.bounds;const receipt=await client.tap(Math.round((b.left+b.right)/2),Math.round((b.top+b.bottom)/2));
   fs.writeFileSync(file,JSON.stringify({at:Date.now(),target:matches[0],receipt}));console.log('ACTION',receipt);
  }else if(action==='back'){
   const raw=await fetch(`http://127.0.0.1:${port}/global`,{method:'POST',headers:{Authorization:`Bearer ${a.result}`,'Content-Type':'application/x-www-form-urlencoded'},body:'action=1',signal:AbortSignal.timeout(8000)});
   const receipt=parsePortalEnvelope(await raw.text());console.log('BACK_STATUS',receipt.status);
   fs.writeFileSync(path.join(dir,label+'-action.json'),JSON.stringify({at:Date.now(),action:'global-back',status:receipt.status}));
  }else if(action!=='read')throw Error('Unknown action');
  console.log('IMMEDIATE',await shot('-immediate'));
  for(let i=1;i<=3;i++){
   try{
    const state:any=await client.readState();fs.writeFileSync(path.join(dir,`${label}-read-${i}.json`),JSON.stringify({at:Date.now(),state},null,2));
    console.log('STATE',JSON.stringify({i,degraded:state.degraded,age:state.snapshotAgeMs,package:state.phone_state?.packageName,texts:portalNodes(state.a11y_tree).filter(x=>x.node.isVisibleToUser).map(x=>x.node.text||x.node.contentDescription).filter(Boolean).slice(-80)}));
    if(!state.degraded&&!state.degradedReason)break;
   }catch{console.log('READ_FAILED',i);}
  }
  console.log('AFTER',await shot('-after'));
 }finally{
  try{if(started)await adb('shell','content','insert','--uri','content://com.mobilerun.portal/toggle_socket_server','--bind','enabled:b:false');}
  finally{if(port)await adb('forward','--remove',`tcp:${port}`);}
 }
});
