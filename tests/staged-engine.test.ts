import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runStage, selectCurrentTask } from '../runner/staged/engine.ts';
import type { Frame, StageInput, StageDeps, StageContext } from '../runner/staged/contracts.ts';

const frame = (id = 'f1'): Frame => ({ id, path: `/fixtures/${id}.png`, width: 100, height: 200, capturedAt: 1000, lines: ['fixture'], package: 'target.app', userId: 10 });
const input = (extra: Partial<StageInput> = {}): StageInput => ({
  sessionId: 'session', stageId: 'return-list', scope: { appId: 'app', accountId: 'account', activityId: 'activity', userId: 10 },
  goal: '回到任务列表', previousCheckpoint: 'receipt', expectedCheckpoint: 'list', constraints: {},
  budget: { maxMs: 10000, maxAgentCalls: 5, maxActions: 5 }, ...extra,
});
function fixture(overrides: Partial<StageDeps> = {}) {
  const order: string[] = [];
  let observations = 0;
  const deps: StageDeps = {
    now: () => 1000,
    observe: async () => { order.push('observe'); return frame(`f${++observations}`); },
    check: async context => { order.push('check'); return { done: context.frame.id === 'f2', checkpoint: context.frame.id === 'f2' ? 'list' : 'receipt' }; },
    agentStep: async context => { order.push('agent'); return { frameId: context.frame.id, action: { type: 'back' }, expected: 'list', reason: '返回' }; },
    dispatch: async () => { order.push('dispatch'); }, ...overrides,
  };
  return { deps, order };
}

test('observes and verifies every pending action before completion, keeping intent separate', async () => {
  const f = fixture();
  const result = await runStage(input(), f.deps);
  assert.equal(result.status, 'completed');
  assert.equal(result.stageId, 'return-list');
  assert.equal(result.checkpoint, 'list');
  assert.deepEqual(f.order, ['observe', 'check', 'agent', 'dispatch', 'observe', 'check']);
  assert.equal(result.actions[0].status, 'verified');
});

test('settles a successful tap before checking fresh evidence so a delayed transition never repeats it', async () => {
  let time = 1000;
  let captures = 0;
  let taps = 0;
  let agents = 0;
  const order: string[] = [];
  const persisted: { type: string; [key: string]: unknown }[] = [];
  const result = await runStage(input({ budget: { maxMs: 10000, maxAgentCalls: 2, maxActions: 2 } }), fixture({
    now: () => time,
    observe: async () => {
      const page = time >= 1500 ? 'detail' : 'list';
      order.push(`observe:${page}`);
      return { ...frame(`f${++captures}`), capturedAt: time, lines: [page] };
    },
    check: async context => {
      order.push(`check:${context.frame.lines[0]}`);
      return { done: context.frame.lines[0] === 'detail', checkpoint: context.frame.lines[0] === 'detail' ? 'detail' : 'list' };
    },
    agentStep: async context => {
      agents++;
      return { frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'detail', reason: 'open task' };
    },
    dispatch: async (action, current) => {
      order.push(action.type);
      if (action.type === 'tap') taps++;
      else if (action.type === 'wait') {
        assert.equal(current.id, 'f2');
        assert.ok(action.ms >= 500 && action.ms <= 1000);
        time += action.ms;
      }
    },
    persist: event => persisted.push(event),
  }).deps);
  assert.equal(taps, 1);
  assert.equal(result.status, 'completed');
  assert.equal(agents, 1);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].status, 'verified');
  assert.deepEqual(order, ['observe:list', 'check:list', 'tap', 'observe:list', 'wait', 'observe:detail', 'check:detail']);
  assert.ok(result.events.some(event => event.type === 'tap_settling' && typeof event.ms === 'number' && event.ms <= 1000));
  assert.ok(persisted.some(event => event.type === 'tap_settling'));
});

