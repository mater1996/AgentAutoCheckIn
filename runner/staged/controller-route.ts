import { runControllerStage, type ControllerDeps, type ControllerInput, type ControllerResult } from './controller-runtime.ts';
import { planPanelClaim, currentPanelIdentity, validCurrentPanelFrame, panelIdentity, pngPixels, validCandidateFrame, verifyContract, type LocalContract, type PanelClaimState } from './panel-claim.ts';
import type { DeviceFrame } from './device.ts';
import type { StageInput, TaskIdentity } from './contracts.ts';

export type ControllerCandidate = { family: LocalContract['family']; task: TaskIdentity; contract: LocalContract; panelClaimPolicy?: ControllerInput['panelClaimPolicy']; capturePolicy?: ControllerInput['capturePolicy']; learningBudget?: ControllerInput['learningBudget'] };
export type ControllerRouteRecord = { key: string; binding: string; status: 'started' | 'finished' | 'unknown'; result?: ControllerResult; error?: string };
export type ControllerRouteConfig = { executionPolicy?: StageInput['executionPolicy']; sessionId: string; scope: StageInput['scope']; package: string; budget: StageInput['budget']; candidates: ControllerCandidate[]; initialRecords?: ControllerRouteRecord[] };
export type ControllerRouteDeps = ControllerDeps;
const exact = (a: TaskIdentity, b: TaskIdentity) => typeof a?.name === 'string' && typeof a?.instruction === 'string' && a.name === b?.name && a.instruction === b?.instruction;
const target = (family: string): TaskIdentity => family === 'panel-claim' ? { name:'任务到访得金币', instruction:'每日来任务面板' } : { name:'逛好店赚一大波金币', instruction:'浏览15秒' };

