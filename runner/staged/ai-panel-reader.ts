import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';

export const AI_PANEL_VERSION='ai-panel-v1' as const;
export type AiPanelOwner={package:string;userId:number;[key:string]:unknown};
type Model={query:(request:any)=>Promise<any>;usage?:unknown[];modelName?:string};
const integer=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount=integer.nullable();
const text=z.string().trim().min(1).max(2000);
const box=z.tuple([z.number().finite(),z.number().finite(),z.number().finite(),z.number().finite()]);
// Extra reward metadata has no authority; required values still undergo full validation.
const quote=z.object({condition:text,reward:amount,rewardMin:amount,rewardMax:amount}).strip();
const task=z.object({name:text,instruction:text,done:integer,total:integer.positive(),reward:amount,rewardMin:amount,rewardMax:amount,rewardOffers:z.array(quote).max(20),button:text,bounds:box,buttonBounds:box,point:z.tuple([z.number().finite(),z.number().finite()])}).strict();
const schema=z.object({isPanel:z.boolean(),balance:amount,blocked:z.boolean(),top:z.boolean().nullable(),bottom:z.boolean().nullable(),tasks:z.array(task).max(50),clippedRows:z.array(text).max(50)}).strict();
export type AiPanel=Omit<z.infer<typeof schema>,'tasks'>&{tasks:(Pick<z.infer<typeof task>,'name'|'instruction'|'done'|'total'|'reward'|'button'>&Partial<z.infer<typeof task>>&{frameId:string})[]};
export type PanelReadMode={purpose:'selected-row'|'return-status'|'settlement';task:{name:string;instruction:string;done:number;total:number}};
const readModeSchema=z.object({purpose:z.enum(['selected-row','return-status','settlement']),task:z.object({name:text,instruction:text,done:integer,total:integer.positive()}).strict()}).strict();
// Status reads accept the old full response too, but only counter/identity fields carry authority.
const statusTask=task.pick({name:true,instruction:true,done:true,total:true}).strip();
const focusedSchema=z.object({isPanel:z.boolean(),balance:amount,blocked:z.boolean(),taskStatus:z.enum(['visible','absent','ambiguous','not-panel']),task:z.unknown().refine(v=>v!==undefined,'task is required')}).strict();
export type AiPanelEvidence={readMode?:PanelReadMode;version:typeof AI_PANEL_VERSION;frameId:string;sourcePngSha256:string;owner:AiPanelOwner;width:number;height:number;capturedAt:number;createdAt:string;modelName?:string;status:'accepted'|'rejected';error:string|null;usage:unknown[];rawResponse:{path:string;sha256:string}|null;path:string;sha256:string};

