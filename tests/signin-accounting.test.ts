import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeInventory } from '../runner/inventory';
import { computePlan, computeEvidencePlan, buildAssessmentPrompt } from '../runner/planner';
import { observedRecipeUsable } from '../runner/observed-recipe';
import { loadTaskFailures, recordTaskFailures } from '../runner/task-failures';

const originalCwd = process.cwd();
let testDirectory: string;
beforeEach(() => {
  testDirectory = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-accounting-');
  process.chdir(testDirectory);
});
afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

// Run the real signin orchestration with every device/model/DB boundary replaced.
let execute: (ctx: any) => Promise<void> = async () => {};
let afterRead: number | null = null;
let metrics: any = null;
let finished: any;
let gains: any[] = [];
let costs: any[] = [];
let snapshots: any[] = [];
let onDestroy = async () => {};
let liveInventory: any = null;
let loopOptions: any = null;
let selectedRecipe: any = null;
let recipeUpdates: any[] = [];
let loopStopReason = '达到硬上限';
let taskEvidenceFixture: any[] = [];
let workflowCall: any[] = [];
let recipeAvailable = true;
let assessments: any[] | null = null;
let assessmentPrompts: string[] = [];
let events: string[] = [];
let recipeFixture: any = null;
let recipeLookups: any[] = [];
const activity = { id: 'offline-act', accountId: 'offline-acct', assetId: 'coins', stepsJson: '[{"do":"read","as":"after"}]', verifyAny: '', planJson: null as string | null };
const account = { id: 'offline-acct', package: 'offline', app: 'offline', cacheId: 'offline' };
const tables = { activity: {}, account: {}, objective: {}, tier: {}, asset: {} };
function stub(relative: string, exports: Record<string, any>) {
  mock.module(new URL(relative, import.meta.url).href, { exports });
}
stub('../runner/model.ts', { setRunContext: () => {} });
stub('../db/client.ts', {
  schema: tables,
  db: { select: () => ({ from: (table: any) => ({ where: () => ({ get: () => table === tables.activity ? activity : table === tables.account ? account : undefined, all: () => [] }) }) }) },
  sqlite: { prepare: () => ({ get: () => ({ balance: 100 }), run: () => {} }) },
});
mock.module('drizzle-orm', { exports: { eq: () => null } });
stub('../runner/adb.ts', {
  DEVICE: 'offline-no-device', getStayOn: () => 0, setStayOn: () => {},
  shell: () => { throw new Error('device forbidden'); }, sleep: async () => {}, hasAnyText: () => false,
});
stub('../runner/config.ts', { prepFor: () => ({}), loadTaskRules: () => ({ rules: [{ pattern: '拍立淘', kind: 'camera', skip: true }], tier_policy: 'prefer_safe' }) });
stub('../runner/flow.ts', { execSteps: async (ctx: any) => execute(ctx) });
stub('../runner/probe.ts', { readBalance: async () => afterRead, runProbes: () => { throw new Error('unexpected probes'); } });
stub('../runner/loop.ts', { runTaskLoop: async (_ctx: any, opts: any) => {
  events.push('execute');
  loopOptions = opts;
  return { rounds: 1, finalState: { done: 20, total: 20 }, stopReason: loopStopReason, collects: 0,
    taskEvidence: taskEvidenceFixture,
    ran: opts.tasks.map((task: any) => ({ name: task.name, times: 1, ok: 0, fail: 1 })) };
} });
let inventoryScanCalls = 0;
let inventoryScanResult: any = null;
let inventoryScanSequence: any[] = [];
stub('../runner/inventory-scan.ts', { collectInventory: async () => { events.push('scan'); inventoryScanCalls++; return inventoryScanSequence.length ? inventoryScanSequence.shift() : inventoryScanResult; } });
stub('../runner/inventory.ts', { INVENTORY_PROMPT: '', normalizeInventory, saveInventory: () => {} });
stub('../runner/playbook.ts', { loadPlaybook: () => null, savePlaybook: () => { throw new Error('stale coordinates forbidden'); } });
stub('../runner/planner.ts', { computePlan, computeEvidencePlan, buildAssessmentPrompt });
stub('../runner/workflow-gen.ts', { ensureTaskYaml: () => null });
stub('../runner/workflow.ts', { runWorkflowFile: (...args: any[]) => { workflowCall = args; return { ok: true }; } });
stub('../runner/nodes/ensure-no-popup.ts', { recoverPopup: () => { throw new Error('model forbidden'); } });
stub('../runner/ledger.ts', {
  startRun: () => 42, recordRun: () => 42, finishRun: (_id: number, value: any) => { finished = value; },
  recordGain: (value: any) => gains.push(value), recordCost: (value: any) => costs.push(value),
  recordSnapshot: (value: any) => snapshots.push(value), bumpCache: () => {},
});
stub('../runner/context.ts', { injectAIContext: () => 0 });
stub('../runner/preflight.ts', { preflight: async () => ({ ok: true, checks: [] }) });
stub('../runner/prep.ts', { prep: async () => ({ ok: true, coldStart: false, ms: 0 }) });
stub('../runner/usage.ts', {
  usageFromMetrics: (value: any) => value, usageFromDb: () => null,
  mergeUsage: (a: any, b: any) => b ?? a,
});
stub('../runner/observed-recipe.ts', {
  observedRecipeUsable,
  loadObservedRecipe: (_account: string, _activity: string, task: any) => { recipeLookups.push(task); selectedRecipe = task; return recipeFixture ? (task.name === recipeFixture.taskName && task.instruction === recipeFixture.instruction ? recipeFixture : null) : recipeAvailable ? { yaml: 'observed.yaml', yamlHash: 'a'.repeat(64) } : null; },
  updateObservedRecipeValidation: (...args: any[]) => { recipeUpdates.push(args); },
});
stub('../runner/task-learning.ts', { buildUnknownTaskPrompt: () => '' });
let panelReadyFixture = true;
stub('../runner/panel-state.ts', { ensureTaskPanel: async () => panelReadyFixture });
let deviceLockCalls = 0;
stub('../runner/device-lock.ts', { withDeviceLock: async (fn: () => any) => { deviceLockCalls++; return fn(); } });
mock.module('@midscene/android', { exports: { agentFromAdbDevice: async () => ({ get metrics() { return metrics; }, aiQuery: async (prompt: string) => {
  if (prompt.includes('assessments')) { events.push('assess'); assessmentPrompts.push(prompt); return { assessments }; }
  return liveInventory;
}, aiBoolean: async () => true, destroy: async () => onDestroy() }) } });
const { runActivity } = await import('../runner/signin');
const { collectAndPlan, assessAndPlanInventory } = await import('../runner/collect');

