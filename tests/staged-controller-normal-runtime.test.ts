import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {saveStagedResult} from '../runner/staged/store.ts';
import sharp from 'sharp';
import {buildShopBrowseContract,loadShopBrowseReplay} from '../runner/staged/shop-browse.ts';
import {buildPanelClaimContract,loadPanelClaimReplay} from '../runner/staged/panel-claim.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
import {runActivitySession} from '../runner/staged/session.ts';
const root=path.resolve(import.meta.dirname,'..'),scope={appId:'taobao',accountId:'local',activityId:'coins',userId:0};
const task={name:'任务到访得金币',instruction:'每日来任务面板'};
function config(contract:any):any{return {scope,package:'com.taobao.taobao',assetId:'coins',model:{baseUrl:'http://unused.invalid',name:'unused'},constraints:['browse only'],selectionAllowNew:false,learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},controllerCandidates:[{family:'panel-claim',task,contract}],limits:{maxTasks:1,sessionMs:30000,stageMs:15000,agentCalls:8,stageActions:10,inventoryPages:2,maxReturns:2},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}]))};}
async function harness(t:any,mode='ok'){
 const contract=await buildPanelClaimContract(root),replay=await loadPanelClaimReplay(contract),cfg=config(contract);
 cfg.controllerCandidates[0].capturePolicy={frames:2,intervalMs:250};
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/normal-controller-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let clock=Date.now(),n=0,claimed=false,captures=0,models=0;const actions:string[]=[],events:any[]=[];
 const fresh=(f:any)=>({...structuredClone(f),id:'derived-normal-'+(++n),capturedAt:clock=Date.now(),page:{derived:true,sourceId:f.id,sourceCapture:f.capturedAt,syntheticInventoryBottom:true},lines:[...f.lines,{text:'以上奖励均为最高奖励',bounds:[10,2250,200,2280]}]});
 const device={capture:async()=>{captures++;const f=fresh(claimed?replay.frames[2]:replay.frames[0]);if(claimed&&mode==='wrong-panel')f.package='wrong.app';if(claimed&&mode==='zero')f.lines=f.lines.map((l:any)=>l.text==='1440'?{...l,text:'1430'}:l);return f;},act:async(a:any)=>{actions.push(a.type);if(a.type==='tap'){claimed=true;if(mode==='unknown')throw Error('uncertain dispatch');}}};
 const opts:any={sessionId:'normal-controller',evidenceDir:dir,plan:[{...task,decision:'do'}],now:()=>Date.now(),controllerDeps:{captureRawBurst:async(request:any)=>{assert.equal(request.frames,2);assert.equal(request.intervalMs,250);events.push('raw');const f=fresh(replay.frames[1]);return {id:'derived-raw',status:'complete',frames:[f]};},deriveRawFrames:async(batch:any)=>batch.frames}};
 if(mode==='no-fast')delete opts.controllerDeps;
 const rt=createStagedRuntime(cfg,device,{query:async()=>{models++;throw Error('offline model forbidden');}},opts);
 const result=await runActivitySession({id:opts.sessionId,scope,evidenceDir:dir,startedAt:new Date().toISOString()},{prepare:async()=>{},stage:rt.stage,save:async(v)=>{fs.writeFileSync(path.join(dir,'saved.json'),JSON.stringify(v));return {runId:null};},cleanup:async()=>{}});
 return {result,rt,actions,models,events,dir,contract,cfg};
}
test('normal engine/runtime/controller/session settles historical panel and archives actual controller events',async t=>{
 const h=await harness(t);assert.equal(h.result.status,'completed',h.result.error);assert.equal(h.result.balanceBefore,1430);assert.equal(h.result.balanceAfter,1440);assert.equal(h.models,0);assert.equal(h.actions.filter(x=>x==='tap').length,1);assert.equal(h.actions.includes('back'),false);assert.deepEqual(h.events,['raw']);
 assert.equal(h.result.receipt.taskAttemptId,h.result.taskAttemptId);assert.ok(h.result.receipt.path.endsWith('frame-3.png'));
 const saved=JSON.parse(fs.readFileSync(path.join(h.dir,'saved.json'),'utf8'));const open=saved.stages.find((s:any)=>s.stageId==='open_task');assert.ok(open.review?.events.some((e:any)=>e.type==='authority_consumed'));assert.ok(h.rt.stages.some((s:any)=>s.stageId==='controller:panel-claim'&&s.events.some((e:any)=>e.type==='controller_transient_receipt')));
 // Read the actual store output in an isolated SQLite root; never open the project ledger.
 const isolated=path.join(h.dir,'store');fs.mkdirSync(path.join(isolated,'data'),{recursive:true});const db=new Database(path.join(isolated,'data/checkin.db'));
 db.exec(fs.readFileSync(path.join(root,'runner/storage/client.ts'),'utf8').split('const DDL = `')[1].split('`;')[0]);
 db.prepare('INSERT INTO account(id,app,package,user_id,cache_id) VALUES(?,?,?,?,?)').run(scope.accountId,scope.appId,'com.taobao.taobao',0,'mock');
 db.prepare('INSERT INTO activity(id,account_id,name,steps_json,verify_any,asset_id) VALUES(?,?,?,?,?,?)').run(scope.activityId,scope.accountId,'Mock','[]','[]','coins');db.close();
 const evidenceDir=path.join(isolated,'evidence');fs.mkdirSync(evidenceDir);const result=structuredClone(saved.result);
 for(const [key,source] of [['before',result.task.beforeFrame.path],['receipt',result.receipt.path]])fs.copyFileSync(source,path.join(evidenceDir,key+'.png'));
 result.task.beforeFrame={path:path.join(evidenceDir,'before.png')};result.receipt.path=path.join(evidenceDir,'receipt.png');
 await saveStagedResult({...saved,root:isolated,session:{...saved.session,evidenceDir},result});
 const stored=JSON.parse(fs.readFileSync(path.join(evidenceDir,'stages.json'),'utf8'));assert.equal(stored.find((s:any)=>s.stageId==='open_task').review.events.filter((e:any)=>e.type==='controller_transient_receipt').length,1);
 const reviews=JSON.parse(fs.readFileSync(path.join(evidenceDir,'reviews.json'),'utf8'));assert.ok(reviews.some((r:any)=>r.stageId==='open_task'&&r.review.actions.length===1));
});
test('controller continuation refuses a prior attempt before any new capture or action',async()=>{
 const contract=await buildPanelClaimContract(root),cfg=config(contract);let captured=0,acted=0;
 const rt=createStagedRuntime(cfg,{capture:async()=>{captured++;throw Error('unexpected capture');},act:async()=>{acted++;}}, {query:async()=>{throw Error('unexpected model');}}, {sessionId:'new-session',evidenceDir:'/unused',resume:{task,balanceBefore:1430},plan:[]});
 const result=await rt.stage('open_task',{task,taskAttemptId:'old-attempt',balanceBefore:1430});
 assert.equal(result.status,'stopped');assert.match(result.error,/continuation/i);assert.equal(captured,0);assert.equal(acted,0);
});
test('normal configured controller pre-rejects no fast capture and never falls into learned continuous',async t=>{const h=await harness(t,'no-fast');assert.notEqual(h.result.status,'completed');assert.equal(h.actions.filter(x=>x==='tap').length,0);assert.equal(h.models,0);});
test('unknown controller dispatch cannot be repeated by return-stage recovery',async t=>{const h=await harness(t,'unknown');assert.equal(h.result.status,'unknown');assert.equal(h.actions.filter(x=>x==='tap').length,1);assert.equal(h.models,0);});
for(const mode of ['wrong-panel','zero'])test('normal settlement refuses '+mode,async t=>{const h=await harness(t,mode);assert.notEqual(h.result.status,'completed');assert.equal(h.result.balanceAfter,null);assert.equal(h.actions.filter(x=>x==='tap').length,1);});
test('derived shop normal runtime preserves two receipt layers and settles original 1550 to 1580',async t=>{
 const contract=await buildShopBrowseContract(root),replay=await loadShopBrowseReplay(contract),cfg=config(contract);
 const selected={name:'逛好店赚一大波金币',instruction:'浏览15秒'};cfg.controllerCandidates=[{family:'shop-browse',task:selected,contract,learningBudget:{status:'candidate',maxGestures:1,gestureMs:900,observationBudgetMs:10000}}];validateStagedConfig(cfg);
 const dir=fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/normal-shop-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const list=replay.frames[1],parts=await Promise.all([510,1055].map(top=>sharp(list.path).extract({left:90,top,width:950,height:110}).png().toBuffer()));
 const derived=path.join(dir,'derived-card-order.png');await sharp(list.path).composite([{input:parts[1],left:90,top:510},{input:parts[0],left:90,top:1055}]).png().toFile(derived);
 // Original card pixels and OCR moved together; this is a synthetic ordering, not live acceptance.
 const frames=[replay.frames[0],{...list,path:derived,lines:list.lines.map((l:any)=>{const y=l.bounds[1],dy=y>=510&&y<620?545:y>=1055&&y<1165?-545:0;return {...l,bounds:l.bounds.map((v:number,i:number)=>v+(i%2?dy:0))};})},...replay.frames.slice(2)];
 let index=0,n=0,models=0;const actions:string[]=[];
 const device={capture:async()=>({...structuredClone(frames[index]),id:'derived-shop-'+(++n),capturedAt:Date.now(),page:{derived:true,originalId:frames[index].id,syntheticTopMarker:true},lines:[...frames[index].lines,{text:'完成进度 0/1',bounds:[10,400,180,430]}]}),act:async(a:any)=>{actions.push(a.type);if(a.type!=='wait')index=Math.min(index+1,frames.length-1);}};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{models++;throw Error('model forbidden');}},{sessionId:'normal-shop',evidenceDir:dir,plan:[{...selected,decision:'do'}]});
 const result=await runActivitySession({id:'normal-shop',scope,evidenceDir:dir,startedAt:new Date().toISOString()},{prepare:async()=>{},stage:rt.stage,save:async()=>({runId:null}),cleanup:async()=>{}});
 assert.equal(result.status,'completed',result.error);assert.equal(result.balanceBefore,1550);assert.equal(result.balanceAfter,1580);assert.equal(models,0);assert.deepEqual(result.receipt.layers.map((r:any)=>r.layer),['store','shopList']);assert.equal(actions.filter(a=>a==='back').length,2);assert.equal(actions.filter(a=>a==='tap').length,2);
});
test('config rejects duplicate task across families and conflicting existing browse ownership',async()=>{
 const c=await buildPanelClaimContract(root),cfg=config(c);assert.equal(validateStagedConfig(cfg),cfg);
 assert.throws(()=>validateStagedConfig({...cfg,controllerCandidates:[...cfg.controllerCandidates,{...cfg.controllerCandidates[0],family:'shop-browse'}]}),/controller|conflict/i);
 assert.throws(()=>validateStagedConfig({...cfg,dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[{task,dwellMs:5000}]}}),/conflict/i);
 assert.throws(()=>validateStagedConfig({...cfg,controllerCandidates:[{...cfg.controllerCandidates[0],contract:{...c,refs:[]}}]}),/controller/i);
});
