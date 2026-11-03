import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStagedRuntime} from '../runner/staged/runtime.ts';
import {DecisionChannel, RecipeBridge, runRecipeStage} from '../runner/mcp/recipe-bridge.ts';

test('recipe stage reuses validated steps and suppresses stage review candidates', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  let captures = 0;
  let scripts = 0;
  let reviews = 0;
  const actions:string[] = [];
  const result = await bridge.start('learned',()=>runRecipeStage({
    executionPolicy:'development-unbounded-v1',sessionId:'session',stageId:'open_task',scope:{appId:'app',accountId:'account',activityId:'activity',userId:0},
    goal:'browse',expectedCheckpoint:'destination',constraints:{},script:{id:'recipe',version:'v1',validated:true},budget:{maxMs:1,maxActions:1,maxAgentCalls:0}
  },{
    observe:async()=>({id:`f${++captures}`,path:'/fixture.png',width:100,height:200,capturedAt:Date.now(),package:'app',userId:0,lines:[]}),
    check:async()=>({done:captures===2,checkpoint:captures===2?'destination':undefined}),
    scriptStep:async ctx=>{scripts++;return {frameId:ctx.frame.id,action:{type:'wait',ms:10},reason:'learned',expected:'destination'};},
    agentStep:async()=>{throw Error('Learned stage must not call Agent');},
    dispatch:async action=>{actions.push(action.type);},
    review:async()=>{reviews++;return {candidate:{state:'candidate'}};}
  }));
  assert.equal(result.status,'completed');
  assert.equal(scripts,1);
  assert.equal(reviews,0);
  assert.deepEqual(actions,['wait']);
  if(result.status === 'completed') {
    assert.equal(result.result.usedScriptVersion,'v1');
    assert.equal(result.result.derivedCandidate,undefined);
    assert.equal(result.result.actions[0].status,'verified');
  }
});

test('existing staged runtime pauses for the host and continues the same attempt with no network', async () => {
  const evidenceDir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(),'recipe-bridge-'));
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const cfg = {executionPolicy:'development-unbounded-v1',package:'target.app',scope:{appId:'app',accountId:'account',activityId:'activity',userId:0},
    limits:{stageMs:1,stageActions:1,agentCalls:1},constraints:[],stages:{open_task:{goal:'confirm ordinary browse',checkpoint:'destination'}}};
  let captures = 0;
  const rt = createStagedRuntime(cfg,{
    capture:async()=>({id:`current-${++captures}`,path:path.join(evidenceDir,'frame.png'),width:100,height:200,capturedAt:Date.now(),package:'target.app',userId:0,lines:[]}),
    act:async()=>{throw Error('No action is needed for this current destination');}
  },channel,{sessionId:'session',evidenceDir,plan:[],runStage:runRecipeStage});
  try {
    const pause = await bridge.start('execution:attempt:open_task',()=>rt.stage('open_task',{taskAttemptId:'attempt'}));
    if(pause.status !== 'needs_decision') throw Error('decision expected');
    assert.equal(pause.decision.request.context.taskAttemptId,'attempt');
    assert.equal(pause.decision.request.context.stageId,'open_task');
    await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(bridge.status().status,'needs_decision');
    const result = await bridge.respond(pause.decision.id,{stageDone:true,pageIdentity:'ordinary browsing destination',blocked:false,ordinaryBrowseOnly:true,next:null});
    assert.equal(result.status,'completed');
    assert.equal(captures,1);
    assert.equal(rt.calls,1);
    if(result.status === 'completed') {
      assert.equal(result.result.review,undefined);
      assert.equal(result.result.derivedCandidate,undefined);
    }
  } finally {await bridge.cancel();fs.rmSync(evidenceDir,{recursive:true,force:true});}
});
