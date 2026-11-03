import type { StageInput, StageDeps, StageResult, StageContext, ActionRecord, Frame, Proposal } from './contracts.ts';

function proposalError(proposal: Proposal, frame: Frame, input: StageInput, now: number, checkAge = true): string | undefined {
  if (!frame.id || !frame.path || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) return 'invalid frame';
  if (proposal.frameId !== frame.id) return 'frame mismatch';
  if (!Number.isFinite(frame.capturedAt) || frame.capturedAt > now || input.executionPolicy !== 'development-unbounded-v1' && checkAge && now - frame.capturedAt > (input.constraints.frameMaxAgeMs ?? 15000)) return 'frame expired';
  if (frame.userId !== input.scope.userId) return 'frame user mismatch';
  const action = proposal.action;
  if (!action) return undefined;
  if (input.constraints.allowedActions && !input.constraints.allowedActions.includes(action.type)) return 'action forbidden';
  const point = (x: number, y: number) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < frame.width && y < frame.height;
  switch (action.type) {
    case 'tap': return point(action.x, action.y) ? undefined : 'invalid coordinate';
    case 'swipe': {
      const [x1, y1, x2, y2, duration] = 'fromX' in action
        ? [action.fromX, action.fromY, action.toX, action.toY, action.ms]
        : [action.x1, action.y1, action.x2, action.y2, action.durationMs];
      return point(x1, y1) && point(x2, y2) && (duration === undefined || Number.isFinite(duration) && duration > 0)
        ? undefined : 'invalid coordinate or duration';
    }
    case 'wait': return Number.isFinite(action.ms) && action.ms >= 0 ? undefined : 'invalid wait';
    case 'launch': return typeof action.package === 'string' && action.package.trim() ? undefined : 'invalid package';
    case 'back': return undefined;
    default: return 'invalid action';
  }
}

