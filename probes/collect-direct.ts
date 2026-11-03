/**
 * 直接跑收集 + 前置定位（不经 HTTP，便于看完整日志）。
 * 用法：npx tsx probes/collect-direct.ts [活动id]
 */
import '../runner/model';
import { syncToDb } from '../runner/config';
import { collectAndPlan } from '../runner/collect';

const activityId = process.argv[2] ?? 'tb_coin';

console.log('=== 同步配置 ===');
syncToDb();

console.log(`\n=== 收集 + 前置定位：${activityId} ===`);
const t0 = Date.now();
const r = await collectAndPlan({ activityId });
console.log(`\n耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s  status=${r.status}`);

if (r.inventory) {
  const inv = r.inventory;
  console.log(`\n进度 ${inv.progress.done}/${inv.progress.total}  剩余 ${inv.total_remaining}`);
  console.log('\n任务列表:');
  for (const t of inv.tasks) {
    console.log(`  ${t.name.slice(0, 22).padEnd(24)} ${t.quota.padEnd(6)} 剩${t.remaining}  ${t.button}`);
  }
}

if (r.plan) {
  console.log('\n计划:');
  for (const p of [...r.plan.plan, ...r.plan.learning]) {
    console.log(`  ${p.seq}. ${p.task.slice(0, 20).padEnd(22)} ${p.disposition} x${p.times} ¥${p.estCny ?? '未知'}`);
  }
  const total = [...r.plan.plan, ...r.plan.learning].reduce((sum, p) => sum + p.times, 0);
  console.log(`  合计 ${total} 次，预估 ¥${r.plan.estCny?.toFixed(3) ?? '未知'}`);
  r.plan.notes.forEach((n) => console.log('  note:', n));
  r.plan.skipped.forEach((t) => console.log(`  跳过 ${t.task}: ${t.reason}`));
}
if (r.evidencePlanFile) console.log('证据计划:', r.evidencePlanFile);

if (!r.ok) console.log('\ndetail:', r.detail);
