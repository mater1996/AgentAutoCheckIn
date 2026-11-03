import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeInventory } from '../runner/inventory';
import * as planner from '../runner/planner';
import fs from 'node:fs';
import { parse } from 'yaml';

const inventory = (tasks: any[]) => normalizeInventory({ progress: '0/20', tasks }, 'offline', 'offline');
const row = (name = '拍立淘', instruction = '浏览5秒', quota = '0/5', reward = 20) => ({ name, instruction, quota, reward, button: '去完成' });
const assess = (task = '拍立淘', instruction = '浏览5秒', disposition = 'learn', source = 'model_observation', estimatedSeconds: number | null = null, estimatedModelTokens: number | null = null) => ({ task, instruction, disposition, source, reason: 'Full observed context assessment', estimatedSeconds, estimatedModelTokens });
const evidencePlan = (inv: any, assessments: any[], settings: any = {}) => {
  assert.equal(typeof (planner as any).computeEvidencePlan, 'function', 'pure evidence planning API exists');
  return (planner as any).computeEvidencePlan(inv, assessments, settings);
};

test('observed model assessments appear only in an explicitly supervised bounded learning plan', () => {
  const inv = inventory([row(), row('普通任务', '停留10秒')]);
  const assessments = [assess(), assess('普通任务', '停留10秒')];
  assert.deepEqual(evidencePlan(inv, assessments).learning, []);
  const result = evidencePlan(inv, assessments, { supervisedLearning: true });
  assert.deepEqual(result.plan, []);
  assert.equal(result.learning.length, 1);
  assert.equal(result.learning[0].times, 1);
  assert.equal(result.learning[0].instruction, '浏览5秒');
  assert.equal(result.learning[0].estimatedSeconds, null);
  assert.equal(result.learning[0].estimatedModelTokens, null);
  assert.equal(result.learning[0].estCny, null);
  assert.equal(result.estimatedModelTokens, null);
  assert.equal(result.feasible, 0, 'learning does not promise completion');
});

test('execute requires compatible locally validated recipe evidence, never a model source claim', () => {
  const inv = inventory([row()]);
  const assessments = [assess('拍立淘', '浏览5秒', 'execute', 'validated_recipe', 60, 100000)];
  assert.deepEqual(evidencePlan(inv, assessments).plan, []);
  assert.deepEqual(evidencePlan(inv, [assess('拍立淘', '浏览5秒', 'execute')], { validatedRecipes: [recipe()] }).plan, []);
  const result = evidencePlan(inv, assessments, { validatedRecipes: [recipe()] });
  assert.equal(result.plan[0].times, 5);
  assert.equal(result.plan[0].yaml, 'validated.yaml');
  assert.equal(result.plan[0].quota, '0/5');
  assert.equal(result.plan[0].reward, 20);
  assert.equal(result.plan[0].estimatedSeconds, 60, 'assessment estimates remain per attempt');
  assert.equal(result.estimatedSeconds, 300);
  assert.equal(result.estimatedModelTokens, 500000);
  assert.equal(result.estCny, null, 'no invented token price');
});
function recipe() {
  const hash = 'a'.repeat(64);
  return {
    state: 'validated', validations: 2, taskName: '拍立淘', instruction: '浏览5秒', yaml: 'validated.yaml', yamlHash: hash,
    evidence: [1, 2].map(runId => ({ taskName: '拍立淘', instruction: '浏览5秒', yamlHash: hash, runId, report: 'offline-report', timestamp: '2026-10-31T00:00:00Z', status: 'completed', before: { name: '拍立淘', done: 0, total: 5 }, after: { name: '拍立淘', done: 1, total: 5 } })),
  };
}

