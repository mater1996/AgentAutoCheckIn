// Explicitly approved one-off setup: stop user0 Alipay once, launch user0 Taobao once.
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {withDeviceLock} from '../runner/device-lock.ts';import {AdbOcrDevice} from '../runner/staged/device.ts';
import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
import {hasIdentityChallenge,observationTexts} from '../runner/staged/observations.ts';
const dir=path.resolve('evidence/approved-alipay-stop-restore-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
await withDeviceLock(async()=>{
 const d=new AdbOcrDevice({serial:'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true});
 const r:any={setupOnly:true,ledgerWritten:false,forceStopSent:false,launchSent:false,ready:false};
 const adb=(...args:string[])=>execFileSync('/opt/homebrew/bin/adb',['-s','3d8a7934',...args],{encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
 try{
  r.forceStop={at:new Date().toISOString(),user:0,package:'com.eg.android.AlipayGphone'};
  r.forceStopSent=true;r.forceStop.stdout=adb('shell','am','force-stop','--user','0','com.eg.android.AlipayGphone');
  fs.writeFileSync(path.join(dir,'force-stop.json'),JSON.stringify(r.forceStop,null,2));
  await d.prepare();await d.act({type:'launch',package:'com.taobao.taobao',userId:0});r.launchSent=true;
  const f=await d.capture();r.frame={id:f.id,path:f.path,package:f.package,userId:f.userId};
  if(f.package!=='com.taobao.taobao'||f.userId!==0)throw Error('Restoration target owner changed');
  if(hasIdentityChallenge(observationTexts(f)))throw Error('Restoration identity challenge; stop');
  r.inspection=await inspectCurrentActivityNavigation(f,{package:'com.taobao.taobao',userId:0});
  r.ready=!!r.inspection&&['home','landing','panel'].includes(r.inspection.state);
  if(!r.ready)throw Error('Taobao start page requires saved-image review');
 }catch(e:any){r.error=e.message;process.exitCode=1;}
 finally{
  try{r.cleanup=await d.cleanup();}catch(e:any){r.cleanupError=e.message;r.cleanup=JSON.parse(fs.readFileSync(path.join(dir,'cleanup.json'),'utf8'));process.exitCode=1;}
  if(!/mWakefulness=(Dozing|Asleep)/.test(r.cleanup.power??'')){
   adb('shell','input','keyevent','KEYCODE_SLEEP');await new Promise(resolve=>setTimeout(resolve,1000));
   r.sleepReadback={at:new Date().toISOString(),power:adb('shell','dumpsys','power')};
  }
  r.sleep=/mWakefulness=(Dozing|Asleep)/.test(r.sleepReadback?.power??r.cleanup.power??'');
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({dir,ready:r.ready,error:r.error??null,cleanupError:r.cleanupError??null,sleep:r.sleep,frame:r.frame}));
 }
});