test('rejects an inference-expired proposal then reobserves and replans with fresh coordinates', async () => {
  let time = 1000;
  let captures = 0;
  const proposedFrames: string[] = [];
  const dispatched: { type: string; frameId: string; x?: number }[] = [];
  const result = await runStage(input({ constraints: { frameMaxAgeMs: 50 }, budget: { maxMs: 10000, maxAgentCalls: 2, maxActions: 2 } }), fixture({
    now: () => time,
    observe: async () => ({ ...frame(`f${++captures}`), capturedAt: time }),
    check: async () => ({ done: dispatched.some(action => action.type === 'tap') }),
    agentStep: async context => {
      proposedFrames.push(context.frame.id);
      if (proposedFrames.length === 1) time += 51;
      else {
        assert.match(context.error!, /frame expired/);
        assert.equal(context.remaining.agentCalls, 0);
        assert.equal(context.recentActions[0].status, 'rejected');
      }
      return { frameId: context.frame.id, action: { type: 'tap', x: proposedFrames.length === 1 ? 10 : 80, y: 30 }, expected: 'list', reason: 'fresh target' };
    },
    dispatch: async (action, current) => { dispatched.push({ type: action.type, frameId: current.id, ...('x' in action ? { x: action.x } : {}) }); },
  }).deps);
  assert.deepEqual(proposedFrames, ['f1', 'f2']);
  assert.deepEqual(dispatched.filter(action => action.type === 'tap'), [{ type: 'tap', frameId: 'f2', x: 80 }]);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.actions.map(action => action.status), ['rejected', 'verified']);
  assert.equal(result.actions[0].error, 'frame expired');
  assert.ok(result.events.some(event => event.type === 'proposal_rejected' && event.error === 'frame expired'));
});

test('explicit beforeDispatch reobserves after slow inference and dispatches only the new proposal', async () => {
  let time = 1000;
  let captures = 0;
  let calls = 0;
  const dispatched: { action: unknown; frame: Frame }[] = [];
  const sourceProposal = { frameId: 'f1', action: { type: 'swipe' as const, x1: 10, y1: 180, x2: 10, y2: 20 }, expected: 'list', reason: 'slow model' };
  const freshFrame = { ...frame('revalidated'), capturedAt: 1051 };
  const freshProposal = { ...sourceProposal, frameId: freshFrame.id, action: { type: 'swipe' as const, x1: 80, y1: 170, x2: 80, y2: 30 }, reason: 'relocated on fresh evidence' };
  const persisted: unknown[] = [];
  const result = await runStage(input({ constraints: { frameMaxAgeMs: 50 }, budget: { maxMs: 10000, maxAgentCalls: 1, maxActions: 1 } }), fixture({
    now: () => time,
    observe: async () => ({ ...frame(`f${++captures}`), capturedAt: time }),
    check: async () => ({ done: dispatched.length === 1 }),
    agentStep: async () => { time += 51; return sourceProposal; },
    beforeDispatch: async (context, proposal) => {
      calls++;
      assert.equal(context.frame.id, 'f1');
      assert.deepEqual(proposal, sourceProposal);
      assert.equal(context.remaining.agentCalls, 0);
      assert.ok(context.remaining.ms <= 9949);
      return { frame: freshFrame, proposal: freshProposal };
    },
    dispatch: async (action, current) => { dispatched.push({ action, frame: current }); },
    persist: event => persisted.push(event),
  }).deps);
  assert.equal(result.status, 'completed');
  assert.equal(calls, 1);
  assert.deepEqual(dispatched, [{ action: freshProposal.action, frame: freshFrame }]);
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.actions[0].proposal, freshProposal);
  assert.equal(result.actions[0].status, 'verified');
  const audit = result.events.find(event => event.type === 'before_dispatch_revalidated');
  assert.ok(audit);
  assert.equal(audit.sourceFrameId, sourceProposal.frameId);
  assert.equal(audit.newFrameId, freshFrame.id);
  assert.deepEqual(audit.sourceProposal, sourceProposal);
  assert.deepEqual(audit.frame, freshFrame);
  assert.deepEqual(audit.proposal, freshProposal);
  assert.ok(persisted.includes(audit));
});

test('beforeDispatch rejects new evidence that fails frame authority or the shared proposal gate', async () => {
  for (const boundary of ['same frame', 'mismatch', 'expired', 'future', 'user', 'size', 'coordinate', 'forbidden', 'missing action', 'stop'] as const) {
    let dispatches = 0;
    const result = await runStage(input({ constraints: { allowedActions: ['back', 'tap'], frameMaxAgeMs: 50 } }), fixture({
      beforeDispatch: async (_context, source) => {
        const fresh = { ...frame(boundary === 'same frame' ? 'f1' : 'new'),
          capturedAt: boundary === 'expired' ? 900 : boundary === 'future' ? 1001 : 1000,
          userId: boundary === 'user' ? 20 : 10, width: boundary === 'size' ? 0 : 100 };
        return { frame: fresh, proposal: { ...source, frameId: boundary === 'mismatch' ? 'other' : fresh.id,
          ...(boundary === 'coordinate' ? { action: { type: 'tap' as const, x: 100, y: 1 } } : {}),
          ...(boundary === 'forbidden' ? { action: { type: 'launch' as const, package: 'target.app' } } : {}),
          ...(boundary === 'missing action' ? { action: undefined } : {}),
          ...(boundary === 'stop' ? { stop: true, reason: 'page changed' } : {}) } };
      },
      dispatch: async () => { dispatches++; },
    }).deps);
    assert.equal(dispatches, 0, boundary);
    assert.equal(result.status, 'stopped', boundary);
    assert.equal(result.actions[0].status, 'rejected', boundary);
    assert.match(result.error!, /frame|coordinate|forbidden|action|page changed/, boundary);
    assert.equal(result.events.some(event => event.type === 'before_dispatch_revalidated'), false, boundary);
  }
});

