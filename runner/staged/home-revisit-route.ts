import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {DeviceAction,DeviceFrame} from './device.ts';
import type {RawBatch} from './raw-capture.ts';
import {inspectCurrentActivityNavigation} from './activity-navigation.ts';
import {readPanel,hasIdentityChallenge,observationTexts,validateProposedAction} from './observations.ts';
import {observeHomeRewardAttribution,type HomeRewardFrame,type HomeRewardObservation} from './home-revisit.ts';

type Page=HomeRewardObservation['page'];
type Role='guide-home'|'home-coin'|'open-panel'|'exit';
type Step={from:Page;to:Page;role:Role|'back'};
export type HomeRevisitRouteDeps={
 observe:()=>Promise<DeviceFrame>;
 query:(prompt:string,frame:DeviceFrame,context:any)=>Promise<any>;
 dispatch:(action:DeviceAction,frame?:DeviceFrame)=>Promise<unknown>;
 scrollContinuously?:(action:any,frame:DeviceFrame,limits:any)=>Promise<unknown>;
 captureRawBurst?:(request:{frame:DeviceFrame;frames:number;intervalMs:number;maxMs:2000})=>Promise<RawBatch>;
 deriveRawFrames?:(batch:RawBatch,limits:{budgetMs:number})=>Promise<DeviceFrame[]>;
 /** Must durably commit each reservation before resolving. Fail closed on write failure. */
 persist:(event:any)=>void|Promise<void>;
};
const equal=(a:string,b:string)=>typeof a==='string'&&typeof b==='string'&&a.normalize('NFKC').trim()===b.normalize('NFKC').trim();
const prompt=`Read this ORIGINAL PNG in full with current bound home-revisit context. Do not infer pages/actions from the task title or history, and never reuse historical geometry. Return JSON {binding: EXACT context.binding, page:"loading|guide|home|activity|owning-panel|other",blocked:boolean,requiredInteraction:"home-revisit|unknown",requirementsQuote:string,balance:integer|null,selectedTaskState:"pending|completed|absent|unknown",rewards:[{role:"selected|incidental",kind:string,coins:positive integer,quote:string,proof:"received|offered",independent:boolean,task:{name,instruction}}],target:null|{role:"guide-home|home-coin|open-panel|exit",quote:string,point:[x,y],bounds:[left,top,right,bottom]}}. Use full visible page identity and actual requirements, not isolated words. guide-home navigates from actual revisit guide to app home; home-coin enters the coin activity from the actual HOME entry; open-panel opens the owning task list; exit is navigation only. Geometry must be current original pixels and unobscured. No typing, purchase/payment, invitation, game, login/authentication/security or cross-app actions. Stop if these are mandatory; ordinary optional promotions grant no action. Distinguish earned receipts from instructions, offers and missing task rows. Only an explicit independent receipt for this selected task and attempt may be selected received; quote its actual amount and full task identity. Daily sign-in is incidental to home-revisit, even when automatic. Never obtain selected coins by balance subtraction. Return other/unknown when unsure. Return phase authorizes navigation only, never reward claims, guide-home or home-coin. Echo binding exactly.`;

