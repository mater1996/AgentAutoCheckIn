import {readPanel,hasIdentityChallenge,observationTexts,validateProposedAction} from './observations.ts';
const norm=(s:string)=>s.normalize('NFKC').trim();
export function findInteractionRoute(cfg:any,task:any){
 const routes=(cfg.interactionRoutes??[]).filter((r:any)=>task&&norm(r.task.name)===norm(task.name)&&norm(r.task.instruction)===norm(task.instruction));
 if(routes.length>1)throw Error('Conflicting interaction routes');return routes[0]??null;
}
export function validateInteractionRoutes(cfg:any){
 if(cfg.interactionRoutes===undefined)return;
 if(!Array.isArray(cfg.interactionRoutes)||cfg.scriptValidationMode!==false)throw Error('Interaction routes require explicit model observation mode');
 const ids=new Set<string>();
 for(const r of cfg.interactionRoutes){
  const t=r?.task,key=JSON.stringify([t?.name&&norm(t.name),t?.instruction&&norm(t.instruction)]);
  if(!['search-browse','quiz','home-revisit'].includes(r?.type)||typeof t?.name!=='string'||!t.name.trim()||typeof t?.instruction!=='string'||!t.instruction.trim()||ids.has(key))throw Error('Invalid or duplicate interaction route');
  ids.add(key);
  if((cfg.controllerCandidates??[]).some((c:any)=>norm(c.task.name)===norm(t.name)&&norm(c.task.instruction)===norm(t.instruction))||(cfg.dwellBrowse?.contracts??[]).some((c:any)=>norm(c.task.name)===norm(t.name)&&norm(c.task.instruction)===norm(t.instruction))||cfg.immersiveBrowse?.enabled&&norm(cfg.immersiveBrowse.task.name)===norm(t.name)&&norm(cfg.immersiveBrowse.task.instruction)===norm(t.instruction))throw Error('Conflicting interaction task ownership');
  if(!Number.isSafeInteger(r.transitionWaitMs)||r.transitionWaitMs<0||r.transitionWaitMs>5000||!Array.isArray(r.loadingWaitsMs)||!r.loadingWaitsMs.every((ms:any)=>Number.isSafeInteger(ms)&&ms>0&&ms<=5000)||!Array.isArray(r.returnSteps)||!r.returnSteps.length||!r.returnSteps.every((s:any)=>s==='back'||s==='visible-exit')||typeof r.refreshReturnedPanel!=='boolean')throw Error('Invalid interaction transition sequence');
  if(r.type==='search-browse'){
   const b=r.continuousScroll;
   if(b?.requiredMs!==10000||!Number.isSafeInteger(b.maxSwipes)||b.maxSwipes<1||!Number.isSafeInteger(b.maxMs)||b.maxMs<10000||!Number.isSafeInteger(b.gestureMs)||b.gestureMs<200||b.gestureMs>1500||b.maxSwipes*b.gestureMs<10000||cfg.executionPolicy!=='development-unbounded-v1'&&(b.maxSwipes>20||b.maxMs>20000))throw Error('Invalid interaction continuous browse requirement');
  }
 }
}
const prompt=`Read this ORIGINAL PNG and current bound interaction context. Never infer flow from the task name or historical answers. Return JSON {binding:{sessionId,taskAttemptId,frameId},state:"loading|recommendation|results|question|answer-selected|receipt|panel|activity|unknown",blocked:boolean,requiredInteraction:"search-browse|quiz|home-revisit|unknown",requirementsQuote:string,completionQuote:string,rewardCoins:number|null,balance:number|null,requiredMs:number|null,continuous:boolean,target:{role:"recommendation|answer|submit|exit|open-panel",quote:string,point:[x,y],bounds:[left,top,right,bottom]}|null,swipe:{type:"swipe",fromX,fromY,toX,toY,ms}|null}. Determine the current question answer from its actual question/options and your knowledge; answer option text mentioning purchase is descriptive, never permission to purchase. Choose one visible recommended search term from this image without typing. Results require actual ten-second continuous browsing when the arrow asks for sliding; do not click products. All geometry must be absolute pixels of this frame. Completion must explicitly belong to this attempt; do not treat conditional promotions (e.g. order to earn more) as earned. rewardCoins is only an explicit earned selected-task amount, never a balance difference or a future/promotion reward. balance is only the current asset total. Stop on mandatory purchase, invitation, game, login/authentication/security or cross-app; ordinary optional advertising is not a requirement. Return unknown when unsure. Return/refresh phases permit navigation only, never task entry or reward claims. Echo binding exactly.`;
/** One instance owns one actual task entry. Input authority is consumed before await. */
export function createInteractionRoute(cfg:any,route:any,deps:any){
 let binding:any=null,entered=false,unknown=false,receipt:any=null,opened=false,ran=false,returned=false,refreshed=false;
 const events:any[]=[],used=new Set<string>();
 const emit=(kind:string,data:any)=>{const e={kind,...data};events.push(e);deps.persist?.(e);};
 const bind=(ctx:any)=>{
  if(typeof ctx.taskAttemptId!=='string'||!ctx.taskAttemptId.trim()||!ctx.task||findInteractionRoute({interactionRoutes:[route]},ctx.task)!==route)throw Error('Interaction owning task attempt missing');
  const next={sessionId:cfg.sessionId,taskAttemptId:ctx.taskAttemptId,name:ctx.task.name,instruction:ctx.task.instruction};
  if(binding&&JSON.stringify(binding)!==JSON.stringify(next))throw Error('Interaction attempt/session changed');binding??=next;
 };
 const frame=async()=>{const f=await deps.observe();if(!f?.id||f.package!==cfg.package||f.userId!==cfg.scope.userId||!Number.isFinite(f.capturedAt)||f.capturedAt>Date.now()||hasIdentityChallenge(observationTexts(f)))throw Error('Interaction current owning frame unavailable or blocked');return f;};
 const inspect=async(f:any,phase:string)=>{
  const v=await deps.query(prompt,f,{...binding,interactionType:route.type,phase,task:route.task,entryDispatched:entered,receipt,history:events});
  if(v?.binding?.frameId!==f.id||v.binding.sessionId!==binding.sessionId||v.binding.taskAttemptId!==binding.taskAttemptId||typeof v.blocked!=='boolean'||v.blocked||!['loading','recommendation','results','question','answer-selected','receipt','panel','activity','unknown'].includes(v.state))throw Error('Interaction AI binding/blocked/state invalid');
  if(v.state==='unknown'||!['panel','activity','loading'].includes(v.state)&&v.requiredInteraction!==route.type)throw Error('Interaction requirements unconfirmed');
  emit('interaction_observation',{frameId:f.id,path:f.path,phase,value:v});return v;
 };
 const dispatch=async(a:any,f:any,key:string,continuous?:any)=>{
  if(unknown||used.has(key))throw Error('Interaction input unknown or already consumed; never replay');
  if(a.type!=='tap'||!['answer','submit'].some(role=>key.endsWith(':'+role)))validateProposedAction(a,f);
  used.add(key);emit('interaction_dispatch_started',{key,frameId:f.id,action:a,continuous});
  try{if(continuous)await deps.scrollContinuously(a,f,continuous);else await deps.dispatch(a,f);emit('interaction_dispatched',{key,frameId:f.id});}
  catch(error){unknown=true;emit('interaction_dispatch_unknown',{key,frameId:f.id});throw error;}
 };
 const tap=async(f:any,v:any,role:string,key:string)=>{
  const t=v.target,b=t?.bounds,p=t?.point;
  if(t?.role!==role||typeof t.quote!=='string'||!t.quote.trim()||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]<0||b[1]<0||b[2]>f.width||b[3]>f.height||b[0]>=b[2]||b[1]>=b[3]||!Array.isArray(p)||p.length!==2||!p.every(Number.isSafeInteger)||p[0]<b[0]||p[0]>=b[2]||p[1]<b[1]||p[1]>=b[3])throw Error('Interaction current target role/geometry invalid');
  await dispatch({type:'tap',x:p[0],y:p[1]},f,key+':'+role);
 };
 const wait=async(ms:number)=>{if(ms)await deps.dispatch({type:'wait',ms});};
 const ready=async(phase:string)=>{let f=await frame(),v=await inspect(f,phase);for(const ms of route.loadingWaitsMs){if(v.state!=='loading')break;await wait(ms);f=await frame();v=await inspect(f,phase);}if(v.state==='loading')throw Error('Interaction configured loading sequence exhausted');return {f,v};};
 const captureReceipt=(f:any,v:any)=>{
  if(!entered||v.state!=='receipt'||typeof v.completionQuote!=='string'||!/已得(?:币|金币)?\s*\d+|已成功领取奖励|任务已完成|浏览完成/.test(v.completionQuote)||/未成功|尚未|如果|完成后|示例/.test(v.completionQuote))throw Error('Interaction explicit current receipt missing');
  const earned=v.completionQuote.match(/已得(?:币|金币)?\s*(\d+)/)?.[1];
  if(v.rewardCoins!==null&&(!Number.isSafeInteger(v.rewardCoins)||v.rewardCoins<=0||!earned||+earned!==v.rewardCoins))throw Error('Interaction earned amount not independently quoted');
  receipt={frameId:f.id,path:f.path,quote:v.completionQuote,taskAttemptId:binding.taskAttemptId,sessionId:binding.sessionId,version:'configured-interaction-v1',rewardCoins:v.rewardCoins??null,observedBalance:Number.isSafeInteger(v.balance)&&v.balance>0?v.balance:null};emit('interaction_receipt',receipt);return receipt;
 };
 const review=()=>({summary:'Explicit configured interaction with current-image AI decisions; offline replay is not live model acceptance',events:[...events]});
 const stage=async(id:string,ctx:any)=>{
  try{
   bind(ctx);
   if(cfg.resume)throw Error('Interaction continuation requires durable original dispatch recovery; no replay');
   if(route.type==='home-revisit'&&['open_task','task_receipt','return_list'].includes(id)){
    if(!deps.homeRevisit)throw Error('home-revisit adapter unavailable; explicit route cannot fall through');
    return await deps.homeRevisit.stage(id,ctx);
   }
   if(id==='open_task'){
    if(unknown||opened)throw Error('Interaction entry already consumed or unknown');opened=true;
    const f=await frame(),p=readPanel(f,cfg.panelMarker),rows=p.tasks.filter((t:any)=>norm(t.name)===norm(route.task.name)&&norm(t.instruction)===norm(route.task.instruction)&&t.done===ctx.task.done&&t.total===ctx.task.total&&t.done<t.total&&['去完成','去逛逛','逛一逛'].includes(t.button));
    if(!p.isPanel||p.blocked||rows.length!==1||!rows[0].point)throw Error('Interaction current selected row not uniquely bound');
    entered=true;await dispatch({type:'tap',x:rows[0].point[0],y:rows[0].point[1]},f,'entry');await wait(route.transitionWaitMs);
    const arrival=await ready('open-task');if(!['recommendation','question','receipt'].includes(arrival.v.state))throw Error('Interaction destination requirements not confirmed');
    return {status:'completed',checkpoint:'task_destination_visible',review:review()};
   }
   if(id==='task_receipt'){
    if(unknown||!entered||ran)throw Error('Interaction receipt execution unavailable; never replay');ran=true;
    let {f,v}=await ready('task');
    if(v.state!=='receipt'){
     if(route.type==='search-browse'){
      if(v.state!=='recommendation')throw Error('Interaction search recommendation missing');await tap(f,v,'recommendation','search');await wait(route.transitionWaitMs);({f,v}=await ready('results'));
      const b=route.continuousScroll;if(v.state!=='results'||v.requiredMs!==b.requiredMs||v.continuous!==true||typeof v.requirementsQuote!=='string'||!v.requirementsQuote.trim()||v.swipe?.type!=='swipe')throw Error('Interaction search actual continuous requirement changed');
      const swipe={...v.swipe,ms:b.gestureMs};if(!['fromX','fromY','toX','toY'].every(k=>Number.isSafeInteger(swipe[k])&&swipe[k]>=0&&swipe[k]<(k.endsWith('X')?f.width:f.height)))throw Error('Interaction swipe outside current frame');
      await dispatch(swipe,f,'browse',{requiredMs:b.requiredMs,maxSwipes:b.maxSwipes,maxMs:b.maxMs});({f,v}=await ready('receipt'));
     }else if(route.type==='quiz'){
      if(v.state!=='question')throw Error('Interaction quiz question missing');await tap(f,v,'answer','quiz');await wait(route.transitionWaitMs);({f,v}=await ready('submit'));
      if(v.state!=='answer-selected')throw Error('Interaction selected answer not confirmed');await tap(f,v,'submit','quiz');await wait(route.transitionWaitMs);({f,v}=await ready('receipt'));
     }
    }
    captureReceipt(f,v);return {status:'completed',receipt,review:review()};
   }
   if(id==='return_list'){
    if(returned)throw Error('Interaction return sequence consumed');returned=true;
    let f=await frame();if(readPanel(f,cfg.panelMarker).isPanel)return {status:'completed',review:review()};
    for(const [i,step] of route.returnSteps.entries()){
     if(step==='back')await dispatch({type:'back'},f,'return-'+i);
     else{const v=await inspect(f,'return');await tap(f,v,'exit','return-'+i);}
     await wait(route.transitionWaitMs);f=await frame();if(readPanel(f,cfg.panelMarker).isPanel)return {status:'completed',review:review()};
    }
    throw Error('Interaction configured return sequence exhausted');
   }
   return null;
  }catch(error:any){return {status:unknown?'unknown':'stopped',error:String(error.message??error),review:review()};}
 };
 return {stage,get receipt(){return route.type==='home-revisit'?deps.homeRevisit?.receipt:receipt;},get unknown(){return route.type==='home-revisit'?deps.homeRevisit?.unknown:unknown;},get ownsEntry(){return route.type==='home-revisit'?deps.homeRevisit?.ownsEntry:entered;},get attribution(){return route.type==='home-revisit'?deps.homeRevisit?.attribution:null;},refresh:async(ctx:any,f:any)=>{
  bind(ctx);if(refreshed||!route.refreshReturnedPanel||!receipt||unknown)throw Error('Panel refresh unavailable or already consumed');refreshed=true;
  return refreshReturnedPanel({sourceFrame:f,dispatch,wait,frame,inspect,tap});
 }};
}
/** Navigation-only refresh: close owning panel, observe activity, reopen panel. */
export async function refreshReturnedPanel(deps:any){
 await deps.dispatch({type:'back'},deps.sourceFrame,'refresh-close');await deps.wait(1000);
 let f=await deps.frame(),v=await deps.inspect(f,'refresh-panel');
 if(v.state==='loading'){await deps.wait(1000);f=await deps.frame();v=await deps.inspect(f,'refresh-panel');}
 if(v.state!=='activity')throw Error('Panel refresh activity not confirmed');
 await deps.tap(f,v,'open-panel','refresh');await deps.wait(1000);return deps.frame();
}
