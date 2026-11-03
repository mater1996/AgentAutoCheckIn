// Offline runtime/engine integration. PNG and model observations are synthetic.
// No device, network, database, cron, or real model is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {VisionClient} from '../runner/staged/vision-client.ts';

const owner={package:'com.taobao.taobao',userId:0};
const task={name:'合成获准浏览',instruction:'浏览5秒',done:0,total:1,reward:20,button:'去完成'};
const plan=[{name:task.name,instruction:task.instruction,decision:'do',times:1}];
const line=(text:string,bounds=[200,1000,800,1080])=>({text,bounds});
function png(){
 const crc=(b:Buffer)=>{let n=0xffffffff;for(const x of b){n^=x;for(let k=0;k<8;k++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
 const chunk=(type:string,b:Buffer)=>{const name=Buffer.from(type),size=Buffer.alloc(4),checksum=Buffer.alloc(4);size.writeUInt32BE(b.length);checksum.writeUInt32BE(crc(Buffer.concat([name,b])));return Buffer.concat([size,name,b,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(1080);header.writeUInt32BE(2400,4);header[8]=8;header[9]=0;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(1081*2400))),chunk('IEND',Buffer.alloc(0))]);
}
function panel(done=0,balance=2265){return {isPanel:true,balance,blocked:false,top:true,bottom:true,tasks:[{...task,done,rewardMin:null,rewardMax:null,rewardOffers:[{condition:'浏览5秒',reward:20,rewardMin:null,rewardMax:null}],bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]}],clippedRows:[]};}
function config(extra:any={}){return {scope:{appId:'taobao',accountId:'synthetic',activityId:'coins',userId:0},package:owner.package,panelMarker:'赚金币抵钱',aiPanelReader:true,aiTaskRecovery:true,scriptValidationMode:false,balanceComponent:false,selectionAllowNew:false,constraints:['only approved independent ordinary browsing'],learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},limits:{sessionMs:60000,stageMs:10000,agentCalls:12,stageActions:4,maxReturns:3,inventoryPages:2},stages:Object.fromEntries(['open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}])),...extra};}
function observation(request:any,extra:any={}){
 const c=request.context;
 return {stageDone:true,pageIdentity:'当前合成普通浏览任务目的页',blocked:false,stopReason:null,requirements:'浏览5秒',ordinaryBrowseOnly:true,completionQuote:c.stageId==='task_receipt'?'本次浏览任务完成，已得20金币':'',next:null,
  taskBinding:{taskAttemptId:c.taskAttemptId,name:c.task.name,instruction:c.task.instruction,frameId:request.frame.id,entryFrameId:c.actualEntry?.sourceFrameId,entryActionId:c.actualEntry?.entryActionId},...extra};
}
async function harness(t:any,options:any={}){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'ai-task-recovery-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let page='panel',serial=0,queries=0,localChecks=0,current:any=null;
 const events:any[]=[],actions:any[]=[],requests:any[]=[],bytes=png();
 const model=new VisionClient({baseUrl:'http://127.0.0.1:1/v1',apiKey:'synthetic-offline-only',model:'synthetic-task-recovery',fetch:async(_url,init)=>{
  const request=JSON.parse(JSON.parse(String(init?.body)).messages[1].content[0].text);requests.push(request);
  let response;
  if(!request.context){response=page==='modal'?{isPanel:false,balance:null,blocked:false,top:false,bottom:false,tasks:[],clippedRows:[]}:panel(page==='returned'?1:0,page==='returned'?2285:2265);if(options.task&&response.tasks.length)response.tasks[0]={...response.tasks[0],...options.task};events.push({kind:'panel',frameId:request.frame.id});}
  else {queries++;events.push({kind:'ai',frameId:request.frame.id});if(options.failQuery)throw Error('synthetic HTTP failure');response=await (options.answer??observation)(request);}
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}],usage:{total_tokens:17,prompt_tokens:12,completion_tokens:5}}));
 }});
 const cfg=config(options.config);
 const approved=options.task?[{...plan[0],name:options.task.name,instruction:options.task.instruction}]:plan;
 const rt=createStagedRuntime(cfg,{capture:async()=>{
  const id='synthetic-'+(++serial),file=path.join(dir,id+'.png');
  current={id,path:file,width:1080,height:2400,capturedAt:Date.now(),...owner,lines:page==='panel'||page==='returned'?[]:[line('浏览5秒'),line('本次浏览任务完成，已得20金币',[200,1200,850,1280])],...(options.frame?.(page,serial)??{})};
  fs.writeFileSync(file,options.framePng?.(current,page,serial)??(page==='browse'&&options.png?options.png:bytes));fs.writeFileSync(file.replace(/\.png$/,'.json'),JSON.stringify(current));return current;
 },act:async(a:any,f:any)=>{
  if(f)assert.equal(f.id,current?.id,'the same dispatcher consumes the current frame');
  actions.push({action:structuredClone(a),frameId:f?.id});
  if(a.type==='tap'&&page==='panel')page='browse';
  await options.act?.(a,f);
 },scrollContinuously:async()=>{throw Error('AI recovery must not introduce a continuous scroll segment');}},model,{sessionId:'synthetic-session',evidenceDir:dir,plan:approved,inspectDwellBrowse:options.inspectDwellBrowse,inspectLearnedBrowse:async(f:any)=>{
  localChecks++;events.push({kind:'local',frameId:f.id});return options.local?.(f)??null;
 }});
 const chosen=await rt.stage('select_task',{});assert.equal(chosen.status,'completed');
 const ctx={task:chosen.task,taskAttemptId:'synthetic-attempt'};
 return {rt,cfg,ctx,dir,model,actions,events,requests,get queries(){return queries},get localChecks(){return localChecks},setPage(value:string){page=value;},runtimeEvents(){return fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));}};
}

