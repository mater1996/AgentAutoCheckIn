// Offline historical replay. Frame IDs/times/transitions and panel AI responses
// are synthetic; task inspectors, runtime, engine, PNGs and saved OCR are real.
import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

let forbiddenExternalCalls = 0;
const forbidden = () => { forbiddenExternalCalls++; throw Error('Offline replay forbids device/OCR processes and ledger connections'); };
// Boundary tripwires must precede loading runtime and its dynamic inspectors.
mock.module('better-sqlite3', {exports:{default: class { constructor() { forbidden(); } }}});
mock.module('node:child_process', {exports: Object.fromEntries(
  ['execFile','exec','spawn','fork','execFileSync','execSync','spawnSync'].map(k => [k, forbidden]))});
const {createStagedRuntime} = await import('../runner/staged/runtime.ts');
const {validateStagedConfig} = await import('../runner/staged/config.ts');
const {loadAiPanel} = await import('../runner/staged/ai-panel-reader.ts');
const {inspectCurrentDwellBrowse} = await import('../runner/staged/dwell-browse.ts');
const root = path.resolve(import.meta.dirname, '..');
const sourceDir = path.join(root, 'evidence/staged-2026-11-01T07-39-51-677Z');
const contractFile = path.join(root, 'data/evidence/plans/stable-scripts-20261101/dwell-contracts-full.json');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const owner = {package:'com.taobao.taobao', userId:0};
// Pinned before this test was written; no test output can redefine source truth.
const sources = {
  panel: ['326dc156-6a55-4292-877a-7c61ff178b3e', 'a311a96d5c3f22c874407b6e37183ad252b31ce3fd7bd30d703f158017b47f51', 'ffb7f52b79da3b06b0cf05f4b9225c636fd2361a84e299df7f29bf113dab6e30', 'aa8ec3787c6856c7a37d7dad558edc4f04ed0dc78771ed68de85a8cb884c0532'],
  browsing: ['6125a14b-0010-4806-8b89-6d617998b729', '8ba0c5ed4eaa9a7df826ae1c092072801e256d4d130a6475643a36ff2a08be6d', '2a86bc18c48d2328180c1d7245cf5d5a873a8d4fd7c7d3ac3d06fb695884dda2', '4a8344cf87d539bff6986ceb6b507b144ad4075e1e4a3eb7bc650ee7a5165a3c'],
  receipt: ['3bcffe44-1af7-4919-8606-4f586fb3cab9', '34dd711c08b82534c6376f071307ecc96ca9c96c6452c8b9f2fc58d1fe2a54a3', '83ea51a1225c772a01f5f26ec0084099ec8acb53a137191247c0be9ccd43974f', '27e82f11bf13ecb4e4ddf53350fe7e3fe653519243a5034e7e1e6281876be6ca'],
  returned1: ['30c8b923-c06a-48b1-9c2f-24edb2d8ea63', '6b6c40bcce569895aab222c205e5fd540465a5a83d79d3d8d0cf15201f6e9919', '8b158a9c2a5713ddc793be358abc87de739ec9efa3d4a9593dfeda866657b7ab', 'a67b717b20638da06569a9bce87571efd8f5ca25003853b829cebb10f510000c'],
  returned2: ['9e30c034-f291-405f-a355-4d1bdd34660e', '6b6c40bcce569895aab222c205e5fd540465a5a83d79d3d8d0cf15201f6e9919', '4b0b1457112e2df99cdeede38fb0a957c8854b76bd38bb9a3a6555e1e50a669a', '06bb5ed70608c75528057c656074686310112b2f351cdc2323b8672de5d595cd'],
} as const;
type Source = keyof typeof sources;
const json = (file:string) => JSON.parse(fs.readFileSync(file,'utf8'));
const identity = (task:any) => ({name:task.name,instruction:task.instruction,done:task.done,total:task.total});
function pinnedFiles() {
  return Object.values(sources).flatMap(([id,...hashes]) => ['png','json','ocr.json'].map((ext,i) => ({
    path:path.join(sourceDir,id+'.'+ext), sha256:hashes[i],
  })));
}
function verifyPinned() { for (const file of pinnedFiles()) assert.equal(sha(fs.readFileSync(file.path)),file.sha256,file.path); }
function cfg(contract:any) {
  return validateStagedConfig({scope:{appId:'taobao',accountId:'synthetic-offline',activityId:'tb_coin',userId:0},package:owner.package,assetId:'coins',
    model:{baseUrl:'http://127.0.0.1:1',name:'synthetic-panel-response-stub'},panelMarker:'赚金币抵钱',
    localActivityNavigation:true,navigationPolicy:'current-text-v1',taskObservationPolicy:'current-components-v1',panelReadPolicy:'focused-v1',
    aiPanelReader:true,aiTaskRecovery:true,scriptValidationMode:false,balanceComponent:false,selectionAllowNew:false,
    constraints:['One historical ordinary browse replay; synthetic device/model boundaries only'],
    learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},
    dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[contract]},
    limits:{maxTasks:1,sessionMs:120000,stageMs:30000,agentCalls:15,stageActions:4,maxReturns:3,inventoryPages:1},
    stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id+'_ok'}]))});
}
async function harness(t:any, wrongRequirement=false) {
  verifyPinned();
  const contract = json(contractFile).dwellBrowse.contracts.find((c:any)=>c.sourceRunIds[0]===160);
  assert.equal(contract.task.name,'去芭芭农场逛一逛'); assert.equal(contract.task.instruction,'浏览5秒');
  const contractBytes = JSON.stringify(contract), contractFileSha = sha(fs.readFileSync(contractFile));
  const provenance = [contract.source.resultPath,contract.source.sessionPath];
  const provenanceHashes = provenance.map((p:string)=>sha(fs.readFileSync(p)));
  assert.deepEqual(provenanceHashes,[contract.source.resultSha256,contract.source.sessionSha256]);
  const dir = fs.mkdtempSync(path.join('/Users/mater/.hermes/cache/scratch/','staged-current-flow-'));
  t.after(()=>{
    try { save(); verifyPinned(); assert.equal(sha(fs.readFileSync(contractFile)),contractFileSha);
      assert.equal(JSON.stringify(contract),contractBytes);
      assert.deepEqual(provenance.map((p:string)=>sha(fs.readFileSync(p))),provenanceHashes);
      assert.equal(forbiddenExternalCalls,0,'No device, OCR subprocess or ledger connection may be attempted');
    } finally { if(!process.env.KEEP_CURRENT_FLOW_REPLAY)fs.rmSync(dir,{recursive:true,force:true}); }
  });
  let clock=Date.now(),serial=0,page='panel',dwellMs=0,returnedCaptures=0;
  t.mock.method(Date,'now',()=>clock);
  const actions:any[]=[],requests:any[]=[],captures:any[]=[],timeline:any[]=[];
  const within = (file:string) => { assert.equal(path.dirname(path.resolve(file)),dir,'All replay writes must be session owned'); return file; };
  function replay(sourceKey:Source) {
    const sourceId=sources[sourceKey][0],stem=path.join(sourceDir,sourceId),source=json(stem+'.json');
    const id='synthetic-'+String(++serial).padStart(3,'0')+'-'+sourceKey;
    // Deliberate field projection: never inherit historical sidecar/output paths.
    const frame={id,path:within(path.join(dir,id+'.png')),width:source.width,height:source.height,
      capturedAt:++clock,package:source.package,userId:source.userId,lines:structuredClone(source.lines)};
    if(wrongRequirement&&sourceKey==='browsing')frame.lines.find((l:any)=>l.text==='浏览5秒').text='浏览10秒';
    fs.copyFileSync(stem+'.png',frame.path);
    fs.writeFileSync(within(frame.path.replace(/\.png$/,'.json')),JSON.stringify(frame));
    const raw=json(stem+'.ocr.json');
    assert.equal(raw.pages.length,1); assert.equal(raw.engine,'Apple Vision VNRecognizeTextRequest');
    // Preserve historical engine/languages/correction/revision/recognitionMs.
    // Only synthetic replay file binding and the explicit negative text change.
    raw.pages[0].file=frame.path;
    if(wrongRequirement&&sourceKey==='browsing')raw.pages[0].lines.find((l:any)=>l.text==='浏览5秒').text='浏览10秒';
    fs.writeFileSync(within(frame.path.replace(/\.png$/,'.ocr.json')),JSON.stringify(raw));
    assert.equal(sha(fs.readFileSync(frame.path)),sources[sourceKey][1],'Replay keeps original PNG bytes');
    const sourceRaw=json(stem+'.ocr.json');
    const {file:_sourceFile,lines:_sourceLines,...sourcePageMeta}=sourceRaw.pages[0];
    const {file:_replayFile,lines:_replayLines,...replayPageMeta}=raw.pages[0];
    assert.deepEqual(replayPageMeta,sourcePageMeta,'Historical revision/recognition metadata is preserved');
    assert.deepEqual({...raw,pages:undefined},{...sourceRaw,pages:undefined},'Raw engine metadata is preserved');
    const origin={synthetic:true,frameId:id,capturedAt:frame.capturedAt,page,sourceKey,sourceFrameId:sourceId,
      sourcePng:stem+'.png',sourceFrame:stem+'.json',sourceOcr:stem+'.ocr.json',
      mutation:wrongRequirement&&sourceKey==='browsing'?'synthetic OCR 浏览5秒 → 浏览10秒':null};
    captures.push(origin); return frame;
  }
  const row={...contract.task,done:0,total:1,reward:30,rewardMin:null,rewardMax:null,
    rewardOffers:[{condition:'浏览5秒',reward:30,rewardMin:null,rewardMax:null}],button:'去完成',
    bounds:[233,795,676,845],buttonBounds:[854,808,1034,888],point:[944,848]};
  const model={usage:[] as any[],query:async(request:any)=>{
    requests.push({synthetic:true,frameId:request.frame.id,page,purpose:request.panelReadMode?.purpose??(request.context?'task-recovery':'inventory'),
      task:request.panelReadMode?.task??null});
    // Task AI has no success/action stub: unknown requirement must stop locally.
    if(request.context)throw Error('Synthetic task AI boundary refuses unknown/wrong requirement');
    assert.ok(request.prompt.startsWith('Read the supplied ORIGINAL PNG directly'));
    if(request.panelReadMode)return page==='returned'
      ?{isPanel:true,balance:1730,blocked:false,taskStatus:'absent',task:null}
      :{isPanel:false,balance:null,blocked:false,taskStatus:'not-panel',task:null};
    assert.equal(page,'panel');
    // Single-task projected inventory and its boundaries are explicitly synthetic.
    return {isPanel:true,balance:1700,blocked:false,top:true,bottom:true,tasks:[row],clippedRows:[]};
  }};
  const device={capture:async()=>replay(page==='panel'?'panel':page==='returned'?(++returnedCaptures<3?'returned1':'returned2'):dwellMs>=5000?'receipt':'browsing'),
    act:async(action:any,frame?:any)=>{
      actions.push({synthetic:true,action:structuredClone(action),frameId:frame?.id,capturedAt:frame?.capturedAt,at:clock});
      if(action.type==='tap'){assert.equal(page,'panel');page='browsing';}
      else if(action.type==='back'){assert.equal(page,'browsing');page='returned';}
      else {assert.equal(action.type,'wait','Ordinary dwell replay forbids all other actions');clock+=action.ms;if(page==='browsing'&&action.ms===5000)dwellMs+=action.ms;}
    },scrollContinuously:async()=>{throw Error('Ordinary dwell must never scroll');}};
  const config=cfg(contract);
  // No opts inspectors or runStage override: runtime dynamically loads production
  // inspectCurrentDwellBrowse and production runStage itself.
  const rt=createStagedRuntime(config,device,model,{sessionId:'synthetic-current-flow',evidenceDir:dir,
    plan:[{...contract.task,decision:'do',times:1}]});
  async function stage(id:string,ctx:any={}) {
    const result=await rt.stage(id,ctx);timeline.push({synthetic:true,stageId:id,result});return result;
  }
  function save() {
    fs.writeFileSync(within(path.join(dir,'synthetic-replay-manifest.json')),JSON.stringify({
      synthetic:true,note:'Historical PNG/OCR replay, synthetic frame IDs/capture clock/transitions, stub panel responses; no real device/model/ledger',
      sourceRunId:160,contract,config,actions,requests,captures,timeline,frames:rt.frames,stages:rt.stages,
    },null,2));
  }
  return {dir,rt,stage,config,contract,actions,requests,captures,save,get dwellMs(){return dwellMs}};
}

