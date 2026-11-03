import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {withDeviceLock} from '../device-lock.ts';import {AdbOcrDevice} from './device.ts';import {reconcileStagedSession} from './reconcile.ts';import {saveStagedResult} from './store.ts';
const source=process.argv[2];if(!source)throw Error('Source result file required');const old=JSON.parse(fs.readFileSync(source,'utf8'));
const cfg=JSON.parse(fs.readFileSync(process.argv[3]??'config/staged/taobao.json','utf8'));
const evidenceDir=path.resolve('evidence/staged-reconcile-'+new Date().toISOString().replace(/[:.]/g,'-'));fs.mkdirSync(evidenceDir,{recursive:true});
const session={id:randomUUID(),evidenceDir,scope:cfg.scope,startedAt:new Date().toISOString(),configFile:path.resolve(process.argv[3]??'config/staged/taobao.json')};
const device=new AdbOcrDevice({serial:process.env.ADB_SERIAL??'3d8a7934',evidenceDir});
const r=await withDeviceLock(()=>reconcileStagedSession(old,session,device,v=>saveStagedResult({...v,scriptFiles:['runner/staged/reconcile.ts','runner/staged/reconcile-main.ts'],usage:null}),cfg));
fs.writeFileSync(path.join(evidenceDir,'recovery.json'),JSON.stringify(r,null,2));console.log(JSON.stringify({evidenceDir,status:r.status,sourceRunId:r.sourceRunId,runId:r.runId,balanceBefore:r.balanceBefore,balanceAfter:r.balanceAfter,gainCoins:r.gainCoins}));
