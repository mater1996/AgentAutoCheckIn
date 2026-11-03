import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import test from 'node:test';
import * as recipes from '../runner/observed-recipe';
import { createTaskReceiptState, recordTaskEntered, recordTaskReceipt } from '../runner/task-receipt';

const api = recipes as any;
const task = { name: 'fixture task', instruction: 'fixture instruction' };
function evidence(hash: string, runId: string | number = 'fixture run 1') {
  return {
    taskName: task.name, instruction: task.instruction, yamlHash: hash,
    runId, report: `fixture-report-${runId}.html`, timestamp: '2026-01-01T00:00:00.000Z',
    status: 'completed' as const,
    before: { name: task.name, done: 1, total: 5 },
    after: { name: task.name, done: 2, total: 5 },
    balanceBefore: 100, balanceAfter: 120,
  };
}

test('two distinct successful runs verify the same exact recipe with persisted provenance', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  assert.equal(typeof api.updateObservedRecipeValidation, 'function');
  const first = evidence(candidate.yamlHash);
  const one = api.updateObservedRecipeValidation('a', 'b', task, first, options);
  assert.equal(one.state, 'candidate');
  assert.equal(one.validations, 1);
  assert.deepEqual(one.evidence, [first]);
  const duplicate = api.updateObservedRecipeValidation('a', 'b', task, first, options);
  assert.equal(duplicate.validations, 1);
  const second = evidence(candidate.yamlHash, 'fixture run 2');
  const verified = api.updateObservedRecipeValidation('a', 'b', task, second, options);
  assert.equal(verified.state, 'validated');
  assert.equal(verified.validations, 2);
  assert.deepEqual(verified.evidence.at(-1), second);
  assert.deepEqual(api.loadObservedRecipe('a', 'b', task, options), verified);
  assert.equal(api.loadObservedRecipe('a', 'b', { ...task, instruction: 'different instruction' }, options), null);
});

function receiptEvidence(hash: string, runId: string | number = 'receipt run 1') {
  const timestamp = '2026-01-01T00:00:00.000Z';
  const attempt = { ...task, attemptId: `attempt-${runId}`, startedAt: Date.parse(timestamp) - 3000 };
  const state = createTaskReceiptState(attempt);
  const config = { taskName: task.name, instruction: task.instruction, destination: 'fixture destination' };
  const raw = { pageIsTaskPanel: false as const, blocked: false as const, pageIdentity: config.destination };
  recordTaskEntered(state, config, raw, attempt.startedAt + 1000);
  const taskReceipt = recordTaskReceipt(state, { ...config, completionMarker: 'finished' },
    { ...raw, completionText: 'finished' }, attempt.startedAt + 2000);
  return {
    ...evidence(hash, runId), timestamp, before: { name: task.name, done: 4, total: 5 }, after: null,
    attempt, taskReceipt, afterObservation: { name: task.name, absent: true as const, pageIsTaskPanel: true as const },
  };
}

test('fresh completion receipts persist explicit disappearance without inventing a full counter', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const first: recipes.ObservedRecipeEvidence = receiptEvidence(candidate.yamlHash);
  const one = api.updateObservedRecipeValidation('a', 'b', task, first, options);
  assert.equal(one.validations, 1);
  assert.equal(one.state, 'candidate');
  assert.deepEqual(one.evidence, [first]);
  const duplicate = api.updateObservedRecipeValidation('a', 'b', task, first, options);
  assert.equal(duplicate.validations, 1);
  const second = receiptEvidence(candidate.yamlHash, 'receipt run 2');
  const verified = api.updateObservedRecipeValidation('a', 'b', task, second, options);
  assert.equal(verified.validations, 2);
  assert.equal(verified.state, 'validated');
  assert.equal(verified.evidence.at(-1).after, null);
  assert.deepEqual(api.loadObservedRecipe('a', 'b', task, options), verified);
});

