import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {verifyAuditNavigationStages} from '../runner/staged/script-validation.ts';
const root=path.resolve(import.meta.dirname,'..');
const owner={package:'com.taobao.taobao',userId:0};
const sources={home:'evidence/staged-2026-11-02T01-25-13-762Z/8481bb37-6035-4ee2-87bb-f41b989c4a78.json',landing:'evidence/staged-2026-11-01T14-18-29-240Z/2ef5882b-2795-4d31-8d52-2fb3bf75c1f1.json',panel:'evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json'};
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
// Historical PNG/OCR; relocation and all clocks/transitions are synthetic offline replay.
async function replay(t:any,mode='normal',recoverStage='enter_activity'){
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/pre-dispatch-foreground-');
 t.after(()=>{if(process.env.CHECKIN_KEEP_FOREGROUND_REPLAY==='1')console.log('OFFLINE_REPLAY_EVIDENCE',dir);else fs.rmSync(dir,{recursive:true,force:true});});
 const pinned=Object.values(sources).flatMap(f=>[f,f.replace('.json','.png'),f.replace('.json','.ocr.json')]).map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]);
 t.after(()=>{for(const [f,sha]of pinned)assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex'),sha);});
 let state:keyof typeof sources=recoverStage==='open_list'?'landing':'home',reads=0,shots=0,missing=0,queries=0,recovered=false;
 const inputs:string[][]=[];
 const target=()=>state==='home'?'领淘金币':'去赚金币';
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,frameMaxAgeMs:15000,now:()=>Date.now()-(mode==='expired'&&recovered?20000:0),exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys')){
    reads++;
    if(mode==='deadline-at-gate'&&reads===6)await new Promise(resolve=>setTimeout(resolve,650));
    // Two foreground observations belong to each capture; the third is act's gate.
    if((reads===3&&mode!=='input-error-initial')||(mode==='twice'&&reads===6)||(mode==='both-stages'&&reads===13)||(mode==='missing-recapture'&&reads===4)){
     missing++;recovered=true;
     if(mode==='forged')throw Object.assign(Error('Foreground missing or ambiguous'),{recorded:true,inputSent:false});
     if(mode==='owner-at-act')return {stdout:'topResumedActivity=ActivityRecord{x u999 com.taobao.taobao/.Main}'};
     if(mode==='ambiguous')return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}\ntopResumedActivity=ActivityRecord{y u999 com.taobao.taobao/.Other}'};
     if(mode==='malformed')return {stdout:'topResumedActivity=invalid'};
     return {stdout:'ACTIVITY MANAGER ACTIVITIES (no resumed markers)'};
    }
    return {stdout:`topResumedActivity=ActivityRecord{x u${mode==='owner-new-frame'&&recovered?999:0} com.taobao.taobao/.Main}`};
   }
   if(args.includes('screencap')){shots++;return {stdout:fs.readFileSync(path.join(root,sources[mode==='different-page'&&recovered?'panel':state].replace('.json','.png')))};}
   if(args.includes('input')){inputs.push(args);if(args.includes('tap')){if(['input-error','input-error-initial'].includes(mode))throw Error('transport lost after input');state=state==='home'?'landing':'panel';}return {stdout:''};}
   throw Error('Unexpected offline adb command: '+args.join(' '));
  }
  assert.ok(args.every(p=>p.startsWith(dir+path.sep)));
  const raw=read(path.join(root,sources[mode==='different-page'&&recovered?'panel':state].replace('.json','.ocr.json')));raw.pages[0].file=args[1];
  if(recovered&&state!=='panel'){
   for(const l of raw.pages[0].lines){if(l.text===target())l.bounds=l.bounds.map((v:number,i:number)=>v+(i%2===0?12:15));}
   if(mode==='different-target')raw.pages[0].lines.find((l:any)=>l.text===target()).text='其他入口';
   if(mode==='obscured')raw.pages[0].lines.push({text:'安全验证',bounds:[200,800,600,850]});
  }
  fs.writeFileSync(args[0],JSON.stringify(raw));
  if(mode==='deadline'&&recovered)await new Promise(resolve=>setTimeout(resolve,650));
  return {stdout:''};
 }});
 const sessionId='offline-'+randomUUID(),taskAttemptId='attempt-'+randomUUID();
 const cfg={...owner,scope:{appId:'taobao',accountId:'offline',activityId:'coins',userId:0},navigationPolicy:'current-text-v1',localActivityNavigation:true,aiPanelReader:false,scriptValidationMode:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:10000,sessionMs:60000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'activity',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({id:sessionId,startedAt:new Date().toISOString()}));
 if(mode.startsWith('deadline'))cfg.limits.stageMs=500;
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('Model forbidden');}},{sessionId,evidenceDir:dir,plan:[]});
 const result=await rt.stage(recoverStage,{taskAttemptId});
 const runtime=readLines('runtime.jsonl');
 function readLines(f:string){return fs.readFileSync(path.join(dir,f),'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));}
 return {dir,rt,cfg,result,runtime,sessionId,taskAttemptId,inputs,missing,shots,queries,readLines};
}
test('one missing pre-dispatch foreground rebinds actual engine tap to a fresh moved target',async t=>{
 const d=await replay(t);assert.equal(d.result.status,'completed',d.result.error);
 const taps=d.inputs.filter(a=>a.includes('tap'));assert.equal(taps.length,1);assert.equal(d.queries,0);assert.equal(d.missing,1);
 const original=d.result.events.find((e:any)=>e.type==='observed').frame;
 const rebound=d.result.events.find((e:any)=>e.type==='dispatch_not_sent_revalidated');assert.ok(rebound);
 assert.notEqual(rebound.frame.id,original.id);assert.equal(d.result.actions.length,1);assert.equal(d.result.actions[0].proposal.frameId,rebound.frame.id);
 assert.notEqual(rebound.proposal.action.x,rebound.sourceProposal.action.x);assert.deepEqual(taps[0].slice(-2),[String(rebound.proposal.action.x),String(rebound.proposal.action.y)]);
 const list=await d.rt.stage('open_list',{taskAttemptId:d.taskAttemptId});assert.equal(list.status,'completed',list.error);
 const options={root:d.dir,evidenceDir:d.dir,config:d.cfg,stages:[d.result,list],runtime:d.readLines('runtime.jsonl'),sessionId:d.sessionId,taskAttemptId:d.taskAttemptId};
 if(process.env.CHECKIN_KEEP_FOREGROUND_REPLAY==='1')fs.writeFileSync(path.join(d.dir,'offline-audit-input.json'),JSON.stringify(options,null,2));
 assert.equal(await verifyAuditNavigationStages(options),true,'independent audit must accept the actual recovered trace');
 for(const mode of ['missing-proof','changed-action','wrong-attempt','duplicate-allowance','old-frame-proposal','missing-engine-event','missing-sent']){
  const altered=structuredClone(options),chain=altered.runtime.find((e:any)=>e.kind==='navigation_foreground_recovery_consumed');
  if(mode==='missing-proof')chain.proof.sha256='0'.repeat(64);
  if(mode==='changed-action')altered.stages[0].actions[0].proposal.action.x++;
  if(mode==='wrong-attempt')chain.taskAttemptId='other';
  if(mode==='duplicate-allowance')altered.runtime.push(structuredClone(chain));
  if(mode==='old-frame-proposal')altered.stages[0].actions[0].proposal.frameId=chain.sourceFrameId;
  if(mode==='missing-engine-event')altered.stages[0].events=altered.stages[0].events.filter((e:any)=>e.type!=='dispatch_not_sent_revalidated');
  if(mode==='missing-sent')altered.runtime=altered.runtime.filter((e:any)=>e.kind!=='navigation_foreground_recovery_sent');
  assert.equal(await verifyAuditNavigationStages(altered),false,mode);
 }
 // Rehash tampered files and every reference, so semantic proof checks must reject them.
 const chain=options.runtime.find((e:any)=>e.kind==='navigation_foreground_recovery_consumed'),proofFile=chain.proof.path;
 const originalProof=fs.readFileSync(proofFile),proof=JSON.parse(originalProof.toString()),foregroundFile=proof.foreground.path,originalForeground=fs.readFileSync(foregroundFile);
 for(const mode of ['sent-proof','foreground-has-marker','foreground-exec-error']){
  const altered=structuredClone(options),p=JSON.parse(originalProof.toString()),fg=JSON.parse(originalForeground.toString());
  if(mode==='sent-proof')p.inputSent=true;
  if(mode==='foreground-has-marker')fg.stdout+='\ntopResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}';
  if(mode==='foreground-exec-error')fg.result.code=1;
  const fgBytes=Buffer.from(JSON.stringify(fg));p.foreground.sha256=createHash('sha256').update(fgBytes).digest('hex');
  const proofBytes=Buffer.from(JSON.stringify(p)),newSha=createHash('sha256').update(proofBytes).digest('hex');
  const replace=(v:any)=>{if(!v||typeof v!=='object')return;if(v.path===proofFile)v.sha256=newSha;for(const x of Object.values(v))replace(x);};replace(altered);
  try{fs.writeFileSync(foregroundFile,fgBytes);fs.writeFileSync(proofFile,proofBytes);assert.equal(await verifyAuditNavigationStages(altered),false,mode);}
  finally{fs.writeFileSync(foregroundFile,originalForeground);fs.writeFileSync(proofFile,originalProof);}
 }
});
for(const mode of ['twice','missing-recapture','owner-at-act','owner-new-frame','ambiguous','malformed','forged','different-page','different-target','obscured','expired','input-error','input-error-initial'])test('pre-dispatch foreground '+mode+' stops without input replay',async t=>{
 const d=await replay(t,mode);assert.notEqual(d.result.status,'completed');assert.equal(d.queries,0);
 assert.equal(d.inputs.filter(a=>a.includes('tap')).length,mode.startsWith('input-error')?1:0);
 const consumed=d.runtime.filter(e=>e.kind==='navigation_foreground_recovery_consumed');
 assert.equal(consumed.length,['forged','owner-at-act','ambiguous','malformed','input-error-initial'].includes(mode)?0:1);
 const before=d.inputs.filter(a=>a.includes('tap')).length;
 await d.rt.stage('enter_activity',{taskAttemptId:'another-attempt'});
 assert.equal(d.inputs.filter(a=>a.includes('tap')).length,before,'a changed attempt cannot renew navigation authority');
});
test('open_list uses the same one-capture moved-target recovery',async t=>{
 const d=await replay(t,'normal','open_list');assert.equal(d.result.status,'completed',d.result.error);
 assert.equal(d.inputs.filter(a=>a.includes('tap')).length,1);assert.equal(d.result.actions.length,1);
 assert.ok(d.result.events.some((e:any)=>e.type==='dispatch_not_sent_revalidated'));
 assert.equal(d.runtime.filter(e=>e.kind==='navigation_foreground_recovery_consumed').length,1);
 const source=d.result.events.find((e:any)=>e.type==='observed').frame;
 const enter={stageId:'enter_activity',status:'completed',actions:[],events:[{type:'observed',frame:source}]};
 assert.equal(await verifyAuditNavigationStages({root:d.dir,evidenceDir:d.dir,config:d.cfg,stages:[enter,d.result],runtime:d.runtime,sessionId:d.sessionId,taskAttemptId:d.taskAttemptId}),true);
});
test('a second missing foreground in open_list cannot renew the session recovery allowance',async t=>{
 const d=await replay(t,'both-stages');assert.equal(d.result.status,'completed',d.result.error);
 const list=await d.rt.stage('open_list',{taskAttemptId:'new-attempt'});assert.equal(list.status,'unknown',list.error);
 assert.equal(d.inputs.filter(a=>a.includes('tap')).length,1);
 assert.equal(d.readLines('runtime.jsonl').filter(e=>e.kind==='navigation_foreground_recovery_consumed').length,1);
});
for(const mode of ['deadline','deadline-at-gate'])test(mode+' cannot send after the original stage deadline',async t=>{
 const d=await replay(t,mode);assert.notEqual(d.result.status,'completed');
 await new Promise(resolve=>setTimeout(resolve,300));assert.equal(d.inputs.filter(a=>a.includes('tap')).length,0);
 assert.equal(d.readLines('runtime.jsonl').filter(e=>e.kind==='navigation_foreground_recovery_consumed').length,1);
});
