import {createInteractionRoute,findInteractionRoute} from './interaction.ts';
import {createHomeRevisitRoute} from './home-revisit-route.ts';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// Process-wide session allowance survives runtime reconstruction and attempt changes.
const entryRecoverySessions=new Map<string,any>();
const foregroundRecoverySessions=new Set<string>();
import {selectContinuousContract,inspectSelectedContinuousContract} from './continuous-contract.ts';
import {readPanel,bindTask,stableSettlement,recipeStep,validateProposedAction,plannedTaskEligible,observationTexts,currentCompletionQuote,hasIdentityChallenge,inspectCurrentSelectedTask,type CurrentTask} from './observations.ts';
import {readAiPanel,loadAiPanel} from './ai-panel-reader.ts';
import {createNavigationRecords} from './navigation-records.ts';
import {readNavigation,loadNavigation} from './navigation-reader.ts';
const j=(v:any)=>JSON.stringify(v,null,2);
const same=(a:string,b:string)=>a.normalize('NFKC').trim()===b.normalize('NFKC').trim();
/** Runtime adapters contain no platform-name behavior; all goals/policy come from config. */
export function createStagedRuntime(cfg:any,device:any,model:any,opts:any){
 const unbounded=cfg.executionPolicy==='development-unbounded-v1';
 // Per-request transport timeout remains finite; it is not a session/stage allowance.
 const requestMs=cfg.model?.timeoutMs??30000;
 const focusedPanels=cfg.panelReadPolicy==='focused-v1';
 let reusable:any=null;
 const originalDevice=device;
 // Invalidate before every dispatch, including exceptions/unknown effects.
 device=new Proxy(originalDevice,{get(target,key){const value=Reflect.get(target,key);if(typeof value!=='function')return value;return (...args:any[])=>{if(key==='act'||key==='scrollContinuously')reusable=null;return value.apply(target,args);};}});
 let calls=0,destinationConfirmed=false;const classify=new Map<string,any>(),frames:any[]=[],allStages:any[]=[],samples:any[]=[],inventory:any[]=[];
 const started=Date.now();let selected:CurrentTask|null=opts.resume?.task??null,beforeBalance:number|null=opts.resume?.balanceBefore??null,receipt:any=opts.resume?.receipt??null,latest:any=null;
 const learnedEnabled=cfg.learnedBrowse?.enabled===true&&cfg.learnedBrowse.version==='continuous-browse-candidate-v1'&&cfg.learnedBrowse.sourceRunId===153;
 const autoContract=learnedEnabled&&cfg.learnedBrowse.autoContract===true;
 const currentComponents=cfg.taskObservationPolicy==='current-components-v1';
 const keywordCompletion=currentComponents&&cfg.taskCompletionPolicy==='current-keywords-v1';
 const componentPolicy=currentComponents?{policy:'current-components-v1' as const}:undefined;
 const owner={package:cfg.package,userId:cfg.scope?.userId};
 const aiEnabled=cfg.aiPanelReader===true,aiFrames=new Map<string,Promise<any>>(),panelReadTimes=new Map<any,number>();
 const aiTaskRecovery=aiEnabled&&cfg.aiTaskRecovery===true&&cfg.scriptValidationMode===false&&learnedEnabled;
 const taskRecoveryFrames=new Map<string,Promise<any>>(),taskRecoveryActions=new Map<any,any>();
 let activeStage='',activeDeadline=Infinity;
 const remainingPanelMs=()=>unbounded?requestMs:Math.floor(Math.min(activeDeadline-performance.now(),(cfg.limits.sessionMs??600000)-(Date.now()-started)));
 const panelStage=()=>['open_app','enter_activity','open_list','collect_list','select_task','return_list','settle'].includes(activeStage)||activeStage==='open_task'&&!entry?.dispatched&&!opts.resume;
 const freshPanel=(f:any)=>{if(aiEnabled&&(!Number.isFinite(f.capturedAt)||Date.now()<f.capturedAt||!unbounded&&(!unbounded&&Date.now()-f.capturedAt>15000)))throw Error('AI panel source frame expired');};
 const localLaunch=cfg.localLaunch===true;
 const localNavigation=cfg.localActivityNavigation===true;
 const currentNavigation=localNavigation&&cfg.navigationPolicy==='current-text-v1';
 const routes=currentNavigation?createNavigationRecords(opts.evidenceDir,opts.sessionId):null;
 let activeContext:any={};
 const navigationSource=async(stageId:string)=>{const m=await import('./activity-navigation.ts');return currentNavigation?(stageId==='open_list'?m.activityCurrentLandingTextSource:m.activityCurrentHomeTextSource):(stageId==='open_list'?m.activityLandingSource:m.activityNavigationSource);};
 const navigationStates=Object.fromEntries(['enter_activity','open_list'].map(id=>[id,{attempted:false,unknown:false,sourceFrameId:null as string|null}]));
 const navigationFrames=new Map<any,Promise<any>>();
 const navigationReads=new Map<string,Promise<any>>();
 const inspectNavigation=async(f:any)=>{
  if(currentNavigation){
   if('navigationEvidence' in f&&!('aiPanelEvidence' in f))return loadNavigation(f,owner,{stageId:activeStage,expectedCheckpoint:cfg.stages?.[activeStage]?.checkpoint});
   if(aiEnabled&&'aiPanelEvidence' in f){const p=loadAiPanel(f);return p?.isPanel&&!p.blocked?{state:'panel',provenance:{version:'ai-panel-v1'}}:null;}
   if(!navigationFrames.has(f))navigationFrames.set(f,import('./activity-navigation.ts').then(m=>m.inspectCurrentActivityNavigation(f,owner)));
   return navigationFrames.get(f);
  }
  if(aiEnabled&&'aiPanelEvidence' in f){
   const p=loadAiPanel(f);if(!p||p.blocked)return null;
   if(p.isPanel)return {state:'panel',provenance:{version:'ai-panel-v1',authorization:'AI current-frame panel evidence; not zero-model validation'}};
   if(!navigationFrames.has(f))navigationFrames.set(f,import('./activity-navigation.ts').then(m=>m.inspectLearnedActivityNavigation(f,owner)));
   const known=await navigationFrames.get(f);return known?.state==='panel'?null:known;
  }
  if(!navigationFrames.has(f))navigationFrames.set(f,import('./activity-navigation.ts').then(m=>m.inspectLearnedActivityNavigation(f,owner)));
  return navigationFrames.get(f);
 };
 const launchState={attempted:false,unknown:false,sourceFrameId:null as string|null};
 let controllerRoute:any=null;
 const controllerMatch=(task:any)=>!!task&&(cfg.controllerCandidates??[]).some((c:any)=>c.task?.name===task.name&&c.task?.instruction===task.instruction);
 const controllerStage=async(stageId:string,ctx:any)=>{
  if(!['open_task','task_receipt','return_list'].includes(stageId)||!controllerMatch(ctx.task??selected))return null;
  if(opts.resume)return {status:'stopped',error:'Controller continuation requires durable original route recovery; no replay authorized'};
  if(!controllerRoute){
   const {createControllerRoute}=await import('./controller-route.ts');
   const supplied=typeof opts.controllerDeps==='function'?opts.controllerDeps(ctx):opts.controllerDeps;
   controllerRoute=createControllerRoute({executionPolicy:cfg.executionPolicy,sessionId:opts.sessionId,scope:cfg.scope,package:cfg.package,budget:{maxMs:cfg.limits.stageMs,maxActions:cfg.limits.stageActions,maxAgentCalls:0},candidates:cfg.controllerCandidates},
    {...supplied,readPanelReceipt:supplied?.readPanelReceipt??(cfg.scriptValidationMode===true?undefined:async(request:any)=>{
     const value=await query('只读当前原始截图，判断本次所选任务领取后的明确完成回执。不能将奖励预告、静态金额或余额增量当回执。返回JSON {frameId,pngSha256,taskAttemptId,isPanel:boolean,blocked:boolean,quote:string}，前三项逐字回传上下文；未见明确本次完成则quote为空。',request.frame,{stageId:activeStage,task:request.task,taskAttemptId:request.taskAttemptId,frameId:request.frame.id,pngSha256:request.pngSha256});
     const file=path.join(opts.evidenceDir,'claim-receipt-observation-'+randomUUID()+'.json'),bytes=j(value);fs.writeFileSync(file,bytes,{flag:'wx'});
     return {...value,evidence:{path:file,sha256:createHash('sha256').update(bytes).digest('hex')}};
    }),observe,now:opts.now??Date.now,dispatch:async(action:any,frame:any)=>{validateProposedAction(action,frame);await device.act(action,frame);},persist:async(event:any)=>{
     fs.mkdirSync(opts.evidenceDir,{recursive:true});const fd=fs.openSync(path.join(opts.evidenceDir,'controller.jsonl'),'a',0o600);
     try{fs.writeSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     await supplied?.persist?.(event);}});
  }
  if(ctx.task)selected=ctx.task;if(typeof ctx.balanceBefore==='number')beforeBalance=ctx.balanceBefore;
  const r=await controllerRoute.stage(stageId,{...ctx,id:opts.sessionId,scope:cfg.scope,task:ctx.task??selected,balanceBefore:ctx.balanceBefore??beforeBalance});
  if(!r)return null;
  if(r.receipt)receipt=r.receipt;
  if(stageId==='open_task'&&r.controller){
   for(const s of r.controller.stages??[])allStages.push(s);
   const events=(r.controller.stages??[]).flatMap((s:any)=>s.events??[]),actions=(r.controller.stages??[]).flatMap((s:any)=>s.actions??[]);
   r.review={summary:'Recorded explicit controller candidate execution; independent validation pending',candidateConfig:{state:'candidate',version:r.version,family:r.controller.state.contract.family},events,actions,stages:r.controller.stages};
  }
  allStages.push({...r,stageId});return r;
 };
 let interactionRoute:any=null,interactionObserving=false;
 const interactionStage=async(stageId:string,ctx:any)=>{
  const route=findInteractionRoute(cfg,ctx.task??selected);
  if(!route||!['open_task','task_receipt','return_list'].includes(stageId))return null;
  if(ctx.task)selected=ctx.task;if(typeof ctx.balanceBefore==='number')beforeBalance=ctx.balanceBefore;
  if(!interactionRoute){
   const supplied=typeof opts.controllerDeps==='function'?opts.controllerDeps(ctx):opts.controllerDeps;
   const shared={
    observe:async()=>{interactionObserving=true;try{return await observe();}finally{interactionObserving=false;}},
    query:(prompt:string,f:any,context:any)=>query(prompt,f,{...context,stageId:activeStage}),
    dispatch:(action:any,f?:any)=>device.act(action,f),scrollContinuously:(action:any,f:any,budget:any)=>device.scrollContinuously(action,f,budget),
    captureRawBurst:supplied?.captureRawBurst,deriveRawFrames:supplied?.deriveRawFrames,
    persist:async(event:any)=>{
     const folder=path.join(opts.evidenceDir,'interaction-reservations');fs.mkdirSync(folder,{recursive:true});
     if(event.kind==='home_revisit_dispatch_reserved'){
      const key=createHash('sha256').update(JSON.stringify([event.binding?.sessionId,event.binding?.taskAttemptId,event.key])).digest('hex');
      const fd=fs.openSync(path.join(folder,key+'.json'),'wx',0o600);try{fs.writeSync(fd,j(event));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     }
     const fd=fs.openSync(path.join(opts.evidenceDir,'interaction-route.jsonl'),'a',0o600);try{fs.writeSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
     emit('configured_interaction',event);
    }};
   const config={...cfg,sessionId:opts.sessionId,resume:opts.resume};
   const home=route.type==='home-revisit'?(opts.homeRevisit??createHomeRevisitRoute(config,route,shared)):undefined;
   interactionRoute=createInteractionRoute(config,route,{...shared,homeRevisit:home});
  }
  const r=await interactionRoute.stage(stageId,ctx);if(r?.receipt)receipt=r.receipt;if(r)allStages.push({...r,stageId});return r;
 };
 let entry:any=null,learnedScrollUsed=false;
 // Persist across return-stage reentry: uncertain dispatch must never be replayed.
 const flashReturn={backs:0,unknown:false,lastFrameId:null as string|null,modalFrameId:null as string|null};
 let ordinaryReturnUnknown=false;
 const flashContract=()=>{
  if(!selected||!Array.isArray(cfg.returnContracts))return null;
  const matches=cfg.returnContracts.filter((r:any)=>typeof r?.task?.name==='string'&&typeof r?.task?.instruction==='string'&&same(r.task.name,selected!.name)&&same(r.task.instruction,selected!.instruction));
  return matches.length===1&&matches[0].version==='flash-return-candidate-v1'&&matches[0].sourceRunId===131?matches[0]:null;
 };
 const flashAuthority=(ctx:any)=>!!flashContract()&&boundEntry(ctx)&&destinationConfirmed&&!!entry.receiptFrameId&&entry.receiptFrameId===receipt?.frameId&&receipt?.taskAttemptId===ctx.taskAttemptId&&typeof receipt?.quote==='string'&&!!receipt.quote.trim();
 const learnedFrames=new Map<any,Promise<any>>();
 const immersiveQualityFrames=new Map<any,any>();
 const dwellMatches=()=>cfg.dwellBrowse?.version==='dwell-browse-candidate-v1'&&selected
  ?(cfg.dwellBrowse.contracts??[]).filter((c:any)=>typeof c.task?.name==='string'&&typeof c.task?.instruction==='string'&&same(c.task.name,selected!.name)&&same(c.task.instruction,selected!.instruction)):[];
 const dwellContract=()=>{const matches=dwellMatches();return matches.length===1?matches[0]:null;};
 const immersiveMatch=()=>cfg.immersiveBrowse?.enabled===true&&['immersive-browse-candidate-v1','immersive-browse-candidate-v2'].includes(cfg.immersiveBrowse.version)&&cfg.immersiveBrowse.sourceRunId===145
  &&selected&&typeof cfg.immersiveBrowse.task?.name==='string'&&typeof cfg.immersiveBrowse.task?.instruction==='string'
  &&same(cfg.immersiveBrowse.task.name,selected.name)&&same(cfg.immersiveBrowse.task.instruction,selected.instruction)?cfg.immersiveBrowse:null;
 const observationMatches=()=>dwellMatches().length>0||!!immersiveMatch();
 const observationContract=()=>dwellContract()??immersiveMatch();
 const localConfig=()=>immersiveMatch()??(dwellContract()?{...cfg.dwellBrowse,sourceRunId:cfg.learnedBrowse?.sourceRunId}:cfg.learnedBrowse);
 const localVersion=()=>controllerMatch(selected)?cfg.controllerCandidates.find((c:any)=>c.task.name===selected!.name&&c.task.instruction===selected!.instruction)?.contract.version:localConfig()?.version;
 const localSourceRun=()=>controllerMatch(selected)?cfg.controllerCandidates.find((c:any)=>c.task.name===selected!.name&&c.task.instruction===selected!.instruction)?.contract.sourceRunIds?.[0]:localConfig()?.sourceRunId;
 const waitPolicy=(ms:number)=>{
  const contract=observationContract(),immersive=!!immersiveMatch();
  const limit=immersive?contract?.observationBudgetMs:contract?.dwellMs+5000;
  const valid=immersive?Number.isSafeInteger(limit)&&limit>=1000&&(unbounded||limit<=20000):Number.isSafeInteger(contract?.dwellMs)&&contract.dwellMs>=0&&Number.isFinite(limit);
  return {limit:unbounded?null:limit,valid,slices:unbounded?null:immersive?(entry?.dwellSliceLimit??Math.min(8,Math.ceil(limit/ms))):4};
 };
 const ownsAttempt=(ctx:any)=>!!selected&&typeof ctx.taskAttemptId==='string'&&!!ctx.taskAttemptId.trim()&&!!ctx.task
  &&same(ctx.task.name,selected.name)&&same(ctx.task.instruction,selected.instruction);
 const boundEntry=(ctx:any)=>ownsAttempt(ctx)&&entry?.taskAttemptId===ctx.taskAttemptId&&same(entry.name,selected!.name)&&same(entry.instruction,selected!.instruction)&&entry.dispatched===true;
 const aiBrowseEvidence=(ctx:any)=>{
  const e=entry?.ordinaryBrowseEvidence;
  return boundEntry(ctx)&&!entry.dwellUnknown&&!entry.aiRecoveryUnknown&&!entry.aiRecoveryUnconfirmed&&e?.taskAttemptId===ctx.taskAttemptId
   &&e.entryFrameId===entry.sourceFrameId&&e.entryActionId===entry.entryActionId?e:null;
 };
 const reboundRows=new WeakMap<object,CurrentTask>();
 const currentRow=(f:any)=>{
  if(!selected||f.package!==owner.package||f.userId!==owner.userId)return null;
  const rebound=reboundRows.get(f);
  if(rebound&&same(rebound.name,selected.name)&&same(rebound.instruction,selected.instruction)&&rebound.done===selected.done&&rebound.total===selected.total)return rebound;
  const panel=readPanel(f,cfg.panelMarker);if(!panel.isPanel||panel.blocked)return null;
  const rows=panel.tasks.filter(t=>same(t.name,selected!.name)&&same(t.instruction,selected!.instruction));
  return rows.length===1&&rows[0].done===selected.done&&rows[0].total===selected.total&&rows[0].done<rows[0].total&&rows[0].point?rows[0]:null;
 };
 const inspectLearned=async(f:any)=>{
  if(controllerMatch(selected)||!learnedEnabled||f.package!==owner.package||f.userId!==owner.userId)return null;
  if(!learnedFrames.has(f))learnedFrames.set(f,(async()=>{
   try{
    const immersive=immersiveMatch();
    if(immersive){
     // A matched immersive task owns inspection even when its page is unknown.
     if(dwellMatches().length)return null;
     const inspect=currentComponents?(opts.inspectCurrentImmersiveBrowse??(await import('./immersive-browse.ts')).inspectCurrentImmersiveBrowse):(opts.inspectImmersiveBrowse??(await import('./immersive-browse.ts')).inspectImmersiveBrowse);
     const inspectionVersion=currentComponents?'immersive-browse-current-components-v1':immersive.version;
     let value:any;
     if(immersive.version==='immersive-browse-candidate-v2'){
      const allowed=immersive.allowedRewardCoins;
      if(!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||!allowed.every((x:any)=>x===20||x===35||x===50))return null;
      const results:any[]=[];
      const transitions=Array.isArray(immersive.rewardTransitions)?immersive.rewardTransitions:[];
      const completionAmounts=transitions.filter((t:any)=>t.browseRewardCoins===entry?.immersiveReward).map((t:any)=>t.receiptRewardCoins);
      for(const rewardCoins of [...new Set([...allowed,...completionAmounts])]){
       const found=await inspect(f,owner,{rewardCoins});
       if(found&&found.version===inspectionVersion&&found.rewardCoins===rewardCoins&&['browsing','completed'].includes(found.state))results.push(found);
      }
      if(results.length!==1)return null;
      value=results[0];
      if(entry?.immersiveReward!==undefined&&entry.immersiveReward!==value.rewardCoins){
       const matches=transitions.filter((t:any)=>t.browseRewardCoins===entry.immersiveReward&&t.receiptRewardCoins===value.rewardCoins);
       if(value.state!=='completed'||matches.length!==1||!entry.immersiveBrowseFrame||entry.dwellUnknown)return null;
       const contract=matches[0];
       const verified=await (await import('./immersive-transition.ts')).verifyImmersiveTransition(contract,{
        taskAttemptId:entry.taskAttemptId,entryDispatched:entry.dispatched===true,browseFrame:entry.immersiveBrowseFrame,
        receiptFrame:f,browseRewardCoins:entry.immersiveReward,receiptRewardCoins:value.rewardCoins,waitMs:entry.dwellWaitMs??0,
       });
       if(!verified)return null;
       value={...value,requirementRewardCoins:entry.immersiveReward,rewardTransitionVersion:contract.version};
       emit('immersive_reward_transition',{taskAttemptId:entry.taskAttemptId,fromRewardCoins:entry.immersiveReward,toRewardCoins:value.rewardCoins,browseFrameId:entry.immersiveBrowseFrame.id,receiptFrameId:f.id,waitMs:entry.dwellWaitMs,version:contract.version});
      }
      if(value.state==='browsing'&&entry?.dispatched===true){
       if(!allowed.includes(value.rewardCoins))return null;
       entry.immersiveReward??=value.rewardCoins;entry.immersiveBrowseFrame??=f;
      }
     }else value=await inspect(f,owner);
     if(!value||value.version!==inspectionVersion||!['browsing','completed'].includes(value.state))return null;
     return {...value,kind:'dwell',action:value.state==='browsing'?{type:'wait',ms:Math.min(value.waitMs||5000,5000)}:undefined};
    }
    const matches=dwellMatches();
    if(matches.length){
     if(matches.length!==1)return null;
     const inspect=currentComponents?(opts.inspectCurrentDwellBrowse??(await import('./dwell-browse.ts')).inspectCurrentDwellBrowse):(opts.inspectDwellBrowse??(await import('./dwell-browse.ts')).inspectDwellBrowse);
     const value=await inspect(f,owner,matches[0]);
     if(!value||typeof value.version!=='string'||!value.version)return null;
     return {...value,kind:'dwell',action:value.state==='browsing'?{type:'wait',ms:Math.min(value.waitMs||5000,5000)}:undefined};
    }
    if(autoContract){
     if(!entry?.dispatched||cfg.learnedBrowse.contract)return null;
     if(!entry.continuousContract){
      const selectedContract=await selectContinuousContract(f,owner,{},componentPolicy);if(!selectedContract)return null;
      entry.continuousContract=selectedContract;
      emit('continuous_contract_selected',{taskAttemptId:entry.taskAttemptId,frameId:f.id,option:selectedContract.option,budget:selectedContract.budget,provenance:selectedContract.provenance});
      return selectedContract.inspection;
     }
     return (await inspectSelectedContinuousContract(f,owner,entry.continuousContract,componentPolicy)).inspection;
    }
    const inspect=currentComponents?(opts.inspectCurrentLearnedBrowse??(await import('./learned-browse.ts')).inspectCurrentLearnedBrowse):(opts.inspectLearnedBrowse??(await import('./learned-browse.ts')).inspectLearnedBrowse);
    const options=cfg.learnedBrowse?.contract;
    const value=await inspect(f,owner,options);
    if(options&&(value?.requiredMs!==options.requiredMs||value?.rewardCoins!==options.rewardCoins))return null;
    if(value?.state==='browsing'&&entry?.dispatched===true&&options){entry.requiredMs??=value.requiredMs;entry.browseRewardCoins??=value.rewardCoins;}
    return typeof value?.version==='string'&&value.version?value:null;
   }catch(error:any){emit('learned_inspection_error',{frameId:f.id,error:String(error.message??error),recovery:cfg.scriptValidationMode===true?'strict local evidence failure; model fallback disabled':'current-frame model recovery; no inferred browse authority'});return null;}
  })());
  return learnedFrames.get(f);
 };
 const emit=(kind:string,data:any)=>{fs.mkdirSync(opts.evidenceDir,{recursive:true});fs.appendFileSync(path.join(opts.evidenceDir,'runtime.jsonl'),j({kind,at:new Date().toISOString(),...data}).replaceAll('\n',' ')+'\n');};
 const observe=async(guard=()=>{},reuse=false)=>{
  guard();if(focusedPanels&&reuse&&reusable&&reusable.package===owner.package&&reusable.userId===owner.userId&&Number.isFinite(reusable.capturedAt)&&Date.now()>=reusable.capturedAt&&(unbounded||Date.now()-reusable.capturedAt<=15000)&&loadAiPanel(reusable)?.isPanel&&!readPanel(reusable,cfg.panelMarker).blocked&&(activeStage!=='select_task'||!reusable.aiPanelEvidence.readMode)&&(activeStage!=='open_task'||currentRow(reusable))){latest=reusable;emit('observation_reused',{stageId:activeStage,frameId:latest.id,capturedAt:latest.capturedAt});return latest;}
  reusable=null;
  guard();try{latest=await device.capture();}catch(error:any){
   if(keywordCompletion){
    guard();
    if(!['open_task','task_receipt'].includes(activeStage)||!boundEntry(activeContext)||opts.resume||entry.foregroundRetryUsed
     ||entry.dwellUnknown||entry.aiRecoveryUnknown||activeStage==='task_receipt'&&!destinationConfirmed
     ||latest?.package!==owner.package||latest?.userId!==owner.userId||remainingPanelMs()<=0)throw error;
    const foreground=device.consumeCaptureForegroundMissing?.(error,owner);if(!foreground)throw error;
    const settleMs=500;
    if(remainingPanelMs()<=settleMs)throw Error('Observation stage/session deadline exceeded');
    entry.foregroundRetryUsed=true;
    emit('post_dispatch_foreground_reobservation',{stageId:activeStage,taskAttemptId:entry.taskAttemptId,entryActionId:entry.entryActionId,sourceFrameId:entry.sourceFrameId,foreground,remainingMs:remainingPanelMs(),extraWaitMs:settleMs,completionInferred:false});
    await new Promise<void>(resolve=>setTimeout(resolve,settleMs));
    guard();if(remainingPanelMs()<=0)throw Error('Observation stage/session deadline exceeded');
    const fresh=await device.capture();guard();
    if(remainingPanelMs()<=0)throw Error('Observation stage/session deadline exceeded');
    if(fresh.package!==owner.package||fresh.userId!==owner.userId)throw Error('Post-dispatch observation owner changed');
    if(frames.some(f=>f.id===fresh.id)||!Number.isFinite(fresh.capturedAt)||fresh.capturedAt<latest.capturedAt||Date.now()<fresh.capturedAt||(!unbounded&&Date.now()-fresh.capturedAt>15000))throw Error('Fresh post-dispatch observation required');
    latest=fresh;
   }else{
    if(aiEnabled)throw error;
    guard();emit('observation_error',{error:String(error.message??error),recovery:'one read-only retry; no action replay'});latest=await device.capture();
   }
  }
  guard();const f=latest;frames.push(f);
  const navigationObservation=currentNavigation&&['open_app','enter_activity','open_list'].includes(activeStage);
  let localKnown=navigationObservation?await inspectNavigation(f):null;
  if(navigationObservation&&!localKnown&&cfg.scriptValidationMode!==true&&f.package===owner.package&&f.userId===owner.userId){
   if(!Number.isFinite(f.capturedAt)||Date.now()<f.capturedAt||(!unbounded&&Date.now()-f.capturedAt>15000))throw Error('Navigation source frame expired');
   if(!navigationReads.has(f.id))navigationReads.set(f.id,(async()=>{
    const remaining=remainingPanelMs();if(remaining<=0)throw Error('Navigation stage/session deadline exceeded');
    const evidence=await readNavigation({frame:f,owner,evidenceDir:opts.evidenceDir,stageId:activeStage,expectedCheckpoint:cfg.stages?.[activeStage]?.checkpoint,maxMs:remaining,model:{hostManagedDecisions:model.hostManagedDecisions===true,usage:model.usage,query:async(request:any)=>{
     if(!unbounded&&calls>=cfg.limits.agentCalls)throw Error('Session Agent call budget exhausted');
     const left=remainingPanelMs();if(left<=0)throw Error('Navigation stage/session deadline exceeded');calls++;return model.query({...request,maxMs:Math.min(request.maxMs,left)});
    }}});
    const file=f.path.replace(/\.png$/,'.json'),original=JSON.parse(fs.readFileSync(file,'utf8'));
    fs.writeFileSync(file,j({...original,navigationEvidence:evidence})+'\n',{mode:0o600});
    emit('navigation_reader_result',{stageId:activeStage,frameId:f.id,evidence});return evidence;
   })());
   f.navigationEvidence=await navigationReads.get(f.id);guard();
   if(remainingPanelMs()<=0||Date.now()<f.capturedAt||(!unbounded&&Date.now()-f.capturedAt>15000))throw Error('Navigation evidence expired');
   localKnown=await inspectNavigation(f);
  }
  if(aiEnabled&&panelStage()&&!navigationObservation&&(!interactionObserving||readPanel(f,cfg.panelMarker).isPanel)){
   if(f.package!==owner.package||f.userId!==owner.userId){if(activeStage==='open_app')return f;throw Error('AI panel wrong foreground owner');}
   if(!(focusedPanels&&(activeStage==='collect_list'||keywordCompletion)))freshPanel(f);
   else if(!Number.isFinite(f.capturedAt)||Date.now()<f.capturedAt)throw Error('Invalid inventory capture time');
   const readMode=focusedPanels&&selected&&['open_task','return_list','settle'].includes(activeStage)?{purpose:activeStage==='open_task'?'selected-row' as const:activeStage==='return_list'?'return-status' as const:'settlement' as const,task:{name:selected.name,instruction:selected.instruction,done:selected.done,total:selected.total}}:undefined;
   const readKey=focusedPanels?JSON.stringify([f.id,readMode??null]):f.id;
   if(!aiFrames.has(readKey))aiFrames.set(readKey,(async()=>{
    const dir=fs.realpathSync(opts.evidenceDir),file=path.resolve(f.path).replace(/\.png$/,'.json');
    if(path.dirname(fs.realpathSync(f.path))!==dir||fs.realpathSync(path.dirname(file))!==dir)throw Error('AI panel frame outside session');
    const original=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{...f};
    if(['id','path','width','height','capturedAt','package','userId','observationError'].some(k=>original[k]!==f[k])||JSON.stringify(original.lines)!==JSON.stringify(f.lines))throw Error('AI panel saved frame mismatch');
    const maxMs=remainingPanelMs();if(maxMs<=0)throw Error('AI panel stage/session deadline exceeded');

    const evidence=await readAiPanel({frame:f,owner,evidenceDir:dir,maxMs,readMode,model:{modelName:cfg.model?.name,usage:model.usage,query:async(request:any)=>{
     if(cfg.scriptValidationMode===true)throw Error('AI panel cannot use script validation mode');
     if(!unbounded&&calls>=cfg.limits.agentCalls)throw Error('Session Agent call budget exhausted');
     const left=remainingPanelMs();if(left<=0)throw Error('AI panel stage/session deadline exceeded');
     calls++;return model.query({...request,maxMs:Math.min(request.maxMs,left)});
    }}});
    fs.writeFileSync(file,j({...original,aiPanelEvidence:evidence})+'\n',{mode:0o600});
    emit('ai_panel_result',{stageId:activeStage,frameId:f.id,evidence});return evidence;
   })());
   f.aiPanelEvidence=await aiFrames.get(readKey);panelReadTimes.set(f,Date.now());
   if(!(focusedPanels&&(activeStage==='collect_list'||keywordCompletion))){guard();if(remainingPanelMs()<=0)throw Error('AI panel stage/session deadline exceeded');freshPanel(f);}
  }
  if(routes)routes.observe(f,{...activeContext,stageId:activeStage,expectedCheckpoint:cfg.stages?.[activeStage]?.checkpoint},await inspectNavigation(f));
  if(focusedPanels&&loadAiPanel(f)?.isPanel&&!readPanel(f,cfg.panelMarker).blocked)reusable=f;
  return f;
 };
 const query=async(prompt:string,frame:any,context:any,maxMs?:number)=>{
  if(cfg.scriptValidationMode===true)throw Error('Script validation requires local evidence; model fallback disabled');
  if(!unbounded&&calls>=cfg.limits.agentCalls)throw Error('Session Agent call budget exhausted');
  const left=unbounded?requestMs:(cfg.limits.sessionMs??600000)-(Date.now()-started);if(left<=0)throw Error('Session deadline exceeded');
  calls++;const value=await model.query({prompt,frame,context,maxMs:unbounded?requestMs:Math.min(maxMs??cfg.limits.stageMs,left)});
  emit('agent_result',{stageId:context.stageId,frameId:frame?.id,value});return value;
 };
 const taskMeta=(t:any)=>t?{name:t.name,instruction:t.instruction,done:t.done,total:t.total,reward:t.reward,...(t.rewardOffers?{rewardMin:t.rewardMin,rewardMax:t.rewardMax,rewardOffers:t.rewardOffers}:{}),button:t.button}:null;
 const compactSummary=(s:any)=>({stageId:s.stageId,status:s.status,checkpoint:s.checkpoint,error:s.error,actions:s.actions,observations:s.events?.filter((e:any)=>e.type==='observed').map((e:any)=>({frameId:e.frame?.id,path:e.frame?.path,package:e.frame?.package})),stages:s.stages?.map((x:any)=>({stageId:x.stageId,status:x.status,error:x.error})),task:taskMeta(s.task),receipt:s.receipt});
 const contextFor=(stageId:string,ctx:any)=>({observationError:ctx.frame?.observationError??latest?.observationError??null,continuation:opts.resume?{sourceRunId:opts.resume.runId,originalTaskAttemptId:opts.resume.taskAttemptId,priorStages:opts.resume.priorStages??[],rule:'只恢复原任务。先核实当前页与原任务关联，已在目的页不重新打开。无法确认则停止。出现已完成回执只保存核验，不开始第二轮。'}:null,sessionId:opts.sessionId,stageId,scope:cfg.scope,goal:cfg.stages?.[stageId]?.goal,expectedCheckpoint:cfg.stages?.[stageId]?.checkpoint,taskAttemptId:ctx.taskAttemptId,actualEntry:ctx.actualEntry??null,ordinaryBrowseEvidence:ctx.ordinaryBrowseEvidence??null,task:taskMeta(ctx.task??selected),plan:opts.plan.map((d:any)=>({name:d.name,instruction:d.instruction,decision:d.decision,times:d.times})),constraints:cfg.constraints,previousCheckpoint:ctx.previousCheckpoint,recentActions:ctx.recentActions??ctx.actions??[],error:ctx.error,remaining:ctx.remaining,receipt:ctx.receipt??receipt,experience:(opts.experiences??[]).filter((x:any)=>x.stageId===stageId).slice(-3),scriptVersion:ctx.scriptVersion??null});
 const describe=async(stageId:string,ctx:any)=>{
  const frame=ctx.frame??latest;const key=stageId+':'+frame.id;if(classify.has(key))return classify.get(key);
  const recoveryPrompt=ctx.actualEntry?'当前为已实际派发入口的任务恢复。必须逐字返回 taskBinding:{taskAttemptId,name,instruction,frameId,entryFrameId,entryActionId}，分别对应当前上下文taskAttemptId、task身份、当前frame.id和actualEntry.sourceFrameId/entryActionId。确认当前原图实际独立普通浏览要求，不按任务名称推断；页面普通地址/购物入口不是必须操作，禁止点击。加载骨架、倒计时未结束时stageDone=false并只给有界wait；完成需要当前任务目的页真实回执。未知模态只能安全back/wait；tap仅允许当前原图可见且本地文本核实的继续浏览或普通关闭/返回按钮。':'';
  const v=await query(recoveryPrompt+`只观察当前原图和上下文，不操作。若observationError非空，说明OCR不可用，必须直接读原图，不能把空OCR当作空白页。结合最近动作判断跳转；上一点击仍未确认时先等待观察，不能立即重发同位置点击。返回严格JSON：{"stageDone":boolean,"pageIdentity":"真实页面身份及可见依据","blocked":boolean,"stopReason":null或字符串,"requirements":"实际可见要求原文，无则空串","ordinaryBrowseOnly":boolean,"completionQuote":"属于本次选中任务的明确完成原文，无则空串","next":{"action":{"type":"tap|swipe|back|wait","x":绝对截图像素,"y":绝对截图像素,"fromX":像素,"fromY":像素,"toX":像素,"toY":像素,"ms":等待/滑动毫秒},"reason":"依据","expected":"动作后应看到什么"}或null}。stageDone必须有当前原图证据，任务完成必须实际看到本次目的页完成提示而非列表其他行、等待秒数、广告静态文案。open_task还需独立普通浏览可行，若实际要求搜索/输入/购物/游戏等则stopReason。进入活动阶段若已明确在对应任务列表，视为已满足，不退回重做。返回阶段不做任务或领取。未知状态填false，不凭名称猜要求。坐标必须来自这张图，结合截图尺寸；每次仅一个动作，不能提出购买/加购/支付/充值/填信息/授权/登录或任何验证码操作。若找不到安全下一步则next=null并说明。`,frame,contextFor(stageId,ctx),ctx.remaining?.ms);
  if(!v||typeof v.stageDone!=='boolean'||typeof v.blocked!=='boolean'||typeof v.pageIdentity!=='string')throw Error('Invalid Agent observation schema');
  classify.set(key,v);return v;
 };
 const review=async(stageId:string,summary:any)=>{
  if(aiEnabled||interactionRoute||controllerMatch(selected)||learnedEnabled||cfg.scriptValidationMode===true||stageId==='open_app'&&localLaunch||localNavigation&&['enter_activity','open_list'].includes(stageId)||stageId==='return_list'&&flashContract()){
   const stages=(summary.stages??[]).map((s:any)=>compactSummary(s));
   const steps=(summary.actions??[]).map((a:any)=>({action:a.proposal.action,frameId:a.proposal.frameId,source:a.source,status:a.status,expected:a.proposal.expected,reason:a.proposal.reason,error:a.error}));
   const reviewedFrame=(summary.events??[]).filter((e:any)=>e.type==='observed').at(-1)?.frame;
   const reviewedNavigation=localNavigation&&['enter_activity','open_list'].includes(stageId)&&reviewedFrame?await inspectNavigation(reviewedFrame):null;
   const aiSource=reviewedFrame&&loadAiPanel(reviewedFrame)?.isPanel?{version:'ai-panel-v1'}:null;
   const sourceFrame=(summary.events??[]).find((e:any)=>e.type==='observed'&&summary.actions?.some((a:any)=>a.proposal?.action?.type==='tap'&&a.proposal.frameId===e.frame?.id))?.frame;
   const actualNavigation=currentNavigation&&['enter_activity','open_list'].includes(stageId)&&sourceFrame?await inspectNavigation(sourceFrame):null;
   const navSource=actualNavigation?.provenance??aiSource??(localNavigation&&['enter_activity','open_list'].includes(stageId)
    ?(summary.actions?.some((a:any)=>a.proposal?.action?.type==='tap')?await navigationSource(stageId):reviewedNavigation?.provenance??await navigationSource(stageId)):null);
   const aiTaskSource=['open_task','task_receipt'].includes(stageId)&&aiBrowseEvidence(activeContext)?{version:'ai-task-recovery-v1',sourceRunId:undefined}:null;
   const r={summary:'Local review of recorded stage events; explicit learned candidate execution',applicability:['Explicit candidate configuration and current owning task attempt'],
    candidate:{state:'candidate',stageId,version:aiTaskSource?.version??(navSource?navSource.version:stageId==='open_app'&&localLaunch?'local-open-app-v1':stageId==='return_list'&&flashContract()?flashContract().version:localVersion()),sourceRunId:aiTaskSource?undefined:navSource?navSource.sourceRunId:stageId==='return_list'&&flashContract()?131:localSourceRun(),authorization:aiTaskSource?'AI current-frame ordinary destination recovery; not zero-model validation':'explicit candidate; not registry validated',steps},
    orderedSteps:steps,reusePreconditions:['Fresh owning frame and bound actual entry'],knownLimits:['Candidate execution is not registry validation; elapsed time is not a receipt'],
    events:summary.events??[],status:summary.status,receipt:summary.receipt??receipt,stages};
   emit('local_review',{stageId,review:r});return {...r,candidateConfig:r.candidate};
  }
  const r=await query('阶段已结束，只复盘，不操作手机。返回严格JSON {"summary":"实际学到什么","applicability":["可复用的页面条件"],"candidate":{"state":"candidate","stageId":"对应阶段","steps":[{"kind":"tap_text|wait|back","text":"从本次原图确认的目标文字，可空","ms":可选毫秒,"expected":"实际核验点"}]},"issues":["仍未验证处"]}。只从真实事件提炼，不能猜不存在的步骤或宣称已验证。若无法形成脚本候选candidate=null。',latest,{...contextFor(stageId,summary),completedStage:compactSummary(summary)},30000);
  if(r?.candidate){r.candidate.state='candidate';r.candidateConfig=r.candidate;}r.orderedSteps=r?.candidate?.steps??[];r.reusePreconditions=r.applicability??[];r.knownLimits=r.issues??[];return r;
 };
 const executeStage=async(stageId:string,ctx:any):Promise<any>=>{
  console.log('STAGE',stageId);
  const interaction=await interactionStage(stageId,ctx);if(interaction)return interaction;
  const routed=await controllerStage(stageId,ctx);if(routed)return routed;
  if(stageId==='collect_list')return collect(ctx);
  if(stageId==='select_task')return choose(ctx);
  if(stageId==='settle')return settle(ctx);
  if(stageId==='review_task'){const r=await review(stageId,{...ctx,stages:allStages});return {status:'completed',review:r};}
  const spec=cfg.stages[stageId];if(!spec)throw Error('Missing stage config '+stageId);
  const run=opts.runStage??(await import('./engine.ts')).runStage;
  let scriptIndex=0,backCount=0,continuousScrollUsed=false,needsLearning=false,aiActionPending=false;
  let launchAction:any=null,launchFrame:any=null;
  let navigationAction:any=null,navigationFrame:any=null;
  let unsentNavigation:any=null,foregroundRecovery:any=null;
  const launchStage=stageId==='open_app'&&localLaunch;
  const navigationStage=localNavigation&&['enter_activity','open_list'].includes(stageId);
  const navigationState=navigationStates[stageId];
  const navigationSourceState=stageId==='enter_activity'?'home':'landing';
  const scrollBudget=()=>autoContract?entry?.continuousContract?.budget:spec.continuousScroll;
  const authorizedScrollBudget=()=>{
   const budget=scrollBudget(),limit=spec.continuousScroll;
   return !!budget&&!!limit&&Number.isSafeInteger(limit.maxSwipes)&&Number.isFinite(limit.maxMs)
    &&(unbounded||budget.maxSwipes<=limit.maxSwipes&&budget.maxMs<=limit.maxMs)
    &&(unbounded||budget.requiredMs===undefined||limit.requiredMs===budget.requiredMs);
  };
  const candidateStage=learnedEnabled&&['open_task','task_receipt'].includes(stageId);
  // engine's validated flag authorizes script execution internally. This explicit
  // candidate is NOT a registry-validated recipe and never changes recipe loading.
  const returnCandidate=stageId==='return_list'?flashContract():null;
  const navigationImplementation=navigationStage?await navigationSource(stageId):null;
  const candidateScript=navigationStage?{id:'local-activity-navigation',version:navigationImplementation!.version,validated:true}:launchStage?{id:'local-open-app',version:'local-open-app-v1',validated:true}:candidateStage?{id:'explicit-learned-browse-candidate',version:localVersion(),validated:true}:returnCandidate?{id:'explicit-flash-return-candidate',version:returnCandidate.version,validated:true}:undefined;
  if(returnCandidate)emit('explicit_candidate_authorized',{stageId,version:returnCandidate.version,sourceRunId:131,state:'candidate',registryValidated:false});
  if(candidateStage)emit('explicit_candidate_authorized',{stageId,version:candidateScript!.version,sourceRunId:localSourceRun(),state:'candidate',registryValidated:false});
  const stageStarted=performance.now(),stageBudget=cfg.limits.stageMs;
  let stageActive=true;
  const observationRemaining=()=>unbounded?null:Math.min(stageBudget-(performance.now()-stageStarted),(cfg.limits.sessionMs??600000)-(Date.now()-started));
  const guardObservation=()=>{if(!stageActive||!unbounded&&observationRemaining()!<=0)throw Error('Observation stage/session deadline exceeded');};
  // Quality is evidence for this dispatched attempt, never a replacement DeviceFrame.
  const qualityAuthority=(f:any)=>{
   const immersive=immersiveMatch(),policy=waitPolicy(3000);
   return stageActive&&(unbounded||observationRemaining()!>0)&&learnedEnabled&&immersive?.version==='immersive-browse-candidate-v2'&&immersive.ocrQuality===true
    &&!dwellMatches().length&&['open_task','task_receipt'].includes(stageId)&&boundEntry(ctx)&&!entry.dwellUnknown
    &&(stageId!=='task_receipt'||destinationConfirmed&&entry.immersiveReward!==undefined)
    &&owner.package==='com.taobao.taobao'&&owner.userId===0&&f.package===owner.package&&f.userId===owner.userId&&f.id!==entry.sourceFrameId
    &&f.observationError==='OCR capture failed: Invalid OCR frame or bounds'
    &&Number.isSafeInteger(f.capturedAt)&&Date.now()>=f.capturedAt&&(unbounded||Date.now()-f.capturedAt<=15000)
    &&(!entry.immersiveQualityIds?.has(f.id)||immersiveQualityFrames.get(f)?.entry===entry)
    &&policy.valid&&(unbounded||(entry.dwellWaitMs??0)+(entry.ocrSettlingCharged?0:entry.entrySettlingMs??0)<policy.limit!);
  };
  const inspectObservation=async(f:any)=>{
   if(!f.observationError){
    const value=await inspectLearned(f);guardObservation();
    if(immersiveMatch()?.ocrQuality===true&&immersiveMatch()?.version==='immersive-browse-candidate-v2'){
     if(!boundEntry(ctx)||entry.dwellUnknown||Date.now()<f.capturedAt||(!unbounded&&Date.now()-f.capturedAt>15000))return null;
     // A completion can confirm only a requirement already learned from browsing.
     if(value?.state==='completed'&&entry.immersiveReward===undefined)return null;
    }
    return value;
   }
   guardObservation();if(!qualityAuthority(f))return null;
   const bound=entry;
   const cached=immersiveQualityFrames.get(f);
   if(cached)return cached.entry===bound&&qualityAuthority(f)?cached.value:null;
   const immersive=immersiveMatch(),allowed=immersive.allowedRewardCoins;
   if(!Array.isArray(allowed)||!allowed.length||new Set(allowed).size!==allowed.length||!allowed.every((n:any)=>n===20||n===35||n===50))return null;
   const transitions=Array.isArray(immersive.rewardTransitions)?immersive.rewardTransitions:[];
   const amounts=entry.immersiveReward===undefined?allowed:[entry.immersiveReward,...transitions.filter((t:any)=>t.browseRewardCoins===entry.immersiveReward).map((t:any)=>t.receiptRewardCoins)];
   const {deriveImmersiveOcrQuality}=await import('./immersive-ocr-quality.ts');
   // The injected legacy inspector cannot grant authority on a failed raw frame.
   const {inspectImmersiveBrowse}=await import('./immersive-browse.ts');
   const results:any[]=[];
   for(const rewardCoins of [...new Set(amounts)]){
    if(![20,35,50].includes(rewardCoins))continue;
    const quality=await deriveImmersiveOcrQuality(f,{rewardCoins} as any);
    const value=quality?await inspectImmersiveBrowse(f,owner,{rewardCoins} as any,quality):null;
    guardObservation();if(entry!==bound||!qualityAuthority(f))return null;
    if(value&&value.version===immersive.version&&value.rewardCoins===rewardCoins&&['browsing','completed'].includes(value.state))results.push({value,quality});
   }
   if(results.length!==1)return null;
   let {value,quality}=results[0];
   if(entry.immersiveReward===undefined){
    if(stageId!=='open_task'||value.state!=='browsing'||!allowed.includes(value.rewardCoins))return null;
   }else if(value.rewardCoins!==entry.immersiveReward){
    const matches=transitions.filter((t:any)=>t.browseRewardCoins===entry.immersiveReward&&t.receiptRewardCoins===value.rewardCoins);
    if(stageId!=='task_receipt'||value.state!=='completed'||matches.length!==1||!entry.immersiveBrowseFrame)return null;
    const verified=await (await import('./immersive-transition.ts')).verifyImmersiveTransition(matches[0],{taskAttemptId:ctx.taskAttemptId,entryDispatched:true,browseFrame:entry.immersiveBrowseFrame,receiptFrame:f,browseRewardCoins:entry.immersiveReward,receiptRewardCoins:value.rewardCoins,waitMs:entry.dwellWaitMs??0});
    guardObservation();if(!verified||entry!==bound||!qualityAuthority(f))return null;
    value={...value,requirementRewardCoins:entry.immersiveReward,rewardTransitionVersion:matches[0].version};
    emit('immersive_reward_transition',{taskAttemptId:ctx.taskAttemptId,fromRewardCoins:entry.immersiveReward,toRewardCoins:value.rewardCoins,browseFrameId:entry.immersiveBrowseFrame.id,receiptFrameId:f.id,waitMs:entry.dwellWaitMs,version:matches[0].version});
   }
   guardObservation();if(entry!==bound||!qualityAuthority(f))return null;
   entry.dwellWaitMs=(entry.dwellWaitMs??0)+(entry.ocrSettlingCharged?0:entry.entrySettlingMs??0);entry.ocrSettlingCharged=true;
   if(value.state==='browsing'){entry.immersiveReward??=value.rewardCoins;entry.immersiveBrowseFrame??=f;}
   const match={...value,kind:'dwell',action:value.state==='browsing'?{type:'wait',ms:Math.min(value.waitMs||5000,5000)}:undefined};
   emit('immersive_ocr_quality',{stageId,taskAttemptId:ctx.taskAttemptId,entryFrameId:entry.sourceFrameId,entryActionId:entry.entryActionId,frameId:f.id,rewardCoins:value.rewardCoins,quality});
   entry.immersiveQualityIds??=new Set();entry.immersiveQualityIds.add(f.id);
   immersiveQualityFrames.set(f,{entry:bound,value:match});return match;
  };
  const returnRecovery=()=>aiTaskRecovery&&stageId==='return_list'&&boundEntry(ctx)&&destinationConfirmed&&receipt?.taskAttemptId===ctx.taskAttemptId&&entry.receiptFrameId===receipt?.frameId&&!flashReturn.unknown;
  const recoveryAuthority=(c:any,f:any)=>aiTaskRecovery&&(['open_task','task_receipt'].includes(stageId)||returnRecovery())&&boundEntry(ctx)&&!opts.resume
   &&!entry.dwellUnknown&&!entry.aiRecoveryUnknown&&c.pendingAction?.status!=='unknown'
   &&f.package===owner.package&&f.userId===owner.userId&&f.id!==entry.sourceFrameId&&!readPanel(f,cfg.panelMarker).isPanel
   &&Number.isFinite(f.capturedAt)&&f.capturedAt>=frames.find(x=>x.id===entry.sourceFrameId)?.capturedAt
   &&(!aiBrowseEvidence(ctx)||f.capturedAt>=aiBrowseEvidence(ctx).capturedAt)&&Date.now()>=f.capturedAt&&(unbounded||Date.now()-f.capturedAt<=15000)
   &&stageActive&&!c.signal?.aborted&&(unbounded||observationRemaining()!>0)&&(stageId!=='task_receipt'||destinationConfirmed);
  const recoverTask=async(c:any,f:any)=>{
   if(!recoveryAuthority(c,f))return null;
   const key=stageId+':'+f.id;
   if(!taskRecoveryFrames.has(key))taskRecoveryFrames.set(key,(async()=>{
    // The local inspector owns known states. A model can only recover its unknown result.
    if(stageId!=='return_list'&&await inspectObservation(f))return null;
    guardObservation();if(!recoveryAuthority(c,f))return null;
    const prior=aiBrowseEvidence(ctx);
    const d=await describe(stageId,{...ctx,...c,frame:f,ordinaryBrowseEvidence:prior,actualEntry:{taskAttemptId:entry.taskAttemptId,sourceFrameId:entry.sourceFrameId,entryActionId:entry.entryActionId,dispatched:entry.dispatched}});
    guardObservation();if(!recoveryAuthority(c,f))return null;
    const b=d.taskBinding;
    if(!b||b.taskAttemptId!==ctx.taskAttemptId||b.name!==selected!.name||b.instruction!==selected!.instruction||b.frameId!==f.id
     ||b.entryFrameId!==entry.sourceFrameId||b.entryActionId!==entry.entryActionId)return null;
    if(d.blocked||d.stopReason)return null;
    if(stageId==='return_list')return d.stageDone?null:d;
    const visualReceipt=keywordCompletion&&d.stageDone&&(stageId==='task_receipt'||stageId==='open_task'&&!!prior);
    // Receipt text may replace the requirement. Only this attempt's previously
    // observed ordinary destination can supply the missing requirement context.
    if(d.ordinaryBrowseOnly!==true||typeof d.requirements!=='string'||!visualReceipt&&!prior&&!d.requirements.trim()
     ||/搜索|输入|下单|购买|加购|支付|充值|授权|登录|游戏|邀请|安装|外部|跨App|答题/.test(d.requirements))return null;
    if(f.observationError&&d.stageDone&&!keywordCompletion)return null;
    if((stageId==='task_receipt'||stageId==='open_task'&&!!prior)&&d.stageDone){
     if(visualReceipt){
      if(typeof d.completionQuote!=='string'||!currentCompletionQuote([d.completionQuote]))return null;
     }else if(typeof d.completionQuote!=='string'||!d.completionQuote.trim()||!/任务已完成|任务完成|浏览完成|已完成浏览|已得\s*\d+\s*金币|获得\s*\d+\s*金币|继续逛逛吧/.test(d.completionQuote)||!f.lines.some((l:any)=>l.text.normalize('NFKC').includes(d.completionQuote.normalize('NFKC').trim())))return null;
    }
    if(stageId==='open_task'&&d.requirements.trim()&&/浏览|逛|停留|滑动|browse|scroll|stay/i.test(d.requirements)
     &&!/加载中|骨架|空白|页面未就绪|尚未进入|目的页未确认/.test(d.pageIdentity+' '+(d.next?.reason??''))){
     const evidence={version:'ai-task-recovery-v1',taskAttemptId:ctx.taskAttemptId,name:selected!.name,instruction:selected!.instruction,
      frameId:f.id,path:f.path,capturedAt:f.capturedAt,entryFrameId:entry.sourceFrameId,entryActionId:entry.entryActionId,
      requirements:d.requirements,pageIdentity:d.pageIdentity,ordinaryBrowseOnly:true};
     entry.ordinaryBrowseEvidence??=evidence;
     emit('ai_task_destination_confirmed',entry.ordinaryBrowseEvidence);
    }
    return d;
   })());
   return taskRecoveryFrames.get(key);
  };
  let firstStageObservation=true;
  const observeStage=async()=>{
   const reuse=firstStageObservation&&stageId==='open_task'&&!entry;firstStageObservation=false;
   const failed=await observe(guardObservation,reuse);
   if(failed.observationError&&await inspectObservation(failed))return failed;
   if(!['open_task','task_receipt'].includes(stageId)||!immersiveMatch()||!boundEntry(ctx)||stageId==='task_receipt'&&!destinationConfirmed||!unbounded&&entry.ocrRetryUsed||entry.dwellUnknown
    ||failed.package!==owner.package||failed.userId!==owner.userId||failed.id===entry.sourceFrameId
    ||failed.observationError!=='OCR capture failed: Invalid OCR frame or bounds'
    ||failed.lines.some((l:any)=>/登录|登陆|验证|授权|允许|温馨提示|确认|取消|同意/.test(l.text))
    ||!unbounded&&(performance.now()-stageStarted>=stageBudget||Date.now()-started>=cfg.limits.sessionMs))return failed;
   entry.ocrRetryUsed=true;
   entry.dwellWaitMs=(entry.dwellWaitMs??0)+(entry.ocrSettlingCharged?0:entry.entrySettlingMs??0);entry.ocrSettlingCharged=true;
   const policy=waitPolicy(3000);
   if(!policy.valid||!unbounded&&entry.dwellWaitMs>=policy.limit!)return failed;
   // One raw capture only: no ordinary observe() exception retry and no action.
   guardObservation();
   let fresh:any;
   try{fresh=await device.capture();}catch(error:any){emit('entry_ocr_reobservation',{taskAttemptId:ctx.taskAttemptId,failedFrame:failed,error:String(error.message),freshFrameId:null,acceptedObservation:false,extraWaitMs:0});guardObservation();return failed;}
   const valid=stageActive&&(unbounded||observationRemaining()!>0)
    &&fresh.id!==failed.id&&fresh.id!==entry.sourceFrameId&&fresh.package===owner.package&&fresh.userId===owner.userId
    &&Number.isSafeInteger(fresh.capturedAt)&&fresh.capturedAt>=failed.capturedAt&&Date.now()>=fresh.capturedAt&&(unbounded||Date.now()-fresh.capturedAt<=15000)
    &&!fresh.observationError&&!fresh.lines.some((l:any)=>/登录|登陆|验证|授权|允许|温馨提示|确认|取消|同意/.test(l.text));
   emit('entry_ocr_reobservation',{taskAttemptId:ctx.taskAttemptId,failedFrame:failed,freshFrameId:fresh.id,freshFrame:fresh,acceptedObservation:valid,extraWaitMs:0,observationWaitMs:entry.dwellWaitMs});
   guardObservation();
   if(valid){frames.push(fresh);latest=fresh;}
   return valid?fresh:failed;
  };
  const recoveryEnabled=stageId==='enter_activity'&&navigationStage&&cfg.entryRecovery===true;
  // Keep the optional implementation out of disabled runs and their archives.
  const recoveryApi=recoveryEnabled?await import('./entry-recovery.ts'):null;
  const {inspectEntryRecovery,entryRecoverySource,entryRecoveryManifestDigest}=recoveryApi??{} as any;
  const recoveryKey=opts.sessionId;
  let priorRecovery=false;
  if(recoveryEnabled){
   try{priorRecovery=fs.readFileSync(path.join(opts.evidenceDir,'runtime.jsonl'),'utf8').split('\n').filter(Boolean).some(line=>{const e=JSON.parse(line);return e.sessionId===opts.sessionId&&typeof e.kind==='string'&&e.kind.startsWith('entry_recovery_');});}
   catch(error:any){if(error.code!=='ENOENT')priorRecovery=true;}
  }
  let recovery:any=recoveryEnabled?entryRecoverySessions.get(recoveryKey):null;
  let recoveryWaitAction:any=null;
  const recoveryEvent=async(kind:string,extra:any={})=>{
   const e={kind,at:new Date().toISOString(),stageId:'enter_activity',sessionId:opts.sessionId,taskAttemptId:recovery.taskAttemptId,recoveryId:recovery.recoveryId,version:entryRecoverySource.version,sourceFrameId:recovery.frame.id,sourceCapturedAt:recovery.frame.capturedAt,startedAt:recovery.startedAt,deadline:recovery.deadline,sourceManifestDigest:entryRecoveryManifestDigest,action:recovery.proof.action,...recovery.proof,proof:recovery.proof,...extra};
   fs.mkdirSync(opts.evidenceDir,{recursive:true});const fd=fs.openSync(path.join(opts.evidenceDir,'runtime.jsonl'),'a',0o600);
   try{fs.writeFileSync(fd,JSON.stringify(e)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   await opts.persistEntryRecovery?.(e);
  };
  const recoveryLive=(c:any,fresh=false)=>stageActive&&!c.signal?.aborted&&(unbounded||observationRemaining()!>0&&Date.now()<recovery.deadline&&performance.now()-recovery.startedMono<3000)&&recovery.taskAttemptId===ctx.taskAttemptId&&(!fresh||Date.now()>=recovery.frame.capturedAt&&(unbounded||Date.now()-recovery.frame.capturedAt<=1500));
  const recoveryStop=async(reason:string,unknown=false)=>{
   if(!['stopped','unknown'].includes(recovery.phase)){recovery.phase=unknown?'unknown':'stopped';await recoveryEvent(unknown?'entry_recovery_unknown':'entry_recovery_stopped',{reason});}
   return {done:false,blocked:true,reason:'Entry recovery '+reason};
  };
  const recoveryCheck=async(c:any,f:any,known:any)=>{
   if(!recoveryEnabled)return null;
   if(opts.resume||priorRecovery&&!recovery)return {done:false,blocked:true,reason:'Entry recovery resume requires original durable authority; no replay'};
   if(recovery){
    if(recovery.runtime!==frames||recovery.taskAttemptId!==ctx.taskAttemptId)return {done:false,blocked:true,reason:'Entry recovery session allowance already owned; no replay'};
    if(['stopped','unknown'].includes(recovery.phase))return {done:false,blocked:true,reason:'Entry recovery stopped/unknown; never replay'};
    if(recovery.phase==='confirmed')return null;
    if(!recoveryLive(c))return recoveryStop('deadline/attempt exceeded',recovery.consumed);
    if(recovery.phase==='prepared')return f===recovery.sourceObject?{done:false,reason:'Entry recovery skip ready'}:recoveryStop('source frame changed');
    if(recovery.phase==='home-recapture'){
     if(f.id===recovery.arrivalFrameId||f.capturedAt<recovery.arrivalCapturedAt||known?.state!=='home')return recoveryStop('home recapture not proven');
     recovery.phase='confirmed';return null;
    }
    if(recovery.phase==='awaitArrival'){
     if(f.id===recovery.frame.id||!Number.isSafeInteger(f.capturedAt)||f.capturedAt<=recovery.dispatchedAt||Date.now()<f.capturedAt||!unbounded&&Date.now()-f.capturedAt>1500||f.package!==owner.package||f.userId!==owner.userId)return recoveryStop('fresh owning arrival required',true);
     if(known&&['home','landing','panel'].includes(known.state)){
      if(!recoveryLive(c))return recoveryStop('late arrival inspection',true);
      recovery.arrivalFrameId=f.id;recovery.arrivalCapturedAt=f.capturedAt;
      await recoveryEvent('entry_recovery_confirmed',{arrivalFrameId:f.id,state:known.state,frame:f,arrivalProof:known});
      if(!recoveryLive(c))return recoveryStop('late arrival persistence',true);
      recovery.phase=known.state==='home'?'home-recapture':'confirmed';
      return known.state==='home'?{done:false,checkpoint:'entry_recovery_arrival',reason:'Recovery home confirmed; recapture for original navigation'}:null;
     }
     const ad=await inspectEntryRecovery(f,owner);if(!recoveryLive(c))return recoveryStop('late ad inspection',true);
     if(!ad)return recoveryStop('unknown arrival',true);
     if(!unbounded&&(recovery.waits>=2||(recovery.waitMs??0)+500>1000||Date.now()+500>=recovery.deadline))return recoveryStop('ad observation budget exhausted');
     return {done:false,checkpoint:'entry_recovery_arrival',reason:'Known ad; bounded read-only observation'};
    }
    return recoveryStop('invalid phase',true);
   }
   if(known)return null;
   const firstAt=Date.now(),firstMono=performance.now(),proof=await inspectEntryRecovery(f,owner);
   if(!proof)return null;
   if(entryRecoverySessions.has(recoveryKey))return {done:false,blocked:true,reason:'Entry recovery concurrent/reentrant session owner; no replay'};
   recovery={runtime:frames,taskAttemptId:ctx.taskAttemptId,recoveryId:randomUUID(),frame:structuredClone(f),sourceObject:f,proof,phase:'prepared',consumed:false,waits:0,startedAt:firstAt,startedMono:firstMono,deadline:unbounded?null:Math.min(firstAt+3000,Date.now()+observationRemaining()!)};
   entryRecoverySessions.set(recoveryKey,recovery);
   if(typeof opts.sessionId!=='string'||!opts.sessionId.trim()||typeof ctx.taskAttemptId!=='string'||!ctx.taskAttemptId.trim()||!recoveryLive(c,true))return recoveryStop('source expired or binding missing');
   try{await recoveryEvent('entry_recovery_prepared',{frame:recovery.frame});}catch{return recoveryStop('prepared persistence failed');}
   if(!recoveryLive(c,true))return recoveryStop('prepared source expired');
   return {done:false,reason:'Entry recovery skip ready'};
  };
  const r=await run({executionPolicy:cfg.executionPolicy,sessionId:opts.sessionId,stageId,scope:cfg.scope,goal:spec.goal,expectedCheckpoint:spec.checkpoint,previousCheckpoint:ctx.previousCheckpoint,taskAttemptId:ctx.taskAttemptId,task:ctx.task??selected,plan:opts.plan,constraints:{rules:cfg.constraints,frameMaxAgeMs:15000,...(focusedPanels&&keywordCompletion&&!navigationStage&&!launchStage?{observationAgePolicy:'data-only-v1' as const}:{}),allowedActions:navigationStage?['tap','wait']:launchStage?['launch']:['tap','swipe','back','wait']},script:candidateScript??(stageId==='return_list'?{id:'bounded-system-return',version:'v1',validated:true}:opts.recipes?.find((x:any)=>x.stageId===stageId&&x.state==='validated')?{id:opts.recipes.find((x:any)=>x.stageId===stageId).id,version:opts.recipes.find((x:any)=>x.stageId===stageId).version,validated:true}:undefined),budget:{maxMs:cfg.limits.stageMs,maxAgentCalls:launchStage||navigationStage?0:Math.min(8,cfg.limits.agentCalls-calls),maxActions:stageId==='return_list'?cfg.limits.maxReturns:cfg.limits.stageActions}}, {
   observe:observeStage,
   recoverUnsentDispatch:currentNavigation&&navigationStage?async(c:any,p:any,error:unknown)=>{
    const failed=unsentNavigation;
    if(!failed||failed.error!==error||failed.frame!==c.frame||failed.frame.id!==p.frameId||JSON.stringify(failed.action)!==JSON.stringify(p.action))return null;
    unsentNavigation=null;
    const prior=fs.readFileSync(path.join(opts.evidenceDir,'runtime.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line))
     .some(e=>e.kind==='navigation_foreground_recovery_consumed'&&e.sessionId===opts.sessionId);
    if(opts.resume||typeof opts.sessionId!=='string'||!opts.sessionId.trim()||typeof ctx.taskAttemptId!=='string'||!ctx.taskAttemptId.trim()||prior||foregroundRecoverySessions.has(opts.sessionId))return null;
    foregroundRecoverySessions.add(opts.sessionId);
    foregroundRecovery={recoveryId:randomUUID(),sessionId:opts.sessionId,taskAttemptId:ctx.taskAttemptId,stageId,sourceFrameId:failed.frame.id,sourceProposal:structuredClone(p),proof:failed.proof};
    emit('navigation_foreground_recovery_consumed',foregroundRecovery);
    try{
     guardObservation();if(c.signal?.aborted)throw Error('Navigation recovery aborted');
     // Exactly one full capture, bypassing observe() retries and all model readers.
     const fresh=await device.capture();
     guardObservation();if(c.signal?.aborted)throw Error('Navigation recovery aborted');
     const api=await import('./activity-navigation.ts'),known=await api.inspectCurrentActivityNavigation(fresh,owner);
     guardObservation();
     const old=failed.known;
     if(c.signal?.aborted||fresh.id===failed.frame.id||fresh.capturedAt<failed.frame.capturedAt||Date.now()<fresh.capturedAt||(!unbounded&&Date.now()-fresh.capturedAt>15000)
      ||known?.state!==navigationSourceState||known.action?.type!=='tap'||old.state!==known.state||old.version!==known.version
      ||fresh.package!==owner.package||fresh.userId!==owner.userId)throw Error('Navigation recovery original page/target not proven');
     validateProposedAction(known.action,fresh);
     frames.push(fresh);latest=fresh;navigationFrames.set(fresh,Promise.resolve(known));
     routes?.observe(fresh,{...activeContext,stageId,expectedCheckpoint:spec.checkpoint},known);
     const proposal={...p,frameId:fresh.id,action:known.action,reason:'Original navigation target rebound after device-proven unsent foreground failure'};
     emit('navigation_foreground_revalidated',{...foregroundRecovery,frame:fresh,proposal,inspection:known});
     guardObservation();if(c.signal?.aborted)throw Error('Navigation recovery aborted');
     navigationState.attempted=false;navigationState.unknown=false;navigationAction=known.action;navigationFrame=fresh;
     foregroundRecovery.frameId=fresh.id;
     return {frame:fresh,proposal,proof:foregroundRecovery};
    }catch(failure:any){navigationState.unknown=true;emit('navigation_foreground_recovery_stopped',{...foregroundRecovery,error:String(failure.message??failure)});return null;}
   }:undefined,
   get beforeDispatch(){
    if(!unbounded&&focusedPanels&&keywordCompletion&&learnedEnabled&&stageId==='open_task'&&!entry&&!aiActionPending&&Date.now()-latest?.capturedAt>15000)return async(c:any,p:any)=>{
     guardObservation();
     const source=c.frame,row=currentRow(source);
     if(opts.resume||!ownsAttempt(ctx)||entry||p.action?.type!=='tap'||!row?.point||p.action.x!==row.point[0]||p.action.y!==row.point[1])return null;
     // Capture directly: do not replay the slow reader or attach its evidence to new pixels.
     reusable=null;const fresh=await device.capture();guardObservation();
     frames.push(fresh);latest=fresh;
     if(c.signal?.aborted||frames.filter(f=>f.id===fresh.id).length!==1||fresh.path===source.path||fresh.capturedAt<source.capturedAt||Date.now()<fresh.capturedAt||(!unbounded&&Date.now()-fresh.capturedAt>15000))return null;
     const current=await inspectCurrentSelectedTask(fresh,owner,selected!);guardObservation();
     if(!current?.point||c.signal?.aborted||!ownsAttempt(ctx)||entry)return null;
     const action={type:'tap',x:current.point[0],y:current.point[1]};
     validateProposedAction(action,fresh);freshPanel(fresh);
     reboundRows.set(fresh,current);
     return {frame:fresh,proposal:{...p,frameId:fresh.id,action,reason:'Selected owning task and requirement rebound locally on a fresh capture'}};
    };
    return !aiActionPending&&stageId==='task_receipt'&&spec.continuousScroll&&!observationMatches()&&(learnedEnabled||spec.revalidateBeforeScroll)?async(c:any,p:any)=>{
    if(p.action?.type!=='swipe'){emit('browse_revalidation_rejected',{reason:'Only learned continuous content swipe can be reauthorized'});return null;}
    if(!destinationConfirmed||continuousScrollUsed||learnedEnabled&&(!boundEntry(ctx)||learnedScrollUsed)||!authorizedScrollBudget()||!unbounded&&c.remaining.ms<scrollBudget().maxMs+8000){emit('browse_revalidation_rejected',{reason:'destination, single-attempt or remaining-budget precondition'});return null;}
    const revalidationStarted=performance.now(),budgetBeforeRevalidation=c.remaining.ms;
    if(currentComponents&&learnedEnabled){
     const old=c.frame,fresh=await observe(guardObservation);
     const before=await inspectObservation(old),after=await inspectObservation(fresh);guardObservation();
     const matches=(a:any,b:any)=>a&&b&&['type','fromX','fromY','toX','toY','ms'].every(k=>a[k]===b[k]);
     if(fresh.id===old.id||fresh.capturedAt<old.capturedAt||Date.now()<fresh.capturedAt||(!unbounded&&Date.now()-fresh.capturedAt>15000)||before?.state!=='browsing'||after?.state!=='browsing'||before.version!==after.version||before.rewardCoins!==after.rewardCoins||before.requiredMs!==after.requiredMs||!matches(before.action,p.action)||!after.action||before.observedRemainingMs!==undefined&&after.observedRemainingMs>before.observedRemainingMs||!unbounded&&budgetBeforeRevalidation-(performance.now()-revalidationStarted)<scrollBudget().maxMs+8000)return null;
     validateProposedAction(after.action,fresh);
     return {frame:fresh,proposal:{...p,frameId:fresh.id,action:after.action,reason:'Current owning requirement component revalidated; swipe regenerated from fresh frame'}};
    }
    const old=c.frame,fresh=await observe();
    const check=autoContract?(await import('./learned-browse.ts')).revalidateLearnedBrowse:learnedEnabled?(opts.revalidateLearnedBrowse??(await import('./learned-browse.ts')).revalidateLearnedBrowse):(opts.revalidateBrowseSwipe??(await import('./browse-revalidation.ts')).revalidateBrowseSwipe);
    if(autoContract){
     const locked=entry.continuousContract;
     const before=await inspectSelectedContinuousContract(old,owner,locked),after=await inspectSelectedContinuousContract(fresh,owner,locked);
     if(before.inspection?.state!=='browsing'||after.inspection?.state!=='browsing'){needsLearning=true;return null;}
    }
    const verified=await check(old,fresh,p.action,owner,...(learnedEnabled?[autoContract?entry.continuousContract.option:cfg.learnedBrowse?.contract]:[]));
    if(!verified||!unbounded&&budgetBeforeRevalidation-(performance.now()-revalidationStarted)<scrollBudget().maxMs+8000){emit('browse_revalidation_rejected',{oldFrameId:old.id,freshFrameId:fresh.id,reason:'current page/region or remaining budget not proven'});return null;}
    return {frame:fresh,proposal:{...p,frameId:fresh.id,action:verified.action,reason:verified.reason}};
   }:undefined;},
   scriptStep:async(c:any)=>{
    const f=c.frame??latest;const panel=readPanel(f,cfg.panelMarker);
    if(navigationStage){
     if(recoveryEnabled&&recovery&&recovery.phase==='prepared'&&f===recovery.sourceObject){return {frameId:f.id,action:recovery.proof.action,reason:'One current run210 skip',expected:'entry_recovery_arrival'};}
     if(recoveryEnabled&&recovery?.phase==='home-recapture')return {frameId:f.id,reason:'Fresh frame required for original home entry',expected:'entry_recovery_arrival'};
     if(recoveryEnabled&&recovery?.phase==='awaitArrival'){
      recoveryWaitAction={type:'wait',ms:500};
      return {frameId:f.id,action:recoveryWaitAction,reason:'Recovery bounded read-only recapture',expected:'entry_recovery_arrival'};
     }
     const known=await inspectNavigation(f);
     if(known?.state!==navigationSourceState||!known.action||navigationState.attempted||navigationState.unknown)return {frameId:f.id,stop:true,reason:'Local activity navigation requires learning; no replay',expected:spec.checkpoint};
     navigationAction=known.action;navigationFrame=f;
     return {frameId:f.id,action:navigationAction,reason:'Unique current learned coin entry',expected:spec.checkpoint};
    }
    if(launchStage){
     if(launchState.attempted||launchState.unknown)return {frameId:f.id,stop:true,reason:'Local launch already attempted; never replay',expected:spec.checkpoint};
     launchAction={type:'launch',package:owner.package,userId:owner.userId};launchFrame=f;
     return {frameId:f.id,action:launchAction,reason:'Explicit local one-shot open_app launch',expected:spec.checkpoint};
    }
    if(candidateStage)guardObservation();
    if(candidateStage){
     if(stageId==='open_task'&&ownsAttempt(ctx)&&!entry){const row=currentRow(f);if(row)return {frameId:f.id,action:{type:'tap',x:row.point![0],y:row.point![1]},reason:'Explicit candidate: uniquely rebound current selected task row',expected:spec.checkpoint};}
     if(stageId==='task_receipt'&&boundEntry(ctx)&&destinationConfirmed){
      const learned=await inspectObservation(f);guardObservation();
      if(learned?.kind==='dwell'&&learned.state==='browsing'){
       const policy=waitPolicy(learned.action.ms),left=unbounded?learned.action.ms:policy.limit!-(entry.dwellWaitMs??0);
       const ms=Math.min(learned.action.ms,left);
       if(!entry.dwellUnknown&&policy.valid&&Number.isSafeInteger(ms)&&ms>0&&(unbounded||(entry.dwellWaitSlices??0)<policy.slices!&&c.remaining.ms>ms))
        return {frameId:f.id,action:{type:'wait',ms},reason:'Explicit dwell candidate bounded wait; reobserve before next slice',expected:'dwell_browsing'};
       return {frameId:f.id,stop:true,reason:'Dwell wait budget exhausted or dispatch unknown',expected:spec.checkpoint};
      }
      if(!observationMatches()&&!learnedScrollUsed&&spec.continuousScroll&&learned?.state==='browsing'&&learned.action)return {frameId:f.id,action:learned.action,reason:'Explicit learned candidate current-frame browse proposal',expected:spec.checkpoint};
     }
     return null;
    }
    if(stageId==='return_list'&&flashContract()){
     if(!panel.isPanel&&!flashReturn.unknown&&(unbounded||flashReturn.backs===0))return {frameId:f.id,action:{type:'back'},reason:'First bounded ordinary system return',expected:'flash_return_observed'};
     if(!panel.isPanel&&!flashReturn.unknown&&flashReturn.backs===1&&flashAuthority(ctx)&&flashReturn.modalFrameId===f.id)return {frameId:f.id,action:{type:'back'},reason:'Exact fresh flash modal after first back with same-attempt receipt',expected:spec.checkpoint};
     return {frameId:f.id,stop:true,reason:'Flash return authority exhausted or unconfirmed',expected:spec.checkpoint};
    }
    if(stageId==='return_list'&&!panel.isPanel&&(unbounded||backCount===0)){backCount++;return {frameId:f.id,action:{type:'back'},reason:'Bounded normal return after captured task receipt',expected:unbounded?'return_observed':'Task list or an observable return dialog'};}
    const recipe=opts.recipes?.find((x:any)=>x.stageId===stageId&&x.state==='validated');
    if(recipe){const p=recipeStep(recipe,f,scriptIndex);if(p){scriptIndex++;return p;}}
    return null;
   },
   agentStep:async(c:any)=>{
    if(navigationStage)return {frameId:c.frame.id,stop:true,reason:'Local navigation model fallback disabled',expected:spec.checkpoint};
    const f=c.frame??latest;
    if(aiTaskRecovery&&(['open_task','task_receipt'].includes(stageId)||stageId==='return_list')){
     const d=await recoverTask(c,f);
     if(!d?.next?.action)return {frameId:f.id,stop:true,reason:'AI recovery has no safe next step',expected:'Stop'};
     const action=d.next.action;
     if(!['tap','swipe','back','wait'].includes(action.type))throw Error('AI recovery unsupported action');
     if(['tap','swipe'].includes(action.type)&&entry.aiRecoveryUnconfirmed)throw Error('AI recovery prior action unconfirmed; safe observation or exit only');
     if(stageId==='return_list'&&!['tap','back','wait'].includes(action.type))throw Error('AI return recovery permits only safe exit or wait');
     if(action.type==='tap'){
      validateProposedAction(action,f);
      const targets=f.lines.filter((l:any)=>Array.isArray(l.bounds)&&action.x>=l.bounds[0]&&action.x<=l.bounds[2]&&action.y>=l.bounds[1]&&action.y<=l.bounds[3]);
      if(f.observationError||targets.length!==1||!(stageId==='return_list'?['关闭','关闭弹窗','返回']:['继续浏览','关闭','关闭弹窗','返回']).includes(targets[0].text.normalize('NFKC').trim()))throw Error('AI recovery tap lacks unique ordinary control evidence');
     }
     if(f.observationError&&!['back','wait'].includes(action.type))throw Error('AI recovery without OCR permits safe exit or wait only');
     taskRecoveryActions.set(action,{frame:f,entry,taskAttemptId:ctx.taskAttemptId});
     aiActionPending=true;
     return {frameId:f.id,...d.next};
    }
    const d=await describe(stageId,{...ctx,...c,frame:f});
    if(d.blocked||d.stopReason)return {frameId:f.id,stop:true,reason:d.stopReason??'Blocked',expected:'Stop'};
    if(!d.next?.action)return {frameId:f.id,stop:true,reason:'Agent has no supported next step',expected:'Stop'};
    return {frameId:f.id,...d.next};
   },
   dispatch:async(action:any,f:any)=>{
    if(recoveryEnabled&&recovery&&recovery.phase!=='confirmed'){
     if(action.type==='wait'&&recovery.phase==='awaitArrival'){
      const settling=action!==recoveryWaitAction&&action.ms===1000;
      if(settling){
       const nav=await inspectNavigation(f),ad=nav?null:await inspectEntryRecovery(f,owner);
       if(!recoveryLive({})||f.id===recovery.frame.id||f.capturedAt<=recovery.dispatchedAt||Date.now()<f.capturedAt||!unbounded&&Date.now()-f.capturedAt>1500||!nav&&!ad){await recoveryStop('unknown or stale pre-settling observation',true);throw Error('Entry recovery unknown pre-settling observation');}
      }
      if(!recoveryLive({})||(!settling&&(action!==recoveryWaitAction||action.ms!==500||!unbounded&&recovery.waits>=2))||!unbounded&&((recovery.waitMs??0)+action.ms>1000||Date.now()+action.ms>=recovery.deadline))throw Error('Entry recovery wait budget exceeded');
      recovery.waitMs=(recovery.waitMs??0)+action.ms;
      if(!settling){recovery.waits++;recoveryWaitAction=null;}
      try{await device.act(action,f);if(!recoveryLive({}))throw Error('Entry recovery deadline exceeded during wait');}catch(error){await recoveryStop('wait failed',true);throw error;}return;
     }
     if(action.type==='tap'){
      if(recovery.phase!=='prepared'||recovery.consumed||action!==recovery.proof.action||f!==recovery.sourceObject||!recoveryLive({},true))throw Error('Entry recovery dispatch not authorized');
      const verified=await inspectEntryRecovery(f,owner);
      if(!verified||JSON.stringify(verified)!==JSON.stringify(recovery.proof)||!recoveryLive({},true))throw Error('Entry recovery source changed or expired');
      validateProposedAction(action,f);
      // Reserve before persistence: even an uncertain append can never create another allowance.
      recovery.consumed=true;recovery.phase='consuming';
      try{
       await recoveryEvent('entry_recovery_consumed',{frame:recovery.frame,fsynced:true});
       if(!recoveryLive({},true))throw Error('Entry recovery expired during consume');
       const finalProof=await inspectEntryRecovery(f,owner);
       if(!finalProof||JSON.stringify(finalProof)!==JSON.stringify(recovery.proof)||!recoveryLive({},true))throw Error('Entry recovery evidence changed after consume');
       await device.act(action,f);
       const completedAt=Date.now();
       if(recovery.phase!=='consuming'||!recoveryLive({}))throw Error('Entry recovery late dispatch completion');
       recovery.dispatchedAt=completedAt;recovery.phase='awaitArrival';
       await recoveryEvent('entry_recovery_dispatched',{dispatchedAt:recovery.dispatchedAt});
       if(!recoveryLive({}))throw Error('Entry recovery late dispatch completion');
      }catch(error){await recoveryStop('dispatch/persistence outcome unknown',true);throw error;}
      return;
     }
     throw Error('Entry recovery action not authorized');
    }
    if(navigationStage){
     // Engine settling waits carry no navigation authority and cannot replay a tap.
     if(action.type==='wait'&&navigationState.attempted&&!navigationState.unknown&&Number.isFinite(action.ms)&&action.ms>=0&&action.ms<=1000){await device.act(action,f);return;}
     if(action!==navigationAction||f!==navigationFrame||action.type!=='tap'||navigationState.attempted||navigationState.unknown)throw Error('Local activity dispatch not authorized');
     const api=await import('./activity-navigation.ts');
      const known=currentNavigation&&f.navigationEvidence?loadNavigation(f,owner,{stageId,expectedCheckpoint:spec.checkpoint}):await (currentNavigation?api.inspectCurrentActivityNavigation(f,owner):api.inspectLearnedActivityNavigation(f,owner));
      if(currentNavigation&&remainingPanelMs()<=0)throw Error('Navigation dispatch deadline exceeded');
     if(known?.state!==navigationSourceState||known.action?.type!=='tap'||known.action.x!==action.x||known.action.y!==action.y||Date.now()<f.capturedAt||(!unbounded&&Date.now()-f.capturedAt>15000))throw Error('Local activity frame/action mismatch or expired');
     let chromeRefinement:any;
     if(known.chromeRefinement){
      const ref=known.chromeRefinement,sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
      const crop=fs.readFileSync(ref.path),raw=fs.readFileSync(ref.rawPath),ocr=fs.readFileSync(ref.ocrPath);
      if(ref.frameId!==f.id||sha(crop)!==ref.cropSha||sha(raw)!==ref.sourceSha||sha(ocr)!==ref.ocrSha||!raw.equals(fs.readFileSync(f.path)))throw Error('Navigation refinement evidence changed');
      const dir=fs.mkdtempSync(path.join(path.resolve(opts.evidenceDir), 'navigation-refinement-'));
      chromeRefinement={...ref,path:path.join(dir,'crop.png'),rawPath:path.join(dir,'frame.png'),ocrPath:path.join(dir,'ocr.json'),ocrInputPath:ref.path};
      for(const [file,bytes]of [[chromeRefinement.path,crop],[chromeRefinement.rawPath,raw],[chromeRefinement.ocrPath,ocr]] as [string,Buffer][]){
       const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      }
     }
     validateProposedAction(action,f);
     if(currentNavigation)guardObservation();
     if(Date.now()<f.capturedAt||(!unbounded&&Date.now()-f.capturedAt>15000))throw Error('Local activity frame expired while archiving refinement');
     navigationState.attempted=true;navigationState.sourceFrameId=f.id;navigationAction=null;navigationFrame=null;
     emit('activity_navigation_attempted',{stageId,frameId:f.id,action,provenance:known.provenance,...(known.matchedComponents?{matchedComponents:structuredClone(known.matchedComponents)}:{}),...(chromeRefinement?{chromeRefinement}:{})});
     routes?.dispatched(stageId,f,action,'pending');
     try{
      await device.act(action,f,currentNavigation?{beforeInput:guardObservation}:undefined);routes?.dispatched(stageId,f,action,'sent');
      if(foregroundRecovery?.frameId===f.id)emit('navigation_foreground_recovery_sent',{...foregroundRecovery,frameId:f.id,action});
     }catch(error){
      navigationState.unknown=true;
      const proof=currentNavigation?device.consumeUnsentTap?.(error,action,f):null;
      routes?.dispatched(stageId,f,action,proof?'not_sent':'unknown');
      if(proof){unsentNavigation={error,action,frame:f,proof,known};emit('navigation_foreground_not_sent',{sessionId:opts.sessionId,taskAttemptId:ctx.taskAttemptId,stageId,frameId:f.id,action,proof});}
      if(foregroundRecovery?.frameId===f.id)emit('navigation_foreground_recovery_unknown',{...foregroundRecovery,frameId:f.id,action});
      throw error;
     }
     return;
    }
    if(action?.type==='launch'){
     if(!launchStage||action!==launchAction||f!==launchFrame||launchState.attempted||launchState.unknown
      ||f.package===owner.package&&f.userId===owner.userId)throw Error('Local launch dispatch not authorized');
     validateProposedAction(action,f,owner);
     launchState.attempted=true;launchState.sourceFrameId=f.id;launchAction=null;launchFrame=null;
     try{await device.act(action,f);}catch(error){launchState.unknown=true;throw error;}
     return;
    }
    validateProposedAction(action,f);
    const recoveredAction=taskRecoveryActions.get(action);
    if(recoveredAction){
     aiActionPending=false;
     taskRecoveryActions.delete(action);
     if(recoveredAction.frame!==f||recoveredAction.entry!==entry||recoveredAction.taskAttemptId!==ctx.taskAttemptId||!recoveryAuthority({},f))throw Error('AI recovery action authority expired');
     const sent=action.type==='wait'&&action.ms>5000?{...action,ms:5000}:action;
     if(['tap','swipe'].includes(sent.type))entry.aiRecoveryUnconfirmed={frameId:f.id,action:structuredClone(sent)};
     try{await device.act(sent,f);guardObservation();}catch(error){entry.aiRecoveryUnknown=true;throw error;}return;
    }
    if(stageId==='return_list'&&flashContract()){
     if(action.type!=='back'||flashReturn.unknown||!unbounded&&flashReturn.backs>=2||flashReturn.lastFrameId===f.id||!unbounded&&flashReturn.backs===1&&(!flashAuthority(ctx)||flashReturn.modalFrameId!==f.id))throw Error('Flash return dispatch not authorized');
     flashReturn.backs++;backCount=flashReturn.backs;flashReturn.lastFrameId=f.id;flashReturn.modalFrameId=null;
     emit('flash_return_back',{taskAttemptId:ctx.taskAttemptId,frameId:f.id,number:flashReturn.backs,version:flashContract().version,state:'candidate'});
     try{
      await device.act(action,f);
      await device.act({type:'wait',ms:800});
      emit('return_settling',{ms:800,backNumber:flashReturn.backs});
     }catch(error){flashReturn.unknown=true;throw error;}
     return;
    }
    if(stageId==='task_receipt'&&!observationMatches()&&spec.continuousScroll&&action.type==='swipe'){
     if(continuousScrollUsed||learnedEnabled&&(!boundEntry(ctx)||!destinationConfirmed||learnedScrollUsed))throw Error('Continuous scroll already attempted or owning entry unconfirmed; verify or stop');
     if(autoContract&&(!authorizedScrollBudget()||action.ms!==900))throw Error('Selected continuous contract exceeds authorized segment budget');
     if(cfg.learnedBrowse?.contract){
      const c=cfg.learnedBrowse.contract,l=spec.continuousScroll;
      if(entry?.requiredMs!==c.requiredMs||entry?.browseRewardCoins!==c.rewardCoins||l.requiredMs!==c.requiredMs||!unbounded&&(l.maxSwipes!==30||l.maxMs!==35000)||action.ms!==900)throw Error('Continuous requirement and authorized segment budget mismatch');
     }
     continuousScrollUsed=true;if(learnedEnabled)learnedScrollUsed=true;
     emit('continuous_scroll_started',{sourceFrameId:f.id,action,limits:scrollBudget()});
     await device.scrollContinuously(action,f,scrollBudget());
     emit('continuous_scroll_finished',{sourceFrameId:f.id,completionInferred:false});return;
    }
    let actualEntry:any=null;
    if(stageId==='open_task'&&action.type==='tap'&&selected&&readPanel(f,cfg.panelMarker).isPanel){
     // Selection used one frame; a new frame must bind full current identity and requirements again.
     const p=readPanel(f,cfg.panelMarker);const t=learnedEnabled?currentRow(f):p.tasks.find(t=>same(t.name,selected!.name)&&same(t.instruction,selected!.instruction)&&t.done<t.total);
     if(!t)throw Error('Selected task not uniquely present in current frame');
     const exact=reboundRows.has(f)?[t]:p.tasks.filter(x=>same(x.name,t.name)&&same(x.instruction,t.instruction));if(exact.length!==1)throw Error('Ambiguous current task');
     if(!t.point||Math.hypot(action.x-t.point[0],action.y-t.point[1])>75)throw Error('Agent proposed tap does not belong to selected row');
     if(learnedEnabled||flashContract()){
      if(!ownsAttempt(ctx)||entry)throw Error('Selected task entry already attempted or attempt binding missing');
      actualEntry=entry={taskAttemptId:ctx.taskAttemptId,name:t.name,instruction:t.instruction,sourceFrameId:f.id,entryActionId:`${ctx.taskAttemptId}:${f.id}:tap`,dispatched:false};
     }
     selected={...t,beforeFrame:{path:f.path,ocrPath:f.path.replace(/\.png$/,'.json')}}as any;
    }
    const sent=action.type==='wait'&&Number.isSafeInteger(action.ms)&&action.ms>5000?{...action,ms:5000}:action;
    if(sent!==action)emit('bounded_wait_slice',{requested:action.ms,executed:sent.ms,reason:'Reobserve after at most 5000ms; no completion inferred'});
    if(stageId==='task_receipt'&&observationMatches()){
     const {limit,valid,slices}=waitPolicy(sent.ms);
     if(!boundEntry(ctx)||!destinationConfirmed||entry.dwellUnknown||sent.type!=='wait'||!valid||!Number.isSafeInteger(sent.ms)||sent.ms<=0||!unbounded&&((entry.dwellWaitSlices??0)>=slices!||(entry.dwellWaitMs??0)+sent.ms>limit!))throw Error('Dwell wait authority or budget exhausted');
     if(immersiveMatch())entry.dwellSliceLimit??=slices;
     entry.dwellWaitSlices=(entry.dwellWaitSlices??0)+1;entry.dwellWaitMs=(entry.dwellWaitMs??0)+sent.ms;
     emit('dwell_wait_slice',{taskAttemptId:ctx.taskAttemptId,frameId:f.id,ms:sent.ms,slices:entry.dwellWaitSlices,totalMs:entry.dwellWaitMs,limitMs:limit,completionInferred:false});
     try{await device.act(sent,f);}catch(error){entry.dwellUnknown=true;throw error;}
    }else {
     if(stageId==='open_task'&&immersiveMatch()&&boundEntry(ctx)&&sent.type==='wait'){
      entry.entrySettlingMs=(entry.entrySettlingMs??0)+sent.ms;
      try{await device.act(sent,f);guardObservation();}catch(error){entry.dwellUnknown=true;throw error;}
     }else {
      try{await device.act(sent,f,focusedPanels&&keywordCompletion&&actualEntry?{beforeInput:guardObservation}:undefined);}
      catch(error){if(unbounded&&stageId==='return_list'&&sent.type==='back')ordinaryReturnUnknown=true;throw error;}
     }
    }
    if(actualEntry){guardObservation();actualEntry.dispatched=true;emit('learned_entry_dispatched',actualEntry);}
    if(learnedEnabled&&stageId==='return_list'&&action.type==='back'&&backCount===1){
     // back consumes the frame. The bounded wait carries no stale frame authority;
     // engine observes a new capture before checking the returned panel.
     await device.act({type:'wait',ms:(unbounded?800:Math.min(800,Math.max(1,cfg.limits.stageMs)))});
     emit('return_settling',{ms:(unbounded?800:Math.min(800,Math.max(1,cfg.limits.stageMs)))});
    }
   },
   check:async(c:any)=>{
    const f=c.frame??latest;const panel=readPanel(f,cfg.panelMarker);
    if(navigationStage){
     if(opts.resume)return {done:false,blocked:true,reason:'Local navigation resume requires original durable authority; no replay'};
     if(navigationState.unknown)return {done:false,blocked:true,reason:'Local activity dispatch unknown; never replay'};
     const known=await inspectNavigation(f);
     const recovered=await recoveryCheck(c,f,known);if(recovered)return recovered;
     if((known?.state==='panel'||stageId==='enter_activity'&&known?.state==='landing')&&(!navigationState.attempted||f.id!==navigationState.sourceFrameId))return {done:true,checkpoint:spec.checkpoint};
     if(known?.state===navigationSourceState&&!navigationState.attempted)return {done:false,reason:'Learned navigation entry ready'};
     return {done:false,blocked:true,reason:'Local activity navigation needsLearning: unknown/obscured destination or open_list not learned; no model fallback'};
    }
    if(launchStage&&launchState.unknown)return {done:false,blocked:true,reason:'Local launch outcome unknown; never replay'};
    if(stageId==='return_list'&&(ordinaryReturnUnknown||aiTaskRecovery&&entry?.aiReturnUnknown))return {done:false,blocked:true,reason:'Previous system return dispatch unknown; never replay'};
    if(launchStage&&launchState.attempted&&(f.id===launchState.sourceFrameId||f.package!==owner.package||f.userId!==owner.userId))return {done:false,blocked:true,reason:'Fresh target foreground required after local launch; never replay'};
    if(launchStage&&currentNavigation&&f.package===owner.package&&f.userId===owner.userId){
     const known=await inspectNavigation(f);
     if(known&&['home','landing','panel'].includes(known.state))return {done:true,checkpoint:spec.checkpoint};
    }
    if(panel.blocked||keywordCompletion&&hasIdentityChallenge(observationTexts(f)))return {done:false,blocked:true,reason:'Login/verification'};
    if(f.package!==cfg.package||f.userId!==cfg.scope.userId)return {done:false,blocked:stageId!=='open_app',reason:'Wrong foreground identity'};
    if(stageId==='open_app')return {done:true,checkpoint:spec.checkpoint};
    if((['open_list','return_list'].includes(stageId)||learnedEnabled&&stageId==='enter_activity')&&panel.isPanel&&(panel.tasks.length||focusedPanels&&stageId==='return_list'&&loadAiPanel(f)?.readPurpose==='return-status'))return {done:true,checkpoint:spec.checkpoint};
    if(aiTaskRecovery&&['open_task','task_receipt'].includes(stageId)&&(!ownsAttempt(ctx)||entry&&!boundEntry(ctx)||entry?.dwellUnknown||entry?.aiRecoveryUnknown))return {done:false,blocked:true,reason:'AI task recovery attempt missing or dispatch unknown; never replay'};
    if(learnedEnabled&&stageId==='open_task'){
     if(ownsAttempt(ctx)&&!entry&&currentRow(f))return {done:false,reason:'Selected current row ready for one actual entry'};
     if(boundEntry(ctx)&&!panel.isPanel&&f.id!==entry.sourceFrameId){
      if(keywordCompletion&&aiBrowseEvidence(ctx)&&recoveryAuthority(c,f)&&!f.observationError&&currentCompletionQuote(observationTexts(f)))return {done:true,checkpoint:spec.checkpoint};
      const learned=await inspectObservation(f);guardObservation();if(learned){emit('learned_destination_confirmed',{frameId:f.id,taskAttemptId:ctx.taskAttemptId,state:learned.state,rewardCoins:learned.rewardCoins,version:learned.version});return {done:true,checkpoint:spec.checkpoint};}
     }
    }
    if(learnedEnabled&&stageId==='task_receipt'&&boundEntry(ctx)&&destinationConfirmed&&!panel.isPanel){
     if(keywordCompletion&&!entry.dwellUnknown&&!entry.aiRecoveryUnknown&&c.pendingAction?.status!=='unknown'&&f.id!==entry.sourceFrameId
      &&Number.isFinite(f.capturedAt)&&f.capturedAt>=frames.find(x=>x.id===entry.sourceFrameId)?.capturedAt&&Date.now()>=f.capturedAt&&(unbounded||Date.now()-f.capturedAt<=15000)){
      const quote=!f.observationError&&currentCompletionQuote(observationTexts(f));
      if(quote){
       receipt={frameId:f.id,path:f.path,quote,taskAttemptId:ctx.taskAttemptId,version:'current-keywords-v1'};
       entry.receiptFrameId=f.id;emit('learned_receipt',{...receipt,sourceRunId:localSourceRun()});return {done:true,checkpoint:spec.checkpoint};
      }
     }
     const learned=await inspectObservation(f);guardObservation();
     if(learned?.state==='completed'&&learned.quote?.trim()){
      receipt={frameId:f.id,path:f.path,quote:learned.quote,taskAttemptId:ctx.taskAttemptId,version:learned.version,rewardCoins:learned.rewardCoins,...(learned.rewardTransitionVersion?{requirementRewardCoins:learned.requirementRewardCoins,rewardTransitionVersion:learned.rewardTransitionVersion}:{})};
      if(boundEntry(ctx))entry.receiptFrameId=f.id;
      emit('learned_receipt',{...receipt,sourceRunId:localSourceRun()});return {done:true,checkpoint:spec.checkpoint};
     }
     if(learned?.state==='browsing')return {done:false,...(learned.kind==='dwell'?{checkpoint:'dwell_browsing'}:{}),reason:'Current learned page still browsing; completion requires a real receipt'};
    }
    if(aiTaskRecovery&&boundEntry(ctx)&&['open_task','task_receipt'].includes(stageId)){
     const d=await recoverTask(c,f);
     if(!d)return {done:false,blocked:true,reason:'AI task recovery lacks current owning ordinary browse evidence'};
     if(stageId==='task_receipt'&&d.stageDone){
      receipt={frameId:f.id,path:f.path,quote:d.completionQuote,taskAttemptId:ctx.taskAttemptId,version:'ai-task-recovery-v1'};
      entry.receiptFrameId=f.id;emit('ai_task_receipt',receipt);
     }
     const done=stageId==='open_task'?!!aiBrowseEvidence(ctx):d.stageDone;
     return {done,checkpoint:done?spec.checkpoint:undefined,reason:d.pageIdentity};
    }
    if(aiEnabled&&boundEntry(ctx)&&['open_task','task_receipt'].includes(stageId))return {done:false,blocked:true,reason:'AI panel mode requires existing local task/receipt contract; model interruption disabled'};
    if(immersiveMatch()&&['open_task','task_receipt'].includes(stageId))return {done:false,blocked:true,reason:'Immersive current owning entry or local page evidence unconfirmed; stop without fallback'};
    if(autoContract&&!observationMatches()&&['open_task','task_receipt'].includes(stageId)){
     needsLearning=true;emit('continuous_contract_needs_learning',{stageId,taskAttemptId:ctx.taskAttemptId,frameId:f.id});
     return {done:false,blocked:true,reason:'Continuous contract needsLearning: owning entry or locked page evidence unconfirmed'};
    }
    if(stageId==='return_list'&&flashContract()){
     flashReturn.modalFrameId=null;
     if(flashReturn.unknown)return {done:false,blocked:true,reason:'Previous flash return dispatch unknown; never replay'};
     if(unbounded||flashReturn.backs===0)return {done:false,...(unbounded&&flashReturn.backs>0?{checkpoint:'flash_return_observed'}:{}),reason:'Ordinary system return remains available'};
     if(flashReturn.backs===1&&flashAuthority(ctx)&&f.id!==flashReturn.lastFrameId&&f.capturedAt>=frames.find(x=>x.id===flashReturn.lastFrameId)?.capturedAt){
      const modal=await (await import('./flash-return.ts')).inspectFlashReturn(f,owner);
      if(modal){flashReturn.modalFrameId=f.id;return {done:false,checkpoint:'flash_return_observed',reason:'Exact fresh flash retention modal; one second back authorized'};}
     }
     return {done:false,blocked:true,reason:'Flash return requires exact modal and owning receipt; no additional action'};
    }
    if(stageId==='return_list'&&(unbounded||backCount===0))return {done:false,...(unbounded&&backCount>0?{checkpoint:'return_observed'}:{}),reason:'First bounded system return; receipt uncertainty does not forbid navigation'};
    if(aiTaskRecovery&&stageId==='return_list'){
     const d=await recoverTask(c,f);return d?{done:false,reason:d.pageIdentity}:{done:false,blocked:true,reason:'AI return recovery lacks current owning safe exit evidence'};
    }
    const d=await describe(stageId,{...ctx,...c,frame:f});
    if(d.blocked||d.stopReason)return {done:false,blocked:true,reason:d.stopReason??'Blocked'};
    let done=d.stageDone;
    if(stageId==='open_task')done=done&&!panel.isPanel&&d.ordinaryBrowseOnly===true;
    if(stageId==='task_receipt'){
     done=done&&!panel.isPanel&&!!d.completionQuote?.trim();
     if(done){receipt={frameId:f.id,path:f.path,quote:d.completionQuote,taskAttemptId:ctx.taskAttemptId};if(boundEntry(ctx))entry.receiptFrameId=f.id;}
    }
    return {done,checkpoint:done?spec.checkpoint:undefined,reason:d.pageIdentity};
   },
   review:(s:any)=>review(stageId,s),persist:(event:any)=>emit('stage_event',{stageId,event}),
  });
  stageActive=false;routes?.finish(stageId,r);
  if(foregroundRecovery){const arrival=(r.events??[]).filter((e:any)=>e.type==='observed').at(-1)?.frame;emit('navigation_foreground_recovery_arrival',{...foregroundRecovery,status:r.status,arrivalFrameId:arrival?.id??null,checkpoint:r.checkpoint});}
  if(recoveryEnabled&&recovery&&recovery.runtime===frames&&!['confirmed','home-recapture','stopped','unknown'].includes(recovery.phase))await recoveryStop(r.error??'stage ended before recovery confirmation',recovery.consumed);
  if(aiTaskRecovery&&stageId==='return_list'&&entry&&r.status==='unknown')entry.aiReturnUnknown=true;
  if(boundEntry(ctx)&&['open_task','task_receipt'].includes(stageId)&&r.status==='unknown')entry.dwellUnknown=true;
  allStages.push({...r,stageId});
  if(stageId==='open_task')destinationConfirmed=r.status==='completed';
  if(needsLearning)r.needsLearning=true;
  if(stageId==='open_task'&&selected)r.task=selected;
  if(stageId==='task_receipt'&&receipt)r.receipt=receipt;
  return r;
 };
 const panelViewportKey=(f:any,p:any)=>JSON.stringify({top:p.top,bottom:p.bottom,tasks:p.tasks.map((t:any)=>({name:t.name,instruction:t.instruction,done:t.done,total:t.total,bounds:t.bounds,point:t.point,button:t.button})),clippedRows:p.clippedRows??[],...(!p.tasks.length?{lines:f.lines.map((l:any)=>({text:l.text.normalize('NFKC').trim(),bounds:l.bounds}))}:{})});
 const collect=async(ctx:any)=>{
  let top=false,bottom=false;const pages:any[]=[],topSearchPages:any[]=[],topSeen=new Set<string>(),scanSeen=new Set<string>();
  const save=(complete=false,reason:string|null=null)=>{
   fs.mkdirSync(opts.evidenceDir,{recursive:true});
   fs.writeFileSync(path.join(opts.evidenceDir,'inventory.json'),j({top,bottom,complete,partial:!complete,reason,pages,topSearchPages})+'\n',{mode:0o600});
  };
  const record=(f:any,phase:'top-search'|'scan')=>{
   const p=readPanel(f,cfg.panelMarker),dataUsable=f.package===owner.package&&f.userId===owner.userId&&p.isPanel&&!p.blocked;
   const list=phase==='scan'?pages:topSearchPages;
   if(!list.some(page=>page.frameId===f.id))list.push({frameId:f.id,path:f.path,capturedAt:f.capturedAt,readCompletedAt:panelReadTimes.get(f)??Date.now(),dataUsable,
    actionUsable:dataUsable&&Number.isFinite(f.capturedAt)&&Date.now()>=f.capturedAt&&(unbounded||Date.now()-f.capturedAt<=15000),
    ...(f.aiPanelEvidence?{aiPanelEvidence:f.aiPanelEvidence}:{}),...p});
   save();return p;
  };
  try{
   save();let f=await observe(),p=record(f,'top-search');
   for(let i=0;unbounded||i<=3;i++){
    if(!p.isPanel||p.blocked||f.package!==owner.package||f.userId!==owner.userId)throw Error('Inventory page identity failed');
    if(p.top){top=true;break;}
    const key=panelViewportKey(f,p);if(topSeen.has(key))throw Error('Inventory top-search made no viewport progress');topSeen.add(key);
    if(!unbounded&&i===3)break;
    await panelAct({type:'swipe',fromX:Math.round(f.width*.38),fromY:Math.round(f.height*.36),toX:Math.round(f.width*.38),toY:Math.round(f.height*.84),ms:600},f);f=await observe();p=record(f,'top-search');
   }
   if(!top)throw Error('Inventory top not verified');
   for(let i=0;unbounded||i<cfg.limits.inventoryPages;i++){
    p=record(f,'scan');if(!p.isPanel||p.blocked||f.package!==owner.package||f.userId!==owner.userId)throw Error('Inventory page identity failed');
    inventory.push(...p.tasks);
    if(p.bottom){bottom=true;break;}
    const key=panelViewportKey(f,p);if(scanSeen.has(key))throw Error('Inventory scan made no viewport progress');scanSeen.add(key);
    if(!unbounded&&i===cfg.limits.inventoryPages-1)break;
    await panelAct({type:'swipe',fromX:Math.round(f.width*.38),fromY:Math.round(f.height*.84),toX:Math.round(f.width*.38),toY:Math.round(f.height*.36),ms:600},f);f=await observe();
   }
   if(focusedPanels&&!pages.some(page=>page.tasks.length))throw Error('Empty task inventory cannot establish completeness');
   if(!bottom)throw Error('Inventory bottom not verified');
   if(remainingPanelMs()<=0)throw Error('Inventory stage/session deadline exceeded');
   save(true);
   return {status:'completed',checkpoint:'inventory_saved',review:{summary:aiEnabled?'ai-panel-v1 scroll inventory saved':'OCR scroll inventory saved',pages:pages.length,complete:true}};
  }catch(error:any){const reason=String(error.message??error);save(false,reason);return {status:'stopped',error:reason};}
 };
 const choose=async(ctx:any)=>{
  const collectedFile=path.join(opts.evidenceDir,'inventory.json');
  if(cfg.selectionAllowNew===false&&fs.existsSync(collectedFile)){
   const collected=JSON.parse(fs.readFileSync(collectedFile,'utf8'));
   if(collected.complete===true&&!inventory.some(t=>opts.plan.some((d:any)=>plannedTaskEligible(t,d,{mode:cfg.selectionPolicy,completed:opts.completed,scriptValidation:cfg.scriptValidationMode}))))
    return {status:'stopped',error:'No eligible planned task in complete current inventory'};
  }
  let f=await observe(()=>{},focusedPanels),p=readPanel(f,cfg.panelMarker);
  const owningPanel=()=>p.isPanel&&!p.blocked&&f.package===owner.package&&f.userId===owner.userId;
  const topSeen=new Set<string>(),scanSeen=new Set<string>();
  for(let i=0;!p.top;i++){
   if(!owningPanel())return {status:'stopped',error:'Task list not confirmed'};
   const key=panelViewportKey(f,p);if(topSeen.has(key))return {status:'stopped',error:'Selection top-search made no viewport progress'};topSeen.add(key);
   if(!unbounded&&i===3)return {status:'stopped',error:'Selection top not verified'};
   await panelAct({type:'swipe',fromX:Math.round(f.width*.38),fromY:Math.round(f.height*.36),toX:Math.round(f.width*.38),toY:Math.round(f.height*.84),ms:600},f);f=await observe();p=readPanel(f,cfg.panelMarker);
  }
  const selectionPages=cfg.limits.inventoryPages??4;
  for(let i=0;unbounded||i<selectionPages;i++){
   if(!owningPanel())return {status:'stopped',error:'Task list not confirmed'};
   const current=p.tasks.filter(t=>t.done<t.total);
   const eligible=current.filter(t=>opts.plan.some((d:any)=>plannedTaskEligible(t,d,{mode:cfg.selectionPolicy,completed:opts.completed,scriptValidation:cfg.scriptValidationMode})));
   let t:CurrentTask|undefined=eligible[0];
   if(!t&&!aiEnabled&&cfg.selectionAllowNew!==false){
    const choice=await query('从当前图中选择一项可尝试的任务，结合保存计划和范围。只选择明确独立普通浏览且原计划不为skip或pending的任务；新名称必须根据完整实际说明判断，不能按标题猜。当前可见候选与原规划匹配不清可以建议一个新普通浏览候选，首次打开后仍需核实真实要求。返回严格JSON {"name":"逐字当前任务名或null","instruction":"逐字当前说明，不含奖励","reason":"完整依据","ordinaryBrowse":boolean}。不操作、不选领奖、搜索、游戏、邀请、安装、外部应用、消费任务。',f,{...contextFor('select_task',ctx),policy:cfg.taskPolicy,currentTasks:current,fullCollectedTasks:inventory,completed:opts.completed??[]});
    if(choice.ordinaryBrowse===true&&typeof choice.name==='string'){
     const forbidden=opts.plan.some((d:any)=>same(d.name,choice.name)&&d.decision!=='do')||(opts.completed??[]).some((name:string)=>same(name,choice.name));
     if(!forbidden){const matches=current.filter(x=>same(x.name,choice.name)&&same(x.instruction,choice.instruction??''));if(matches.length===1)t=matches[0];}
    }
   }
   if(t&&p.balance!==null&&p.balance>0){selected={...t,beforeFrame:{path:f.path,ocrPath:f.path.replace(/\.png$/,'.json')}}as any;beforeBalance=p.balance;emit('selection',{task:selected,balanceBefore:p.balance,sourceFrame:f.id});return {status:'completed',task:selected,balanceBefore:p.balance};}
   if(p.bottom)break;
   const key=panelViewportKey(f,p);if(scanSeen.has(key))return {status:'stopped',error:'Selection scan made no viewport progress'};scanSeen.add(key);
   if(!unbounded&&i===selectionPages-1)break;
   await panelAct({type:'swipe',fromX:Math.round(f.width*.38),fromY:Math.round(f.height*.84),toX:Math.round(f.width*.38),toY:Math.round(f.height*.36),ms:600},f);f=await observe();p=readPanel(f,cfg.panelMarker);
  }
  return {status:'stopped',error:'No eligible current task found in bounded selection'};
 };
 const settle=async(ctx:any)=>{
  if(!selected||!receipt||beforeBalance===null)return {status:'stopped',error:'Missing receipt or baseline'};
  if(interactionRoute&&(!interactionRoute.ownsEntry||interactionRoute.unknown||receipt.taskAttemptId!==ctx.taskAttemptId))return {status:'unknown',error:'Interaction receipt does not bind current successful input'};
  if(!interactionRoute&&(controllerMatch(selected)?receipt.taskAttemptId!==ctx.taskAttemptId:learnedEnabled&&(!boundEntry(ctx)||receipt.taskAttemptId!==ctx.taskAttemptId)))return {status:'stopped',error:'Receipt does not bind the current selected actual entry attempt'};
  let interactionRefreshUsed=false;
  for(let i=0;unbounded||i<4;i++){
   await panelAct({type:'wait',ms:1500});const f=await observe(),p=readPanel(f,cfg.panelMarker);
   if((interactionRoute||learnedEnabled||controllerMatch(selected))&&(f.package!==owner.package||f.userId!==owner.userId||p.blocked||!p.isPanel))return {status:'unknown',error:'Owning returned panel identity failed'};
   const matches=p.tasks.filter(t=>same(t.name,selected!.name)&&same(t.instruction,selected!.instruction));
   if(matches.length>1)return {status:'unknown',error:'Ambiguous returned task identity'};
   if(focusedPanels&&samples.some(s=>s.frameId===f.id))return {status:'unknown',error:'Fresh settlement frame required: duplicate capture identity'};
   samples.push({isPanel:p.isPanel,balance:p.balance,task:matches[0],frameId:f.id});
   const s=stableSettlement({before:selected,balanceBefore:beforeBalance,samples,receipt:true});
   if(interactionRoute&&samples.length>=2){
    const tail=samples.slice(-2),stale=tail[0].balance===tail[1].balance&&(p.balance===beforeBalance||receipt.observedBalance!=null&&p.balance!==receipt.observedBalance);
    if(stale&&!interactionRefreshUsed&&findInteractionRoute(cfg,selected)?.refreshReturnedPanel){
     interactionRefreshUsed=true;await interactionRoute.refresh(ctx,f);samples.length=0;continue;
    }
    if(!s.ok||receipt.observedBalance!=null&&p.balance!==receipt.observedBalance)return {status:'unknown',error:'Interaction stable panel does not reconcile current receipt'};
   }
   if(s.ok){const task={...selected,afterDone:matches[0]?.done,afterTotal:matches[0]?.total};const attribution=interactionRoute?.attribution?.rewardAttribution??(interactionRoute&&receipt.rewardCoins!=null?{version:'separate-rewards-v1',selectedRewardCoins:receipt.rewardCoins,incidentalRewards:[]}:undefined);return {status:'completed',task,balanceAfter:s.balance,...(attribution?{rewardAttribution:attribution}:{}),review:{summary:'Same owning-panel stable settlement',samples,delta:s.delta}};}
  }
  return {status:'unknown',error:'Receipt, quota and stable balance did not reconcile'};
 };
 const inventoryScroll=async(action:any,source:any)=>{
  // One fresh capture per gesture, no AI query/retry and no renewal of source authority.
  const proof:any={stageId:activeStage,authority:'inventory-scroll-only',inventoryComplete:false,sourceFrameId:source.id,sourceCapturedAt:source.capturedAt,status:'rejected'};
  try{
   const panel=loadAiPanel(source);
   if(!panel?.isPanel||panel.blocked||panel.readPurpose||source.package!==owner.package||source.userId!==owner.userId)throw Error('Inventory scroll source panel invalid');
   reusable=null;const fresh=await device.capture();frames.push(fresh);proof.frame=fresh;
   if(fresh.id===source.id||fresh.path===source.path||fresh.capturedAt<source.capturedAt||fresh.package!==owner.package||fresh.userId!==owner.userId||fresh.observationError||'aiPanelEvidence' in fresh)throw Error('Inventory scroll fresh frame invalid');
   freshPanel(fresh);
   const inspection=await (await import('./activity-navigation.ts')).inspectCurrentActivityNavigation(fresh,owner);
   if(inspection?.state!=='panel'||inspection.frameId!==fresh.id)throw Error('Inventory scroll current panel unconfirmed');
   if(keywordCompletion){
    const up=action.toY<action.fromY;
    const renewed={type:'swipe',fromX:Math.round(fresh.width*.38),fromY:Math.round(fresh.height*(up?.84:.36)),toX:Math.round(fresh.width*.38),toY:Math.round(fresh.height*(up?.36:.84)),ms:600};
    proof.inspection=inspection;proof.continuity={policy:'current-panel-only',matchedRows:0};proof.proposal={frameId:fresh.id,action:renewed};
    freshPanel(fresh);if(remainingPanelMs()<=0)throw Error('AI panel stage/session deadline exceeded');
    proof.status='dispatch-unknown';emit('inventory_scroll_revalidation_started',proof);
    await device.act(renewed,fresh);proof.status='dispatched';emit('inventory_scroll_revalidated',proof);return;
   }
   const norm=(s:string)=>s.normalize('NFKC').replace(/\s/g,'');
   // Bind several full row components across the stationary old/new viewport, not
   // merely a foreground owner, title, first OCR token or historical background.
   const close=(a:any,b:any,dy:number)=>a.bounds.every((v:number,k:number)=>Math.abs(v+(k%2?dy:0)-b.bounds[k])<=20);
   const rows=source.lines.filter((l:any)=>/^.+\(\d+\/\d+\)$/.test(norm(l.text)));
   const candidates=rows.flatMap((row:any)=>{
    if(!panel.tasks.some(t=>norm(row.text)===norm(`${t.name}(${t.done}/${t.total})`)))return [];
    const targets=fresh.lines.filter((l:any)=>norm(l.text)===norm(row.text));if(targets.length!==1)return [];
    const dy=targets[0].bounds[1]-row.bounds[1];
    if(Math.abs(dy)>source.height*.1||!close(row,targets[0],dy))return [];
    const component=source.lines.filter((l:any)=>l.bounds[0]>=210&&l.bounds[2]<=1040&&l.bounds[1]>=row.bounds[1]&&l.bounds[3]<=Math.min(2285,row.bounds[1]+130));
    if(component.length<3||!component.some((l:any)=>/^(去完成|去逛逛|逛一逛|已完成|领取奖励)$/.test(norm(l.text))))return [];
    return component.every((l:any)=>fresh.lines.filter((n:any)=>norm(n.text)===norm(l.text)&&close(l,n,dy)).length===1)?[{dy}]:[];
   });
   const clusters=candidates.map((c:any)=>candidates.filter((n:any)=>Math.abs(n.dy-c.dy)<=20)).sort((a:any,b:any)=>b.length-a.length);
   const matched=clusters[0]??[];
   if(matched.length<2)throw Error('Inventory scroll viewport continuity unconfirmed');
   const offsetY=matched.reduce((sum:number,c:any)=>sum+c.dy,0)/matched.length;
   const up=action.toY<action.fromY;
   const renewed={type:'swipe',fromX:Math.round(fresh.width*.38),fromY:Math.round(fresh.height*(up?.84:.36)),toX:Math.round(fresh.width*.38),toY:Math.round(fresh.height*(up?.36:.84)),ms:600};
   proof.inspection=inspection;proof.continuity={matchedRows:matched.length,offsetY};proof.proposal={frameId:fresh.id,action:renewed};
   if(remainingPanelMs()<=0)throw Error('AI panel stage/session deadline exceeded');
   freshPanel(fresh);proof.status='dispatch-unknown';emit('inventory_scroll_revalidation_started',proof);
   freshPanel(fresh);if(remainingPanelMs()<=0)throw Error('AI panel stage/session deadline exceeded');
   await device.act(renewed,fresh);proof.status='dispatched';emit('inventory_scroll_revalidated',proof);
  }catch(error:any){proof.error=String(error.message??error);emit('inventory_scroll_rejected',proof);throw error;}
 };
 const panelAct=async(action:any,f?:any)=>{
  if(aiEnabled){
   if(remainingPanelMs()<=0||action.type==='wait'&&action.ms>=remainingPanelMs())throw Error('AI panel stage/session deadline exceeded');
   if(!unbounded&&focusedPanels&&currentNavigation&&(activeStage==='collect_list'||keywordCompletion&&activeStage==='select_task')&&action.type==='swipe'&&f)return inventoryScroll(action,f);
   if(f){freshPanel(f);const p=readPanel(f,cfg.panelMarker);if(!p.isPanel||p.blocked)throw Error('AI panel action requires owning panel evidence');}
  }
  return device.act(action,f);
 };
 let adoptedSelection:any=null,taskStageStarted=false;
 const stage=async(stageId:string,ctx:any):Promise<any>=>{
  if(adoptedSelection&&stageId==='select_task')return {status:'stopped',error:'Selection already adopted; no replacement scan',actions:[]};
  if(adoptedSelection&&['open_task','task_receipt','return_list','settle'].includes(stageId)){
   const bound=adoptedSelection;
   if(ctx?.taskAttemptId!==bound.taskAttemptId||ctx?.sessionId!==undefined&&ctx.sessionId!==opts.sessionId
    ||ctx?.task&&['name','instruction','done','total'].some(k=>ctx.task[k]!==bound.task[k])
    ||ctx?.balanceBefore!==undefined&&ctx.balanceBefore!==bound.balanceBefore)
    return {status:'stopped',error:'Adopted selection attempt/task/baseline binding mismatch',actions:[]};
  }
  if(['open_task','task_receipt','return_list','settle'].includes(stageId))taskStageStarted=true;
  activeStage=stageId;activeContext=ctx;activeDeadline=performance.now()+cfg.limits.stageMs;
  try{return await executeStage(stageId,ctx);}finally{activeStage='';activeDeadline=-Infinity;}
 };
 const adoptSelection=(selection:any,ctx:any)=>{
  try{
   if(adoptedSelection||selected||entry||controllerRoute||interactionRoute||taskStageStarted||activeStage||opts.resume)throw Error('Selection already owned or task entry started; no adoption replay');
   if(typeof ctx?.taskAttemptId!=='string'||!ctx.taskAttemptId.trim()||ctx.sessionId!==undefined&&ctx.sessionId!==opts.sessionId
    ||selection?.taskAttemptId!==undefined&&selection.taskAttemptId!==ctx.taskAttemptId
    ||selection?.sessionId!==undefined&&selection.sessionId!==opts.sessionId)throw Error('Selection session/attempt binding mismatch');
   const t=selection?.task,f=selection?.frame;
   if(!t||typeof t.name!=='string'||!t.name.trim()||typeof t.instruction!=='string'||!t.instruction.trim()
    ||!Number.isSafeInteger(t.done)||!Number.isSafeInteger(t.total)||t.done<0||t.total<=t.done)throw Error('Selection exact task identity/current quota invalid');
   if(!Number.isSafeInteger(selection.balanceBefore)||selection.balanceBefore<=0)throw Error('Selection positive balance baseline required');
   if(!f||typeof f.id!=='string'||!f.id.trim()||f.package!==owner.package||f.userId!==owner.userId
    ||!Number.isSafeInteger(f.width)||f.width<=0||!Number.isSafeInteger(f.height)||f.height<=0
    ||!Number.isFinite(f.capturedAt)||f.capturedAt<=0||Date.now()<f.capturedAt||f.observationError
    ||!unbounded&&Date.now()-f.capturedAt>15000)throw Error('Selection source frame/owner invalid');
   if(selection.owner&&(selection.owner.package!==owner.package||selection.owner.userId!==owner.userId)
    ||selection.scope&&['appId','accountId','activityId','userId'].some(k=>selection.scope[k]!==cfg.scope?.[k])
    ||selection.frameId!==undefined&&selection.frameId!==f.id||t.frameId!==undefined&&t.frameId!==f.id)throw Error('Selection source identity binding mismatch');
   const dir=fs.realpathSync(opts.evidenceDir);
   if(typeof f.path!=='string'||!path.isAbsolute(f.path)||!f.path.endsWith('.png')||typeof t.beforeFrame?.path!=='string'
    ||path.resolve(t.beforeFrame.path)!==path.resolve(f.path)||path.dirname(fs.realpathSync(f.path))!==dir)throw Error('Selection original frame outside evidence directory or beforeFrame mismatch');
   const bytes=fs.readFileSync(f.path),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
   if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.readUInt32BE(8)!==13
    ||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)!==f.width||bytes.readUInt32BE(20)!==f.height
    ||selection.sourcePngSha256!==undefined&&selection.sourcePngSha256!==sha(bytes))throw Error('Selection original PNG/hash mismatch');
   const metadata=f.path.replace(/\.png$/,'.json');
   if(path.dirname(fs.realpathSync(metadata))!==dir)throw Error('Selection original metadata outside evidence directory');
   const saved=JSON.parse(fs.readFileSync(metadata,'utf8'));
   if(['id','path','width','height','capturedAt','package','userId','observationError'].some(k=>saved[k]!==f[k])||JSON.stringify(saved.lines)!==JSON.stringify(f.lines))throw Error('Selection saved source frame mismatch');
   const b=t.buttonBounds,p=t.point;
   if(typeof t.button!=='string'||!t.button.trim()||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)
    ||b[0]<0||b[1]<0||b[2]>f.width||b[3]>f.height||b[0]>=b[2]||b[1]>=b[3]
    ||!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3]
    ||p[0]>=f.width||p[1]>=f.height)throw Error('Selection current button point/bounds invalid');
   if(selection.evidence){
    const e=selection.evidence;
    if(typeof e.path!=='string'||path.dirname(fs.realpathSync(e.path))!==dir)throw Error('Selection evidence outside evidence directory');
    const raw=fs.readFileSync(e.path);if(sha(raw)!==e.sha256)throw Error('Selection evidence hash mismatch');
    const record=JSON.parse(raw.toString('utf8'));
    for(const k of ['task','frame','balanceBefore','sessionId','taskAttemptId','scope','owner','sourcePngSha256','frameId','evidenceKey','plan','nextAction'])
     if(JSON.stringify(record[k])!==JSON.stringify(selection[k]))throw Error('Selection evidence '+k+' binding mismatch');
   }
   const adopted=structuredClone({taskAttemptId:ctx.taskAttemptId,sessionId:opts.sessionId,task:t,balanceBefore:selection.balanceBefore,frameId:f.id,sourcePngSha256:sha(bytes),evidence:selection.evidence});
   // Adoption carries data only. Entry must still observe and bind the current row.
   adoptedSelection=adopted;selected=structuredClone(t);beforeBalance=selection.balanceBefore;receipt=null;reusable=null;
   emit('selection_adopted',adopted);
   return {status:'completed',task:structuredClone(selected),balanceBefore:beforeBalance,actions:[]};
  }catch(error:any){return {status:'stopped',error:String(error.message??error),actions:[]};}
 };
 return {stage,adoptSelection,get calls(){return calls},get frames(){return frames},get stages(){return allStages}};
}