test('one attempt receipt cannot validate twice under different run IDs', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const first = receiptEvidence(candidate.yamlHash, 'r1');
  api.updateObservedRecipeValidation('a', 'b', task, first, options);
  const duplicate = api.updateObservedRecipeValidation('a', 'b', task, { ...first, runId: 'r2' }, options);
  assert.equal(duplicate.validations, 1);
  assert.equal(duplicate.state, 'candidate');
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
});

test('receipt evidence fails closed for ambiguous absence, conflicting quotas, identity or timing', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('seed', 'b', task, { yaml }, options);
  const good = receiptEvidence(candidate.yamlHash);
  const invalid = [
    { ...good, afterObservation: undefined }, { ...good, afterObservation: null },
    { ...good, afterObservation: 'absent' },
    { ...good, afterObservation: { ...good.afterObservation, absent: false } },
    { ...good, afterObservation: { ...good.afterObservation, name: 'other task' } },
    { ...good, afterObservation: { ...good.afterObservation, pageIsTaskPanel: false } },
    { ...good, afterObservation: { name: task.name, done: 4, total: 5 } },
    { ...good, after: { name: task.name, done: 4, total: 5 } },
    { ...good, after: { name: task.name, done: 3, total: 5 } },
    { ...good, after: { name: task.name, done: 5, total: 6 } },
    { ...good, before: null },
    { ...good, before: { ...good.before, done: 5 } },
    { ...good, before: { ...good.before, name: 'other task' } },
    { ...good, before: { ...good.before, done: 3.5 } },
    { ...good, attempt: undefined }, { ...good, taskReceipt: undefined },
    { ...good, attempt: { ...good.attempt, attemptId: 'different attempt' } },
    { ...good, attempt: { ...good.attempt, startedAt: good.attempt.startedAt - 1 } },
    { ...good, attempt: { ...good.attempt, name: 'other task' } },
    { ...good, attempt: { ...good.attempt, instruction: 'other instruction' } },
    { ...good, taskReceipt: { ...good.taskReceipt, observedAt: good.attempt.startedAt - 1 } },
    { ...good, taskReceipt: { ...good.taskReceipt, observedAt: Date.parse(good.timestamp) + 1 } },
    { ...good, taskReceipt: { ...good.taskReceipt, entered: { ...good.taskReceipt.entered, attemptId: 'old attempt' } } },
    { ...good, taskReceipt: { ...good.taskReceipt, raw: { ...good.taskReceipt.raw, completionText: 'unconfirmed' } } },
    { ...good, timestamp: 'invalid' },
    { ...good, status: 'failed' }, { ...good, status: 'unknown' }, { ...good, status: 'no_effect' },
    { ...good, yamlHash: '0'.repeat(64) }, { ...good, instruction: 'other instruction' },
    { ...good, runId: '' }, { ...good, report: '' },
  ];
  for (const [i, bad] of invalid.entries()) {
    const account = `receipt-invalid-${i}`;
    api.saveObservedRecipeCandidate(account, 'b', task, { yaml }, options);
    const updated = api.updateObservedRecipeValidation(account, 'b', task, bad, options);
    assert.equal(updated.validations, 0, `case ${i}`);
    assert.equal(updated.state, 'stale', `case ${i}`);
    assert.equal(api.loadObservedRecipe(account, 'b', task, options), null, `case ${i}`);
  }
});

