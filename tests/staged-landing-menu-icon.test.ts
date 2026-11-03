// Original run215 held-out frame; offline only, no new visual source.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
import {inspectLearnedActivityNavigation,activityLandingSource,activityRenderedLandingSource,activityPanelSource} from '../runner/staged/activity-navigation.ts';
import {verifyAuditActivityNavigation,verifyAuditNavigationStages} from '../runner/staged/script-validation.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';import {createStagedRuntime} from '../runner/staged/runtime.ts';
const root=path.resolve(import.meta.dirname,'..'),dir='evidence/staged-2026-11-01T19-20-19-528Z/',id='4112d9bb-7e76-4efb-aa52-3c625652a401';
const owner={package:'com.taobao.taobao',userId:0},read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const original=()=>read(path.join(root,dir+id+'.json'));const noExec={exec:async()=>{throw Error('No OCR');}};
async function fixture(t:any){const base=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/menu215-');t.after(()=>fs.rmSync(base,{recursive:true,force:true}));const f=original();f.path=path.join(base,'frame.png');fs.copyFileSync(path.join(root,dir+id+'.png'),f.path);return {base,f};}
test('original run215 absent menu OCR is recognized by full existing pixel contract and independent audit',async t=>{
 const {f}=await fixture(t),before=JSON.stringify(f);assert.ok(!f.lines.some((l:any)=>l.text==='•••'));
 const known=await inspectLearnedActivityNavigation(f,owner,root,noExec);assert.equal(known?.state,'landing','Original run215 must not require icon to become OCR text');assert.deepEqual(known.action,{type:'tap',x:115,y:998});
 assert.equal(JSON.stringify(f),before);assert.equal((await verifyAuditActivityNavigation({root,frame:original(),owner}))?.state,'landing');
 assert.ok([...activityLandingSource.files,...activityRenderedLandingSource.files].every(r=>!r.path.includes(id)),'No self-reference added');
});
for(const [name,b]of Object.entries({menu:[980,115,1065,205],dot:[986,151,1000,168],back:[15,115,110,205],cart:[775,115,875,205],audio:[880,115,975,205],identity:[20,225,195,282],entry:[0,885,235,1035],android:[0,2280,1080,2400]}))test('absent OCR still rejects stale pixels '+name,async t=>{
 const {base,f}=await fixture(t);const p=path.join(base,'covered.png');await sharp(f.path).composite([{input:{create:{width:b[2]-b[0],height:b[3]-b[1],channels:3,background:'#777'}},left:b[0],top:b[1]}]).png().toFile(p);assert.equal(await inspectLearnedActivityNavigation({...f,path:p},owner,root,noExec),null);
});
for(const mode of ['duplicate','bounds','alias','unknown-text','owner','risk','missing-entry'])test('menu icon policy retains rejection '+mode,async t=>{
 const {f}=await fixture(t);const previous=read(path.join(root,dir+'dcb93c3e-1a58-408d-bcb7-d189b5099414.json'));const menu=previous.lines.find((l:any)=>l.text==='•••');
 if(mode==='duplicate')f.lines.push(menu,structuredClone(menu));if(mode==='bounds')f.lines.push({...menu,bounds:menu.bounds.map((n:number)=>n+6)});if(mode==='alias')f.lines.push({...menu,text:'...'});if(mode==='unknown-text')f.lines.push({...menu,text:'未知'});if(mode==='owner')f.userId=999;if(mode==='risk')f.lines.push({text:'请授权',bounds:[100,800,300,850]});if(mode==='missing-entry')f.lines=f.lines.filter((l:any)=>l.text!=='去赚金币');
 assert.equal(await inspectLearnedActivityNavigation(f,owner,root,noExec),null);
});
test('menu icon policy retains present exact menu OCR validation',async t=>{const {f}=await fixture(t);const previous=read(path.join(root,dir+'dcb93c3e-1a58-408d-bcb7-d189b5099414.json'));f.lines.push(previous.lines.find((l:any)=>l.text==='•••'));assert.equal((await inspectLearnedActivityNavigation(f,owner,root,noExec))?.state,'landing');});
test('absent-menu original passes real engine runtime device and durable independent navigation audit',async t=>{
 const {base}=await fixture(t);const evidenceDir='evidence/offline',out=path.join(base,evidenceDir);fs.mkdirSync(out,{recursive:true});
 for(const ref of [...activityLandingSource.files,...activityRenderedLandingSource.files,...activityPanelSource.files]){const p=path.join(base,ref.path);fs.mkdirSync(path.dirname(p),{recursive:true});fs.copyFileSync(path.join(root,ref.path),p);}
 const sessionId='offline-menu215',taskAttemptId='offline-attempt';fs.writeFileSync(path.join(out,'session.json'),JSON.stringify({id:sessionId,startedAt:new Date().toISOString()}));
 const sources=[dir+id+'.json',activityPanelSource.files[1].path];let index=0,taps=0;
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:out,exec:async(file,args)=>{
  if(file==='adb'){if(args.includes('dumpsys'))return{stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};if(args.includes('screencap'))return{stdout:fs.readFileSync(path.join(root,sources[index].replace('.json','.png')))};if(args.includes('tap')){taps++;index=1;return{stdout:''};}throw Error('Forbidden command');}
  assert.ok(args.every(p=>p.startsWith(out+path.sep)));const raw=read(path.join(root,sources[index].replace('.json','.ocr.json')));raw.pages[0].file=args[1];fs.writeFileSync(args[0],JSON.stringify(raw));return{stdout:''};
 }});
 const cfg={...owner,scope:{appId:'taobao',accountId:'offline',activityId:'tb_coin',userId:0},localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:8000,sessionMs:20000,stageActions:3,agentCalls:0},stages:{enter_activity:{goal:'coin',checkpoint:'activity'},open_list:{goal:'list',checkpoint:'list'}}};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{throw Error('No model');}},{sessionId,evidenceDir:out,plan:[]});const stages=[await rt.stage('enter_activity',{taskAttemptId}),await rt.stage('open_list',{taskAttemptId})];stages.forEach(s=>assert.equal(s.status,'completed',s.error));assert.equal(taps,1);
 const runtime=fs.readFileSync(path.join(out,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));assert.equal(await verifyAuditNavigationStages({root:base,evidenceDir,config:cfg,stages,runtime,sessionId,taskAttemptId}),true);
 await rt.stage('open_list',{taskAttemptId});assert.equal(taps,1);
});