test('beforeDispatch refreshes every remaining budget after revalidation and refuses exhausted limits', async () => {
  for (const boundary of ['time', 'actions', 'agents', 'rounds'] as const) {
    let time = 1000;
    let dispatches = 0;
    let callbackContext: StageContext | undefined;
    const stage = input();
    const result = await runStage(stage, fixture({
      now: () => time,
      beforeDispatch: async (context, source) => {
        callbackContext = context;
        time += 100;
        if (boundary === 'time') time += stage.budget.maxMs;
        if (boundary === 'actions') stage.budget.maxActions = 0;
        if (boundary === 'agents') stage.budget.maxAgentCalls = 0;
        // The engine captures maxRounds at entry; mutating the context's rounds cannot grant more authority.
        if (boundary === 'rounds') context.remaining.rounds = -1;
        return { frame: { ...frame('new'), capturedAt: time }, proposal: { ...source, frameId: 'new' } };
      },
      dispatch: async () => { dispatches++; },
    }).deps);
    assert.ok(callbackContext);
    assert.ok(callbackContext.remaining.ms <= 9900);
    assert.equal(callbackContext.remaining.agentCalls, stage.budget.maxAgentCalls - 1);
    assert.equal(callbackContext.remaining.actions, stage.budget.maxActions - 1);
    assert.equal(callbackContext.remaining.rounds, 50);
    if (boundary === 'rounds') {
      assert.equal(dispatches, 1);
      assert.equal(result.status, 'completed');
    } else {
      assert.equal(dispatches, 0, boundary);
      assert.equal(result.status, 'stopped', boundary);
      assert.equal(result.actions[0].status, 'rejected', boundary);
      assert.match(result.error!, /budget|deadline/, boundary);
    }
  }
});

test('beforeDispatch null or failure stops without falling back to the original action', async () => {
  for (const boundary of ['null', 'throw', 'deadline'] as const) {
    let calls = 0;
    let dispatches = 0;
    let aborted: AbortSignal | undefined;
    const started = performance.now();
    const result = await runStage(input({ budget: { maxMs: boundary === 'deadline' ? 20 : 10000, maxAgentCalls: 1, maxActions: 1 } }), fixture({
      beforeDispatch: async context => {
        calls++;
        aborted = context.signal;
        if (boundary === 'throw') throw new Error('new observation failed');
        if (boundary === 'deadline') return new Promise<never>(() => {});
        return null;
      },
      dispatch: async () => { dispatches++; },
    }).deps);
    assert.equal(calls, 1, boundary);
    assert.equal(dispatches, 0, boundary);
    assert.equal(result.status, 'stopped', boundary);
    assert.equal(result.actions[0].status, 'rejected', boundary);
    assert.match(result.error!, /revalidation stopped|observation failed|deadline/, boundary);
    assert.equal(result.events.some(event => event.type === 'before_dispatch_revalidated'), false);
    if (boundary === 'deadline') {
      assert.ok(performance.now() - started < 250);
      assert.equal(aborted?.aborted, true);
    }
  }
});

