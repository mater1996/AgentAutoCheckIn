import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withDeviceLock} from '../runner/device-lock.ts';
const exec=promisify(execFile);
const dir=path.resolve('evidence/portal-config-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(dir,{recursive:true});
await withDeviceLock(async()=>{
 const results: Record<string,unknown>={};
 const read=async(name:string,args:string[],select?:(s:string)=>unknown)=>{
  try {const r=await exec('adb',['-s','3d8a7934',...args],{timeout:12000,maxBuffer:4*1024*1024}); results[name]={ok:true,value:select?select(r.stdout):r.stdout.trim()};}
  catch {results[name]={ok:false,error:'Read failed; raw output omitted'};}
 };
 await read('accessibilityEnabled',['shell','settings','get','secure','accessibility_enabled']);
 await read('portalAccessibilityListed',['shell','settings','get','secure','enabled_accessibility_services'],s=>s.split(':').filter(x=>x.includes('com.mobilerun.portal')).map(x=>x.trim()));
 await read('accessibilityServiceBinding',['shell','dumpsys','accessibility'],s=>s.split('\n').filter(l=>l.includes('com.mobilerun.portal')).map(l=>l.trim()));
 await read('deviceIdleWhitelist',['shell','dumpsys','deviceidle','whitelist'],s=>({portalEntries:s.split('\n').filter(l=>l.includes('com.mobilerun.portal')),miuiPowerkeeperEntries:s.split('\n').filter(l=>l.includes('com.miui.powerkeeper'))}));
 for(const op of ['RUN_IN_BACKGROUND','RUN_ANY_IN_BACKGROUND','SYSTEM_ALERT_WINDOW']) await read(op,['shell','cmd','appops','get','com.mobilerun.portal',op]);
 await read('standbyBucket',['shell','am','get-standby-bucket','com.mobilerun.portal']);
 await read('power',['shell','dumpsys','power'],s=>s.split('\n').filter(l=>/mWakefulness=|mIsPowered=|mStayOn=|mStayOnWhilePluggedInSetting=/.test(l)));
 await read('screenOffTimeout',['shell','settings','get','system','screen_off_timeout']);
 await read('stayOnWhilePluggedIn',['shell','settings','get','global','stay_on_while_plugged_in']);
 await read('lowPower',['shell','settings','get','global','low_power']);
 await read('portalKeepAwake',['shell','content','query','--uri','content://com.mobilerun.portal/screen_keep_awake_status']);
 await read('localListeners',['shell','ss','-ltn'],s=>s.split('\n').filter(l=>/State|:8080\b|:8081\b/.test(l)));
 await read('portalServices',['shell','dumpsys','activity','services','com.mobilerun.portal'],s=>s.split('\n').filter(l=>/ServiceRecord\{|isForeground=|startRequested=|app=ProcessRecord/.test(l)));
 await read('forwardList',['forward','--list']);
 await read('foreground',['shell','dumpsys','activity','activities'],s=>s.split('\n').filter(l=>/topResumedActivity|mResumedActivity/.test(l)));
 fs.writeFileSync(path.join(dir,'settings.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({dir,results},null,2));
});
