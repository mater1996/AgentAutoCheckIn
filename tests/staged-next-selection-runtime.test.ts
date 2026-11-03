// Synthetic saved-image replay only; no device, network, or ledger access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {createStagedRuntime} from '../runner/staged/runtime.ts';

const owner={package:'com.taobao.taobao',userId:0};
const task={name:'合成当前任务',instruction:'浏览5秒',done:0,total:1,reward:20,button:'去完成',buttonBounds:[850,710,1000,790],point:[925,750]};
const identity=({name,instruction,done,total}:any)=>({name,instruction,done,total});
async function harness(t:any,options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'next-selection-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 // Annotated synthetic PNG. The local model boundary below supplies explicit replay observations.
 const image=await sharp(Buffer.from('<svg width="1080" height="2400"><rect width="1080" height="2400" fill="white"/><text x="40" y="80">SYNTHETIC OFFLINE NEXT-SELECTION REPLAY</text><rect x="850" y="710" width="150" height="80" fill="orange"/></svg>')).png().toBuffer();
 let n=0,captures=0,page='panel';const requests:any[]=[],actions:any[]=[];
 function frame(){const f={id:'replay-'+(++n),path:path.join(dir,`replay-${n}.png`),width:1080,height:2400,capturedAt:Date.now(),...owner,lines:[]};fs.writeFileSync(f.path,image);fs.writeFileSync(f.path.replace(/\.png$/,'.json'),JSON.stringify(f));return f;}
 const source=frame(),selection:any={task:{...structuredClone(task),beforeFrame:{path:source.path,ocrPath:source.path.replace(/\.png$/,'.json')}},frame:source,balanceBefore:2265,plan:{decision:'do'},nextAction:{type:'open_task'}};
 const cfg:any={executionPolicy:'development-unbounded-v1',scope:{appId:'a',accountId:'synthetic',activityId:'c',userId:0},package:owner.package,model:{name:'offline'},panelMarker:'赚金币抵钱',aiPanelReader:true,panelReadPolicy:'focused-v1',balanceComponent:false,scriptValidationMode:false,constraints:[],learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},limits:{sessionMs:60000,stageMs:10000,agentCalls:10,stageActions:4,maxReturns:3},stages:Object.fromEntries(['open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}]))};
 const opts:any={sessionId:'next-session',evidenceDir:dir,plan:[],inspectLearnedBrowse:async()=>({state:'completed',quote:'合成本次任务已完成',version:'synthetic-local'}),...options.opts};
 const rt:any=createStagedRuntime(cfg,{capture:async()=>{captures++;return frame();},act:async(action:any,f:any)=>{actions.push({action,frame:f});if(action.type==='tap'){page='browse';if(options.unknown)throw Error('synthetic uncertain input');}if(action.type==='back')page='returned';}},{query:async(request:any)=>{requests.push(request);assert.ok(page==='panel'?request.panelReadMode?.purpose==='selected-row':['return-status','settlement'].includes(request.panelReadMode?.purpose));return {isPanel:page!=='browse',blocked:false,balance:page==='returned'?2285:page==='panel'?2265:null,taskStatus:page==='browse'?'not-panel':'visible',task:page==='panel'?{...structuredClone(task),bounds:[230,700,650,750],rewardMin:null,rewardMax:null,rewardOffers:[{condition:task.instruction,reward:20,rewardMin:null,rewardMax:null}]}:page==='returned'?{...identity(task),done:1}:null};}},opts);
 return {dir,rt,selection,source,requests,actions,opts,frame,get captures(){return captures}};
}

test('adoption completes select_task without input and real open_task consumes only a fresh focused row',async t=>{
 const h=await harness(t),ctx={taskAttemptId:'next-attempt',sessionId:'next-session'};
 const selected=await h.rt.adoptSelection(h.selection,ctx);
 assert.equal(selected.status,'completed');assert.deepEqual(selected.task,h.selection.task);assert.equal(selected.balanceBefore,2265);assert.deepEqual(selected.actions,[]);
 assert.equal(h.captures,0);assert.equal(h.requests.length,0);assert.equal(h.actions.length,0);assert.equal(h.rt.calls,0);assert.equal(h.opts.resume,undefined);
 const result=await h.rt.stage('open_task',{...ctx,task:selected.task,balanceBefore:selected.balanceBefore});
 assert.equal(result.status,'completed',result.error);
 assert.equal(h.requests.length,1);assert.equal(h.requests[0].panelReadMode.purpose,'selected-row');assert.deepEqual(h.requests[0].panelReadMode.task,identity(task));
 const taps=h.actions.filter(x=>x.action.type==='tap');assert.equal(taps.length,1);assert.notEqual(taps[0].frame.path,h.source.path);assert.notEqual(taps[0].frame.id,h.source.id);
 assert.equal(fs.existsSync(path.join(h.dir,'inventory.json')),false);
});

for(const [label,change] of [
 ['foreign package',(h:any)=>{h.selection.frame.package='foreign.app';}],
 ['foreign Android user',(h:any)=>{h.selection.frame.userId=10;}],
 ['different source identity',(h:any)=>{h.selection.frame.id='forged-id';}],
 ['different source capture time',(h:any)=>{h.selection.frame.capturedAt--;}],
 ['different source geometry',(h:any)=>{h.selection.frame.width=720;}],
 ['different original metadata',(h:any)=>{const f=h.source.path.replace(/\.png$/,'.json');const original=JSON.parse(fs.readFileSync(f,'utf8'));original.package='foreign.app';fs.writeFileSync(f,JSON.stringify(original));}],
 ['different before frame',(h:any)=>{h.selection.task.beforeFrame.path=h.frame().path;}],
 ['missing source image',(h:any)=>{fs.unlinkSync(h.source.path);}],
 ['foreign evidence directory',(h:any)=>{const sub=path.join(h.dir,'other');fs.mkdirSync(sub);const file=path.join(sub,'foreign.png');fs.copyFileSync(h.source.path,file);h.selection.frame.path=file;h.selection.task.beforeFrame.path=file;}],
 ['empty exact name',(h:any)=>{h.selection.task.name=' ';}],
 ['missing actual instruction',(h:any)=>{h.selection.task.instruction=null;}],
 ['exhausted quota',(h:any)=>{h.selection.task.done=1;}],
 ['negative quota',(h:any)=>{h.selection.task.done=-1;}],
 ['fractional quota',(h:any)=>{h.selection.task.total=1.5;}],
 ['zero balance baseline',(h:any)=>{h.selection.balanceBefore=0;}],
 ['nonfinite balance baseline',(h:any)=>{h.selection.balanceBefore=Infinity;}],
 ['point outside image',(h:any)=>{h.selection.task.point=[1080,750];}],
 ['point outside button',(h:any)=>{h.selection.task.point=[100,750];}],
 ['invalid button box',(h:any)=>{h.selection.task.buttonBounds=[1000,710,850,790];}],
 ['missing button label',(h:any)=>{h.selection.task.button='';}],
 ['different selection attempt',(h:any)=>{h.selection.taskAttemptId='foreign-attempt';}],
] as const)test('adoption refuses '+label+' before input',async t=>{
 const h=await harness(t);change(h);
 const r=await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt',sessionId:'next-session'});
 assert.equal(r.status,'stopped',r.error??'invalid selection was accepted');assert.ok(r.error);assert.deepEqual(r.actions,[]);assert.equal(h.captures,0);assert.equal(h.requests.length,0);assert.equal(h.actions.length,0);
});

test('adoption is single-use even with a new attempt identifier',async t=>{
 const h=await harness(t),ctx={taskAttemptId:'next-attempt'};
 assert.equal((await h.rt.adoptSelection(h.selection,ctx)).status,'completed');
 for(const taskAttemptId of ['next-attempt','other-attempt']){const r=await h.rt.adoptSelection(h.selection,{taskAttemptId});assert.equal(r.status,'stopped');assert.match(r.error,/already|replay|adopt/i);}
 assert.equal(h.captures,0);assert.equal(h.actions.length,0);
});

test('adoption requires the current session and nonempty attempt',async t=>{
 const h=await harness(t);
 for(const ctx of [{},{taskAttemptId:''},{taskAttemptId:'next-attempt',sessionId:'foreign-session'}])assert.equal((await h.rt.adoptSelection(h.selection,ctx)).status,'stopped');
 assert.equal(h.captures,0);assert.equal(h.actions.length,0);
});

for(const mode of ['frame-hash','selection-evidence','selection-task','selection-owner','selection-frame','selection-balance','selection-session'])test('adoption rejects changed '+mode+' binding',async t=>{
 const h=await harness(t),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 h.selection.sourcePngSha256=sha(fs.readFileSync(h.source.path));h.selection.task.frameId=h.source.id;
 const record={...structuredClone(h.selection),sessionId:'next-session',taskAttemptId:'next-attempt',owner};
 const file=path.join(h.dir,'selection.json');fs.writeFileSync(file,JSON.stringify(record));
 h.selection={...record,evidence:{path:file,sha256:sha(fs.readFileSync(file))}};
 if(mode==='frame-hash')fs.appendFileSync(h.source.path,'changed');
 if(mode==='selection-evidence')fs.appendFileSync(file,' ');
 if(mode==='selection-task')h.selection.task.instruction='foreign instruction';
 if(mode==='selection-owner')h.selection.owner={...owner,userId:10};
 if(mode==='selection-frame')h.selection.task.frameId='foreign-frame';
 if(mode==='selection-balance')h.selection.balanceBefore=999;
 if(mode==='selection-session')h.selection.sessionId='foreign-session';
 assert.equal((await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'})).status,'stopped');assert.equal(h.captures,0);assert.equal(h.actions.length,0);
});

test('adoption refuses prior continuation state',async t=>{
 const h=await harness(t,{opts:{resume:{task,balanceBefore:2265,receipt:{quote:'old receipt'}}}});
 assert.equal((await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'})).status,'stopped');assert.equal(h.captures,0);
});

test('adopted task and attempt stay bound at entry without accepting a replacement context',async t=>{
 const h=await harness(t);await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'});
 for(const ctx of [{taskAttemptId:'other-attempt',task:h.selection.task},{taskAttemptId:'next-attempt',task:{...h.selection.task,instruction:'foreign'}},{taskAttemptId:'next-attempt',task:h.selection.task,balanceBefore:999}]){
  const r=await h.rt.stage('open_task',ctx);assert.equal(r.status,'stopped');
 }
 assert.equal(h.captures,0);assert.equal(h.requests.length,0);assert.equal(h.actions.length,0);
});

test('adoption rejects an already started entry even when no task has been selected',async t=>{
 const h=await harness(t,{opts:{runStage:async()=>({status:'stopped'})}});
 await h.rt.stage('open_task',{taskAttemptId:'prior'});
 assert.equal((await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'})).status,'stopped');assert.equal(h.captures,0);
});

test('adoption cannot be replaced by a later select_task scan',async t=>{
 const h=await harness(t);await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'});
 const r=await h.rt.stage('select_task',{taskAttemptId:'next-attempt'});
 assert.equal(r.status,'stopped');assert.equal(h.captures,0);assert.equal(h.requests.length,0);assert.equal(h.actions.length,0);
});

test('unbounded adoption accepts old saved evidence and preserves literal title without classification',async t=>{
 const h=await harness(t);h.selection.frame.capturedAt=1;h.selection.task.name='游戏字样只是原始标题';
 fs.writeFileSync(h.source.path.replace(/\.png$/,'.json'),JSON.stringify(h.selection.frame));
 const r=await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'});
 assert.equal(r.status,'completed');assert.equal(r.task.name,h.selection.task.name);assert.equal(h.actions.length,0);
});

test('invalid evidence can be corrected before the single successful adoption',async t=>{
 const h=await harness(t);h.selection.balanceBefore=0;
 assert.equal((await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'})).status,'stopped');
 h.selection.balanceBefore=2265;assert.equal((await h.rt.adoptSelection(h.selection,{taskAttemptId:'next-attempt'})).status,'completed');
});

test('hash-bound adoption retains actual receipt and baseline accounting through the real runtime',async t=>{
 const h=await harness(t),ctx={taskAttemptId:'next-attempt'},sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const record={...structuredClone(h.selection),sessionId:'next-session',taskAttemptId:ctx.taskAttemptId,owner,sourcePngSha256:sha(fs.readFileSync(h.source.path))};
 const file=path.join(h.dir,'selection.json');fs.writeFileSync(file,JSON.stringify(record));
 const chosen=await h.rt.adoptSelection({...record,evidence:{path:file,sha256:sha(fs.readFileSync(file))}},ctx);
 assert.equal(chosen.status,'completed');
 const bound={...ctx,task:chosen.task,balanceBefore:chosen.balanceBefore};
 const before=await h.rt.stage('settle',bound);assert.equal(before.status,'stopped');assert.match(before.error,/receipt/i);assert.equal(h.actions.length,0);
 assert.equal((await h.rt.stage('open_task',bound)).status,'completed');
 const receipt=await h.rt.stage('task_receipt',bound);assert.equal(receipt.status,'completed');assert.equal(receipt.receipt.taskAttemptId,ctx.taskAttemptId);
 assert.equal((await h.rt.stage('return_list',bound)).status,'completed');
 const result=await h.rt.stage('settle',bound);assert.equal(result.status,'completed',result.error??'settlement failed');assert.equal(result.balanceAfter,2285);assert.equal(result.review.delta,20);
 assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);assert.ok(h.requests.every(r=>r.panelReadMode),'no inventory read');
});

test('unknown adopted entry cannot replay through adoption or open_task reentry',async t=>{
 const h=await harness(t,{unknown:true}),ctx={taskAttemptId:'next-attempt'};
 const chosen=await h.rt.adoptSelection(h.selection,ctx),bound={...ctx,task:chosen.task,balanceBefore:chosen.balanceBefore};
 assert.equal((await h.rt.stage('open_task',bound)).status,'unknown');
 assert.equal((await h.rt.adoptSelection(h.selection,ctx)).status,'stopped');
 assert.notEqual((await h.rt.stage('open_task',bound)).status,'completed');
 assert.equal((await h.rt.stage('settle',bound)).status,'stopped');assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
});