test('beforeDispatch cannot bypass invalid source proposals even after source expiry', async () => {
  for (const bad of [
    { frameId: 'other', action: { type: 'back' } },
    { frameId: 'f1', action: { type: 'tap', x: -1, y: 20 } },
    { frameId: 'f1', action: { type: 'swipe', x1: 1, y1: 1, x2: 2, y2: 2, durationMs: -1 } },
    { frameId: 'f1', action: { type: 'launch', package: 'forbidden.app' } },
    { frameId: 'f1', action: { type: 'purchase' } },
  ]) {
    let time = 1000;
    let calls = 0;
    let dispatches = 0;
    const result = await runStage(input({ constraints: { frameMaxAgeMs: 50, allowedActions: ['tap', 'swipe', 'back'] } }), fixture({
      now: () => time,
      agentStep: async () => { time += 51; return { ...bad, expected: 'list', reason: 'invalid source' } as any; },
      beforeDispatch: async () => {
        calls++;
        return { frame: { ...frame('new'), capturedAt: time }, proposal: { frameId: 'new', action: { type: 'back' }, expected: 'list', reason: 'cannot repair source' } };
      },
      dispatch: async () => { dispatches++; },
    }).deps);
    assert.equal(calls, 0);
    assert.equal(dispatches, 0);
    assert.equal(result.status, 'stopped');
    assert.equal(result.actions[0].status, 'rejected');
    assert.match(result.error!, /frame mismatch|coordinate|forbidden/);
  }
});

test('beforeDispatch rejects previously consumed fresh frames and never replays an unknown dispatch', async () => {
  for (const boundary of ['reuse', 'unknown'] as const) {
    let captures = 0;
    let callbacks = 0;
    let agents = 0;
    let dispatches = 0;
    let checks = 0;
    const result = await runStage(input(), fixture({
      observe: async () => frame(`source${++captures}`),
      check: async context => {
        checks++;
        if (boundary === 'unknown' && checks === 2) assert.equal(context.pendingAction?.status, 'unknown');
        return { done: false };
      },
      agentStep: async context => { agents++; return { frameId: context.frame.id, action: { type: 'back' }, expected: 'list', reason: 'candidate' }; },
      beforeDispatch: async (_context, source) => {
        callbacks++;
        return { frame: frame('fresh'), proposal: { ...source, frameId: 'fresh' } };
      },
      dispatch: async () => { dispatches++; if (boundary === 'unknown') throw new Error('transport lost'); },
    }).deps);
    assert.equal(dispatches, 1, boundary);
    assert.equal(result.status, boundary === 'unknown' ? 'unknown' : 'stopped');
    assert.equal(callbacks, boundary === 'unknown' ? 1 : 2);
    assert.equal(agents, boundary === 'unknown' ? 1 : 2);
    assert.equal(checks, 2);
    if (boundary === 'reuse') {
      assert.equal(result.actions[1].status, 'rejected');
      assert.match(result.error!, /fresh frame.*reused/);
    } else assert.equal(result.actions[0].status, 'unknown');
  }
});

test('expired proposals stop at agent, action and round budgets without dispatching old coordinates', async () => {
  for (const limits of [{ maxAgentCalls: 1, maxActions: 5, maxRounds: 5 }, { maxAgentCalls: 5, maxActions: 1, maxRounds: 5 }, { maxAgentCalls: 5, maxActions: 5, maxRounds: 1 }]) {
    let time = 1000;
    let captures = 0;
    let agents = 0;
    let dispatches = 0;
    const result = await runStage(input({
      budget: { maxMs: 10000, maxAgentCalls: limits.maxAgentCalls, maxActions: limits.maxActions },
      constraints: { frameMaxAgeMs: 50, maxRounds: limits.maxRounds },
    }), fixture({
      now: () => time,
      observe: async () => ({ ...frame(`f${++captures}`), capturedAt: time }),
      check: async () => ({ done: false }),
      agentStep: async context => { agents++; time += 51; return { frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'list', reason: 'slow inference' }; },
      dispatch: async () => { dispatches++; },
    }).deps);
    assert.equal(result.status, 'stopped');
    assert.equal(agents, 1);
    assert.equal(captures, 2);
    assert.equal(dispatches, 0);
    assert.deepEqual(result.actions.map(action => action.status), ['rejected']);
    assert.match(result.error!, /budget|round/);
  }
});

test('tap settling uses only the remaining stage time and stops when it is spent', async () => {
  let time = 1000;
  let captures = 0;
  const waits: number[] = [];
  const result = await runStage(input({ budget: { maxMs: 400, maxAgentCalls: 2, maxActions: 2 } }), fixture({
    now: () => time,
    observe: async () => ({ ...frame(`f${++captures}`), capturedAt: time }),
    check: async () => ({ done: false }),
    agentStep: async context => ({ frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'list', reason: 'open' }),
    dispatch: async action => {
      if (action.type === 'tap') time += 100;
      else if (action.type === 'wait') { waits.push(action.ms); time += action.ms + 1; }
    },
  }).deps);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 0 && waits[0] <= 300);
  assert.equal(captures, 2);
  assert.equal(result.status, 'unknown');
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].status, 'unknown');
  assert.match(result.error!, /deadline/);
});