async function run(fn: (ctx: any) => Promise<void>, read: number | null = null) {
  execute = fn;
  afterRead = read;
  finished = undefined;
  gains = []; costs = []; snapshots = [];
  return runActivity({ activityId: activity.id });
}

test('saved DB balance is never a live before value or a gain baseline', async () => {
  const result = await run(async (ctx) => { ctx.balanceAfter = 125; });
  assert.equal(result.balanceBefore, null);
  assert.equal(result.delta, null);
  assert.equal(result.status, 'OBSERVATION_FAILED');
  assert.equal(finished.balanceBefore, null);
  assert.deepEqual(gains, []);
  assert.equal(snapshots[0].balance, 125);
});

test('a thrown task error with observed growth is partial and remains visible', async () => {
  const result = await run(async (ctx) => {
    ctx.balanceBefore = 100;
    throw new Error('task fixture failed');
  }, 125);
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.ok, false);
  assert.equal(result.delta, 25);
  assert.match(result.stepsFailed.join(' '), /task fixture failed/);
  assert.match(finished.error, /task fixture failed/);
  assert.equal(gains[0].units, 25);
});

test('a thrown genuine execution error without a final reading remains ERROR', async () => {
  const result = await run(async (ctx) => {
    ctx.balanceBefore = 100;
    throw new Error('execution failed before settlement');
  });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.delta, null);
  assert.deepEqual(gains, []);
});

