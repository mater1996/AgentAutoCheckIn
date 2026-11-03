// One supervised test-setup return. Not production recovery or acceptance evidence.
import fs from 'node:fs';import path from 'node:path';
import {withDeviceLock} from '../runner/device-lock.ts';import {AdbOcrDevice} from '../runner/staged/device.ts';import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
const dir=path.resolve('evidence/supervised-home-return-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
await withDeviceLock(async()=>{const d=new AdbOcrDevice({serial:'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true});let error=null,home=false;const frames:any[]=[];
try{await d.prepare();const before=await d.capture();frames.push(before);const texts=before.lines.map(l=>l.text.normalize('NFKC').replace(/\s/g,''));
if(before.package!=='com.taobao.taobao'||before.userId!==0||before.observationError||texts.filter(t=>t==='去赚金币').length!==1||!texts.some(t=>/^币?淘金币$/.test(t))||/登录|验证|允许|温馨提示|确认|同意/.test(texts.join('')))throw Error('Supervised landing setup no longer matches');
await d.act({type:'back'},before);await d.act({type:'wait',ms:1000});const after=await d.capture();frames.push(after);home=(await inspectCurrentActivityNavigation(after,{package:'com.taobao.taobao',userId:0}))?.state==='home';
}catch(e:any){error=e.message;}finally{const cleanup=await d.cleanup();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({supervisedSetup:true,home,error,frames,cleanup},null,2));console.log(JSON.stringify({dir,home,error,images:frames.map(f=>f.path),sleep:/mWakefulness=(Dozing|Asleep)/.test(cleanup.power??'')}));if(error)process.exitCode=1;}});
