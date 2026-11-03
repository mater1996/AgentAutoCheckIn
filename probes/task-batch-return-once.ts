// Supervised batch setup only: one bounded system back; no task, settlement or ledger writes.
import fs from 'node:fs';import path from 'node:path';
import {withDeviceLock} from '../runner/device-lock.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {VisionClient} from '../runner/staged/vision-client.ts';
import {readAiPanel,loadAiPanel} from '../runner/staged/ai-panel-reader.ts';
import {inspectCurrentActivityNavigation} from '../runner/staged/activity-navigation.ts';
const cfg=JSON.parse(fs.readFileSync('data/evidence/plans/tasks-once-20261102/config.json','utf8'));
function credential(){const source=fs.readFileSync('runner/staged/main.ts','utf8');const exp=source.match(/apiKey:([^\n]+?),timeoutMs:/)?.[1];const env=exp?.match(/process\.env\.([A-Z_]+)/)?.[1];const literal=exp?.match(/\?\?\s*(['"])([^'"]+)\1/)?.[2];const value=process.env[cfg.model.apiKeyEnv]||(env&&process.env[env])||(new URL(cfg.model.baseUrl).hostname==='127.0.0.1'&&literal);if(!value)throw Error('Configured model credential unavailable');return value;}
const dir=path.resolve('evidence/task-batch-return-once-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(dir,{recursive:true,mode:0o700});
await withDeviceLock(async()=>{
 const device=new AdbOcrDevice({serial:'3d8a7934',evidenceDir:dir,frameMaxAgeMs:15000,allowVisualFallback:true});
 const model=new VisionClient({baseUrl:cfg.model.baseUrl,model:cfg.model.name,apiKey:credential(),timeoutMs:45000});
 const report:any={setupOnly:true,sourceRunId:224,taskReexecuted:false,ledgerWritten:false,backDispatched:false,panelConfirmed:false};
 try{await device.prepare();const frame:any=await device.capture();report.before=frame.path;
 if(frame.package!==cfg.package||frame.userId!==cfg.scope.userId)throw Error('Setup foreground changed');
 frame.aiPanelEvidence=await readAiPanel({frame,owner:{package:cfg.package,userId:0},model,evidenceDir:dir,maxMs:45000,readMode:{purpose:'return-status',task:{name:'充话费0元起！',instruction:'浏览5秒',done:0,total:1}}});
 fs.writeFileSync(frame.path.replace(/\.png$/,'.json'),JSON.stringify(frame,null,2));
 const panel=loadAiPanel(frame);if(!panel||panel.blocked)throw Error('Fresh return observation blocked or invalid');
 if(panel.isPanel){report.panelConfirmed=true;}else{report.backDispatched=true;await device.act({type:'back'},frame);await device.act({type:'wait',ms:800});const after=await device.capture();report.after=after.path;report.panelConfirmed=(await inspectCurrentActivityNavigation(after,{package:cfg.package,userId:0}))?.state==='panel';if(!report.panelConfirmed)throw Error('One back finished; destination requires fresh review, no further input');}
 }catch(e:any){report.error=e.message;process.exitCode=1;}finally{report.cleanup=await device.cleanup();report.usage=model.usage;fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({dir,...report}));}
});
