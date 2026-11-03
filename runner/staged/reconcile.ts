import {readPanel,stableSettlement} from './observations.ts';
/** Read-only settlement recovery: never opens a task, navigates, or changes prior history. */
export async function reconcileStagedSession(old:any,session:any,device:any,save:(v:any)=>Promise<any>,cfg:any){
 if(!old.receipt||old.receipt.taskAttemptId!==old.taskAttemptId||!old.task||old.balanceBefore===null)throw Error('Cannot reconcile without source receipt and task');
 const samples:any[]=[],stages:any[]=[];
 try{
  await device.prepare();
  for(let i=0;i<4;i++){
   const f=await device.capture();if(f.package!==cfg.package||f.userId!==session.scope.userId)throw Error('Wrong recovery foreground');
   const p=readPanel(f,cfg.panelMarker);const matches=p.tasks.filter(t=>t.name===old.task.name&&t.instruction===old.task.instruction);if(matches.length>1)throw Error('Ambiguous task identity');
   samples.push({isPanel:p.isPanel,balance:p.balance,task:matches[0],frameId:f.id,path:f.path});
  }
  const check=stableSettlement({before:old.task,balanceBefore:old.balanceBefore,samples,receipt:true});if(!check.ok)throw Error(check.reason);
  const current=samples.at(-1).task;
  const result={...old,status:'completed',sourceRunId:old.runId,runId:undefined,recoveredAfterError:true,error:'Source run retained unknown: '+old.error,balanceAfter:check.balance,task:{...old.task,afterDone:current?.done,afterTotal:current?.total}};
  stages.push({stageId:'return_list',status:'completed',evidence:samples},{stageId:'settle',status:'completed',evidence:samples,note:'Read-only recovery after prior observation error; not uninterrupted acceptance'});
  const archived=await save({session,result,stages,reviews:[{stageId:'settle',review:{summary:'Read-only settlement after source observation failure',knownLimits:['Source execution remains unknown; this is linked recovery, not a new task completion']}}]});
  return {...result,...archived,samples};
 }finally{await device.cleanup();}
}
