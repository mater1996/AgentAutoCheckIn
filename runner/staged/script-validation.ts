import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyImmersiveOcrQuality, type ImmersiveOcrQuality} from './immersive-ocr-quality.ts';
import {loadNavigation} from './navigation-reader.ts';
import {loadAiPanel} from './ai-panel-reader.ts';
import {inspectImmersiveBrowse} from './immersive-browse.ts';
import {readStructured} from '../storage/structured.ts';

/** Read-only focused evidence replay. Partial status never supplies inventory authority. */
export function verifyAuditFocusedPanel(options:{root:string;frame:any;config:any;stageId:string;task:any}) {
  try {
    const {frame:f,config:cfg,stageId,task}=options;
    if(cfg?.panelReadPolicy!=='focused-v1'||cfg.aiPanelReader!==true||f?.package!==cfg.package||f.userId!==cfg.scope?.userId)return null;
    const reader=new EvidenceReader(fs.realpathSync(options.root));
    reader.file(f.path);
    if(!isDeepStrictEqual(reader.json(f.path.replace(/\.png$/,'.json')),f)||!f.aiPanelEvidence)return null;
    reader.file(f.aiPanelEvidence.path);reader.file(f.aiPanelEvidence.rawResponse?.path);
    const purpose=stageId==='open_task'?'selected-row':stageId==='return_list'?'return-status':stageId==='settle'?'settlement':null;
    const expected=purpose?{purpose,task:{name:task?.name,instruction:task?.instruction,done:task?.done,total:task?.total}}:undefined;
    if(f.aiPanelEvidence.readMode&&!expected)return null;
    // Full immutable inventory may be reused for entry; return/settle always require their own purpose.
    if((stageId==='return_list'||stageId==='settle')&&!f.aiPanelEvidence.readMode)return null;
    const panel=loadAiPanel(f,f.aiPanelEvidence.readMode?expected as any:undefined);
    if(!panel?.isPanel||panel.blocked)return null;
    if(stageId==='open_task'){
      const rows=panel.tasks.filter(t=>identity(t)===identity(task));
      if(rows.length!==1||rows[0].done!==task.done||rows[0].total!==task.total||rows[0].done>=rows[0].total)return null;
    }
    return panel;
  }catch{return null;}
}

/** Recompute text from the saved raw OCR; supplied observation text cannot grant a receipt. */
export async function verifyAuditSelectedEntry(options:{root:string;stage:any;config:any;task:any;taskAttemptId:string}){
 try{
  const {stage,config:cfg,task}=options,events=stage?.events??[];
  if(stage.stageId!=='open_task'||cfg.panelReadPolicy!=='focused-v1'||cfg.taskObservationPolicy!=='current-components-v1'||cfg.taskCompletionPolicy!=='current-keywords-v1'||!text(options.taskAttemptId))return null;
  const rebound=events.filter((e:any)=>e.type==='before_dispatch_revalidated');
  const taps=(stage.actions??[]).filter((a:any)=>a.proposal?.action?.type==='tap');
  if(rebound.length!==1||taps.length!==1||taps[0].source!=='script'||taps[0].status!=='verified')return null;
  const e=rebound[0],f=e.frame;
  const sources=events.filter((v:any)=>v.type==='observed'&&v.frame?.id===e.sourceFrameId);
  if(sources.length!==1||e.newFrameId!==f?.id||e.sourceFrameId===f.id||e.sourceProposal?.frameId!==e.sourceFrameId||e.proposal?.frameId!==f.id
   ||!equal(e.proposal,taps[0].proposal)||e.proposal.expected!==e.sourceProposal.expected||!finite(e.at)||!finite(f.capturedAt)||f.capturedAt>e.at||e.at-f.capturedAt>15000
   ||f.capturedAt<sources[0].frame.capturedAt||e.at<sources[0].at||events.indexOf(e)<=events.indexOf(sources[0])
   ||events.filter((v:any)=>v.type==='authority_consumed'&&v.frameId===e.sourceFrameId).length!==1)return null;
  const source=sources[0].frame,panel=verifyAuditFocusedPanel({root:options.root,frame:source,config:cfg,stageId:'open_task',task});
  const rows=panel?.tasks.filter(t=>identity(t)===identity(task))??[],old=e.sourceProposal.action;
  if(rows.length!==1||old?.type!=='tap'||old.x!==rows[0].point?.[0]||old.y!==rows[0].point?.[1])return null;
  const reader=new EvidenceReader(fs.realpathSync(options.root));reader.file(f.path);reader.file(f.path.replace(/\.png$/,'.ocr.json'));
  if(!equal(reader.json(f.path.replace(/\.png$/,'.json')),f))return null;
  const row=await (await import('./observations.ts')).inspectCurrentSelectedTask(f,{package:cfg.package,userId:cfg.scope.userId},task);
  const action=e.proposal.action;
  if(!row?.point||action?.type!=='tap'||action.x!==row.point[0]||action.y!==row.point[1])return null;
  return {frame:f,row,sourceFrame:source,proposal:e.proposal};
 }catch{return null;}
}

/** Recompute text from the saved raw OCR; supplied observation text cannot grant a receipt. */
export function verifyAuditKeywordReceipt(options:{root:string;frame:any;config:any}){
 try{
  const {frame:f,config:cfg}=options;
  if(cfg?.taskCompletionPolicy!=='current-keywords-v1'||cfg.taskObservationPolicy!=='current-components-v1'||f.observationError
   ||f.package!==cfg.package||f.userId!==cfg.scope?.userId)return null;
  const reader=new EvidenceReader(fs.realpathSync(options.root));reader.file(f.path);
  if(!isDeepStrictEqual(reader.json(f.path.replace(/\.png$/,'.json')),f))return null;
  const pages=reader.json(f.path.replace(/\.png$/,'.ocr.json')).pages,p=pages?.[0];
  if(!Array.isArray(pages)||pages.length!==1||reader.file(p.file)!==reader.file(f.path)||p.width!==f.width||p.height!==f.height||!Array.isArray(p.lines))return null;
  const derived=splitOcrObservation(p.lines,f.width,f.height);
  if(f.ocrObservation&&!isDeepStrictEqual(f.ocrObservation,derived.ocrObservation))return null;
  if(hasIdentityChallenge(derived.ocrObservation.texts))return null;
  const quote=currentCompletionQuote(derived.ocrObservation.texts);
  return quote?{state:'completed' as const,quote,version:'current-keywords-v1'}:null;
 }catch{return null;}
}

/** Component proof only: caller must separately bind actual entry, attempt and settlement.
 * Auto contracts are selected only on entry and their in-memory policy binding survives replay. */
export async function verifyAuditTaskComponent(options:{root:string;frame:any;config:any;stageId:string;task:any;selectedContract?:import('./continuous-contract.ts').ContinuousContract}) {
  try {
    const {frame:f,config:cfg,stageId,task}=options;
    if(!['open_task','task_receipt'].includes(stageId)||!cfg?.learnedBrowse?.enabled
      ||cfg.taskObservationPolicy!==undefined&&cfg.taskObservationPolicy!=='current-components-v1')return null;
    const reader=new EvidenceReader(fs.realpathSync(options.root));reader.file(f.path);
    const saved=reader.json(f.path.replace(/\.png$/,'.json'));
    if(!isDeepStrictEqual({...saved,path:reader.file(saved.path)},{...f,path:reader.file(f.path)})||f.package!==cfg.package||f.userId!==cfg.scope?.userId)return null;
    const owner={package:cfg.package,userId:cfg.scope.userId},current=cfg.taskObservationPolicy==='current-components-v1';
    if(current)reader.file(f.path.replace(/\.png$/,'.ocr.json'));
    if(stageId==='task_receipt'&&cfg.taskCompletionPolicy==='current-keywords-v1'){
      const inspection=verifyAuditKeywordReceipt({root:options.root,frame:f,config:cfg});
      if(inspection)return {inspection};
    }
    const policy=current?{policy:'current-components-v1' as const}:undefined;
    const dwell=(cfg.dwellBrowse?.contracts??[]).filter((c:any)=>identity(c.task)===identity(task));
    const immersive=cfg.immersiveBrowse?.enabled&&identity(cfg.immersiveBrowse.task)===identity(task)?cfg.immersiveBrowse:null;
    if(immersive){
      if(dwell.length||current&&(immersive.ocrQuality===true||immersive.rewardTransitions?.length))return null;
      const api=await import('./immersive-browse.ts'),inspect=current?api.inspectCurrentImmersiveBrowse:api.inspectImmersiveBrowse;
      const found=[];
      for(const rewardCoins of immersive.allowedRewardCoins??[20]){const inspection=await inspect(f,owner,{rewardCoins});if(inspection)found.push(inspection);}
      return found.length===1?{inspection:found[0]}:null;
    }
    if(dwell.length){
      if(dwell.length!==1)return null;
      const api=await import('./dwell-browse.ts'),inspection=await(current?api.inspectCurrentDwellBrowse:api.inspectDwellBrowse)(f,owner,dwell[0]);
      return inspection?{inspection}:null;
    }
    if(cfg.learnedBrowse.autoContract===true){
      if(cfg.learnedBrowse.contract)return null;
      const api=await import('./continuous-contract.ts');
      const selectedContract=options.selectedContract??(stageId==='open_task'?await api.selectContinuousContract(f,owner,{},policy):null);
      if(!selectedContract)return null;
      const {inspection}=await api.inspectSelectedContinuousContract(f,owner,selectedContract,policy);
      return inspection?{inspection,selectedContract}:null;
    }
    const api=await import('./learned-browse.ts'),inspection=await(current?api.inspectCurrentLearnedBrowse:api.inspectLearnedBrowse)(f,owner,cfg.learnedBrowse.contract);
    return inspection?{inspection}:null;
  }catch{return null;}
}

/** Local proof only: original capture + recomputed geometry + component inspection.
 * No receipt, freshness renewal, ledger access or completion authority is created. */
export async function verifyAuditImmersiveOcrQuality(options:{root:string;evidenceDir:string;config:any;stages:any[];runtime:any[];
  taskAttemptId:string;stageId:string;frameId:string;rewardCoins:number;task:any}) {
  try {
    const {config:cfg,stages,runtime,taskAttemptId,stageId,frameId,rewardCoins,task}=options;
    const immersive=cfg?.immersiveBrowse;
    if(immersive?.enabled!==true||immersive.ocrQuality!==true||immersive.version!=='immersive-browse-candidate-v2'
      ||identity(immersive.task)!==identity(task)||!text(taskAttemptId)||!['open_task','task_receipt'].includes(stageId)
      ||![20,35,50].includes(rewardCoins)||!immersive.allowedRewardCoins?.includes(rewardCoins))return null;
    const reader=new EvidenceReader(fs.realpathSync(options.root));
    const sessionRoot=fs.realpathSync(path.resolve(reader.root,options.evidenceDir));
    const sessionRelative=path.relative(reader.root,sessionRoot);
    if(!sessionRelative||sessionRelative==='..'||sessionRelative.startsWith('..'+path.sep)||path.isAbsolute(sessionRelative))return null;
    const within=(file:string)=>{
      const resolved=reader.file(file),relative=path.relative(sessionRoot,resolved);
      if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Source escapes session');
      return resolved;
    };
    const owned=stages.filter(s=>s.stageId===stageId);
    if(owned.length!==1)return null;
    const frames=auditStageFrames(owned[0]).filter((f:any)=>f?.id===frameId);
    if(!frames.length||frames.some((f:any)=>!isDeepStrictEqual(f,frames[0])))return null;
    const frame=frames[0];
    within(frame.path);within(frame.path.replace(/\.png$/,'.json'));within(frame.path.replace(/\.png$/,'.ocr.json'));
    if(frame.package!==cfg.package||frame.userId!==cfg.scope?.userId)return null;
    const events=runtime.filter(e=>e.kind==='immersive_ocr_quality'&&e.frameId===frameId);
    if(events.length!==1)return null;
    const event=events[0];
    if(event.stageId!==stageId||event.rewardCoins!==rewardCoins||event.taskAttemptId!==taskAttemptId||!text(event.entryActionId))return null;
    const entries=runtime.filter(e=>e.kind==='learned_entry_dispatched'&&e.taskAttemptId===taskAttemptId);
    if(entries.length!==1)return null;
    const entry=entries[0],open=stages.filter(s=>s.stageId==='open_task');
    if(entry.dispatched!==true||identity(entry)!==identity(task)||entry.sourceFrameId!==event.entryFrameId
      ||entry.entryActionId!==event.entryActionId||event.entryActionId!==`${taskAttemptId}:${entry.sourceFrameId}:tap`||open.length!==1)return null;
    const taps=(open[0].actions??[]).filter((a:any)=>a.proposal?.action?.type==='tap');
    if(taps.length!==1||taps[0].source!=='script'||taps[0].status!=='verified'||taps[0].error||taps[0].proposal.frameId!==entry.sourceFrameId)return null;
    const sources=auditStageFrames(open[0]).filter((f:any)=>f?.id===entry.sourceFrameId);
    if(!sources.length||sources.some((f:any)=>!isDeepStrictEqual(f,sources[0])))return null;
    const before=sources[0];
    within(before.path);
    if(!isDeepStrictEqual(reader.json(within(before.path.replace(/\.png$/,'.json'))),before)
      ||before.package!==cfg.package||before.userId!==cfg.scope?.userId||before.id===frame.id||before.capturedAt>=frame.capturedAt)return null;
    const rows=readPanel(before,cfg.panelMarker).tasks.filter(t=>identity(t)===identity(task)),tap=taps[0].proposal.action;
    if(rows.length!==1||!rows[0].point||rows[0].done>=rows[0].total
      ||Math.hypot(rows[0].point[0]-tap.x,rows[0].point[1]-tap.y)>75)return null;
    const quality=await verifyImmersiveOcrQuality(frame,{rewardCoins:rewardCoins as 20|35|50},event.quality);
    if(!quality)return null;
    const inspection=await inspectImmersiveBrowse(frame,{package:cfg.package,userId:cfg.scope.userId},{rewardCoins},quality);
    return inspection?{frame,quality,inspection}:null;
  }catch{return null;}
}