test('assessment identity and raw quota must be exact, unique, complete and internally consistent', () => {
  for (const [rows, assessments] of [
    [[row()], [assess('拍立淘加长版')]],
    [[row()], [assess('拍立淘', '浏览10秒')]],
    [[row(), row()], [assess()]],
    [[row()], [assess(), assess()]],
    [[row('拍立淘', '')], [assess('拍立淘', '')]],
    [[row()], [{ ...assess(), reason: '' }]],
    [[row()], [{ ...assess(), estimatedSeconds: -1 }]],
    [[row()], [{ ...assess(), estimatedModelTokens: Infinity }]],
  ] as any[]) {
    const result = evidencePlan(inventory(rows), assessments, { supervisedLearning: true });
    assert.equal(result.learning.length, 0, JSON.stringify({ rows, assessments }));
    assert.ok(result.skipped.length);
  }
  const inv = inventory([row()]);
  inv.tasks[0].quota = 'prefix 0/5';
  assert.equal(evidencePlan(inv, [assess()], { supervisedLearning: true }).learning.length, 0);
  inv.tasks[0].quota = '5/5';
  assert.equal(evidencePlan(inv, [assess()], { supervisedLearning: true }).learning.length, 0, 'raw quota cannot disagree with cached derived counts');
  for (const badRecipe of [{ ...recipe(), state: 'stale' }, { ...recipe(), instruction: '浏览10秒' }, { ...recipe(), validations: 1 }, { ...recipe(), evidence: [] }]) {
    assert.deepEqual(evidencePlan(inventory([row()]), [assess('拍立淘', '浏览5秒', 'execute', 'validated_recipe')], { validatedRecipes: [badRecipe] }).plan, []);
  }
});

test('budgets bound attempts, unknown spend cannot pass a finite budget, and explicit zero differs from unknown', () => {
  const inv = inventory([row()]);
  const unknown = [assess()];
  assert.equal(evidencePlan(inv, unknown, { supervisedLearning: true, maxTasks: 0 }).learning.length, 0);
  assert.equal(evidencePlan(inv, unknown, { supervisedLearning: true, maxSeconds: 100 }).learning.length, 0);
  assert.equal(evidencePlan(inv, unknown, { supervisedLearning: true, maxModelTokens: 100 }).learning.length, 0);
  assert.equal(evidencePlan(inv, unknown, { supervisedLearning: true, maxCny: 1 }).learning.length, 0);
  const known = [assess('拍立淘', '浏览5秒', 'execute', 'validated_recipe', 10, 100)];
  const result = evidencePlan(inv, known, { validatedRecipes: [recipe()], maxTasks: 4, maxSeconds: 25, maxModelTokens: 300, cnyPerMillionTokens: 3 });
  assert.equal(result.plan[0].times, 2);
  assert.equal(result.estCny, 0.0006);
  assert.equal(result.estimatedSeconds, 20);
  assert.equal(result.estimatedModelTokens, 200);
  assert.equal(result.feasible, 2);
  const free = evidencePlan(inv, [assess('拍立淘', '浏览5秒', 'learn', 'model_observation', 0, 0)], { supervisedLearning: true, maxSeconds: 0, maxModelTokens: 0, cnyPerMillionTokens: 3, maxCny: 0 });
  assert.equal(free.learning.length, 1);
  assert.equal(free.estCny, 0);
  assert.throws(() => evidencePlan(inv, unknown, { maxTasks: -1 }), /maxTasks/);
});

test('sorting compares actual reward per estimated second only for known comparable rows and otherwise stays stable', () => {
  const inv = inventory([row('慢任务', '要求甲', '0/2', 20), row('快任务', '要求乙', '0/2', 50)]);
  const input = JSON.stringify(inv);
  const known = [assess('慢任务', '要求甲', 'learn', 'model_observation', 20), assess('快任务', '要求乙', 'learn', 'model_observation', 10)];
  assert.deepEqual(evidencePlan(inv, known, { supervisedLearning: true, maxLearningTasks: 2 }).learning.map((t: any) => t.task), ['快任务', '慢任务']);
  const unknown = known.map(a => ({ ...a, estimatedSeconds: null }));
  assert.deepEqual(evidencePlan(inv, unknown, { supervisedLearning: true, maxLearningTasks: 2 }).learning.map((t: any) => t.task), ['慢任务', '快任务']);
  assert.equal(JSON.stringify(inv), input, 'planning is pure');
});

