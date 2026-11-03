/**
 * 任务循环：目标驱动的核心骨架。
 *
 * 结构（每轮）：
 *   ① computePlan 本地算要不要继续（0 调用）
 *   ② 从计划里取下一个任务单元 → 跑它的 YAML
 *   ③ runProbes 探测进度
 *   ④ 停滞判定 / 跨档领奖
 *
 * 和旧版唯一的区别：② 从「执行一段写死的 flow」改成「跑一个 YAML 执行单元」。
 * 这样每个任务的做法是资产（可 review、可复用、可被 agent 改写），
 * 而不是埋在配置里的一段步骤数组。
 */
import { shell, sleep } from './adb';
import { execSteps } from './flow';
import type { ExecCtx } from './flow';
import { runProbes } from './probe';
import type { ProbeDef, ProbeResult } from './probe';
import { computePlan, isValidProbeState } from './objective';
import { observeTaskChange, type TaskCounter } from './task-evidence';
import type { Objective, ProbeState, ValueModel } from './objective';
import { createTaskAttempt, isValidTaskReceipt, type TaskAttempt } from './task-receipt';
import type { WorkflowResult } from './workflow';

/** Explicit absence on a verified panel is distinct from a failed/unknown read. */
export type TaskObservation = TaskCounter | { name: string; absent: true; pageIsTaskPanel: true; scope?: 'visible' } | null;
export type TaskWorkflowResult = Pick<WorkflowResult, 'ok' | 'error' | 'taskReceipt' | 'taskEvidence'> & { ms?: number };
export type TaskAttemptEvidence = {
  round: number; attempt: TaskAttempt; before: TaskObservation; after: TaskObservation;
  workflow?: TaskWorkflowResult; verification: 'quota' | 'receipt' | 'no_effect' | 'unknown';
};

function taskCounter(value: TaskObservation, name: string): TaskCounter | null {
  return value && !('absent' in value) && value.name === name ? value : null;
}

export type TaskUnit = {
  /** 任务名，和 inventory 里的名字一致 */
  name: string;
  /** Exact instruction observed alongside this task in the live inventory. */
  instruction?: string;
  kind: string;
  /** 计划里要做几次 */
  times: number;
  /** 该任务的 YAML 执行单元路径；为空表示还没学 */
  yaml?: string;
  /** YAML 缺失时的兜底步骤（可选） */
  fallbackSteps?: any[];
};

export type TaskLoopOpts = {
  objective: Objective;
  valueModel: ValueModel;
  cnyPerUnit: number;
  probes: ProbeDef[];
  /** 任务单元清单（按计划顺序），循环按序消费 */
  tasks: TaskUnit[];
  /** 跑一个任务 YAML 的执行器（由 workflow.ts 提供） */
  runTask: (yaml: string, unit: TaskUnit, attempt: TaskAttempt) => Promise<TaskWorkflowResult>;
  /** 未学任务分阶段执行并在返回前保存完成回执；优先于旧兜底步骤。 */
  runUnlearned?: (unit: TaskUnit, attempt: TaskAttempt) => Promise<TaskWorkflowResult>;
  /** Independent per-task counters; a saturated reward progress cannot verify a task. */
  observeTask?: (task: TaskUnit) => Promise<TaskObservation>;
  /** 异常路径的弹窗恢复：任务失败或连续无进展时才调，正常路径不花这个钱 */
  recoverPopup?: () => Promise<{ tried: boolean; closed: boolean; detail: string }>;
  /**
   * 每轮任务前确保停在任务面板。
   *
   * 为什么需要：任务 YAML 结尾会按一次 back 回面板，但如果这个任务
   * 点开后没进详情页（比如浏览类停留后直接返回），back 会把面板整片关掉，
   * 回到双11游戏页 → 下一轮探测读到 0/0（run #29 就是这么挂的）。
   * 与其在 YAML 里猜 back 次数，不如每轮开头把面板状态重置成已知。
   */
  ensurePanel?: () => Promise<boolean>;
  collectSteps?: any[];
  collectWhen?: 'claimable' | 'always' | 'never';
  collectProbe?: string;
  recoverSteps?: any[];
  entrySteps?: any[];
  entryRetries?: number;
  t0: number;
  hardMax?: number;
};