test('run236 saved ordinary browse response hands open_task to the first new completed receipt without another model or input',async t=>{
 // Replay actual pixels/OCR and archived model values; only scratch frame identity/time and binding are adapted.
 const dir=path.resolve('evidence/staged-2026-11-02T15-16-29-349Z');
 const events=fs.readFileSync(path.join(dir,'runtime.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const reads=events.filter(e=>e.kind==='agent_result'&&e.stageId==='open_task');assert.equal(reads.length,2);
 const {frameId:_frameId,beforeFrame:_beforeFrame,...selected}=JSON.parse(fs.readFileSync(path.join(dir,'stages.json'),'utf8')).find((s:any)=>s.stageId==='select_task').task;
 const ids=['ac52b066-a674-41f6-a457-dcda3600ba7e','712e0896-897b-47b8-9e9f-9f8e6cae4f03',reads[0].frameId,reads[1].frameId];
 const hashes=new Map<string,string>(),sha=(p:string)=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 for(const id of ids)for(const ext of ['.png','.json','.ocr.json']){const p=path.join(dir,id+ext);hashes.set(p,sha(p));}
 t.after(()=>{for(const [p,hash]of hashes)assert.equal(sha(p),hash,'historical source bytes remain immutable');});
 let saved:any=null;
 const h=await harness(t,{task:selected,config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},
  frame:(page:string,n:number)=>{const id=page==='panel'?ids[0]:page==='receipt'?ids[3]:ids[Math.min(n-2,3)];saved=JSON.parse(fs.readFileSync(path.join(dir,id+'.json'),'utf8'));return {lines:saved.lines,ocrObservation:saved.ocrObservation};},
  framePng:()=>fs.readFileSync(saved.path),
  answer:(r:any)=>observation(r,{...structuredClone(reads[r.frame.id==='synthetic-4'?0:1].value),taskBinding:observation(r).taskBinding})});
 const opened=await h.rt.stage('open_task',h.ctx);
 assert.equal(opened.status,'completed',opened.error);
 assert.equal(h.queries,1,'ordinary destination confirmation must hand off before another frame/model');
 assert.equal(h.actions.filter(a=>a.action.type==='wait'&&a.action.ms===5000).length,0,'open_task does not execute receipt waiting');
 assert.equal((await h.rt.stage('settle',h.ctx)).status,'stopped','destination confirmation alone cannot settle');
 h.setPage('receipt');const received=await h.rt.stage('task_receipt',h.ctx);
 assert.equal(received.status,'completed',received.error);assert.equal(received.receipt.quote,'任务已完成');assert.equal(received.receipt.version,'current-keywords-v1');
 assert.equal(h.queries,1);assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
 assert.deepEqual(h.actions.find(a=>a.action.type==='tap')?.action,{type:'tap',x:944,y:1427});
 const destination=h.runtimeEvents().find(e=>e.kind==='ai_task_destination_confirmed');assert.equal(destination.requirements,'浏览5秒得奖励');assert.equal(destination.taskAttemptId,h.ctx.taskAttemptId);
 assert.equal(opened.review.candidate.version,'ai-task-recovery-v1','AI handoff must not be archived as a zero-model local contract');
});

test('ordinary browse handoff carries requirements to OCR-free visual receipt on the first new frame',async t=>{
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?{lines:[],observationError:'OCR unavailable'}:{},answer:(r:any)=>{
  if(r.context.stageId==='task_receipt'){
   assert.equal(r.context.ordinaryBrowseEvidence.requirements,'浏览5秒');assert.equal(r.context.ordinaryBrowseEvidence.taskAttemptId,r.context.taskAttemptId);
   assert.equal(r.context.ordinaryBrowseEvidence.entryActionId,r.context.actualEntry.entryActionId);
  }
  return observation(r,r.context.stageId==='open_task'?{stageDone:false,next:{action:{type:'wait',ms:5000},reason:'倒计时仍在继续',expected:'receipt'}}:{requirements:'',completionQuote:'任务已完成'});
 }});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');
 const r=await h.rt.stage('task_receipt',h.ctx);assert.equal(r.status,'completed',r.error);assert.equal(r.receipt.version,'ai-task-recovery-v1');assert.equal(h.queries,2);
 assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);assert.equal(h.actions.filter(a=>a.action.ms===5000).length,0);
});