test('an unchanged report from a previous run is never attached', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'signin-report-'));
  try {
    process.chdir(dir);
    fs.mkdirSync('midscene_run/report', { recursive: true });
    fs.writeFileSync('midscene_run/report/old.html', 'previous run');
    const result = await run(async (ctx) => { ctx.balanceBefore = 100; ctx.balanceAfter = 100; });
    assert.equal(result.report, null);
    assert.equal(finished.evidenceDir, null);
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('usage intent costs reach the ledger', async () => {
  metrics = { calls: 2, totalTokens: 30, byIntent: { locate: { calls: 2, totalPromptTokens: 20, totalCompletionTokens: 10, totalTokens: 30 } } };
  try {
    await run(async (ctx) => { ctx.balanceBefore = 100; ctx.balanceAfter = 100; });
    assert.equal(costs.length, 1);
    assert.deepEqual({ ...costs[0], ms: 0 }, {
      runId: 42, kind: 'locate', calls: 2, promptTokens: 20, completionTokens: 10, totalTokens: 30, ms: 0,
    });
  } finally { metrics = null; }
});

test('collect-only refuses incomplete scans before producing a plan', async () => {
  assessmentPrompts = [];
  activity.planJson = JSON.stringify({ entry: [{ do: 'ai' }] });
  execute = async () => {};
  inventoryScanCalls = 0;
  inventoryScanResult = { ok: false, inventory: null, detail: '任务清单不完整：MAX_PAGES' };
  liveInventory = { progress: '5/20', tasks: [{ name: '单页', quota: '0/2' }] };
  try {
    const result = await collectAndPlan({ activityId: activity.id });
    assert.equal(inventoryScanCalls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.plan, null);
    assert.equal(result.status, 'COLLECT_INCOMPLETE');
    assert.equal(finished.status, 'COLLECT_INCOMPLETE');
    assert.equal(assessmentPrompts.length, 0);
  } finally { activity.planJson = null; liveInventory = null; inventoryScanResult = null; }
});

test('normal task planning refuses incomplete scans before any task loop', async () => {
  assessmentPrompts = [];
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  execute = async () => {};
  inventoryScanCalls = 0;
  inventoryScanResult = { ok: false, inventory: null, detail: '任务清单不完整：STALLED' };
  liveInventory = { progress: '5/20', tasks: [{ name: '可见单页', quota: '0/2' }] };
  loopOptions = null;
  try {
    const result = await runActivity({ activityId: activity.id });
    assert.equal(inventoryScanCalls, 1);
    assert.equal(loopOptions, null);
    assert.match(result.stepsFailed.join(' '), /清单不完整/);
    assert.equal(assessmentPrompts.length, 0);
  } finally { activity.planJson = null; liveInventory = null; inventoryScanResult = null; }
});

test('explicit exact live task bypasses name rules and respects maxTasks', async () => {
  assessmentPrompts = [];
  liveInventory = { progress: '20/20', tasks: [
    { name: '拍立淘', instruction: '浏览5秒', quota: '2/5', button: '去完成' },
    { name: '拍立淘加长版', quota: '0/5', button: '去完成' },
  ] };
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  execute = async () => {};
  loopOptions = null;
  selectedRecipe = null;
  try {
    await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 1 });
    assert.deepEqual(loopOptions.tasks.map((t: any) => ({ name: t.name, times: t.times, yaml: t.yaml })), [
      { name: '拍立淘', times: 1, yaml: 'observed.yaml' },
    ]);
    assert.equal(selectedRecipe.instruction, '浏览5秒');
    assert.equal(loopOptions.hardMax, 1);
    assert.equal(loopOptions.collectWhen, 'never');
    assert.equal(typeof loopOptions.observeTask, 'function');
    assert.equal(assessmentPrompts.length, 0);
    await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 0 });
    assert.equal(loopOptions.tasks[0].times, 0);
    assert.equal(loopOptions.hardMax, 0);
    assert.equal(loopOptions.collectWhen, 'never');
  } finally { activity.planJson = null; liveInventory = null; }
});

test('decreasing balances fail the same sanity check on normal and exception exits', async () => {
  for (const throws of [false, true]) {
    const result = await run(async (ctx) => {
      ctx.balanceBefore = 100;
      if (throws) throw new Error('execution fixture');
      ctx.balanceAfter = 90;
    }, 90);
    assert.equal(result.status, 'BAD_READ');
    assert.equal(result.balanceAfter, null);
    assert.equal(result.delta, null);
    assert.equal(finished.balanceAfter, null);
    assert.match(result.stepsFailed.join(' '), /读数不可信/);
    assert.deepEqual(snapshots, []);
    assert.deepEqual(gains, []);
  }
});

test('only current run reports written on destroy or updated in place are attached', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'signin-report-'));
  try {
    process.chdir(dir);
    fs.mkdirSync('midscene_run/report', { recursive: true });
    fs.writeFileSync('midscene_run/report/old.html', 'previous run');
    for (const report of ['current.html', 'old.html']) {
      onDestroy = async () => { fs.writeFileSync(`midscene_run/report/${report}`, 'current run updated report'); };
      const result = await run(async (ctx) => { ctx.balanceBefore = 100; ctx.balanceAfter = 100; });
      assert.equal(result.report, `midscene_run/report/${report}`);
      assert.equal(finished.evidenceDir, result.report);
    }
  } finally {
    onDestroy = async () => {};
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit selection rejects missing and ambiguous exact live names before looping', async () => {
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  execute = async () => {};
  try {
    for (const names of [['拍立淘加长版'], ['拍立淘', '拍立淘']]) {
      liveInventory = { progress: '20/20', tasks: names.map((name) => ({ name, quota: '0/5', button: '去完成' })) };
      loopOptions = null;
      const result = await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 1 });
      assert.equal(loopOptions, null);
      assert.equal(result.status, 'ERROR');
      assert.match(result.stepsFailed.join(' '), /匹配 [02] 项/);
    }
  } finally { activity.planJson = null; liveInventory = null; }
});