test('tier estimates use observed unclaimed tiers and never resurrect skipped work to reach a tier', () => {
  const inv = inventory([row('拍立淘', '浏览5秒', '0/5', 20), row('不执行', '观测要求', '0/20', 50)]);
  inv.progress.done = 8;
  inv.tiers = [
    { coin: 30, need: '3次任务', button: '已领取', claimed: true },
    { coin: 50, need: '10次任务', button: '未达成', claimed: false },
    { coin: 100, need: '20次任务', button: '未达成', claimed: false },
  ];
  const result = evidencePlan(inv, [assess('拍立淘', '浏览5秒', 'execute', 'validated_recipe', 10, 100), assess('不执行', '观测要求', 'skip')], { validatedRecipes: [recipe()], maxTasks: 2, cnyPerUnit: 0.01, tiers: [{ at: 20, reward: 999 }] });
  assert.equal(result.feasible, 10);
  assert.equal(result.reachableTier, 10);
  assert.equal(result.unreachableTier, 20);
  assert.equal(result.estimatedTaskReward, 40);
  assert.equal(result.estimatedTierReward, 50);
  assert.equal(result.estimatedReward, 90);
  assert.equal(result.estimatedRewardCny, 0.9);
  assert.equal(result.plan.length, 1);
  assert.ok(result.skipped.some((s: any) => s.task === '不执行'));
});

test('group assessment prompt contains full observed context, strict identities, capability limits and cost provenance', () => {
  assert.equal(typeof (planner as any).buildAssessmentPrompt, 'function');
  const inv = inventory([row('普通任务', '实际可见要求'), row('另一个任务', '另一条要求')]);
  const prompt = (planner as any).buildAssessmentPrompt(inv, {
    capabilities: ['ordinary_in_app_browse', 'ordinary_in_app_search'],
    validatedRecipes: [{ task: '普通任务', instruction: '实际可见要求', yamlHash: 'a'.repeat(64) }],
    actualCosts: [{ task: '拍立淘', instruction: '浏览5秒', runId: 76, status: 'OK', seconds: 58.795, modelTokens: 104591, calls: 10, provenance: 'evidence/measured-run-costs.json' }],
  });
  for (const text of ['普通任务', '实际可见要求', '另一个任务', '另一条要求', '104591', 'measured-run-costs.json', 'estimatedSeconds', 'estimatedModelTokens', 'model_observation', 'learn', 'skip', 'purchase', 'install', 'referral', 'crossapp', 'game', 'null']) assert.ok(prompt.includes(text), text);
  assert.match(prompt, /execute.*local|本地.*execute/);
  assert.match(prompt, /名称.*推断|name.*infer/);
});

test('taobao config does not turn display names into eligibility or hardcode task costs', () => {
  const config = parse(fs.readFileSync(new URL('../config/tasks/taobao.yaml', import.meta.url), 'utf8'));
  assert.deepEqual(config.rules, []);
  assert.equal(config.unit_reward, undefined);
  assert.equal(config.unit_seconds, undefined);
  assert.equal(config.tokens_per_locate, undefined);
  assert.equal(config.planning.max_learning_tasks, 1);
  assert.equal(config.planning.assessment, 'full_context_observation');
});

test('untrusted assessment fields fail closed without throwing and rejected execution reports the missing evidence', () => {
  for (const bad of [{ ...assess(), reason: 42 }, { ...assess(), estimatedSeconds: '10' }, { ...assess(), source: 'invented' }]) {
    assert.doesNotThrow(() => evidencePlan(inventory([row()]), [bad], { supervisedLearning: true }));
    assert.deepEqual(evidencePlan(inventory([row()]), [bad], { supervisedLearning: true }).learning, []);
  }
  const rejected = evidencePlan(inventory([row()]), [assess('拍立淘', '浏览5秒', 'execute', 'validated_recipe')]);
  assert.match(rejected.skipped[0].reason, /验证.*配方|recipe/);
});

test('legacy planning cannot authorize work or invent free costs from names and cached coordinates', () => {
  const inv = inventory([row()]);
  const result = planner.computePlan(inv, { platform: 'offline', rules: [{ pattern: '.*', kind: 'browse' }] }, 0.01, 'prefer_tier', new Set(['拍立淘']));
  assert.deepEqual(result.plan, []);
  assert.equal(result.estCny, null);
  assert.match(result.skipped[0].reason, /assessment|评估/);
  assert.deepEqual(inv.tasks.map(t => t.remaining), [5]);
});
