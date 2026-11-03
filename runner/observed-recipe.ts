import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isValidTaskReceipt, type TaskAttempt, type TaskCompletionReceipt } from './task-receipt';
import type { TaskObservation } from './loop';
import {readStateFile,stateFileExists,writeStateFile} from './storage/structured.ts';

export type ObservedRecipe = {
  state: 'candidate' | 'validated' | 'stale';
  validations: number;
  taskName: string;
  instruction: string;
  yaml?: string;
  sourceRunId?: number | string;
  yamlHash?: string;
  evidence?: ObservedRecipeEvidence[];
  report?: string;
  updatedAt?: string;
};

export function observedRecipeUsable(recipe: ObservedRecipe, task: { name: string; instruction?: string }): boolean {
  return recipe?.state === 'validated' && recipe.validations >= 2
    && recipe.taskName === task.name && !!task.instruction?.trim()
    && recipe.instruction === task.instruction && /^[a-f0-9]{64}$/.test(recipe.yamlHash ?? '')
    && Array.isArray(recipe.evidence) && recipe.evidence.every(e => successfulEvidence(e, recipe))
    && validationCount(recipe) >= 2;
}

type Task = { name: string; instruction?: string };
export type ObservedRecipeOptions = { root?: string };
export type ObservedRecipeEvidence = {
  taskName: string;
  instruction: string;
  yamlHash: string;
  runId: string | number;
  report: string;
  timestamp: string;
  status: 'completed' | 'failed' | 'unknown' | 'no_effect';
  before: { name: string; done: number; total: number } | null;
  after: { name: string; done: number; total: number } | null;
  /** Preserve explicit disappearance and its same-execution receipt without inventing a counter. */
  attempt?: TaskAttempt;
  taskReceipt?: TaskCompletionReceipt;
  afterObservation?: TaskObservation;
  balanceBefore?: number;
  balanceAfter?: number;
  rejectionReason?: 'yaml_content_changed';
};

export function observedRecipePath(account: string, activity: string, name: string, options: ObservedRecipeOptions = {}): string {
  const key = crypto.createHash('sha256').update(JSON.stringify([account, activity, name])).digest('hex');
  return path.resolve(options.root ?? 'data/observed-recipes', key + '.json');
}

function yamlHash(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function saveAtomic(file: string, recipe: ObservedRecipe): void {
  writeStateFile(file, recipe);
}

/** Persist the exact YAML version; a candidate alone is never trusted for replay. */
export function saveObservedRecipeCandidate(
  account: string, activity: string, task: Task,
  source: { yaml: string; sourceRunId?: number | string; report?: string },
  options: ObservedRecipeOptions = {},
): ObservedRecipe {
  if (!task.name.trim() || !task.instruction?.trim()) throw new Error('Recipe requires a task name and instruction');
  const recipe: ObservedRecipe = {
    state: 'candidate', validations: 0, taskName: task.name, instruction: task.instruction,
    yaml: path.resolve(source.yaml), yamlHash: yamlHash(source.yaml), evidence: [],
    sourceRunId: source.sourceRunId, report: source.report, updatedAt: new Date().toISOString(),
  };
  const file = observedRecipePath(account, activity, task.name, options);
  if (stateFileExists(file)) {
    const previous: ObservedRecipe = readStateFile(file);
    if (previous.taskName === recipe.taskName && previous.instruction === recipe.instruction && previous.yamlHash === recipe.yamlHash) {
      recipe.evidence = previous.evidence ?? [];
      recipe.validations = validationCount(recipe);
      recipe.state = previous.state === 'stale' || !recipe.evidence.every(e => successfulEvidence(e, recipe))
        ? 'stale' : recipe.validations >= 2 ? 'validated' : 'candidate';
    }
  }
  saveAtomic(file, recipe);
  return recipe;
}

function successfulEvidence(e: ObservedRecipeEvidence, recipe: ObservedRecipe): boolean {
  if (!e || typeof e !== 'object') return false;
  const validCounter = (v: ObservedRecipeEvidence['before']) => v && v.name === recipe.taskName
    && Number.isInteger(v.done) && Number.isInteger(v.total) && v.total > 0 && v.done >= 0 && v.done <= v.total;
  const runIdValid = typeof e.runId === 'string' ? !!e.runId.trim()
    : typeof e.runId === 'number' && Number.isSafeInteger(e.runId) && e.runId >= 0;
  const quotaGrowth = !!validCounter(e.before) && !!validCounter(e.after)
    && e.before!.total === e.after!.total && e.after!.done > e.before!.done;
  const absent = e.afterObservation;
  const receiptProgress = !!validCounter(e.before) && e.before!.done < e.before!.total && e.after === null
    && !!absent && typeof absent === 'object' && 'absent' in absent && absent.absent === true && absent.pageIsTaskPanel === true
    && absent.name === recipe.taskName && !!e.attempt
    && e.attempt.name === recipe.taskName && e.attempt.instruction === recipe.instruction
    && isValidTaskReceipt(e.taskReceipt, e.attempt) && e.taskReceipt!.observedAt <= Date.parse(e.timestamp);
  return !e.rejectionReason && e.status === 'completed' && e.taskName === recipe.taskName && e.instruction === recipe.instruction
    && e.yamlHash === recipe.yamlHash && runIdValid && !!e.report?.trim()
    && Number.isFinite(Date.parse(e.timestamp)) && (quotaGrowth || receiptProgress);
}

function validationCount(recipe: ObservedRecipe): number {
  const runs = new Set<string>();
  const attempts = new Set<string>();
  for (const e of recipe.evidence ?? []) {
    if (!successfulEvidence(e, recipe) || runs.has(String(e.runId))) continue;
    // A receipt is evidence from one execution, even if copied under a new run ID.
    const attemptId = e.after === null ? e.attempt?.attemptId : undefined;
    if (attemptId && attempts.has(attemptId)) continue;
    runs.add(String(e.runId));
    if (attemptId) attempts.add(attemptId);
  }
  return runs.size;
}

function contentMatches(recipe: ObservedRecipe): boolean {
  try { return !!recipe.yaml && !!recipe.yamlHash && yamlHash(recipe.yaml) === recipe.yamlHash; }
  catch { return false; }
}

/** Record independently observed evidence; repeating a run never increases confidence. */
export function updateObservedRecipeValidation(
  account: string, activity: string, task: Task, evidence: ObservedRecipeEvidence,
  options: ObservedRecipeOptions = {},
): ObservedRecipe {
  const file = observedRecipePath(account, activity, task.name, options);
  const recipe: ObservedRecipe = readStateFile(file);
  if (recipe.taskName !== task.name || recipe.instruction !== task.instruction) throw new Error('Recipe task or instruction mismatch');
  const recorded = contentMatches(recipe) ? evidence : { ...evidence, rejectionReason: 'yaml_content_changed' as const };
  recipe.evidence = [...(recipe.evidence ?? []), recorded];
  recipe.validations = validationCount(recipe);
  recipe.state = recipe.state === 'stale' || !successfulEvidence(recorded, recipe)
    ? 'stale' : recipe.validations >= 2 ? 'validated' : 'candidate';
  recipe.updatedAt = new Date().toISOString();
  saveAtomic(file, recipe);
  return recipe;
}

export function loadObservedRecipe(account: string, activity: string, task: Task, options: ObservedRecipeOptions = {}): ObservedRecipe | null {
  const file = observedRecipePath(account, activity, task.name, options);
  if (!stateFileExists(file)) return null;
  try {
    const recipe = readStateFile(file);
    return observedRecipeUsable(recipe, task) && contentMatches(recipe) ? recipe : null;
  } catch { return null; }
}