test('real current inspector → runtime → engine: one ordinary dwell task reaches focused stable settlement',async t=>{
  const h=await harness(t);
  assert.equal((await h.stage('collect_list')).status,'completed');
  const collected=h.rt.frames[0],capturedAt=collected.capturedAt;
  const selected=await h.stage('select_task');assert.equal(selected.status,'completed');assert.equal(selected.balanceBefore,1700);
  assert.equal(h.captures.length,1,'collection → selection reuses the original capture');
  const ctx={task:selected.task,taskAttemptId:'synthetic-current-attempt'};
  const open=await h.stage('open_task',ctx);assert.equal(open.status,'completed',open.error);
  assert.equal(h.captures.length,3,'entry reuses inventory; engine arrival and tap settling capture fresh frames');
  assert.equal(h.rt.frames[0].capturedAt,capturedAt,'Reuse must preserve capture time');
  const entryObserved=open.events.filter((e:any)=>e.type==='observed');
  assert.equal(entryObserved[0].frame.id,collected.id);assert.equal(entryObserved[0].frame.capturedAt,capturedAt);
  assert.ok(open.events.some((e:any)=>e.type==='tap_settling'&&e.ms===1000));
  assert.equal(open.actions[0].source,'script');assert.equal(open.actions[0].status,'verified');
  const receipt=await h.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);
  assert.equal(receipt.receipt.quote,'+30\n任务已完成\n继续逛逛吧');
  assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);assert.equal(receipt.receipt.version,h.contract.version);
  assert.deepEqual(receipt.actions.map((a:any)=>({source:a.source,status:a.status,action:a.proposal.action})),
    [{source:'script',status:'verified',action:{type:'wait',ms:5000}}]);
  assert.equal(h.dwellMs,5000);
  const receivedFrame=h.rt.frames.find((f:any)=>f.id===receipt.receipt.frameId);
  assert.equal((await inspectCurrentDwellBrowse(receivedFrame,owner,h.contract))?.quote,receipt.receipt.quote);
  const returned=await h.stage('return_list',ctx);assert.equal(returned.status,'completed',returned.error);
  const settled=await h.stage('settle',ctx);assert.equal(settled.status,'completed',settled.error);
  assert.equal(settled.balanceAfter,1730);assert.equal(settled.review.delta,30);
  assert.equal(settled.review.samples.length,2);
  const samples=settled.review.samples.map((s:any)=>h.rt.frames.find((f:any)=>f.id===s.frameId));
  assert.notEqual(samples[0].id,samples[1].id);assert.ok(samples[1].capturedAt>samples[0].capturedAt);
  assert.deepEqual(samples.map((f:any)=>loadAiPanel(f)?.readPurpose),['settlement','settlement']);
  assert.deepEqual(samples.map((f:any)=>loadAiPanel(f)?.taskStatus),['absent','absent']);
  assert.deepEqual(h.requests.map(r=>r.purpose),['inventory','return-status','return-status','settlement','settlement']);
  assert.ok(h.requests.filter(r=>r.purpose!=='inventory').every(r=>JSON.stringify(r.task)===JSON.stringify(identity(selected.task))));
  assert.equal(h.rt.calls,5);assert.equal(h.requests.filter(r=>r.purpose==='task-recovery').length,0);
  assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);assert.equal(h.actions.filter(a=>a.action.type==='back').length,1);
  const runtimeEvents=fs.readFileSync(path.join(h.dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
  assert.deepEqual(runtimeEvents.filter(e=>e.kind==='observation_reused').map(e=>({stageId:e.stageId,frameId:e.frameId,capturedAt:e.capturedAt})),
    ['select_task','open_task'].map(stageId=>({stageId,frameId:collected.id,capturedAt})));
  assert.equal(runtimeEvents.filter(e=>e.kind==='learned_entry_dispatched').length,1);
  assert.equal(runtimeEvents.filter(e=>e.kind==='dwell_wait_slice').length,1);
  assert.equal(runtimeEvents.find(e=>e.kind==='learned_receipt').quote,receipt.receipt.quote);
});