/** Explicit candidate adapter only. Caller owns durable storage and stable settlement. */
export function createControllerRoute(config: ControllerRouteConfig, deps: ControllerRouteDeps) {
 const records = new Map((config.initialRecords ?? []).map(r => [r.key, structuredClone(r)]));
 const running = new Map<string, Promise<ControllerRouteRecord>>();
 const binding = (candidate: ControllerCandidate, ctx: any) => JSON.stringify([config.sessionId,config.scope,config.package,ctx.taskAttemptId,ctx.task,candidate.family,candidate.contract.version,candidate.capturePolicy,ctx.balanceBefore,...(candidate.panelClaimPolicy?[candidate.panelClaimPolicy]:[])]);
 const save = async (record: ControllerRouteRecord) => {
  records.set(record.key, record);
  await deps.persist({type:'controller_route_state',at:deps.now(),sessionId:config.sessionId,record:structuredClone(record)});
 };
 const fail = (error: string, status: 'stopped'|'unknown' = 'unknown') => ({status,error});
 const execute = async (candidate: ControllerCandidate, ctx: any, key: string, bound: string) => {
  let record: ControllerRouteRecord = {key,binding:bound,status:'started'};
  try {
   await save(record); // A durable reservation precedes every possible controller action.
   const result = await runControllerStage({executionPolicy:config.executionPolicy,family:candidate.family,contract:candidate.contract,sessionId:config.sessionId,
    attemptId:ctx.taskAttemptId,taskAttemptId:ctx.taskAttemptId,scope:config.scope,package:config.package,task:ctx.task,
    budget:config.budget,balanceBefore:ctx.balanceBefore,capturePolicy:candidate.capturePolicy,panelClaimPolicy:candidate.panelClaimPolicy,learningBudget:candidate.learningBudget},deps);
   record={...record,status:'finished',result};await save(record);
  } catch (error) {
   record={key,binding:bound,status:'unknown',error:String(error instanceof Error ? error.message : error)};
   records.set(key,record);
   try { await save(record); } catch { /* In-memory poison remains even if external persistence is unavailable. */ }
  }
  return record;
 };
 const receiptFor = async (candidate: ControllerCandidate, result: ControllerResult, ctx: any) => {
  const receipt=result.receipt;
  if(result.status!=='receipt'||!receipt||result.state.taskAttemptId!==ctx.taskAttemptId||result.state.contract.version!==candidate.contract.version
   ||result.stages.length!==1||result.stages[0].status!=='completed'||result.stages[0].usedScriptVersion!==candidate.contract.version)throw Error('Incomplete controller execution provenance');
  await verifyContract(candidate.contract);
  const proof=async(r:any)=>{
   if(r.taskAttemptId!==ctx.taskAttemptId||typeof r.quote!=='string'||!r.quote.trim()||!r.frameId||r.sourceResult?.sha256!==candidate.contract.refs[0].sha256||r.sourceResult?.path!==candidate.contract.refs[0].path)throw Error('Receipt ownership or source mismatch');
   const frames=result.stages.flatMap(s=>s.events.filter(e=>['observed','controller_transient_receipt','controller_transient_observed'].includes(e.type)).map(e=>e.frame as DeviceFrame)).filter(f=>f?.id===r.frameId);
   if(!frames.length||new Set(frames.map(f=>JSON.stringify(f))).size!==1)throw Error('Missing or ambiguous original receipt frame');
   const frame=frames[0];
   if(frame.package!==config.package||frame.userId!==config.scope.userId||!frame.path||(await pngPixels(frame.path)).hash!==r.pngSha256)throw Error('Original receipt frame ownership or PNG mismatch');
   if(candidate.family==='panel-claim'&&candidate.panelClaimPolicy==='current-semantic-v1') {
    const state=result.state as PanelClaimState;
    if(JSON.stringify(state.selection)!==JSON.stringify({policy:candidate.panelClaimPolicy,task:ctx.task}))throw Error('Receipt selection binding mismatch');
    const replay=await planPanelClaim(frame,{package:config.package,userId:config.scope.userId,taskAttemptId:ctx.taskAttemptId,now:deps.now(),executionPolicy:config.executionPolicy},
     {...state,phase:'awaitReceipt',receipt:undefined},{readReceipt:async()=>r.observation??null});
    if(replay.kind!=='receipt'||JSON.stringify(replay.receipt)!==JSON.stringify(r))throw Error('Current receipt evidence does not reproduce archived receipt');
   }
   return {...r,path:frame.path,version:candidate.contract.version};
  };
  if(candidate.family==='panel-claim') {
   if(!('quote' in receipt)||result.state.phase!=='awaitStableBalance'||JSON.stringify((result.state as any).receipt)!==JSON.stringify(receipt))throw Error('Panel receipt missing');
   return proof(receipt);
  }
  if(!('layers' in receipt)||receipt.taskAttemptId!==ctx.taskAttemptId||receipt.returnedToActivity!==true||result.state.phase!=='awaitSettlement'
   ||receipt.layers.length!==2||receipt.layers[0].layer!=='store'||receipt.layers[1].layer!=='shopList'
   ||receipt.layers[0].frameId===receipt.layers[1].frameId||JSON.stringify((result.state as any).receipts)!==JSON.stringify(receipt.layers))throw Error('Missing shop receipt layer or return provenance');
  const layers=await Promise.all(receipt.layers.map(proof));
  return {...layers[1],quote:layers.map(r=>r.quote).join(' / '),taskAttemptId:ctx.taskAttemptId,version:candidate.contract.version,layers,returnedToActivity:true};
 };
 return {
  snapshot: () => structuredClone([...records.values()]),
  async stage(stageId: string, ctx: any): Promise<any | null> {
   if(!['open_task','task_receipt','return_list'].includes(stageId))return null;
   const matches=config.candidates.filter(c=>exact(c.task,ctx.task));
   if(!matches.length)return null;
   if(matches.length!==1)return fail('Ambiguous exact controller task match','stopped');
   const candidate=matches[0];
   if(!['panel-claim','shop-browse'].includes(candidate.family)||candidate.contract.family!==candidate.family||!(candidate.family==='panel-claim'&&candidate.panelClaimPolicy==='current-semantic-v1')&&!exact(candidate.task,target(candidate.family)))return fail('Invalid controller candidate target','stopped');
   if(ctx.id!==config.sessionId||JSON.stringify(ctx.scope)!==JSON.stringify(config.scope)||!ctx.taskAttemptId?.trim()||!Number.isFinite(ctx.balanceBefore)||ctx.balanceBefore<=0)return fail('Controller route scope or attempt mismatch','stopped');
   const key=JSON.stringify([config.sessionId,ctx.taskAttemptId]),bound=binding(candidate,ctx);
   let record=records.get(key);
   if(record&&record.binding!==bound)return fail('Controller attempt binding changed');
   if(stageId==='open_task'&&!record) {
    const promise=execute(candidate,ctx,key,bound);running.set(key,promise);
    record=await promise;running.delete(key);
   } else if(running.has(key))record=await running.get(key);
   if(!record)return fail('Controller open_task has not executed','stopped');
   if(record.status!=='finished'||!record.result)return fail(record.error??'Reserved controller attempt cannot replay');
   if(record.result.status!=='receipt')return fail(record.result.reason??record.result.status,record.result.status==='unknown'?'unknown':'stopped');
   try {
    const receipt=await receiptFor(candidate,record.result,ctx);
    if(stageId==='return_list') {
     const frame=await deps.observe();
     const owner={package:config.package,userId:config.scope.userId,taskAttemptId:ctx.taskAttemptId,now:deps.now(),executionPolicy:config.executionPolicy};
     if(candidate.family==='panel-claim'&&candidate.panelClaimPolicy==='current-semantic-v1') {
      if(!validCurrentPanelFrame(frame,owner)||!currentPanelIdentity(frame))throw Error('Current owning activity panel not verified');
      await pngPixels(frame.path);
     } else if(!validCandidateFrame(frame,owner)||!await panelIdentity(frame,(await pngPixels(frame.path)).pixels,candidate.contract.fixtures[0]))throw Error('Current owning activity panel not verified');
     await deps.persist({type:'controller_route_return_verified',at:deps.now(),taskAttemptId:ctx.taskAttemptId,frame,version:candidate.contract.version});
    }
    return {status:'completed',stageId,checkpoint:stageId==='open_task'?'controller_receipt_ready':stageId==='task_receipt'?'receipt':'owning_panel',
     ...(stageId==='task_receipt'?{receipt}:{}),controller:structuredClone(record.result),candidate:true,version:candidate.contract.version};
   } catch(error) {
    const message=String(error instanceof Error?error.message:error);
    try {await save({...record,status:'unknown',error:message});} catch { /* Unknown stays cached when persistence fails. */ }
    return fail(message);
   }
  },
 };
}