test('open_task reentry accepts completed destination only with prior ordinary evidence from this attempt',async t=>{
 for(const visual of [false,true]){
  const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?visual?{lines:[],observationError:'OCR unavailable'}:{lines:[line('任务已完成')]}:{},answer:(r:any)=>observation(r,r.context.stageId==='open_task'&&r.context.ordinaryBrowseEvidence?{requirements:'',completionQuote:'任务已完成'}:{})});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');
  const queries=h.queries,result=await h.rt.stage('open_task',h.ctx);assert.equal(result.status,'completed',result.error);
  assert.equal(h.queries,queries+(visual?1:0));assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
 }
 const arbitrary=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='browse'?{lines:[line('任务已完成')]}:{},answer:(r:any)=>observation(r,{requirements:'',completionQuote:'任务已完成'})});
 assert.notEqual((await arbitrary.rt.stage('open_task',arbitrary.ctx)).status,'completed');assert.equal((await arbitrary.rt.stage('settle',arbitrary.ctx)).status,'stopped');
});

test('completion text cannot seed ordinary browse requirement evidence in open_task',async t=>{
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='browse'?{lines:[line('任务已完成')]}:{},answer:(r:any)=>observation(r,{requirements:'任务已完成',completionQuote:'任务已完成'})});
 assert.notEqual((await h.rt.stage('open_task',h.ctx)).status,'completed');assert.equal((await h.rt.stage('settle',h.ctx)).status,'stopped');
});

test('handoff refuses old attempt, foreign owner, old frame, login and unknown dispatch without another entry',async t=>{
 for(const kind of ['attempt','owner','stale','old-frame','login','unknown']){
  const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?{lines:[line('任务已完成'),...(kind==='login'?[line('请完成身份验证')]:[])],...(kind==='owner'?{userId:999}:{}),...(kind==='stale'?{capturedAt:Date.now()-16000}:{}),...(kind==='old-frame'?{capturedAt:Date.now()-1000}:{})}:{},answer:(r:any)=>observation(r,kind==='unknown'&&r.context.stageId==='task_receipt'?{stageDone:false,completionQuote:'',next:{action:{type:'wait',ms:500},reason:'wait',expected:'receipt'}}:{}),act:(a:any)=>{if(kind==='unknown'&&a.type==='wait'&&a.ms===500)throw Error('offline unknown wait');}});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
  if(kind==='unknown')assert.equal((await h.rt.stage('task_receipt',h.ctx)).status,'unknown');
  h.setPage('receipt');const ctx=kind==='attempt'?{...h.ctx,taskAttemptId:'old-attempt'}:h.ctx,queries=h.queries;
  assert.notEqual((await h.rt.stage('open_task',ctx)).status,'completed',kind);assert.notEqual((await h.rt.stage('task_receipt',ctx)).status,'completed',kind);
  assert.equal(h.queries,queries,kind);assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1,kind);
 }
});