export async function runStage(input: StageInput, deps: StageDeps): Promise<StageResult> {
  const now = deps.now ?? Date.now;
  const unbounded = input.executionPolicy === 'development-unbounded-v1';
  const started = now();
  const wallStarted = performance.now();
  const controller = new AbortController();
  const remainingMs = () => unbounded ? null : Math.max(0, Math.min(input.budget.maxMs - (now() - started), input.budget.maxMs - (performance.now() - wallStarted)));
  const invoke = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (unbounded) return operation();
    const left = remainingMs()!;
    if (left <= 0) throw new Error('stage deadline exceeded');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('stage deadline exceeded')); }, left); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  const result: StageResult = { status: 'stopped', stageId: input.stageId, checkpoint: input.previousCheckpoint, actions: [], events: [] };
  let pending: ActionRecord | undefined;
  let recovering = false;
  let agentCalls = 0;
  const emit = (type: string, details: Record<string, unknown> = {}) => {
    const event = { type, at: now(), ...details };
    result.events.push(event);
    deps.persist?.(event);
  };
  const consumedFrames = new Set<string>();
  // Slow observations remain data. Coordinate actions still require fresh authority.
  const dataOnly = unbounded || input.constraints.observationAgePolicy === 'data-only-v1';
  const actionNeedsAge = (proposal: Proposal) => !dataOnly || !['wait', 'back'].includes(proposal.action?.type ?? '');
  const maxRounds = input.constraints.maxRounds ?? 50;
  try {
  if (!unbounded && (!Number.isFinite(input.budget.maxMs) || input.budget.maxMs < 0
    || !Number.isSafeInteger(input.budget.maxAgentCalls) || input.budget.maxAgentCalls < 0
    || !Number.isSafeInteger(input.budget.maxActions) || input.budget.maxActions < 0
    || !Number.isSafeInteger(maxRounds) || maxRounds < 0
    || !Number.isFinite(input.constraints.frameMaxAgeMs ?? 15000) || (input.constraints.frameMaxAgeMs ?? 15000) < 0)) {
    throw new Error('invalid stage budget or limits');
  }
  for (let round = 0; unbounded || round <= maxRounds; round++) {
    let frame = await invoke(() => deps.observe());
    if (pending && consumedFrames.has(frame.id)) {
      pending.status = 'unknown'; result.status = 'unknown'; result.error = 'fresh frame required: frame reused'; break;
    }
    emit('observed', { frame: structuredClone(frame), stageId: input.stageId });
    const frameError = proposalError({ frameId: frame.id, expected: '', reason: '' }, frame, input, now(), !dataOnly);
    if (frameError) throw new Error(frameError);
    if (pending?.status === 'pending' && pending.proposal.action?.type === 'tap') {
      const ms = Math.min(1000, remainingMs() ?? 1000);
      emit('tap_settling', { frameId: frame.id, ms });
      await invoke(() => deps.dispatch({ type: 'wait', ms }, frame));
      const previousFrameId = frame.id;
      frame = await invoke(() => deps.observe());
      if (frame.id === previousFrameId || consumedFrames.has(frame.id)) throw new Error('fresh frame required: frame reused');
      emit('observed', { frame: structuredClone(frame), stageId: input.stageId });
      const settledFrameError = proposalError({ frameId: frame.id, expected: '', reason: '' }, frame, input, now(), !dataOnly);
      if (settledFrameError) throw new Error(settledFrameError);
    }
    const context: StageContext = { ...input, frame, lastCheckpoint: result.checkpoint, recentActions: structuredClone(result.actions), error: result.error,
      pendingAction: pending, signal: controller.signal, remaining: { ms: remainingMs(), agentCalls: unbounded ? null : input.budget.maxAgentCalls - agentCalls,
        actions: unbounded ? null : input.budget.maxActions - result.actions.length, rounds: unbounded ? null : (input.constraints.maxRounds ?? 50) - round } };
    const checked = await invoke(() => deps.check(context, pending?.proposal));
    if (checked.checkpoint) { result.checkpoint = checked.checkpoint; recovering = false; }
    if (pending?.status === 'unknown') { result.status = 'unknown'; break; }
    if (pending) {
      pending.status = checked.done || (!!checked.checkpoint && checked.checkpoint === pending.proposal.expected) ? 'verified' : 'observed';
      if (pending.status === 'observed') {
        recovering = true;
        result.error = checked.reason ?? 'action result unverified';
        emit('action_unverified', { reason: result.error });
      }
      pending = undefined;
    }
    if (checked.blocked) { result.error = checked.reason ?? 'blocked'; break; }
    if (checked.done) { result.status = 'completed'; break; }
    if (!unbounded && round === maxRounds) { result.error = 'round limit reached'; break; }
    if (!unbounded && (now() - started >= input.budget.maxMs || result.actions.length >= input.budget.maxActions)) { result.error = 'budget exhausted'; break; }
    context.lastCheckpoint = result.checkpoint;
    context.recentActions = structuredClone(result.actions);
    context.remaining.ms = remainingMs();
    let proposal;
    let source: 'script' | 'agent' = 'agent';
    if (input.script?.validated && deps.scriptStep && !recovering) {
      result.usedScriptVersion = input.script.version;
      try {
        proposal = await invoke(() => deps.scriptStep!(context)); source = 'script';
        if (!proposal) { recovering = true; result.error = 'script returned no proposal'; emit('script_error', { error: result.error }); }
      }
      catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        emit('script_error', { error: result.error });
        recovering = true;
      }
    }
    if (!proposal) {
      if (!unbounded && (agentCalls >= input.budget.maxAgentCalls || now() - started >= input.budget.maxMs)) { result.error = 'agent budget exhausted'; break; }
      agentCalls++;
      context.error = result.error;
      context.remaining.agentCalls = unbounded ? null : input.budget.maxAgentCalls - agentCalls;
      context.remaining.ms = remainingMs();
      try { proposal = await invoke(() => deps.agentStep(context)); }
      catch (error) { result.error = error instanceof Error ? error.message : String(error); emit('agent_error', { error: result.error, agentCalls }); break; }
      source = 'agent';
    }
    if (proposal.stop) { result.error = proposal.reason || 'agent stopped'; break; }
    if (!unbounded && now() - started >= input.budget.maxMs) { result.error = 'time budget exhausted'; break; }
    if (proposal.action) {
      if (consumedFrames.has(frame.id)) { result.error = 'frame authority already consumed'; break; }
      consumedFrames.add(frame.id);
      const record: ActionRecord = { proposal: structuredClone(proposal), source, status: 'rejected' };
      result.actions.push(record);
      emit('authority_consumed', { frameId: frame.id, actionAttempt: result.actions.length });
      const invalid = proposalError(proposal, frame, input, now(), !deps.beforeDispatch && actionNeedsAge(proposal));
      if (invalid) {
        result.error = record.error = invalid;
        emit('proposal_rejected', { error: invalid, proposal });
        if (invalid === 'frame expired') continue;
        break;
      }
      if (deps.beforeDispatch) {
        const sourceFrameId = frame.id;
        const sourceProposal = structuredClone(proposal);
        const refreshRemaining = () => {
          context.remaining = { ms: remainingMs(), agentCalls: unbounded ? null : input.budget.maxAgentCalls - agentCalls,
            actions: unbounded ? null : input.budget.maxActions - result.actions.length, rounds: unbounded ? null : maxRounds - round };
        };
        refreshRemaining();
        const revalidated = await invoke(() => deps.beforeDispatch!(context, structuredClone(proposal!)));
        refreshRemaining();
        if (!unbounded && (context.remaining.ms! <= 0 || context.remaining.agentCalls! < 0 || context.remaining.actions! < 0 || context.remaining.rounds! <= 0)) {
          result.error = record.error = 'before dispatch budget exhausted'; break;
        }
        if (!revalidated) { result.error = record.error = 'before dispatch revalidation stopped'; break; }
        const freshError = consumedFrames.has(revalidated.frame.id) ? 'fresh frame required: frame reused'
          : proposalError(revalidated.proposal, revalidated.frame, input, now())
            ?? (revalidated.proposal.stop ? revalidated.proposal.reason || 'before dispatch stopped'
              : !revalidated.proposal.action ? 'before dispatch action required' : undefined);
        if (freshError) {
          result.error = record.error = freshError;
          emit('proposal_rejected', { error: freshError, proposal: structuredClone(revalidated.proposal) });
          break;
        }
        frame = revalidated.frame;
        proposal = revalidated.proposal;
        consumedFrames.add(frame.id);
        record.proposal = structuredClone(proposal);
        emit('before_dispatch_revalidated', { sourceFrameId, newFrameId: frame.id, sourceProposal,
          frame: structuredClone(frame), proposal: structuredClone(proposal) });
      }
      pending = record;
      pending.status = 'pending';
      try {
        try { await invoke(() => deps.dispatch(proposal!.action!, frame)); }
        catch (error) {
          if (!deps.recoverUnsentDispatch || controller.signal.aborted || !unbounded && remainingMs()! <= 0) throw error;
          context.frame = frame;
          context.remaining.ms = remainingMs();
          const sourceFrameId = frame.id, sourceProposal = structuredClone(proposal);
          const replacement = await invoke(() => deps.recoverUnsentDispatch!(context, structuredClone(proposal!), error));
          if (!replacement) throw error;
          const invalid = consumedFrames.has(replacement.frame.id) ? 'fresh frame required: frame reused'
            : proposalError(replacement.proposal, replacement.frame, input, now());
          if (controller.signal.aborted || !unbounded && remainingMs()! <= 0 || invalid || replacement.proposal.stop || !replacement.proposal.action
            || replacement.proposal.action.type !== proposal.action?.type || replacement.proposal.expected !== proposal.expected) throw Error(invalid ?? 'unsent recovery invalid or expired');
          frame = replacement.frame; proposal = replacement.proposal;
          consumedFrames.add(frame.id);
          record.proposal = structuredClone(proposal);
          emit('dispatch_not_sent_revalidated', { sourceFrameId, sourceProposal, frame: structuredClone(frame), proposal: structuredClone(proposal), proof: structuredClone(replacement.proof) });
          // Deliberately outside the catch above: no second recovery, even for another unsent error.
          await invoke(() => deps.dispatch(proposal!.action!, frame));
        }
      }
      catch (error) {
        pending.status = 'unknown';
        pending.error = result.error = error instanceof Error ? error.message : String(error);
        result.status = 'unknown';
        emit('dispatch_unknown', { error: result.error });
        if (unbounded) break;
      }
    } else {
      const invalid = proposalError(proposal, frame, input, now(), !dataOnly);
      if (invalid) { result.error = invalid; break; }
    }
  }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    if (pending) { pending.status = 'unknown'; pending.error = result.error; result.status = 'unknown'; }
    emit('stage_error', { error: result.error });
  }
  if (result.status === 'stopped' && !result.error) result.error = 'round limit reached';
  emit('stage_finished', { status: result.status, checkpoint: result.checkpoint });
  if (deps.review) {
    try {
      result.review = await invoke(() => deps.review!(structuredClone(result)));
      if (result.review !== undefined) {
        result.derivedCandidate = { status: 'candidate', value: result.review };
        emit('review_candidate', { candidate: result.derivedCandidate });
      }
    } catch (error) { emit('review_error', { error: error instanceof Error ? error.message : String(error) }); }
  }
  return result;
}

