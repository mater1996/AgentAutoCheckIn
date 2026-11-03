// Saved real run214 landing; self-reference regression is not live acceptance.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash}from'node:crypto';import sharp from 'sharp';
import {inspectLearnedActivityNavigation,activityRenderedLandingSource}from'../runner/staged/activity-navigation.ts';
import {verifyAuditActivityNavigation}from'../runner/staged/script-validation.ts';
import {createStagedRuntime}from'../runner/staged/runtime.ts';
import {AdbOcrDevice}from'../runner/staged/device.ts';
const root=path.resolve(import.meta.dirname,'..'),base='evidence/staged-2026-11-01T19-06-12-676Z/',id='de799f1e-3112-400e-853d-9a5c6b72e4f9';
const owner={package:'com.taobao.taobao',userId:0},sha=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const original=()=>JSON.parse(fs.readFileSync(path.join(root,base+id+'.json'),'utf8'));
const noExec={exec:async()=>{throw Error('No OCR or device allowed');}};
async function fixture(t:any){const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/landing214-test-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const frame=original();frame.path=path.join(dir,'frame.png');fs.copyFileSync(path.join(root,base+id+'.png'),frame.path);fs.writeFileSync(frame.path.replace('.png','.json'),JSON.stringify(frame));return {dir,frame};}
test('run214 original landing is accepted with original full guards and independently replayed',async t=>{
 const {frame}=await fixture(t),before=JSON.stringify(frame);const known=await inspectLearnedActivityNavigation(frame,owner,root,noExec);
 assert.equal(known?.state,'landing','Real saved run214 landing must match');assert.deepEqual(known.action,{type:'tap',x:115,y:998});
 assert.equal(known.version,activityRenderedLandingSource.version);assert.equal(known.matchedComponents,undefined);assert.equal(JSON.stringify(frame),before);
 const audit=await verifyAuditActivityNavigation({root,frame:original(),owner});assert.equal(audit?.state,'landing');assert.deepEqual(audit.action,known.action);
});
test('run214 original source pair is hash pinned',()=>{
 const refs=activityRenderedLandingSource.files.filter(f=>f.path.includes(id));assert.equal(refs.length,2);
 for(const ref of refs)assert.equal(sha(path.join(root,ref.path)),ref.sha256);
 assert.equal(sha(path.join(root,base+id+'.png')),'296f0512d2118daeaf82b3688ead6d26395b75e6cf81e4eb155b6910321fb115');
 assert.equal(sha(path.join(root,base+id+'.json')),'4199dff97227445af634e5d545d9d96d21a988e348000ae88fabb3baa46b8005');
});
test('run214 landing through real engine runtime device boundary sends one coin tap then confirms historical panel',async t=>{
 const {dir}=await fixture(t);let index=0;const sent:any[]=[];
 const sources=[base+id+'.json','evidence/staged-2026-11-01T11-56-23-111Z/55b28a1a-f5f7-4939-9724-c478d02bf8ca.json'];
 const device=new AdbOcrDevice({serial:'OFFLINE',evidenceDir:dir,exec:async(file,args)=>{
  if(file==='adb'){
   if(args.includes('dumpsys'))return {stdout:'topResumedActivity=ActivityRecord{x u0 com.taobao.taobao/.Main}'};
   if(args.includes('screencap'))return {stdout:fs.readFileSync(path.join(root,sources[index].replace('.json','.png')))};
   if(args.includes('tap')){sent.push(args);index=1;return {stdout:''};}
   throw Error('Forbidden offline command');
  }
  assert.equal(args.length,2);assert.ok(args.every(p=>p.startsWith(dir+path.sep)));const raw=JSON.parse(fs.readFileSync(path.join(root,sources[index].replace('.json','.ocr.json')),'utf8'));raw.pages[0].file=args[1];fs.writeFileSync(args[0],JSON.stringify(raw));return {stdout:''};
 }});
 const cfg={...owner,scope:{appId:'taobao',accountId:'offline',activityId:'tb_coin',userId:0},localActivityNavigation:true,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:8000,sessionMs:15000,stageActions:3,agentCalls:0},stages:{open_list:{goal:'list',checkpoint:'list'}}};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{throw Error('No model');}},{sessionId:'synthetic-landing214',evidenceDir:dir,plan:[]});
 const result=await rt.stage('open_list',{});assert.equal(result.status,'completed',result.error);assert.equal(sent.length,1);
 const events=fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));const attempt=events.find(e=>e.kind==='activity_navigation_attempted');
 assert.deepEqual(attempt.action,{type:'tap',x:115,y:998});assert.equal(attempt.provenance.version,activityRenderedLandingSource.version);assert.equal(Object.hasOwn(attempt,'matchedComponents'),false);
 await rt.stage('open_list',{});assert.equal(sent.length,1,'No replay on stage reentry');
});
const boxes={back:[15,115,110,205],cart:[775,115,875,205],sound:[880,115,975,205],menu:[980,115,1065,205],label:[20,225,195,282],entry:[0,885,235,1035],android:[0,2280,1080,2400],labelBottom:[48,281,114,282],entryText:[60,996,170,1025],soundCenter:[900,145,920,165]};
for(const [name,b]of Object.entries(boxes))test('run214 rejects stale OCR over '+name,async t=>{
 const {dir,frame}=await fixture(t);const p=path.join(dir,'covered.png');await sharp(frame.path).composite([{input:{create:{width:b[2]-b[0],height:b[3]-b[1],channels:3,background:'#777'}},left:b[0],top:b[1]}]).png().toFile(p);
 assert.equal(await inspectLearnedActivityNavigation({...frame,path:p},owner,root,noExec),null);
});
for(const mode of ['user','package','duplicate','risk','bounds','alias'])test('run214 rejects '+mode,async t=>{
 const {frame}=await fixture(t);if(mode==='user')frame.userId=999;if(mode==='package')frame.package='com.other';
 const line=frame.lines.find((l:any)=>l.text==='去赚金币');if(mode==='duplicate')frame.lines.push(structuredClone(line));if(mode==='bounds')line.bounds=line.bounds.map((n:number)=>n+6);if(mode==='alias')line.text='去赚金市';if(mode==='risk')frame.lines.push({text:'请求授权',bounds:[100,800,400,850]});
 assert.equal(await inspectLearnedActivityNavigation(frame,owner,root,noExec),null);
});
for(const ext of ['png','json'])test('run214 rejects changed pinned source '+ext,async t=>{
 const {dir,frame}=await fixture(t),sources=path.join(dir,'sources');
 for(const ref of activityRenderedLandingSource.files){const dest=path.join(sources,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,ref.path),dest);}
 const {activityLandingSource}=await import('../runner/staged/activity-navigation.ts');for(const ref of activityLandingSource.files){const dest=path.join(sources,ref.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,ref.path),dest);}
 assert.equal((await inspectLearnedActivityNavigation(frame,owner,sources,noExec))?.state,'landing');
 fs.appendFileSync(path.join(sources,base+id+'.'+ext),'tamper');assert.equal(await inspectLearnedActivityNavigation(frame,owner,sources,noExec),null);
});
