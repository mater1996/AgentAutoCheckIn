// Supervised start-point restoration only; no task, login, foreign-app input or accounting.
import fs from 'node:fs';import path from 'node:path';
import {withDeviceLock} from '../runner/device-lock.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
import {hasIdentityChallenge,observationTexts} from '../runner/staged/observations.ts';
const dir=path.resolve('evidence/taobao-launcher-restore-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const owner={package:'com.taobao.taobao',userId:0};
await withDeviceLock(async()=>{
 const d=new AdbOcrDevice({serial:'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true});
 const r:any={setupOnly:true,ledgerWritten:false,launchSent:false,owner,ready:false};
 try{
  await d.prepare();
  await d.act({type:'launch',...owner});r.launchSent=true;
  const f=await d.capture();r.frame={id:f.id,path:f.path,package:f.package,userId:f.userId};
  if(f.package!==owner.package||f.userId!==owner.userId)throw Error('Restoration target owner changed');
  if(hasIdentityChallenge(observationTexts(f)))throw Error('Restoration identity challenge; stop');
  const known=await inspectCurrentActivityNavigation(f,owner);r.inspection=known;r.ready=!!known&&['home','landing','panel'].includes(known.state);
  if(!r.ready)throw Error('Taobao brought forward; start page requires saved-image review');
 }catch(e:any){r.error=e.message;process.exitCode=1;}
 finally{r.cleanup=await d.cleanup();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({dir,ready:r.ready,launchSent:r.launchSent,error:r.error??null,frame:r.frame,sleep:/mWakefulness=(Dozing|Asleep)/.test(r.cleanup.power??'')}));}
});
