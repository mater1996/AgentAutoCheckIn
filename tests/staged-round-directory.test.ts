// Offline command/model fixtures exercise the real capture adapter and default runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRoundAdapters} from '../runner/staged/round-main.ts';
import {AdbOcrDevice} from '../runner/staged/device.ts';
const scratch='/Users/mater/.hermes/cache/scratch';
const source=path.resolve('evidence/staged-2026-11-01T23-38-18-381Z/4cfce720-55ce-4c26-bdbd-4f11d5d73eaf.png');
const owner={package:'com.taobao.taobao',userId:0};
const panel=()=>({isPanel:true,balance:2265,blocked:false,top:true,bottom:true,tasks:[{name:'Synthetic offline browse',instruction:'浏览5秒',done:0,total:1,reward:20,rewardMin:null,rewardMax:null,rewardOffers:[],button:'去完成',bounds:[230,700,650,750],buttonBounds:[850,710,1000,790],point:[925,750]}],clippedRows:[]});
function setup(t:any){
 const dir=fs.mkdtempSync(path.join(scratch,'round-directory-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let foreground='custom.desktop/.Home',missingAfterLaunch=false;const commands:any[]=[],queries:any[]=[],dirs:string[]=[];
 const exec=async(file:string,args:string[])=>{
  commands.push({file,args});
  if(file!=='adb')throw Error('Synthetic offline OCR failure');
  assert.deepEqual(args.slice(0,2),['-s','OFFLINE-DIRECTORY']);
  if(args.includes('activities')){
   if(missingAfterLaunch){missingAfterLaunch=false;return {stdout:'No resumed activity markers during launch'};}
   return {stdout:`topResumedActivity=ActivityRecord{x u0 ${foreground} t1}`};
  }
  if(args.includes('screencap'))return {stdout:fs.readFileSync(source)};
  if(args.includes('resolve-activity'))return {stdout:args.includes('android.intent.category.HOME')?'custom.desktop/.Home':owner.package+'/.Main'};
  if(args.includes('start')){foreground=owner.package+'/.Main';missingAfterLaunch=true;return {stdout:'Starting synthetic offline activity'};}
  if(args.includes('KEYCODE_HOME'))foreground='custom.desktop/.Home';
  if(args.includes('settings')&&args.includes('get'))return {stdout:'0'};
  if(args.includes('power'))return {stdout:'mWakefulness=Asleep'};
  if(args.includes('settings')||args.includes('input')||args.includes('dismiss-keyguard')||args.includes('forward'))return {stdout:''};
  throw Error('Unexpected offline command '+args.join(' '));
 };
 const makeDevice=(evidenceDir:string)=>new AdbOcrDevice({serial:'OFFLINE-DIRECTORY',evidenceDir,allowVisualFallback:true,frameMaxAgeMs:15000,exec});
 const cfg={scope:{...owner,appId:'test',accountId:'offline',activityId:'coins'},package:owner.package,localLaunch:true,learnedBrowse:{enabled:true,version:'continuous-browse-candidate-v1',sourceRunId:153},aiPanelReader:true,scriptValidationMode:false,selectionAllowNew:false,panelMarker:'赚金币抵钱',constraints:[],limits:{stageMs:10000,sessionMs:30000,agentCalls:12,stageActions:3,inventoryPages:2},stages:Object.fromEntries(['open_app','enter_activity','open_list'].map(id=>[id,{goal:id,checkpoint:id}]))};
 const model={usage:[],query:async(request:any)=>{queries.push(request);return panel();}};
 const options={cfg,round:{id:'round-offline',evidenceDir:dir},device:makeDevice(dir),taskDeviceFactory:(child:string)=>{dirs.push(child);return makeDevice(child);},model,knowledge:{},scriptFiles:[],saveTask:async()=>{throw Error('Database forbidden in offline collection');}};
 return {dir,dirs,commands,queries,options};
}
test('default runtime captures each cycle inside its task directory with one outer device lifecycle',async t=>{
 const h=setup(t),adapters=createRoundAdapters(h.options);
 await adapters.prepare();
 const first=await adapters.collect({attempts:[]});assert.equal(first.complete,true);
 const second=await adapters.collect({attempts:[]});assert.equal(second.complete,true);
 await adapters.finish();await adapters.cleanup();
 assert.equal(h.dirs.length,2);assert.notEqual(h.dirs[0],h.dirs[1]);
 for(const [i,inventory]of [first,second].entries()){
  const dir=h.dirs[i];assert.equal(path.dirname(inventory.source),dir);
  for(const page of inventory.pages){
   assert.equal(path.dirname(page.path),dir);const saved=JSON.parse(fs.readFileSync(page.path.replace(/\.png$/,'.json'),'utf8'));
   assert.equal(saved.aiPanelEvidence.status,'accepted');assert.equal(path.dirname(saved.aiPanelEvidence.path),dir);
   for(const read of [saved.systemObservation.before,saved.systemObservation.after])assert.equal(path.dirname(read.source.path),path.join(dir,'device-command-evidence'));
  }
  assert.equal(fs.existsSync(path.join(dir,'prepare.json')),false);assert.equal(fs.existsSync(path.join(dir,'cleanup.json')),false);
 }
 assert.ok(h.queries.length>0);assert.ok(h.queries.every(q=>h.dirs.includes(path.dirname(q.frame.path))));
 assert.equal(fs.readdirSync(h.dir).filter(f=>f.endsWith('.png')).length,0);
 assert.equal(h.commands.filter(c=>c.args.includes('KEYCODE_WAKEUP')).length,1);
 assert.equal(h.commands.filter(c=>c.args.includes('KEYCODE_HOME')).length,1);
 assert.equal(h.commands.filter(c=>c.args.includes('KEYCODE_SLEEP')).length,1);
 assert.equal(h.commands.filter(c=>c.args.includes('start')).length,1);
 const launch=fs.readdirSync(h.dirs[0]).find(f=>f.startsWith('launch-transition-'));assert.ok(launch);
 const transition=JSON.parse(fs.readFileSync(path.join(h.dirs[0],launch),'utf8'));assert.equal(transition.status,'foreground_confirmed');assert.equal(transition.waits.length,1);
 assert.equal(fs.readdirSync(h.dirs[1]).some(f=>f.startsWith('launch-transition-')),false);
});
test('task hooks index matching attempt directories and mirror child stage, model and input records',async t=>{
 const h=setup(t),events:any[]=[],registered:any[]=[],scoped:any[]=[];
 const adapters=createRoundAdapters({...h.options,event:(kind:string,data:any)=>events.push({kind,...data}),registerTask:(task:any)=>registered.push(task),modelForTask:(dir:string,sessionId:string)=>{scoped.push({dir,sessionId});return h.options.model;}});
 await adapters.collect({attempts:[]});await adapters.collect({attempts:[]});
 assert.equal(registered.length,2);assert.equal(scoped.length,2);
 for(const [i,task]of registered.entries()){
  assert.equal(task.evidenceDir,h.dirs[i]);assert.equal(task.taskAttemptId,path.basename(h.dirs[i]));assert.notEqual(task.taskAttemptId,task.sessionId);
  assert.deepEqual(scoped[i],{dir:task.evidenceDir,sessionId:task.sessionId});
  const records=fs.readFileSync(path.join(task.evidenceDir,'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
  const starts=records.filter(e=>e.kind==='stage_start'),ends=records.filter(e=>e.kind==='stage_end');assert.equal(starts.length,i?1:4);assert.equal(ends.length,starts.length);assert.ok(ends.every(e=>e.status==='completed'));
  const requests=records.filter(e=>e.kind==='model_request'),results=records.filter(e=>e.kind==='model_result');assert.ok(requests.length>0);assert.equal(results.length,requests.length);
  for(const request of requests){assert.equal(path.dirname(request.request.frame.path),task.evidenceDir);assert.ok(results.some(e=>e.requestId===request.requestId));}
  for(const record of records){assert.equal(record.taskAttemptId,task.taskAttemptId);assert.equal(record.sessionId,task.sessionId);assert.ok(events.some(e=>e.kind===record.kind&&e.taskAttemptId===task.taskAttemptId&&e.at===record.at));}
 }
 const inputs=fs.readFileSync(path.join(h.dirs[0],'round-input.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 for(const input of inputs)assert.ok(events.some(e=>e.kind===input.kind&&e.stage===input.stage&&e.action.type===input.action.type&&e.taskAttemptId===registered[0].taskAttemptId));
});
test('failed model query has durable request before await and error plus stage end in child and root',async t=>{
 const h=setup(t),events:any[]=[],registered:any[]=[];let requests=0;
 const adapters=createRoundAdapters({...h.options,execution:{event:(kind:string,data:any)=>events.push({kind,...data}),registerTask:(task:any)=>registered.push(task),modelForTask:()=>({usage:[],query:async()=>{
  requests++;const records=fs.readFileSync(path.join(h.dirs[0],'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));assert.equal(records.at(-1).kind,'model_request');throw Error('Synthetic offline model failure');
 }})}});
 await assert.rejects(adapters.collect({attempts:[]}),/Login\/verification|AI panel/);assert.equal(requests,1);assert.equal(registered.length,1);
 const records=fs.readFileSync(path.join(h.dirs[0],'agent.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 assert.match(records.find(e=>e.kind==='model_error').error,/Synthetic offline model failure/);assert.equal(records.at(-1).kind,'stage_end');assert.notEqual(records.at(-1).status,'completed');
 assert.ok(events.some(e=>e.kind==='model_error'));assert.equal(records.filter(e=>e.kind==='model_result').length,0);
});
test('task outcomes identify current round and retain inherited prefix records and scoped usage',async t=>{
 const h=setup(t),registered:any[]=[],archives:any[]=[];
 const adapters=createRoundAdapters({...h.options,registerTask:(task:any)=>registered.push(task),modelForTask:()=>({usage:[],query:async()=>({})}),saveTask:async(v:any)=>{archives.push(v);return {runId:archives.length,v2Archived:true,partial:false,gainCoins:10};},runtimeFactory:(_cfg:any,_device:any,model:any,opts:any)=>({stage:async(id:string,ctx:any)=>{
  if(id==='collect_list'){model.usage.push({task:ctx.taskAttemptId});fs.writeFileSync(path.join(opts.evidenceDir,'inventory.json'),JSON.stringify({complete:true,pages:[]}));}
  return {status:'completed',...(id==='select_task'?{task:{name:opts.plan[0].name,instruction:'浏览',done:0,total:1},balanceBefore:10}:{}),...(id==='settle'?{balanceAfter:20}:{})};
 }})});
 for(const name of ['A','B']){
  await adapters.collect({});const result=await adapters.execute({name,instruction:'浏览'},{});
  assert.equal(result.roundId,h.options.round.id);const task=registered.at(-1);assert.equal(result.taskAttemptId,task.taskAttemptId);
  assert.equal(JSON.parse(fs.readFileSync(path.join(task.evidenceDir,'final.json'),'utf8')).roundId,h.options.round.id);
 }
 const inherited=archives[1].stages.slice(0,3);assert.deepEqual(inherited.map((s:any)=>s.stageId),['open_app','enter_activity','open_list']);assert.ok(inherited.every((s:any)=>s.inheritedFromRound&&s.sourceSessionId===registered[0].sessionId));
 const prefix=JSON.parse(fs.readFileSync(path.join(registered[1].evidenceDir,'prefix-stages.json'),'utf8'));assert.deepEqual(prefix.slice(0,3),inherited);
 assert.deepEqual(archives.map(v=>v.usage),registered.map(v=>[{task:v.taskAttemptId}]));
});
test('thrown runtime errors record the matching stage end before propagation',async t=>{
 const h=setup(t),events:any[]=[];
 const adapters=createRoundAdapters({...h.options,event:(kind:string,data:any)=>events.push({kind,...data}),runtimeFactory:()=>({stage:async()=>{throw Error('Synthetic stage throw');}})});
 await assert.rejects(adapters.collect({}),/Synthetic stage throw/);
 assert.deepEqual(events.map(e=>e.kind),['stage_start','stage_end']);assert.equal(events[1].status,'error');assert.equal(events[1].error,'Synthetic stage throw');
});
