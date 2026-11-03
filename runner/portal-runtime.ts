import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withLocalPortalSession,type LocalPortalSessionOptions,type PortalExec} from './portal-client.ts';
import {PortalVision} from './portal-vision.ts';
const execAsync=promisify(execFile);

type SessionOptions=Omit<HybridOptions,'portal'|'capture'|'foreground'|'vision'> & {
 session?:LocalPortalSessionOptions;vision?:PortalVision;
};
/** One owner holds phone exclusion through observation, dispatch and both cleanups. */
export async function withPortalHybridSession<T>(fn:(bridge:PortalHybrid)=>Promise<T>,opts:SessionOptions){
 const vision=opts.vision??new PortalVision();
 const serial=opts.session?.serial??process.env.ADB_SERIAL??'3d8a7934';
 const run:PortalExec=opts.session?.exec??(async(file,args)=>{
  const r=await execAsync(file,args,{encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024});return {stdout:r.stdout};
 });
 try{
  return await withLocalPortalSession(async portal=>{
   try{
    const bridge=createPortalHybrid({...opts,portal,vision,foreground:async()=>{
     let raw:string;
     try{raw=(await run('adb',['-s',serial,'shell','dumpsys','activity','activities'])).stdout;}
     catch{throw Error('Foreground read failed');}
     const lines=raw.split('\n').filter(l=>/topResumedActivity|mResumedActivity/.test(l));
     const packages=[...new Set(lines.map(l=>l.match(/\bu\d+\s+([\w.]+)\//)?.[1]).filter(Boolean))];
     if(packages.length!==1)throw Error('Foreground missing or ambiguous');return packages[0]!;
    }});
    const value=await fn(bridge);return {value,usage:vision.usage};
   }finally{await vision.destroy();}
  },{...opts.session,serial});
 }finally{await vision.destroy();}
}

import {PortalHybrid,type HybridOptions} from './portal-hybrid.ts';
/** Compose public clients; session owner holds the device lock and destroys vision. */
export function createPortalHybrid(opts:Omit<HybridOptions,'capture'> & {
 portal:HybridOptions['portal'] & {screenshot():Promise<string>};
}):PortalHybrid{
 const now=opts.now??Date.now;
 return new PortalHybrid({...opts,capture:async()=>{
  const startedAt=now();
  const raw=await opts.portal.screenshot();
  const dataUrl=raw.startsWith('data:')?raw:`data:image/png;base64,${raw}`;
  const {imageInfoOfBase64}=await import('@midscene/shared/img');
  const info=await imageInfoOfBase64(dataUrl);
  return {id:randomUUID(),dataUrl,width:info.width,height:info.height,capturedAt:startedAt};
 }});
}