test('uncertain taps only receive read-only verification with no settling or replay', async () => {
  const dispatched: string[] = [];
  let checks = 0;
  const result = await runStage(input(), fixture({
    check: async () => ({ done: ++checks === 2 }),
    agentStep: async context => ({ frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'list', reason: 'open' }),
    dispatch: async action => { dispatched.push(action.type); throw new Error('tap transport lost'); },
  }).deps);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(dispatched, ['tap']);
  assert.equal(checks, 2);
  assert.equal(result.events.some(event => event.type === 'tap_settling'), false);
});

test('tap settling failures or reused evidence preserve unknown without replay', async () => {
  for (const boundary of ['wait', 'observe', 'reused', 'expired'] as const) {
    let captures = 0;
    const dispatched: string[] = [];
    const result = await runStage(input(), fixture({
      observe: async () => {
        captures++;
        if (captures === 3 && boundary === 'observe') throw new Error('settled capture failed');
        return { ...frame(boundary === 'reused' && captures === 3 ? 'f2' : `f${captures}`), capturedAt: boundary === 'expired' && captures === 3 ? -15000 : 1000 };
      },
      check: async () => ({ done: false }),
      agentStep: async context => ({ frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'list', reason: 'open' }),
      dispatch: async action => { dispatched.push(action.type); if (boundary === 'wait' && action.type === 'wait') throw new Error('settling wait failed'); },
    }).deps);
    assert.equal(result.status, 'unknown', boundary);
    assert.deepEqual(dispatched, ['tap', 'wait']);
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, 'unknown');
    assert.match(result.error!, /failed|fresh frame|expired/);
  }
});

test('script failure gives agent the complete context then resumes script only at a checked checkpoint', async () => {
  const scriptContexts: StageContext[] = [];
  const agentContexts: StageContext[] = [];
  const f = fixture({
    scriptStep: async context => {
      scriptContexts.push(structuredClone(context));
      if (scriptContexts.length === 1) throw new Error('button absent');
      return { frameId: context.frame.id, action: { type: 'tap', x: 20, y: 30 }, expected: 'list', reason: '续跑' };
    },
    check: async context => ({ done: ['f3', 'f4'].includes(context.frame.id), checkpoint: context.frame.id === 'f1' ? undefined : context.frame.id === 'f2' ? 'recovered' : 'list' }),
    agentStep: async context => { agentContexts.push(structuredClone(context)); return { frameId: context.frame.id, action: { type: 'back' }, expected: 'recovered', reason: '恢复' }; },
  });
  const stage = input({ script: { id: 'return', version: 'v1', validated: true }, taskAttemptId: 'task-run', task: { instruction: '原文' }, plan: { maxAttempts: 2 }, experience: { version: 'e1' } });
  const result = await runStage(stage, f.deps);
  assert.equal(result.status, 'completed');
  assert.equal(result.usedScriptVersion, 'v1');
  assert.equal(agentContexts.length, 1);
  assert.equal(agentContexts[0].error, 'button absent');
  assert.equal(agentContexts[0].lastCheckpoint, 'receipt');
  assert.equal(agentContexts[0].frame.id, 'f1');
  assert.deepEqual(agentContexts[0].scope, stage.scope);
  assert.deepEqual(agentContexts[0].task, stage.task);
  assert.deepEqual(agentContexts[0].plan, stage.plan);
  assert.deepEqual(agentContexts[0].experience, stage.experience);
  assert.equal(agentContexts[0].remaining.agentCalls, 4);
  assert.equal(scriptContexts[1].lastCheckpoint, 'recovered');
  assert.equal(scriptContexts[1].recentActions.length, 1);
  assert.equal(scriptContexts[1].recentActions[0].status, 'verified');
  assert.deepEqual(result.actions.map(a => a.source), ['agent', 'script']);
  assert.ok(result.events.some(e => e.type === 'script_error'));
});

test('dispatch uncertainty stays unknown after read-only verification and never replays the action', async () => {
  let dispatches = 0;
  let checks = 0;
  const f = fixture({
    dispatch: async () => { dispatches++; throw new Error('transport lost'); },
    check: async context => { checks++; if (checks === 2) assert.equal(context.pendingAction?.status, 'unknown'); return { done: checks === 2, checkpoint: checks === 2 ? 'list' : 'receipt' }; },
  });
  const result = await runStage(input(), f.deps);
  assert.equal(result.status, 'unknown');
  assert.equal(result.actions[0].status, 'unknown');
  assert.equal(dispatches, 1);
  assert.equal(checks, 2);
  assert.equal(result.checkpoint, 'list');
  assert.match(result.error!, /transport lost/);
});

