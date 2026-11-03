// Bounded test setup only: return from recognized panel/landing to recognized home.
import fs from 'node:fs';import path from 'node:path';
import {withDeviceLock} from '../runner/device-lock.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
const dir=path.resolve('evidence/home-acceptance-setup-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true});
const owner={package:'com.taobao.taobao',userId:0};
await withDeviceLock(async()=>{
 const device=new AdbOcrDevice({serial:'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true});const events:any[]=[];let home=false,error:string|null=null,cleanup:any;
 try{await device.prepare();for(let i=0;i<4;i++){
  const frame=await device.capture(),known=await inspectCurrentActivityNavigation(frame,owner);events.push({frameId:frame.id,path:frame.path,state:known?.state??'unknown',inspection:known});
  if(known?.state==='home'){home=true;break;}
  if(!known||!['panel','landing'].includes(known.state)||i===3)throw Error('Setup current page unknown or return bound exhausted');
  await device.act({type:'back'},frame);await device.act({type:'wait',ms:1000});
 }}catch(e:any){error=e.message;}finally{cleanup=await device.cleanup();}
 const report={setupOnly:true,home,error,events,cleanup};fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({dir,home,error,states:events.map(e=>e.state),sleep:/mWakefulness=(Dozing|Asleep)/.test(cleanup.power??'')}));if(!home)process.exitCode=1;
});