test('loop observation failure cannot become clean OK when settlement grew', async () => {
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] }, settle: { say: 'balance' } });
  liveInventory = { progress: '20/20', tasks: [{ name: '拍立淘', quota: '1/5', button: '去完成' }] };
  execute = async (ctx) => { ctx.balanceBefore = 100; };
  afterRead = 125;
  loopStopReason = '观测失败：任务后有限恢复仍无法确认进度与剩余任务';
  try {
    const result = await runActivity({ activityId: activity.id, taskName: '拍立淘', maxTasks: 1 });
    assert.equal(result.status, 'PARTIAL');
    assert.equal(result.ok, false);
    assert.match(result.stepsFailed.join(' '), /观测失败/);
  } finally { activity.planJson = null; liveInventory = null; loopStopReason = '达到硬上限'; }
});

test('task identity and attempt reach workflow and raw task evidence is returned and persisted per run', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR!, 'signin-task-evidence-'));
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  liveInventory = { progress: '20/20', tasks: [{ name: '拍立淘', instruction: '浏览5秒', quota: '4/5', button: '去完成' }] };
  execute = async () => {};
  taskEvidenceFixture = [{ round: 1, workflow: { taskReceipt: { raw: { completionText: '任务已完成 继续逛逛吧' } } } }];
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 1 });
    assert.equal(loopOptions.tasks[0].instruction, '浏览5秒');
    const attempt = { name: '拍立淘', instruction: '浏览5秒', attemptId: 'offline-attempt', startedAt: Date.now() };
    await loopOptions.runTask('observed.yaml', loopOptions.tasks[0], attempt);
    assert.deepEqual(workflowCall[2].taskAttempt, attempt);
    assert.deepEqual(result.taskEvidence, taskEvidenceFixture);
    const saved = JSON.parse(fs.readFileSync(result.taskEvidenceFile!, 'utf8'));
    assert.equal(saved.runId, 42);
    assert.deepEqual(saved.tasks, taskEvidenceFixture);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; liveInventory = null; taskEvidenceFixture = [];
  }
});

test('failed reused recipe is revoked automatically before the next run', async () => {
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  liveInventory = { progress: '20/20', tasks: [{ name: '拍立淘', instruction: '浏览5秒', quota: '4/5', button: '去完成' }] };
  execute = async () => {};
  loopStopReason = '观测失败：任务后无法确认同一任务的配额';
  recipeUpdates = [];
  try {
    await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 1 });
    assert.equal(recipeUpdates.length, 1);
    const [acct, act, task, evidence] = recipeUpdates[0];
    assert.equal(acct, account.id);
    assert.equal(act, activity.id);
    assert.equal(task.instruction, '浏览5秒');
    assert.equal(evidence.runId, 42);
    assert.equal(evidence.status, 'unknown');
    assert.equal(evidence.yamlHash, 'a'.repeat(64));
    assert.equal(evidence.after, null);
  } finally { activity.planJson = null; liveInventory = null; loopStopReason = '达到硬上限'; }
});

test('supervised candidate YAML overrides stale recipe without silently promoting it', async () => {
  activity.planJson = JSON.stringify({ task: { steps: [{ do: 'ai' }] } });
  liveInventory = { progress: '20/20', tasks: [{ name: '拍立淘', instruction: '浏览5秒', quota: '4/5', button: '去完成' }] };
  execute = async () => {}; recipeAvailable = false; recipeUpdates = [];
  try {
    await runActivity({ activityId: activity.id, currentPage: true, taskName: '拍立淘', maxTasks: 1, candidateYaml: 'candidate.yaml' } as any);
    assert.equal(loopOptions.tasks[0].yaml, 'candidate.yaml');
    assert.equal(loopOptions.tasks[0].kind, 'candidate-recipe');
    assert.equal(recipeUpdates.length, 0);
  } finally { activity.planJson = null; liveInventory = null; recipeAvailable = true; }
});

