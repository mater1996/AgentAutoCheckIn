// Real saved run216 pixels/text through engine/runtime/device; offline only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AdbOcrDevice} from '../runner/staged/device.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {verifyAuditActivityNavigation,verifyAuditNavigationStages,verifyAuditBalanceComponent} from '../runner/staged/script-validation.ts';
import {readPanel} from '../runner/staged/observations.ts';
const root=path.resolve(import.meta.dirname,'..');
const source=path.join(root,'evidence/staged-2026-11-01T19-32-41-877Z/55a6d09a-1b77-4952-91ce-fa867d076087');
const owner={package:'com.taobao.taobao',userId:0};
const execute=promisify(execFile);
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
async function replay(t:any){
 const base=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/text-policy-integration-');
 t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const evidenceDir='evidence/offline',out=path.join(base,evidenceDir);fs.mkdirSync(out,{recursive:true});
 let captures=0;const actions:string[]=[];
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:out,balanceComponent:true,frameMaxAgeMs:15000,exec:async(file,args,limits)=>{
  if(file==='adb'){
   if(args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};
   if(args.includes('screencap')){captures++;return {stdout:fs.readFileSync(source+'.png')};}
   actions.push(args.join(' '));throw Error('No device action authorized in offline panel replay');
  }
  assert.ok(args.every(p=>p.startsWith(out+path.sep)));
  if(args[1].endsWith('.balance.png'))return execute(file,args,{timeout:limits?.timeoutMs,maxBuffer:1024*1024});
  const raw=read(source+'.ocr.json');raw.pages[0].file=args[1];fs.writeFileSync(args[0],JSON.stringify(raw));return {stdout:''};
 }});
 const cfg={...owner,scope:{appId:'taobao',accountId:'offline',activityId:'tb_coin',userId:0},localActivityNavigation:true,balanceComponent:true,scriptValidationMode:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:10000,sessionMs:30000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 const sessionId='offline-text-policy',taskAttemptId='offline-text-attempt';fs.writeFileSync(path.join(out,'session.json'),JSON.stringify({id:sessionId,startedAt:new Date().toISOString()}));
 const rt=createStagedRuntime(cfg,device,{query:async()=>{throw Error('No model');}},{sessionId,evidenceDir:out,plan:[]});
 const stages=[await rt.stage('enter_activity',{taskAttemptId}),await rt.stage('open_list',{taskAttemptId})];
 return {base,evidenceDir,out,cfg,sessionId,taskAttemptId,stages,actions,captures};
}
test('run216 text policy crosses real engine runtime device with accepted balance and no model or tap',async t=>{
 const r=await replay(t);r.stages.forEach(s=>assert.equal(s.status,'completed',s.error));assert.deepEqual(r.actions,[]);assert.equal(r.captures,2);
 for(const s of r.stages){
  const f=s.events.find((e:any)=>e.type==='observed').frame;
  assert.equal(f.balanceEvidence.version,'ocr-region-v5');assert.equal(readPanel(f).balance,2265);
  assert.equal(await verifyAuditBalanceComponent({root:r.base,frame:f,expectedValue:2265}),true);
  assert.equal((await verifyAuditActivityNavigation({root:r.base,frame:f,owner}))?.state,'panel','Text audit must not require historical panel source files');
  assert.equal(s.review.candidate.version,'panel-text-v4','Review must describe the actual recognized text panel');
 }
 const runtime=fs.readFileSync(path.join(r.out,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 assert.equal(await verifyAuditNavigationStages({...r,root:r.base,config:r.cfg,runtime}),true);
});