test('current completion keywords precede geometry contracts and keep same-attempt stable settlement',async t=>{
 const source=path.resolve('evidence/staged-2026-11-02T11-52-57-317Z/55bcb1f8-20b2-4b96-ad45-69bd3864bf07');
 const raw=JSON.parse(fs.readFileSync(source+'.ocr.json','utf8')).pages[0];
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},png:fs.readFileSync(source+'.png'),frame:(page:string)=>page==='receipt'?{lines:raw.lines.filter((l:any)=>l.bounds[0]>=0),ocrObservation:{version:'ocr-text-v1',texts:raw.lines.map((l:any)=>l.text),excludedLineIndexes:raw.lines.map((l:any,i:number)=>l.bounds[0]<0?i:-1).filter((i:number)=>i>=0)}}:{}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');
 const before=h.queries,result=await h.rt.stage('task_receipt',h.ctx);
 assert.equal(result.status,'completed',result.error);assert.equal(result.receipt.version,'current-keywords-v1');assert.equal(result.receipt.quote,'任务已完成');assert.equal(h.queries,before);
 assert.equal((await h.rt.stage('settle',{...h.ctx,taskAttemptId:'old-attempt'})).status,'stopped');
 h.setPage('returned');const settled=await h.rt.stage('settle',h.ctx);assert.equal(settled.status,'completed');assert.equal(settled.balanceAfter,2285);assert.equal(settled.review.samples.length,2);
});

test('current AI receipt can read original pixels when OCR failed without using its quote as a click target',async t=>{
 const source=path.resolve('evidence/staged-2026-11-02T11-52-57-317Z/55bcb1f8-20b2-4b96-ad45-69bd3864bf07.png');
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},png:fs.readFileSync(source),frame:(page:string)=>page==='receipt'?{lines:[],observationError:'OCR process unavailable'}:{},answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?{requirements:'',completionQuote:'任务已完成'}:{})});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');
 const result=await h.rt.stage('task_receipt',h.ctx);assert.equal(result.status,'completed',result.error);assert.equal(result.receipt.version,'ai-task-recovery-v1');
 assert.ok(h.runtimeEvents().some(e=>e.kind==='agent_result'&&e.value.completionQuote==='任务已完成'));
 assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
});

test('current AI can confirm the ordinary destination directly from pixels when OCR is unavailable',async t=>{
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='browse'?{lines:[],observationError:'OCR unavailable'}:{}});
 const opened=await h.rt.stage('open_task',h.ctx);assert.equal(opened.status,'completed',opened.error);assert.equal(h.queries,1);assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
});

test('current keyword policy defers negative/tutorial text and refuses stale owner or attempt',async t=>{
 for(const texts of [['任务未完成'],['任务已完成','教程示例'],['尚未完成任务已完成'],['+30'],['已完成'],['任务已完成','请完成身份验证']]){
  const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?{lines:texts.map(s=>line(s))}:{},answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?{stageDone:false,next:null,completionQuote:''}:{})});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');assert.notEqual((await h.rt.stage('task_receipt',h.ctx)).status,'completed');
 }
 for(const changed of [{userId:999},{capturedAt:Date.now()-16000},{}]){
  const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?{lines:[line('任务已完成')],...changed}:{}});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');assert.notEqual((await h.rt.stage('task_receipt',Object.keys(changed).length?h.ctx:{...h.ctx,taskAttemptId:'old'})).status,'completed');
 }
});

