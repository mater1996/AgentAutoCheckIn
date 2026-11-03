import {validateInteractionRoutes} from './interaction.ts';
import {createHash} from 'node:crypto';
export function validateStagedConfig(c:any){
 const unbounded=c.executionPolicy==='development-unbounded-v1';
 if(c.executionPolicy!==undefined&&c.executionPolicy!=='development-unbounded-v1')throw Error('Invalid execution policy');
 if(!c?.scope||!['appId','accountId','activityId'].every(k=>typeof c.scope[k]==='string'&&c.scope[k].trim())||!Number.isSafeInteger(c.scope.userId)||c.scope.userId<0)throw Error('Invalid scope');
 if(!c.package||!c.assetId||!c.model?.baseUrl||!c.model?.name||!Array.isArray(c.constraints)||!c.constraints.length)throw Error('Missing configuration');
 if(c.selectionPolicy!==undefined&&c.selectionPolicy!=='batch-attempts-v1')throw Error('Invalid selection policy');
 if(c.limits?.maxTasks!==1)throw Error('This entry authorizes one task per session');
 for(const key of ['sessionMs','stageMs','agentCalls','stageActions','inventoryPages','maxReturns'])if(c.executionPolicy!=='development-unbounded-v1'&&(!Number.isSafeInteger(c.limits[key])||c.limits[key]<=0))throw Error('Invalid budget '+key);
 for(const id of ['open_app','enter_activity','open_list','open_task','task_receipt','return_list'])if(!c.stages?.[id]?.goal||!c.stages[id].checkpoint)throw Error('Missing stage '+id);
 if(c.localActivityNavigation!==undefined&&typeof c.localActivityNavigation!=='boolean')throw Error('Invalid local activity navigation configuration');
 if(c.navigationPolicy!==undefined&&(c.navigationPolicy!=='current-text-v1'||c.localActivityNavigation!==true))throw Error('Invalid navigation policy: current-text-v1 requires localActivityNavigation=true');
 if(c.entryRecovery!==undefined&&(typeof c.entryRecovery!=='boolean'||c.entryRecovery===true&&c.localActivityNavigation!==true))throw Error('Invalid entry recovery configuration');
 if(c.localLaunch!==undefined&&typeof c.localLaunch!=='boolean')throw Error('Invalid local launch configuration');
 if(c.balanceComponent!==undefined&&typeof c.balanceComponent!=='boolean')throw Error('Invalid balance component configuration');
 if(c.aiPanelReader!==undefined&&typeof c.aiPanelReader!=='boolean')throw Error('Invalid AI panel reader configuration');
 if(c.panelReadPolicy!==undefined&&(c.panelReadPolicy!=='focused-v1'||c.aiPanelReader!==true||c.scriptValidationMode!==false||c.balanceComponent!==false))throw Error('Invalid panel read policy: focused-v1 requires explicit AI panel reader without script validation or balance component');
 if(c.taskObservationPolicy!==undefined&&(c.taskObservationPolicy!=='current-components-v1'||c.panelReadPolicy!=='focused-v1'||c.learnedBrowse?.enabled!==true))throw Error('Invalid task observation policy: current-components-v1 requires focused-v1 and learned browse');
 if(c.taskCompletionPolicy!==undefined&&(c.taskCompletionPolicy!=='current-keywords-v1'||c.taskObservationPolicy!=='current-components-v1'))throw Error('Invalid task completion policy: current-keywords-v1 requires current-components-v1');
 if(c.aiTaskRecovery!==undefined&&(typeof c.aiTaskRecovery!=='boolean'||c.aiTaskRecovery===true&&(c.aiPanelReader!==true||c.scriptValidationMode!==false||c.panelReadPolicy==='focused-v1'&&(c.learnedBrowse?.enabled!==true||c.learnedBrowse?.sourceRunId!==153))))throw Error('Invalid AI task recovery configuration');
 if(c.aiPanelReader===true&&(c.scriptValidationMode!==false||c.balanceComponent!==false))throw Error('AI panel reader requires explicit scriptValidationMode=false and balanceComponent=false');
 if(c.learnedBrowse!==undefined&&(typeof c.learnedBrowse.enabled!=='boolean'||c.learnedBrowse.version!=='continuous-browse-candidate-v1'||!Number.isSafeInteger(c.learnedBrowse.sourceRunId)||c.learnedBrowse.sourceRunId<=0))throw Error('Invalid learned browse candidate configuration');
 if(c.learnedBrowse?.autoContract!==undefined){
  const b=c.learnedBrowse,l=c.stages?.task_receipt?.continuousScroll;
  if(typeof b.autoContract!=='boolean'||b.autoContract&&(!b.enabled||b.contract!==undefined||!l||!Number.isSafeInteger(l.maxSwipes)||l.maxSwipes<1||!Number.isSafeInteger(l.maxMs)||l.maxMs<1||!unbounded&&(l.requiredMs!==25000||l.maxSwipes!==30||l.maxMs!==35000)))throw Error('Invalid automatic continuous contract or segment budget');
 }
 if(c.learnedBrowse?.contract!==undefined){
  const k=c.learnedBrowse.contract,l=c.stages?.task_receipt?.continuousScroll;
  if(!c.learnedBrowse.enabled||k?.rewardCoins!==50||k.requiredMs!==25000||l?.requiredMs!==25000||!Number.isSafeInteger(l.maxSwipes)||l.maxSwipes<1||!Number.isSafeInteger(l.maxMs)||l.maxMs<1||!unbounded&&(l.maxSwipes!==30||l.maxMs!==35000))throw Error('Invalid continuous browse contract or segment budget');
 }
 if(c.scriptValidationMode!==undefined&&typeof c.scriptValidationMode!=='boolean')throw Error('Invalid script validation mode');
 if(c.dwellBrowse!==undefined){
  if(c.dwellBrowse.version!=='dwell-browse-candidate-v1'||!Array.isArray(c.dwellBrowse.contracts)||!c.dwellBrowse.contracts.length)throw Error('Invalid dwell browse configuration');
  const identities=new Set<string>();
  for(const contract of c.dwellBrowse.contracts){
   const t=contract?.task,key=JSON.stringify([t?.name,t?.instruction]);
   if(!t?.name?.trim()||!t?.instruction?.trim()||!Number.isSafeInteger(contract.dwellMs)||contract.dwellMs<1000||!unbounded&&contract.dwellMs>20000||identities.has(key))throw Error('Invalid dwell browse contract');
   identities.add(key);
  }
 }
 if(c.immersiveBrowse!==undefined){
  const b=c.immersiveBrowse,t=b?.task;
  if(b?.ocrQuality!==undefined&&(typeof b.ocrQuality!=='boolean'||b.ocrQuality===true&&(b.enabled!==true||b.version!=='immersive-browse-candidate-v2')))throw Error('Invalid immersive OCR quality configuration');
  if(typeof b?.enabled!=='boolean'||!['immersive-browse-candidate-v1','immersive-browse-candidate-v2'].includes(b.version)||b.sourceRunId!==145
   ||typeof t?.name!=='string'||!t.name.trim()||typeof t?.instruction!=='string'||!t.instruction.trim()
   ||!Number.isSafeInteger(b.observationBudgetMs)||b.observationBudgetMs<1000||!unbounded&&b.observationBudgetMs>20000)throw Error('Invalid immersive browse configuration');
  if(b.version==='immersive-browse-candidate-v2'&&(!Array.isArray(b.allowedRewardCoins)||!b.allowedRewardCoins.length||new Set(b.allowedRewardCoins).size!==b.allowedRewardCoins.length||!b.allowedRewardCoins.every((x:any)=>x===20||x===35||x===50)))throw Error('Invalid immersive browse allowed reward coins');
  if(b.rewardTransitions!==undefined){
   if(b.version!=='immersive-browse-candidate-v2'||!Array.isArray(b.rewardTransitions)||b.rewardTransitions.length>1)throw Error('Invalid immersive reward transition');
   for(const r of b.rewardTransitions){
    if(r?.sourceRunId!==184||r.browseRewardCoins!==20||r.receiptRewardCoins!==35||!b.allowedRewardCoins?.includes(20)
      ||!Array.isArray(r.files)||r.files.length!==6||!r.files.every((f:any)=>typeof f.path==='string'&&!!f.path.trim()&&/^[a-f0-9]{64}$/.test(f.sha256))
      ||r.version!=='immersive-reward-transition-v1:'+createHash('sha256').update(JSON.stringify({...r,version:''})).digest('hex'))throw Error('Invalid immersive reward transition');
   }
  }
  const normalized=(s:string)=>s.normalize('NFKC').trim();
  if(b.enabled&&(c.dwellBrowse?.contracts??[]).some((x:any)=>normalized(x.task.name)===normalized(t.name)&&normalized(x.task.instruction)===normalized(t.instruction)))throw Error('Conflicting immersive browse and dwell browse task contracts');
 }
 if(c.returnContracts!==undefined){
  if(!Array.isArray(c.returnContracts))throw Error('Invalid return contracts');
  const ids=new Set<string>();
  for(const r of c.returnContracts){
   const t=r?.task;
   if(r?.version!=='flash-return-candidate-v1'||r.sourceRunId!==131||typeof t?.name!=='string'||!t.name.trim()||typeof t?.instruction!=='string'||!t.instruction.trim())throw Error('Invalid return contract');
   const id=JSON.stringify([t.name.normalize('NFKC').trim(),t.instruction.normalize('NFKC').trim()]);
   if(ids.has(id))throw Error('Duplicate return contract identity');ids.add(id);
  }
 }
 if(c.controllerCandidates!==undefined){
  if(!Array.isArray(c.controllerCandidates))throw Error('Invalid controller candidates');
  const ids=new Set<string>(),norm=(s:string)=>s.normalize('NFKC').trim();
  const ref=(r:any)=>typeof r?.path==='string'&&!!r.path.trim()&&/^[a-f0-9]{64}$/.test(r.sha256);
  for(const candidate of c.controllerCandidates){
   const {family,task:t,contract:k,learningBudget:b}=candidate??{};
   const target=family==='panel-claim'?['任务到访得金币','每日来任务面板']:['逛好店赚一大波金币','浏览15秒'];
   if(candidate.panelClaimPolicy!==undefined&&(family!=='panel-claim'||candidate.panelClaimPolicy!=='current-semantic-v1'))throw Error('Invalid panel claim policy');
   const explicitClaim=family==='panel-claim'&&candidate.panelClaimPolicy==='current-semantic-v1';
   if(!['panel-claim','shop-browse'].includes(family)||(!explicitClaim&&(t?.name!==target[0]||t?.instruction!==target[1]))||typeof t?.name!=='string'||!t.name.trim()||typeof t?.instruction!=='string'||!t.instruction.trim()||k?.family!==family||k?.status!=='candidate'
    ||!Array.isArray(k.sourceRunIds)||!k.sourceRunIds.length||!k.sourceRunIds.every((n:any)=>Number.isSafeInteger(n)&&n>0)
    ||!Array.isArray(k.refs)||!k.refs.length||!k.refs.every(ref)||!Array.isArray(k.fixtures)||!k.fixtures.length||!k.fixtures.every((f:any)=>ref(f.png)&&ref(f.ocr)&&(f.rawOcr===undefined||ref(f.rawOcr)))
    ||k.version!==family+'-candidate-v1:'+createHash('sha256').update(JSON.stringify({...k,version:''})).digest('hex'))throw Error('Invalid controller source contract');
   const id=JSON.stringify([norm(t.name),norm(t.instruction)]);
   if(ids.has(id))throw Error('Conflicting controller task identity');ids.add(id);
   if((c.dwellBrowse?.contracts??[]).some((x:any)=>norm(x.task.name)===norm(t.name)&&norm(x.task.instruction)===norm(t.instruction))
    ||c.immersiveBrowse?.enabled&&norm(c.immersiveBrowse.task.name)===norm(t.name)&&norm(c.immersiveBrowse.task.instruction)===norm(t.instruction))throw Error('Conflicting controller and browse task contracts');
   const p=candidate.capturePolicy;
   if(p!==undefined&&(family!=='panel-claim'||!Number.isSafeInteger(p?.frames)||p.frames<1||!unbounded&&p.frames>8||!Number.isSafeInteger(p.intervalMs)||p.intervalMs<0||!unbounded&&(p.intervalMs>250||(p.frames-1)*p.intervalMs>=2000)))throw Error('Invalid controller capture policy');
   if(family==='shop-browse'&&(!b||b.status!=='candidate'||!Number.isSafeInteger(b.maxGestures)||b.maxGestures<1||!unbounded&&b.maxGestures!==1||!Number.isSafeInteger(b.gestureMs)||b.gestureMs<1||b.gestureMs>1000||!Number.isSafeInteger(b.observationBudgetMs)||b.observationBudgetMs<1||!unbounded&&b.observationBudgetMs>20000))throw Error('Invalid controller shop learning budget');
  }
 }
 validateInteractionRoutes(c);
 return c;
}
export function loadPlanDecisions(source:any){
 const rows=Array.isArray(source)?source:source.tasks??source.decisions??source.items??[];
 return rows.filter((d:any)=>typeof d.name==='string'&&typeof d.instruction==='string'&&d.instruction.trim()&&['do','pending','skip'].includes(d.decision)).map((d:any)=>({...d,times:d.initialExecutions??d.times??1}));
}
