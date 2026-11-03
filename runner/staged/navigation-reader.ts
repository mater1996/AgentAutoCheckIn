import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
export const NAVIGATION_READER_VERSION='navigation-reader-v1';
export const NAVIGATION_PROMPT=`Read this ORIGINAL PNG directly, observation only. Return one strict JSON object {"pageKind":"home|landing|panel|blocked","targets":[{"text":"领淘金币|去赚金币","bounds":[left,top,right,bottom]}]}. No actions, commands, plans, task rows or amounts. Identify actual Taobao home from visible home chrome and navigation; coin landing from explicit coin identity and its own entry; panel only from the coin task-list identity. Independent overlays, login, security, unreadable or unknown pages mean blocked. home requires exactly one visible unobscured 领淘金币; landing exactly one visible unobscured 去赚金币. Report all matching targets, never choose among duplicates; ambiguity must be blocked. panel/blocked require empty targets. Bounds use original image pixels. Reject purchase, payment, redemption, account, permission, verification or modal controls. Do not infer page identity from the intended stage.`;
const schema=z.object({pageKind:z.enum(['home','landing','panel','blocked']),targets:z.array(z.object({text:z.enum(['领淘金币','去赚金币']),bounds:z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()])}).strict()).max(10)}).strict();
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const encode=(v:any)=>Buffer.from(JSON.stringify(v,null,2)+'\n');
function source(frame:any,owner:any){
 if(!frame||!frame.id?.trim()||!path.isAbsolute(frame.path)||!frame.path.endsWith('.png')||owner.package!=='com.taobao.taobao'||!Number.isSafeInteger(owner.userId)||owner.userId<0||frame.package!==owner.package||frame.userId!==owner.userId||frame.width!==1080||frame.height!==2400||!Number.isSafeInteger(frame.capturedAt))throw Error('Navigation frame/owner invalid');
 const bytes=fs.readFileSync(frame.path);
 if(bytes.length<33||bytes.length>20*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==frame.width||bytes.readUInt32BE(20)!==frame.height)throw Error('Navigation PNG invalid');
 return sha(bytes);
}
function observation(raw:any,frame:any){
 const parsed=schema.parse(raw),kind=parsed.pageKind;
 if(kind==='home'||kind==='landing'){
  if(parsed.targets.length!==1||parsed.targets[0].text!==(kind==='home'?'领淘金币':'去赚金币'))throw Error('Navigation target not unique');
  const b=parsed.targets[0].bounds;
  if(b[0]<0||b[2]>frame.width||b[1]<frame.height*.12||b[3]>frame.height*.92||b[0]>=b[2]||b[1]>=b[3]||b[2]-b[0]>frame.width*.8||b[3]-b[1]>frame.height*.2)throw Error('Navigation unsafe bounds');
  return {state:kind,action:{type:'tap',x:Math.round((b[0]+b[2])/2),y:Math.round((b[1]+b[3])/2)},target:parsed.targets[0]};
 }
 if(parsed.targets.length)throw Error('Navigation panel/blocked cannot authorize target');
 return {state:kind};
}
function confined(file:string,dir:string){if(!path.isAbsolute(file)||path.dirname(fs.realpathSync(file))!==dir)throw Error('Navigation evidence outside session');return fs.readFileSync(file);}
/** Bounded observation only. Caller provides freshness and session/stage budget. No retries. */
export async function readNavigation({frame,owner,evidenceDir,model,maxMs,stageId,expectedCheckpoint}:any){
 const pngSha256=source(frame,owner),dir=fs.realpathSync(evidenceDir);
 if(path.dirname(fs.realpathSync(frame.path))!==dir||!Number.isFinite(maxMs)||maxMs<=0)throw Error('Navigation session/budget invalid');
 const original=JSON.parse(confined(frame.path.replace(/\.png$/,'.json'),dir).toString());
 for(const key of ['id','path','capturedAt','width','height','package','userId','observationError'])if(original[key]!==frame[key])throw Error('Navigation saved frame mismatch');
 if(JSON.stringify(original.lines)!==JSON.stringify(frame.lines))throw Error('Navigation saved OCR mismatch');
 const stem=path.join(dir,'navigation-reader-'+randomUUID()),usageStart=model.usage?.length??0;
 let rawResponse:any=null,status='rejected',error:string|null=null,timer:any;
 try{
  const query=model.query({prompt:NAVIGATION_PROMPT,frame:{id:frame.id,path:frame.path,width:frame.width,height:frame.height,capturedAt:frame.capturedAt},maxMs});
  const raw=await (model.hostManagedDecisions===true?query:Promise.race([query,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Navigation reader timeout')),maxMs);})]));
  const bytes=encode(raw),file=stem+'.response.json';fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});rawResponse={path:file,sha256:sha(bytes)};
  observation(raw,frame);if(source(frame,owner)!==pngSha256)throw Error('Navigation source changed');status='accepted';
 }catch{error=rawResponse?'Navigation schema/source rejected':'Navigation query failed';}finally{clearTimeout(timer);}
 const manifest={version:NAVIGATION_READER_VERSION,frameId:frame.id,pngSha256,owner:{package:owner.package,userId:owner.userId},width:frame.width,height:frame.height,capturedAt:frame.capturedAt,stageId,expectedCheckpoint,status,error,rawResponse,usage:(model.usage??[]).slice(usageStart)};
 const bytes=encode(manifest),file=stem+'.json';fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});return {...manifest,path:file,sha256:sha(bytes)};
}
/** Revalidates saved source, manifest, owner, stage and raw response; no second query. */
export function loadNavigation(frame:any,owner:any,binding:{stageId:string;expectedCheckpoint:string},evidence=frame.navigationEvidence):any{
 try{
  const e=evidence;if(!e||e.version!==NAVIGATION_READER_VERSION||e.status!=='accepted'||e.error!==null||e.frameId!==frame.id||e.capturedAt!==frame.capturedAt||e.width!==frame.width||e.height!==frame.height||e.owner.package!==owner.package||e.owner.userId!==owner.userId||e.stageId!==binding.stageId||e.expectedCheckpoint!==binding.expectedCheckpoint||source(frame,owner)!==e.pngSha256)return null;
  const dir=path.dirname(fs.realpathSync(frame.path)),bytes=confined(e.path,dir),{path:_,sha256:__,...manifest}=e;
  if(sha(bytes)!==e.sha256||JSON.stringify(JSON.parse(bytes.toString()))!==JSON.stringify(manifest)||!e.rawResponse)return null;
  const response=confined(e.rawResponse.path,dir);if(sha(response)!==e.rawResponse.sha256)return null;
  return {...observation(JSON.parse(response.toString()),frame),frameId:frame.id,pngSha256:e.pngSha256,version:NAVIGATION_READER_VERSION,provenance:{version:NAVIGATION_READER_VERSION,policy:'current-text-v1',evidence:{path:e.path,sha256:e.sha256}}};
 }catch{return null;}
}