test('refuses mismatched frames, stale coordinates and invalid actions through the shared gate', async () => {
  const invalid = [
    { frameId: 'other', action: { type: 'back' } },
    { frameId: 'f1', action: { type: 'tap', x: 100, y: 1 } },
    { frameId: 'f1', action: { type: 'swipe', x1: 1, y1: -1, x2: 2, y2: 3 } },
    { frameId: 'f1', action: { type: 'wait', ms: -1 } },
    { frameId: 'f1', action: { type: 'launch', package: '' } },
    { frameId: 'f1', action: { type: 'purchase' } },
  ];
  for (const bad of invalid) {
    const f = fixture({ agentStep: async () => ({ ...bad, expected: 'list', reason: 'fixture' }) as any });
    const result = await runStage(input(), f.deps);
    assert.equal(result.status, 'stopped');
    assert.equal(f.order.includes('dispatch'), false);
    assert.match(result.error!, /frame|coordinate|action|wait|package/);
  }
  for (const constraints of [{}, { frameMaxAgeMs: 50 }, { allowedActions: ['tap'] as const }]) {
    const f = fixture({ now: () => constraints.allowedActions ? 1000 : 17000 });
    const result = await runStage(input({ constraints }), f.deps);
    assert.equal(result.status, 'stopped');
    assert.equal(f.order.includes('dispatch'), false);
  }
});

test('budgets count failures, stop after a slow check, and bound no-action rounds', async () => {
  for (const budget of [{ maxMs: 0, maxAgentCalls: 5, maxActions: 5 }, { maxMs: 10000, maxAgentCalls: 0, maxActions: 5 }, { maxMs: 10000, maxAgentCalls: 5, maxActions: 0 }]) {
    const f = fixture();
    const result = await runStage(input({ budget }), f.deps);
    assert.equal(result.status, 'stopped');
    assert.equal(f.order.includes('dispatch'), false);
    assert.equal(f.order.includes('agent'), false);
  }
  let time = 1000;
  const slow = fixture({ now: () => time, check: async () => { time += 10001; return { done: false }; } });
  assert.equal((await runStage(input(), slow.deps)).status, 'stopped');
  assert.equal(slow.order.includes('agent'), false);
  let calls = 0;
  const failing = fixture({ agentStep: async () => { calls++; throw new Error('model failed'); } });
  const failed = await runStage(input({ budget: { maxMs: 10000, maxAgentCalls: 1, maxActions: 5 } }), failing.deps);
  assert.equal(failed.status, 'stopped');
  assert.equal(calls, 1);
  assert.ok(failed.events.some(e => e.type === 'agent_error' && e.agentCalls === 1));
  const empty = fixture({ check: async () => ({ done: false }), agentStep: async context => ({ frameId: context.frame.id, expected: 'claimed complete', reason: 'no evidence' }) });
  const bounded = await runStage(input({ constraints: { maxRounds: 2 } }), empty.deps);
  assert.equal(bounded.status, 'stopped');
  assert.match(bounded.error!, /round/);
});

test('blocked checks and proposal latency stop before dispatch even when completion is claimed', async () => {
  const blocked = fixture({ check: async () => ({ done: true, blocked: true, reason: '验证码' }) });
  const result = await runStage(input(), blocked.deps);
  assert.equal(result.status, 'stopped');
  assert.match(result.error!, /验证码/);
  assert.equal(blocked.order.includes('agent'), false);
  let time = 1000;
  const slow = fixture({ now: () => time, agentStep: async context => { time += 11000; return { frameId: context.frame.id, action: { type: 'back' }, expected: 'list', reason: 'slow' }; } });
  const expired = await runStage(input(), slow.deps);
  assert.equal(expired.status, 'stopped');
  assert.equal(slow.order.includes('dispatch'), false);
});

test('review receives evidence after completion and saves candidate without promoting or mutating execution', async () => {
  const script = { id: 'return', version: 'validated-v1', validated: true };
  const persisted: unknown[] = [];
  const candidate = { script: { id: 'return', version: 'candidate-v2', validated: true } };
  const f = fixture({
    persist: event => persisted.push(event),
    review: async summary => {
      assert.equal(summary.status, 'completed');
      assert.equal(summary.actions[0].status, 'verified');
      assert.ok(summary.events.some(e => e.type === 'observed'));
      summary.status = 'unknown';
      return candidate;
    },
  });
  const result = await runStage(input({ script }), f.deps);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.review, candidate);
  assert.deepEqual(result.derivedCandidate, { status: 'candidate', value: candidate });
  assert.equal(script.version, 'validated-v1');
  assert.ok(persisted.some((e: any) => e.type === 'review_candidate'));
  assert.equal(f.order.filter(x => x === 'dispatch').length, 1);
});