test('candidate override requires bounded exact supervised execution before device access', async () => {
  for (const options of [
    { currentPage: true, maxTasks: 1 },
    { currentPage: true, maxTasks: 2, taskName: '拍立淘' },
    { maxTasks: 1, taskName: '拍立淘' },
  ]) {
    await assert.rejects(runActivity({ activityId: activity.id, candidateYaml: 'candidate.yaml', ...options }), /候选配方仅允许/);
  }
});

function failedTaskEvidence(task: { name: string; instruction?: string }) {
  return { round: 1, attempt: { name: task.name, instruction: task.instruction!, attemptId: 'daily-failure', startedAt: Date.now() },
    before: { name: task.name, done: 0, total: 3 }, after: null, workflow: { ok: false, error: '实际执行未确认目的页' }, verification: 'unknown' as const };
}

test('daily exact failure overrides validated recipe and model output regardless of supervised learning', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-failure-override-');
  const inv = normalPlanningFixture();
  try {
    process.chdir(dir);
    recordTaskFailures(account.id, activity.id, 95, [failedTaskEvidence(inv.tasks[0])]);
    recordTaskFailures(account.id, activity.id, 96, [failedTaskEvidence(inv.tasks[1])]);
    for (const supervisedLearning of [false, true]) {
      const { plan } = await assessAndPlanInventory({ aiQuery: async () => ({ assessments: [...assessments!, ...assessments!] }) }, inv, { runId: 99, supervisedLearning });
      assert.deepEqual(plan.plan, []);
      assert.deepEqual(plan.learning, []);
      assert.match(plan.skipped[0].reason, /95/);
      assert.match(plan.skipped[0].reason, /实际执行未确认目的页/);
      assert.match(plan.skipped[1].reason, /96/);
    }
    const changed = { ...inv, tasks: inv.tasks.map(task => ({ ...task, instruction: task.instruction + '（新要求）' })) };
    const changedAssessments = assessments!.map(a => ({ ...a, instruction: a.instruction + '（新要求）' }));
    const result = await assessAndPlanInventory({ aiQuery: async () => ({ assessments: changedAssessments }) }, changed, { runId: 100, supervisedLearning: true });
    assert.equal(result.plan.learning.length, 1, 'instruction changes remain eligible');
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; recipeFixture = null; assessments = null;
  }
});

test('normal learning records failures before refreshed advice and explicit selection still records intentional attempts', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-failure-save-');
  const inv = normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  taskEvidenceFixture = [failedTaskEvidence(inv.tasks[0])];
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id, supervisedLearning: true, maxTasks: 1 });
    assert.equal(loadTaskFailures(account.id, activity.id).length, 1);
    const next = JSON.parse(fs.readFileSync(result.nextPlanFile!, 'utf8'));
    assert.equal(next.plan.learning[0].task, inv.tasks[1].name);
    assert.match(next.plan.skipped.find((s: any) => s.task === inv.tasks[0].name).reason, /42/);
    liveInventory = { progress: '0/20', tasks: inv.tasks };
    taskEvidenceFixture = [{ ...failedTaskEvidence(inv.tasks[0]), attempt: { ...failedTaskEvidence(inv.tasks[0]).attempt, attemptId: 'intentional-explicit' } }];
    loopOptions = null;
    await runActivity({ activityId: activity.id, currentPage: true, taskName: inv.tasks[0].name, maxTasks: 1 });
    assert.equal(loopOptions.tasks[0].name, inv.tasks[0].name);
    assert.equal(loadTaskFailures(account.id, activity.id).length, 2);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; recipeFixture = null; assessments = null;
    taskEvidenceFixture = []; liveInventory = null; recipeAvailable = true;
  }
});

function openingNoEffectEvidence(task: { name: string; instruction?: string }, total: number, startedAt = Date.now()) {
  const attempt = { name: task.name, instruction: task.instruction!, attemptId: `opening-${startedAt}`, startedAt };
  return { round: 1, attempt, before: { name: task.name, done: 0, total }, after: { name: task.name, done: 0, total },
    verification: 'no_effect' as const, workflow: { ok: false, taskEvidence: { attempt, observations: [{
      phase: 'entered' as const, observedAt: startedAt + 1,
      config: { taskName: task.name, instruction: task.instruction!, destination: 'task panel' },
      raw: { pageIsTaskPanel: true, blocked: false, destinationShown: false,
        targetName: task.name, targetInstruction: task.instruction, targetQuota: `0/${total}` },
    }] } } };
}

