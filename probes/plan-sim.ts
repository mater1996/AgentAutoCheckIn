/**
 * 干跑验证（第二层）：从真实配置 + 数据库读出目标模型，模拟整个任务循环。
 * 不碰手机、不调模型 —— 只验证"配置 → 库 → 计划 → 决策"这条链路。
 */
import '../runner/model';
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/client';
import { computePlan, tiersEarned, valueOf } from '../runner/objective';
import type { Objective, ProbeState, ValueModel } from '../runner/objective';

const ACT = process.argv[2] ?? 'tb_coin';

const act = db.select().from(schema.activity).where(eq(schema.activity.id, ACT)).get();
if (!act) {
  console.error(`活动不存在: ${ACT}（先跑 config sync）`);
  process.exit(1);
}

const plan = act.planJson ? JSON.parse(act.planJson) : null;
if (!plan?.task?.steps?.length) {
  console.error(`${ACT} 不是目标驱动形态（没有 task.steps），走的是旧 flow`);
  process.exit(1);
}

const objRow = db.select().from(schema.objective).where(eq(schema.objective.activityId, ACT)).get();
const tierRows = db.select().from(schema.tier).where(eq(schema.tier.activityId, ACT)).all();
const probeRows = db.select().from(schema.probe).where(eq(schema.probe.activityId, ACT)).all();
const asset = act.assetId ? db.select().from(schema.asset).where(eq(schema.asset.id, act.assetId)).get() : undefined;

const objective: Objective = {
  strategy: (objRow?.strategy as any) ?? 'all_tiers',
  maxSeconds: objRow?.maxSeconds ?? 900,
  minMarginalCnyPerHour: objRow?.minMarginalCnyPerHour ?? undefined,
  fixedCount: objRow?.fixedCount ?? undefined,
};
const vm: ValueModel = {
  unitReward: objRow?.unitReward ?? 0,
  unitSeconds: objRow?.unitSeconds ?? 35,
  tiers: tierRows.map((t) => ({ at: t.at, reward: t.reward })),
};
const cny = asset?.cnyPerUnit ?? 0;

console.log(`活动：${act.name}（${ACT}）  资产：${asset?.name ?? '-'}  1 单位 = ¥${cny}`);
console.log(
  `目标：${objective.strategy}  上限 ${objective.maxSeconds}s  边际阈值 ${objective.minMarginalCnyPerHour ?? '不设'} ¥/h`,
);
console.log(`单任务：${vm.unitReward} 单位 / ${vm.unitSeconds}s`);
console.log(`档位：${vm.tiers.map((t) => `进度${t.at}→${t.reward}`).join('  ')}`);
console.log(`探测：${probeRows.map((p) => `${p.probeId}(${p.parse})`).join('  ')}`);
console.log(`入口步骤 ${plan.entry?.length ?? 0} 个，任务单元 ${plan.task.steps.length} 步，领奖 ${plan.collect?.steps?.length ?? 0} 步`);

// 模拟：起始 3/20、剩 17 个任务，逐轮推演
console.log('\n=== 逐轮推演（假设每个任务 +1 进度）===');
let state: ProbeState = { done: 3, total: 20, tasksLeft: 17 };
let elapsed = 0;
let rounds = 0;

console.log(
  `${'轮'.padStart(3)} ${'进度'.padStart(7)} ${'剩任务'.padStart(6)} ${'累计单位'.padStart(8)} ${'累计¥'.padStart(7)} ${'边际¥/h'.padStart(9)}  决策`,
);
while (rounds < 40) {
  const d = computePlan(state, objective, vm, cny, elapsed);
  const marg = d.marginalPerHour != null ? d.marginalPerHour.toFixed(1) : '-';
  console.log(
    `${String(rounds).padStart(3)} ${(state.done + '/' + state.total).padStart(7)} ${String(state.tasksLeft).padStart(6)} ` +
      `${d.currentUnits.toFixed(0).padStart(8)} ${d.currentCny.toFixed(2).padStart(7)} ${marg.padStart(9)}  ${d.shouldContinue ? '继续' : '停止：' + d.reason}`,
  );
  if (!d.shouldContinue) break;
  rounds++;
  state = {
    done: state.done + 1,
    total: state.total,
    tasksLeft: Math.max(0, state.tasksLeft - 1),
  };
  elapsed += vm.unitSeconds;
}

// 交叉校验：推演到的最终价值
const finalUnits = valueOf(state.done, vm);
console.log(`\n最终：做 ${rounds} 轮，进度 ${state.done}/${state.total}`);
console.log(`  任务奖励 ${rounds * vm.unitReward} 单位 + 档位 ${tiersEarned(state.done, vm.tiers)} 单位 = ${finalUnits} 单位 = ¥${(finalUnits * cny).toFixed(2)}`);
console.log(`  耗时约 ${(rounds * vm.unitSeconds / 60).toFixed(1)} 分钟`);
