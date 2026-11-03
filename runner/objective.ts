/**
 * 目标与价值模型（纯函数，无 I/O、无模型调用）。
 *
 * 为什么单独成文件：终止条件是算术，不是语义判断。
 * 模型只负责探测出 {done, total, tasksLeft}，这里负责算"还值不值得做"。
 */

export type Tier = { at: number; reward: number };

export type ValueModel = {
  /** 单个任务给多少单位（金币/豆/分） */
  unitReward: number;
  /** 单个任务预计耗时（秒），用于算边际收益 */
  unitSeconds: number;
  /** 档位阶梯，at = 需要的完成进度，reward = 该档奖励 */
  tiers: Tier[];
};

export type ObjectiveStrategy = 'all_tiers' | 'first_tier' | 'fixed';

export type Objective = {
  strategy: ObjectiveStrategy;
  /** 硬时间上限（秒） */
  maxSeconds: number;
  /** 边际收益低于此值就不再继续（¥/小时），可选 */
  minMarginalCnyPerHour?: number;
  /** strategy = fixed 时的目标次数 */
  fixedCount?: number;
};

export type ProbeState = {
  /** 平台显示的已完成进度 */
  done: number;
  /** 平台显示的进度分母（奖励门槛，不代表任务配额） */
  total: number;
  /** 还剩几个「去完成」任务 */
  tasksLeft: number;
};

/** 完整的当前观测才可用于计划、停滞或跨档判断；0/0 表示未知。 */
export function isValidProbeState(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false;
  const { done, total, tasksLeft } = state as ProbeState;
  return [done, total, tasksLeft].every((n) => Number.isSafeInteger(n))
    && done >= 0 && total > 0 && done <= total && tasksLeft >= 0;
}

export type PlanDecision = {
  shouldContinue: boolean;
  /** 人能看懂的原因，直接进日志 */
  reason: string;
  /** 距离目标还差几次 */
  roundsRemaining: number;
  /** 当前进度累计可得（单位） */
  currentUnits: number;
  /** 当前进度折算（¥） */
  currentCny: number;
  /** 再做一个任务的边际收益（¥/小时） */
  marginalPerHour: number | null;
};

/** 已达成的档位奖励合计 */
export function tiersEarned(done: number, tiers: Tier[]): number {
  let sum = 0;
  for (const t of tiers) if (done >= t.at) sum += t.reward;
  return sum;
}

/**
 * 完成 done 次后的累计可得（单位）。
 * 包含任务本身奖励 + 已达档位奖励。
 */
export function valueOf(done: number, vm: ValueModel): number {
  return done * vm.unitReward + tiersEarned(done, vm.tiers);
}

/**
 * 再往前走一步的边际收益，单位 ¥/小时。
 * 跨档那一步会包含档位奖励，所以数值会突然变高——这正是要的效果。
 */
export function marginalPerHour(done: number, vm: ValueModel, cnyPerUnit: number): number | null {
  if (vm.unitSeconds <= 0) return null;
  const gain = valueOf(done + 1, vm) - valueOf(done, vm);
  return (gain * cnyPerUnit) / vm.unitSeconds * 3600;
}

/**
 * 核心决策：给定当前状态，判断是否继续。
 * 全部本地计算，0 模型调用。
 */
export function computePlan(
  state: ProbeState,
  obj: Objective,
  vm: ValueModel,
  cnyPerUnit: number,
  elapsedSeconds: number,
): PlanDecision {
  if (!isValidProbeState(state)) {
    return {
      shouldContinue: false,
      reason: '观测无效：无法确认当前进度与剩余任务，暂停依赖动作',
      roundsRemaining: 0,
      currentUnits: 0,
      currentCny: 0,
      marginalPerHour: null,
    };
  }
  const { done, total, tasksLeft } = state;
  const currentUnits = valueOf(done, vm);
  const currentCny = currentUnits * cnyPerUnit;
  const marg = marginalPerHour(done, vm, cnyPerUnit);

  const decide = (shouldContinue: boolean, reason: string, remaining: number): PlanDecision => ({
    shouldContinue,
    reason,
    roundsRemaining: Math.max(0, remaining),
    currentUnits,
    currentCny,
    marginalPerHour: marg,
  });

  // ── 终止条件，按优先级 ──
  if (tasksLeft === 0) return decide(false, `已无剩余任务（进度 ${done}/${total}）`, 0);
  if (elapsedSeconds > obj.maxSeconds) {
    return decide(false, `已超时间上限 ${obj.maxSeconds}s`, 0);
  }

  if (obj.strategy === 'first_tier') {
    const first = vm.tiers[0]?.at ?? 0;
    if (done >= first) return decide(false, `首档已达成（${done}/${first}）`, 0);
  }

  if (obj.strategy === 'fixed') {
    const target = obj.fixedCount ?? 0;
    if (done >= target) return decide(false, `已达到目标次数 ${target}`, 0);
  }

  // 边际阈值只在"已超过所有档位"时作为筛选，
  // 否则会误杀跨档前那一步（跨档的收益还没兑现就停了）。
  const allTiersDone = vm.tiers.every((t) => done >= t.at);
  if (obj.minMarginalCnyPerHour != null && marg != null && allTiersDone && marg < obj.minMarginalCnyPerHour) {
    return decide(false, `边际收益 ${marg.toFixed(1)} ¥/h 低于阈值 ${obj.minMarginalCnyPerHour} ¥/h`, 0);
  }

  // 进度分母可能只是奖励门槛，剩余配额必须来自当前任务读数。
  let remaining = tasksLeft;
  if (obj.strategy === 'fixed') remaining = Math.min(remaining, (obj.fixedCount ?? 0) - done);
  const timeCap = vm.unitSeconds > 0
    ? Math.floor((obj.maxSeconds - elapsedSeconds) / vm.unitSeconds)
    : remaining;
  remaining = Math.max(0, Math.min(remaining, timeCap));

  if (remaining <= 0) return decide(false, '剩余时间不足一个任务', 0);

  return decide(
    true,
    `继续：还需 ${remaining} 次，${total > 0 ? `${done}/${total}` : '进度未知'}，边际 ${marg?.toFixed(1) ?? '?'} ¥/h`,
    remaining,
  );
}

/** 解析 "3/20" 形式的进度 */
export function parseFraction(s: unknown): { done: number; total: number } | null {
  const m = String(s).match(/(?<![\d.+\-/])\d+\s*\/\s*\d+(?![\d.\/])/);
  if (!m) return null;
  const [done, total] = m[0].split('/').map(Number);
  return isValidProbeState({ done, total, tasksLeft: 0 }) ? { done, total } : null;
}

/** 解析纯整数 */
export function parseIntStrict(s: unknown): number | null {
  const m = String(s).replace(/,/g, '').match(/^\s*(-?\d+)\s*$/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isSafeInteger(n) ? n : null;
}