test('explicit bounded opening revalidation retains history and model skip while saving exact provenance', async () => {
  const inv = normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  try {
    const opening = openingNoEffectEvidence(inv.tasks[0], 3);
    const file = recordTaskFailures(account.id, activity.id, 115, [opening]);
    const history = fs.readFileSync(file, 'utf8');
    const opts = { runId: 116, supervisedLearning: true, maxTasks: 1, revalidateOpeningFailures: true };
    const agent = { aiQuery: async () => ({ assessments }) };
    const ordinary = await assessAndPlanInventory(agent, inv, { ...opts, revalidateOpeningFailures: false } as any);
    assert.ok(ordinary.plan.skipped.some(s => s.task === inv.tasks[0].name && s.reason.includes('115')));
    const reconsidered = await assessAndPlanInventory(agent, inv, opts);
    assert.equal(reconsidered.plan.learning[0].task, inv.tasks[0].name);
    const saved = JSON.parse(fs.readFileSync(reconsidered.evidencePlanFile, 'utf8'));
    assert.deepEqual(saved.openingRevalidations.map((r: any) => ({ identity: r.identity, sourceRunId: r.sourceRunId })), [
      { identity: { name: inv.tasks[0].name, instruction: inv.tasks[0].instruction }, sourceRunId: 115 },
    ]);
    assert.match(saved.openingRevalidations[0].reason, /no_effect/);
    assert.ok(saved.assessments.find((a: any) => a.task === inv.tasks[0].name).reason.startsWith(saved.openingRevalidations[0].reason));
    assert.equal(fs.readFileSync(file, 'utf8'), history);
    assessments![0].disposition = 'skip';
    recipeAvailable = true;
    const skipped = await assessAndPlanInventory(agent, inv, opts);
    assert.ok(skipped.plan.skipped.some(s => s.task === inv.tasks[0].name && s.reason.includes('115')));
    assert.ok(!skipped.plan.plan.some(s => s.task === inv.tasks[0].name), 'local recipe cannot override the revalidation model skip');
    recipeAvailable = false;
    const missing = await assessAndPlanInventory({ aiQuery: async () => ({ assessments: [] }) }, inv, opts);
    assert.deepEqual(missing.plan.learning, [], 'revalidation cannot invent a missing assessment');
    const manualSkip = await assessAndPlanInventory(agent, inv, { ...opts, skip: [inv.tasks[0].name] });
    assert.ok(manualSkip.plan.skipped.some(s => s.task === inv.tasks[0].name && s.reason.includes('人工跳过')));
    assessments![0].disposition = 'learn';
    const later = failedTaskEvidence(inv.tasks[0]);
    later.attempt.startedAt = opening.attempt.startedAt + 1;
    recordTaskFailures(account.id, activity.id, 117, [later]);
    const latest = await assessAndPlanInventory(agent, inv, opts);
    assert.ok(latest.plan.skipped.some(s => s.task === inv.tasks[0].name && s.reason.includes('117')));
    assert.deepEqual(JSON.parse(fs.readFileSync(latest.evidencePlanFile, 'utf8')).openingRevalidations, []);
  } finally {
    activity.planJson = null; inventoryScanResult = null; recipeFixture = null; assessments = null; recipeAvailable = true;
  }
});

test('opening revalidation rejects unbounded or unsupervised options before device locking', async () => {
  const before = deviceLockCalls;
  for (const options of [
    {}, { maxTasks: 1 }, { supervisedLearning: false, maxTasks: 1 },
    { supervisedLearning: true }, { supervisedLearning: true, maxTasks: 0 },
    { supervisedLearning: true, maxTasks: 2 },
  ]) await assert.rejects(runActivity({ activityId: activity.id, revalidateOpeningFailures: true, ...options } as any), /revalidateOpeningFailures/);
  assert.equal(deviceLockCalls, before);
});

test('normal revalidation passes the flag once and records the new failure before refresh', async () => {
  const inv = normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  try {
    const old = openingNoEffectEvidence(inv.tasks[0], 3, Date.now() - 1000);
    recordTaskFailures(account.id, activity.id, 115, [old]);
    const newFailure = openingNoEffectEvidence(inv.tasks[0], 3);
    taskEvidenceFixture = [newFailure];
    const result = await runActivity({ activityId: activity.id, supervisedLearning: true, maxTasks: 1, revalidateOpeningFailures: true } as any);
    assert.equal(loopOptions.tasks[0].name, inv.tasks[0].name);
    assert.equal(loopOptions.tasks[0].times, 1);
    const initial = JSON.parse(fs.readFileSync(result.evidencePlanFile!, 'utf8'));
    assert.equal(initial.openingRevalidations[0].sourceRunId, 115);
    const entries = loadTaskFailures(account.id, activity.id);
    assert.deepEqual(entries.map(e => e.runId), [115, 42]);
    const next = JSON.parse(fs.readFileSync(result.nextPlanFile!, 'utf8'));
    assert.deepEqual(next.openingRevalidations, [], 'refresh advice does not reuse the explicit opening exception');
    assert.ok(next.plan.skipped.some((s: any) => s.task === inv.tasks[0].name && s.reason.includes('42')));
  } finally {
    activity.planJson = null; inventoryScanResult = null; recipeFixture = null; assessments = null; recipeAvailable = true; taskEvidenceFixture = [];
  }
});

