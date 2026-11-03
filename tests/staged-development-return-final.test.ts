import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
for(const unknown of [false,true])test(`development ordinary return exceeds old cap, unknown=${unknown} never replays`,async t=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'development-returns-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 let backs=0,n=0;const cfg={executionPolicy:'development-unbounded-v1',package:'com.taobao.taobao',scope:{appId:'a',accountId:'b',activityId:'c',userId:0},constraints:['no pay'],scriptValidationMode:true,panelMarker:'赚金币抵钱',limits:{stageMs:null,sessionMs:null,stageActions:null,agentCalls:null,maxReturns:1},stages:{return_list:{goal:'return',checkpoint:'list'}}};
 const rt=createStagedRuntime(cfg,{capture:async()=>({id:'f'+(++n),path:'/offline.png',width:1080,height:2400,package:cfg.package,userId:0,capturedAt:Date.now(),lines:backs>=5?[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'任务（0/1）',bounds:[230,700,650,750]},{text:'浏览5秒',bounds:[230,770,650,800]},{text:'去完成',bounds:[880,720,1000,760]}]:[]}),act:async(a:any)=>{if(a.type==='back'){backs++;if(unknown)throw Error('unknown back');}}},{query:async()=>{throw Error('No model');}},{sessionId:'offline-return',evidenceDir:dir,plan:[]});
 const r=await rt.stage('return_list',{});assert.equal(r.status,unknown?'unknown':'completed',r.error);assert.equal(backs,unknown?1:5);if(unknown){await rt.stage('return_list',{});assert.equal(backs,1);}
});
