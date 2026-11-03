import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DecisionChannel, RecipeBridge} from '../runner/mcp/recipe-bridge.ts';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => {let resolve!:()=>void; const promise = new Promise<void>(r => {resolve=r;}); return {promise,resolve};};

const frame = {id:'frame-1', path:'/evidence/frame-1.png', width:100, height:200, capturedAt:1};

test('host decision resumes the original stage and attempt without another model transport', async () => {
  let starts = 0;
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const paused = await bridge.start('execution-1:attempt-1:recipe-v1', async () => {
    starts++;
    const observation = await channel.query({prompt:'Read screenshot', frame, context:{taskAttemptId:'attempt-1', stageId:'open_task'}});
    return {status:'completed', checkpoint:'destination', observation};
  });
  assert.equal(paused.status,'needs_decision');
  if (paused.status !== 'needs_decision') throw Error('decision expected');
  assert.equal(paused.id,'execution-1:attempt-1:recipe-v1');
  assert.equal(paused.decision.request.prompt,'Read screenshot');
  assert.deepEqual(paused.decision.request.frame,frame);
  assert.equal(paused.decision.request.context.taskAttemptId,'attempt-1');
  const completed = await bridge.respond(paused.decision.id, {stageDone:true});
  assert.equal(completed.status,'completed');
  assert.equal(starts,1);
  if(completed.status === 'completed') assert.deepEqual(completed.result.observation,{stageDone:true});
  assert.deepEqual(bridge.status(),completed);
});

test('channel ignores HTTP maxMs, isolates request data, rejects stale ids and accepts only JSON objects', async () => {
  const channel = new DecisionChannel();
  const context = {taskAttemptId:'attempt-1'};
  const work = channel.query({prompt:'read',context,maxMs:1});
  context.taskAttemptId = 'changed';
  await new Promise(resolve => setTimeout(resolve,5));
  const snapshot = channel.snapshot();
  assert.equal(snapshot.status,'needs_decision');
  if(snapshot.status !== 'needs_decision') throw Error('decision expected');
  assert.equal(snapshot.decision.request.context.taskAttemptId,'attempt-1');
  assert.equal('maxMs' in snapshot.decision.request,false);
  assert.throws(()=>channel.answer('old-id',{}),/decision id/);
  for(const value of [null,[],true,'not json',{bad:Infinity},{bad:undefined}]) {
    assert.throws(()=>channel.answer(snapshot.decision.id,value),/JSON object/);
    assert.equal(channel.snapshot().status,'needs_decision');
  }
  channel.answer(snapshot.decision.id,'{"stageDone":true}');
  assert.deepEqual(await work,{stageDone:true});
  assert.throws(()=>channel.answer(snapshot.decision.id,{}),/decision id/);
});

test('cancel waits for an active action to exit and never reports its late success as completion', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const gate = deferred();
  const started = bridge.start('long-action',async () => {await gate.promise;return {status:'completed'};});
  await tick();
  let cancelled = false;
  const cancellation = bridge.cancel('host closed').then(()=>{cancelled=true;});
  await tick();
  assert.equal(cancelled,false);
  assert.deepEqual(bridge.status(),{status:'running',id:'long-action',cancelling:true});
  await assert.rejects(bridge.start('another',async()=>({})),/active|cancelled|closed/);
  gate.resolve();
  await cancellation;
  const result = await started;
  assert.equal(result.status,'stopped');
  if(result.status === 'stopped') assert.equal(result.cancelled,true);
  await assert.rejects(bridge.start('after-close',async()=>({})),/cancelled|closed/);
});

test('cancellation rejects a pending decision and cleans up channel and blocked tool calls', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const paused = await bridge.start('cancel-pending',()=>channel.query({prompt:'read'}));
  assert.equal(paused.status,'needs_decision');
  await bridge.cancel('host shutdown');
  assert.equal(channel.snapshot().status,'idle');
  const result = bridge.status();
  assert.equal(result.status,'stopped');
  if(result.status === 'stopped') {
    assert.equal(result.cancelled,true);
    assert.match(result.error!,/host shutdown/);
  }
  await assert.rejects(bridge.respond('old',{}),/active/);
  await assert.rejects(channel.query({prompt:'after cancel'}),/host shutdown/);
});

