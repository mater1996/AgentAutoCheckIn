import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {inspectImmersiveBrowse,immersiveBrowseSource} from './immersive-browse.ts';
import type {DeviceFrame} from './device.ts';
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
export type ImmersiveTransition={version:string;sourceRunId:184;browseRewardCoins:20;receiptRewardCoins:35;files:{path:string;sha256:string}[]};
const version=(c:ImmersiveTransition)=>'immersive-reward-transition-v1:'+sha(JSON.stringify({...c,version:''}));
async function sourceValid(c:ImmersiveTransition){
 if(c.sourceRunId!==184||c.browseRewardCoins!==20||c.receiptRewardCoins!==35||c.version!==version(c)||c.files.length!==6)return false;
 const names=['variant35Result','variant35Stages','variant35BeforePng','variant35BeforeFrame','completed35Png','completed35Frame'] as const;
 const expected=names.map(n=>immersiveBrowseSource.files[n]);
 if(c.files.some((f,i)=>f.sha256!==expected[i].sha256||!f.path.endsWith('/'+expected[i].path)))return false;
 for(const f of c.files)if(sha(await readFile(f.path))!==f.sha256)return false;
 const [result,stages,before,after]=await Promise.all([0,1,3,5].map(i=>readFile(c.files[i].path,'utf8').then(JSON.parse)));
 if(result.runId!==184||!result.taskAttemptId||result.receipt!==null||result.task?.name!=='好物沉浸看'||result.task?.instruction!=='浏览')return false;
 const taskStage=stages.find((s:any)=>s.stageId==='task_receipt');
 const frames=taskStage?.events?.filter((e:any)=>e.type==='observed').map((e:any)=>e.frame)??[];
 if(![before,after].every(f=>frames.some((x:any)=>JSON.stringify(x)===JSON.stringify(f))))return false;
 if(before.id===after.id||before.capturedAt>=after.capturedAt)return false;
 const wait=taskStage.actions?.filter((a:any)=>a.source==='script'&&['verified','observed'].includes(a.status)&&a.proposal?.action?.type==='wait').reduce((s:number,a:any)=>s+a.proposal.action.ms,0);
 if(wait!==6000)return false;
 const owner={package:'com.taobao.taobao',userId:0};
 return (await inspectImmersiveBrowse(before,owner,{rewardCoins:20}))?.state==='browsing'
   &&(await inspectImmersiveBrowse(after,owner,{rewardCoins:35}))?.state==='completed';
}
/** Candidate applicability from one observed attempt, never a settlement or stability proof. */
export async function buildImmersiveTransition(root:string):Promise<ImmersiveTransition>{
 const names=['variant35Result','variant35Stages','variant35BeforePng','variant35BeforeFrame','completed35Png','completed35Frame'] as const;
 const c:ImmersiveTransition={version:'',sourceRunId:184,browseRewardCoins:20,receiptRewardCoins:35,files:names.map(n=>({...immersiveBrowseSource.files[n],path:resolve(root,immersiveBrowseSource.files[n].path)}))};
 c.version=version(c);if(!await sourceValid(c))throw Error('Unverified immersive reward transition source');return c;
}
export type TransitionBinding={taskAttemptId:string;entryDispatched:boolean;browseFrame:DeviceFrame;receiptFrame:DeviceFrame;browseRewardCoins:number;receiptRewardCoins:number;waitMs:number};
export async function verifyImmersiveTransition(c:ImmersiveTransition,b:TransitionBinding):Promise<boolean>{
 try{
  if(!b.taskAttemptId?.trim()||!b.entryDispatched||b.browseRewardCoins!==20||b.receiptRewardCoins!==35||!Number.isSafeInteger(b.waitMs)||b.waitMs<=0||b.waitMs>20000
    ||!b.browseFrame||!b.receiptFrame||b.browseFrame.id===b.receiptFrame.id||b.receiptFrame.capturedAt<=b.browseFrame.capturedAt
    ||b.receiptFrame.capturedAt-b.browseFrame.capturedAt>90000||!await sourceValid(c))return false;
  const owner={package:'com.taobao.taobao',userId:0};
  const before=await inspectImmersiveBrowse(b.browseFrame,owner,{rewardCoins:20});
  const after=await inspectImmersiveBrowse(b.receiptFrame,owner,{rewardCoins:35});
  return before?.state==='browsing'&&after?.state==='completed';
 }catch{return false;}
}