/** One instance per owning attempt; all three interaction stages must delegate here. */
export function createHomeRevisitRoute(cfg:any,route:any,deps:HomeRevisitRouteDeps){
 let binding:any=null,entered=false,opened=false,ran=false,returned=false,busy=false,inputUnknown=false,outcomeUnknown=false;
 let balanceBefore:number|null=null,attribution:Awaited<ReturnType<typeof observeHomeRewardAttribution>>|null=null;
 const events:any[]=[],used=new Set<string>(),frames:HomeRewardFrame[]=[],reads=new Map<string,HomeRewardObservation>();
 const taskSteps:Step[]=route.homeRevisit?.taskSteps??[{from:'guide',role:'guide-home',to:'home'},{from:'home',role:'home-coin',to:'activity'}];
 const returnSteps:Step[]=route.homeRevisit?.returnSteps??[{from:'activity',role:'open-panel',to:'owning-panel'}];
 const emit=async(kind:string,data:any={})=>{const e={kind,...data,binding};events.push(e);await deps.persist(e);};
 const review=()=>({summary:'Home revisit actions from current original images; saved-page replay is not live model acceptance',events:structuredClone(events)});
 const bind=(ctx:any)=>{
  if(route.type!=='home-revisit'||!cfg.sessionId?.trim()||!cfg.package?.trim()||!Number.isSafeInteger(cfg.scope?.userId)||cfg.scope.userId<0||typeof deps.persist!=='function'
   ||!ctx.taskAttemptId?.trim()||!equal(ctx.task?.name,route.task?.name)||!equal(ctx.task?.instruction,route.task?.instruction)||ctx.id!==undefined&&ctx.id!==cfg.sessionId
   ||ctx.scope!==undefined&&JSON.stringify(ctx.scope)!==JSON.stringify(cfg.scope))throw Error('Home revisit owning task/session/scope missing or changed');
  const next={sessionId:cfg.sessionId,taskAttemptId:ctx.taskAttemptId,package:cfg.package,userId:cfg.scope.userId,task:ctx.task,balanceBefore:ctx.balanceBefore};
  if(binding&&JSON.stringify(next)!==JSON.stringify(binding))throw Error('Home revisit attempt binding changed');
  binding??=structuredClone(next);balanceBefore=ctx.balanceBefore;
  if(!Number.isSafeInteger(balanceBefore)||balanceBefore!<=0||!Number.isSafeInteger(ctx.task.done)||!Number.isSafeInteger(ctx.task.total)||ctx.task.done<0||ctx.task.done>=ctx.task.total)throw Error('Home revisit selected quota/baseline invalid');
  if(cfg.resume)throw Error('Home revisit durable reservation recovery unavailable; never replay');
  const policy=route.homeRevisit?.capturePolicy;
  if(policy&&(!deps.captureRawBurst||!Number.isSafeInteger(policy.frames)||policy.frames<1||!Number.isSafeInteger(policy.intervalMs)||policy.intervalMs<0))throw Error('Home revisit configured raw capture unavailable');
  if(!Number.isSafeInteger(route.transitionWaitMs)||route.transitionWaitMs<0||route.transitionWaitMs>5000||!Array.isArray(route.loadingWaitsMs)||!route.loadingWaitsMs.every((ms:any)=>Number.isSafeInteger(ms)&&ms>0&&ms<=5000))throw Error('Home revisit transition wait invalid');
  for(const [steps,isReturn] of [[taskSteps,false],[returnSteps,true]] as const){
   if(!Array.isArray(steps)||!steps.length||steps.some(s=>!['guide','home','activity','owning-panel','other'].includes(s.from)||!['guide','home','activity','owning-panel','other'].includes(s.to)
    ||!(isReturn?['open-panel','exit','back']:['guide-home','home-coin','exit','back']).includes(s.role)
    ||s.role==='guide-home'&&(s.from!=='guide'||s.to!=='home')||s.role==='home-coin'&&(s.from!=='home'||s.to!=='activity')
    ||s.role==='open-panel'&&(s.from!=='activity'||s.to!=='owning-panel')))throw Error('Home revisit configured phase sequence invalid');
  }
 };
 const ownFrame=(f:any)=>{
  if(!f?.id?.trim()||!f.path?.trim()||f.package!==cfg.package||f.userId!==cfg.scope.userId||!Number.isSafeInteger(f.capturedAt)||f.capturedAt<=0||f.capturedAt>Date.now()
   ||!Number.isSafeInteger(f.width)||!Number.isSafeInteger(f.height)||f.width<=0||f.height<=0||hasIdentityChallenge(observationTexts({...f,lines:f.lines??[]})))throw Error('Home revisit current owning frame unavailable or blocked');
 };
 const inspect=async(f:DeviceFrame,phase:string)=>{
  ownFrame(f);
  const pngSha256=createHash('sha256').update(await readFile(f.path)).digest('hex');
  const expected={sessionId:cfg.sessionId,taskAttemptId:binding.taskAttemptId,frameId:f.id,pngSha256,package:cfg.package,userId:cfg.scope.userId};
  const navigation=await inspectCurrentActivityNavigation(f,{package:cfg.package,userId:cfg.scope.userId});
  const v=await deps.query(prompt,f,{binding:expected,interactionType:'home-revisit',phase,task:binding.task,entryDispatched:entered,history:structuredClone(events),currentNavigation:navigation});
  if(!v?.binding||Object.keys(expected).some(k=>v.binding[k]!==expected[k as keyof typeof expected])||v.blocked!==false
   ||!['loading','guide','home','activity','owning-panel','other'].includes(v.page)||!Array.isArray(v.rewards))throw Error('Home revisit AI frame/owner/state invalid or blocked');
  if(v.page==='loading'){
   if(v.target!==null||v.rewards.length)throw Error('Loading page cannot authorize targets or rewards');
   await emit('home_revisit_loading',{phase,frameId:f.id,path:f.path,pngSha256});
   return {f,v,panel:readPanel({...f,lines:f.lines??[]},cfg.panelMarker)};
  }
  if(createHash('sha256').update(await readFile(f.path)).digest('hex')!==pngSha256)throw Error('Home revisit original PNG changed during read');
  const panel=readPanel({...f,lines:f.lines??[]},cfg.panelMarker);
  if(panel.blocked||panel.isPanel&&v.page!=='owning-panel'||navigation&&(navigation.state==='panel'&&v.page!=='owning-panel'||navigation.state==='home'&&v.page!=='home'))throw Error('Home revisit current navigation contradicts image reader');
  const value:HomeRewardObservation={...v,...expected,frameId:f.id,pngSha256};
  const rewardFrame={...f,taskAttemptId:binding.taskAttemptId,pngSha256};
  if(!reads.has(f.id))frames.push(rewardFrame);
  else if(reads.get(f.id)!.pngSha256!==pngSha256)throw Error('Home revisit frame id reused with different PNG');
  reads.set(f.id,value);await emit('home_revisit_observation',{phase,frameId:f.id,path:f.path,pngSha256,value:v});
  return {f,v,panel};
 };
 const current=async(phase:string)=>{
  let page=await inspect(await deps.observe(),phase);
  for(const ms of route.loadingWaitsMs){
   if(page.v.page!=='loading')break;
   await deps.dispatch({type:'wait',ms});page=await inspect(await deps.observe(),phase);
  }
  if(page.v.page==='loading')throw Error('Home revisit configured loading sequence exhausted');
  return page;
 };
 const dispatch=async(action:DeviceAction,f:DeviceFrame,key:string)=>{
  if(inputUnknown||used.has(key))throw Error('Home revisit input consumed or unknown; never replay');
  validateProposedAction(action,f);used.add(key);
  try{
   await emit('home_revisit_dispatch_reserved',{key,frameId:f.id,path:f.path,action});
   await deps.dispatch(action,f);await emit('home_revisit_dispatched',{key,frameId:f.id});
  }catch(error){inputUnknown=true;outcomeUnknown=true;throw error;}
 };
 const tap=async(f:DeviceFrame,v:any,role:Role,key:string)=>{
  const t=v.target,b=t?.bounds,p=t?.point;
  if(t?.role!==role||!t.quote?.trim()||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<0||b[1]<0||b[2]>f.width||b[3]>f.height||b[0]>=b[2]||b[1]>=b[3]
   ||!Array.isArray(p)||p.length!==2||!p.every(Number.isSafeInteger)||p[0]<b[0]||p[0]>=b[2]||p[1]<b[1]||p[1]>=b[3])throw Error('Home revisit current target role/geometry invalid');
  await dispatch({type:'tap',x:p[0],y:p[1]},f,key);
 };
 const wait=async()=>{if(route.transitionWaitMs)await deps.dispatch({type:'wait',ms:route.transitionWaitMs});};
 const assess=async()=>{
  attribution=await observeHomeRewardAttribution({interactionType:'home-revisit',task:binding.task,owner:{package:cfg.package,userId:cfg.scope.userId,taskAttemptId:binding.taskAttemptId},balanceBefore,frames},{readCurrentPage:async r=>{
   // Only original-image reads made above can satisfy this reader. The observer independently rehashes every PNG.
   const value=reads.get(r.frame.id);return value?.pngSha256===r.pngSha256?value:null;
  }});
  await emit('home_revisit_attribution',{...attribution});return attribution;
 };
 const captureTransient=async(source:DeviceFrame)=>{
  const policy=route.homeRevisit?.capturePolicy;
  if(!policy)return;
  if(!deps.captureRawBurst||!Number.isSafeInteger(policy.frames)||policy.frames<1||!Number.isSafeInteger(policy.intervalMs)||policy.intervalMs<0)throw Error('Home revisit configured raw capture unavailable');
  const batch=await deps.captureRawBurst({frame:source,frames:policy.frames,intervalMs:policy.intervalMs,maxMs:2000});
  await emit('home_revisit_raw_capture',{batch});
  if(batch.status!=='complete'||batch.frames.length!==policy.frames)throw Error('Home revisit raw capture incomplete');
  const derived=deps.deriveRawFrames?await deps.deriveRawFrames(batch,{budgetMs:route.homeRevisit?.deriveBudgetMs??5000}):null;
  if(derived&&derived.length!==batch.frames.length)throw Error('Home revisit raw derivation count mismatch');
  for(const raw of batch.frames){
   if(raw.owner?.package!==cfg.package||raw.owner.userId!==cfg.scope.userId||raw.owner.taskAttemptId!==binding.taskAttemptId||raw.batchId!==batch.id
    ||raw.capturedAt<source.capturedAt||createHash('sha256').update(await readFile(raw.path)).digest('hex')!==raw.pngSha256)throw Error('Home revisit raw owner/hash/attempt invalid');
   const sidecar=JSON.parse(await readFile(raw.sidecarPath,'utf8'));
   if(['id','batchId','path','capturedAt','pngSha256','width','height'].some(k=>sidecar[k]!==raw[k as keyof typeof raw])||JSON.stringify(sidecar.owner)!==JSON.stringify(raw.owner))throw Error('Home revisit raw sidecar mismatch');
   const frame=derived?.find(f=>f.id===raw.id)??{...raw,package:raw.owner.package,userId:raw.owner.userId,lines:[]};
   if(['id','path','capturedAt','width','height'].some(k=>(frame as any)[k]!==raw[k as keyof typeof raw]))throw Error('Home revisit derived original frame mismatch');
   await inspect(frame,'transient');
  }
 };
 const runSteps=async(steps:Step[],phase:string)=>{
  let page=await current(phase);
  for(const [i,s] of steps.entries()){
   if(page.v.page==='owning-panel'&&phase==='return')return page;
   if(page.v.page!==s.from)throw Error('Home revisit configured current page not confirmed');
   if(phase==='task'&&(page.v.requiredInteraction!=='home-revisit'||!page.v.requirementsQuote?.trim()))throw Error('Home revisit actual requirements unconfirmed');
   if(s.role==='back')await dispatch({type:'back'},page.f,phase+'-'+i);
   else await tap(page.f,page.v,s.role,phase+'-'+i+':'+s.role);
   if(s.role==='home-coin')await captureTransient(page.f);
   await wait();const next=await current(phase);
   if(next.v.page===page.v.page||next.v.page!==s.to)throw Error('Home revisit no navigation progress or unexpected destination');
   page=next;
  }
  return page;
 };
 const stage=async(id:string,ctx:any):Promise<any>=>{
  if(!['open_task','task_receipt','return_list'].includes(id))return null;
  if(busy)return {status:'stopped',error:'Home revisit stage already running',review:review()};
  busy=true;let contextBound=false;
  try{
   bind(ctx);contextBound=true;
   if(id==='open_task'){
    if(opened||inputUnknown)throw Error('Home revisit entry already consumed or unknown');opened=true;
    const {f,v,panel}=await current('entry');
    const rows=panel.tasks.filter(t=>equal(t.name,ctx.task.name)&&equal(t.instruction,ctx.task.instruction)&&t.done===ctx.task.done&&t.total===ctx.task.total&&t.done<t.total&&['去完成','去逛逛','逛一逛'].includes(t.button));
    if(v.page!=='owning-panel'||!panel.isPanel||panel.blocked||rows.length!==1||!rows[0].point||panel.balance!==balanceBefore)throw Error('Home revisit current selected panel row/baseline not uniquely bound');
    entered=true;await dispatch({type:'tap',x:rows[0].point[0],y:rows[0].point[1]},f,'entry');await wait();
    const arrival=await current('open-task');if(arrival.v.page!=='guide'||arrival.v.requiredInteraction!=='home-revisit'||!arrival.v.requirementsQuote?.trim())throw Error('Home revisit current guide requirements not confirmed');
    return {status:'completed',checkpoint:'task_destination_visible',review:review()};
   }
   if(id==='task_receipt'){
    if(!entered||ran||inputUnknown)throw Error('Home revisit receipt execution unavailable; never replay');ran=true;
    await runSteps(taskSteps,'task');
    const result=await assess();outcomeUnknown=!result.receipt;
    return {...result,status:result.receipt?'completed':'unknown',...(result.receipt?{}:{error:'Independent home revisit receipt missing'}),review:review()};
   }
   if(returned||inputUnknown)throw Error('Home revisit return consumed or input unknown');returned=true;
   const page=await runSteps(returnSteps,'return');
   if(page.v.page!=='owning-panel'||!page.panel.isPanel||page.panel.blocked)throw Error('Home revisit owning panel return unconfirmed');
   const result=await assess();outcomeUnknown=result.status!=='completed';
   return {...result,status:'completed',attributionStatus:result.status,checkpoint:'owning_panel_visible',review:review()};
  }catch(error){outcomeUnknown=true;return {...(contextBound?attribution??{}:{}),status:entered||inputUnknown?'unknown':'stopped',error:error instanceof Error?error.message:String(error),review:review()};}
  finally{busy=false;}
 };
 return {stage,get receipt(){return attribution?.receipt;},get unknown(){return inputUnknown||outcomeUnknown;},get ownsEntry(){return entered;},get attribution(){return attribution;}};
}
