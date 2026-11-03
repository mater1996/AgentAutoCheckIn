import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const failures = await import('../runner/task-failures').catch(() => ({})) as any;
process.env.TZ = 'Asia/Shanghai';
const scratch = '/Users/mater/.hermes/cache/scratch';
const evidence = (overrides: any = {}) => ({
  round: 1,
  attempt: { name: '实际任务', instruction: '浏览', attemptId: 'attempt-95', startedAt: Date.parse('2026-10-30T16:10:00Z') },
  before: { name: '实际任务', done: 0, total: 5 },
  after: { name: '实际任务', done: 0, total: 5 },
  workflow: { ok: false, error: '实际目的页未确认', taskEvidence: { observations: [{ raw: { pageIdentity: '原始页面' } }] } },
  verification: 'no_effect', ...overrides,
});

test('only attempted workflows with valid exact numeric before counters create failures', () => {
  const root = fs.mkdtempSync(path.join(scratch, 'task-failure-validity-'));
  const options = { root, now: new Date('2026-10-30T16:20:00Z') };
  try {
    for (const invalid of [
      { before: null }, { before: { name: '实际任务', absent: true, pageIsTaskPanel: true } },
      { before: { name: '实际任务', done: '0', total: 5 } },
      { before: { name: '实际任务', done: 0, total: 0 } },
      { before: { name: '实际任务', done: -1, total: 5 } },
      { before: { name: '实际任务', done: 6, total: 5 } },
      { before: { name: '其他任务', done: 0, total: 5 } },
      { before: { name: '实际任务', done: 0.5, total: 5 } },
      { workflow: undefined }, { workflow: { error: 'blocked before execution' } },
      { attempt: undefined },
    ]) failures.recordTaskFailures('acct', 'act', 96, [evidence(invalid)], options);
    assert.deepEqual(failures.loadTaskFailures('acct', 'act', options), []);
    assert.deepEqual(fs.readdirSync(root), [], 'blocked or unexecuted tasks do not create state files');
    for (const [workflow, verification] of [[{ ok: false }, 'quota'], [{ ok: true }, 'no_effect'], [{ ok: true }, 'unknown']]) {
      failures.recordTaskFailures('acct', 'act', 96, [evidence({ workflow, verification })], options);
      assert.equal(failures.loadTaskFailures('acct', 'act', options).length, 1);
      fs.rmSync(root, { recursive: true, force: true });
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('local midnight expires failures and only newer verified success clears the exact identity', () => {
  const root = fs.mkdtempSync(path.join(scratch, 'task-failure-day-'));
  const options = { root, now: new Date('2026-10-30T16:20:00Z') };
  try {
    const failed = evidence();
    failures.recordTaskFailures('acct', 'act', 95, [failed], options);
    failures.recordTaskFailures('acct', 'act', 95, [failed], options);
    assert.equal(failures.loadTaskFailures('acct', 'act', options).length, 1, 'same attempt is idempotent');
    assert.deepEqual(failures.loadTaskFailures('acct', 'act', { root, now: new Date('2026-10-31T16:00:00Z') }), []);
    failures.recordTaskFailures('acct', 'act', 95, [failed], { root, now: new Date('2026-10-31T16:00:00Z') });
    assert.deepEqual(failures.loadTaskFailures('acct', 'act', { root, now: new Date('2026-10-31T16:00:00Z') }), [], 'old evidence cannot poison today');
    const success = evidence({ workflow: { ok: true }, verification: 'quota', after: { name: '实际任务', done: 1, total: 5 },
      attempt: { ...failed.attempt, attemptId: 'success', startedAt: failed.attempt.startedAt + 1000 } });
    failures.recordTaskFailures('acct', 'act', 97, [{ ...success, attempt: { ...success.attempt, instruction: '浏览10秒' } }], options);
    assert.equal(failures.loadTaskFailures('acct', 'act', options).length, 1, 'changed instruction does not clear');
    failures.recordTaskFailures('acct', 'act', 94, [{ ...success, attempt: { ...success.attempt, startedAt: failed.attempt.startedAt - 1000 } }], options);
    assert.equal(failures.loadTaskFailures('acct', 'act', options).length, 1, 'older success does not clear');
    failures.recordTaskFailures('acct', 'act', 97, [success], options);
    assert.deepEqual(failures.loadTaskFailures('acct', 'act', options), []);
    failures.recordTaskFailures('acct', 'act', 95, [failed], options);
    failures.recordTaskFailures('acct', 'act', 98, [{ ...success, verification: 'receipt' }], options);
    assert.deepEqual(failures.loadTaskFailures('acct', 'act', options), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('persists exact failed execution provenance in an atomic private hashed day file', () => {
  assert.equal(typeof failures.recordTaskFailures, 'function', 'record API exists');
  assert.equal(typeof failures.loadTaskFailures, 'function', 'load API exists');
  const root = fs.mkdtempSync(path.join(scratch, 'task-failures-'));
  const options = { root, now: new Date('2026-10-30T16:20:00Z') };
  try {
    const original = evidence();
    const file = failures.recordTaskFailures('account/identifier', 'activity/identifier', 95, [original], options);
    assert.match(path.basename(file), /^[a-f0-9]{64}\.json$/);
    assert.equal(path.dirname(file), root);
    const entries = failures.loadTaskFailures('account/identifier', 'activity/identifier', options);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].taskName, original.attempt.name);
    assert.equal(entries[0].instruction, original.attempt.instruction);
    assert.equal(entries[0].runId, 95);
    assert.equal(entries[0].timestamp, '2026-10-30T16:10:00.000Z');
    assert.equal(entries[0].localDay, '2026-10-31');
    assert.deepEqual(entries[0].evidence, original);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readdirSync(root).length, 1, 'no unfinished temporary file');
    assert.deepEqual(failures.loadTaskFailures('different-account', 'activity/identifier', options), []);
    assert.deepEqual(failures.loadTaskFailures('account/identifier', 'different-activity', options), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
