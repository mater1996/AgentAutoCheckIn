/**
 * 步骤解释器 + 探测 + 任务循环。
 *
 * 从 signin.ts 抽出来的原因：旧的 flow 形态和目标驱动的新形态要共用同一套步骤执行，
 * 不能有两份实现（否则改一处漏一处）。
 */
import { DEVICE, hasAnyText, shell, sleep } from './adb';
import type { Step } from './config';
import { computePlan, parseFraction, parseIntStrict } from './objective';
import { stepBegin } from './step';
import type { Objective, PlanDecision, ProbeState, ValueModel } from './objective';

const W = 1080;
const H = 2400;

export type ExecCtx = {
  agent: any;
  /** 有 runId 时记录步骤级明细 */
  runId?: number | null;
  seq: number;
  stage: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
  stepsDone: number;
  failed: string[];
  overBudget: () => boolean;
  log: (s: string) => void;
};

function safeJson(v: unknown): any | null {
  const txt = String(v ?? '');
  const a = txt.indexOf('{');
  const b = txt.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(txt.slice(a, b + 1));
  } catch {
    return null;
  }
}

function parseNumber(s: unknown): number | null {
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export async function readBalance(ctx: ExecCtx, prompt?: string): Promise<number | null> {
  try {
    const n = await ctx.agent.aiNumber(
      prompt || '当前页面显示的这类虚拟资产（金币/积分/豆）的余额总数是多少？只回复数字',
    );
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  } catch {}
  try {
    return parseNumber(await ctx.agent.aiQuery(prompt || '当前页面显示的资产余额是多少？'));
  } catch {
    return null;
  }
}

export async function execStep(ctx: ExecCtx, step: Step, depth = 0): Promise<void> {
  const label = step.do === 'ai' ? `ai: ${step.say?.slice(0, 30)}` : step.do;
  if (ctx.overBudget()) throw new Error('超预算');

  // 步骤级计时：有 runId 才记（收集阶段没有）
  const endStep = ctx.runId
    ? stepBegin({
        runId: ctx.runId,
        seq: ++ctx.seq,
        stage: ctx.stage,
        action: step.do,
        detail: step.say?.slice(0, 60),
      })
    : null;
  const finish = (ok = true, err?: string) => {
    try { endStep?.(ok, undefined, undefined, err); } catch {}
  };
  try {
    await execStepInner(ctx, step, depth, finish);
  } catch (e: any) {
    finish(false, String(e?.message ?? e).slice(0, 120));
    throw e;
  }
}

async function execStepInner(
  ctx: ExecCtx,
  step: Step,
  depth: number,
  finish: (ok?: boolean, err?: string) => void,
): Promise<void> {
  const label = step.do === 'ai' ? `ai: ${step.say?.slice(0, 30)}` : step.do;

  switch (step.do) {
    case 'ai': {
      try {
        await ctx.agent.ai(step.say!);
        ctx.stepsDone++;
      } catch (e: any) {
        ctx.failed.push(`${label} → ${String(e?.message ?? e).slice(0, 140)}`);
      }
      if (step.wait) await sleep(step.wait * 1000);
      finish();
      return;
    }
    case 'read': {
      const v = await readBalance(ctx, step.say);
      if (step.as === 'after') ctx.balanceAfter = v;
      else ctx.balanceBefore = v ?? ctx.balanceBefore;
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'dwell': {
      await sleep((step.seconds ?? 10) * 1000);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'back': {
      shell('input keyevent KEYCODE_BACK');
      await sleep((step.wait ?? 2) * 1000);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'swipe': {
      const n = step.times ?? 1;
      for (let i = 0; i < n; i++) {
        const from = step.direction === 'down' ? 800 : 1800;
        const to = step.direction === 'down' ? 1800 : 800;
        shell(`input swipe ${W / 2} ${from} ${W / 2} ${to} 400`);
        await sleep(1200);
      }
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'tap_text': {
      const nodes = (await import('./adb')).screenNodes();
      const t = nodes.find((x) => x.text.includes(step.text!));
      if (t) {
        shell(`input tap ${t.cx} ${t.cy}`);
        ctx.log(`  ↳ 本地点击「${step.text}」(${t.cx},${t.cy}) → 0 调用`);
        if (step.wait) await sleep(step.wait * 1000);
      } else if (!step.optional) {
        ctx.failed.push(`tap_text 未找到「${step.text}」`);
      }
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'assert_text': {
      const want = step.any ?? [];
      const texts = (await import('./adb')).screenTexts();
      const hit = want.find((w) => texts.includes(w));
      if (!hit) {
        throw new Error(`页面断言失败：屏幕上找不到「${want.join(' / ')}」（当前页面可能不对）`);
      }
      ctx.log(`  ↳ 断言通过：「${hit}」`);
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'wait_for': {
      const deadline = Date.now() + (step.timeout_ms ?? 20000);
      while (Date.now() < deadline) {
        if (hasAnyText([step.text ?? step.say ?? ''])) {
          ctx.stepsDone++;
          return;
        }
        await sleep(1000);
      }
      ctx.failed.push(`wait_for 超时：${step.text ?? step.say}`);
      finish(false, 'wait_for 超时');
      return;
    }
    case 'repeat': {
      const max = step.max ?? 1;
      for (let i = 0; i < max; i++) {
        if (ctx.overBudget() || depth > 2) break;
        if (step.stop_when) {
          try {
            if (await ctx.agent.aiBoolean(step.stop_when)) break;
          } catch {}
        }
        for (const s of step.each ?? []) await execStep(ctx, s, depth + 1);
      }
      ctx.stepsDone++;
      finish();
      return;
    }
    case 'if': {
      let cond = false;
      let how = 'text';
      if (step.cond_text?.length) {
        cond = hasAnyText(step.cond_text) !== null;
      } else if (step.cond_ai) {
        how = 'ai';
        try {
          cond = await ctx.agent.aiBoolean(step.cond_ai);
        } catch {
          cond = false;
        }
      }
      const branch = cond ? step.then : step.else;
      ctx.log(`  ↳ if(${how}) = ${cond ? '真' : '假'}，执行 ${cond ? 'then' : 'else'} 分支 ${branch?.length ?? 0} 步`);
      for (const s of branch ?? []) await execStep(ctx, s, depth + 1);
      ctx.stepsDone++;
      finish();
      return;
    }
    default:
      ctx.failed.push(`未知步骤类型 ${(step as any).do}`);
  }
}

export async function execSteps(ctx: ExecCtx, steps: Step[]): Promise<void> {
  for (const s of steps) {
    if (ctx.overBudget()) {
      ctx.failed.push('超预算，跳过剩余步骤');
      break;
    }
    await execStep(ctx, s);
  }
}

// ────────────────────────────────────────────────
// 探测：返回结构化数字，不是是非
// ────────────────────────────────────────────────

export type ProbeDef = { id: string; ask: string; parse?: 'fraction' | 'int' | 'boolean' | 'json' };

export type ProbeResult = {
  state: ProbeState;
  raw: Record<string, unknown>;
  failed: string[];
};

export async function runProbes(ctx: ExecCtx, defs: ProbeDef[]): Promise<ProbeResult> {
  const raw: Record<string, unknown> = {};
  const failed: string[] = [];
  let done = 0;
  let total = 0;
  let tasksLeft = -1;

  for (const d of defs) {
    let v: unknown = null;
    try {
      if (d.parse === 'boolean') {
        v = await ctx.agent.aiBoolean(d.ask);
      } else if (d.parse === 'json') {
        v = await ctx.agent.aiQuery(d.ask);
      } else if (d.parse === 'fraction') {
        // 必须走 aiQuery：aiNumber 会把 "6/20" 算成 0.3 小数，丢失 a/b 结构
        v = await ctx.agent.aiQuery(d.ask);
      } else {
        v = await ctx.agent.aiNumber(d.ask);
      }
    } catch (e: any) {
      try {
        v = await ctx.agent.aiQuery(d.ask);
      } catch {
        failed.push(`probe ${d.id} 失败: ${String(e?.message ?? e).slice(0, 80)}`);
      }
    }
    raw[d.id] = v;

    if (d.parse === 'json') {
      // 一次调用同时拿进度与剩余任务数，避免两次探测口径不一致
      const obj = typeof v === 'object' && v !== null ? (v as any) : safeJson(v);
      if (!obj) {
        failed.push(`probe ${d.id} 返回的不是 JSON：${String(v).slice(0, 80)}`);
      } else {
        const f = parseFraction(obj.progress);
        if (f) {
          done = f.done;
          total = f.total;
        } else failed.push(`probe ${d.id} progress 无法解析：${JSON.stringify(obj.progress)}`);
        const tl = typeof obj.tasks_left === 'number' ? obj.tasks_left : parseIntStrict(obj.tasks_left);
        if (tl !== null) tasksLeft = tl;
        else failed.push(`probe ${d.id} tasks_left 无法解析：${JSON.stringify(obj.tasks_left)}`);
      }
    } else if (d.parse === 'fraction') {
      const f = parseFraction(v);
      if (f) {
        done = f.done;
        total = f.total;
      } else {
        // 兜底：模型回了 0~1 的小数（如 0.35 = 7/20），用已知 total 换算
        const num = typeof v === 'number' ? v : parseNumber(v);
        if (num !== null && num > 0 && num <= 1 && total > 0) {
          done = Math.round(num * total);
        } else {
          failed.push(`probe ${d.id} 无法解析成 a/b：${JSON.stringify(v)}`);
        }
      }
    } else if (d.parse === 'int') {
      const n = typeof v === 'number' ? v : parseIntStrict(v);
      if (n !== null) tasksLeft = n;
      else failed.push(`probe ${d.id} 无法解析成整数：${JSON.stringify(v)}`);
    }
  }

  // 兜底：没定义 tasks_left 的探测，用 total-done 推
  if (tasksLeft < 0 && total > 0) tasksLeft = Math.max(0, total - done);

  return { state: { done, total, tasksLeft }, raw, failed };
}

// ────────────────────────────────────────────────
// 任务循环：目标驱动的核心
// ────────────────────────────────────────────────

export type TaskLoopOpts = {
  objective: Objective;
  valueModel: ValueModel;
  cnyPerUnit: number;
  probes: ProbeDef[];
  taskSteps: Step[];
  collectSteps?: Step[];
  collectWhen?: 'claimable' | 'always' | 'never';
  collectProbe?: string;
  /** 首次探测拿不到有效状态时的补救步骤 */
  recoverSteps?: Step[];
  /** 进入任务页的步骤（由循环自己执行，失败可重试） */
  entrySteps?: Step[];
  /** entry 失败后最多重试几次（每次先退到首页） */
  entryRetries?: number;
  /** 整个活动的墙钟起点（含 entry 耗时） */
  t0: number;
  /** 单轮最大循环次数，防止 tasksLeft 探测失灵时无限跑 */
  hardMax?: number;
};

export type TaskLoopResult = {
  rounds: number;
  finalState: ProbeState;
  stopReason: string;
  /** 每轮探测到的进度，便于事后核对 */
  history: { round: number; done: number; total: number; tasksLeft: number; reason: string }[];
  collects: number;
};

export async function runTaskLoop(ctx: ExecCtx, opts: TaskLoopOpts): Promise<TaskLoopResult> {
  const { objective, valueModel, cnyPerUnit, probes } = opts;
  const history: TaskLoopResult['history'] = [];
  const hardMax = opts.hardMax ?? 40;

  // ── 进入任务页：失败可重试，每次先退到首页 ──
  const retries = opts.entryRetries ?? 1;
  let state: ProbeState = { done: 0, total: 0, tasksLeft: 0 };
  let probe: ProbeResult = { state, raw: {}, failed: [] };

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      ctx.log(`  入口重试 ${attempt}/${retries}：先退回首页`);
      for (let i = 0; i < 4; i++) {
        shell('input keyevent KEYCODE_BACK');
        await sleep(1200);
      }
    }
    if (opts.entrySteps?.length) await execSteps(ctx, opts.entrySteps);

    probe = await runProbes(ctx, probes);
    ctx.failed.push(...probe.failed);
    state = probe.state;

    // 探测拿不到有效进度 → 补救一次再探
    if (state.total === 0 && opts.recoverSteps?.length) {
      ctx.log('  探测无有效进度，执行补救步骤');
      await execSteps(ctx, opts.recoverSteps);
      probe = await runProbes(ctx, probes);
      ctx.failed.push(...probe.failed);
      state = probe.state;
    }

    ctx.log(`  探测：进度 ${state.done}/${state.total}，剩余任务 ${state.tasksLeft}`);
    if (state.total > 0) break;
  }

  if (state.total === 0) {
    return {
      rounds: 0,
      finalState: state,
      stopReason: '探测失败：重试后仍拿不到完成进度（未进入任务页）',
      history: [],
      collects: 0,
    };
  }

  let rounds = 0;
  let collects = 0;
  let stopReason = '';
  let stall = 0;
  let stallReason = '';

  // 进任务页时若有可领档位，先领一次
  if (opts.collectSteps?.length && opts.collectWhen !== 'never') {
    const should = await shouldCollect(ctx, opts);
    if (should) {
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

    const before = state;
    rounds++;
    ctx.log(`  ── 第 ${rounds} 轮（${before.done}/${before.total}，剩 ${before.tasksLeft}，预计还能做 ${plan.roundsRemaining}）`);

    await execSteps(ctx, opts.taskSteps);

    probe = await runProbes(ctx, probes);
    ctx.failed.push(...probe.failed);
    state = probe.state;

    // 探测不到任务页（total=0）→ 先补救一次，别把它算成"任务没进展"
    if (state.total === 0 && opts.recoverSteps?.length) {
      ctx.log('  探测不到任务页，执行补救');
      await execSteps(ctx, opts.recoverSteps);
      probe = await runProbes(ctx, probes);
      ctx.failed.push(...probe.failed);
      state = probe.state;
    }

    history.push({ round: rounds, ...state, reason: plan.reason });

    // 防呆 1：连续两轮既没减少任务、也没涨进度 → 才判定卡死
    // 单轮不动是常态（探测抖动、任务要停留才结算），直接退出会白白丢掉收益
    if (state.tasksLeft >= before.tasksLeft && state.done <= before.done) {
      stall++;
      ctx.log(`  本轮无进展（连续 ${stall} 轮）`);
      if (stall >= 3) {
        stallReason = `连续 ${stall} 轮无进展：剩余任务 ${before.tasksLeft}→${state.tasksLeft}，进度 ${before.done}→${state.done}`;
        break;
      }
    } else {
      stall = 0;
    }

    // 跨档则领奖
    if (opts.collectSteps?.length && opts.collectWhen !== 'never' && crossedTier(before, state, valueModel)) {
      const should = await shouldCollect(ctx, opts);
      if (should) {
        await execSteps(ctx, opts.collectSteps);
        collects++;
      }
    }
  }

  if (stallReason) stopReason = stallReason;
  if (rounds >= hardMax) stopReason = `达到硬上限 ${hardMax} 轮`;

  return { rounds, finalState: state, stopReason, history, collects };
}

function crossedTier(before: ProbeState, after: ProbeState, vm: ValueModel): boolean {
  return vm.tiers.some((t) => before.done < t.at && after.done >= t.at);
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