function normalPlanningFixture() {
  const inv = normalizeInventory({ progress: '0/20', tasks: [
    { name: '已学任务', instruction: '应用内浏览5秒', quota: '0/3', reward: 20, button: '去完成' },
    { name: '待学任务', instruction: '应用内搜索后浏览', quota: '0/2', reward: 50, button: '去完成' },
  ] }, account.id, activity.id);
  inventoryScanResult = { ok: true, inventory: inv, evidenceFile: 'scan.json' };
  assessments = inv.tasks.map(t => ({ task: t.name, instruction: t.instruction, disposition: 'learn',
    source: 'model_observation', reason: '当前完整要求支持普通应用内浏览', estimatedSeconds: null, estimatedModelTokens: null }));
  const hash = 'a'.repeat(64);
  recipeFixture = { state: 'validated', validations: 2, taskName: inv.tasks[0].name, instruction: inv.tasks[0].instruction,
    yaml: 'observed.yaml', yamlHash: hash,
    evidence: [1, 2].map(runId => ({ taskName: inv.tasks[0].name, instruction: inv.tasks[0].instruction,
      yamlHash: hash, runId, report: 'report.html', timestamp: '2026-10-31T00:00:00Z', status: 'completed',
      before: { name: inv.tasks[0].name, done: 0, total: 3 }, after: { name: inv.tasks[0].name, done: 1, total: 3 } })) };
  activity.planJson = JSON.stringify({ entry: [{ do: 'ai' }], task: { steps: [{ do: 'ai' }] } });
  execute = async () => {};
  loopOptions = null; assessmentPrompts = []; events = []; recipeLookups = [];
  return inv;
}

test('normal main scans then assesses once and executes only the concrete validated evidence plan', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-evidence-plan-');
  const inv = normalPlanningFixture();
  assessments![0].disposition = 'skip';
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id, maxTasks: 2 });
    assert.deepEqual(events, ['scan', 'assess', 'execute', 'scan', 'assess']);
    assert.equal(assessmentPrompts.length, 2);
    for (const t of inv.tasks) assert.ok(assessmentPrompts[0].includes(t.instruction!));
    assert.deepEqual(recipeLookups, [...inv.tasks, ...inv.tasks]);
    assert.deepEqual(loopOptions.tasks.map((t: any) => ({ name: t.name, times: t.times, yaml: t.yaml })), [
      { name: '已学任务', times: 2, yaml: 'observed.yaml' },
    ]);
    assert.equal(loopOptions.hardMax, 2);
    assert.equal(path.relative(dir, (result as any).evidencePlanFile), 'data/evidence/plans/run-42.json');
    const saved = JSON.parse(fs.readFileSync((result as any).evidencePlanFile, 'utf8'));
    assert.equal(saved.runId, 42);
    assert.deepEqual(saved.inventory, JSON.parse(JSON.stringify(inv)));
    assert.equal(saved.modelAssessments[0].disposition, 'skip');
    assert.equal(saved.assessments.find((a: any) => a.task === '已学任务').source, 'validated_recipe');
    assert.equal(saved.plan.plan[0].times, 2);
    assert.deepEqual(saved.plan.learning, []);
    assert.ok(saved.plan.skipped.some((t: any) => t.task === '待学任务'));
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; recipeFixture = null; assessments = null;
  }
});

test('normal learning defaults to skipped and returns a truthful planned-only stop', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-learning-disabled-');
  normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id });
    assert.deepEqual(events, ['scan', 'assess']);
    assert.equal(loopOptions, null);
    assert.equal(result.status, 'PLANNED_ONLY');
    assert.equal(result.ok, false);
    assert.equal(finished.status, 'PLANNED_ONLY');
    assert.match(result.detail!, /未开启受监督学习/);
    const saved = JSON.parse(fs.readFileSync(result.evidencePlanFile!, 'utf8'));
    assert.deepEqual(saved.plan.learning, []);
    assert.equal(saved.plan.skipped.length, 2);
    const dry = await runActivity({ activityId: activity.id, dryRun: true });
    assert.equal(dry.status, 'PLANNED_ONLY');
    assert.match(dry.detail!, /未开启受监督学习/);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; assessments = null; recipeAvailable = true;
  }
});