test('request AbortSignal rejects only its decision and leaves no stale prompt', async () => {
  const channel = new DecisionChannel();
  const controller = new AbortController();
  const query = channel.query({prompt:'read',signal:controller.signal});
  const rejected = assert.rejects(query,/aborted/);
  controller.abort();
  await rejected;
  assert.equal(channel.snapshot().status,'running');
  await assert.rejects(channel.query({prompt:'already aborted',signal:controller.signal}),/aborted/);
  const next = channel.query({prompt:'fresh'});
  const state = channel.snapshot();
  if(state.status !== 'needs_decision') throw Error('decision expected');
  channel.answer(state.decision.id,{});
  await next;
});

test('multiple visual interruptions keep one active job and reject replay of a stopped stage id', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  let starts = 0;
  const first = await bridge.start('attempt:open_task',async()=>{
    starts++;
    await channel.query({prompt:'first'});
    await channel.query({prompt:'second'});
    return {status:'unknown',actions:[{status:'unknown'}],error:'input outcome unknown'};
  });
  if(first.status !== 'needs_decision') throw Error('decision expected');
  await assert.rejects(bridge.start('other-stage',async()=>({})),/active/);
  await assert.rejects(channel.query({prompt:'concurrent'}),/already pending/);
  const second = await bridge.respond(first.decision.id,{});
  if(second.status !== 'needs_decision') throw Error('decision expected');
  assert.notEqual(second.decision.id,first.decision.id);
  await assert.rejects(async()=>bridge.respond(first.decision.id,{}),/decision id/);
  const stopped = await bridge.respond(second.decision.id,{});
  assert.equal(stopped.status,'stopped');
  if(stopped.status === 'stopped') assert.equal(stopped.result.status,'unknown');
  assert.equal(starts,1);
  await assert.rejects(bridge.start('attempt:open_task',async()=>{starts++;return {};}),/already|replay/);
  assert.equal(starts,1);
  assert.equal(channel.snapshot().status,'idle');
  await bridge.cancel();
});

test('a job that exits with an unawaited query cleans up that abandoned decision', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  let abandoned!:Promise<any>;
  const first = await bridge.start('exits-early',async()=>{
    abandoned = channel.query({prompt:'abandoned'});
    void abandoned.catch(()=>{});
    throw Error('stage failed');
  });
  assert.equal(first.status,'needs_decision');
  await tick();
  assert.equal(bridge.status().status,'stopped');
  assert.equal(channel.snapshot().status,'idle');
  await assert.rejects(abandoned,/exited/);
  const next = await bridge.start('next-stage',()=>channel.query({prompt:'new stage'}));
  if(next.status !== 'needs_decision') throw Error('decision expected');
  assert.equal(next.decision.request.prompt,'new stage');
  const done = await bridge.respond(next.decision.id,{status:'completed'});
  assert.equal(done.status,'completed');
  await bridge.cancel();
});

test('a deterministic action segment stays running until its actual completion event', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const gate = deferred();
  let settled = false;
  const work = bridge.start('continuous-scroll',async()=>{await gate.promise;return {status:'completed',receipt:{quote:'current task done'}};});
  void work.then(()=>{settled=true;});
  await tick();
  await tick();
  assert.equal(settled,false);
  assert.deepEqual(bridge.status(),{status:'running',id:'continuous-scroll'});
  assert.equal(channel.snapshot().status,'idle');
  gate.resolve();
  const completed = await work;
  assert.equal(completed.status,'completed');
  if(completed.status === 'completed') completed.result.receipt.quote='mutated by reader';
  const saved = bridge.status();
  if(saved.status !== 'completed') throw Error('completion expected');
  assert.equal(saved.result.receipt.quote,'current task done');
  await bridge.cancel();
});

test('invalid host responses reject as Promises while keeping the current decision answerable', async () => {
  const channel = new DecisionChannel();
  const bridge = new RecipeBridge(channel);
  const paused = await bridge.start('respond-errors',()=>channel.query({prompt:'read'}));
  if(paused.status !== 'needs_decision') throw Error('decision expected');
  const staleResponse = bridge.respond('stale-id',{});
  await assert.rejects(staleResponse,/decision id/);
  const invalidResponse = bridge.respond(paused.decision.id,null);
  await assert.rejects(invalidResponse,/JSON object/);
  assert.equal(bridge.status().status,'needs_decision');
  const done = await bridge.respond(paused.decision.id,{status:'completed'});
  assert.equal(done.status,'completed');
  await bridge.cancel();
});