test('wrong synthetic requirement fails the real checker without completion, wait authority or another entry',async t=>{
  const h=await harness(t,true);
  assert.equal((await h.stage('collect_list')).status,'completed');
  const selected=await h.stage('select_task'),ctx={task:selected.task,taskAttemptId:'synthetic-wrong-requirement-attempt'};
  const open=await h.stage('open_task',ctx);assert.notEqual(open.status,'completed');
  assert.match(open.error,/recovery|requirement|unknown/i);
  const browsing=h.rt.frames.find((f:any)=>h.captures.find(c=>c.frameId===f.id)?.sourceKey==='browsing');
  assert.equal(await inspectCurrentDwellBrowse(browsing,owner,h.contract),null);
  const receipt=await h.stage('task_receipt',ctx);assert.notEqual(receipt.status,'completed');assert.equal(receipt.receipt,undefined);
  const retry=await h.stage('open_task',ctx);assert.notEqual(retry.status,'completed');
  assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1,'Entry must never replay after an unverified destination');
  assert.equal(h.actions.filter(a=>a.action.type==='wait'&&a.action.ms===5000).length,0);
  const settlement=await h.stage('settle',ctx);assert.notEqual(settlement.status,'completed');assert.equal(settlement.balanceAfter,undefined);
  assert.match(settlement.error,/Missing receipt/);assert.equal(h.dwellMs,0);
  assert.ok(h.requests.some(r=>r.purpose==='task-recovery'),'Enabled AI recovery reaches only the explicit rejecting boundary');
});