test('current keyword receipt ignores ordinary product confirmation and authorization wording',async t=>{
 const h=await harness(t,{config:{taskObservationPolicy:'current-components-v1',taskCompletionPolicy:'current-keywords-v1'},frame:(page:string)=>page==='receipt'?{lines:[line('任务已完成'),line('官方授权正品 确认款式')]}:{}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');h.setPage('receipt');assert.equal((await h.rt.stage('task_receipt',h.ctx)).status,'completed');
});

test('explicit recovery consults one current-frame AI only after bound entry local unknown, preserving receipt and two-frame settlement',async t=>{
 const h=await harness(t);
 const opened=await h.rt.stage('open_task',h.ctx);
 assert.equal(h.queries,1,'bound entry local unknown must reach one current-frame AI observation');
 assert.equal(opened.status,'completed',opened.error);
 const firstAi=h.events.find(e=>e.kind==='ai');assert.ok(h.events.some(e=>e.kind==='local'&&e.frameId===firstAi.frameId));
 assert.ok(h.events.findIndex(e=>e.kind==='local'&&e.frameId===firstAi.frameId)<h.events.indexOf(firstAi));
 const request=h.requests.find(r=>r.context);
 assert.equal(request.context.actualEntry.taskAttemptId,h.ctx.taskAttemptId);
 assert.equal(request.context.actualEntry.dispatched,true);
 assert.ok(request.context.actualEntry.entryActionId);
 const received=await h.rt.stage('task_receipt',h.ctx);assert.equal(received.status,'completed',received.error);
 assert.equal(received.receipt.taskAttemptId,h.ctx.taskAttemptId);assert.equal(received.receipt.quote,'本次浏览任务完成，已得20金币');
 assert.equal(h.queries,2);assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
 const raw=h.runtimeEvents().filter(e=>e.kind==='agent_result');assert.equal(raw.length,2);assert.equal(raw[1].value.completionQuote,received.receipt.quote);
 h.setPage('returned');
 assert.equal((await h.rt.stage('settle',{...h.ctx,taskAttemptId:'other'})).status,'stopped');
 const settled=await h.rt.stage('settle',h.ctx);assert.equal(settled.status,'completed',settled.error);assert.equal(settled.balanceAfter,2285);
 assert.equal(settled.review.samples.length,2);assert.notEqual(settled.review.samples[0].frameId,settled.review.samples[1].frameId);
 assert.equal(h.model.usage.length,h.rt.calls);assert.equal(h.model.usage.every(u=>u.calls===1),true);
});

test('unknown local receipt can use one AI wait through the existing dispatcher and reobserve before completion',async t=>{
 let receiptReads=0;
 const h=await harness(t,{answer:(request:any)=>observation(request,request.context.stageId==='task_receipt'&&++receiptReads===1?{stageDone:false,completionQuote:'',next:{action:{type:'wait',ms:500},reason:'当前浏览倒计时仍在继续',expected:'fresh receipt'}}:{})});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const received=await h.rt.stage('task_receipt',h.ctx);assert.equal(received.status,'completed',received.error);
 const actions=received.actions.filter((x:any)=>x.proposal.action);
 assert.equal(actions.length,1);assert.equal(actions[0].source,'agent');assert.deepEqual(actions[0].proposal.action,{type:'wait',ms:500});
 assert.equal(receiptReads,2,'one model observation per new frame, shared between check and agentStep');
 assert.equal(h.actions.filter(x=>x.action.type==='wait'&&x.action.ms===500).length,1);
 assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
});

test('recovery rejects wrong task binding, panel quotations, unsafe requirements and unverified completion',async t=>{
 const cases=[
  (r:any)=>({taskBinding:{...observation(r).taskBinding,taskAttemptId:'other'}}),
  (r:any)=>({taskBinding:{...observation(r).taskBinding,name:'别的任务'}}),
  (r:any)=>({taskBinding:{...observation(r).taskBinding,frameId:'other-frame'}}),
  ()=>({completionQuote:'列表别的任务已完成'}),
  ()=>({completionQuote:'浏览5秒'}),
  ()=>({ordinaryBrowseOnly:false,requirements:'搜索商品后下单'}),
  ()=>({blocked:true}),
 ];
 for(const change of cases){
  const h=await harness(t,{answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?change(r):{})});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
  const received=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(received.status,'completed');assert.equal(received.receipt,undefined);
  assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
 }
});

test('unknown recovery dispatch and another attempt never cause another AI action or entry',async t=>{
 let waits=0;
 const h=await harness(t,{answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?{stageDone:false,completionQuote:'',next:{action:{type:'wait',ms:500},reason:'still browsing',expected:'receipt'}}:{}),act:(a:any)=>{if(a.type==='wait'&&a.ms===500){waits++;throw Error('synthetic dispatch unknown');}}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const received=await h.rt.stage('task_receipt',h.ctx);assert.equal(received.status,'unknown');
 const count=h.queries;
 await h.rt.stage('task_receipt',h.ctx);
 await h.rt.stage('open_task',{...h.ctx,taskAttemptId:'other'});
 await h.rt.stage('task_receipt',{...h.ctx,taskAttemptId:'other'});
 assert.equal(waits,1);assert.equal(h.queries,count,'unknown dispatch and wrong attempt must stop before describe');
 assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
});

test('recovered coordinate taps cannot target sensitive controls or bare coordinates',async t=>{
 for(const lines of [[line('开通会员',[800,1500,1040,1620])],[],[line('继续浏览',[800,1500,1040,1620]),line('授权并继续',[800,1500,1040,1620])]]){
  const h=await harness(t,{frame:(page:string)=>page==='browse'?{lines:[line('浏览5秒'),...lines]}:{},answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?{stageDone:false,completionQuote:'',next:{action:{type:'tap',x:920,y:1560},reason:'continue',expected:'receipt'}}:{})});
  assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
  const received=await h.rt.stage('task_receipt',h.ctx);assert.notEqual(received.status,'completed');
  assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1,'only the uniquely bound panel entry may dispatch');
 }
});