test('consumes frame authority once and performs final read-only verification at the round cap', async () => {
  let dispatches = 0;
  const reused = fixture({
    observe: async () => frame('same'), check: async () => ({ done: false }),
    dispatch: async () => { dispatches++; },
  });
  const rejected = await runStage(input({ constraints: { maxRounds: 3 } }), reused.deps);
  assert.equal(dispatches, 1);
  assert.equal(rejected.status, 'unknown');
  assert.equal(rejected.actions[0].status, 'unknown');
  assert.match(rejected.error!, /frame.*reused|fresh frame/);
  const capped = fixture();
  const verified = await runStage(input({ constraints: { maxRounds: 1 } }), capped.deps);
  assert.equal(verified.status, 'completed');
  assert.equal(verified.actions[0].status, 'verified');
});

test('null script stays with agent until a known checkpoint and passes recent failure evidence', async () => {
  let scripts = 0;
  const contexts: StageContext[] = [];
  const f = fixture({
    scriptStep: async () => { scripts++; return null; },
    check: async context => ({ done: context.frame.id === 'f4' }),
    agentStep: async context => { contexts.push(structuredClone(context)); return { frameId: context.frame.id, action: { type: 'back' }, expected: 'list', reason: 'recover' }; },
  });
  const result = await runStage(input({ script: { id: 's', version: 'v1', validated: true } }), f.deps);
  assert.equal(result.status, 'completed');
  assert.equal(scripts, 1);
  assert.match(contexts[0].error!, /script.*proposal/);
  assert.equal(contexts[1].recentActions.length, 1);
  assert.equal(contexts[1].recentActions[0].status, 'observed');
});

test('observation or verification failure preserves a dispatched action as unknown', async () => {
  for (const boundary of ['observe', 'check'] as const) {
    let count = 0;
    const f = fixture({
      observe: async () => { count++; if (boundary === 'observe' && count === 2) throw new Error('capture failed'); return frame(`f${count}`); },
      check: async () => { if (boundary === 'check' && count === 2) throw new Error('check failed'); return { done: false }; },
    });
    const result = await runStage(input(), f.deps);
    assert.equal(result.status, 'unknown');
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, 'unknown');
    assert.match(result.error!, /failed/);
  }
});

test('actual asynchronous calls including review cannot outlive the stage deadline', async () => {
  const never = () => new Promise<any>(() => {});
  for (const boundary of ['observe', 'check', 'agentStep', 'dispatch', 'review'] as const) {
    const f = fixture({ [boundary]: never, now: undefined });
    // Fresh evidence uses the real clock for this deadline test.
    if (boundary !== 'observe') f.deps.observe = async () => ({ ...frame(), id: String(Math.random()), capturedAt: Date.now() });
    if (boundary === 'review') f.deps.check = async () => ({ done: true });
    const started = performance.now();
    const result = await runStage(input({ budget: { maxMs: 20, maxAgentCalls: 3, maxActions: 3 } }), f.deps);
    assert.ok(performance.now() - started < 250, boundary);
    assert.equal(result.status, boundary === 'dispatch' ? 'unknown' : boundary === 'review' ? 'completed' : 'stopped');
    if (boundary === 'review') assert.ok(result.events.some(e => e.type === 'review_error'));
    else assert.match(result.error!, /deadline|timeout/);
  }
});

test('no-effect script action hands current evidence to agent rather than repeating the script', async () => {
  let scripts = 0;
  let recovered = false;
  const f = fixture({
    scriptStep: async context => { scripts++; return { frameId: context.frame.id, action: { type: 'back' }, expected: 'list', reason: 'script' }; },
    check: async () => ({ done: false, checkpoint: 'receipt', reason: 'unchanged page' }),
    agentStep: async context => { recovered = true; assert.match(context.error!, /unchanged|unverified/); return { frameId: context.frame.id, stop: true, expected: 'stop', reason: 'no safe next step' }; },
  });
  const result = await runStage(input({ script: { id: 's', version: 'v1', validated: true } }), f.deps);
  assert.equal(scripts, 1);
  assert.equal(recovered, true);
  assert.equal(result.status, 'stopped');
});