test('receipt success preserves stale state and exact YAML content checks', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('stale', 'b', task, { yaml }, options);
  const good = receiptEvidence(candidate.yamlHash);
  api.updateObservedRecipeValidation('stale', 'b', task, { ...good, status: 'failed' }, options);
  for (const runId of ['r1', 'r2']) {
    const updated = api.updateObservedRecipeValidation('stale', 'b', task, receiptEvidence(candidate.yamlHash, runId), options);
    assert.equal(updated.state, 'stale');
  }
  assert.equal(api.loadObservedRecipe('stale', 'b', task, options), null);
  const same = api.saveObservedRecipeCandidate('stale', 'b', task, { yaml }, options);
  assert.equal(same.state, 'stale');
  api.saveObservedRecipeCandidate('edited', 'b', task, { yaml }, options);
  fs.writeFileSync(yaml, 'tasks: [edited]\n');
  const changed = api.updateObservedRecipeValidation('edited', 'b', task, good, options);
  assert.equal(changed.validations, 0);
  assert.equal(changed.state, 'stale');
  assert.equal(changed.evidence[0].rejectionReason, 'yaml_content_changed');
});

test('failed, unknown, invalid, or mismatched observations never count and mark the recipe stale', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const good = evidence(candidate.yamlHash);
  const invalid = [
    { ...good, status: 'failed' }, { ...good, status: 'unknown' }, { ...good, status: 'no_effect' },
    { ...good, taskName: 'other task' }, { ...good, instruction: 'other instruction' },
    { ...good, yamlHash: '0'.repeat(64) },
    { ...good, after: { ...good.after, done: 1 } },
    { ...good, after: { ...good.after, done: 0 } },
    { ...good, after: { ...good.after, total: 6 } },
    { ...good, before: { ...good.before, name: 'other task' }, after: { ...good.after, name: 'other task' } },
    { ...good, after: { ...good.after, done: 6 } },
    { ...good, before: { ...good.before, done: 0.5 } },
    { ...good, before: null }, { ...good, after: null },
    { ...good, runId: '' }, { ...good, runId: undefined },
    { ...good, report: '' }, { ...good, timestamp: 'invalid' },
  ];
  for (const [i, bad] of invalid.entries()) {
    const account = `fixture-invalid-${i}`;
    api.saveObservedRecipeCandidate(account, 'b', task, { yaml }, options);
    const updated = api.updateObservedRecipeValidation(account, 'b', task, bad, options);
    assert.equal(updated.validations, 0, `case ${i}`);
    assert.equal(updated.state, 'stale', `case ${i}`);
    assert.deepEqual(updated.evidence, [bad], `case ${i}`);
  }
});

test('a failure revokes a verified recipe and success cannot silently clear stale state', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  for (const runId of ['r1', 'r2']) api.updateObservedRecipeValidation('a', 'b', task, evidence(candidate.yamlHash, runId), options);
  const failed = api.updateObservedRecipeValidation('a', 'b', task, { ...evidence(candidate.yamlHash, 'r3'), status: 'failed' }, options);
  assert.equal(failed.state, 'stale');
  assert.equal(failed.validations, 2);
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
  const later = api.updateObservedRecipeValidation('a', 'b', task, evidence(candidate.yamlHash, 'r4'), options);
  assert.equal(later.state, 'stale');
});

test('edited YAML cannot be loaded or validate using an old hash', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  for (const runId of ['r1', 'r2']) api.updateObservedRecipeValidation('a', 'b', task, evidence(candidate.yamlHash, runId), options);
  assert.ok(api.loadObservedRecipe('a', 'b', task, options));
  fs.writeFileSync(yaml, 'tasks: [edited]\n');
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
  const changed = api.updateObservedRecipeValidation('a', 'b', task, evidence(candidate.yamlHash, 'r3'), options);
  assert.equal(changed.state, 'stale');
  assert.equal(changed.validations, 2);
});

test('declared validation counts cannot replace distinct successful provenance', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const forged = { ...candidate, state: 'validated', validations: 100, evidence: [evidence(candidate.yamlHash), evidence(candidate.yamlHash)] };
  const file = api.observedRecipePath('a', 'b', task.name, options);
  fs.writeFileSync(file, JSON.stringify(forged));
  assert.equal(api.observedRecipeUsable(forged, task), false);
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
});