test('run219 original IP skeleton frame reaches AI with actual entry context and bounded wait without address tap',async t=>{
 // Original pixels/OCR copied unchanged; response is synthetic, not a real model judgment.
 const dir=path.resolve('evidence/staged-2026-11-02T00-19-22-514Z');
 const saved=JSON.parse(fs.readFileSync(path.join(dir,'59fd5523-153a-4811-812d-f61d1dc3fdd7.json'),'utf8'));
 const cfg=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8'));
 const target={...task,name:'天天签到免费拿IP周边',instruction:'浏览最新礼盒得',reward:10};
 const dwell=cfg.dwellBrowse.contracts.find((c:any)=>c.task.name===target.name&&c.task.instruction===target.instruction);assert.ok(dwell);
 const h=await harness(t,{task:target,config:{dwellBrowse:{...cfg.dwellBrowse,contracts:[dwell]}},png:fs.readFileSync(saved.path),frame:(page:string)=>page==='browse'?{lines:saved.lines}:{},answer:(r:any)=>observation(r,{stageDone:false,requirements:'浏览5秒 得奖励',completionQuote:'',next:{action:{type:'wait',ms:500},reason:'商品骨架加载中；地址只是页面入口',expected:'新帧浏览状态'}})});
 const opened=await h.rt.stage('open_task',h.ctx);
 assert.ok(h.queries>0,'real219 local unknown should consult AI');assert.notEqual(opened.status,'completed','loading/wait never implies completion');
 const r=h.requests.find(x=>x.context);
 assert.equal(r.context.actualEntry.dispatched,true);assert.equal(r.context.actualEntry.taskAttemptId,h.ctx.taskAttemptId);
 assert.equal(r.context.task.name,target.name);assert.equal(r.context.task.instruction,target.instruction);
 assert.equal(r.context.observationError,null);assert.ok(r.context.recentActions.some((a:any)=>a.proposal.action?.type==='tap'));
 assert.deepEqual(fs.readFileSync(h.rt.frames.find(f=>f.id===r.frame.id).path),fs.readFileSync(saved.path));
 assert.ok(h.actions.some(a=>a.action.type==='wait'&&a.action.ms===500));assert.equal(h.actions.filter(a=>a.action.type==='tap').length,1);
 assert.equal((await h.rt.stage('settle',h.ctx)).status,'stopped');
});

test('unknown return modal uses one bound current-frame AI back without granting task or global close authority',async t=>{
 let backs=0;
 const h=await harness(t,{frame:(page:string)=>page==='modal'?{lines:[line('是否退出当前页面')]}:{},act:(a:any)=>{if(a.type==='back'&&++backs===2)h.setPage('returned');},answer:(r:any)=>observation(r,r.context.stageId==='return_list'?{stageDone:false,ordinaryBrowseOnly:false,requirements:'',completionQuote:'',next:{action:{type:'back'},reason:'当前未知挽留弹层，安全系统返回',expected:'owning panel'}}:{})});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',h.ctx)).status,'completed');
 h.setPage('modal');h.actions.length=0;
 const answer=h.requests.length;
 const result=await h.rt.stage('return_list',h.ctx);
 const recovery=h.requests.slice(answer).find(r=>r.context?.stageId==='return_list');assert.ok(recovery,'unknown modal should reach safe AI recovery');
 assert.equal(recovery.context.actualEntry?.taskAttemptId,h.ctx.taskAttemptId,'return recovery must carry the owning actual entry');
 assert.equal(result.status,'completed',result.error);
 assert.ok(result.actions.some((a:any)=>a.source==='agent'&&a.proposal.action?.type==='back'));
 assert.equal(h.actions.some(a=>a.action.type==='tap'),false);
});