test('rejects invalid budgets and frame evidence before accepting claimed completion', async () => {
  for (const budget of [{ maxMs: NaN, maxAgentCalls: 1, maxActions: 1 }, { maxMs: 1000, maxAgentCalls: -1, maxActions: 1 }, { maxMs: 1000, maxAgentCalls: 1, maxActions: 0.5 }]) {
    const f = fixture();
    const result = await runStage(input({ budget }), f.deps);
    assert.equal(result.status, 'stopped');
    assert.equal(f.order.length, 0);
    assert.match(result.error!, /invalid.*budget/);
  }
  for (const bad of [{ ...frame(), userId: 20 }, { ...frame(), width: Infinity }, { ...frame(), capturedAt: 1001 }, { ...frame(), id: '' }]) {
    const f = fixture({ observe: async () => bad, check: async () => ({ done: true }) });
    const result = await runStage(input(), f.deps);
    assert.equal(result.status, 'stopped');
    assert.match(result.error!, /frame/);
  }
});

test('accepts runtime swipe coordinates and attaches current remaining budget to agent context', async () => {
  let sent: unknown;
  let time = 1000;
  const f = fixture({
    now: () => time,
    check: async context => { time += 100; return { done: context.frame.id === 'f2' }; },
    agentStep: async context => {
      assert.ok(context.remaining.ms <= 9900);
      return { frameId: context.frame.id, action: { type: 'swipe', fromX: 10, fromY: 180, toX: 10, toY: 10, ms: 600 }, expected: 'list', reason: 'runtime coordinates' };
    },
    dispatch: async action => { sent = action; },
  });
  assert.equal((await runStage(input(), f.deps)).status, 'completed');
  assert.equal((sent as any).fromY, 180);
});

test('a rejected action consumes its attempt and remains auditable without dispatch', async () => {
  const f = fixture({ agentStep: async context => ({ frameId: context.frame.id, action: { type: 'tap', x: -1, y: 0 }, expected: 'list', reason: 'bad coordinate' }) });
  const result = await runStage(input(), f.deps);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].status, 'rejected');
  assert.equal(f.order.includes('dispatch'), false);
  assert.ok(result.events.some(e => e.type === 'authority_consumed'));
});

const task = (name: string, quota = '0/3') => ({ name, instruction: `原文 ${name}`, quota });
const decision = (name: string, maxAttempts = 2) => ({ ...task(name), decision: 'do' as const, maxAttempts });

test('selects in current visible order despite changed order, totals and reward', () => {
  const current = [{ ...task('C', '1/8'), reward: 999 }, task('A'), task('B')];
  assert.equal(selectCurrentTask(current, ['A', 'B', 'C'].map(n => decision(n)), [])?.name, 'C');
});

test('keeps completion counts by exact identity and enforces remaining plan and current quota', () => {
  const plans = ['A', 'B', 'C'].map(n => decision(n));
  const completed = [{ ...task('C'), count: 2 }];
  assert.equal(selectCurrentTask([task('C', '0/99'), task('A'), task('B')], plans, completed)?.name, 'A');
  for (const quota of ['3/3', '4/3', 'unknown', '0/0']) {
    assert.equal(selectCurrentTask([task('A', quota)], plans, []), null);
  }
  assert.equal(selectCurrentTask([task('A')], [decision('A', 0)], []), null);
});

test('requires unique exact raw identity or explicit definition ID and never guesses', () => {
  assert.equal(selectCurrentTask([{ ...task('A'), instruction: '原文 A ' }], [decision('A')], []), null);
  assert.equal(selectCurrentTask([task('A'), task('A')], [decision('A')], []), null);
  assert.equal(selectCurrentTask([task('A')], [decision('A'), decision('A')], []), null);
  assert.equal(selectCurrentTask([{ quota: '0/3' }], [{ decision: 'do', maxAttempts: 1 }], []), null);
  const identified = { ...task('renamed'), taskDefinitionId: 'definition-A' };
  const plan = { ...decision('A'), taskDefinitionId: 'definition-A' };
  assert.equal(selectCurrentTask([identified], [plan], []), identified);
  assert.equal(selectCurrentTask([identified], [plan], [{ taskDefinitionId: 'definition-A', count: 2 }]), null);
  assert.equal(selectCurrentTask([{ ...task('A'), taskDefinitionId: 'other' }], [plan], []), null);
  assert.equal(selectCurrentTask([task('A')], [decision('A')], [{ ...task('A'), count: -1 }]), null);
});

