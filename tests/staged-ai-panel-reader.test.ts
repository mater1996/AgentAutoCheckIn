import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {VisionClient} from '../runner/staged/vision-client.ts';

const source=path.resolve('evidence/staged-2026-11-01T23-38-18-381Z/4cfce720-55ce-4c26-bdbd-4f11d5d73eaf.png');
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const owner={package:'com.taobao.taobao',userId:0};
// Explicitly synthetic response; only the HTTP boundary is mocked. PNG is a real saved image.
function synthetic():any{return {isPanel:true,balance:2265,blocked:false,top:true,bottom:false,tasks:[{name:'合成测试任务',instruction:'浏览5秒',done:0,total:1,reward:20,rewardMin:null,rewardMax:null,rewardOffers:[{condition:'浏览5秒',reward:20,rewardMin:null,rewardMax:null}],button:'去完成',bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]}],clippedRows:[]};}
function fixture(t:any){const dir=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'ai-panel-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'frame.png');fs.copyFileSync(source,file);return {dir,frame:{id:'synthetic-frame',path:file,width:1080,height:2400,capturedAt:Date.now(),...owner,lines:[{text:'deliberately incorrect OCR',bounds:[0,0,1,1]}],observationError:'OCR unavailable'}};}
async function reader(){return import('../runner/staged/ai-panel-reader.ts');}
function client(response:any,onRequest?:(body:any)=>void){return new VisionClient({baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic-test-key',model:'synthetic-vision',fetch:async(_url,init)=>{onRequest?.(JSON.parse(String(init?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}],usage:{prompt_tokens:5000,completion_tokens:300,total_tokens:5300}}));}});}

test('single supplied PNG query persists evidence and reads without OCR authority',async t=>{
 const {readAiPanel,loadAiPanel}=await reader();const {dir,frame}=fixture(t);let calls=0;
 const model=client(synthetic(),body=>{calls++;const content=body.messages[1].content;assert.equal(content[1].image_url.url,'data:image/png;base64,'+fs.readFileSync(source).toString('base64'));assert.ok(!content[0].text.includes('deliberately incorrect OCR'));});
 const before=JSON.stringify(frame);const evidence=await readAiPanel({frame,owner,model,evidenceDir:dir,maxMs:45000});
 assert.equal(calls,1);assert.equal(JSON.stringify(frame),before);assert.equal(evidence.version,'ai-panel-v1');assert.equal(evidence.sourcePngSha256,hash(fs.readFileSync(source)));
 assert.equal(loadAiPanel({...frame,aiPanelEvidence:evidence})?.balance,2265);assert.equal(loadAiPanel({...frame,lines:[],aiPanelEvidence:evidence})?.tasks[0].reward,20);
 assert.equal(loadAiPanel(frame),null);assert.ok(fs.existsSync(evidence.path));
});

test('rejects tampered PNG, response, sidecar, wrong owner/frame/version and foreign session',async t=>{
 const {readAiPanel,loadAiPanel}=await reader();const {dir,frame}=fixture(t);
 const e=await readAiPanel({frame,owner,model:client(synthetic()),evidenceDir:dir,maxMs:45000});const bound={...frame,aiPanelEvidence:e};
 assert.equal(loadAiPanel({...bound,userId:999}),null);
 assert.equal(loadAiPanel({...bound,package:'other.package'}),null);
 assert.equal(loadAiPanel({...bound,id:'other-frame'}),null);
 assert.equal(loadAiPanel({...bound,capturedAt:frame.capturedAt+1}),null);
 assert.equal(loadAiPanel({...bound,aiPanelEvidence:{...e,version:'ai-panel-v0'}}),null);
 assert.equal(loadAiPanel({...bound,aiPanelEvidence:{...e,owner:{...owner,userId:999}}}),null);
 const original=fs.readFileSync(frame.path);fs.appendFileSync(frame.path,'tampered');assert.equal(loadAiPanel(bound),null);fs.writeFileSync(frame.path,original);
 const raw=fs.readFileSync(e.rawResponse!.path);fs.appendFileSync(e.rawResponse!.path,' ');assert.equal(loadAiPanel(bound),null);fs.writeFileSync(e.rawResponse!.path,raw);
 const side=fs.readFileSync(e.path);fs.appendFileSync(e.path,' ');assert.equal(loadAiPanel(bound),null);fs.writeFileSync(e.path,side);
 assert.equal(loadAiPanel({...bound,aiPanelEvidence:{...e,rawResponse:{path:source,sha256:hash(fs.readFileSync(source))}}}),null);
 // Rehashing a foreign manifest must not grant permission to leave the session.
 const foreign=path.join(fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),'ai-foreign-')),'foreign.json');t.after(()=>fs.rmSync(path.dirname(foreign),{recursive:true,force:true}));fs.copyFileSync(e.path,foreign);
 assert.equal(loadAiPanel({...bound,aiPanelEvidence:{...e,path:foreign}}),null);
 assert.equal(loadAiPanel(bound)?.balance,2265);
});

test('unknown/range/conditional rewards remain distinct; model name is bound',async t=>{
 const {readAiPanel,loadAiPanel}=await reader();const {dir,frame}=fixture(t);const p=synthetic();
 p.tasks[0].reward=20;p.tasks[0].rewardOffers.push({condition:'下单最高',reward:null,rewardMin:null,rewardMax:1000});p.balance=null;
 const e=await readAiPanel({frame,owner,model:client(p),modelName:'synthetic-vision',evidenceDir:dir,maxMs:45000});
 assert.equal(e.modelName,'synthetic-vision');const panel=loadAiPanel({...frame,aiPanelEvidence:e})!;assert.equal(panel.balance,null);assert.equal(panel.tasks[0].reward,20);assert.equal(panel.tasks[0].rewardOffers[1].rewardMax,1000);
 const range=synthetic();range.tasks[0].reward=null;range.tasks[0].rewardMin=10;range.tasks[0].rewardMax=30;
 const r=await readAiPanel({frame,owner,model:client(range),evidenceDir:dir,maxMs:45000});assert.equal(loadAiPanel({...frame,aiPanelEvidence:r})?.tasks[0].reward,null);assert.equal(loadAiPanel({...frame,aiPanelEvidence:r})?.tasks[0].rewardMax,30);
});

test('failed query has one attempt, remaining time budget and persistent rejection',async t=>{
 const {readAiPanel,loadAiPanel}=await reader();const {dir,frame}=fixture(t);let calls=0;let budget=0;
 const model={usage:[{synthetic:'prior call'}],query:async(r:any)=>{calls++;budget=r.maxMs;model.usage.push({synthetic:'failed call'});throw Error('synthetic failure - no actual provider');}};
 const e=await readAiPanel({frame,owner,model,evidenceDir:dir,maxMs:1234});assert.equal(calls,1);assert.ok(budget>0&&budget<=1234);assert.equal(e.status,'rejected');assert.equal(e.rawResponse,null);assert.deepEqual(e.usage,[{synthetic:'failed call'}]);assert.ok(fs.existsSync(e.path));assert.equal(loadAiPanel({...frame,aiPanelEvidence:e}),null);
});

test('rejects ambiguous geometry and malformed quotas/rewards while preserving rejected response',async t=>{
 const {readAiPanel,loadAiPanel}=await reader();const {dir,frame}=fixture(t);
 const cases:any[]=[];
 for(const mutate of [
  (p:any)=>p.tasks[0].done=2,
  (p:any)=>p.tasks[0].total=1.5,
  (p:any)=>p.tasks[0].point=[50,50],
  (p:any)=>p.tasks[0].bounds=[0,0,2000,100],
  (p:any)=>p.tasks.push({...p.tasks[0],name:'another row'}),
  (p:any)=>p.tasks[0].reward=-1,
  (p:any)=>{p.tasks[0].rewardMin=30;p.tasks[0].rewardMax=10;},
  (p:any)=>p.action={type:'tap'},
  (p:any)=>p.balance='2265',
  (p:any)=>p.isPanel=false,
 ]){const p=synthetic();mutate(p);cases.push(p);}
 for(const p of cases){const e=await readAiPanel({frame,owner,model:client(p),evidenceDir:dir,maxMs:45000});assert.equal(e.status,'rejected');assert.ok(e.rawResponse);assert.equal(loadAiPanel({...frame,aiPanelEvidence:e}),null);}
});
