/**
 * 干跑验证：不碰手机、不调模型，只验证价值模型与终止条件算得对不对。
 * 对应 docs/任务标准流程.md 第 3 节的淘金币实算。
 */
import { computePlan, marginalPerHour, parseFraction, parseIntStrict, tiersEarned, valueOf } from '../runner/objective';
import type { Objective, ValueModel } from '../runner/objective';

const vm: ValueModel = {
  unit_reward: 30,
  unit_seconds: 35,
  tiers: [
    { at: 3, reward: 30 },
    { at: 10, reward: 50 },
    { at: 20, reward: 100 },
  ],
};
const CNY = 0.01; // 1 金币 = ¥0.01

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  ❌ ${name}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }
}

console.log('=== 1. 档位累加 ===');
check('done=2 未达首档', tiersEarned(2, vm.tiers), 0);
check('done=3 达首档', tiersEarned(3, vm.tiers), 30);
check('done=10 达两档', tiersEarned(10, vm.tiers), 80);
check('done=20 达三档', tiersEarned(20, vm.tiers), 180);

console.log('=== 2. 累计价值 ===');
check('valueOf(3)', valueOf(3, vm), 3 * 30 + 30);
check('valueOf(10)', valueOf(10, vm), 10 * 30 + 80);
check('valueOf(20)', valueOf(20, vm), 20 * 30 + 180);

console.log('=== 3. 跨档边际 ===');
const m9 = marginalPerHour(9, vm, CNY);
const m19 = marginalPerHour(19, vm, CNY);
const m5 = marginalPerHour(5, vm, CNY);
console.log(`  done=5→6   边际 ${m5?.toFixed(1)} ¥/h（普通步）`);
console.log(`  done=9→10  边际 ${m9?.toFixed(1)} ¥/h（跨10档）`);
console.log(`  done=19→20 边际 ${m19?.toFixed(1)} ¥/h（跨20档）`);
if ((m9 ?? 0) > 80 && (m9 ?? 0) < 85) pass++;
else {
  fail++;
  console.log(`  ❌ 跨10档边际应约 82.3，实得 ${m9}`);
}
if ((m19 ?? 0) > 130 && (m19 ?? 0) < 140) pass++;
else {
  fail++;
  console.log(`  ❌ 跨20档边际应约 133.7，实得 ${m19}`);
}
if ((m5 ?? 0) > 30 && (m5 ?? 0) < 32) pass++;
else {
  fail++;
  console.log(`  ❌ 普通步边际应约 30.9，实得 ${m5}`);
}

console.log('=== 4. all_tiers 策略应一路做到底 ===');
const objAll: Objective = { strategy: 'all_tiers', max_seconds: 900, min_marginal_cny_per_hour: 20 };
const d1 = computePlan({ done: 3, total: 20, tasksLeft: 17 }, objAll, vm, CNY, 0);
check('起始应继续', d1.shouldContinue, true);
check('剩余轮数应为 17', d1.roundsRemaining, 17);
console.log(`  → ${d1.reason}`);

const d2 = computePlan({ done: 20, total: 20, tasksLeft: 5 }, objAll, vm, CNY, 600);
check('做完应停', d2.shouldContinue, false);
console.log(`  → ${d2.reason}`);

const d3 = computePlan({ done: 6, total: 20, tasksLeft: 0 }, objAll, vm, CNY, 200);
check('无任务应停', d3.shouldContinue, false);
console.log(`  → ${d3.reason}`);

const d4 = computePlan({ done: 6, total: 20, tasksLeft: 14 }, objAll, vm, CNY, 1200);
check('超时应停', d4.shouldContinue, false);
console.log(`  → ${d4.reason}`);

console.log('=== 5. 时间预算约束轮数 ===');
// 剩余 100 秒 / 单任务 35 秒 = 2 轮
const d5 = computePlan({ done: 3, total: 20, tasksLeft: 17 }, objAll, vm, CNY, 800);
check('剩 100 秒只能做 2 个', d5.roundsRemaining, 2);
console.log(`  → ${d5.reason}`);

console.log('=== 6. first_tier 策略 ===');
const objFirst: Objective = { strategy: 'first_tier', max_seconds: 900 };
const d6 = computePlan({ done: 3, total: 20, tasksLeft: 17 }, objFirst, vm, CNY, 0);
check('已达首档应立刻停', d6.shouldContinue, false);
console.log(`  → ${d6.reason}`);

console.log('=== 7. fixed 策略 ===');
const objFixed: Objective = { strategy: 'fixed', max_seconds: 900, fixed_count: 7 };
const d7 = computePlan({ done: 3, total: 20, tasksLeft: 17 }, objFixed, vm, CNY, 0);
check('fixed:7 应做 4 个', d7.roundsRemaining, 4);
console.log(`  → ${d7.reason}`);

console.log('=== 8. 解析函数 ===');
check('parseFraction 3/20', parseFraction('3/20'), { done: 3, total: 20 });
check('parseFraction 带空格', parseFraction('完成进度 6 / 20'), { done: 6, total: 20 });
check('parseFraction 无匹配', parseFraction('没有进度'), null);
check('parseIntStrict 数字', parseIntStrict(' 12 '), 12);
check('parseIntStrict 非纯数字', parseIntStrict('还有3个'), null);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);