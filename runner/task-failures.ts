import path from 'node:path';
import { createHash } from 'node:crypto';
import type { TaskAttemptEvidence } from './loop';
import { observeTaskChange } from './task-evidence';
import {readStateFile,writeStateFile} from './storage/structured.ts';

export type TaskFailure = {
  taskName: string;
  instruction: string;
  runId: string | number;
  timestamp: string;
  localDay: string;
  evidence: TaskAttemptEvidence;
};
/** Optional clock/storage injection keeps offline callers isolated from real daily state. */
export type TaskFailureOptions = { root?: string; now?: Date };

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function location(account: string, activity: string, options: TaskFailureOptions) {
  const day = localDay(options.now ?? new Date());
  const hash = createHash('sha256').update(JSON.stringify([account, activity, day])).digest('hex');
  return { day, file: path.resolve(options.root ?? 'data/task-failures', `${hash}.json`) };
}

export function loadTaskFailures(account: string, activity: string, options: TaskFailureOptions = {}): TaskFailure[] {
  const { day, file } = location(account, activity, options);
  try {
    const saved = readStateFile(file);
    return Array.isArray(saved.entries) ? saved.entries.filter((entry: TaskFailure) => entry.localDay === day) : [];
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/** Reconsider only a proven failed opening; execution/completion failures remain blocked. */
export function isOpeningNoEffectFailure(failure: TaskFailure): boolean {
  const evidence = failure?.evidence;
  const attempt = evidence?.attempt;
  const workflow = evidence?.workflow;
  if (!attempt || attempt.name !== failure.taskName || attempt.instruction !== failure.instruction
    || !attempt.name?.trim() || !attempt.instruction?.trim()
    || evidence.verification !== 'no_effect' || workflow?.ok !== false) return false;
  const before = evidence.before;
  const after = evidence.after;
  if (!before || !after || 'absent' in before || 'absent' in after
    || before.name !== attempt.name || after.name !== attempt.name
    || observeTaskChange(before, after).status !== 'no_effect') return false;
  const state = workflow.taskEvidence;
  if (!state || state.entered != null || state.receipt != null || workflow.taskReceipt != null
    || state.attempt?.name !== attempt.name || state.attempt?.instruction !== attempt.instruction
    || state.attempt?.attemptId !== attempt.attemptId || state.attempt?.startedAt !== attempt.startedAt
    || !Array.isArray(state.observations) || !state.observations.length) return false;
  const last = state.observations.at(-1)!;
  const raw = last.raw as any;
  return last.phase === 'entered' && last.config?.taskName === attempt.name && last.config?.instruction === attempt.instruction
    && raw?.pageIsTaskPanel === true && raw.blocked === false && raw.destinationShown === false
    && (!('targetName' in raw) || raw.targetName === attempt.name)
    && (!('targetInstruction' in raw) || raw.targetInstruction === attempt.instruction)
    && (!('targetQuota' in raw) || raw.targetQuota === `${before.done}/${before.total}`);
}

/** Store raw execution evidence, without account config, credentials, or recipe changes. */
export function recordTaskFailures(account: string, activity: string, runId: string | number,
  taskEvidence: TaskAttemptEvidence[], options: TaskFailureOptions = {}): string {
  const { day, file } = location(account, activity, options);
  let entries = loadTaskFailures(account, activity, options);
  let changed = false;
  for (const evidence of taskEvidence) {
    const attempt = evidence?.attempt;
    if (!attempt?.name?.trim() || !attempt.instruction?.trim() || !attempt.attemptId?.trim()
      || !Number.isSafeInteger(attempt.startedAt) || localDay(new Date(attempt.startedAt)) !== day
      || typeof evidence.workflow?.ok !== 'boolean') continue;
    const before = evidence.before;
    if (!before || 'absent' in before || before.name !== attempt.name
      || !Number.isInteger(before.done) || !Number.isInteger(before.total)
      || before.total <= 0 || before.done < 0 || before.done > before.total) continue;
    const sameIdentity = (entry: TaskFailure) => entry.taskName === attempt.name && entry.instruction === attempt.instruction;
    if (evidence.workflow.ok === true && (evidence.verification === 'quota' || evidence.verification === 'receipt')) {
      const previousLength = entries.length;
      entries = entries.filter(entry => !sameIdentity(entry) || entry.evidence.attempt.startedAt > attempt.startedAt);
      changed ||= entries.length !== previousLength;
      continue;
    }
    if (!(evidence.workflow.ok === false || evidence.verification === 'no_effect' || evidence.verification === 'unknown')) continue;
    if (entries.some(entry => sameIdentity(entry) && entry.runId === runId && entry.evidence.attempt.attemptId === attempt.attemptId)) continue;
    entries.push({ taskName: attempt.name, instruction: attempt.instruction, runId,
      timestamp: new Date(attempt.startedAt).toISOString(), localDay: day, evidence: structuredClone(evidence) });
    changed = true;
  }
  if (!changed) return file;
  writeStateFile(file, { localDay: day, entries });
  return file;
}
