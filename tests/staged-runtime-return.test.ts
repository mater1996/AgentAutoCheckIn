import test from 'node:test';import assert from 'node:assert/strict';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
test('runtime marks builtin return as tested primitive and passes object constraints',async()=>{
 const cfg:any={scope:{appId:'a',accountId:'b',activityId:'c',userId:0},constraints:['no pay'],limits:{stageMs:90000,stageActions:4,maxReturns:3,agentCalls:10},stages:{return_list:{goal:'return',checkpoint:'list'}}};
 const rt=createStagedRuntime(cfg,{}as any,{}as any,{evidenceDir:'.',sessionId:'s',plan:[],runStage:async(input:any)=>{assert.equal(input.constraints.rules[0],'no pay');assert.equal(input.script.validated,true);return {status:'stopped'};}});
 assert.equal((await rt.stage('return_list',{})).status,'stopped');
});
