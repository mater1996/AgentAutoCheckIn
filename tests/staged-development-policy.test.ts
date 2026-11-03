import test from 'node:test';
import assert from 'node:assert/strict';
import {runStage} from '../runner/staged/engine.ts';
import {validateStagedConfig} from '../runner/staged/config.ts';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import fs from 'node:fs';
import path from 'node:path';
const policy='development-unbounded-v1';
const frame=(n:number)=>({id:'frame-'+n,path:'/offline/'+n+'.png',capturedAt:1,width:1080,height:2400,package:'com.taobao.taobao',userId:0,lines:[]});
test('development engine exceeds old time/action/call/round caps without scheduling a business timer',async()=>{
 const real=setTimeout;let timers=0;(globalThis as any).setTimeout=(...args:any[])=>{timers++;return (real as any)(...args);};
 let n=0,actions=0,checks=0;const remains:any[]=[];
 try{
 const result=await runStage({sessionId:'offline',stageId:'open_task',executionPolicy:policy,scope:{appId:'a',accountId:'b',activityId:'c',userId:0},goal:'offline',expectedCheckpoint:'done',constraints:{frameMaxAgeMs:1,maxRounds:1},budget:{maxMs:1,maxActions:1,maxAgentCalls:1}}, {now:()=>999999,observe:async()=>frame(++n),check:async()=>({done:++checks>55,checkpoint:checks>55?'done':undefined}),agentStep:async c=>{remains.push(c.remaining);return {frameId:c.frame.id,action:{type:'wait',ms:0},expected:'done',reason:'offline'};},dispatch:async()=>{actions++;}});
 assert.equal(result.status,'completed',result.error);assert.equal(actions,55);assert.equal(timers,0);assert.ok(remains.every(r=>Object.values(r).every(v=>v===null)),'disabled budget is explicit null in archives');
 }finally{globalThis.setTimeout=real;}
});
test('development engine keeps frame consumption and stops unknown input without resending',async()=>{
 let taps=0,n=0;const result=await runStage({sessionId:'offline',stageId:'open_task',executionPolicy:policy,scope:{appId:'a',accountId:'b',activityId:'c',userId:0},goal:'offline',expectedCheckpoint:'done',constraints:{frameMaxAgeMs:1,maxRounds:1},budget:{maxMs:1,maxActions:1,maxAgentCalls:1}}, {now:()=>999999,observe:async()=>frame(++n),check:async()=>({done:false}),agentStep:async c=>({frameId:c.frame.id,action:{type:'tap',x:300,y:400},expected:'done',reason:'offline'}),dispatch:async()=>{taps++;throw Error('unknown input');}});
 assert.equal(result.status,'unknown');assert.equal(taps,1);
});
test('development collection exceeds top-search and inventory page caps',async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'development-pages-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let captures=0,swipes=0;
 const rt=createStagedRuntime({executionPolicy:policy,package:'com.taobao.taobao',scope:{userId:0},panelMarker:'赚金币抵钱',limits:{stageMs:1,sessionMs:1,agentCalls:1,inventoryPages:1}}, {capture:async()=>{const n=++captures;return {...frame(n),lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'普通任务（0/1）',bounds:[230,700,650,750]},{text:'浏览5秒币+20',bounds:[230,770,650,800]},{text:'去完成',bounds:[880,720,1000,760]},...(n>=6?[{text:'完成进度 0/1',bounds:[230,550,600,600]}]:[]),...(n>=11?[{text:'以上奖励均为最高奖励',bounds:[200,2200,900,2250]}]:[])]};},act:async(a:any)=>{if(a.type==='swipe')swipes++;}}, {query:async()=>{throw Error('No model needed');}}, {sessionId:'offline-pages',evidenceDir:dir,plan:[]});
 const result=await rt.stage('collect_list',{});assert.equal(result.status,'completed',result.error);assert.equal(captures,11);assert.equal(swipes,10);const saved=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'),'utf8'));assert.equal(saved.complete,true);
});
test('development config permits disabled artificial budgets but retains one task per session',()=>{
 const cfg:any={executionPolicy:policy,scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'com.taobao.taobao',assetId:'coin',model:{baseUrl:'http://127.0.0.1:1',name:'fake'},constraints:['no purchases'],limits:{maxTasks:1,sessionMs:null,stageMs:null,agentCalls:null,stageActions:null,inventoryPages:null,maxReturns:null},stages:Object.fromEntries(['open_app','enter_activity','open_list','open_task','task_receipt','return_list'].map(id=>[id,{goal:id,checkpoint:id}]))};
 assert.equal(validateStagedConfig(cfg).executionPolicy,policy);assert.throws(()=>validateStagedConfig({...cfg,executionPolicy:'typo'}),/policy/);assert.throws(()=>validateStagedConfig({...cfg,limits:{...cfg.limits,maxTasks:2}}),/one task/);
});