test('resaving the same candidate preserves observations and a changed version starts fresh', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  api.updateObservedRecipeValidation('a', 'b', task, evidence(candidate.yamlHash), options);
  const same = api.saveObservedRecipeCandidate('a', 'b', task, { yaml, sourceRunId: 'next run' }, options);
  assert.equal(same.validations, 1);
  assert.equal(same.evidence.length, 1);
  fs.writeFileSync(yaml, 'tasks: [new version]\n');
  const changed = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  assert.equal(changed.state, 'candidate');
  assert.equal(changed.validations, 0);
  assert.deepEqual(changed.evidence, []);
  assert.notEqual(changed.yamlHash, candidate.yamlHash);
  api.updateObservedRecipeValidation('a', 'b', task, evidence(changed.yamlHash), options);
  const newTask = { ...task, instruction: 'new exact instruction' };
  const requirementChanged = api.saveObservedRecipeCandidate('a', 'b', newTask, { yaml }, options);
  assert.equal(requirementChanged.validations, 0);
});

test('missing provenance and malformed persisted evidence fail closed', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const file = api.observedRecipePath('a', 'b', task.name, options);
  const legacy = { state: 'validated', validations: 2, taskName: task.name, instruction: task.instruction, yaml };
  assert.equal(api.observedRecipeUsable(legacy, task), false);
  const malformed = { ...candidate, state: 'validated', validations: 2, evidence: [null, null] };
  assert.equal(api.observedRecipeUsable(malformed, task), false);
  fs.writeFileSync(file, JSON.stringify(malformed));
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
  fs.writeFileSync(file, '{invalid');
  assert.equal(api.loadObservedRecipe('a', 'b', task, options), null);
});

test('validation update cannot target a different instruction or a missing candidate', (t) => {
  const { yaml, options } = fixture(t);
  const candidate = api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  assert.throws(() => api.updateObservedRecipeValidation('a', 'b', { ...task, instruction: 'other' }, evidence(candidate.yamlHash), options), /mismatch/);
  assert.throws(() => api.updateObservedRecipeValidation('missing', 'b', task, evidence(candidate.yamlHash), options), /ENOENT/);
});

test('a failed atomic replacement cleans temporary files without destroying its target', (t) => {
  const { yaml, options } = fixture(t);
  api.saveObservedRecipeCandidate('a', 'b', task, { yaml }, options);
  const file = api.observedRecipePath('a', 'b', task.name, options);
  const original = fs.readFileSync(file, 'utf8');
  // Only inject the OS failure; all reads, temporary writes, and cleanup are real.
  t.mock.method(fs, 'renameSync', () => { throw new Error('fixture rename failure'); });
  assert.throws(() => api.updateObservedRecipeValidation('a', 'b', task,
    evidence(JSON.parse(original).yamlHash), options), /fixture rename failure/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(options.root), [path.basename(file)]);
});

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.homedir(), '.hermes/cache/scratch/observed-recipe-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const yaml = path.join(root, 'recipe.yaml');
  fs.writeFileSync(yaml, 'tasks: []\n');
  return { root, yaml, options: { root: path.join(root, 'store') } };
}

test('candidate persists its content hash and source without becoming usable', (t) => {
  const { yaml, options } = fixture(t);
  assert.equal(typeof api.saveObservedRecipeCandidate, 'function');
  const saved = api.saveObservedRecipeCandidate('fixture account', 'fixture activity', task,
    { yaml, sourceRunId: 'fixture run', report: 'fixture report' }, options);
  assert.equal(saved.state, 'candidate');
  assert.equal(saved.validations, 0);
  assert.match(saved.yamlHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(saved.evidence, []);
  assert.equal(saved.sourceRunId, 'fixture run');
  const file = api.observedRecipePath('fixture account', 'fixture activity', task.name, options);
  assert.equal(path.dirname(file), options.root);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved);
  assert.equal(api.loadObservedRecipe('fixture account', 'fixture activity', task, options), null);
  assert.deepEqual(fs.readdirSync(options.root), [path.basename(file)]);
});
