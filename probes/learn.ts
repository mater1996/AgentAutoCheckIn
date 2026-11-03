/**
 * 一站式：抽取 L1 → 归纳 L2 → 预测 L3。
 * 用法：npx tsx probes/learn.ts [活动id]
 */
import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';

import { sqlite, nowIso } from '../db/client';
import { deriveTemplates, loadObservations, saveTemplates } from '../runner/derive';
import { extractFromReport } from '../runner/recipe';
import { loadTaskRules } from '../runner/config';
import { loadInventoryLatest } from '../runner/inventory';
import { predict } from '../runner/predict';
import type { TaskRules } from '../runner/planner';

const activityId = process.argv[2] ?? 'tb_coin';

// ── 1) 找最近的报告并抽取 ──
const reportDir = 'midscene_run/report';
const reports = fs
  .readdirSync(reportDir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => ({ f, t: fs.statSync(path.join(reportDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);

// 选「抽取到动作最多」的那份报告，而不是最新的（最新的可能只是收集阶段，没执行任务）
let target = reports[0];
let bestCount = 0;
for (const r of reports.slice(0, 6)) {
  const n = extractFromReport(path.join(reportDir, r.f)).length;
  if (n > bestCount) { bestCount = n; target = r; }
}
if (!target) {
  console.error('没有报告可抽取');
  process.exit(1);
}
console.log(`抽取来源: ${target.f}`);

const observed = extractFromReport(path.join(reportDir, target.f));
console.log(`L1 抽取: ${observed.length} 条指令`);

// ── 2) 落 recipe 表 ──
const acct = (sqlite.prepare(`SELECT account_id FROM activity WHERE id=?`).get(activityId) as any)?.account_id ?? 'tb_main';
const ruleRows = loadTaskRules('taobao');
const kindsByTask = new Map<string, string>();
if (ruleRows?.rules) {
  for (const o of observed) {
    for (const r of ruleRows.rules) {
      if (new RegExp(r.pattern).test(o.task)) {
        kindsByTask.set(o.task, r.kind ?? 'unknown');
        break;
      }
    }
  }
}

sqlite.prepare(`DELETE FROM recipe WHERE activity_id = ?`).run(activityId);
for (const o of observed) {
  sqlite
    .prepare(
      `INSERT INTO recipe (account_id, activity_id, task_name, kind, steps_json, run_id, observed_at, outcome, retries, tokens, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      acct,
      activityId,
      o.task.slice(0, 200),
      kindsByTask.get(o.task) ?? 'unknown',
      JSON.stringify(o.steps),
      null,
      nowIso(),
      o.outcome,
      o.retries,
      null,
      'medium',
    );
}
console.log(`L1 落库: recipe 表 ${observed.length} 条`);

// ── 3) 归纳 L2 ──
const obs = loadObservations(activityId);
const { templates, how } = await deriveTemplates('taobao', obs);
saveTemplates('taobao', templates);
console.log(`\nL2 归纳: ${templates.length} 个类型模板（方式：${how}）`);
for (const t of templates) {
  console.log(`\n  [${t.kind}] 置信度 ${t.confidence}`);
  console.log(`    步骤: ${t.steps.map((s) => s.act + (s.note ? `(${s.note.slice(0, 18)})` : '')).join(' → ')}`);
  if (t.invariants?.length) t.invariants.forEach((i) => console.log(`    不变量: ${i}`));
  if (t.failure_modes?.length) t.failure_modes.forEach((i) => console.log(`    失败模式: ${i}`));
}

// ── 4) 预测 L3 ──
const inv = loadInventoryLatest(acct, activityId);
if (!inv) {
  console.log('\n没有 inventory，跳过预测');
  process.exit(0);
}
const rawRules: any = loadTaskRules('taobao');
const rules: TaskRules = {
  platform: rawRules.platform,
  rules: rawRules.rules ?? [],
  tiers: rawRules.tiers,
  tier_policy: rawRules.tier_policy,
  tokensPerLocate: rawRules.tokens_per_locate,
  minMarginalCnyPerHour: rawRules.min_marginal_cny_per_hour,
  unitReward: rawRules.unit_reward,
  unitSeconds: rawRules.unit_seconds,
} as TaskRules;

const pred = predict('taobao', inv, rules);
console.log('\n=== L3 预测执行 ===');
for (const t of pred.tasks) {
  console.log(`\n  ${t.task}  [${t.kind}] ×${t.times}  可信度 ${t.confidence}${t.needsAI ? '  ⚠ 需现场学习' : ''}`);
  if (t.steps.length) console.log(`    ${t.steps.map((s) => s.act).join(' → ')}`);
}
console.log('\n覆盖：可直接执行 ' + pred.covered + ' 次，需学习 ' + pred.uncovered + ' 次');
pred.notes.forEach((n) => console.log('  ' + n));