import {hasIdentityChallenge,observationTexts} from './observations.ts';
export function priorAttemptFromRun(run:any,result:any,stages:any[]):any{
 if(!result?.task)return null;
 const entered=stages.filter(s=>s.stageId==='open_task').some(s=>(s.actions??[]).some((a:any)=>(a.proposal?.action??a.action)?.type==='tap'&&['verified','dispatched','unknown','pending'].includes(a.status)))||result.receipt?.taskAttemptId===result.taskAttemptId&&!!result.receipt;
 if(!entered)return null;
 return {name:result.task.name,instruction:result.task.instruction,attemptRunId:run.id,day:run.day,status:result.status,entryDispatched:true,taskAttemptId:result.taskAttemptId,source:run.evidence_dir};
}
export type RoundInputState={entryDispatched:boolean;inputUnknown:boolean;blocked:boolean};
/** Wrap the real device without treating preflight failure as sent input. */
export function createRoundDeviceBoundary(device:any,stage:()=>string,persist:(e:any)=>void){
 const state:RoundInputState={entryDispatched:false,inputUnknown:false,blocked:false};
 const boundary=new Proxy(device,{get(target,key){
  if(key==='capture')return async(...args:any[])=>{const frame=await target.capture(...args);if(hasIdentityChallenge(observationTexts(frame)))state.blocked=true;return frame;};
  if(key==='act')return async(a:any,f?:any,limits?:any)=>{
   if((state.inputUnknown||state.blocked)&&a.type!=='wait')throw Error('Round input unknown or blocked; no further input');
   let started=false;const start=()=>{persist({kind:'input_started',stage:stage(),action:a,frameId:f?.id??null});started=true;if(stage()==='open_task'&&a.type==='tap')state.entryDispatched=true;limits?.beforeInput?.();};
   if(!['tap','swipe'].includes(a.type)&&a.type!=='wait')start();
   try{const v=await target.act(a,f,{beforeInput:start});if(started)persist({kind:'input_completed',stage:stage(),action:a});return v;}
   catch(e){if(started){state.inputUnknown=true;persist({kind:'input_unknown',stage:stage(),action:a});}throw e;}
  };
  if(key==='scrollContinuously')return async(...args:any[])=>{if(state.inputUnknown)throw Error('Round input unknown');persist({kind:'continuous_started',stage:stage(),frameId:args[1]?.id});try{return await target.scrollContinuously(...args);}catch(e){state.inputUnknown=true;persist({kind:'input_unknown',stage:stage(),continuous:true});throw e;}};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return {device:boundary,state};
}
export function readRoundTaskOutcome(result:any,archived:any,input:RoundInputState){
 const returned=result.stages?.some((s:any)=>s.stageId==='return_list'&&s.status==='completed')===true;
 const persistenceVerified=!!archived&&!archived.partial&&archived.v2Archived===true&&Number.isSafeInteger(archived.runId);
 return {...result,...input,returned,persistenceVerified,gainCoins:persistenceVerified&&typeof archived.gainCoins==='number'?archived.gainCoins:null};
}
/** Preserve explicit skips across days; consume only actual same-day batch attempts. */
export function mergePriorRoundPlans(sources:{path:string;plan:any}[],day:string){
 const attempts:any[]=[],userSkips:any[]=[];const seen=new Set<string>(),skipSeen=new Set<string>();
 for(const source of sources)for(const item of source.plan.items??source.plan.tasks??[]){
  const identity=JSON.stringify([item.name,item.instruction]);
  if(item.userSkip===true&&!skipSeen.has(identity)){skipSeen.add(identity);userSkips.push({...item,source:source.path});}
  if(source.plan.day!==day||!(item.attemptsThisBatch>0||Number.isSafeInteger(item.attemptRunId)))continue;
  const key=JSON.stringify([identity,item.attemptRunId??null]);if(seen.has(key))continue;seen.add(key);
  attempts.push({...item,source:source.path,status:item.executionState??'attempted',entryDispatched:true});
 }
 return {attempts,userSkips};
}
