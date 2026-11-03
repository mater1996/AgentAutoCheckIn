export interface RoundTask { name: string; instruction: string; done: number; total: number; [key: string]: unknown }
export interface RoundInventory {
  complete: boolean; pages: unknown[]; tasks: RoundTask[]; evidenceKey?: string;
  blocked?: boolean; inputUnknown?: boolean; [key: string]: unknown;
}
export interface RoundPlanItem extends RoundTask {
  decision: 'do' | 'skip' | 'pending'; times: number; reason: string;
  actionType?: string; stopConditions?: string[]; [key: string]: unknown;
}
export interface RoundPlan { items: RoundPlanItem[]; [key: string]: unknown }
export interface RoundExecution {
  status: string; task?: unknown; runId?: number | null;
  entryDispatched: boolean; inputUnknown: boolean; blocked: boolean;
  returned: boolean; persistenceVerified: boolean; gainCoins: number | null;
  [key: string]: unknown;
}
export interface RoundAttempt {
  identity: string; name: string; instruction: string; reservationId: string;
  status: 'reserved' | 'consumed' | 'pending'; evidenceKey: string;
  result?: RoundExecution;
}
export interface RoundRevision { inventory: RoundInventory; plan: RoundPlan }
export interface RoundState {
  id: string; batchId: string; status: 'running' | 'completed' | 'stopped' | 'unknown';
  reason?: string; attempts: RoundAttempt[]; revisions: RoundRevision[];
  finish?: unknown; cleanup?: unknown; errors: string[];
}
export interface RoundSession {
  id: string; batchId?: string; resume?: RoundState; attempts?: RoundAttempt[];
  [key: string]: unknown;
}
export interface RoundDependencies {
  prepare(): Promise<unknown>;
  open?(state: RoundState): Promise<unknown>;
  collect(state: RoundState): Promise<RoundInventory>;
  plan(inventory: RoundInventory, state: RoundState): Promise<RoundPlan>;
  next?(state: RoundState): Promise<any>;
  execute(item: RoundPlanItem, state: RoundState): Promise<RoundExecution>;
  finish(state: RoundState): Promise<unknown>;
  cleanup(state: RoundState): Promise<unknown>;
  /** Must atomically flush the complete snapshot before resolving; reject on failure. */
  persist(state: RoundState): Promise<unknown> | unknown;
}

/** Exact business identity intentionally excludes quota, frames and coordinates. */
export function taskIdentity(task: Pick<RoundTask, 'name' | 'instruction'>): string {
  return JSON.stringify([task.name, task.instruction]);
}
function evidenceKey(inventory: RoundInventory, task: RoundTask): string {
  return JSON.stringify({revision: task.evidenceKey ?? inventory.evidenceKey ?? null,
    name: task.name, instruction: task.instruction, done: task.done, total: task.total,
    button: task.button, reward: task.reward, context: task.context,
  });
}
function validateInventory(inventory: RoundInventory): void {
  if (!Array.isArray(inventory.tasks) || new Set(inventory.tasks.map(taskIdentity)).size !== inventory.tasks.length
    || inventory.tasks.some(task => typeof task.name !== 'string' || !task.name.trim() || typeof task.instruction !== 'string'
      || !Number.isSafeInteger(task.done) || !Number.isSafeInteger(task.total) || task.done < 0 || task.total < 1 || task.done > task.total)) {
    throw Error('Invalid inventory identities or quotas');
  }
}
function validateExecution(result: RoundExecution): void {
  if (!result || typeof result.status !== 'string' || !result.status
    || ['entryDispatched', 'inputUnknown', 'blocked', 'returned', 'persistenceVerified'].some(key => typeof result[key] !== 'boolean')
    || result.gainCoins !== null && (typeof result.gainCoins !== 'number' || !Number.isFinite(result.gainCoins))) {
    throw Error('Invalid archived execution result; dispatch outcome unknown');
  }
}

