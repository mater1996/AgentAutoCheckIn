// Offline replay of run238 pixels/OCR/answer through real engine, runtime and device.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import * as audit from '../runner/staged/script-validation.ts';
const history=new URL('../evidence/staged-2026-11-02T15-39-45-720Z/',import.meta.url);
const id='c66e1949-186d-42a7-b6c0-d34fcafae128';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
async function harness(t:any,options:any={}){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(process.env.TMPDIR!,'selected-entry-')));
 const original=JSON.parse(fs.readFileSync(new URL(id+'.json',history),'utf8'));
 const answerPath=new URL(path.basename(original.aiPanelEvidence.rawResponse.path),history);
 const files=[new URL(id+'.json',history),new URL(id+'.png',history),new URL(id+'.ocr.json',history),answerPath];
 const pinned=files.map(p=>({p,sha:hash(fs.readFileSync(p))}));
 t.after(()=>{for(const {p,sha} of pinned)assert.equal(hash(fs.readFileSync(p)),sha,'run238 source bytes unchanged');fs.rmSync(dir,{recursive:true,force:true});});
 const realNow=Date.now;let clock=original.capturedAt;Date.now=()=>clock;t.after(()=>{Date.now=realNow;});
 let captures=0,queries=0,entered=false,actionForeground=false;
 const sent:any[]=[],requests:any[]=[];
 const task={...JSON.parse(fs.readFileSync(answerPath,'utf8')).task,reward:20};
 const device=new AdbOcrDevice({executionPolicy:options.development?'development-unbounded-v1':undefined,serial:'OFFLINE-NO-DEVICE',evidenceDir:dir,frameMaxAgeMs:15000,now:()=>clock,exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys')){
    if(actionForeground){clock+=options.dispatchDelay??0;actionForeground=false;}
    return {stdout:`topResumedActivity=ActivityRecord{x u${options.bad==='foreign-user'&&captures===2?10:0} ${options.bad==='foreign-package'&&captures===2?'foreign.app':'com.taobao.taobao'}/.Activity t1}`};
   }
   if(args.includes('screencap')){captures++;return {stdout:fs.readFileSync(new URL(id+'.png',history))};}
   if(args.includes('input')){sent.push([...args]);entered=true;if(options.bad==='unknown-input')throw Error('synthetic input timeout');return {stdout:''};}
   throw Error('Unexpected offline adb operation');
  }
  if(args.length===2&&!args[1].includes('.title-')){
   const raw=JSON.parse(fs.readFileSync(new URL(id+'.ocr.json',history),'utf8'));raw.pages[0].file=args[1];
   if(entered)raw.pages[0].lines=[{text:'本次任务已完成',bounds:[200,500,700,550]}];
   else if(captures===2){
    const lines=raw.pages[0].lines;
    const row=lines.find((l:any)=>l.text.includes(task.name));
    if(options.bad==='ambiguous')lines.push({...row,bounds:row.bounds.map((v:number,i:number)=>v+(i%2?80:0))});
    if(options.bad==='disappeared')row.text='其他任务（0/1）';
    if(options.bad==='complete')row.text=row.text.replace('0/1','1/1');
    if(options.bad==='requirement')lines.find((l:any)=>l.text.includes('下单最高')).text='搜索并输入商品名称';
    if(options.bad==='button')lines.find((l:any)=>l.text==='去完成'&&l.bounds[1]>1800&&l.bounds[1]<2000).text='领取奖励';
    if(options.bad==='overlay')lines.push({text:'温馨提示',bounds:[300,900,700,1000]});
    if(options.bad==='expired')clock+=15001;
    // Deliberately move only the actual current row button, proving coordinates are regenerated.
    for(const l of lines.filter((l:any)=>l.text==='去完成'&&l.bounds[1]>1800&&l.bounds[1]<2000))l.bounds=l.bounds.map((v:number,i:number)=>v+(i%2?12:0));
   }
   fs.writeFileSync(args[0],JSON.stringify(raw));
  }else fs.writeFileSync(args[0],JSON.stringify({pages:args.slice(1).map(file=>({file,width:1,height:1,lines:[]}))}));
  return {stdout:''};
 }});
 const boundary={capture:async()=>{const f=await device.capture();if(options.bad==='duplicate'&&captures===2)f.id=requests[0].frame.id;return f;},act:async(a:any,f:any,limits:any)=>{actionForeground=true;return device.act(a,f,limits);}};
 const cfg={package:'com.taobao.taobao',scope:{appId:'a',accountId:'offline',activityId:'c',userId:0},panelMarker:'赚金币抵钱',aiPanelReader:true,panelReadPolicy:'focused-v1',taskObservationPolicy:'current-components-v1',taskCompletionPolicy:options.legacy?undefined:'current-keywords-v1',learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},limits:{agentCalls:8,stageMs:90000,sessionMs:300000,stageActions:4,maxReturns:3},stages:{open_task:{goal:'entry',checkpoint:'entered'}}};
 if(options.development)(cfg as any).executionPolicy='development-unbounded-v1';
 const rt=createStagedRuntime(cfg,boundary,{query:async(r:any)=>{requests.push(r);queries++;const answer=JSON.parse(fs.readFileSync(answerPath,'utf8'));if(!r.panelReadMode)return {isPanel:true,balance:2525,blocked:false,top:true,bottom:true,tasks:JSON.parse(fs.readFileSync(new URL('ai-panel-18f316ec-5715-4919-a36e-976a8cb07504.response.json',history),'utf8')).tasks.filter((t:any)=>t.name===task.name),clippedRows:[]};clock+=options.delay??15732;return answer;}},{sessionId:'offline-selected-entry',evidenceDir:dir,plan:[{name:task.name,instruction:task.instruction,decision:'do',times:1}],inspectCurrentLearnedBrowse:async()=>entered?{state:'completed',quote:'本次任务已完成',version:'current-components-v1'}:null});
 assert.equal((await rt.stage('select_task',{})).status,'completed');clock+=15001;captures=0;queries=0;requests.length=0;
 const ctx={task,taskAttemptId:'offline-attempt'};
 return {dir,rt,cfg,ctx,sent,requests,get captures(){return captures;}};
}
test('development slow selected frame enters once without an age-only recapture',async t=>{
 const h=await harness(t,{development:true,dispatchDelay:15001}),result=await h.rt.stage('open_task',h.ctx);
 assert.equal(result.status,'completed',result.error);assert.equal(h.sent.length,1);assert.equal(h.requests.length,0,'unconsumed slow selection remains usable');assert.equal(result.events.filter((e:any)=>e.type==='before_dispatch_revalidated').length,0);
 await h.rt.stage('open_task',h.ctx);assert.equal(h.sent.length,1);
});
test('slow selected-task data reaches a fresh locally rebound one-shot entry',async t=>{
 const h=await harness(t),result=await h.rt.stage('open_task',h.ctx);
 assert.equal(result.status,'completed',result.error);
 assert.equal(h.requests.length,1,'fresh entry must not require another model read');
 assert.equal(h.sent.length,1);assert.deepEqual(h.sent[0].slice(-4),['input','tap','942','1894']);
 const observed=result.events.find((e:any)=>e.type==='observed');
 assert.equal(observed.at-observed.frame.capturedAt,15732,'slow source timestamp remains honest');
 const e=result.events.find((e:any)=>e.type==='before_dispatch_revalidated');
 assert.ok(e);assert.notEqual(e.frame.id,e.sourceFrameId);assert.equal(e.frame.aiPanelEvidence,undefined);assert.equal(result.actions[0].proposal.frameId,e.frame.id);
 const events=fs.readFileSync(path.join(h.dir,'runtime.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(events.filter(e=>e.kind==='learned_entry_dispatched').length,1);
 assert.equal(events.find(e=>e.kind==='learned_entry_dispatched').sourceFrameId,e.frame.id);
 const again=await h.rt.stage('open_task',h.ctx);assert.equal(h.sent.length,1,'entry is never replayed');
});
for(const bad of ['foreign-user','foreign-package','ambiguous','disappeared','complete','requirement','button','overlay','expired','duplicate'])test(`fresh ${bad} selected frame cannot authorize entry`,async t=>{
 const h=await harness(t,{bad}),result=await h.rt.stage('open_task',h.ctx);
 assert.notEqual(result.status,'completed');assert.equal(h.sent.length,0);assert.equal(h.requests.length,1);assert.equal(h.captures,2,'one fresh local attempt only');
});
test('real device rechecks selected entry age after foreground IO',async t=>{
 const h=await harness(t,{dispatchDelay:15001}),result=await h.rt.stage('open_task',h.ctx);
 assert.equal(result.status,'unknown');assert.match(result.events.find((e:any)=>e.type==='dispatch_unknown')?.error,/expired before action/);assert.equal(h.sent.length,0);
 await h.rt.stage('open_task',h.ctx);assert.equal(h.sent.length,0);
});
test('unknown selected entry input is consumed without retry',async t=>{
 const h=await harness(t,{bad:'unknown-input'}),result=await h.rt.stage('open_task',h.ctx);
 assert.equal(result.status,'unknown');assert.equal(h.sent.length,1);await h.rt.stage('open_task',h.ctx);assert.equal(h.sent.length,1);
});
test('legacy selected observation still rejects an expired source',async t=>{
 const h=await harness(t,{legacy:true}),result=await h.rt.stage('open_task',h.ctx);
 assert.equal(result.status,'stopped');assert.match(result.error,/expired/);assert.equal(h.sent.length,0);
});
test('audit independently replays selected entry from the authoritative before-dispatch frame',async t=>{
 const h=await harness(t),stage=await h.rt.stage('open_task',h.ctx);
 assert.equal(stage.status,'completed');
 const verify=(audit as any).verifyAuditSelectedEntry;
 assert.equal(typeof verify,'function','audit needs independent fresh selected-entry replay');
 const options={root:h.dir,stage,config:h.cfg,task:h.ctx.task,taskAttemptId:h.ctx.taskAttemptId};
 const proof=await verify(options);assert.ok(proof);assert.equal(proof.frame.id,stage.actions[0].proposal.frameId);
 for(const mutate of [
  (s:any)=>s.events.find((e:any)=>e.type==='before_dispatch_revalidated').sourceFrameId='wrong',
  (s:any)=>s.events.find((e:any)=>e.type==='before_dispatch_revalidated').sourceProposal.action.x++,
  (s:any)=>s.events.find((e:any)=>e.type==='before_dispatch_revalidated').proposal.action.x++,
  (s:any)=>s.events.find((e:any)=>e.type==='before_dispatch_revalidated').at+=15001,
  (s:any)=>s.events.push(structuredClone(s.events.find((e:any)=>e.type==='before_dispatch_revalidated'))),
 ]){const copy=structuredClone(stage);mutate(copy);assert.equal(await verify({...options,stage:copy}),null);}
 assert.equal(await verify({...options,task:{...h.ctx.task,instruction:'其他要求'}}),null);
 const e=stage.events.find((e:any)=>e.type==='before_dispatch_revalidated');
 const raw=e.frame.path.replace(/\.png$/,'.ocr.json'),bytes=fs.readFileSync(raw);fs.writeFileSync(raw,'{}');
 assert.equal(await verify(options),null);fs.writeFileSync(raw,bytes);
});
