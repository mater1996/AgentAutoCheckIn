import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
test('learning selection rejects Agent choice already completed and examines later pages',async()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'learn-select-'));let n=0;
 const frame=(name:string)=>({id:String(++n),path:'f.png',width:1080,height:2400,capturedAt:Date.now(),package:'p',userId:0,lines:[{text:'赚金币抵钱',bounds:[390,470,680,530]},{text:'1550',bounds:[90,240,210,300]},{text:name+'（0/1）',bounds:[230,900,650,950]},{text:'浏览',bounds:[230,970,340,1010]},{text:'去完成',bounds:[880,920,1000,960]}]});
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},panelMarker:'赚金币抵钱',limits:{stageMs:1000,agentCalls:10},taskPolicy:'ordinary browse only',constraints:[]};
 const rt=createStagedRuntime(cfg,{capture:async()=>frame(n===0?'Old':'New'),act:async()=>{}},{query:async()=>({ordinaryBrowse:true,name:n===1?'Old':'New',instruction:'浏览'})},{sessionId:'s',evidenceDir:dir,plan:[],completed:['Old']});
 const r=await rt.stage('select_task',{});assert.equal(r.task?.name,'New');fs.rmSync(dir,{recursive:true,force:true});
});
