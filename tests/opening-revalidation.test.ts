import assert from 'node:assert/strict';
import { test } from 'node:test';

const failures = await import('../runner/task-failures') as any;

function openingFailure(): any {
  const attempt = { name: '实际任务', instruction: '浏览', attemptId: 'opening-115', startedAt: Date.parse('2026-10-30T16:10:00Z') };
  return { taskName: attempt.name, instruction: attempt.instruction, runId: 115,
    timestamp: new Date(attempt.startedAt).toISOString(), localDay: '2026-10-31',
    evidence: { round: 1, attempt, verification: 'no_effect',
      before: { name: attempt.name, done: 0, total: 5 }, after: { name: attempt.name, done: 0, total: 5 },
      workflow: { ok: false, error: 'arbitrary execution message', taskEvidence: {
        attempt, observations: [{ phase: 'entered', observedAt: attempt.startedAt + 100,
          config: { taskName: attempt.name, instruction: attempt.instruction, destination: '面板' },
          raw: { pageIsTaskPanel: true, blocked: false, destinationShown: false,
            targetName: attempt.name, targetInstruction: attempt.instruction, targetQuota: '0/5' } }],
      } } } };
}

test('only structural unchanged-counter opening failures qualify for explicit reconsideration', () => {
  assert.equal(typeof failures.isOpeningNoEffectFailure, 'function');
  assert.equal(failures.isOpeningNoEffectFailure(openingFailure()), true);
  const withoutOptionalIdentity = openingFailure();
  const raw = withoutOptionalIdentity.evidence.workflow.taskEvidence.observations[0].raw;
  delete raw.targetName; delete raw.targetInstruction; delete raw.targetQuota;
  assert.equal(failures.isOpeningNoEffectFailure(withoutOptionalIdentity), true);
  const mutations: [string, (failure: any) => void][] = [
    ['unknown after', f => { f.evidence.after = null; }],
    ['absent after', f => { f.evidence.after = { name: f.taskName, absent: true, pageIsTaskPanel: true }; }],
    ['invalid before', f => { f.evidence.before.done = '0'; }],
    ['changed after identity', f => { f.evidence.after.name = '其他任务'; }],
    ['changed after counter', f => { f.evidence.after.done = 1; }],
    ['changed after total', f => { f.evidence.after.total = 6; }],
    ['changed attempt identity', f => { f.evidence.attempt = { ...f.evidence.attempt, instruction: '其他要求' }; }],
    ['unknown verification', f => { f.evidence.verification = 'unknown'; }],
    ['successful workflow', f => { f.evidence.workflow.ok = true; }],
    ['entered destination', f => { f.evidence.workflow.taskEvidence.entered = {}; }],
    ['completion receipt', f => { f.evidence.workflow.taskEvidence.receipt = {}; }],
    ['workflow receipt', f => { f.evidence.workflow.taskReceipt = {}; }],
    ['missing observations', f => { f.evidence.workflow.taskEvidence.observations = []; }],
    ['blocked panel', f => { f.evidence.workflow.taskEvidence.observations[0].raw.blocked = true; }],
    ['unknown blocked', f => { delete f.evidence.workflow.taskEvidence.observations[0].raw.blocked; }],
    ['destination shown', f => { f.evidence.workflow.taskEvidence.observations[0].raw.destinationShown = true; }],
    ['unknown destination', f => { delete f.evidence.workflow.taskEvidence.observations[0].raw.destinationShown; }],
    ['outside panel', f => { f.evidence.workflow.taskEvidence.observations[0].raw.pageIsTaskPanel = false; }],
    ['changed raw name', f => { f.evidence.workflow.taskEvidence.observations[0].raw.targetName = '其他任务'; }],
    ['changed raw instruction', f => { f.evidence.workflow.taskEvidence.observations[0].raw.targetInstruction = '其他要求'; }],
    ['changed raw quota', f => { f.evidence.workflow.taskEvidence.observations[0].raw.targetQuota = '1/5'; }],
    ['changed config identity', f => { f.evidence.workflow.taskEvidence.observations[0].config.taskName = '其他任务'; }],
    ['execute failure', f => { f.evidence.workflow.taskEvidence.observations.push({ phase: 'completion', raw: {} }); }],
  ];
  for (const [label, mutate] of mutations) {
    const failure = openingFailure(); mutate(failure);
    assert.equal(failures.isOpeningNoEffectFailure(failure), false, label);
  }
});
