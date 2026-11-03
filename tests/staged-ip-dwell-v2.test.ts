// Real archived pixels/OCR; all replay writes stay in scratch. No device or task AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import * as dwell from '../runner/staged/dwell-browse.ts';
import type {DeviceFrame} from '../runner/staged/device.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
const root=path.resolve(import.meta.dirname,'..');
const learningPath=path.join(root,'evidence/staged-2026-11-02T00-19-22-514Z/59fd5523-153a-4811-812d-f61d1dc3fdd7.json');
const owner={package:'com.taobao.taobao',userId:0};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function fixtures(){
 const cfg=JSON.parse(await fs.readFile(path.join(root,'evidence/staged-2026-11-02T00-19-22-514Z/config.json'),'utf8'));
 const old:dwell.DwellContract=cfg.dwellBrowse.contracts.find((c:any)=>c.sourceRunIds.includes(134));
 const learned:DeviceFrame=JSON.parse(await fs.readFile(learningPath,'utf8'));
 const ref={path:learned.path,sha256:hash(await fs.readFile(learned.path)),ocrPath:learningPath,ocrSha256:hash(await fs.readFile(learningPath)),frameId:learned.id,
  rawPath:learned.path.replace(/\.png$/,'.ocr.json'),rawSha256:hash(await fs.readFile(learned.path.replace(/\.png$/,'.ocr.json')))};
 const done:DeviceFrame=JSON.parse(await fs.readFile(old.receipt.reference.ocrPath,'utf8'));
 return {old,learned,ref,done};
}
test('run219 known five-second page has an explicit text contract; receiptOnly stays unchanged',async()=>{
 const {old,learned,ref,done}=await fixtures(),oldBytes=JSON.stringify(old);
 assert.equal(await dwell.inspectDwellBrowse(learned,owner,old),null);
 assert.equal((await dwell.inspectDwellBrowse(done,owner,old))?.state,'completed');
 const next=await dwell.buildTextDwellContract(old,ref);
 assert.deepEqual(await dwell.inspectDwellBrowse(learned,owner,next),{state:'browsing',waitMs:5000,version:next.version});
 assert.equal(next.textPolicy.version,'dwell-text-v2');assert.equal(next.receiptOnly,false);
 assert.notEqual(next.version,old.version);assert.equal(JSON.stringify(old),oldBytes);
 assert.equal((await dwell.inspectDwellBrowse(done,owner,next))?.state,'completed');
});
async function scratch(t:any){const dir=await fs.mkdtemp(path.join(process.env.TMPDIR!,'ip-dwell-v2-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function replay(dir:string,source:DeviceFrame,id:string,change:(f:DeviceFrame)=>void=()=>{}){
 // Replays are new synthetic captures with archived pixels/text, not historical
 // sidecar authorities; discard sidecars whose embedded IDs/paths belong to source.
 const {titleRefinement:_titles,balanceEvidence:_balance,...capture}=structuredClone(source);
 const f:DeviceFrame=capture;f.id=id;f.path=path.join(dir,id+'.png');f.capturedAt=Date.now();change(f);
 await fs.copyFile(source.path,f.path);
 await fs.writeFile(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));
 const raw=JSON.parse(await fs.readFile(source.path.replace(/\.png$/,'.ocr.json'),'utf8'));
 raw.pages[0].file=f.path;raw.pages[0].lines=f.lines;
 await fs.writeFile(f.path.replace(/\.png$/,'.ocr.json'),JSON.stringify(raw));return f;
}
test('text policy rejects wrong identity, seconds, missing/duplicate/conflicting component and raw binding',async t=>{
 const {old,learned,ref,done}=await fixtures(),c=await dwell.buildTextDwellContract(old,ref),dir=await scratch(t);
 const mutations=[
  (f:DeviceFrame)=>{f.package='other.package';},
  (f:DeviceFrame)=>{f.lines.find(l=>l.text==='淘宝成就')!.text='其他页面';},
  (f:DeviceFrame)=>{f.lines.find(l=>l.text==='浏览5秒')!.text='浏览10秒';},
  (f:DeviceFrame)=>{f.lines=f.lines.filter(l=>l.text!=='得奖励');},
  (f:DeviceFrame)=>{f.lines.push({...f.lines.find(l=>l.text==='浏览5秒')!});},
  (f:DeviceFrame)=>{f.lines.push({text:'验证码',bounds:[200,900,400,950]});},
  (f:DeviceFrame)=>{f.lines.find(l=>l.text==='得奖励')!.bounds=[200,1200,300,1240];},
 ];
 for(const [i,change] of mutations.entries())assert.equal(await dwell.inspectDwellBrowse(await replay(dir,learned,'reject-'+i,change),owner,c),null,'mutation '+i);
 const missing=await replay(dir,done,'missing-receipt',f=>{f.lines=f.lines.filter(l=>!l.text.includes('任务已完成'));});
 assert.equal(await dwell.inspectDwellBrowse(missing,owner,c),null);
 const rawMismatch=await replay(dir,learned,'raw-mismatch');rawMismatch.lines.find(l=>l.text==='浏览5秒')!.text='浏览10秒';
 assert.equal(await dwell.inspectDwellBrowse(rawMismatch,owner,c),null);
 const unrelated=await replay(dir,learned,'unrelated-refinement');unrelated.lines.find(l=>l.text==='设置引导①')!.text='设置引导';
 assert.equal((await dwell.inspectDwellBrowse(unrelated,owner,c))?.state,'browsing','unrelated refinement is outside the task text binding');
 assert.equal((await dwell.inspectDwellBrowse(learned,owner,c))?.state,'browsing','lack of receipt never completes');
 const natural=await replay(dir,done,'natural-receipt',f=>{f.lines.find(l=>l.text.includes('任务已完成'))!.text='任务已完成';f.lines=f.lines.filter(l=>l.text!=='更多');});
 assert.equal((await dwell.inspectDwellBrowse(natural,owner,c))?.quote,'任务已完成\n继续逛逛吧');
 const duplicate=await replay(dir,done,'duplicate-receipt',f=>{f.lines.push({text:'另一任务已完成',bounds:[100,1000,400,1040]});});
 assert.equal(await dwell.inspectDwellBrowse(duplicate,owner,c),null,'conflicting second completion must not be ignored');
 const bad={...ref,rawSha256:'0'.repeat(64)};await assert.rejects(dwell.buildTextDwellContract(old,bad),/does not replay/);
});

async function engineReplay(t:any,complete=true){
 const {old,learned,ref,done}=await fixtures(),contract=await dwell.buildTextDwellContract(old,ref),dir=await scratch(t);
 const panelSource:DeviceFrame=JSON.parse(await fs.readFile(path.join(root,'evidence/staged-2026-11-01T23-38-18-381Z/4cfce720-55ce-4c26-bdbd-4f11d5d73eaf.json'),'utf8'));
 let page='panel',serial=0,elapsed=0,taskAiCalls=0;const actions:any[]=[],queries:any[]=[];
 const device={capture:async()=>replay(dir,page==='panel'||page==='returned'?panelSource:complete&&elapsed>=5000?done:learned,'engine-'+(++serial)),
  act:async(a:any)=>{actions.push(a);if(a.type==='tap')page='browse';if(a.type==='back')page='returned';if(a.type==='wait'&&a.ms>1000)elapsed+=a.ms;},
  scrollContinuously:async()=>{throw Error('Forbidden scroll');}};
 // Model observations and transition clock are explicitly synthetic. The model
 // only reads owning panels; the task page uses the real inspector and engine.
 const model={query:async(req:any)=>{
  if(req.context||!req.prompt?.startsWith('Read the supplied ORIGINAL PNG directly.'))taskAiCalls++;
  queries.push({page,frameId:req.frame.id});
  if(page!=='panel'&&page!=='returned')return {isPanel:false,balance:null,blocked:false,top:false,bottom:false,tasks:[],clippedRows:[]};
  return {isPanel:true,balance:page==='returned'?2325:2315,blocked:false,top:true,bottom:true,tasks:[{...contract.task,done:page==='returned'?1:0,total:1,reward:10,button:'去完成',rewardMin:null,rewardMax:null,rewardOffers:[{condition:'浏览5秒',reward:10,rewardMin:null,rewardMax:null}],bounds:[230,900,750,950],buttonBounds:[880,1000,1000,1080],point:[940,1040]}],clippedRows:[]};
 }};
 const cfg:any={package:owner.package,scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},panelMarker:'赚金币抵钱',constraints:[],selectionAllowNew:false,
  aiPanelReader:true,aiTaskRecovery:false,scriptValidationMode:false,balanceComponent:false,
  learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[contract]},
  limits:{stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3},stages:Object.fromEntries(['open_task','task_receipt','return_list'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};
 const rt=createStagedRuntime(cfg,device,model,{sessionId:'offline-ip-v2',evidenceDir:dir,plan:[{...contract.task,decision:'do',times:1}]});
 const chosen=await rt.stage('select_task',{});assert.equal(chosen.status,'completed');assert.equal(chosen.balanceBefore,2315);
 const ctx={task:chosen.task,taskAttemptId:'offline-ip-attempt'};
 const open=await rt.stage('open_task',ctx);assert.equal(open.status,'completed',open.error);
 const receipt=await rt.stage('task_receipt',ctx);
 assert.equal(taskAiCalls,0);assert.equal(queries.filter(q=>q.page==='browse').length,0,'no model call between entry and local receipt');
 if(!complete){assert.notEqual(receipt.status,'completed');assert.equal(receipt.receipt,undefined);assert.match(receipt.error,/budget|exhaust/i);assert.ok(elapsed<=10000);assert.equal(actions.filter(a=>a.type==='tap').length,1);assert.equal(queries.filter(q=>q.page==='browse').length,0);return;}
 assert.equal(receipt.status,'completed',receipt.error);assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);
 assert.match(receipt.receipt.quote,/任务已完成/);assert.deepEqual(actions.filter(a=>a.type==='wait'&&a.ms>1000),[{type:'wait',ms:5000}]);
 assert.equal(receipt.actions[0].source,'script');assert.ok(receipt.events.filter(e=>e.type==='observed').length>=2);
 const returned=await rt.stage('return_list',ctx);assert.equal(returned.status,'completed',returned.error);
 const settled=await rt.stage('settle',ctx);assert.equal(settled.status,'completed',settled.error);assert.equal(settled.balanceAfter,2325);
 assert.equal(settled.review.samples.length,2);assert.notEqual(settled.review.samples[0].frameId,settled.review.samples[1].frameId);
 assert.equal(actions.filter(a=>a.type==='tap').length,1);assert.equal(actions.filter(a=>a.type==='back').length,1);
 assert.equal(rt.calls,queries.length);assert.ok(queries.filter(q=>q.page==='returned').length>=2);assert.equal(taskAiCalls,0);
}
test('real engine/runtime: panel → run219 → local 5s → historical receipt → return → two AI panel balances',async t=>engineReplay(t));
test('real engine/runtime exhausts bounded local waiting without inventing a receipt or task AI',async t=>engineReplay(t,false));