test('unknown first system return is never replayed on stage reentry',async t=>{
 const h=await harness(t,{act:(a:any)=>{if(a.type==='back')throw Error('synthetic return dispatch unknown');}});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');assert.equal((await h.rt.stage('task_receipt',h.ctx)).status,'completed');h.setPage('modal');
 assert.equal((await h.rt.stage('return_list',h.ctx)).status,'unknown');await h.rt.stage('return_list',h.ctx);
 assert.equal(h.actions.filter(a=>a.action.type==='back').length,1);
});

test('an unconfirmed recovered tap cannot be proposed again on the next frame',async t=>{
 const h=await harness(t,{frame:(page:string)=>page==='browse'?{lines:[line('浏览5秒'),line('继续浏览',[800,1500,1040,1620])]}:{},answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'?{stageDone:false,completionQuote:'',next:{action:{type:'tap',x:920,y:1560},reason:'continue ordinary browsing',expected:'receipt'}}:{})});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 await h.rt.stage('task_receipt',h.ctx);
 assert.equal(h.actions.filter(x=>x.action.type==='tap').length,2,'one entry plus one recovered tap only');
});

test('recovery wait with configured continuous scrolling does not enter the scroll revalidation hook',async t=>{
 let receiptReads=0;
 const h=await harness(t,{config:{stages:{...config().stages,task_receipt:{goal:'receipt',checkpoint:'receipt',continuousScroll:{maxMs:35000,maxSwipes:30,requiredMs:25000}}}},answer:(r:any)=>observation(r,r.context.stageId==='task_receipt'&&++receiptReads===1?{stageDone:false,completionQuote:'',next:{action:{type:'wait',ms:500},reason:'load',expected:'fresh'}}:{})});
 assert.equal((await h.rt.stage('open_task',h.ctx)).status,'completed');
 const result=await h.rt.stage('task_receipt',h.ctx);assert.equal(result.status,'completed',result.error);
 assert.equal(h.actions.filter(a=>a.action.type==='wait'&&a.action.ms===500).length,1);
});

test('local evidence and disabled recovery retain the old no-model contract',async t=>{
 const known=await harness(t,{local:()=>({state:'completed',quote:'本地真实合同回执',version:'offline-local'})});
 assert.equal((await known.rt.stage('open_task',known.ctx)).status,'completed');assert.equal((await known.rt.stage('task_receipt',known.ctx)).status,'completed');assert.equal(known.queries,0);
 for(const config of [{aiTaskRecovery:false},{aiTaskRecovery:undefined},{scriptValidationMode:true}]){
  const h=await harness(t,{config:config.scriptValidationMode?{}:config});if(config.scriptValidationMode)h.cfg.scriptValidationMode=true;const opened=await h.rt.stage('open_task',h.ctx);assert.notEqual(opened.status,'completed');assert.equal(h.queries,0);
 }
});

test('wrong owner, stale source, exhausted allowance and failed model stop before recovery actions',async t=>{
 for(const frame of [{userId:999},{package:'com.external.app'},{capturedAt:Date.now()-15001}]){
  const h=await harness(t,{frame:(page:string)=>page==='browse'?frame:{}});const opened=await h.rt.stage('open_task',h.ctx);
  assert.notEqual(opened.status,'completed');assert.equal(h.queries,0);assert.equal(h.actions.filter(x=>x.action.type==='tap').length,1);
 }
 const budget=await harness(t);budget.cfg.limits.agentCalls=2;
 assert.notEqual((await budget.rt.stage('open_task',budget.ctx)).status,'completed');assert.equal(budget.queries,0);
 const failed=await harness(t,{failQuery:true});assert.notEqual((await failed.rt.stage('open_task',failed.ctx)).status,'completed');
 assert.equal(failed.queries,1);assert.equal(failed.model.usage.length,failed.rt.calls);assert.ok(failed.model.usage.at(-1)?.error);
});

test('model elapsed time expires original authority instead of renewing capturedAt',async t=>{
 const realNow=Date.now;
 const h=await harness(t,{answer:(r:any)=>{Date.now=()=>r.frame.capturedAt+15001;return observation(r,{stageDone:false,next:{action:{type:'wait',ms:500},reason:'wait',expected:'fresh'}});}});
 try{const opened=await h.rt.stage('open_task',h.ctx);assert.notEqual(opened.status,'completed');assert.equal(h.queries,1);assert.equal(h.actions.filter(x=>x.action.type==='wait'&&x.action.ms===500).length,0);}finally{Date.now=realNow;}
});
