import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {withLocalPortalSession,PortalHttpClient,parsePortalEnvelope} from '../runner/portal-client.ts';import {portalNodes} from '../runner/portal-observation.ts';import {parseTreePage} from './lib/portal-tree-page.ts';
const dir=path.resolve('evidence/portal-rebind-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const adb=(...a:string[])=>execFileSync('adb',['-s','3d8a7934',...a],{encoding:'utf8',timeout:12000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));const summary:any={dir,before:[],after:[],rebind:'not-attempted',error:null};
await withLocalPortalSession(async client=>{
 const original=adb('shell','settings','get','secure','enabled_accessibility_services').trim();const enabled=adb('shell','settings','get','secure','accessibility_enabled').trim();
 const services=original.split(':').filter(Boolean);const portal=services.filter(s=>s.startsWith('com.mobilerun.portal/'));if(portal.length!==1)throw Error('Portal service missing or ambiguous');
 fs.writeFileSync(path.join(dir,'settings-before.json'),JSON.stringify({services:original,enabled},null,2));
 const fg=()=>adb('shell','dumpsys','activity','activities').split('\n').filter(l=>l.includes('topResumedActivity'));
 summary.foregroundBefore=fg();if(!summary.foregroundBefore.some((l:string)=>l.includes('u0 com.taobao.taobao/')))throw Error('Wrong foreground');
 if(!/mWakefulness=Awake/.test(adb('shell','dumpsys','power')))throw Error('Screen asleep');
 const capture=async(c:PortalHttpClient,label:string)=>{const d=await c.screenshot();fs.writeFileSync(path.join(dir,label+'.png'),Buffer.from(d.split(',')[1],'base64'));};
 const sample=async(c:PortalHttpClient,label:string)=>{for(let i=1;i<=3;i++){if(i>1)await delay(2000);const started=Date.now();try{const state:any=await c.readState();fs.writeFileSync(path.join(dir,`${label}-${i}.json`),JSON.stringify({at:Date.now(),state},null,2));let page:any;try{page=parseTreePage(state);}catch(e){page={error:e instanceof Error?e.message:'parse error'};}
 const item={i,ms:Date.now()-started,degraded:state.degraded??null,reason:state.degradedReason??null,age:state.snapshotAgeMs??null,top:page.raw?.atTop??null,bottom:page.raw?.atBottom??null,tasks:page.raw?.tasks??[],parseError:page.error??null};summary[label].push(item);console.log(label,JSON.stringify(item));
 }catch(e){summary[label].push({i,error:e instanceof Error?e.message:'read error'});}}};
 let mutationAttempted=false,extraPort='';
 try{
  await delay(6000);await capture(client,'before');await sample(client,'before');
  mutationAttempted=true;summary.rebind='attempted';
  try{adb('shell','settings','put','secure','enabled_accessibility_services',services.filter(s=>s!==portal[0]).join(':'));}catch{throw Error('Secure settings write denied; no alternative mutation attempted');}
  const disabledList=adb('shell','settings','get','secure','enabled_accessibility_services').trim();summary.disabledReadback=disabledList;
  if(disabledList.split(':').includes(portal[0]))throw Error('Portal removal not reflected');
  await delay(1500);const disconnected=adb('shell','dumpsys','accessibility');fs.writeFileSync(path.join(dir,'accessibility-disabled.txt'),disconnected);
  adb('shell','settings','put','secure','enabled_accessibility_services',original);if(adb('shell','settings','get','secure','accessibility_enabled').trim()!==enabled)adb('shell','settings','put','secure','accessibility_enabled',enabled);
  await delay(2500);summary.rebind='settings-restored';
  fs.writeFileSync(path.join(dir,'accessibility-after.txt'),adb('shell','dumpsys','accessibility'));
  adb('shell','content','insert','--uri','content://com.mobilerun.portal/toggle_socket_server','--bind','enabled:b:true');await delay(1000);
  extraPort=adb('forward','tcp:0','tcp:8080').trim();if(!/^\d+$/.test(extraPort))throw Error('Bad forward');const auth=parsePortalEnvelope(adb('shell','content','query','--uri','content://com.mobilerun.portal/auth_token'));if(auth.status!=='success'||typeof auth.result!=='string')throw Error('Auth failed');
  const fresh=new PortalHttpClient({baseUrl:'http://127.0.0.1:'+extraPort,token:auth.result,timeoutMs:8000});await fresh.ping();await delay(6000);summary.foregroundAfter=fg();await sample(fresh,'after');await capture(fresh,'after');summary.rebind='completed';
 }catch(e){summary.error=e instanceof Error?e.message:'Unknown failure';console.log('STOP',summary.error);}
 finally{
  if(mutationAttempted){const current=adb('shell','settings','get','secure','enabled_accessibility_services').trim();if(current!==original){try{adb('shell','settings','put','secure','enabled_accessibility_services',original);}catch{summary.restoreError='Service list restore failed';}}
   const nowEnabled=adb('shell','settings','get','secure','accessibility_enabled').trim();if(nowEnabled!==enabled){try{adb('shell','settings','put','secure','accessibility_enabled',enabled);}catch{summary.restoreError='Accessibility flag restore failed';}}
  }
  summary.settingsRestored=adb('shell','settings','get','secure','enabled_accessibility_services').trim()===original&&adb('shell','settings','get','secure','accessibility_enabled').trim()===enabled;
  if(extraPort)adb('forward','--remove','tcp:'+extraPort);fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));
 }
},{startServer:true,requestTimeoutMs:8000}).catch(e=>{summary.error??=e instanceof Error?e.message:'Session failure';fs.writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2));});
console.log('SUMMARY',JSON.stringify({dir,rebind:summary.rebind,error:summary.error,settingsRestored:summary.settingsRestored,before:summary.before.length,after:summary.after.length}));