export const AI_PANEL_PROMPT=`Read the supplied ORIGINAL PNG directly. This is observation only: never propose actions, taps, waits, plans or device commands. Do not use OCR. Return ONE JSON object, no markdown, exactly:
{"isPanel":boolean,"balance":integer|null,"blocked":boolean,"top":boolean|null,"bottom":boolean|null,"tasks":[{"name":"exact original title WITHOUT quota","instruction":"exact visible action requirement WITHOUT reward icons, reward amounts or reward ranges; keep action durations such as 浏览5秒; multiple conditions remain separate","done":integer,"total":positive integer,"reward":integer|null,"rewardMin":integer|null,"rewardMax":integer|null,"rewardOffers":[{"condition":"exact original condition","reward":integer|null,"rewardMin":integer|null,"rewardMax":integer|null}],"button":"existing visible button label","bounds":[title left,top,right,bottom],"buttonBounds":[button left,top,right,bottom],"point":[button center x,button center y]}],"clippedRows":["exact visible fragments of partial or unreadable rows; explain clipping briefly"]}.
Coordinates are original image pixels. Read EVERY fully visible task row, including complete title, instruction, integer quota and its OWN unique existing button. Preserve original names and wording; never complete a cut-off row using guesses or prior knowledge. Exclude partial/ambiguous rows from tasks and record fragments in clippedRows. Unknown amount is null, never zero as a substitute. isPanel means the target Taobao coin task panel identified by visible owning page identity (赚金币抵钱 task list), not any task-like page. Read coin BALANCE from its owning header only, not cash equivalent, progress or reward. blocked means an independent overlay/login/security verification blocks the panel; the task panel itself is not a blocker. top refers to the START OF THE SCROLLABLE TASK LIST, not the screen header: the fixed 赚金币抵钱 title and balance stay visible on every scrolled page and are NEVER evidence of top. Set top=true only if the actual list-start reward/progress card (今日累计奖励 and 完成进度) is visible above the first task. If tasks start directly below the fixed title without that card, top=false. bottom=true only if the actual end disclaimer is visible beneath the final task; otherwise false or null. Do not infer bottom from the last visible row.
reward is ONLY the row's DISPLAYED independently available BROWSING/visit amount, not a promise of payment, never ordering, purchase, game or answering. Treat the global footer 以上奖励均为最高奖励，以实际获得奖励为准 as a global disclaimer, NOT an instruction to change every row's numeric field: a row showing 浏览 +50 always has reward=50 on every viewport. Only a row-specific 最高 or amount range changes that offer to rewardMax or rewardMin/rewardMax. For a range use reward=null and rewardMin/rewardMax; do not choose the lower bound. Preserve EVERY different reward condition in rewardOffers (including ordering maximums). instruction contains action/requirement words only, with reward amounts in reward fields: 浏览 +50 => instruction=浏览; 浏览5秒 +20 => instruction=浏览5秒. Multiple conditions must never be merged: a large order maximum is not the separate browse reward. Distinguish a row-specific maximum from a displayed amount using reward=null,rewardMin=null,rewardMax=value. For tasks with no independent browsing reward, reward=null. Unreadable geometry/identity/quotas means omit that task. All fields required; no extra fields.`;
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const json=(value:unknown)=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function requireFrame(frame:any,owner:AiPanelOwner){
 if(!frame||typeof frame.id!=='string'||!frame.id.trim()||typeof frame.path!=='string'||!path.isAbsolute(frame.path)||!Number.isSafeInteger(frame.width)||!Number.isSafeInteger(frame.height)||frame.width<=0||frame.height<=0||!Number.isFinite(frame.capturedAt)||frame.capturedAt<=0||!owner||typeof owner.package!=='string'||!owner.package.trim()||!Number.isSafeInteger(owner.userId)||owner.userId<0||frame.package!==owner.package||frame.userId!==owner.userId)throw Error('Invalid AI panel frame/owner');
 const bytes=fs.readFileSync(frame.path);
 if(bytes.length<33||bytes.length>20*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(8)!==13||bytes.readUInt32BE(16)!==frame.width||bytes.readUInt32BE(20)!==frame.height)throw Error('Invalid AI panel PNG');
 return hash(bytes);
}
function validate(raw:unknown,frame:any,targetOnly=false):AiPanel{
 const p=schema.parse(raw);
 const fail=()=>{throw Error('Invalid AI panel schema/geometry');};
 const range=(q:{reward:number|null;rewardMin:number|null;rewardMax:number|null})=>{
  if(q.reward!==null&&(q.rewardMin!==null||q.rewardMax!==null)||q.rewardMin!==null&&(q.rewardMax===null||q.rewardMin>q.rewardMax))fail();
 };
 const validBox=(b:number[])=>b[0]>=0&&b[1]>=0&&b[2]<=frame.width&&b[3]<=frame.height&&b[0]<b[2]&&b[1]<b[3];
 if(!p.isPanel&&(p.balance!==null||p.tasks.length||p.top===true||p.bottom===true))fail();
 for(let i=0;i<p.tasks.length;i++){
  const t=p.tasks[i],b=t.buttonBounds,cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2;
  if(t.done>t.total||!validBox(b)||t.point[0]<b[0]||t.point[0]>b[2]||t.point[1]<b[1]||t.point[1]>b[3]||!targetOnly&&(!validBox(t.bounds)||Math.abs(t.point[0]-cx)>1||Math.abs(t.point[1]-cy)>1||b[0]<t.bounds[2]||Math.abs(cy-(t.bounds[1]+t.bounds[3])/2)>150))fail();
  range(t);t.rewardOffers.forEach(range);
  for(let j=0;j<i;j++){
   const other=p.tasks[j],ob=other.buttonBounds;
   if(t.name===other.name&&t.instruction===other.instruction||Math.max(b[0],ob[0])<Math.min(b[2],ob[2])&&Math.max(b[1],ob[1])<Math.min(b[3],ob[3])||Math.max(t.bounds[1],other.bounds[1])<Math.min(t.bounds[3],other.bounds[3]))fail();
  }
 }
 return {...p,tasks:p.tasks.map(t=>({...t,frameId:frame.id}))};
}
function focusedPrompt(mode:PanelReadMode){
 const row=mode.purpose==='selected-row'?'{"name":"exact visible title","instruction":"exact action requirement, keep durations; exclude reward amounts","done":integer,"total":positive integer,"reward":integer|null,"rewardMin":integer|null,"rewardMax":integer|null,"rewardOffers":[{"condition":"exact original condition","reward":integer|null,"rewardMin":integer|null,"rewardMax":integer|null}],"button":"exact visible label","bounds":[left,top,right,bottom],"buttonBounds":[left,top,right,bottom],"point":[button center x,button center y]}':'{"name":"exact visible title","instruction":"exact visible action requirement without reward amounts","done":integer,"total":positive integer}';
 const requirements=mode.purpose==='selected-row'?'Selected-row requires exact current name, instruction, done and total, fully visible reward fields and its unique existing button geometry in ORIGINAL pixels. All reward amounts and ranges remain separate; unknown is null.':'Return-status establishes arrival at the owning task list; settlement reads its owning header balance. For both purposes, do not require button labels, geometry or reward metadata. Read the same task identity and its CURRENT done and total, even when total changed; preserve visible counters for the caller to assess contradictions. Unreadable or uncertain task state affects only task=null, not clear panel identity, header balance or independent blocker state.';
 return `Read the supplied ORIGINAL PNG directly, observation only; no OCR, actions or plans. Read ONLY the owning coin panel identity (赚金币抵钱), independent blockers, integer coin BALANCE from its owning header (not rewards/progress/cash equivalent) and the selected task's current state. Do not enumerate other tasks or infer inventory boundaries. Purpose and selected identity: ${JSON.stringify(mode)}. Return exactly {"isPanel":boolean,"balance":integer|null,"blocked":boolean,"taskStatus":"visible|absent|ambiguous|not-panel","task":null|${row}}. ${requirements} Never copy a missing row from selected identity: absent/clipped/unreadable means task=null; duplicate/uncertain identity means ambiguous and task=null. A replacement row is a different task. A non-panel has null balance, not-panel and null task. blocked=true ONLY when the current PNG visibly shows an actual login, CAPTCHA, slider/security verification or required authorization barrier that prevents safe continuation. A normal non-panel destination or ordinary promotional/retention popup is not a blocker merely because it covers content or is outside the coin panel. isPanel=false with taskStatus=not-panel does not imply blocked=true. If no such actual barrier is visible, report blocked=false so the caller can use its existing bounded return; this does not authorize any tap, promotion interaction or task completion. Classify from the current visible barrier itself, never from the selected task name, promotional keywords or missing panel identity. All reward amounts and ranges remain separate; unknown is null. top/bottom/tasks are forbidden. Only visible selected-row reads can authorize a tap; return/settlement never authorize taps.`;
}
function validateRead(raw:unknown,frame:any,readMode?:PanelReadMode):AiPanel&{inventoryComplete?:boolean;readPurpose?:PanelReadMode['purpose'];taskStatus?:string}{
 if(!readMode)return validate(raw,frame);
 const mode=readModeSchema.parse(readMode),p=focusedSchema.parse(raw);
 if(mode.task.done>mode.task.total||!p.isPanel&&(p.balance!==null||p.taskStatus!=='not-panel'||p.task!==null)||p.isPanel&&p.taskStatus==='not-panel')throw Error('Invalid focused panel state');
 if(mode.purpose==='selected-row'){
  if((p.taskStatus==='visible')!==(p.task!==null))throw Error('Invalid focused panel state');
  const t=p.task===null?null:task.parse(p.task);
  if(t&&(t.name!==mode.task.name||t.instruction!==mode.task.instruction||t.total!==mode.task.total||t.done!==mode.task.done))throw Error('Focused panel selected task mismatch');
  const panel=validate({isPanel:p.isPanel,balance:p.balance,blocked:p.blocked,top:null,bottom:null,tasks:t?[t]:[],clippedRows:[]},frame,true);
  return {...panel,inventoryComplete:false,readPurpose:mode.purpose,taskStatus:p.taskStatus};
 }
 let taskStatus=p.taskStatus;
 const parsed=statusTask.safeParse(p.task),t=parsed.success?parsed.data:null;
 const visible=taskStatus==='visible'&&t&&t.name===mode.task.name&&t.instruction===mode.task.instruction&&t.done<=t.total;
 if(taskStatus==='visible'&&!visible||taskStatus!=='visible'&&p.task!==null)taskStatus='ambiguous';
 // No coordinates are returned: these observations can never supply a clickable target.
 const tasks=visible?[{...t,reward:null,button:'',frameId:frame.id}]:[];
 return {isPanel:p.isPanel,balance:p.balance,blocked:p.blocked,top:null,bottom:null,tasks,clippedRows:[],inventoryComplete:false,readPurpose:mode.purpose,taskStatus};
}
function confined(file:string,dir:string){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.dirname(fs.realpathSync(file))!==dir)throw Error('AI evidence outside session');
 return fs.readFileSync(file);
}
/** One observation query, no retries. Caller attaches returned sidecar; original frame is never changed. */
export async function readAiPanel({frame,owner,model,modelName=model.modelName,evidenceDir,maxMs,readMode}:{frame:any;owner:AiPanelOwner;model:Model;modelName?:string;evidenceDir:string;maxMs:number;readMode?:PanelReadMode}):Promise<AiPanelEvidence>{
 if(readMode)readMode=readModeSchema.parse(readMode);
 const sourcePngSha256=requireFrame(frame,owner);
 const dir=fs.realpathSync(evidenceDir);
 if(dir!==path.dirname(fs.realpathSync(frame.path))||!Number.isFinite(maxMs)||maxMs<=0)throw Error('Invalid AI evidence session/budget');
 const stem=path.join(dir,'ai-panel-'+randomUUID()),usageStart=model.usage?.length??0;
 let rawResponse:AiPanelEvidence['rawResponse']=null,status:AiPanelEvidence['status']='rejected',error:string|null=null;
 try{
  const raw=await model.query({prompt:readMode?focusedPrompt(readMode):AI_PANEL_PROMPT,...(readMode?{panelReadMode:readMode}:{}),frame:{id:frame.id,path:frame.path,width:frame.width,height:frame.height,capturedAt:frame.capturedAt},maxMs});
  const bytes=json(raw),rawPath=stem+'.response.json';fs.writeFileSync(rawPath,bytes,{flag:'wx',mode:0o600});rawResponse={path:rawPath,sha256:hash(bytes)};
  validateRead(raw,frame,readMode);if(requireFrame(frame,owner)!==sourcePngSha256)throw Error('AI source changed during query');status='accepted';
 }catch{error=rawResponse?'AI panel schema or source validation failed':'AI panel query failed';}
 const manifest={version:AI_PANEL_VERSION,...(readMode?{readMode}:{}),frameId:frame.id,sourcePngSha256,owner:JSON.parse(JSON.stringify(owner)),width:frame.width,height:frame.height,capturedAt:frame.capturedAt,createdAt:new Date().toISOString(),...(modelName?{modelName}:{}),status,error,usage:(model.usage??[]).slice(usageStart),rawResponse};
 const bytes=json(manifest),file=stem+'.json';fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
 return {...manifest,path:file,sha256:hash(bytes)};
}
/** Synchronous consumption only; validates original PNG and persisted response on every read. */
export function loadAiPanel(frame:any,expectedMode?:PanelReadMode):ReturnType<typeof validateRead>|null{
 try{
  const e=frame?.aiPanelEvidence as AiPanelEvidence;if(!e||e.version!==AI_PANEL_VERSION||e.status!=='accepted'||e.error!==null||e.frameId!==frame.id||e.width!==frame.width||e.height!==frame.height||e.capturedAt!==frame.capturedAt||!Number.isFinite(Date.parse(e.createdAt))||requireFrame(frame,e.owner)!==e.sourcePngSha256)return null;
  if(expectedMode&&JSON.stringify(e.readMode)!==JSON.stringify(expectedMode))return null;
  const dir=path.dirname(fs.realpathSync(frame.path)),bytes=confined(e.path,dir);
  if(hash(bytes)!==e.sha256)return null;
  const manifest=JSON.parse(bytes.toString()),{path:_path,sha256:_hash,...expected}=e;
  if(JSON.stringify(manifest)!==JSON.stringify(expected)||!e.rawResponse)return null;
  const response=confined(e.rawResponse.path,dir);if(hash(response)!==e.rawResponse.sha256)return null;
  return validateRead(JSON.parse(response.toString()),frame,e.readMode);
 }catch{return null;}
}
