import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runActivitySession} from './session.ts';
import {createStagedRuntime} from './runtime.ts';
import {createRoundDeviceBoundary,readRoundTaskOutcome} from './round-adapter.ts';
const json=(v:any)=>JSON.stringify(v,null,2)+'\n';
/** Real factory, injectable only at physical/model/persistence boundaries for offline checks. */
export function createRoundAdapters(options:any){
 const {cfg,round,device,model,knowledge,scriptFiles}=options;
 let cycle:any=null,first=true,carriedPrefix:any[]=[];
 const persist=(file:string,v:any)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,json(v),{mode:0o600});};
 const append=(file:string,v:any)=>{const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(v)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
 const adapters:any={
  prepare:()=>device.prepare(),
  collect:async(_state:any)=>{
   const taskAttemptId=randomUUID(),evidenceDir=path.join(round.evidenceDir,'tasks',taskAttemptId);fs.mkdirSync(evidenceDir,{recursive:true});
   const session={id:randomUUID(),scope:cfg.scope,evidenceDir,taskAttemptId,startedAt:new Date().toISOString(),configFile:round.configFile,roundId:round.id};
   const taskInfo={taskAttemptId,sessionId:session.id,evidenceDir};
   persist(path.join(evidenceDir,'session.json'),session);
   await (options.registerTask??options.execution?.registerTask)?.(taskInfo);
   const event=(kind:string,data:any)=>{const record={...data,at:new Date().toISOString(),roundId:round.id,...taskInfo};append(path.join(evidenceDir,'agent.jsonl'),{kind,...record});(options.event??options.execution?.event)?.(kind,record);};
   const plan:any[]=[];let activeStage='';
   const taskDevice=options.taskDeviceFactory?await options.taskDeviceFactory(evidenceDir):device;
   const boundary=createRoundDeviceBoundary(taskDevice,()=>activeStage,e=>{append(path.join(evidenceDir,'round-input.jsonl'),e);(options.event??options.execution?.event)?.(e.kind,{...e,roundId:round.id,...taskInfo});});
   const taskModel=await (options.modelForTask??options.execution?.modelForTask)?.(evidenceDir,session.id)??model;
   const trackedModel={hostManagedDecisions:taskModel.hostManagedDecisions===true,get usage(){return taskModel.usage;},get modelName(){return taskModel.modelName;},query:async(request:any)=>{
    const requestId=randomUUID(),data={requestId,stageId:activeStage};event('model_request',{...data,request});
    let v:any;try{v=await taskModel.query(request);}catch(error:any){event('model_error',{...data,error:String(error.message??error)});throw error;}
    if(v?.blocked===true||v?.state==='blocked')boundary.state.blocked=true;
    event('model_result',{...data,result:v});return v;
   }};
   const rt=(options.runtimeFactory??createStagedRuntime)(cfg,boundary.device,trackedModel,{sessionId:session.id,evidenceDir,plan,completed:[],experiences:knowledge.experienceVersions??[],recipes:options.recipes??[],...(options.runStage?{runStage:options.runStage}:{}),...(options.controllerDeps?{controllerDeps:(ctx:any)=>options.controllerDeps(ctx,evidenceDir)}:{})});
   const stage=async(id:string,ctx:any)=>{activeStage=id;try{
    event('stage_start',{stageId:id});let r:any;
    try{r=await rt.stage(id,ctx);}catch(error:any){event('stage_end',{stageId:id,status:'error',error:String(error.message??error)});throw error;}
    event('stage_end',{stageId:id,...r});return r;
   }finally{activeStage='';}};
   cycle={session,plan,rt,stage,boundary,stages:[],model:taskModel,usageStart:taskModel.usage?.length??0};
   const ctx={...session,taskAttemptId,stages:cycle.stages};cycle.taskAttemptId=taskAttemptId;
   for(const id of options.nextDecision?(first?['open_app','enter_activity','open_list']:[]):first?['open_app','enter_activity','open_list','collect_list']:['collect_list']){
    const r=await stage(id,ctx);cycle.stages.push({...r,stageId:id});persist(path.join(evidenceDir,'prefix-stages.json'),cycle.stages);
    if(r.status!=='completed')throw Object.assign(Error(r.error??id+' failed'),{inputUnknown:boundary.state.inputUnknown,blocked:boundary.state.blocked});
   }
   if(first)carriedPrefix=cycle.stages.slice(0,3).map((s:any)=>({...s,sourceSessionId:session.id}));
   else cycle.stages.unshift(...carriedPrefix.map(s=>({...structuredClone(s),inheritedFromRound:true})));
   persist(path.join(evidenceDir,'prefix-stages.json'),cycle.stages);
   first=false;
   if(options.nextDecision){
    activeStage='select_task';
    let decision:any;try{decision=await options.nextFinder({device:boundary.device,model:trackedModel,cfg,scope:cfg.scope,sessionId:session.id,taskAttemptId,evidenceDir,attempts:_state.attempts,priorPlans:options.priorPlans,knowledge,policy:options.policy,event});}finally{activeStage='';}
    persist(path.join(evidenceDir,'next-decision.json'),decision);
    if(decision.decision==='task'){
     cycle.selection=decision.selection;
     const adopted=await rt.adoptSelection(decision.selection,ctx);
     if(adopted.status!=='completed')throw Error(adopted.error??'Selection adoption failed');
     cycle.stages.push({...adopted,stageId:'select_task'});
     persist(path.join(evidenceDir,'prefix-stages.json'),cycle.stages);
    }
    return decision;
   }
   const inventory=JSON.parse(fs.readFileSync(path.join(evidenceDir,'inventory.json'),'utf8'));
   const tasks:any[]=[];const seen=new Set<string>();
   for(const page of inventory.pages??[])for(const task of page.tasks??[]){const key=JSON.stringify([task.name,task.instruction]);if(!seen.has(key)){seen.add(key);tasks.push(task);}}
   return {...inventory,tasks,source:path.join(evidenceDir,'inventory.json'),sessionId:session.id};
  },
  execute:async(item:any,_state:any)=>{
   if(!cycle)throw Error('Round must collect before executing');
   const c=cycle;c.plan.splice(0,c.plan.length,{...item,decision:'do',initialExecutions:1,attemptsThisBatch:0});
   persist(path.join(c.session.evidenceDir,'plan-input.json'),{items:c.plan});
   let archived:any=null;
   const result=await runActivitySession({...c.session,skipReview:options.skipReview===true,prepared:{taskAttemptId:c.taskAttemptId,stages:c.stages,...(options.nextDecision?{nextDecision:true,task:c.selection.task,balanceBefore:c.selection.balanceBefore}:{})}},{
    prepare:async()=>{throw Error('Round already prepared')},stage:c.stage,
    canReturn:()=>!c.boundary.state.inputUnknown&&!c.boundary.state.blocked,
    save:async(v:any)=>{archived=await options.saveTask({...v,scriptFiles,usage:(c.model.usage??[]).slice(c.usageStart)});return archived;},
    cleanup:async()=>({deferredToRound:true}),persist:v=>persist(path.join(c.session.evidenceDir,'session-state.json'),v),
   });
   const outcome={...readRoundTaskOutcome(result,archived,c.boundary.state),roundId:round.id};persist(path.join(c.session.evidenceDir,'final.json'),outcome);c.stages=result.stages;c.outcome=outcome;if(outcome.returned)cycle=null;return outcome;
  },
  recover:async()=>{
   if(!cycle)throw Error('No task runtime to recover');
   if(cycle.boundary.state.inputUnknown||cycle.boundary.state.blocked)throw Error('Unknown input or authentication barrier forbids recovery');
   const ctx={...cycle.session,taskAttemptId:cycle.taskAttemptId,stages:cycle.stages,...(cycle.selection?{task:cycle.selection.task,balanceBefore:cycle.selection.balanceBefore}:{})};
   const c=cycle,r=await c.stage('return_list',ctx);c.stages.push({...r,stageId:'return_list'});
   if(c.outcome){c.outcome.recovery=r;if(r.status==='completed')c.outcome.returned=true;persist(path.join(c.session.evidenceDir,'final.json'),c.outcome);}
   if(r.status==='completed')cycle=null;return r;
  },
  finish:async()=>{const r=await device.returnHome({package:cfg.package,userId:cfg.scope.userId});persist(path.join(round.evidenceDir,'home.json'),r);if(r.confirmed!==true)throw Error('Desktop return not confirmed');return r;},
  cleanup:async()=>{const r=await device.cleanup();persist(path.join(round.evidenceDir,'cleanup.json'),r);return r;},
 };
 if(options.nextDecision)adapters.next=adapters.collect;
 return adapters;
}
