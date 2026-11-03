import fs from 'node:fs';
import path from 'node:path';
/** Private session observations/routes. Stage intent never supplies page identity. */
export function createNavigationRecords(evidenceDir:string,sessionId:string){
 const file=path.join(evidenceDir,'navigation-records.jsonl');
 const write=(record:any)=>{fs.mkdirSync(evidenceDir,{recursive:true,mode:0o700});fs.appendFileSync(file,JSON.stringify({version:'navigation-records-v1',sessionId,at:Date.now(),...record})+'\n',{mode:0o600});};
 const observations=new Map<string,any>(),pending=new Map<string,any>();
 return {
  observe(frame:any,context:any,inspection:any){
   const record={frameId:frame.id,path:frame.path,rawOcrPath:frame.path.replace(/\.png$/,'.ocr.json'),capturedAt:frame.capturedAt,package:frame.package,userId:frame.userId,stageId:context.stageId,taskAttemptId:context.taskAttemptId??null,expectedCheckpoint:context.expectedCheckpoint??null,pageKind:inspection?.state??'unknown',source:inspection?.provenance??null,systemObservation:frame.systemObservation??null};
   observations.set(frame.id,record);write({kind:'observation',...record});return record;
  },
  dispatched(stageId:string,frame:any,action:any,status:string){const before=observations.get(frame.id)??{frameId:frame.id,pageKind:'unknown'};const route={stageId,before,action,status,dispatchedAt:pending.get(stageId)?.dispatchedAt??Date.now()};pending.set(stageId,route);write({kind:'dispatch',...route});},
  finish(stageId:string,result:any){const route=pending.get(stageId);if(!route)return;pending.delete(stageId);const last=(result.events??[]).filter((e:any)=>e.type==='observed').at(-1)?.frame;const after=last?observations.get(last.id):null;const expected=stageId==='enter_activity'?['landing','panel']:['panel'];const confirmed=route.status==='sent'&&result.status==='completed'&&after&&after.frameId!==route.before.frameId&&after.capturedAt>=route.dispatchedAt&&expected.includes(after.pageKind);write({kind:'arrival',...route,after:after??null,status:confirmed?'confirmed':'unknown'});},
 };
}