/** Local recovery proof only. A skip cannot establish task completion or gain. */
export async function verifyAuditEntryRecovery(options:{root:string;sourceRoot?:string;evidenceDir:string;config:any;stages:any[];runtime:any[];sessionId:string;taskAttemptId:string}) {
  try {
    const {config:cfg,stages,runtime,sessionId,taskAttemptId}=options;
    if(cfg?.entryRecovery!==true||cfg.localActivityNavigation!==true||!text(sessionId)||!text(taskAttemptId))return null;
    const reader=new EvidenceReader(fs.realpathSync(options.root));
    const sessionRoot=fs.realpathSync(path.resolve(reader.root,options.evidenceDir));
    const sourceRoot=fs.realpathSync(options.sourceRoot??reader.root);
    const contains=(root:string,target:string)=>{const rel=path.relative(root,target);return !!rel&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
    if(!contains(reader.root,sessionRoot)||sourceRoot!==reader.root&&!contains(reader.root,sourceRoot))return null;
    const within=(file:string)=>{const resolved=reader.file(file);if(!contains(sessionRoot,resolved))throw Error('Recovery source escapes session');return resolved;};
    const owned=stages.filter(s=>s.stageId==='enter_activity');
    if(owned.length!==1)return null;
    const stage=owned[0],events=stage.events??[];
    if(events.some((e:any)=>/unknown|error|unverified|rejected/.test(e.type??'')))return null;
    const recovery=runtime.filter(e=>typeof e.kind==='string'&&e.kind.startsWith('entry_recovery_'));
    const kinds=['entry_recovery_prepared','entry_recovery_consumed','entry_recovery_dispatched','entry_recovery_confirmed'];
    if(!equal(recovery.map(e=>e.kind),kinds))return null;
    const [prepared,consumed,dispatched,confirmed]=recovery;
    if(!text(prepared.recoveryId)||!Number.isSafeInteger(prepared.startedAt)||!Number.isSafeInteger(prepared.deadline))return null;
    const time=(e:any)=>typeof e.at==='string'?Date.parse(e.at):NaN;
    const times=recovery.map(time),start=prepared.startedAt,deadline=prepared.deadline;
    if(times.some(t=>!finite(t)||t<start||t>=deadline)||times.some((t,i)=>i>0&&t<times[i-1])
      ||deadline<=start||deadline>start+3000||consumed.fsynced!==true||!Number.isSafeInteger(dispatched.dispatchedAt)
      ||dispatched.dispatchedAt>times[2]||dispatched.dispatchedAt<times[1])return null;
    const first=events.find((e:any)=>e.type==='observed');
    // Recovery begins at the first recognition, after the original observation.
    if(!first||!finite(first.at)||start<first.at)return null;
    const session=reader.json(within(path.join(sessionRoot,'session.json'))),sessionStart=Date.parse(session.startedAt);
    if(session.id!==sessionId||!finite(sessionStart)||sessionStart>start
      ||fs.realpathSync(path.resolve(reader.root,session.evidenceDir))!==sessionRoot
      ||!finite(cfg.limits?.sessionMs)||!finite(cfg.limits?.stageMs)
      ||deadline>sessionStart+cfg.limits.sessionMs||deadline>first.at+cfg.limits.stageMs)return null;
    const api=await import('./entry-recovery.ts');
    const manifest=api.entryRecoverySource;
    if(manifest.version!=='entry-recovery-210-v1'||manifest.files.length!==6)return null;
    for(const ref of manifest.files){const file=reader.file(path.resolve(sourceRoot,ref.path));if(!contains(sourceRoot,file)||sha(reader.bytes(file))!==ref.sha256)return null;}
    const digest=sha(JSON.stringify(manifest));
    const keys=['recoveryId','version','sourceFrameId','sourceCapturedAt','startedAt','deadline','sourceManifestDigest','action'];
    for(const e of recovery)if(e.stageId!=='enter_activity'||e.sessionId!==sessionId||e.taskAttemptId!==taskAttemptId
      ||keys.some(k=>!equal(e[k],prepared[k]))||e.version!==manifest.version||e.sourceManifestDigest!==digest)return null;
    const observed=events.filter((e:any)=>e.type==='observed'),frames=observed.map((e:any)=>e.frame);
    const sources=frames.filter((f:any)=>f?.id===prepared.sourceFrameId);
    if(sources.length!==1||!isDeepStrictEqual(sources[0],prepared.frame)||first.frame!==sources[0])return null;
    const source=sources[0];
    const saved=(f:any,rawOCR=false)=>{
      if(!text(f?.id)||!text(f.path)||!f.path.endsWith('.png')||!Number.isSafeInteger(f.capturedAt)
        ||f.package!==cfg.package||f.userId!==cfg.scope?.userId||f.observationError)return false;
      const png=within(f.path);
      if(!isDeepStrictEqual(reader.json(within(f.path.replace(/\.png$/,'.json'))),f))return false;
      if(rawOCR){
        const raw=reader.json(within(f.path.replace(/\.png$/,'.ocr.json'))),page=raw.pages?.[0];
        if(raw.engine!=='Apple Vision VNRecognizeTextRequest'||raw.pages.length!==1||page.width!==f.width||page.height!==f.height
          ||within(page.file)!==png||!Array.isArray(page.lines)||!isDeepStrictEqual(page.lines.map((l:any)=>({text:l.text,bounds:l.bounds})),f.lines))return false;
      }
      return true;
    };
    if(!saved(source,true)||source.capturedAt!==prepared.sourceCapturedAt||source.capturedAt>times[0]
      ||times[1]-source.capturedAt>1500||dispatched.dispatchedAt-source.capturedAt>1500)return null;
    const owner={package:cfg.package,userId:cfg.scope.userId};
    const inspection=await api.inspectEntryRecovery({...source,path:within(source.path)},owner,sourceRoot);
    if(!inspection||!isDeepStrictEqual(inspection,prepared.proof)||!equal(inspection.action,prepared.action))return null;
    const matching=(stage.actions??[]).map((a:any,i:number)=>({a,i})).filter(({a}:any)=>a.proposal?.frameId===source.id);
    if(matching.length!==1)return null;
    const {a:action,i:actionIndex}=matching[0];
    if(action.source!=='script'||action.status!=='verified'||action.error||action.proposal?.action?.type!=='tap'
      ||!equal(action.proposal.action,inspection.action))return null;
    const authorities=events.filter((e:any)=>e.type==='authority_consumed'&&e.frameId===source.id);
    if(authorities.length!==1||authorities[0].actionAttempt!==actionIndex+1||!finite(authorities[0].at)
      ||authorities[0].at<times[0]||authorities[0].at>times[1]||events.indexOf(authorities[0])<=events.indexOf(first))return null;
    for(const s of stages)if(s!==stage&&(s.actions??[]).some((a:any)=>a.proposal?.frameId===source.id))return null;
    const arrivals=frames.filter((f:any)=>f?.id===confirmed.arrivalFrameId);
    if(arrivals.length!==1||!isDeepStrictEqual(arrivals[0],confirmed.frame))return null;
    const arrival=arrivals[0],arrivalEvent=observed.find((e:any)=>e.frame===arrival);
    if(!saved(arrival)||arrival.id===source.id||arrival.path===source.path||arrival.capturedAt<=dispatched.dispatchedAt
      ||arrival.capturedAt>times[3]||times[3]-arrival.capturedAt>1500||!finite(arrivalEvent.at)||arrivalEvent.at<arrival.capturedAt||arrivalEvent.at>times[3]
      ||frames.indexOf(arrival)<=frames.indexOf(source))return null;
    const interval=events.slice(events.indexOf(authorities[0])+1,events.indexOf(arrivalEvent));
    const recoveryWaits=(stage.actions??[]).filter((a:any,i:number)=>{
      if(i===actionIndex)return false;
      const captured=frames.find((f:any)=>f.id===a.proposal?.frameId);
      if(!captured)throw Error('Action without original source');
      return frames.indexOf(captured)<frames.indexOf(arrival);
    });
    if(recoveryWaits.length>2||recoveryWaits.some((a:any)=>a.source!=='script'||a.status!=='verified'||a.error
      ||a.proposal?.action?.type!=='wait'||a.proposal.action.ms!==500))return null;
    const waitFrames=new Set<string>();
    for(const action of recoveryWaits){
      const id=action.proposal.frameId,event=observed.find((e:any)=>e.frame.id===id);
      const authority=events.filter((e:any)=>e.type==='authority_consumed'&&e.frameId===id);
      if(waitFrames.has(id)||!event||authority.length!==1||authority[0].actionAttempt!==stage.actions.indexOf(action)+1
        ||!finite(authority[0].at)||authority[0].at<event.at||authority[0].at+500>arrival.capturedAt
        ||authority[0].at+500>=deadline||events.indexOf(authority[0])<=events.indexOf(event)
        ||events.indexOf(authority[0])>=events.indexOf(arrivalEvent))return null;
      waitFrames.add(id);
    }
    const waits=interval.filter((e:any)=>e.type==='tap_settling');
    const waitMs=waits.reduce((sum:number,e:any)=>sum+e.ms,0)+recoveryWaits.reduce((sum:number,a:any)=>sum+a.proposal.action.ms,0);
    if(!finite(waitMs)||waitMs>1000||waits.length>1||waits.some((e:any)=>{
      const previous=events[events.indexOf(e)-1];
      return ![500,1000].includes(e.ms)||!finite(e.at)||e.at<times[2]||e.at+e.ms>=deadline||e.at+e.ms>arrival.capturedAt
        ||previous?.type!=='observed'||previous.frame.id!==e.frameId||e.at<previous.at||e.at-previous.frame.capturedAt>1500;
    })||interval.filter((e:any)=>e.type==='observed').length>2)return null;
    const navigationProof=async(frame:any)=>{
      const refinements=[confirmed.arrivalProof,...runtime.filter(e=>e.kind==='activity_navigation_attempted')]
        .filter(e=>e?.frameId===frame.id&&e.chromeRefinement).map(e=>e.chromeRefinement);
      if(refinements.length>1&&refinements.some(r=>!equal(r,refinements[0])))return null;
      const refinement=refinements[0];
      if(refinement)for(const key of ['path','rawPath','ocrPath'])within(refinement[key]);
      return verifyAuditActivityNavigation({root:sourceRoot,frame:{...frame,path:within(frame.path)},owner,refinement,policy:cfg.navigationPolicy,stageId:'enter_activity',expectedCheckpoint:cfg.stages?.enter_activity?.checkpoint});
    };
    for(const event of interval.filter((e:any)=>e.type==='observed')){
      if(!saved(event.frame,true)||event.frame.capturedAt<=dispatched.dispatchedAt||event.frame.capturedAt>=arrival.capturedAt
        ||!finite(event.at)||event.at<event.frame.capturedAt||event.at>=deadline||event.at-event.frame.capturedAt>1500)return null;
      if(!await navigationProof(event.frame)&&!await api.inspectEntryRecovery({...event.frame,path:within(event.frame.path)},owner,sourceRoot))return null;
    }
    const navigation=await navigationProof(arrival);
    if(!navigation||navigation.state!==confirmed.state||!navigationWitnessMatches(confirmed.arrivalProof,navigation))return null;
    return {recoveryId:prepared.recoveryId,sourceFrameId:source.id,actionIndex,action:inspection.action,
      arrivalFrame:arrival,state:navigation.state,sourceManifestDigest:digest};
  }catch{return null;}
}

// Only durable original capture flows can supply a quality source. Runtime quality
// payloads are never frame authority; ordinary recovery still needs its stage observation.
function auditStageFrames(stage:any):any[] {
  return (stage?.events??[]).flatMap((event:any)=>event.type==='observed'?[event.frame]
    :event.type==='before_dispatch_revalidated'&&event.newFrameId===event.frame?.id?[event.frame]:[]);
}
import {validateStagedConfig} from './config.ts';
import {readPanel,splitOcrObservation,currentCompletionQuote,hasIdentityChallenge} from './observations.ts';
import {verifyImmersiveTransition} from './immersive-transition.ts';
import {readLegacyBalanceComponent, BALANCE_COMPONENT_VERSION, LEGACY_BALANCE_COMPONENT_VERSION, BALANCE_GLYPH_SOURCES, balanceTextCrop, validateBalanceTextFrame, validateBalanceCropOCR} from './balance-component.ts';

/** Independently replay saved pixels/OCR. Never invoke OCR or write source evidence. */
export async function verifyAuditBalanceComponent(options:{root:string;frame:any;expectedValue:number}):Promise<boolean> {
  let sandbox:string|undefined;
  try {
    const reader=new EvidenceReader(fs.realpathSync(options.root)),f=options.frame,e=f?.balanceEvidence,o=e?.ocrEvidence;
    if(!e||e.status!=='accepted'||![BALANCE_COMPONENT_VERSION,LEGACY_BALANCE_COMPONENT_VERSION].includes(e.version)||e.frameId!==f.id||e.value!==options.expectedValue||!o)return false;
    const png=reader.bytes(f.path),crop=reader.bytes(o.cropPath),raw=reader.bytes(o.path);
    if(sha(png)!==e.sourcePngSha256||sha(crop)!==e.cropHash||sha(raw)!==o.sha256)return false;
    const saved=JSON.parse(raw.toString());
    if(!Array.isArray(saved.pages)||saved.pages.length!==1||saved.pages[0].file!==o.cropPath)return false;
    if(e.version===BALANCE_COMPONENT_VERSION){
      const full=e.fullFrameOcrEvidence;
      if(!full||full.path!==f.path.replace(/\.png$/,'.ocr.json')||!equal(e.roi,{left:86,top:238,width:128,height:70})
        ||!Number.isSafeInteger(e.value)||e.value<=0||e.glyphRecognition!==undefined||e.referenceProvenance!==undefined||e.referencePngSha256!==undefined)return false;
      const fullRaw=reader.bytes(full.path);if(sha(fullRaw)!==full.sha256)return false;
      const line=validateBalanceCropOCR(saved,o.cropPath);
      validateBalanceTextFrame(f,JSON.parse(fullRaw.toString()),line.text);
      return Number(line.text)===e.value&&line.text===o.text&&equal(line.bounds,o.bounds)&&(await balanceTextCrop(png)).equals(crop);
    }
    // Confine all references before the module opens its immutable original sources.
    for(const source of BALANCE_GLYPH_SOURCES)if(sha(reader.bytes(source.path))!==source.sha256)return false;
    for(const ref of e.referenceProvenance??[])if(sha(reader.bytes(ref.path))!==ref.sha256)return false;
    const scratch=process.env.TMPDIR;
    if(!scratch)throw Error('Missing scratch directory');
    sandbox=fs.mkdtempSync(path.join(scratch,'balance-audit-'));
    const replay=await readLegacyBalanceComponent({fullDeviceFrame:f,originalPNG:png,evidenceDir:sandbox,
      exec:async(_file,[output,cropPath])=>{
        if(!fs.readFileSync(cropPath).equals(crop))throw Error('Recomputed same-frame crop differs');
        const pages=structuredClone(saved);pages.pages[0].file=cropPath;
        fs.writeFileSync(output,JSON.stringify(pages),{flag:'wx'});return {stdout:''};
      }});
    const fields=['status','value','frameId','sourcePngSha256','roi','cropHash','version','applicability','referencePngSha256','referenceProvenance','glyphRecognition'];
    return replay.status==='accepted'&&fields.every(k=>equal((replay as any)[k],e[k]))
      &&replay.ocrEvidence?.text===o.text&&equal(replay.ocrEvidence?.bounds,o.bounds);
  }catch{return false;}
  finally{if(sandbox)fs.rmSync(sandbox,{recursive:true,force:true});}
}

/** Verify immutable navigation evidence, then replay saved OCR through the same checker. */
export async function verifyAuditActivityNavigation(options:{root:string;frame:any;owner:{package:string;userId:number};refinement?:any;policy?:string;stageId?:string;expectedCheckpoint?:string}) {
  let sandbox:string|undefined;
  try {
    const reader=new EvidenceReader(fs.realpathSync(options.root)),f=options.frame,r=options.refinement;
    const api=await import('./activity-navigation.ts');
    if(options.policy!==undefined&&options.policy!=='current-text-v1')return null;
    if(options.policy==='current-text-v1'){
      if(r||f.package!==options.owner.package||f.userId!==options.owner.userId)return null;
      const local={...f,path:reader.file(f.path)};
      if(local.aiPanelEvidence){reader.file(local.aiPanelEvidence.path);if(local.aiPanelEvidence.rawResponse)reader.file(local.aiPanelEvidence.rawResponse.path);const p=loadAiPanel(local);return p?.isPanel&&!p.blocked?{state:'panel',provenance:{version:'ai-panel-v1'}}:null;}
      if(local.navigationEvidence){
        if(!options.stageId||!options.expectedCheckpoint)return null;
        reader.file(local.navigationEvidence.path);if(local.navigationEvidence.rawResponse)reader.file(local.navigationEvidence.rawResponse.path);
        return loadNavigation(local,options.owner,{stageId:options.stageId,expectedCheckpoint:options.expectedCheckpoint});
      }
      reader.file(local.path.replace(/\.png$/,'.ocr.json'));
      return api.inspectCurrentActivityNavigation(local,options.owner);
    }
    const panel=f?.lines?.some((l:any)=>l.text==='赚金币抵钱');
    const refs=panel?[]
      :f?.lines?.some((l:any)=>l.text==='去赚金币')&&!f?.lines?.some((l:any)=>l.text==='领淘金币')?[...api.activityLandingSource.files,...api.activityRenderedLandingSource.files]:api.activityNavigationSource.files;
    for(const ref of refs)reader.file(ref.path);
    const local={...f,path:reader.file(f.path)};
    if(panel)reader.file(local.path.replace(/\.png$/,'.ocr.json'));
    if(!r)return await api.inspectLearnedActivityNavigation(local,options.owner,reader.root,{exec:async()=>{throw Error('Saved refinement required; live OCR forbidden');}});
    if(!Array.isArray(f.lines)||f.lines.some((l:any)=>l.text==='淘')||r.frameId!==f.id
      ||!equal(r.roi,[40,2160,165,2275])||r.scale!==2||!finite(r.elapsedMs)||r.elapsedMs<0||r.elapsedMs>2500
      ||r.engine!=='Apple Vision VNRecognizeTextRequest'||!text(r.ocrInputPath)||!path.isAbsolute(r.ocrInputPath))return null;
    const png=reader.bytes(f.path),original=reader.bytes(r.rawPath),crop=reader.bytes(r.path),raw=reader.bytes(r.ocrPath);
    if(!png.equals(original)||sha(png)!==r.sourceSha||sha(crop)!==r.cropSha||raw.length>65536||sha(raw)!==r.ocrSha)return null;
    const {default:sharp}=await import('sharp');
    const expected=await sharp(png).extract({left:40,top:2160,width:125,height:115}).resize(250,230).png().toBuffer();
    if(!expected.equals(crop))return null;
    const saved=JSON.parse(raw.toString()),page=saved.pages?.[0],line=page?.lines?.[0];
    if(saved.engine!==r.engine||!Array.isArray(saved.pages)||saved.pages.length!==1||page.file!==r.ocrInputPath||page.width!==250||page.height!==230
      ||!Array.isArray(page.lines)||page.lines.length!==1||line.text!=='淘'||!Array.isArray(line.bounds)||line.bounds.length!==4
      ||!line.bounds.every(finite)||line.bounds[0]<0||line.bounds[1]<0||line.bounds[2]>250||line.bounds[3]>230||line.bounds[0]>=line.bounds[2]||line.bounds[1]>=line.bounds[3]
      ||!equal(r.bounds,line.bounds.map((n:number,k:number)=>n/2+[40,2160][k%2])))return null;
    const replay=await api.inspectLearnedActivityNavigation(local,options.owner,reader.root,{exec:async(_file,[output,cropPath])=>{
      sandbox=path.dirname(cropPath);
      if(!fs.readFileSync(cropPath).equals(crop)||!fs.readFileSync(path.join(sandbox,'frame.png')).equals(png))throw Error('Replay pixels differ');
      const mapped=structuredClone(saved);mapped.pages[0].file=cropPath;
      fs.writeFileSync(output,JSON.stringify(mapped),{flag:'wx'});return {stdout:''};
    }});
    if(replay?.state!=='home'||!replay.chromeRefinement)return null;
    for(const key of ['frameId','sourceSha','roi','scale','cropSha','bounds','engine'])if(!equal((replay.chromeRefinement as any)[key],r[key]))return null;
    return replay;
  }catch{return null;}
  finally{if(sandbox)fs.rmSync(sandbox,{recursive:true,force:true});}
}

/** Actual matches are recomputed from saved pixels; manifests are provenance only.
 * Absence is meaningful for pages/checkers without home component witnesses. */
function navigationWitnessMatches(record:any,known:any):boolean {
  return known?.matchedComponents!==undefined
    ?isDeepStrictEqual(record?.matchedComponents,known.matchedComponents)
    :!record||!Object.hasOwn(record,'matchedComponents');
}

/** Original navigation remains one tap per stage after a separately proven prelude. */
export async function verifyAuditNavigationStages(options:{root:string;evidenceDir:string;config:any;stages:any[];runtime:any[];sessionId:string;taskAttemptId:string}) {
  try {
    const {config:cfg,stages,runtime}=options,reader=new EvidenceReader(fs.realpathSync(options.root));
    const observed=(s:any)=>(s?.events??[]).filter((e:any)=>e.type==='observed'||e.type==='dispatch_not_sent_revalidated').map((e:any)=>e.frame);
    const recoveryEvents=runtime.filter(e=>typeof e.kind==='string'&&e.kind.startsWith('entry_recovery_'));
    const recoveryProof=recoveryEvents.length?await verifyAuditEntryRecovery(options):null;
    if(recoveryEvents.length&&!recoveryProof)return false;
      const owner={package:cfg.package,userId:cfg.scope.userId},navigation=stages.find(s=>s.stageId==='enter_activity'),list=stages.find(s=>s.stageId==='open_list');
      const sessionStart=Date.parse(reader.json(path.join(options.evidenceDir,'session.json')).startedAt);
      const inspect=async(f:any,attempt?:any,stageId?:string)=>{
        if(!text(f?.id)||!finite(f.capturedAt)||!finite(sessionStart)||f.capturedAt<sessionStart
          ||f.package!==cfg.package||f.userId!==cfg.scope.userId||!Array.isArray(f.lines))return null;
        reader.file(f.path);
        if(!equal(reader.json(f.path.replace(/\.png$/,'.json')),f))return null;
        return verifyAuditActivityNavigation({root:reader.root,frame:f,owner,refinement:attempt?.chromeRefinement,policy:cfg.navigationPolicy,stageId:stageId??attempt?.stageId,expectedCheckpoint:cfg.stages?.[stageId??attempt?.stageId]?.checkpoint});
      };
      const entered=observed(navigation).at(-1),opened=observed(list).at(-1);
      if(!['landing','panel'].includes((await inspect(entered,undefined,'enter_activity'))?.state??'')||(await inspect(opened,undefined,'open_list'))?.state!=='panel'
        ||observed(list)[0]?.capturedAt<entered.capturedAt)throw Error('Learned navigation/list arrival not proven in original ordered frames');
      const navigationStages=[navigation,list];
      const foregroundChains=runtime.filter(e=>e.kind==='navigation_foreground_recovery_consumed');
      const reboundSources=new Map<any,any>(),unsentAttempts=new Set<any>();
      if(foregroundChains.length>1)throw Error('Foreground recovery is once per session');
      for(const chain of foregroundChains){
        if(cfg.navigationPolicy!=='current-text-v1'||chain.sessionId!==options.sessionId||chain.taskAttemptId!==options.taskAttemptId
          ||!text(chain.recoveryId)||!['enter_activity','open_list'].includes(chain.stageId))throw Error('Invalid foreground recovery binding');
        const s=navigationStages.find(s=>s?.stageId===chain.stageId),events=s?.events??[];
        const rebound=events.filter((e:any)=>e.type==='dispatch_not_sent_revalidated');
        const revalidated=runtime.filter(e=>e.kind==='navigation_foreground_revalidated'&&e.recoveryId===chain.recoveryId);
        const sent=runtime.filter(e=>e.kind==='navigation_foreground_recovery_sent'&&e.recoveryId===chain.recoveryId);
        const arrivals=runtime.filter(e=>e.kind==='navigation_foreground_recovery_arrival'&&e.recoveryId===chain.recoveryId);
        if(rebound.length!==1||revalidated.length!==1||sent.length!==1||runtime.some(e=>['navigation_foreground_recovery_stopped','navigation_foreground_recovery_unknown'].includes(e.kind)&&e.recoveryId===chain.recoveryId))throw Error('Incomplete foreground recovery chain');
        if(arrivals.length!==1||arrivals[0].status!=='completed'||arrivals[0].arrivalFrameId!==observed(s).at(-1)?.id
          ||![chain,revalidated[0],sent[0],arrivals[0]].every(e=>finite(Date.parse(e.at))&&e.sessionId===options.sessionId&&e.taskAttemptId===options.taskAttemptId&&e.stageId===s?.stageId))throw Error('Recovery binding/arrival mismatch');
        const e=rebound[0],fresh=e.frame,source=observed(s).find((f:any)=>f.id===chain.sourceFrameId);
        if(!source||!['recoveryId','sessionId','taskAttemptId','stageId','sourceFrameId','sourceProposal','proof'].every(k=>equal(e.proof?.[k],chain[k]))||!equal(e.sourceProposal,chain.sourceProposal)||e.sourceFrameId!==source.id
          ||!equal(e.frame,revalidated[0].frame)||!equal(e.proposal,revalidated[0].proposal)||fresh.id===source.id
          ||sent[0].frameId!==fresh.id||!equal(sent[0].action,e.proposal.action)
          ||!equal((s.actions??[]).filter((a:any)=>a.proposal?.action?.type==='tap').map((a:any)=>a.proposal),[e.proposal]))throw Error('Foreground recovery frame/proposal mismatch');
        const proofBytes=reader.bytes(chain.proof.path),proof=JSON.parse(proofBytes.toString());
        if(sha(proofBytes)!==chain.proof.sha256||proof.version!=='act-not-sent-v1'||proof.reason!=='foreground_markers_missing'||proof.inputSent!==false
          ||proof.consumedFrameId!==source.id||!equal(proof.action,e.sourceProposal.action)||e.sourceProposal.frameId!==source.id)throw Error('Missing exact consumed unsent act proof');
        const fgBytes=reader.bytes(proof.foreground.path),fg=JSON.parse(fgBytes.toString());
        if(sha(fgBytes)!==proof.foreground.sha256||fg.kind!=='foreground'||fg.status!=='missing'||fg.result?.code!==0||fg.result?.signal!==null||fg.result?.killed!==false
          ||fg.command?.file!=='adb'||!equal(fg.command?.args?.slice(2),['shell','dumpsys','activity','activities'])
          ||typeof fg.stdout!=='string'||/\btopResumedActivity\s*=|\bmResumedActivity\s*[:=]/.test(fg.stdout)
          ||!equal(fg.topCandidates,[])||!equal(fg.resumedCandidates,[])
          ||!finite(proof.at)||!finite(fg.startedAt)||!finite(fg.endedAt)||fg.endedAt<fg.startedAt||proof.at<source.capturedAt||fg.endedAt>proof.at||fg.startedAt<source.capturedAt
          ||fresh.capturedAt<proof.at||Date.parse(chain.at)<proof.at||Date.parse(revalidated[0].at)<fresh.capturedAt
          ||Date.parse(sent[0].at)<fresh.capturedAt||Date.parse(sent[0].at)-fresh.capturedAt>15000)throw Error('Foreground proof is not a bounded missing-marker pre-dispatch read');
        const oldKnown=await inspect(source,undefined,s.stageId),newKnown=await inspect(fresh,undefined,s.stageId);
        if(oldKnown?.state!==(s===navigation?'home':'landing')||newKnown?.state!==oldKnown.state||newKnown.version!==oldKnown.version
          ||!equal(oldKnown.action,e.sourceProposal.action)||!equal(newKnown.action,e.proposal.action))throw Error('Original page/target not independently rebound');
        const oldAttempts=runtime.filter(x=>x.kind==='activity_navigation_attempted'&&x.stageId===s.stageId&&x.frameId===source.id&&equal(x.action,e.sourceProposal.action));
        const notSent=runtime.filter(x=>x.kind==='navigation_foreground_not_sent'&&x.stageId===s.stageId&&x.frameId===source.id);
        if(oldAttempts.length!==1||notSent.length!==1||!equal(notSent[0].proof,chain.proof)||!equal(notSent[0].action,e.sourceProposal.action))throw Error('Original attempted tap must be proven unsent');
        unsentAttempts.add(oldAttempts[0]);reboundSources.set(s,{source,fresh});
      }
      if(navigationStages.some(s=>(s?.events??[]).some((e:any)=>e.type==='dispatch_not_sent_revalidated')&&!reboundSources.has(s)))throw Error('Unbound engine recovery event');
      const attempts=runtime.filter(x=>x.kind==='activity_navigation_attempted'&&!unsentAttempts.has(x));
      const byStage=new Map<any,any[]>(navigationStages.map(s=>[s,[]]));
      for(const attempt of attempts){
        // Legacy records lack stageId. Associate only a unique same-stage source/action.
        const owners=navigationStages.filter(s=>(attempt.stageId===undefined||attempt.stageId===s?.stageId)
          &&(s?.actions??[]).some((tap:any)=>tap.proposal?.action?.type==='tap'&&tap.proposal.frameId===attempt.frameId
            &&equal(tap.proposal.action,attempt.action)&&observed(s).some((f:any)=>f.id===attempt.frameId)));
        if(owners.length!==1)throw Error('Navigation attempt has no unique owning stage/source/action');
        byStage.get(owners[0])!.push(attempt);
      }
      for(const s of navigationStages){
        const allFrames=observed(s),frames=s===navigation&&recoveryProof?allFrames.slice(allFrames.findIndex((f:any)=>f.id===recoveryProof.arrivalFrame.id)):allFrames;
        const arrival=frames.at(-1),taps=(s?.actions??[]).filter((x:any,i:number)=>x.proposal?.action?.type==='tap'&&!(s===navigation&&recoveryProof?.actionIndex===i)),owned=byStage.get(s)!;
        const allowed=s===navigation?['landing','panel']:['panel'];
        if((s?.actions??[]).some((x:any)=>!['tap','wait'].includes(x.proposal?.action?.type)||x.proposal.action.type==='wait'&&(!finite(x.proposal.action.ms)||x.proposal.action.ms<0||x.proposal.action.ms>1000))||taps.length>1||owned.length!==taps.length)throw Error('Navigation requires at most one corresponding tap per stage and only bounded settling waits');
        if(taps.length){
          const tap=taps[0],source=frames.find((f:any)=>f.id===tap.proposal.frameId),attempt=owned[0],ref=attempt.chromeRefinement;
          const at=typeof attempt.at==='string'?Date.parse(attempt.at):NaN;
          if(!source||!finite(at)||at<source.capturedAt||at>=arrival.capturedAt
            ||cfg.navigationPolicy==='current-text-v1'&&(at-source.capturedAt>15000||tap.status!=='verified')
            ||(s===navigation&&recoveryProof?.state==='home'
              ?source.id===recoveryProof.arrivalFrame.id||source.capturedAt<=recoveryProof.arrivalFrame.capturedAt||frames[1]!==source
              :reboundSources.has(s)?frames[0]!==reboundSources.get(s).source||source!==reboundSources.get(s).fresh||frames[1]!==source:frames[0]!==source)
            ||frames.indexOf(source)>=frames.indexOf(arrival))throw Error('Navigation dispatch is outside the ordered source/arrival interval');
          if(ref){
            if(!finite(ref.elapsedMs)||ref.elapsedMs>at-source.capturedAt)throw Error('Refinement elapsed exceeds source-to-dispatch interval');
            const sessionRoot=fs.realpathSync(path.resolve(reader.root,options.evidenceDir));
            for(const key of ['path','rawPath','ocrPath']){
              const relative=path.relative(sessionRoot,reader.file(ref[key]));
              if(!path.isAbsolute(ref[key])||!relative||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Refinement must be saved within this session');
            }
          }
          const known=await inspect(source,attempt,s.stageId);
          if(known?.state!==(s===navigation?'home':'landing')||!equal(known.action,tap.proposal.action)
            ||!equal(attempt.provenance,known.provenance)||!navigationWitnessMatches(attempt,known)||arrival.id===source.id||arrival.capturedAt<=source.capturedAt)
            throw Error('Actual navigation tap differs from owning stage full source page contract');
        }else if(!allowed.includes((await inspect(frames[0],undefined,s.stageId))?.state??''))throw Error('No navigation action or initial stage arrival');
      }
    return true;
  }catch{return false;}
}

export type AuditBlocker = {code:string;file:string;detail:string};
export type ScriptAttempt = {runId:number|null;evidenceDir:string;sessionId:string|null;taskAttemptId:string|null;qualified:boolean;fingerprint:string|null;blockers:AuditBlocker[];notes:string[];modelCalls:number|null;tokens:number|null;scriptSources:{originalPath:string;archivePath:string;sha256:string}[]};
export type ScriptTaskAudit = {name:string;instruction:string;state:'candidate'|'stable';historicalSuccessCount:number;historicalSuccessRunIds:number[];attemptCount:number;qualifyingSessionCount:number;fingerprints:{fingerprint:string;sessionIds:string[]}[];attempts:ScriptAttempt[];blockers:AuditBlocker[]};
const sha = (s:string|Buffer) => createHash('sha256').update(s).digest('hex');
const finite = (n:any):n is number => typeof n==='number'&&Number.isFinite(n);
const text = (s:any):s is string => typeof s==='string'&&!!s.trim();
const canonical = (v:any):string => JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const equal = (a:any,b:any) => canonical(a)===canonical(b);
const identity = (t:any) => JSON.stringify([t?.name,t?.instruction]);
const scopeKeys = ['appId','accountId','activityId'] as const;
const normalStages = ['open_app','enter_activity','open_list','collect_list','select_task','open_task','task_receipt','return_list','settle','review_task'];
const coreFiles = ['main.ts','runtime.ts','engine.ts','device.ts','session.ts','observations.ts','contracts.ts','config.ts','continuation.ts','browse-revalidation.ts','source-archive.ts'].map(f=>'runner/staged/'+f);

function receiptVisible(frame:any,quote:any,quality?:ImmersiveOcrQuality) {
  if(!text(quote))return false;
  if(quality) {
    const matches=quality.rawLines.map((line,i)=>({line,i})).filter(({line})=>line.text.includes(quote));
    return matches.length===1&&quality.validIndices.includes(matches[0].i);
  }
  // Dwell checker joins these three lines from one reward component. Preserve
  // exact text and spatial order; whole-frame concatenation loses ownership.
  if(/^\+\d+ 任务已完成 继续逛逛吧$/.test(quote)) {
    if(frame?.width!==1080||frame?.height!==2400)return false;
    const lines=quote.split(' ').map(value=>{
      const matches=frame.lines.filter((line:any)=>line.text===value);
      if(matches.length!==1)return null;
      const line=matches[0],b=line.bounds;
      return Array.isArray(b)&&b.length===4&&b.every(finite)&&b[0]>=890&&b[2]<=1050&&b[1]>=1680&&b[3]<=1918&&b[0]<b[2]&&b[1]<b[3]?line:null;
    });
    return lines.every(Boolean)&&lines.every((line:any,i:number)=>i===0||line.bounds[1]>lines[i-1].bounds[1]&&line.bounds[3]>lines[i-1].bounds[3]);
  }
  return frame?.lines.some((line:any)=>typeof line.text==='string'&&line.text.includes(quote))??false;
}

/** Read-only replay: mutable documents use storage; evidence/code hashes use raw files. */
class EvidenceReader {
  constructor(readonly root:string) {}
  file(file:string) {
    if(!text(file))throw Error('Empty evidence path');
    const resolved=fs.realpathSync(path.resolve(this.root,file)),rel=path.relative(this.root,resolved);
    if(!rel||rel==='..'||rel.startsWith('..'+path.sep))throw Error('Evidence escapes project root: '+file);
    if(!fs.statSync(resolved).isFile())throw Error('Not a file: '+file);
    return resolved;
  }
  json(file:string):any {return readStructured(this.root,file);}
  bytes(file:string) {return fs.readFileSync(this.file(file));}
  relative(file:string) {return path.relative(this.root,this.file(file));}
}
// Source references in a matched contract affect behavior; sourceRunId is provenance only.
function contractSources(cfg:any):string[] {
  const found=new Set<string>();
  const walk=(v:any)=>{
    if(!v||typeof v!=='object')return;
    for(const [key,value] of Object.entries(v)) {
      if((/^(contractSource|contractFile|checkerFile|scriptFile|sourcePath)$/.test(key)||key==='source')&&text(value)&&/\.(?:[cm]?[jt]s|json)$/.test(value))found.add(value);
      else walk(value);
    }
  };
  walk(cfg);return [...found].sort();
}
function matchedConfig(cfg:any,task:any) {
  return {...cfg,
    dwellBrowse:cfg?.dwellBrowse?{...cfg.dwellBrowse,contracts:(cfg.dwellBrowse.contracts??[]).filter((c:any)=>identity(c.task)===identity(task))}:undefined,
    immersiveBrowse:cfg?.immersiveBrowse&&identity(cfg.immersiveBrowse.task)===identity(task)?cfg.immersiveBrowse:undefined};
}
function implementationConfig(cfg:any,task:any) {
  cfg=matchedConfig(cfg,task);
  const omitProvenance=(v:any):any => Array.isArray(v)?v.map(omitProvenance):v&&typeof v==='object'
    ?Object.fromEntries(Object.entries(v).filter(([k])=>!['sourceRunId','sourceRunIds','done','total','accountId','userId','planFile','evidenceRoot'].includes(k)).map(([k,x])=>[k,omitProvenance(x)])):v;
  return omitProvenance({selectionPolicy:cfg?.selectionPolicy,taskCompletionPolicy:cfg?.taskCompletionPolicy,taskObservationPolicy:cfg?.taskObservationPolicy,panelReadPolicy:cfg?.panelReadPolicy,aiTaskRecovery:cfg?.aiTaskRecovery,aiPanelReader:cfg?.aiPanelReader,localLaunch:cfg?.localLaunch,localActivityNavigation:cfg?.localActivityNavigation,navigationPolicy:cfg?.navigationPolicy,entryRecovery:cfg?.entryRecovery,balanceComponent:cfg?.balanceComponent,package:cfg?.package,assetId:cfg?.assetId,panelMarker:cfg?.panelMarker,limits:cfg?.limits,constraints:cfg?.constraints,stages:cfg?.stages,learnedBrowse:cfg?.learnedBrowse,dwellBrowse:cfg?.dwellBrowse,immersiveBrowse:cfg?.immersiveBrowse,scriptValidationMode:cfg?.scriptValidationMode,contracts:cfg?.contracts,taskPolicy:cfg?.taskPolicy});
}

async function inspectAttempt(reader:EvidenceReader,e:any,task:any,scope:any,knowledge:any,stageIndex:any):Promise<ScriptAttempt> {
  const a:ScriptAttempt={runId:Number.isSafeInteger(e.runId)?e.runId:null,evidenceDir:text(e.evidenceDir)?e.evidenceDir:'',sessionId:null,taskAttemptId:null,qualified:false,fingerprint:null,blockers:[],notes:[],modelCalls:null,tokens:null,scriptSources:[]};
  const fail=(code:string,file:string,detail:string)=>{if(!a.blockers.some(b=>b.code===code&&b.file===file&&b.detail===detail))a.blockers.push({code,file,detail});};
  const file=(name:string)=>path.join(a.evidenceDir,name);
  const get=(name:string):any=>{
    try {if(!a.evidenceDir)throw Error('Missing execution evidenceDir');return reader.json(file(name));}
    catch(error:any){fail('missing_file',file(name),String(error.message));return null;}
  };
  const session=get('session.json'),cfg=get('config.json'),final=get('final.json'),result=get('result.json'),stages=get('stages.json'),usage=get('usage.json'),cleanup=get('cleanup.json'),state=get('session-state.json');
  const scopeOK=(s:any,full=false)=>scopeKeys.every(k=>text(s?.[k])&&s[k]===scope[k])&&(!full||Number.isSafeInteger(s?.userId)&&s.userId>=0&&s.userId===scope.userId);
  if(!scopeOK(e.scope)||!scopeOK(e.auditSnapshotScope)||!scopeOK(task.scope))fail('scope_mismatch',file('result.json'),'Execution/task/snapshot scope does not match account bundle');
  for(const key of ['status','taskAttemptId','task','receipt','balanceBefore','balanceAfter','gainCoins','runId','sessionId'])if(!equal(e.result?.[key],result?.[key]))fail('v2_evidence_conflict',file('result.json'),'V2 execution result differs from raw result: '+key);
  if(!scopeOK(session?.scope,true)||!scopeOK(cfg?.scope,true))fail('scope_mismatch',file('session.json'),'Session/config app, account, activity and Android user must match bundle');
  if(!text(session?.id))fail('session_identity',file('session.json'),'Missing session id');else a.sessionId=session.id;
  if(typeof session?.startedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(session.startedAt)||!finite(Date.parse(session.startedAt)))fail('invalid_date',file('session.json'),'Missing or invalid session startedAt');
  try {if(reader.relative(session?.evidenceDir) !== reader.relative(a.evidenceDir))throw Error('mismatch');}catch {
    // Directories are not files, but must resolve to this exact execution directory.
    try {if(!text(session?.evidenceDir)||fs.realpathSync(path.resolve(reader.root,session.evidenceDir))!==fs.realpathSync(path.resolve(reader.root,a.evidenceDir)))throw Error('mismatch');}
    catch{fail('session_directory',file('session.json'),'Session evidence directory mismatch');}
  }
  try{validateStagedConfig(cfg);}catch(error:any){fail('invalid_config',file('config.json'),String(error.message));}
  if(cfg?.package!==knowledge?.application?.package)fail('scope_mismatch',file('config.json'),'Config package must match knowledge application');
  if(session?.resume||result?.recoveredAfterError||result?.sourceRunId||final?.recoveredAfterError)fail('non_normal_entry',file('session.json'),'Continuation/recovery cannot count as an independent normal session');
  if(!text(session?.configFile))fail('config_source_missing',file('session.json'),'Normal main entry requires configFile and its archived source');
  for(const [name,value] of [['final.json',final],['result.json',result]] as const) {
    if(value?.status!=='completed'||value?.error)fail('not_completed',file(name),'Requires completed status without execution error');
    if(identity(value?.task)!==identity(task))fail('task_mismatch',file(name),'Exact task name and instruction differ from v2 task identity');
    if(value?.runId!==a.runId||a.runId===null)fail('run_mismatch',file(name),'Run id missing or differs from v2 execution');
  }
  if(result?.sessionId!==session?.id||!text(result?.sessionId))fail('session_identity',file('result.json'),'Result sessionId differs from session');
  for(const key of ['taskAttemptId','task','receipt','balanceBefore','balanceAfter'])if(!equal(final?.[key],result?.[key]))fail('result_conflict',file('final.json'),'final/result disagree: '+key);
  if(!equal(final?.stages,stages))fail('stages_conflict',file('final.json'),'final.stages must equal actual stages.json');
  if(result?.learningValidation)a.notes.push('learningValidation='+result.learningValidation+' (informational)');
  a.taskAttemptId=text(result?.taskAttemptId)?result.taskAttemptId:null;
  const gain=finite(result?.balanceBefore)&&result.balanceBefore>0&&finite(result?.balanceAfter)?result.balanceAfter-result.balanceBefore:null;
  if(!finite(gain)||gain<=0||result?.gainCoins!==gain)fail('positive_gain_missing',file('result.json'),'Positive finite actual balance delta must equal archived gainCoins');
  const archived=state?.archived;
  if(archived?.runId!==a.runId||archived?.gainCoins!==gain||archived?.v2Archived!==true||archived?.partial!==false||!Array.isArray(archived?.issues)||archived.issues.length)fail('archive_incomplete',file('session-state.json'),'Requires successful real archive, v2Archived, no partial result/issues');
  if(!equal(cleanup,final?.cleanup)||!Array.isArray(cleanup?.errors)||cleanup.errors.length||typeof cleanup?.power!=='string'||!/(?:^|\n)\s*mWakefulness=(?:Dozing|Asleep)\s*(?:\n|$)/.test(cleanup.power))fail('cleanup_unverified',file('cleanup.json'),'Requires matching final cleanup, power readback Dozing/Asleep and errors []');
  // [] is the native VisionClient zero-call log. A nonempty log needs explicit finite counters.
  const rows=Array.isArray(usage)?usage:usage&&typeof usage==='object'?[usage]:null;
  if(!rows)fail('usage_unknown',file('usage.json'),'Usage missing/null is not zero usage');
  else {
    let calls=0,tokens=0,known=true,nonzero=false;
    for(const row of rows) {
      const cs=['calls','modelCalls','model_calls'].filter(k=>Object.hasOwn(row??{},k)).map(k=>row[k]);
      const ts=['tokens','totalTokens','total_tokens'].filter(k=>Object.hasOwn(row??{},k)).map(k=>row[k]);
      if(!cs.length||!ts.length||[...cs,...ts].some(n=>!finite(n)||n<0)||cs.some(n=>n!==cs[0])||ts.some(n=>n!==ts[0]))known=false;
      calls+=cs[0]??0;tokens+=ts[0]??0;
      for(const [k,v] of Object.entries(row??{}))if(/tokens|calls/i.test(k)) {if(!finite(v)||v<0)known=false;else if(v>0)nonzero=true;}
    }
    if(known){a.modelCalls=calls;a.tokens=tokens;}
    if(!known)fail('usage_unknown',file('usage.json'),'Model/token counters missing, null, negative or ambiguous');
    if(nonzero||calls>0||tokens>0)fail('model_usage',file('usage.json'),'Whole-session zero-model policy: calls='+calls+', tokens='+tokens);
  }
  let runtime:any[]=[];
  try{runtime=reader.bytes(file('runtime.jsonl')).toString().split('\n').filter(s=>s.trim()).map(s=>JSON.parse(s));}
  catch(error:any){fail('runtime_missing',file('runtime.jsonl'),String(error.message));}
  if(runtime.some(x=>['agent_result','ai_task_destination_confirmed','ai_task_receipt'].includes(x.kind)||/agent_error|human|supervised|manual/.test(x.kind??'')))fail('non_script_runtime',file('runtime.jsonl'),'Model/manual/recovery evidence present in runtime');
  if(!Array.isArray(stages)||!equal(stages.map((s:any)=>s?.stageId),normalStages))fail('non_normal_stages',file('stages.json'),'Requires complete ordered main session stages, no continuation or duplicate stages');
  const stage=(id:string)=>(Array.isArray(stages)?stages:[]).find((s:any)=>s.stageId===id);
  const observed=(s:any)=>(s?.events??[]).filter((v:any)=>v.type==='observed').map((v:any)=>v.frame);
  const frame=(f:any,context:string):any=>{
    try {
      if(!text(f?.id)||!text(f?.path)||!finite(f?.capturedAt)||f.capturedAt<Date.parse(session?.startedAt)||f.package!==cfg?.package||f.userId!==scope.userId||!Array.isArray(f.lines))throw Error('Frame identity/date/scope missing or conflicting');
      reader.file(f.path);
      if(f.balanceEvidence?.ocrEvidence) {
        reader.file(f.balanceEvidence.ocrEvidence.path);
        reader.file(f.balanceEvidence.ocrEvidence.cropPath);
      }
      const raw=reader.json(f.path.replace(/\.png$/,'.json'));
      if(!equal(raw,f))throw Error('Recorded frame differs from raw captured frame');
      return f;
    }catch(error:any){fail('frame_unverified',context,String(error.message));return null;}
  };
  for(const s of Array.isArray(stages)?stages:[]) {
    if(s.status!=='completed'||s.error)fail('stage_not_completed',file('stages.json'),s.stageId+': '+(s.error??s.status));
    if(s.sessionId!==undefined&&s.sessionId!==session?.id||s.scope!==undefined&&!scopeOK(s.scope,true))fail('scope_mismatch',file('stages.json'),s.stageId+': explicit stage scope/session mismatch');
    if(s.actions!==undefined&&!Array.isArray(s.actions))fail('actions_unknown',file('stages.json'),s.stageId+': malformed actions');
    for(const action of Array.isArray(s.actions)?s.actions:[]) {
      if(action.source!=='script'||action.status!=='verified'||!action.proposal?.action||action.error)fail('non_script_action',file('stages.json'),s.stageId+': requires actual verified script action with known source');
      if(!text(s.usedScriptVersion))fail('script_version_missing',file('stages.json'),s.stageId+': missing usedScriptVersion');
    }
    for(const event of s.events??[])if(/unknown|agent_error|action_unverified|script_error|stage_error/.test(event.type??''))fail('unsafe_stage_event',file('stages.json'),s.stageId+': '+event.type);
  }
  const dwellContracts=matchedConfig(cfg,task)?.dwellBrowse?.contracts??[];
  const immersive=matchedConfig(cfg,task)?.immersiveBrowse;
  const local=immersive?.enabled===true?immersive:dwellContracts.length===1?{...cfg?.dwellBrowse,sourceRunId:cfg?.learnedBrowse?.sourceRunId}:cfg?.learnedBrowse;
  const receipt=result?.receipt;
  if(cfg?.executionPolicy==='development-unbounded-v1')fail('development_execution',file('config.json'),'Development execution disables artificial budgets; this run is not zero-model stable validation');
  const keywordPolicy=cfg?.taskCompletionPolicy==='current-keywords-v1'&&cfg?.taskObservationPolicy==='current-components-v1';
  const keywordReceipt=keywordPolicy&&receipt?.version==='current-keywords-v1';
  for(const id of ['open_task','task_receipt']) {
    if(id==='task_receipt'&&keywordReceipt&&(stage(id)?.actions??[]).length===0)continue;
    const s=stage(id);
    if(!text(s?.usedScriptVersion))fail('script_version_missing',file('stages.json'),id+': missing usedScriptVersion');
    if(!runtime.some(x=>x.kind==='explicit_candidate_authorized'&&x.stageId===id&&x.version===s?.usedScriptVersion&&cfg?.learnedBrowse?.enabled===true&&x.version===local?.version&&x.sourceRunId===local?.sourceRunId))fail('local_authorization_missing',file('runtime.jsonl'),id+': requires real config-bound local script authorization');
  }
  const open=stage('open_task'),receiptStage=stage('task_receipt'),returned=stage('return_list');
  const recoveryEvents=runtime.filter(x=>typeof x.kind==='string'&&x.kind.startsWith('entry_recovery_'));
  const recoveryProof=recoveryEvents.length?await verifyAuditEntryRecovery({root:reader.root,evidenceDir:a.evidenceDir,config:cfg,
    stages:Array.isArray(stages)?stages:[],runtime,sessionId:a.sessionId!,taskAttemptId:a.taskAttemptId!}):null;
  if(recoveryEvents.length&&!recoveryProof)fail('entry_recovery_unverified',file('runtime.jsonl'),'Complete durable source-bound recovery and fresh arrival not independently proven');
  if(cfg?.localActivityNavigation===true&&!await verifyAuditNavigationStages({root:reader.root,evidenceDir:a.evidenceDir,config:cfg,
    stages:Array.isArray(stages)?stages:[],runtime,sessionId:a.sessionId!,taskAttemptId:a.taskAttemptId!}))
    fail('activity_navigation_unverified',file('stages.json'),'Original stage navigation and independently bounded prelude are not proven');
  const currentComponents=cfg?.taskObservationPolicy==='current-components-v1';
  const autoCurrent=currentComponents&&cfg?.learnedBrowse?.autoContract===true&&!immersive?.enabled&&!dwellContracts.length;
  if(currentComponents)for(const s of Array.isArray(stages)?stages:[])for(const f of auditStageFrames(s))frame(f,file('stages.json'));
  if(currentComponents&&immersive?.enabled&&(immersive.ocrQuality===true||immersive.rewardTransitions?.length))
    fail('current_policy_unsupported',file('config.json'),'Current immersive OCR quality/reward transitions remain legacy independent paths; this combination is not migrated');
  for(const event of currentComponents&&!autoCurrent?runtime.filter(x=>x.kind==='learned_destination_confirmed'):[]){
    const source=observed(open).find((f:any)=>f.id===event.frameId);
    const proof=source&&await verifyAuditTaskComponent({root:reader.root,frame:source,config:cfg,stageId:'open_task',task});
    if(event.taskAttemptId!==a.taskAttemptId||!proof||event.version!==proof.inspection.version||event.state!==proof.inspection.state
      ||event.rewardCoins!==('rewardCoins' in proof.inspection?proof.inspection.rewardCoins:undefined))
      fail('task_component_unverified',file('runtime.jsonl'),'Destination policy/version/state/task attempt differs from current source component');
  }
  const entries=(open?.actions??[]).filter((x:any)=>x.source==='script'&&x.status==='verified'&&x.proposal?.action?.type==='tap');
  const auditPanel=(f:any,stageId:string)=>cfg?.panelReadPolicy==='focused-v1'
    ?verifyAuditFocusedPanel({root:reader.root,frame:f,config:cfg,stageId,task:result?.task})
    :readPanel(f,cfg?.panelMarker);
  if(cfg?.panelReadPolicy==='focused-v1')for(const id of ['collect_list','select_task'])for(const f of observed(stage(id)))
    if(!verifyAuditFocusedPanel({root:reader.root,frame:f,config:cfg,stageId:id,task:result?.task}))
      fail('focused_panel_unverified',file('stages.json'),'Inventory/selection requires full saved panel evidence, never a partial status read: '+id);
  let bound=false;
  const selectedEntry=(open?.events??[]).some((e:any)=>e.type==='before_dispatch_revalidated')&&cfg?.panelReadPolicy==='focused-v1'&&keywordPolicy
    ?await verifyAuditSelectedEntry({root:reader.root,stage:open,config:cfg,task:result?.task,taskAttemptId:a.taskAttemptId!}):null;
  for(const entry of entries) {
    const before=auditStageFrames(open).find((f:any)=>f.id===entry.proposal.frameId);
    if(!frame(before,file('stages.json')))continue;
    const rows=(selectedEntry&&selectedEntry.frame.id===before.id?[selectedEntry.row]:auditPanel(before,'open_task')?.tasks??[]).filter(t=>identity(t)===identity(task));
    const row=rows[0],action=entry.proposal.action;
    if(rows.length!==1||!row.point||row.done>=row.total||Math.hypot(row.point[0]-action.x,row.point[1]-action.y)>75)continue;
    if(!runtime.some(x=>x.kind==='learned_entry_dispatched'&&x.taskAttemptId===a.taskAttemptId&&identity(x)===identity(task)&&x.sourceFrameId===before.id&&x.dispatched===true))continue;
    bound=true;
  }
  if(!bound)fail('actual_entry_missing',file('stages.json'),'No actual script tap uniquely bound to current task row and dispatched attempt');
  if(!keywordReceipt&&!(receiptStage?.actions??[]).some((x:any)=>x.source==='script'&&x.status==='verified'&&['swipe','wait','tap'].includes(x.proposal?.action?.type)))fail('task_script_action_missing',file('stages.json'),'Task execution has no actual verified script action');
  // Validate every submitted event, including orphaned/duplicate/wrong-stage events.
  const qualityProofs=new Map<string,NonNullable<Awaited<ReturnType<typeof verifyAuditImmersiveOcrQuality>>>>();
  const qualityKey=(stageId:string,frameId:string,amount:number)=>JSON.stringify([stageId,frameId,amount]);
  for(const event of runtime.filter(x=>x.kind==='immersive_ocr_quality')) {
    const proof=await verifyAuditImmersiveOcrQuality({root:reader.root,evidenceDir:a.evidenceDir,config:cfg,stages,
      runtime,taskAttemptId:a.taskAttemptId!,task,stageId:event.stageId,frameId:event.frameId,rewardCoins:event.rewardCoins});
    if(!proof)fail('immersive_ocr_quality_unverified',file('runtime.jsonl'),'Quality source, complete derivation or stage/entry/attempt binding not independently proven');
    else qualityProofs.set(qualityKey(event.stageId,event.frameId,event.rewardCoins),proof);
  }
  const qualityFor=(stageId:string,f:any,amount:number)=>qualityProofs.get(qualityKey(stageId,f?.id,amount))?.quality;
  const rawLines=(stageId:string,f:any,amount:number)=>qualityFor(stageId,f,amount)?.rawLines??f?.lines??[];
  const verifyInspector=async(stageId:string,f:any,amount:number)=>{
    if(!frame(f,file('stages.json')))return null;
    const quality=qualityFor(stageId,f,amount);
    if(f.observationError&&!quality)return null;
    return inspectImmersiveBrowse(f,{package:cfg.package,userId:scope.userId},{rewardCoins:amount},quality);
  };
  if(currentComponents){
    const receipts=runtime.filter(x=>x.kind==='learned_receipt');
    const fields=['taskAttemptId','frameId','path','quote','version','rewardCoins','requirementRewardCoins','rewardTransitionVersion'];
    if(receipts.length!==1||fields.some(key=>!equal(receipts[0]?.[key],receipt?.[key]))||receipts[0]?.sourceRunId!==local?.sourceRunId)
      fail('receipt_unverified',file('runtime.jsonl'),'Current component receipt requires one exact source/version/amount/attempt-bound runtime event');
  }
  if(currentComponents&&!keywordReceipt&&immersive?.enabled){
    const amounts=runtime.filter(x=>x.kind==='learned_destination_confirmed'&&x.taskAttemptId===a.taskAttemptId).map(x=>x.rewardCoins);
    if(!amounts.length||amounts.some(n=>n!==receipt?.rewardCoins)||receipt?.rewardTransitionVersion||receipt?.requirementRewardCoins!==undefined)
      fail('current_policy_unsupported',file('result.json'),'Current immersive completion must retain the pinned amount; reward transitions require the independently supported legacy policy');
  }
  if(cfg?.learnedBrowse?.autoContract===true&&!immersive?.enabled&&!dwellContracts.length) {
    try {
      const api=await import('./continuous-contract.ts');
      const chosen=runtime.filter(x=>x.kind==='continuous_contract_selected'&&x.taskAttemptId===a.taskAttemptId);
      if(chosen.length!==1)throw Error('Requires one same-attempt contract selection');
      const event=chosen[0],initial=observed(open).find((f:any)=>f.id===event.frameId);
      if(!frame(initial,file('stages.json'))||!bound)throw Error('Selection lacks original entered destination');
      const owner={package:cfg.package,userId:scope.userId};
      const localFrame=(f:any)=>({...f,path:reader.file(f.path)});
      const selectedProof=await verifyAuditTaskComponent({root:reader.root,frame:localFrame(initial),config:cfg,stageId:'open_task',task});
      const selected=selectedProof?.selectedContract;
      if(!selected||!equal(event.option,selected.option)||!equal(event.budget,selected.budget)||!equal(event.provenance,selected.provenance))throw Error('Selection differs from full original page contract and verified source');
      if(currentComponents)for(const destination of runtime.filter(x=>x.kind==='learned_destination_confirmed')){
        const source=observed(open).find((f:any)=>f.id===destination.frameId);
        const proof=source&&await verifyAuditTaskComponent({root:reader.root,frame:localFrame(source),config:cfg,stageId:'open_task',task,selectedContract:selected});
        if(destination.taskAttemptId!==a.taskAttemptId||!proof||proof.inspection.version!==destination.version||proof.inspection.state!==destination.state
          ||!('rewardCoins' in proof.inspection)||proof.inspection.rewardCoins!==destination.rewardCoins)throw Error('Destination differs from the once-selected current contract');
      }
      if(keywordReceipt){
        const completed=observed(receiptStage).find((f:any)=>f.id===receipt?.frameId&&f.path===receipt?.path);
        const checked=completed&&verifyAuditKeywordReceipt({root:reader.root,frame:completed,config:cfg});
        if(!bound||checked?.quote!==receipt.quote||completed.capturedAt<initial.capturedAt)throw Error('Current receipt not proven after the owning destination');
      }else{
      const scrolls=runtime.filter(x=>x.kind==='continuous_scroll_started'),finished=runtime.filter(x=>x.kind==='continuous_scroll_finished');
      const actions=(receiptStage?.actions??[]).filter((x:any)=>x.source==='script'&&x.status==='verified'&&x.proposal?.action?.type==='swipe');
      if(scrolls.length!==1||finished.length!==1||actions.length!==1||!equal(scrolls[0].limits,selected.budget)||scrolls[0].sourceFrameId!==finished[0].sourceFrameId||scrolls[0].sourceFrameId!==actions[0].proposal.frameId||!equal(scrolls[0].action,actions[0].proposal.action))throw Error('Actual continuous segment differs from selected budget/action');
      const freshEvent=(receiptStage?.events??[]).filter((e:any)=>e.type==='before_dispatch_revalidated'&&e.newFrameId===scrolls[0].sourceFrameId&&e.frame?.id===e.newFrameId&&e.proposal?.frameId===e.newFrameId&&equal(e.proposal.action,scrolls[0].action));
      const fresh=observed(receiptStage).find((f:any)=>f.id===scrolls[0].sourceFrameId)??(freshEvent.length===1?freshEvent[0].frame:null);
      if(!frame(fresh,file('stages.json')))throw Error('Missing original swipe frame');
      const verified=cfg.taskObservationPolicy==='current-components-v1'
        ?await(await import('./browse-revalidation.ts')).revalidateBrowseSwipe(localFrame(initial),localFrame(fresh),scrolls[0].action,owner,{policy:'current-components-v1',selectedContract:selected})
        :await(await import('./learned-browse.ts')).revalidateLearnedBrowse(localFrame(initial),localFrame(fresh),scrolls[0].action,owner,selected.option);
      if(!verified||!equal(verified.action,scrolls[0].action))throw Error('Selected contract did not revalidate the actual swipe');
      const completed=observed(receiptStage).find((f:any)=>f.id===receipt?.frameId&&f.path===receipt?.path);
      if(!frame(completed,file('stages.json')))throw Error('Missing original completion frame');
      const checked=await verifyAuditTaskComponent({root:reader.root,frame:localFrame(completed),config:cfg,stageId:'task_receipt',task,selectedContract:selected});
      if(checked?.inspection?.state!=='completed'||currentComponents&&checked.inspection.version!==receipt.version||!('rewardCoins' in checked.inspection)||checked.inspection.rewardCoins!==receipt.rewardCoins||checked.inspection.quote!==receipt.quote||completed.capturedAt<=fresh.capturedAt)throw Error('Completion is not proven under original selected contract');
      }
    } catch(error:any) {fail('continuous_contract_unverified',file('runtime.jsonl'),String(error.message));}
  }
  if(!a.taskAttemptId||receipt?.taskAttemptId!==a.taskAttemptId||!text(receipt?.frameId)||!text(receipt?.quote)||!equal(receiptStage?.receipt,receipt))fail('receipt_unverified',file('result.json'),'Receipt must match actual stage and current attempt');
  const rf=observed(receiptStage).find((f:any)=>f.id===receipt?.frameId&&f.path===receipt?.path);
  if(!frame(rf,file('stages.json'))||!currentComponents&&!receiptVisible(rf,receipt?.quote,qualityFor('task_receipt',rf,receipt?.rewardCoins))||!runtime.some(x=>x.kind==='learned_receipt'&&x.taskAttemptId===a.taskAttemptId&&x.frameId===receipt?.frameId&&x.quote===receipt?.quote))fail('receipt_unverified',file('runtime.jsonl'),'Receipt must be visible in actual raw frame and locally recorded');
  if(currentComponents&&!autoCurrent){
    const proof=rf&&await verifyAuditTaskComponent({root:reader.root,frame:rf,config:cfg,stageId:'task_receipt',task});
    if(!proof||proof.inspection.state!=='completed'||proof.inspection.version!==receipt?.version||proof.inspection.quote!==receipt?.quote
      ||('rewardCoins' in proof.inspection&&proof.inspection.rewardCoins!==receipt?.rewardCoins))
      fail('task_component_unverified',file('result.json'),'Completion must replay under the selected current component policy and inspection version');
  }
  if(!currentComponents&&immersive?.enabled===true&&immersive.version==='immersive-browse-candidate-v2') {
    const amount=receipt?.rewardCoins,allowed=immersive.allowedRewardCoins;
    const normalized=(s:any)=>typeof s==='string'?s.normalize('NFKC').replace(/\s+/g,''):'';
    const completionLines=rawLines('task_receipt',rf,amount).filter((line:any)=>/已得/.test(normalized(line.text)));
    const pinned=runtime.filter(x=>x.kind==='learned_destination_confirmed'&&x.taskAttemptId===a.taskAttemptId&&x.state==='browsing');
    const pinnedFrame=(x:any)=>observed(open).find((f:any)=>f.id===x.frameId);
    const transitions=immersive.rewardTransitions;
    let transitionOK=false;
    if(amount===35&&(receipt?.rewardTransitionVersion||pinned.some(x=>x.rewardCoins===20))&&Array.isArray(transitions)&&transitions.length===1&&pinned.length===1) {
      const contract=transitions[0],browse=pinnedFrame(pinned[0]);
      const changes=runtime.filter(x=>x.kind==='immersive_reward_transition'&&x.taskAttemptId===a.taskAttemptId);
      const change=changes[0],events=receiptStage?.events??[],actions=receiptStage?.actions??[];
      const start=events.findIndex((e:any)=>e.type==='observed'&&e.frame?.id===browse?.id);
      const end=events.findIndex((e:any)=>e.type==='observed'&&e.frame?.id===rf?.id);
      let waitMs=0,waitsOK=start>=0&&end>start&&equal(events[start]?.frame,browse)&&equal(events[end]?.frame,rf);
      const waitFrameIds=new Set<string>();
      for(let i=0;i<actions.length;i++) {
        const action=actions[i];
        if(action.proposal?.action?.type!=='wait'){waitsOK=false;continue;}
        const ms=action.proposal.action.ms;
        const dispatches=events.map((e:any,j:number)=>({e,j})).filter(({e}:any)=>e.type==='authority_consumed'&&e.actionAttempt===i+1&&e.frameId===action.proposal.frameId);
        const source=events.findIndex((e:any)=>e.type==='observed'&&e.frame?.id===action.proposal.frameId);
        if(action.source!=='script'||action.status!=='verified'||action.error||!Number.isSafeInteger(ms)||ms<=0
          ||dispatches.length!==1||source<start||source>=end||dispatches[0].j<=source||dispatches[0].j>=end
          ||!finite(dispatches[0].e.at)||dispatches[0].e.at<events[source]?.frame?.capturedAt||dispatches[0].e.at>=rf?.capturedAt
          ||waitFrameIds.has(action.proposal.frameId)||!frame(events[source]?.frame,file('stages.json')))waitsOK=false;
        else {waitMs+=ms;waitFrameIds.add(action.proposal.frameId);}
      }
      const entryFrames=entries.map((entry:any)=>observed(open).find((f:any)=>f.id===entry.proposal.frameId));
      try {
        // Resolve every source inside this audit root before the pure local verifier reads it.
        for(const source of contract.files??[])reader.file(source.path);
        transitionOK=bound&&!!frame(browse,file('stages.json'))&&!!rf&&browse.id!==rf.id&&browse.path!==rf.path
          &&entryFrames.some((f:any)=>f&&f.id!==browse.id&&f.id!==rf.id&&f.capturedAt<browse.capturedAt)
          &&changes.length===1&&change.fromRewardCoins===20&&change.toRewardCoins===35
          &&change.browseFrameId===browse.id&&change.receiptFrameId===rf.id&&change.version===contract.version
          &&change.waitMs===waitMs&&waitsOK&&waitMs>0&&waitMs<=20000
          &&receipt.requirementRewardCoins===20&&receipt.rewardTransitionVersion===contract.version
          &&await verifyImmersiveTransition(contract,{taskAttemptId:a.taskAttemptId!,entryDispatched:bound,
            browseFrame:{...browse,path:reader.file(browse.path)},receiptFrame:{...rf,path:reader.file(rf.path)},
            browseRewardCoins:pinned[0].rewardCoins,receiptRewardCoins:amount,waitMs});
      }catch{transitionOK=false;}
      if(!transitionOK)fail('reward_transition_unverified',file('runtime.jsonl'),'Requires exact original 184 source chain and current attempt entry, ordered distinct frames, dispatched positive waits and version-bound 20 to 35 event');
    }
    const replayResults=new Map<any,any>();
    if(immersive.ocrQuality===true) {
      const waits=(receiptStage?.actions??[]),slices=runtime.filter(x=>x.kind==='dwell_wait_slice'&&x.taskAttemptId===a.taskAttemptId);
      let total=0,waitsOK=waits.length===slices.length;
      const seen=new Set<string>();
      for(let i=0;i<waits.length;i++) {
        const action=waits[i],ms=action.proposal?.action?.ms,sourceId=action.proposal?.frameId,slice=slices[i];
        if(action.source!=='script'||action.status!=='verified'||action.error||action.proposal?.action?.type!=='wait'
          ||!Number.isSafeInteger(ms)||ms<=0||ms>3000||seen.has(sourceId))waitsOK=false;
        else {total+=ms;seen.add(sourceId);}
        if(!slice||slice.frameId!==sourceId||slice.ms!==ms||slice.slices!==i+1||slice.totalMs<total
          ||slice.limitMs!==immersive.observationBudgetMs||slice.totalMs>immersive.observationBudgetMs||slice.completionInferred!==false)waitsOK=false;
        const source=auditStageFrames(receiptStage).find(f=>f?.id===sourceId);
        const expected=pinned[0]?.rewardCoins??runtime.find(x=>x.kind==='immersive_ocr_quality'&&x.stageId==='task_receipt'&&x.frameId===sourceId)?.rewardCoins;
        if((await verifyInspector('task_receipt',source,expected))?.state!=='browsing')waitsOK=false;
      }
      if(total>immersive.observationBudgetMs||waits.length>8||!waitsOK)
        fail('immersive_wait_unverified',file('runtime.jsonl'),'Requires unique verified browsing waits, matching dispatched slices and original observation budget');
      for(const candidate of pinned)replayResults.set(candidate,await verifyInspector('open_task',pinnedFrame(candidate),candidate.rewardCoins));
      const completed=await verifyInspector('task_receipt',rf,amount);
      if([...replayResults].some(([candidate,inspection])=>inspection?.state!=='browsing'||inspection.rewardCoins!==candidate.rewardCoins)
        ||completed?.state!=='completed'||completed.rewardCoins!==amount||completed.quote!==receipt?.quote)
        fail('immersive_inspector_unverified',file('runtime.jsonl'),'Every pinned candidate and receipt must replay original pixels and full raw OCR under the same requirement');
    }
    const pinOK=pinned.length>0&&pinned.every(x=>{
      const f=pinnedFrame(x),expected=transitionOK?20:amount;
      return x.version===immersive.version&&x.rewardCoins===expected&&!!frame(f,file('stages.json'))
        &&!readPanel(f,cfg?.panelMarker).isPanel
        &&rawLines('open_task',f,expected).filter((line:any)=>/^得\d+$/.test(normalized(line.text))).length===1
        &&rawLines('open_task',f,expected).some((line:any)=>normalized(line.text)==='得'+expected);
    });
    const localReceipt=runtime.some(x=>x.kind==='learned_receipt'&&x.taskAttemptId===a.taskAttemptId
      &&x.frameId===receipt?.frameId&&x.path===receipt?.path&&x.quote===receipt?.quote
      &&x.version===immersive.version&&x.sourceRunId===immersive.sourceRunId&&x.rewardCoins===amount
      &&(!transitionOK||x.requirementRewardCoins===20&&x.rewardTransitionVersion===receipt.rewardTransitionVersion));
    if((!transitionOK&&(!Array.isArray(allowed)||!allowed.includes(amount)||(amount!==20&&amount!==35&&amount!==50)))
      ||receipt?.version!==immersive.version||normalized(receipt?.quote)!=='已得'+amount
      ||completionLines.length!==1||completionLines[0].text!==receipt?.quote||!pinOK||!localReceipt)
      fail('receipt_unverified',file('runtime.jsonl'),'Immersive v2 requires allowed visible completion amount, matching pinned browse observation, version and source-bound receipt');
  }
  if(!runtime.some(x=>x.kind==='learned_destination_confirmed'&&x.taskAttemptId===a.taskAttemptId&&observed(open).some((f:any)=>f.id===x.frameId&&f.package===cfg?.package&&f.userId===scope.userId&&!readPanel(f,cfg?.panelMarker).isPanel)))fail('destination_unverified',file('runtime.jsonl'),'Actual owning destination observation missing');
  if(!observed(returned).some((f:any)=>{const valid=frame(f,file('stages.json'));return valid&&auditPanel(valid,'return_list')?.isPanel;}))fail('return_unverified',file('stages.json'),'Requires observed owning activity panel after return');
  if(cfg?.balanceComponent===true) {
    try {
      const reference=result?.task?.beforeFrame;
      if(!text(reference?.path)||reference.ocrPath!==reference.path.replace(/\.png$/,'.json'))throw Error('Missing exact selection baseline frame');
      const raw=reader.json(reference.ocrPath),verified=frame(raw,file('stages.json'));
      if(!verified||raw.path!==reference.path||raw.id!==result.task.frameId
        ||!await verifyAuditBalanceComponent({root:reader.root,frame:verified,expectedValue:result.balanceBefore}))throw Error('Selection baseline component did not independently replay');
    }catch(error:any){fail('balance_baseline_unverified',file('stages.json'),String(error.message));}
  }
  const samples=stage('settle')?.review?.samples;
  if(cfg?.balanceComponent===true&&(!Array.isArray(samples)||samples.length<2))fail('balance_settlement_unverified',file('stages.json'),'Missing two component settlement samples');
  if(!Array.isArray(samples)||samples.length<2)fail('settlement_unverified',file('stages.json'),'Requires two actual stable owning-panel balance samples');
  else {
    const tail=samples.slice(-2);
    if(tail[0].frameId===tail[1].frameId)fail('settlement_unverified',file('stages.json'),'Repeated frame is not independent balance readback');
    for(const sample of tail) {
      try {
        const raw=reader.json(file(sample.frameId+'.json'));
        const verified=frame(raw,file('stages.json'));
        if(cfg?.balanceComponent===true&&(!verified||!await verifyAuditBalanceComponent({root:reader.root,frame:verified,expectedValue:result?.balanceAfter}))) {
          fail('balance_settlement_unverified',file('stages.json'),'Settlement sample component did not independently replay: '+sample.frameId);
          throw Error('Unverified balance component');
        }
        const panel=verified?auditPanel(verified,'settle'):null;
        if(cfg?.panelReadPolicy==='focused-v1'){
          const earlier=tail[0]===sample?rf:reader.json(file(tail[0].frameId+'.json'));
          if(!rf||!earlier||verified.id===rf.id||verified.path===rf.path||verified.capturedAt<=earlier.capturedAt
            ||tail[0]!==sample&&verified.path===earlier.path)throw Error('Focused settlement requires distinct ordered fresh captures after the same attempt receipt');
        }
        if(!panel?.isPanel||panel.blocked||panel.balance!==result?.balanceAfter||sample.balance!==panel.balance||sample.isPanel!==true)throw Error('Actual owning-panel readback does not match positive stable balance');
        const same=panel.tasks.filter(t=>identity(t)===identity(task));
        if(result.task.done+1<result.task.total&&same.length!==1)fail('remaining_quota_identity_unverified',file('stages.json'),'Task still has remaining quota; exact returned identity and advanced counter required for per-task stability');
        if(same.length>1||same.some(t=>t.done<=result.task.done||t.total!==result.task.total))throw Error('Task counter contradicts completion');
      }catch(error:any){fail('settlement_unverified',file('stages.json'),String(error.message));}
    }
  }
  // Only store-produced candidate source references bind archived bytes to a session.
  const sourceMap=new Map<string,{originalPath:string;archivePath:string;sha256:string}>();
  for(const item of stageIndex?.candidates??[]) {
    if(item.sessionId!==session?.id||item.runId!==a.runId)continue;
    try {
      const candidate=reader.json(item.path),script=candidate.candidateScript;
      if(!script)continue;
      if(candidate.scope?.appId!==scope.appId||candidate.scope.activityId!==undefined&&candidate.scope.activityId!==scope.activityId)throw Error('Candidate scope mismatch');
      const source=candidate.sources?.find((s:any)=>s.sessionId===a.sessionId&&s.runId===a.runId&&path.resolve(reader.root,s.evidenceDir)===path.resolve(reader.root,a.evidenceDir));
      const review=source&&reader.json(source.reviewFile)?.[source.reviewIndex];
      const declared=review?.review?.candidateScript??review?.candidateScript;
      if((typeof declared==='string'?declared:declared?.path)!==script.originalPath)throw Error('Source review does not bind original script');
      if(!/^[a-f0-9]{64}$/.test(script.fileSha256??''))throw Error('Missing/invalid source SHA256');
      const archive=reader.relative(script.path),expected='data/stage-records/script-sources/'+script.fileSha256;
      if(!archive.startsWith(expected+'.')||sha(reader.bytes(archive))!==script.fileSha256)throw Error('Archive path/content hash mismatch');
      const original=reader.relative(script.originalPath);
      const isConfig=text(session?.configFile)&&path.resolve(reader.root,session.configFile)===path.resolve(reader.root,original);
      if(isConfig) {
        const current=reader.json(original),archived=JSON.parse(reader.bytes(archive).toString('utf8'));
        if(!equal(implementationConfig(current,task),implementationConfig(archived,task)))throw Error('Current behavior config differs from archived config');
      } else if(sha(reader.bytes(original))!==script.fileSha256)throw Error('Current implementation differs from archived script');
      const prior=sourceMap.get(original);
      if(prior&&prior.sha256!==script.fileSha256)throw Error('Conflicting session source versions');
      sourceMap.set(original,{originalPath:original,archivePath:archive,sha256:script.fileSha256});
    }catch(error:any){fail('script_source_invalid',item.path,String(error.message));}
  }
  const verifyContractReferences=(value:any):void=>{
    if(!value||typeof value!=='object')return;
    for(const [key,v] of Object.entries(value)) {
      const hashKey=key==='path'?'sha256':key==='ocrPath'?'ocrSha256':key.endsWith('Path')?key.slice(0,-4)+'Sha256':null;
      if(hashKey&&text(v)) {
        const hash=value[hashKey];
        try {if(!/^[a-f0-9]{64}$/.test(hash??'')||sha(reader.bytes(v))!==hash)throw Error('Missing, invalid or mismatched '+hashKey+' for '+v);}
        catch(error:any){fail('contract_source_invalid',v,String(error.message));}
      }else verifyContractReferences(v);
    }
  };
  const matched=matchedConfig(cfg,task);verifyContractReferences(matched?.contracts);verifyContractReferences(matched?.dwellBrowse?.contracts);
  const required=[...coreFiles,...(cfg?.aiPanelReader===true?['runner/staged/ai-panel-reader.ts']:[]),...(currentComponents?['runner/staged/script-validation.ts','runner/staged/browse-revalidation.ts']:[]),...(cfg?.navigationPolicy==='current-text-v1'?['runner/staged/navigation-reader.ts','runner/staged/navigation-records.ts','runner/staged/script-validation.ts','runner/staged/system-observation.ts']:[]),...(cfg?.entryRecovery===true?['runner/staged/entry-recovery.ts','runner/staged/panel-claim.ts']:[]),...(cfg?.localActivityNavigation===true?['runner/staged/activity-navigation.ts','runner/staged/panel-claim.ts']:[]),...(cfg?.balanceComponent===true?['runner/staged/balance-component.ts']:[]),...(cfg?.learnedBrowse?.enabled?['runner/staged/learned-browse.ts',...(cfg.learnedBrowse.autoContract===true?['runner/staged/continuous-contract.ts']:[])]:[]),...(dwellContracts.length?['runner/staged/dwell-browse.ts',...(dwellContracts.some((c:any)=>c.provenance?.kind==='historical-dwell-v1')?['runner/staged/dwell-evidence.ts']:[])]:[]),...(immersive?.enabled===true?['runner/staged/immersive-browse.ts','runner/staged/immersive-ocr-quality.ts',...(immersive.rewardTransitions?.length?['runner/staged/immersive-transition.ts']:[])]:[]),...contractSources(matchedConfig(cfg,task))];
  for(const original of required)if(!sourceMap.has(original))fail('script_archive_missing',file('reviews.json'),'No session-bound current source archive for '+original);
  let configArchive:any;
  try {
    const original=reader.relative(session?.configFile),ref=sourceMap.get(original);
    if(!ref)throw Error('No session-bound config archive in script-sources');
    configArchive=JSON.parse(reader.bytes(ref.archivePath).toString('utf8'));
    if(!scopeOK(configArchive.scope,true)||!equal(implementationConfig(configArchive,task),implementationConfig(cfg,task)))throw Error('Archived config differs from session config/scope');
  }catch(error:any){fail('config_archive_missing',file('config.json'),String(error.message));}
  a.scriptSources=[...sourceMap.values()].filter(s=>required.includes(s.originalPath)).sort((x,y)=>x.originalPath.localeCompare(y.originalPath));
  if(configArchive&&a.scriptSources.length===new Set(required).size)a.fingerprint=sha(canonical({sources:a.scriptSources.map(s=>[s.originalPath,s.sha256]),contract:implementationConfig(configArchive,task)}));
  a.qualified=a.blockers.length===0&&a.fingerprint!==null;
  return a;
}

export async function auditStableScripts(options:{root?:string;indexFile?:string}={}) {
  const root=fs.realpathSync(options.root??process.cwd()),reader=new EvidenceReader(root),indexFile=options.indexFile??'data/task-records-v2/index.json';
  const manifest=reader.json(indexFile),account=reader.json(manifest.accountBundle),knowledge=reader.json(manifest.knowledgeBundle);
  if(account.schemaVersion!==2||!scopeKeys.every(k=>text(account.scope?.[k]))||!Number.isSafeInteger(account.account?.userId)||account.account.userId<0)throw Error('Invalid v2 account scope/user');
  const scope={...account.scope,userId:account.account.userId};
  let stageIndex:any={};try{stageIndex=reader.json('data/stage-records/index.json');}catch{/* Report missing source binding per attempt. */}
  const groups=new Map<string,ScriptTaskAudit>();
  const entries=(account.executions??[]).map((e:any)=>{
    const snapshot=account.snapshots.find((s:any)=>s.id===e.taskSnapshotId),task=account.tasks.find((t:any)=>t.id===snapshot?.taskId);
    return {e:{...e,auditSnapshotScope:snapshot?.scope},task};
  });
  for(const {e,task} of entries) {
    if(!task||!text(task.name)||!text(task.instruction)||!['completed','supervised_success'].includes(e.result?.status)||!finite(e.result?.gainCoins)||e.result.gainCoins<=0)continue;
    const key=identity(task);let row=groups.get(key);
    if(!row){row={name:task.name,instruction:task.instruction,state:'candidate',historicalSuccessCount:0,historicalSuccessRunIds:[],attemptCount:0,qualifyingSessionCount:0,fingerprints:[],attempts:[],blockers:[]};groups.set(key,row);}
    row.historicalSuccessCount++;row.historicalSuccessRunIds.push(e.runId);
  }
  for(const {e,task} of entries) {
    const row=groups.get(identity(task));if(!row)continue;
    try{row.attempts.push(await inspectAttempt(reader,e,task,scope,knowledge,stageIndex));}
    catch(error:any){row.attempts.push({runId:e.runId??null,evidenceDir:e.evidenceDir??'',sessionId:null,taskAttemptId:null,qualified:false,fingerprint:null,modelCalls:null,tokens:null,scriptSources:[],notes:[],blockers:[{code:'malformed_evidence',file:path.join(e.evidenceDir??'','stages.json'),detail:'Cannot verify malformed attempt evidence: '+String(error.message)}]});}
  }
  for(const row of groups.values()) {
    row.attemptCount=row.attempts.length;
    const byHash=new Map<string,Set<string>>(),seenAttempts=new Set<string>();
    for(const attempt of row.attempts) {
      if(!attempt.qualified||!attempt.sessionId||!attempt.fingerprint)continue;
      // One credited receipt/attempt cannot become two independent validations.
      if(seenAttempts.has(attempt.taskAttemptId!)) {attempt.qualified=false;attempt.blockers.push({code:'duplicate_attempt',file:path.join(attempt.evidenceDir,'result.json'),detail:'Same receipt attempt already counted'});continue;}
      seenAttempts.add(attempt.taskAttemptId!);
      const sessions=byHash.get(attempt.fingerprint)??new Set<string>();sessions.add(attempt.sessionId);byHash.set(attempt.fingerprint,sessions);
    }
    row.fingerprints=[...byHash].map(([fingerprint,sessions])=>({fingerprint,sessionIds:[...sessions].sort()}));
    row.qualifyingSessionCount=Math.max(0,...row.fingerprints.map(g=>g.sessionIds.length));
    row.state=row.qualifyingSessionCount>=2?'stable':'candidate';
    if(row.state==='candidate')row.blockers.push({code:'independent_sessions_insufficient',file:manifest.accountBundle,detail:`Same current implementation and exact task require 2 distinct qualifying sessions; observed ${row.qualifyingSessionCount}`});
  }
  const tasks=[...groups.values()];
  return {schemaVersion:1,generatedAt:new Date().toISOString(),scope,source:indexFile,policy:'whole-session-zero-model; current archived implementation; two distinct normal sessions per exact task',candidateCount:tasks.length,stableCount:tasks.filter(t=>t.state==='stable').length,tasks};
}
