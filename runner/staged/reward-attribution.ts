export type RewardReceipt = {frameId:string;path:string;quote:string;taskAttemptId:string};
export type RewardAttribution = {version:'separate-rewards-v1';selectedRewardCoins:number|null;incidentalRewards:{kind:string;coins:number;receipt:RewardReceipt}[]};
/** Balances describe the entire account. Only independently explained task units may be credited. */
export function assessRewardAttribution(result:{balanceBefore:number|null;balanceAfter:number|null;taskAttemptId?:string;receipt?:RewardReceipt;rewardAttribution?:RewardAttribution}){
 const before=result.balanceBefore,after=result.balanceAfter;
 const delta=typeof before==='number'&&typeof after==='number'&&Number.isFinite(before)&&Number.isFinite(after)?after-before:null;
 const fail=(reason:string)=>({accepted:false,selectedCoins:null as number|null,balanceDelta:delta,reason});
 if(delta===null||delta<=0)return fail('No positive observed balance delta');
 const a=result.rewardAttribution;
 if(a===undefined)return {accepted:true,selectedCoins:delta,balanceDelta:delta,reason:'Single-task balance delta; no separate reward reported'};
 if(a?.version!=='separate-rewards-v1'||!Array.isArray(a.incidentalRewards)||!Number.isSafeInteger(a.selectedRewardCoins)||a.selectedRewardCoins!<=0)return fail('Selected reward amount is unresolved');
 const receipt=(r:RewardReceipt|undefined)=>!!r&&!!r.frameId?.trim()&&!!r.path?.trim()&&!!r.quote?.trim()&&!!result.taskAttemptId&&r.taskAttemptId===result.taskAttemptId;
 if(!receipt(result.receipt))return fail('Selected task lacks an independent receipt');
 const used=new Set([result.receipt!.frameId]);let other=0;
 for(const reward of a.incidentalRewards){
  if(!reward?.kind?.trim()||!Number.isSafeInteger(reward.coins)||reward.coins<=0||!receipt(reward.receipt)||used.has(reward.receipt.frameId))return fail('Incidental reward evidence missing, duplicated or from another attempt');
  used.add(reward.receipt.frameId);other+=reward.coins;
 }
 if(!Number.isSafeInteger(other)||delta!==a.selectedRewardCoins!+other)return fail('Selected and incidental rewards do not explain the balance delta');
 return {accepted:true,selectedCoins:a.selectedRewardCoins,balanceDelta:delta,reason:'Selected reward separated from observed incidental rewards'};
}
