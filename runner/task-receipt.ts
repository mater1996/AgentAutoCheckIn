import { randomUUID } from 'node:crypto';

export type TaskIdentity = { name: string; instruction: string };
export type TaskAttempt = TaskIdentity & { attemptId: string; startedAt: number };
export type TaskDestinationConfig = { taskName: string; instruction: string; destination: string };
export type TaskReceiptConfig = TaskDestinationConfig & { completionMarker: string | string[] };
export type TaskDestinationObservation = {
  pageIsTaskPanel: false; blocked: false; pageIdentity: string; destinationShown?: boolean;
};
export type TaskEntryReceipt = TaskAttempt & {
  destination: string; observedAt: number; raw: TaskDestinationObservation;
};
export type TaskCompletionReceipt = TaskAttempt & {
  destination: string; completionMarker: string | string[]; observedAt: number;
  entered: TaskEntryReceipt; raw: TaskDestinationObservation & { completionText: string };
};
export type TaskReceiptState = {
  attempt: TaskAttempt;
  entered?: TaskEntryReceipt;
  receipt?: TaskCompletionReceipt;
  observations: { phase: 'entered' | 'completion'; observedAt: number; config: TaskDestinationConfig | TaskReceiptConfig; raw: unknown; error?: string }[];
};

export function createTaskAttempt(target: TaskIdentity): TaskAttempt {
  return { name: target.name, instruction: target.instruction, attemptId: randomUUID(), startedAt: Date.now() };
}

/** Each workflow owns a fresh state; never reuse a prior workflow's receipt. */
export function createTaskReceiptState(attempt: TaskAttempt): TaskReceiptState {
  return { attempt: { ...attempt }, observations: [] };
}

function sameAttempt(a: TaskAttempt, b: TaskAttempt): boolean {
  return !!a && !!b && typeof b.attemptId === 'string' && !!b.attemptId
    && a.attemptId === b.attemptId && a.startedAt === b.startedAt
    && a.name === b.name && a.instruction === b.instruction
    && typeof b.name === 'string' && !!b.name.trim()
    && typeof b.instruction === 'string' && !!b.instruction.trim();
}
function checkDestination(attempt: TaskAttempt, config: TaskDestinationConfig, raw: any, observedAt: number): asserts raw is TaskDestinationObservation {
  if (!sameAttempt(attempt, attempt) || config.taskName !== attempt.name || config.instruction !== attempt.instruction) {
    throw new Error('任务回执身份与本次实际任务不符');
  }
  if (!Number.isSafeInteger(attempt.startedAt) || !Number.isSafeInteger(observedAt) || observedAt < attempt.startedAt) throw new Error('任务回执时间无效');
  if (!config.destination?.trim() || !raw || raw.pageIsTaskPanel !== false || raw.blocked !== false
      || typeof raw.pageIdentity !== 'string' || !raw.pageIdentity.trim()
      || raw.destinationShown === false
      || (raw.pageIdentity !== config.destination && raw.destinationShown !== true)) {
    throw new Error('任务回执缺少明确目的页证据，或仍在面板/被阻挡');
  }
}

export function recordTaskEntered(state: TaskReceiptState, config: TaskDestinationConfig, raw: unknown, observedAt = Date.now()): TaskEntryReceipt {
  // A new entry invalidates any earlier completion in this workflow, even on failure.
  delete state.entered;
  delete state.receipt;
  const observation: TaskReceiptState['observations'][number] = { phase: 'entered', observedAt, config: { ...config }, raw: structuredClone(raw) };
  state.observations.push(observation);
  try {
    checkDestination(state.attempt, config, raw, observedAt);
    return state.entered = { ...state.attempt, destination: config.destination, observedAt, raw: structuredClone(raw) };
  } catch (error: any) { observation.error = String(error.message); throw error; }
}

export function recordTaskReceipt(state: TaskReceiptState, config: TaskReceiptConfig, raw: unknown, observedAt = Date.now()): TaskCompletionReceipt {
  delete state.receipt;
  const observation: TaskReceiptState['observations'][number] = { phase: 'completion', observedAt, config: { ...config }, raw: structuredClone(raw) };
  state.observations.push(observation);
  try {
    checkDestination(state.attempt, config, raw, observedAt);
    if (!state.entered || !sameAttempt(state.entered, state.attempt) || state.entered.destination !== config.destination
        || observedAt < state.entered.observedAt) throw new Error('任务完成回执缺少同次执行的先行进入证据');
    const markers = Array.isArray(config.completionMarker) ? config.completionMarker : [config.completionMarker];
    if (!markers.length || markers.some((marker) => typeof marker !== 'string' || !marker.trim())
        || !markers.includes((raw as any).completionText)) throw new Error('任务完成原文与配置标记不符');
    return state.receipt = { ...state.attempt, destination: config.destination, completionMarker: structuredClone(config.completionMarker),
      observedAt, entered: structuredClone(state.entered), raw: structuredClone(raw) as TaskCompletionReceipt['raw'] };
  } catch (error: any) { observation.error = String(error.message); throw error; }
}

/** Revalidate the returned evidence rather than trusting a node/model's verdict. */
export function isValidTaskReceipt(value: TaskCompletionReceipt | undefined, attempt: TaskAttempt): boolean {
  try {
    if (!value || !sameAttempt(value, attempt) || !sameAttempt(value.entered, attempt)) return false;
    const config = { taskName: attempt.name, instruction: attempt.instruction, destination: value.destination };
    checkDestination(attempt, config, value.raw, value.observedAt);
    checkDestination(attempt, { ...config, destination: value.entered.destination }, value.entered.raw, value.entered.observedAt);
    const markers = Array.isArray(value.completionMarker) ? value.completionMarker : [value.completionMarker];
    return value.entered.destination === value.destination && value.observedAt >= value.entered.observedAt
      && markers.length > 0 && markers.every((marker) => typeof marker === 'string' && !!marker.trim())
      && markers.includes(value.raw.completionText);
  } catch { return false; }
}
