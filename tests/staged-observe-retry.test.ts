import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createStagedRuntime} from '../runner/staged/runtime.ts';
test('transient OCR capture failure is retried read-only under same stage before dispatch',async()=>{
 const dir=fs.mkdtempSync(path.join(process.env.TMPDIR!,'staged-observe-'));let reads=0,actions=0;
 const f:any={id:'f',path:'x',width:1080,height:2400,capturedAt:Date.now(),lines:[],package:'p',userId:0};
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},package:'p',panelMarker:'panel',constraints:[],limits:{stageMs:1000,agentCalls:2,stageActions:1},stages:{open_app:{goal:'open',checkpoint:'p'}}};
 const rt=createStagedRuntime(cfg,{capture:async()=>{if(++reads===1)throw Error('Invalid OCR frame or bounds');return f;},act:async()=>{actions++;}},{}as any,{evidenceDir:dir,sessionId:'s',plan:[],runStage:async(_i:any,d:any)=>{assert.equal((await d.observe()).id,'f');return {status:'completed'};}});
 await rt.stage('open_app',{});assert.equal(reads,2);assert.equal(actions,0);fs.rmSync(dir,{recursive:true,force:true});
});