import type { CurrentTask, PlanDecision, CompletedTask, TaskIdentity } from './contracts.ts';

function sameTask(a: TaskIdentity, b: TaskIdentity): boolean {
  if (a.taskDefinitionId !== undefined || b.taskDefinitionId !== undefined) {
    return typeof a.taskDefinitionId === 'string' && !!a.taskDefinitionId.trim() && a.taskDefinitionId === b.taskDefinitionId;
  }
  return typeof a.name === 'string' && !!a.name.trim() && typeof a.instruction === 'string'
    && !!a.instruction.trim() && a.name === b.name && a.instruction === b.instruction;
}

export function selectCurrentTask<T extends CurrentTask>(currentTasks: readonly T[], planDecisions: readonly PlanDecision[], completed: readonly CompletedTask[]): T | null {
  return currentTasks.find(task => {
    const matches = planDecisions.filter(plan => sameTask(task, plan));
    const counts = completed.filter(item => sameTask(task, item));
    if (currentTasks.filter(item => sameTask(task, item)).length !== 1 || matches.length !== 1
      || counts.some(item => !Number.isSafeInteger(item.count) || item.count < 0)) return false;
    const plan = matches[0];
    const count = counts.reduce((n, item) => n + item.count, 0);
    const quota = /^(\d+)\s*\/\s*(\d+)$/.exec(task.quota);
    return plan.decision === 'do' && Number.isSafeInteger(plan.maxAttempts) && plan.maxAttempts > count
      && !!quota && Number.isSafeInteger(+quota[1]) && Number.isSafeInteger(+quota[2]) && +quota[1] < +quota[2];
  }) ?? null;
}