export type TaskLoopResult = {
  rounds: number;
  finalState: ProbeState;
  stopReason: string;
  history: { round: number; done: number; total: number; tasksLeft: number; reason: string; task?: string }[];
  collects: number;
  /** 每个任务实际跑了几次 */
  ran: { name: string; times: number; ok: number; fail: number }[];
  /** 没有 YAML、被跳过的任务 */
  missing: string[];
  taskEvidence: TaskAttemptEvidence[];
};

export async function runTaskLoop(ctx: ExecCtx, opts: TaskLoopOpts): Promise<TaskLoopResult> {
  const { objective, valueModel, cnyPerUnit, probes } = opts;
  const history: TaskLoopResult['history'] = [];
  const hardMax = opts.hardMax ?? 40;
  const ranMap = new Map<string, { times: number; ok: number; fail: number }>();
  const missing: string[] = [];
  const taskEvidence: TaskAttemptEvidence[] = [];

  const panelReady = async (): Promise<boolean> => {
    if (!opts.ensurePanel) return true;
    try {
      return await opts.ensurePanel();
    } catch (e: any) {
      ctx.failed.push(`任务面板检查失败：${String(e?.message ?? e).slice(0, 140)}`);
      return false;
    }
  };
  const readCurrent = async (): Promise<ProbeResult> => {
    let current = await runProbes(ctx, probes);
    ctx.failed.push(...current.failed);
    if (!isValidProbeState(current.state) && opts.recoverSteps?.length) {
      ctx.log('  观测无效，执行一次补救后重新探测');
      try {
        await execSteps(ctx, opts.recoverSteps);
      } catch (e: any) {
        ctx.failed.push(`观测恢复失败：${String(e?.message ?? e).slice(0, 140)}`);
        return current;
      }
      current = await runProbes(ctx, probes);
      ctx.failed.push(...current.failed);
    }
    return current;
  };

  // ── 进入任务页：失败可重试，每次先退到首页 ──
  const retries = opts.entryRetries ?? 1;
  let state: ProbeState = { done: 0, total: 0, tasksLeft: -1 };
  let probe: ProbeResult = { state, raw: {}, failed: [] };
  let entryFailure = '观测失败：有限重试后仍拿不到有效进度与剩余任务';

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      ctx.log(`  入口重试 ${attempt}/${retries}：先退回首页`);
      for (let i = 0; i < 4; i++) {
        shell('input keyevent KEYCODE_BACK');
        await sleep(1200);
      }
    }
    if (opts.entrySteps?.length) await execSteps(ctx, opts.entrySteps);
    if (!await panelReady()) {
      entryFailure = '观测失败：任务面板未就绪，停止任务与领奖';
      break;
    }

    probe = await readCurrent();
    state = probe.state;

    ctx.log(`  探测：进度 ${state.done}/${state.total}，剩余任务 ${state.tasksLeft}`);
    if (isValidProbeState(state)) break;
  }

  if (!isValidProbeState(state)) {
    return {
      rounds: 0,
      finalState: state,
      stopReason: entryFailure,
      history: [],
      collects: 0,
      ran: [],
      missing,
      taskEvidence,
    };
  }

  // ── 任务队列：按计划展开成待跑清单 ──
  // 同一任务做 5 次 = 队列里出现 5 次，但每次跑的是同一个 YAML（资产复用）
  const queue: TaskUnit[] = [];
  for (const t of opts.tasks) {
    for (let i = 0; i < t.times; i++) queue.push(t);
    if (!t.yaml && !opts.runUnlearned && !t.fallbackSteps?.length) missing.push(t.name);
  }
  ctx.log(`  任务队列：${queue.length} 次执行，涉及 ${opts.tasks.length} 个任务`);

  let rounds = 0;
  let collects = 0;
  let stopReason = '';
  let stall = 0;
  let stallReason = '';

  if (opts.collectSteps?.length && opts.collectWhen !== 'never') {
    if (await shouldCollect(ctx, opts)) {
      await execSteps(ctx, opts.collectSteps);
      collects++;
    }
  }

  while (rounds < hardMax) {
    const elapsed = (Date.now() - opts.t0) / 1000;
    const plan = computePlan(state, objective, valueModel, cnyPerUnit, elapsed);

    if (!plan.shouldContinue) {
      stopReason = plan.reason;
      ctx.log(`  停止：${plan.reason}`);
      break;
    }

    // 队列跑完 → 检查是否还有未达成的档位
    if (rounds >= queue.length) {
      stopReason = `计划内 ${queue.length} 次任务已跑完（进度 ${state.done}/${state.total}）`;
      ctx.log(`  停止：${stopReason}`);
      break;
    }

    const unit = queue[rounds];
    const before = state;
    // YAML 与兜底步骤都必须满足面板前提，失败不消费队列或执行次数。
    if (!await panelReady()) {
      state = { done: 0, total: 0, tasksLeft: -1 };
      stopReason = '观测失败：任务面板未就绪，停止任务与领奖';
      break;
    }
    const counterBefore = opts.observeTask ? await opts.observeTask(unit) : null;
    const selectedBefore = taskCounter(counterBefore, unit.name);
    if (opts.observeTask && observeTaskChange(selectedBefore, selectedBefore).status === 'unknown') {
      stopReason = '观测失败：无法确认当前目标任务配额，未执行';
      ctx.failed.push(stopReason);
      break;
    }
    rounds++;
    const attempt = createTaskAttempt({ name: unit.name, instruction: unit.instruction ?? '' });
    const evidence: TaskAttemptEvidence = { round: rounds, attempt, before: counterBefore, after: null, verification: 'unknown' };
    taskEvidence.push(evidence);

    // ── 跑这个任务的 YAML 执行单元 ──
    let ok = false;
    let err = '';
    if (unit.yaml) {
      ctx.log(`  ── 第 ${rounds}/${queue.length} 轮：${unit.name}（${unit.kind}）`);
      const r = await opts.runTask(unit.yaml, unit, attempt);
      evidence.workflow = r;
      ok = r.ok;
      err = r.error ?? '';
      if (!ok) ctx.failed.push(`${unit.name} → ${err.slice(0, 140)}`);
    } else if (opts.runUnlearned) {
      ctx.log(`  ── 第 ${rounds}/${queue.length} 轮：${unit.name}（未学任务，分阶段取证）`);
      let r: TaskWorkflowResult;
      try { r = await opts.runUnlearned(unit, attempt); }
      catch (error: any) { r = { ok: false, error: String(error?.message ?? error) }; }
      evidence.workflow = r;
      ok = r.ok;
      err = r.error ?? '';
      if (ok) ctx.stepsDone++;
      else ctx.failed.push(`${unit.name} → ${err.slice(0, 140)}`);
    } else if (unit.fallbackSteps?.length) {
      ctx.log(`  ── 第 ${rounds}/${queue.length} 轮：${unit.name}（无 YAML，走兜底步骤）`);
      await execSteps(ctx, unit.fallbackSteps);
      ok = true;
    } else {
      ctx.log(`  ── 第 ${rounds}/${queue.length} 轮：${unit.name} 无 YAML，跳过`);
    }

    const rec = ranMap.get(unit.name) ?? { times: 0, ok: 0, fail: 0 };
    rec.times++;
    if (ok) rec.ok++;
    else rec.fail++;
    ranMap.set(unit.name, rec);
    const workflowFailure = !ok ? `任务执行失败：${unit.name} → ${err || '执行器未确认成功'}` : '';

    // ── 探测 ──
    if (opts.observeTask && !await panelReady()) {
      stopReason = workflowFailure || '观测失败：无法确认任务返回面板';
      ctx.failed.push(stopReason);
      if (ok) { rec.ok--; rec.fail++; }
      break;
    }
    probe = await readCurrent();
    state = probe.state;
    if (!isValidProbeState(state)) {
      stopReason = workflowFailure || '观测失败：任务后有限恢复仍无法确认进度与剩余任务';
      history.push({ round: rounds, ...state, reason: stopReason, task: unit.name });
      break;
    }

    let independentProgress = false;
    if (opts.observeTask) {
      const counterAfter = await opts.observeTask(unit);
      evidence.after = counterAfter;
      const change = observeTaskChange(selectedBefore, taskCounter(counterAfter, unit.name));
      // Receipt only fills the explicit-disappearance gap. A visible unchanged or
      // conflicting quota is authoritative and cannot be overridden by a receipt.
      const disappeared = counterAfter && 'absent' in counterAfter && counterAfter.absent === true
        && counterAfter.pageIsTaskPanel === true && counterAfter.name === unit.name;
      const receiptProgress = !!disappeared && ok && isValidTaskReceipt(evidence.workflow?.taskReceipt, attempt);
      independentProgress = change.status === 'completed' || receiptProgress;
      evidence.verification = change.status === 'completed' ? 'quota' : receiptProgress ? 'receipt' : change.status;
      if (!independentProgress) {
        stopReason = workflowFailure || (change.status === 'unknown'
          ? '观测失败：任务后无法确认同一任务的配额'
          : '任务无效果：同一任务配额未增长');
        ctx.failed.push(`${unit.name} → ${stopReason}`);
        const recorded = ranMap.get(unit.name)!;
        if (ok) { recorded.ok--; recorded.fail++; }
        break;
      }
    }
    history.push({ round: rounds, ...state, reason: workflowFailure || plan.reason, task: unit.name });
    // Quota growth is partial progress, never permission to hide execution errors.
    if (workflowFailure) {
      stopReason = workflowFailure;
      break;
    }

    // ── 防呆：连续 3 轮既没减少任务、也没涨进度才判定卡死 ──
    if (!independentProgress && state.tasksLeft >= before.tasksLeft && state.done <= before.done) {
      stall++;
      ctx.log(`  本轮无进展（连续 ${stall} 轮）`);

      // 第一次无进展就先怀疑弹窗：异常路径才花这一次钱
      if (stall === 1 && opts.recoverPopup) {
        const rec = await opts.recoverPopup();
        if (rec.tried) ctx.log(`  弹窗恢复：${rec.detail}`);
        if (rec.closed) {
          probe = await readCurrent();
          state = probe.state;
          if (!isValidProbeState(state)) {
            stopReason = '观测失败：弹窗恢复后仍无法确认进度与剩余任务';
            history[history.length - 1] = { round: rounds, ...state, reason: stopReason, task: unit.name };
            break;
          }
          if (state.done > before.done || state.tasksLeft < before.tasksLeft) {
            stall = 0;
            ctx.log(`  恢复后进度变化：${state.done}/${state.total}`);
          }
        }
      }

      if (stall >= 3) {
        stallReason = `连续 ${stall} 轮无进展：剩余任务 ${before.tasksLeft}→${state.tasksLeft}，进度 ${before.done}→${state.done}`;
        break;
      }
    } else {
      stall = 0;
    }

    // ── 跨档领奖 ──
    if (opts.collectSteps?.length && opts.collectWhen !== 'never' && crossedTier(before, state, valueModel)) {
      if (await shouldCollect(ctx, opts)) {
        await execSteps(ctx, opts.collectSteps);
        collects++;
      }
    }
  }

  if (stallReason) stopReason = stallReason;
  if (!stopReason && rounds >= hardMax) stopReason = `达到硬上限 ${hardMax} 轮`;

  const ran = [...ranMap.entries()].map(([name, v]) => ({ name, ...v }));
  return { rounds, finalState: state, stopReason, history, collects, ran, missing, taskEvidence };
}

export function crossedTier(before: ProbeState, after: ProbeState, vm: ValueModel): boolean {
  return isValidProbeState(before) && isValidProbeState(after)
    && vm.tiers.some((t) => before.done < t.at && after.done >= t.at);
}

async function shouldCollect(ctx: ExecCtx, opts: TaskLoopOpts): Promise<boolean> {
  if (opts.collectWhen === 'never') return false;
  if (opts.collectWhen === 'always' || !opts.collectProbe) return true;
  try {
    return await ctx.agent.aiBoolean(opts.collectProbe);
  } catch {
    return false;
  }
}