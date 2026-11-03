import {randomUUID} from 'node:crypto';
export type StageStatus='completed'|'stopped'|'unknown';
export type SessionInput={id:string;scope:{appId:string;accountId:string;activityId:string;userId:number};evidenceDir:string;startedAt:string;[key:string]:any};
export type SessionDependencies={prepare:()=>Promise<unknown>;stage:(id:string,context:any)=>Promise<any>;save:(v:any)=>Promise<any>;cleanup:()=>Promise<any>;persist?:(value:any)=>void;canReturn?:()=>boolean};
/** One task per authorized session. A stage intent is never a claimed observed page. */
export async function runActivitySession(session:SessionInput,deps:SessionDependencies){
 const resume=session.resume,prepared=session.prepared;
 if(prepared&&(resume||!prepared.taskAttemptId||!Array.isArray(prepared.stages)||!(prepared.nextDecision?['open_app','enter_activity','open_list','select_task']:['open_app','enter_activity','open_list','collect_list']).every(id=>prepared.stages.some((s:any)=>s.stageId===id&&s.status==='completed'))))throw Error('Invalid prepared session');
 if(prepared?.nextDecision&&(!prepared.task||!Number.isFinite(prepared.balanceBefore)||prepared.balanceBefore<=0))throw Error('Invalid selected task preparation');
 if(resume&&(!resume.task||!resume.taskAttemptId||!Number.isSafeInteger(resume.runId)||!Number.isFinite(resume.balanceBefore)||resume.balanceBefore<=0||resume.status==='completed'))throw Error('Invalid continuation source');
 const result:any={status:'stopped',taskAttemptId:prepared?.taskAttemptId??resume?.taskAttemptId??randomUUID(),task:prepared?.task??resume?.task??null,balanceBefore:prepared?.balanceBefore??resume?.balanceBefore??null,balanceAfter:null,receipt:resume?.receipt??null,...(resume?{sourceRunId:resume.runId,recoveredAfterError:true}:{})};
 const stages:any[]=structuredClone(prepared?.stages??[]),reviews:any[]=stages.filter(s=>s.review).map(s=>({stageId:s.stageId,review:s.review}));let returned=false,archived:any=null,cleanup:any=null;
 const run=async(id:string)=>{
  const r=await deps.stage(id,{...session,...result,previousCheckpoint:stages.filter(x=>x.status==='completed').at(-1)?.stageId,stages:structuredClone(stages)});
  stages.push({...r,stageId:id});if(r.review)reviews.push({stageId:id,review:r.review});deps.persist?.({session,result,stages,reviews});
  if(['task_receipt','return_list','settle'].includes(id)){
   if(r.rewardAttribution)result.rewardAttribution=structuredClone(r.rewardAttribution);
   for(const field of ['unexplainedDelta','attributionStatus'])if(r[field]!==undefined)result[field]=structuredClone(r[field]);
   if(typeof r.balanceAfter==='number')result.balanceAfter=r.balanceAfter;
  }
  if(r.status!=='completed')throw Object.assign(Error(r.error??id+' stopped'),{stageStatus:r.status});
  if(id==='return_list')returned=true;
  if(r.task)result.task=r.task;if(r.receipt)result.receipt=r.receipt;
  if(typeof r.balanceBefore==='number')result.balanceBefore=r.balanceBefore;
  if(typeof r.balanceAfter==='number')result.balanceAfter=r.balanceAfter;
  if(id==='settle'&&r.rewardAttribution)result.rewardAttribution=structuredClone(r.rewardAttribution);
  return r;
 };
 try{
  if(!prepared)await deps.prepare();
  const taskStages=prepared?.nextDecision?['open_task','task_receipt','return_list','settle','review_task']:prepared?['select_task','open_task','task_receipt','return_list','settle','review_task']:resume?['open_app','open_task','task_receipt','return_list','settle','review_task']:['open_app','enter_activity','open_list','collect_list','select_task','open_task','task_receipt','return_list','settle','review_task'];
  for(const id of taskStages.filter(id=>!session.skipReview||id!=='review_task'))await run(id);
  result.status='completed';
 }catch(error:any){
  result.status=error.stageStatus==='unknown'?'unknown':'stopped';result.error=String(error.message??error);
  if(result.task&&!returned&&(!deps.canReturn||deps.canReturn())){try{await run('return_list');}catch(e:any){result.error+='; return: '+String(e.message??e);}}
 }finally{
  try{archived=await deps.save({session,result,stages,reviews});if(archived?.partial||(result.status==='completed'&&Object.hasOwn(archived??{},'gainCoins')&&archived.gainCoins===null)){result.status='unknown';result.error=['Persistence verification incomplete',...(archived?.issues??[])].join('; ');}}
  catch(error:any){result.status='unknown';result.error=[result.error,'Archive failed: '+String(error.message??error)].filter(Boolean).join('; ');}
  finally{
   try{cleanup=await deps.cleanup();}
   catch(error:any){result.status='unknown';result.error=[result.error,'Cleanup failed: '+String(error.message??error)].filter(Boolean).join('; ');}
  }
  deps.persist?.({session,result,stages,reviews,archived,cleanup});
 }
 return {...result,runId:archived?.runId??null,stages,reviews,cleanup};
}
