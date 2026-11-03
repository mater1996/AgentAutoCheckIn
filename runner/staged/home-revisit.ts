import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {DeviceFrame} from './device.ts';
import type {TaskIdentity} from './contracts.ts';
import {assessRewardAttribution,type RewardAttribution,type RewardReceipt} from './reward-attribution.ts';

export type HomeRewardOwner={package:string;userId:number;taskAttemptId:string};
/** Caller attaches the attempt under which a current capture was obtained. Raw bursts need no OCR. */
export type HomeRewardFrame=Pick<DeviceFrame,'id'|'path'|'width'|'height'|'capturedAt'|'package'|'userId'> & {
 taskAttemptId:string;pngSha256?:string;lines?:DeviceFrame['lines'];observationError?:string;
};
export type HomeRewardObservation=HomeRewardOwner & {
 frameId:string;pngSha256:string;page:'guide'|'home'|'activity'|'owning-panel'|'other';blocked:boolean;
 balance?:number;selectedTaskState?:'pending'|'completed'|'absent'|'unknown';
 rewards:{role:'selected'|'incidental';kind:string;coins:number;quote:string;proof:'received'|'offered';independent:boolean;task?:TaskIdentity}[];
};
export type HomeRewardInput={interactionType:'home-revisit'|'automatic-sign-in';task:TaskIdentity;owner:HomeRewardOwner;balanceBefore:number|null;frames:HomeRewardFrame[]};
export type HomeRewardReadRequest={interactionType:HomeRewardInput['interactionType'];task:TaskIdentity;owner:HomeRewardOwner;frame:HomeRewardFrame;pngSha256:string;history:HomeRewardObservation[];constraints:readonly string[]};
export type HomeRewardDeps={readCurrentPage:(request:HomeRewardReadRequest)=>Promise<HomeRewardObservation|null>};

/** Observation only. Caller owns current-panel reads, input authority, persistence and settlement. */
export async function observeHomeRewardAttribution(input:HomeRewardInput,deps:HomeRewardDeps){
 const history:HomeRewardObservation[]=[],issues:string[]=[];
 const sameOwner=(value:HomeRewardOwner)=>!!value&&!!input.owner.taskAttemptId?.trim()&&Number.isSafeInteger(input.owner.userId)&&input.owner.userId>=0&&!!input.owner.package?.trim()&&value.package===input.owner.package&&value.userId===input.owner.userId&&value.taskAttemptId===input.owner.taskAttemptId;
 const rewardAttribution:RewardAttribution={version:'separate-rewards-v1',selectedRewardCoins:null,incidentalRewards:[]};
 let balanceAfter:number|null=null,receipt:RewardReceipt|undefined;
 if(!['home-revisit','automatic-sign-in'].includes(input.interactionType)||!input.task?.name?.trim()||!input.task?.instruction?.trim())issues.push('Explicit interaction type and full task identity required');
 for(const frame of issues.length?[]:input.frames){
  try {
  if(!sameOwner(frame)||!frame.id?.trim()||!frame.path?.trim()||frame.observationError){issues.push('Frame owner, attempt or observation invalid');break;}
  const pngSha256=createHash('sha256').update(await readFile(frame.path)).digest('hex');
  if(frame.pngSha256!==undefined&&frame.pngSha256!==pngSha256){issues.push('Frame PNG hash mismatch');break;}
  const observation=await deps.readCurrentPage({interactionType:input.interactionType,task:input.task,owner:input.owner,frame,pngSha256,history:structuredClone(history),constraints:['Use full current page context; an offer, missing row or balance delta is not a receipt.','Separate incidental rewards. Never infer the selected reward by subtracting them.','No login, authentication, payment, invitation or games.']});
  if(!observation){issues.push('Current page unresolved');break;}
  if(!sameOwner(observation)||observation.frameId!==frame.id||observation.pngSha256!==pngSha256||observation.blocked!==false){issues.push('Reader frame, owner, attempt or business restriction mismatch');break;}
  history.push(observation);
  if(observation.page==='owning-panel'&&observation.balance!==undefined)balanceAfter=observation.balance;
  if(!Array.isArray(observation.rewards)){issues.push('Malformed current reward observations');break;}
  for(const reward of observation.rewards){
   if(reward?.proof==='offered'||reward?.independent===false)continue;
   if(!reward||!['selected','incidental'].includes(reward.role)||reward.proof!=='received'||reward.independent!==true||!reward.kind?.trim()||!Number.isSafeInteger(reward.coins)||reward.coins<=0||!reward.quote?.trim()
    ||reward.role==='selected'&&(reward.task?.name!==input.task.name||reward.task?.instruction!==input.task.instruction)){
    issues.push('Malformed reward or selected task identity mismatch');break;
   }
   const proof={frameId:frame.id,path:frame.path,quote:reward.quote,taskAttemptId:input.owner.taskAttemptId};
   if(reward.role==='selected'){
    if(receipt&&(rewardAttribution.selectedRewardCoins!==reward.coins||receipt.quote!==reward.quote)){issues.push('Conflicting selected receipts');break;}
    if(!receipt){rewardAttribution.selectedRewardCoins=reward.coins;receipt=proof;}
   }
   else if(!rewardAttribution.incidentalRewards.some(r=>r.kind===reward.kind&&r.coins===reward.coins&&r.receipt.quote===reward.quote))rewardAttribution.incidentalRewards.push({kind:reward.kind,coins:reward.coins,receipt:proof});
  }
  if(issues.length)break;
  } catch(error){issues.push(error instanceof Error?error.message:String(error));break;}
 }
 if(issues.length){rewardAttribution.selectedRewardCoins=null;receipt=undefined;}
 const assessment=assessRewardAttribution({balanceBefore:input.balanceBefore,balanceAfter,taskAttemptId:input.owner.taskAttemptId,receipt,rewardAttribution});
 const known=(rewardAttribution.selectedRewardCoins??0)+rewardAttribution.incidentalRewards.reduce((sum,r)=>sum+r.coins,0);
 return {status:assessment.accepted&&!issues.length?'completed' as const:'unknown' as const,gainCoins:assessment.accepted&&!issues.length?assessment.selectedCoins:null,balanceBefore:input.balanceBefore,balanceAfter,receipt,rewardAttribution,assessment,unexplainedDelta:assessment.balanceDelta===null?null:assessment.balanceDelta-known,observations:history,issues};
}