test('supervised normal learning executes at most one attempt and maxTasks zero still wins', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-learning-enabled-');
  try {
    process.chdir(dir);
    for (const maxTasks of [undefined, 5, 1, 0]) {
      normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
      const result = await runActivity({ activityId: activity.id, supervisedLearning: true, maxTasks });
      const saved = JSON.parse(fs.readFileSync(result.evidencePlanFile!, 'utf8'));
      assert.deepEqual(saved.plan.plan, []);
      if (maxTasks === 0) {
        assert.equal(loopOptions, null);
        assert.equal(saved.plan.learning.length, 0);
        assert.equal(result.status, 'PLANNED_ONLY');
      } else {
        assert.equal(saved.plan.learning.length, 1);
        assert.equal(loopOptions.tasks.length, 1);
        assert.equal(loopOptions.tasks[0].times, 1);
        assert.equal(loopOptions.tasks[0].kind, 'unlearned');
        assert.equal(loopOptions.tasks[0].yaml, undefined);
        assert.equal(loopOptions.tasks[0].fallbackSteps[0].do, 'ai');
      }
    }
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; assessments = null; recipeAvailable = true;
  }
});

test('collect-only presents the same evidence plan and bounded learning without executing it', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/collect-evidence-plan-');
  normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  try {
    process.chdir(dir);
    const result = await collectAndPlan({ activityId: activity.id, supervisedLearning: true });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'PLANNED');
    assert.equal(result.plan!.learning.length, 1);
    assert.equal(result.plan!.learning[0].times, 1);
    assert.equal(result.plan!.estCny, null);
    assert.equal(result.plan!.feasible, 0);
    assert.ok(result.plan!.notes.length);
    assert.equal(result.playbook, null);
    assert.deepEqual(events, ['scan', 'assess']);
    assert.equal(loopOptions, null);
    assert.equal(assessmentPrompts.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(result.evidencePlanFile!, 'utf8')).plan.learning.length, 1);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; assessments = null; recipeAvailable = true;
  }
});

test('unconfirmed return panel prevents settlement of an unrelated positive number', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-wrong-page-');
  normalPlanningFixture(); recipeFixture = null; recipeAvailable = false; panelReadyFixture = false;
  afterRead = 200; execute = async ctx => { ctx.balanceBefore = 100; };
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id, supervisedLearning: true, maxTasks: 1 });
    assert.equal(result.balanceAfter, null);
    assert.equal(result.delta, null);
    assert.match(result.stepsFailed.join(' '), /面板未确认/);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; assessments = null; recipeAvailable = true; panelReadyFixture = true;
  }
});

test('normal execution refreshes full inventory and saves next plan without overwriting executed plan', async () => {
  const cwd = process.cwd();
  const dir = fs.mkdtempSync('/Users/mater/.hermes/cache/scratch/signin-refresh-');
  normalPlanningFixture(); recipeFixture = null; recipeAvailable = false;
  const after = normalizeInventory({ progress: '1/20', tasks: [
    { name: '待学任务', instruction: '应用内搜索后浏览', quota: '0/2', reward: 50, button: '去完成' },
  ] }, account.id, activity.id);
  inventoryScanSequence = [inventoryScanResult, { ok: true, inventory: after, evidenceFile: 'after-scan.json' }];
  loopStopReason = '达到硬上限'; taskEvidenceFixture = [];
  execute = async ctx => { ctx.balanceBefore = 100; };
  afterRead = 120;
  try {
    process.chdir(dir);
    const result = await runActivity({ activityId: activity.id, supervisedLearning: true, maxTasks: 1 });
    assert.deepEqual(events, ['scan', 'assess', 'execute', 'scan', 'assess']);
    assert.ok(result.nextPlanFile);
    const initial = JSON.parse(fs.readFileSync(result.evidencePlanFile!, 'utf8'));
    const next = JSON.parse(fs.readFileSync(result.nextPlanFile!, 'utf8'));
    assert.equal(initial.inventory.progress.done, 0);
    assert.equal(next.inventory.progress.done, 1);
    assert.equal(next.plan.learning[0].task, '待学任务');
    assert.equal(next.executionAllowed, false);
  } finally {
    process.chdir(cwd); fs.rmSync(dir, { recursive: true, force: true });
    activity.planJson = null; inventoryScanResult = null; inventoryScanSequence = []; assessments = null; recipeAvailable = true;
  }
});
