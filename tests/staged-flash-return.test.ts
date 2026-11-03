import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
const root=path.resolve(import.meta.dirname,'..'),history=path.join(root,'evidence/ocr-browse-2026-11-01T00-53-49-661Z');
const owner={package:'com.taobao.taobao',userId:0};
const task={name:'来淘宝闪购分百亿补贴',instruction:'下单最高，浏览5秒'};
const contract={task,version:'flash-return-candidate-v1',sourceRunId:131};
function config():any{return {package:owner.package,scope:{appId:'taobao',accountId:'tb_main',activityId:'tb_coin',userId:0},assetId:'coins',model:{baseUrl:'http://offline',name:'offline'},panelMarker:'赚金币抵钱',constraints:['no pay'],selectionAllowNew:false,
 learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},dwellBrowse:{version:'dwell-browse-candidate-v1',contracts:[{task,dwellMs:10000}]},returnContracts:[contract],scriptValidationMode:true,
 limits:{maxTasks:1,stageMs:90000,sessionMs:600000,agentCalls:20,stageActions:8,maxReturns:3,inventoryPages:3},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(s=>[s,{goal:s,checkpoint:s+'_ok'}]))};}
test('return configuration rejects unknown version, source, malformed task and duplicate identity',()=>{
 assert.equal(validateStagedConfig(config()).returnContracts[0],contract);
 for(const value of [null,{},[null],[{...contract,sourceRunId:153}],[{...contract,version:'validated'}],[{...contract,task:{name:1,instruction:'浏览'}}],[contract,contract],[contract,{...contract,task:{name:' '+task.name,instruction:task.instruction}}]])assert.throws(()=>validateStagedConfig({...config(),returnContracts:value}),/return contract/i);
});
async function replay(t:any,mode='ok'){
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'flash-runtime-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let state='panel',serial=0,backs=0,queries=0;const actions:any[]=[],events:string[]=[];
 const panel=()=>({...owner,id:'panel-'+(++serial),path:'offline-panel.png',width:1080,height:2400,capturedAt:Date.now(),lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:backs===2?'1520':'1500',bounds:[90,240,210,300]},
 {text:task.name+'（'+(backs===2?'1':'0')+'/1）',bounds:[230,900,800,950]},{text:task.instruction,bounds:[230,970,800,1010]},{text:'去完成',bounds:[880,920,1000,960]}]});
 const cfg=config();if(mode==='development-many'){cfg.executionPolicy='development-unbounded-v1';cfg.limits={...cfg.limits,stageMs:null,sessionMs:null,stageActions:null,agentCalls:null,maxReturns:1};}if(mode==='disabled')delete cfg.returnContracts;if(mode==='wrong-task')cfg.returnContracts=[{...contract,task:{...task,instruction:'浏览5秒'}}];
 const device={capture:async()=>{events.push('capture:'+state);return state==='panel'?panel():{...frame(state==='modal'&&mode!=='wrong-page'?'frame-15':'frame-6'),id:'fresh-'+(++serial)};},act:async(a:any)=>{actions.push(a);events.push(a.type+':'+(a.ms??''));if(a.type==='tap')state='destination';if(a.type==='back'){backs++;if(mode==='unknown-first'||mode==='unknown-second'&&backs===2)throw Error('unknown back');state=backs===1||mode==='stuck'||mode==='development-many'&&backs<5?'modal':'panel';}}};
 const rt=createStagedRuntime(cfg,device,{query:async()=>{queries++;throw Error('No model');}},{sessionId:'offline-flash',evidenceDir:dir,plan:[{...task,decision:'do',times:1}],inspectDwellBrowse:async()=>({state:'completed',version:'dwell-replay-v1',quote:'任务已完成'})});
 const selection=await rt.stage('select_task',{});assert.equal(selection.status,'completed');
 const ctx:any={task:selection.task,taskAttemptId:'attempt-131'};
 if(mode!=='missing-entry'){
  const opened=await rt.stage('open_task',ctx);assert.equal(opened.status,'completed',opened.error);
  if(mode!=='false-receipt'){const receipt=await rt.stage('task_receipt',ctx);assert.equal(receipt.status,'completed',receipt.error);}
 }else state='destination';
 if(mode==='missing-attempt')delete ctx.taskAttemptId;
 if(mode==='wrong-attempt')ctx.taskAttemptId='foreign-attempt';
 if(mode==='false-receipt')ctx.receipt={taskAttemptId:'attempt-131',quote:'任务已完成'};
 const returned=await rt.stage('return_list',ctx);
 return {rt,ctx,returned,actions,events,queries,get backs(){return backs;}};
}
test('development flash return exceeds old back ceiling with owning receipt and fresh observations',async t=>{
 const h=await replay(t,'development-many');assert.equal(h.returned.status,'completed',h.returned.error);assert.equal(h.backs,5);assert.equal(h.actions.filter(a=>a.type==='tap').length,1);assert.equal(h.queries,0);
});
test('actual engine uses one ordinary back then exact modal second back, 800ms reobserve and panel settlement',async t=>{
 const r=await replay(t);assert.equal(r.returned.status,'completed',r.returned.error);assert.equal(r.backs,2);
 assert.equal(r.actions.filter(a=>a.type==='tap').length,1);assert.equal(r.queries,0);
 assert.equal(r.returned.usedScriptVersion,contract.version);assert.equal(r.returned.review.candidate.sourceRunId,131);
 assert.ok(r.returned.actions.every((a:any)=>a.source==='script'&&a.status==='verified'));
 const second=r.events.lastIndexOf('back:');assert.deepEqual(r.events.slice(second,second+3),['back:','wait:800','capture:panel']);
 const settled=await r.rt.stage('settle',r.ctx);assert.equal(settled.status,'completed',settled.error);assert.equal(settled.balanceAfter,1520);
});
test('receipt, actual entry and attempt are required; unknown dispatch never repeats; no third back or modal done',async t=>{
 for(const mode of ['false-receipt','missing-entry','missing-attempt','wrong-attempt','wrong-page','unknown-first','unknown-second','stuck','disabled','wrong-task']){
  const r=await replay(t,mode);assert.equal(r.backs,['unknown-second','stuck'].includes(mode)?2:1,mode);assert.notEqual(r.returned.status,'completed',mode);
  if(mode.startsWith('unknown')){assert.equal(r.returned.status,'unknown');await r.rt.stage('return_list',r.ctx);assert.equal(r.backs,mode==='unknown-first'?1:2);}
 }
});
function frame(name='frame-15'):any {const p=JSON.parse(fs.readFileSync(path.join(history,name+'.json'),'utf8')).pages[0];return {...p,...owner,id:name,path:path.join(history,name+'.png'),capturedAt:Date.now()};}
test('original modal PNG and OCR match; wrong page, overlay, stale frame and tampered source fail closed',async t=>{
 const {inspectFlashReturn}=await import('../runner/staged/flash-return.ts');
 for(const name of ['frame-15','exit-modal-current'])assert.equal((await inspectFlashReturn(frame(name),owner))?.version,contract.version);
 assert.equal(await inspectFlashReturn(frame('frame-6'),owner),null);
 assert.equal(await inspectFlashReturn({...frame(),capturedAt:Date.now()-16000},owner),null);
 assert.equal(await inspectFlashReturn({...frame(),userId:1},owner),null);
 assert.equal(await inspectFlashReturn({...frame(),lines:frame().lines.filter((l:any)=>l.text!=='确定要离开吗？')},owner),null);
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'flash-source-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sharp=(await import('sharp')).default;
 const overlay=path.join(dir,'overlay.png');await sharp(frame().path).composite([{input:{create:{width:650,height:200,channels:3,background:'black'}},left:200,top:1100}]).png().toFile(overlay);
 assert.equal(await inspectFlashReturn({...frame(),path:overlay},owner),null);
 const target=path.join(dir,'evidence/ocr-browse-2026-11-01T00-53-49-661Z');fs.mkdirSync(target,{recursive:true});
 for(const name of ['frame-15','exit-modal-current'])for(const ext of ['png','json'])fs.copyFileSync(path.join(history,name+'.'+ext),path.join(target,name+'.'+ext));
 assert.ok(await inspectFlashReturn(frame(),owner,dir));
 fs.appendFileSync(path.join(target,'frame-15.json'),' ');
 assert.equal(await inspectFlashReturn(frame(),owner,dir),null);
});