/** Pure control flow: no device, DB, model, clock, filesystem or implicit batch creation. */
export async function runActivityRound(session: RoundSession, deps: RoundDependencies): Promise<RoundState> {
  const state: RoundState = session.resume ? structuredClone(session.resume) : {
    id: session.id, batchId: session.batchId ?? session.id, status: 'running',
    attempts: structuredClone(session.attempts ?? []), revisions: [], errors: [],
  };
  let safeToFinish = false;
  const save = () => deps.persist(structuredClone(state));
  const stop = (reason: string, unknown = false) => {
    state.status = unknown ? 'unknown' : 'stopped'; state.reason = reason;
  };
  try {
    if (!session.id || state.id !== session.id || state.batchId !== (session.batchId ?? session.id)) throw Error('Round session/batch mismatch');
    if (state.attempts.some(a => a.status === 'reserved')) {
      stop('unresolved-reservation', true);
    } else if (session.resume && state.status !== 'running') {
      // Terminal decisions are durable; do not implicitly reopen a finished round.
    } else if (state.attempts.some(a => a.result?.inputUnknown || a.result?.blocked || a.result && (!a.result.returned || !a.result.persistenceVerified))) {
      stop('unsafe-prior-attempt', true);
    } else {
      state.status = 'running'; delete state.reason;
      await save();
      await deps.prepare();
      await deps.open?.(structuredClone(state));
      safeToFinish = true;
      while (state.status === 'running') {
        let item:RoundPlanItem|undefined,inventory:RoundInventory;
        if(deps.next){
          const decision=await deps.next(structuredClone(state));
          if(decision.decision==='stop'){safeToFinish=false;stop(decision.error??'next-decision-stopped',!!decision.inputUnknown);break;}
          if(decision.decision==='finish'){
            if(decision.coverage?.top!==true||decision.coverage?.bottom!==true)throw Error('Search coverage required before finish');
            state.status='completed';state.reason='no-eligible-candidates';break;
          }
          if(decision.decision!=='task'||!decision.item)throw Error('Invalid next task decision');
          item=decision.item;
          inventory={complete:false,pages:[],tasks:[item!],...(decision.coverage?{coverage:decision.coverage}:{})};
          validateInventory(inventory);
          if(item!.decision!=='do'||item!.times<=0||item!.done>=item!.total||state.attempts.some(a=>a.identity===taskIdentity(item!)&&(a.status!=='pending'||a.evidenceKey===evidenceKey(inventory,item!))))throw Error('Next task is not eligible in retained batch');
          state.revisions.push({inventory,plan:{items:[structuredClone(item!)],selection:decision.selection}});await save();
        }else{
        inventory = await deps.collect(structuredClone(state));
        if (inventory.inputUnknown || inventory.blocked) {
          safeToFinish = false; stop(inventory.inputUnknown ? 'input-unknown' : 'blocked', !!inventory.inputUnknown); break;
        }
        if (inventory.complete !== true || !Array.isArray(inventory.pages) || !inventory.pages.length) { stop('incomplete-inventory'); break; }
        validateInventory(inventory);
        const plan = await deps.plan(structuredClone(inventory), structuredClone(state));
        state.revisions.push({inventory: structuredClone(inventory), plan: structuredClone(plan)});
        await save();
        item = inventory.tasks.map(task => {
          const planned = plan.items.find(i => taskIdentity(i) === taskIdentity(task));
          return planned ? {...planned, ...task} as RoundPlanItem : undefined;
        }).find(i => i?.decision === 'do' && i.times > 0 && i.done < i.total && !state.attempts.some(a =>
            a.identity === taskIdentity(i) && (a.status !== 'pending' || a.evidenceKey === evidenceKey(inventory, i))));
        if (!item) { state.status = 'completed'; state.reason = 'no-eligible-candidates'; break; }
        }
        if(!item)throw Error('Missing selected task');
        const attempt: RoundAttempt = {
          identity: taskIdentity(item), name: item.name, instruction: item.instruction,
          reservationId: JSON.stringify([state.batchId, state.id, state.attempts.length + 1]),
          status: 'reserved', evidenceKey: evidenceKey(inventory, item),
        };
        state.attempts.push(attempt);
        await save();
        safeToFinish = false;
        const result = await deps.execute(structuredClone(item), structuredClone(state));
        validateExecution(result);
        attempt.result = structuredClone(result);
        attempt.status = result.entryDispatched || result.inputUnknown ? 'consumed' : 'pending';
        if (result.inputUnknown) stop('input-unknown', true);
        else if (result.blocked) stop('blocked');
        else if (!result.returned) stop('return-unverified');
        else if (!result.persistenceVerified) stop('persistence-unverified', true);
        else safeToFinish = true;
        await save();
      }
    }
  } catch (error) {
    stop('round-error', true); safeToFinish = false;
    state.errors.push(String(error instanceof Error ? error.message : error));
  } finally {
    if (safeToFinish) {
      try { state.finish = await deps.finish(structuredClone(state)); }
      catch (error) { stop('finish-failed', true); state.errors.push(String(error)); }
    }
    try { state.cleanup = await deps.cleanup(structuredClone(state)); }
    catch (error) { stop('cleanup-failed', true); state.errors.push(String(error)); }
    try { await save(); }
    catch (error) { stop('persistence-failed', true); state.errors.push(String(error)); }
  }
  return state;
}
