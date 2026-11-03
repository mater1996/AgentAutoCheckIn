// OFFLINE: saved PNG/OCR + run229 dumpsys; all device inputs/model responses are simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {readPanel} from '../runner/staged/observations.ts';
const root=path.resolve(import.meta.dirname,'..');
const saved='evidence/continuous-supervised-2026-11-01T05-18-43-216Z/';
const sources={panel:saved+'9caa6d17-0375-4f3d-9a27-272bf7090f2f',browse:saved+'bfbc7cc8-510d-4133-82f7-1a432fa97af7',receipt:saved+'17cbd398-0659-40fc-90d7-79d3ee3c188f',returned:saved+'68f914e4-8a4d-4763-98eb-62c3fa3ae19f'};
const run229='evidence/staged-2026-11-02T12-49-26-458Z';
const missingFile=run229+'/device-command-evidence/foreground-586f0d29-580b-4954-ac38-8305ce9af9bb.json';
const read=(p:string)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
// Synthetic missing-marker variant; retain the immutable run229 dump unchanged.
const missing=read(missingFile).stdout.split('\n').filter((line:string)=>!/^[ \t]*(?:ResumedActivity|Resumed):/.test(line)).join('\n');
const owner={package:'com.taobao.taobao',userId:0};
const target=readPanel(read(sources.panel+'.json')).tasks.find(t=>t.name==='看看#精致面霜')!;
async function replay(t:any,mode='normal',ai=false,hooks:any={}){
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/post-dispatch-observe-');
 t.after(()=>{if(process.env.CHECKIN_KEEP_POST_DISPATCH_REPLAY==='1')console.log('OFFLINE_REPLAY_EVIDENCE',dir);else fs.rmSync(dir,{recursive:true,force:true});});
 let page:keyof typeof sources='panel',failed=false,foreground=0,captures=0,queries=0;const inputs:any[]=[],ops:string[]=[];
 const cfg:any={...owner,scope:{appId:'a',accountId:'offline',activityId:'coins',userId:0},panelMarker:'赚金币抵钱',selectionAllowNew:false,constraints:[],aiPanelReader:ai,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1',learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},limits:{stageMs:10000,sessionMs:60000,stageActions:3,agentCalls:10,maxReturns:2},stages:Object.fromEntries(['open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}]))};
 if(mode==='legacy')delete cfg.taskCompletionPolicy;
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,frameMaxAgeMs:15000,exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys')){
    foreground++;ops.push('foreground');
    if(page==='browse'&&(!failed||mode==='twice')&&(!mode.startsWith('missing-after')||ops.at(-2)==='capture')){
     failed=true;
     if(mode==='deadline')cfg.limits.sessionMs=1;
     if(mode==='forged')throw Object.assign(Error('Foreground missing or ambiguous'),{recorded:true,source:{path:missingFile}});
     if(mode==='exec-error')throw Error('transport failure');
     if(mode==='ambiguous')return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}\ntopResumedActivity=ActivityRecord{y u999 com.taobao.taobao/.Other}'};
     if(mode==='malformed')return {stdout:'topResumedActivity=null'};
     if(mode==='explicit-foreign')return {stdout:'ResumedActivity: ActivityRecord{x u0 com.eg.android.AlipayGphone/.LoginActivity t248}\nResumed: ActivityRecord{x u0 com.eg.android.AlipayGphone/.LoginActivity t248}\nmFocusedApp=ActivityRecord{stale u0 com.taobao.taobao/.Main t246}'};
     if(mode==='explicit-conflict')return {stdout:'ResumedActivity: ActivityRecord{x u0 com.taobao.taobao/.Main t246}\nResumed: ActivityRecord{y u999 com.taobao.taobao/.Main t246}'};
     if(mode==='explicit-malformed')return {stdout:'ResumedActivity: null\nResumed: ActivityRecord{x u0 com.taobao.taobao/.Main t246}'};
     return {stdout:missing};
    }
    return {stdout:`topResumedActivity=ActivityRecord{x u${failed&&mode==='owner'||page==='browse'&&mode==='missing-after-foreign'?999:0} com.taobao.taobao/.Main}`};
   }
   if(args.includes('screencap')){captures++;ops.push('capture');return {stdout:fs.readFileSync(path.join(root,sources[page]+'.png'))};}
   if(args.includes('input')){inputs.push(args);ops.push('tap');page='browse';if(mode==='dispatch-unknown')throw Error('input outcome unknown');return {stdout:''};}
   throw Error('Forbidden offline command');
  }
  const raw=read(sources[page]+'.ocr.json');raw.pages[0].file=args[1];
  if(page==='receipt')raw.pages[0].lines.push({text:'本次任务已完成',bounds:[100,500,600,550]});
  fs.writeFileSync(args[0],JSON.stringify(raw));return {stdout:''};
 }});
 let captureCalls=0,missingStartedAt=0,recoveryStartedAt=0;
 const adapter={capture:async()=>{const n=++captureCalls;if(missingStartedAt&&!recoveryStartedAt)recoveryStartedAt=Date.now();await hooks.beforeCapture?.(n,cfg);let f;try{f=await device.capture();}catch(error){if(!missingStartedAt)missingStartedAt=Date.now();throw error;}await hooks.afterCapture?.(n,cfg,f);return f;},consumeCaptureForegroundMissing:(e:any,o:any)=>(device as any).consumeCaptureForegroundMissing?.(e,o),act:async(a:any,f:any)=>{if(a.type==='wait'){ops.push('wait');return;}if(a.type==='back'){inputs.push(['back']);page='returned';return;}return device.act(a,f);}};
 const model={usage:[],query:async(r:any)=>{queries++;const p=readPanel(read(sources[page]+'.json'));const row=(t:any)=>({...Object.fromEntries(['name','instruction','done','total','reward','rewardMin','rewardMax','rewardOffers','button','bounds','point'].map(k=>[k,t[k]??(k==='rewardOffers'?[]:null)])),buttonBounds:[t.point[0]-20,t.point[1]-20,t.point[0]+20,t.point[1]+20]});return r.panelReadMode?{isPanel:p.isPanel,balance:p.balance,blocked:false,taskStatus:p.isPanel?'visible':'not-panel',task:p.isPanel?row(target):null}:{isPanel:p.isPanel,balance:p.balance,blocked:false,top:true,bottom:true,tasks:p.isPanel?[row(target)]:[],clippedRows:[]};}};
 const rt=createStagedRuntime(cfg,adapter,model,{sessionId:'offline-post-dispatch',evidenceDir:dir,plan:[{name:target.name,instruction:target.instruction,decision:'do',times:1}],inspectCurrentLearnedBrowse:async()=>({state:'browsing',version:'offline-inspector',action:{type:'wait',ms:1}})});
 const selected=await rt.stage('select_task',{});assert.equal(selected.status,'completed',selected.error);
 const ctx={task:selected.task,taskAttemptId:'offline-one-attempt'};
 await hooks.beforeOpen?.(cfg,ctx);
 const result=await rt.stage('open_task',ctx);
 const events=()=>fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 return {rt,cfg,ctx,result,dir,inputs,ops,events,get captureCalls(){return captureCalls},get recoveryDelayMs(){return recoveryStartedAt-missingStartedAt},get foreground(){return foreground},get captures(){return captures},get queries(){return queries},failAgain:()=>{failed=false;},setPage:(p:keyof typeof sources)=>{page=p;}};
}
for(const ai of [false,true])test(`one successful tap + recorded missing foreground gets one fresh observation (AI=${ai})`,async t=>{
 const h=await replay(t,'normal',ai);assert.equal(h.result.status,'completed',h.result.error);
 assert.equal(h.inputs.filter(a=>a.includes('tap')).length,1);
 const events=h.events(),retry=events.filter(e=>e.kind==='post_dispatch_foreground_reobservation');assert.equal(retry.length,1);
 assert.ok(h.recoveryDelayMs>=490,`recovery waited ${h.recoveryDelayMs}ms`);
 assert.equal(retry[0].taskAttemptId,h.ctx.taskAttemptId);assert.equal(retry[0].extraWaitMs,500);
 assert.ok(retry[0].foreground.path.startsWith(h.dir));assert.ok(events.some(e=>e.kind==='learned_entry_dispatched'));
 assert.equal(h.ops.slice(h.ops.indexOf('tap')+1,h.ops.indexOf('tap')+4).join(','),'foreground,foreground,capture');
 assert.equal(h.result.receipt,undefined);
 assert.equal((await h.rt.stage('settle',h.ctx)).status,'stopped','recovered destination is no completion/settlement');
 if(!ai){h.setPage('receipt');const receipt=await h.rt.stage('task_receipt',h.ctx);assert.equal(receipt.status,'completed',receipt.error);assert.equal(receipt.receipt.version,'current-keywords-v1');h.setPage('returned');const settled=await h.rt.stage('settle',h.ctx);assert.equal(settled.status,'completed',settled.error);assert.equal(settled.balanceAfter,1650);}
});
for(const mode of ['twice','owner','ambiguous','malformed','explicit-foreign','explicit-conflict','explicit-malformed','forged','exec-error','deadline','dispatch-unknown','legacy','missing-after-foreign'])test(`${mode} stops without input replay`,async t=>{
 const h=await replay(t,mode,mode==='legacy');assert.notEqual(h.result.status,'completed');assert.equal(h.inputs.filter(a=>a.includes('tap')).length,1);
 assert.equal(h.events().filter(e=>e.kind==='post_dispatch_foreground_reobservation').length,['twice','owner'].includes(mode)?1:0);
 const taps=h.inputs.length;await h.rt.stage('open_task',h.ctx);assert.equal(h.inputs.length,taps);
 assert.ok(!h.events().some(e=>e.kind==='learned_receipt'));
 });
 test('same attempt cannot renew capture recovery in task_receipt or another attempt',async t=>{
 const h=await replay(t);assert.equal(h.result.status,'completed');h.failAgain();
 const count=h.captureCalls,r=await h.rt.stage('task_receipt',h.ctx);
 assert.equal(r.status,'stopped');assert.equal(h.captureCalls,count+1);
 h.failAgain();const before=h.captureCalls;await h.rt.stage('task_receipt',{...h.ctx,taskAttemptId:'other'});
 assert.equal(h.captureCalls,before+1);assert.equal(h.events().filter(e=>e.kind==='post_dispatch_foreground_reobservation').length,1);
 assert.equal(h.inputs.filter(a=>a.includes('tap')).length,1);
 });
 for(const phase of ['failed','recovery'])test(`late ${phase} capture cannot renew original stage deadline`,async t=>{
 let release:()=>void=()=>{};
 const h=await replay(t,'normal',false,{beforeOpen:(cfg:any)=>{cfg.limits.stageMs=phase==='recovery'?1000:500;},beforeCapture:async(n:number)=>{
 if(n===(phase==='failed'?3:4))await new Promise<void>(r=>{release=r;});
 }});
 assert.match(h.result.error,/deadline/);const calls=h.captureCalls;
 release();await new Promise(r=>setTimeout(r,20));assert.equal(h.captureCalls,calls);
 assert.equal(h.inputs.filter(a=>a.includes('tap')).length,1);
 assert.equal(h.events().filter(e=>e.kind==='post_dispatch_foreground_reobservation').length,phase==='failed'?0:1);
 assert.ok(!h.events().some(e=>e.kind==='learned_destination_confirmed'||e.kind==='learned_receipt'));
 });
