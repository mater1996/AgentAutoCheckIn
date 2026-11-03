/**
 * 流程执行器：解释配置里的 flow DSL，不关心"是哪种签到"。
 *
 * Prep 归位 → 按步骤执行 → 读余额 → 记账
 * Midscene 负责所有需要"看图"的决策；能本地判断的一律不调模型。
 */
import './model';
import { setRunContext } from './model';

import fs from 'node:fs';
import path from 'node:path';

import { eq } from 'drizzle-orm';

import { db, schema, sqlite } from '../db/client';
import { DEVICE, getStayOn, setStayOn, shell, sleep } from './adb';
import { prepFor } from './config';
import type { Step } from './config';
import { execSteps } from './flow';
import type { ExecCtx } from './flow';
import { readBalance } from './probe';
import type { ProbeDef } from './probe';
import { runTaskLoop } from './loop';
import type { TaskUnit, TaskObservation, TaskAttemptEvidence } from './loop';
import { INVENTORY_PROMPT, normalizeInventory, saveInventory } from './inventory';
import { collectInventory } from './inventory-scan';
import { assessAndPlanInventory } from './collect';
import { runWorkflowFile } from './workflow';
import { recoverPopup } from './nodes/ensure-no-popup';
import type { Objective, ValueModel } from './objective';
import { bumpCache, finishRun, recordCost, recordGain, recordRun, recordSnapshot, startRun } from './ledger';
import { injectAIContext } from './context';
import { preflight } from './preflight';
import { prep } from './prep';
import { mergeUsage, usageFromDb, usageFromMetrics } from './usage';
import { classifyRunResult } from './result';
import { loadObservedRecipe, updateObservedRecipeValidation, type ObservedRecipe } from './observed-recipe';
import { ensureTaskPanel } from './panel-state';
import { executeUnlearnedTask } from './learned-attempt';
import { buildUnknownTaskPrompt } from './task-learning';
import { readTaskObservation } from './task-observation';
import { withDeviceLock } from './device-lock';
import { recordTaskFailures } from './task-failures';


/** 新形态配置里 plan_json 的结构 */
type PlanCfg = {
  entry?: Step[];
  probes?: ProbeDef[];
  task?: { select?: string; steps: Step[]; completion_markers?: string[] };
  collect?: { when?: 'claimable' | 'always' | 'never'; probe?: string; steps: Step[] };
  settle?: { read?: string; say: string; steps?: Step[] };
  recover?: Step[];
};

export type RunActivityOpts = {
  activityId: string;
  coldStart?: boolean;
  cacheStrategy?: 'read-only' | 'read-write' | 'write-only';
  budgetMs?: number;
  dryRun?: boolean;
  /** Supervised bounded execution, never a replacement for the time budget. */
  maxTasks?: number;
  /** Allow one unlearned attempt from the normal evidence plan; disabled by default. */
  supervisedLearning?: boolean;
  /** Reconsider structurally proven opening failures for one supervised attempt. */
  revalidateOpeningFailures?: boolean;
  taskName?: string;
  currentPage?: boolean;
  /** Explicit supervised candidate test, only with exact taskName and maxTasks=1. */
  candidateYaml?: string;
};

export type RunActivityResult = {
  ok: boolean;
  status: string;
  runId: number;
  prepMs: number;
  execMs: number;
  balanceBefore: number | null;
  balanceAfter: number | null;
  delta: number | null;
  stepsDone: number;
  stepsFailed: string[];
  report: string | null;
  /** Midscene agent.metrics：本次运行的 token 与调用次数 */
  usage?: {
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalTokens?: number;
    totalCachedInput?: number;
    calls?: number;
    byIntent?: Record<string, any>;
  } | null;
  detail?: string;
  taskEvidence?: TaskAttemptEvidence[];
  taskEvidenceFile?: string;
  evidencePlanFile?: string;
  nextPlanFile?: string;
};

function reportFiles(dir = 'midscene_run/report'): Map<string, { signature: string; time: number }> {
  try {
    return new Map(fs.readdirSync(dir)
      .filter((f) => f.endsWith('.html'))
      .map((f) => {
        const file = path.join(dir, f);
        const stat = fs.statSync(file);
        return [file, { signature: `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`, time: stat.mtimeMs }] as const;
      }));
  } catch {
    return new Map();
  }
}

function newestReport(previous: ReturnType<typeof reportFiles>): string | null {
  const changed = [...reportFiles()].filter(([file, stat]) => previous.get(file)?.signature !== stat.signature);
  changed.sort((a, b) => b[1].time - a[1].time);
  return changed[0]?.[0] ?? null;
}

function dbBalance(assetId: string | null, accountId: string): number | null {
  if (!assetId) return null;
  const row = sqlite
    .prepare(
      `SELECT balance FROM asset_snapshot WHERE asset_id = ? AND account_id = ?
       ORDER BY day DESC, id DESC LIMIT 1`,
    )
    .get(assetId, accountId) as { balance: number } | undefined;
  return row ? row.balance : null;
}

/**
 * 对外入口：跑单个活动期间临时打开「插电常亮」，结束后（含异常/超时）恢复原值。
 * 为什么必须包一层：不常亮时 1 分钟就熄屏，Midscene 截到黑屏直接失败；
 * 但长期常亮会耗电并有烧屏风险，所以只在执行窗口内生效。
 */
export async function runActivity(opts: RunActivityOpts): Promise<RunActivityResult> {
  if (opts.revalidateOpeningFailures === true && (opts.supervisedLearning !== true || opts.maxTasks !== 1)) {
    throw new Error('revalidateOpeningFailures 仅允许 supervisedLearning=true 且 maxTasks=1 的单次监督复验');
  }
  if (opts.candidateYaml && (!opts.taskName || opts.maxTasks !== 1 || opts.currentPage !== true)) {
    throw new Error('候选配方仅允许指定任务、当前面板、maxTasks=1的监督验证');
  }
  return withDeviceLock(async () => {
    const prevStayOn = getStayOn();
    setStayOn(15);
    try {
      return await runActivityInner(opts);
    } finally {
      setRunContext(null);
      setStayOn(prevStayOn);
    }
  }, { serial: DEVICE });
}

async function runActivityInner(opts: RunActivityOpts): Promise<RunActivityResult> {
  const act = db.select().from(schema.activity).where(eq(schema.activity.id, opts.activityId)).get();
  if (!act) throw new Error(`activity 不存在: ${opts.activityId}（先跑 config sync）`);
  const acct = db.select().from(schema.account).where(eq(schema.account.id, act.accountId)).get();
  if (!acct) throw new Error(`account 不存在: ${act.accountId}`);

  const flow: Step[] = JSON.parse(act.stepsJson);
  const verifyAny = act.verifyAny.split(',').map((s) => s.trim()).filter(Boolean);
  const prepCfg = prepFor(acct.id);
  const prevBalance = dbBalance(act.assetId, acct.id);

  // 只有 flow 里真的包含 read 步骤才需要结算读数，否则别白调一次模型
  const needsBalance = (() => {
    const has = (steps: Step[]): boolean =>
      steps.some(
        (s) =>
          s.do === 'read' ||
          (Array.isArray(s.each) && has(s.each)) ||
          (Array.isArray(s.then) && has(s.then)) ||
          (Array.isArray(s.else) && has(s.else)),
      );
    return has(flow);
  })();

  // ---------- 1.5 执行前健康检查（不碰手机、不花钱） ----------
  // 六项：设备 / 电量 / App 存在 / 账号登录态 / 模型通道 / 识图能力 / 风控闸门
  const pf = await preflight({
    package: acct.package,
    accountId: acct.id,
    blockTextAny: prepCfg.blockTextAny,
    modelBaseUrl: process.env.MIDSCENE_MODEL_BASE_URL!,
    modelApiKey: process.env.MIDSCENE_MODEL_API_KEY!,
    modelName: process.env.MIDSCENE_MODEL_NAME!,
  });

  for (const c of pf.checks) {
    const mark = c.ok ? '✓' : c.fatal ? '✗' : '⚠';
    console.log(`  ${mark} ${c.name}: ${c.detail} (${c.ms}ms)`);
  }

  if (!pf.ok) {
    const failed = pf.checks.filter((c) => !c.ok && c.fatal);
    const runId = recordRun({
      accountId: acct.id,
      activityId: act.id,
      status: 'PREFLIGHT_FAILED',
      coldStart: false,
      prepMs: null,
      balanceBefore: prevBalance,
      error: `健康检查未通过：${failed.map((c) => `${c.name}(${c.detail})`).join(' | ')}`.slice(0, 400),
    });
    console.log(`  ⛔ 健康检查未通过（${pf.blockedBy}），未执行`);
    return {
      ok: false,
      status: 'PREFLIGHT_FAILED',
      runId,
      prepMs: 0,
      execMs: 0,
      balanceBefore: prevBalance,
      balanceAfter: null,
      delta: null,
      stepsDone: 0,
      stepsFailed: [],
      report: null,
      detail: `健康检查未通过：${pf.blockedBy}`,
    };
  }

  // ---------- 1. Prep ----------
  const p = opts.currentPage
    ? { ok: true as const, coldStart: false, ms: 0, hitText: 'current-page: verified visually before task execution' }
    : await prep({
    package: acct.package,
    entryTextAny: prepCfg.entryTextAny,
    blockTextAny: prepCfg.blockTextAny,
    coldStart: opts.coldStart ?? false,
    maxBacks: prepCfg.maxBacks,
    maxPrepMs: prepCfg.maxPrepMs,
  });
  if (!p.ok) {
    const runId = recordRun({
      accountId: acct.id,
      activityId: act.id,
      status: p.reason,
      coldStart: p.coldStart ?? false,
      prepMs: p.ms,
      balanceBefore: prevBalance, // 准备阶段失败也要留已知余额，便于判断是"没跑"还是"跑错"
      error: p.detail,
    });
    return {
      ok: false,
      status: p.reason,
      runId,
      prepMs: p.ms,
      execMs: 0,
      balanceBefore: prevBalance,
      balanceAfter: null,
      delta: null,
      stepsDone: 0,
      stepsFailed: [],
      report: null,
      detail: p.detail,
    };
  }

  // ---------- 2. 执行 ----------
  const { agentFromAdbDevice } = await import('@midscene/android');
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 1200000;
  const previousReports = reportFiles();

  const agent = await agentFromAdbDevice(DEVICE, {
    cache: { strategy: opts.cacheStrategy ?? 'read-only', id: acct.cacheId },
    replanningCycleLimit: 3,
  });

  // 注入平台经验：所有后续 AI 调用共享，指令就不用重复背景
  const ctxChars = injectAIContext(agent, acct.app);
  if (ctxChars) console.log(`  已注入 ${acct.app} 经验上下文（${ctxChars} 字）`);

  // 先建 run 拿 id：计量代理按 x-run-id 归因，执行期间就要知道 runId
  const runId = startRun({ accountId: acct.id, activityId: act.id, coldStart: p.coldStart });
  setRunContext(runId);

  const ctx: ExecCtx = {
    agent,
    runId,         // 真实 id，model_call 才能归到这一轮
    seq: 0,
    stage: 'entry',
    // Saved snapshots are history; gains require a before read from this run.
    balanceBefore: null,
    balanceAfter: null,
    stepsDone: 0,
    failed: [],
    overBudget: () => Date.now() - t0 > budget,
    log: (s) => console.log(s),
  };

  let err: string | null = null;
  let status = 'OK';
  let stopInfo = '';
  const reusedRecipes = new Map<string, { recipe: ObservedRecipe; instruction: string }>();
  const attemptedRecipes = new Set<string>();
  let requiresBalance = needsBalance;
  let verified = false;
  let taskEvidence: TaskAttemptEvidence[] = [];
  let taskEvidenceFile: string | undefined;
  let evidencePlanFile: string | undefined;
  let panelReady = true;
  let nextPlanFile: string | undefined;
  let plannedOnly = false;

  try {
    const plan: PlanCfg | null = act.planJson ? JSON.parse(act.planJson) : null;
    requiresBalance ||= Boolean(plan?.task?.steps?.length);

    if (plan?.task?.steps?.length) {
      // ===== 新形态：目标驱动（entry 由循环执行，失败可重试） =====

      const objRow = db.select().from(schema.objective).where(eq(schema.objective.activityId, act.id)).get();
      const tierRows = db.select().from(schema.tier).where(eq(schema.tier.activityId, act.id)).all();
      const objective: Objective = {
        strategy: (objRow?.strategy as any) ?? 'all_tiers',
        maxSeconds: objRow?.maxSeconds ?? 900,
        minMarginalCnyPerHour: objRow?.minMarginalCnyPerHour ?? undefined,
        fixedCount: objRow?.fixedCount ?? undefined,
      };
      const valueModel: ValueModel = {
        unitReward: objRow?.unitReward ?? 0,
        unitSeconds: objRow?.unitSeconds ?? 35,
        tiers: tierRows.map((t) => ({ at: t.at, reward: t.reward })),
      };
      // 资产单位折算
      const assetRow = act.assetId
        ? db.select().from(schema.asset).where(eq(schema.asset.id, act.assetId)).get()
        : undefined;
      const cnyPerUnit = assetRow?.cnyPerUnit ?? 0;

      console.log(
        `  目标：${objective.strategy}，上限 ${objective.maxSeconds}s，` +
          `单任务 ${valueModel.unitReward} 单位 / ${valueModel.unitSeconds}s，档位 ${valueModel.tiers.map((t) => `${t.at}→${t.reward}`).join(' ')}`,
      );

      ctx.stage = 'task';

      // ── 把计划展开成任务单元：每个任务对应一个 YAML 执行单元 ──
      // 同一任务做 5 次 = 队列里出现 5 次，但始终跑同一个 YAML（资产复用）
      const tasks: TaskUnit[] = [];
      // Collect from this live session; a saved list may already have changed today.
      if (!opts.currentPage) await execSteps(ctx, plan.entry ?? []);
      else {
        if (!(await agent.aiBoolean('当前页面是否明确显示目标活动的任务列表、每条任务配额和操作按钮？'))) {
          throw new Error('当前页面不是已确认的任务面板');
        }
        ctx.balanceBefore = await readBalance(ctx, plan.entry?.find((s) => s.do === 'read')?.say);
      }
      if (ctx.failed.length) throw new Error(`入口步骤未通过：${ctx.failed.join(' | ')}`);
      // Exact supervised selection preserves the existing visible-page query contract.
      // Normal planning requires a complete scroll inventory before selecting any tasks.
      let inventory;
      if (opts.taskName !== undefined) {
        inventory = normalizeInventory(await agent.aiQuery(INVENTORY_PROMPT), acct.id, act.id);
      } else {
        const scan = await collectInventory(agent, { account: acct.id, activity: act.id, overBudget: ctx.overBudget });
        if (!scan.ok || !scan.inventory) throw new Error(scan.detail ?? '任务清单不完整，停止执行');
        inventory = scan.inventory;
      }
      saveInventory(inventory);

      ctx.log(`  本次实时清单：${inventory.tasks.length} 项，剩余配额 ${inventory.total_remaining}`);
      if (inventory) {
        let selected: { task: string; times: number; instruction?: string }[];
        let plannedRecipes: ReturnType<typeof loadObservedRecipe>[] = [];
        if (opts.taskName !== undefined) {
          // Explicit supervised selection comes from the live row, not name heuristics.
          const matches = inventory.tasks.filter((task) => task.name === opts.taskName);
          if (matches.length !== 1) throw new Error(`当前实时清单中目标任务 ${JSON.stringify(opts.taskName)} 匹配 ${matches.length} 项，无法确认`);
          const task = matches[0];
          selected = task.remaining > 0 && !/已完成/.test(task.button)
            ? [{ task: task.name, times: task.remaining }] : [];
        } else {
          const assessed = await assessAndPlanInventory(agent, inventory, {
            runId, supervisedLearning: opts.supervisedLearning ?? false, maxTasks: opts.maxTasks,
            revalidateOpeningFailures: opts.revalidateOpeningFailures,
            cnyPerUnit: assetRow?.cnyPerUnit,
          });
          evidencePlanFile = assessed.evidencePlanFile;
          plannedRecipes = assessed.validatedRecipes;
          selected = [...assessed.plan.plan, ...assessed.plan.learning];
          if (!selected.length) {
            plannedOnly = true;
            stopInfo = `证据计划无可执行任务：${assessed.plan.skipped.map(t => `${t.task}：${t.reason}`).join('；') || '无剩余任务'}`;
            ctx.log(`  停止：${stopInfo}`);
          }
        }

        for (const item of selected) {
          const inv = inventory.tasks.find((t) => t.name === item.task && (item.instruction === undefined || t.instruction === item.instruction));
          if (!inv) continue;
          const recipe = opts.candidateYaml ? null : opts.taskName !== undefined
            ? loadObservedRecipe(acct.id, act.id, inv)
            : plannedRecipes.find(r => r?.taskName === inv.name && r.instruction === inv.instruction) ?? null;
          if (recipe) reusedRecipes.set(item.task, { recipe, instruction: inv.instruction! });
          tasks.push({
            name: item.task,
            instruction: inv.instruction,
            kind: opts.candidateYaml ? 'candidate-recipe' : recipe ? 'validated-recipe' : 'unlearned',
            times: opts.maxTasks !== undefined ? Math.min(item.times, opts.maxTasks) : item.times,
            yaml: opts.candidateYaml ?? recipe?.yaml,
            fallbackSteps: opts.candidateYaml || recipe ? undefined : [{ do: 'ai', say: buildUnknownTaskPrompt(inv) }],
          });
        }
        console.log(
          `  任务单元：${tasks.length} 个，共 ${tasks.reduce((a, t) => a + t.times, 0)} 次执行，` +
            `有 YAML ${tasks.filter((t) => t.yaml).length} 个`,
        );
      } else {
        console.log('  未找到 inventory，回退旧形态（单条 flow 重复）');
      }

      if (!plannedOnly) {
        const ensurePanel = (): Promise<boolean> => ensureTaskPanel(agent, {
          overBudget: ctx.overBudget,
          recover: async () => {
            const failures = ctx.failed.length;
            await execSteps(ctx, plan.recover ?? []);
            if (ctx.failed.length > failures) throw new Error('任务面板恢复失败');
          },
        });
        const loop = await runTaskLoop(ctx, {
          objective,
          valueModel,
          cnyPerUnit,
          probes: plan.probes ?? [],
          tasks,
          runTask: (yaml, unit, attempt) => {
            if (reusedRecipes.has(unit.name)) attemptedRecipes.add(unit.name);
            return runWorkflowFile(yaml, agent, { serial: DEVICE, screen: { w: 1080, h: 2400 }, taskAttempt: attempt });
          },
          runUnlearned: async (unit, attempt) => {
            const task = inventory.tasks.find(t => t.name === unit.name && t.instruction === unit.instruction);
            if (!task) return { ok: false, error: '通用执行缺少同次清单中的准确任务' };
            return executeUnlearnedTask(agent, { ...task, instruction: task.instruction ?? '' }, attempt, {
              completionMarkers: plan.task?.completion_markers ?? [],
              overBudget: ctx.overBudget,
              returnToPanel: async () => {
                if (ctx.overBudget()) return false;
                shell('input keyevent KEYCODE_BACK');
                await sleep(1500);
                return ensurePanel();
              },
            });
          },
          observeTask: (unit) => readTaskObservation(agent, unit),
          recoverPopup: () => recoverPopup(agent),
          ensurePanel,
          collectSteps: plan.collect?.steps,
          collectWhen: opts.maxTasks !== undefined ? 'never' : plan.collect?.when,
          collectProbe: plan.collect?.probe,
          recoverSteps: plan.recover ?? [],
          entrySteps: [], // Entry and live collection were already verified above.
          entryRetries: 1,
          t0,
          hardMax: opts.maxTasks,
        });
        taskEvidence = loop.taskEvidence ?? [];
        // Persist before refresh so the next advice and later normal runs cannot
        // explore the same failed identity again today. Explicit attempts also count.
        recordTaskFailures(acct.id, act.id, runId, taskEvidence);
        for (const ran of loop.ran ?? []) if (ran.times > 0 && reusedRecipes.has(ran.name)) attemptedRecipes.add(ran.name);
        if (/未进入任务页|探测失败|观测失败/.test(loop.stopReason)) ctx.failed.push(loop.stopReason);
        stopInfo = `做了 ${loop.rounds} 轮，停在 ${loop.finalState.done}/${loop.finalState.total}（${loop.stopReason}），领奖 ${loop.collects} 次`;
        console.log(`  ${stopInfo}`);

        panelReady = await ensurePanel();
        // Refresh after a normal planned batch. This computes advice only, never more actions.
        if (opts.taskName === undefined) {
          if (ctx.overBudget()) ctx.failed.push('状态刷新失败：本轮预算已到');
          else if (!panelReady) ctx.failed.push('状态刷新失败：任务面板未确认');
          else {
            const refreshed = await collectInventory(agent, { account: acct.id, activity: act.id, overBudget: ctx.overBudget });
            if (!refreshed.ok || !refreshed.inventory) ctx.failed.push(`状态刷新失败：${refreshed.detail ?? '清单不完整'}`);
            else {
              saveInventory(refreshed.inventory);
              const next = await assessAndPlanInventory(agent, refreshed.inventory, {
                runId, phase: 'next', supervisedLearning: opts.supervisedLearning ?? false,
                maxTasks: 1, cnyPerUnit: assetRow?.cnyPerUnit,
              });
              nextPlanFile = next.evidencePlanFile;
              ctx.log(`  状态已刷新：${refreshed.inventory.tasks.length}项，进度${refreshed.inventory.progress.done}/${refreshed.inventory.progress.total}；下一计划仅保存`);
            }
          }
        }

        // 收尾再领一次（跨档后可能有新档位可领）
        if (opts.maxTasks === undefined && !ctx.failed.length && plan.collect?.steps?.length && plan.collect.when !== 'never') {
          try {
            if (await agent.aiBoolean(plan.collect.probe ?? '页面上是否存在可点击的「立即领取」按钮')) {
              await execSteps(ctx, plan.collect.steps);
            }
          } catch {}
        }

        // 结算读数（先执行前置步骤，比如退回能看到余额的页面）
        if (panelReady && plan.settle?.say) {
          if (plan.settle.steps?.length) await execSteps(ctx, plan.settle.steps);
          ctx.balanceAfter = await readBalance(ctx, plan.settle.say);
        }
      }
    } else {
      // ===== 旧形态：一条 flow =====
      await execSteps(ctx, flow);
    }

    if (!plannedOnly && panelReady && needsBalance && ctx.balanceAfter === null) ctx.balanceAfter = await readBalance(ctx);

    if (!plannedOnly && verifyAny.length) {
      try {
        verified = await agent.aiBoolean(`当前页面是否出现以下任一状态：${verifyAny.join('、')}`);
      } catch {}
    }

  } catch (e: any) {
    err = String(e?.message ?? e).slice(0, 400);
    ctx.failed.push(err);
    try {
      if (panelReady && requiresBalance && ctx.balanceAfter === null) ctx.balanceAfter = await readBalance(ctx);
    } catch {}
  }

  // Apply the same accounting checks after normal execution and thrown errors.
  if (taskEvidence.length) {
    try {
      const dir = path.resolve('data/evidence/task-receipts');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `run-${runId}-${taskEvidence[0].attempt?.attemptId ?? Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify({ runId, accountId: acct.id, activityId: act.id, tasks: taskEvidence }, null, 2), { flag: 'wx' });
      taskEvidenceFile = file;
    } catch (error: any) {
      ctx.failed.push(`任务回执证据保存失败：${String(error?.message ?? error).slice(0, 140)}`);
    }
  }
  if (ctx.balanceAfter !== null && ctx.balanceBefore !== null && ctx.balanceAfter < ctx.balanceBefore) {
    ctx.failed.push(
      `读数不可信：before=${ctx.balanceBefore} after=${ctx.balanceAfter}，签到不可能减少余额，判为读取失败`,
    );
    ctx.balanceAfter = null;
  }
  const entryFailed = stopInfo.includes('未进入任务页') || stopInfo.includes('探测失败') || stopInfo.includes('观测失败');
  status = requiresBalance ? classifyRunResult({
    before: ctx.balanceBefore,
    after: ctx.balanceAfter,
    failures: ctx.failed,
    verified,
    entryFailed,
  }) : ctx.failed.length ? 'ERROR' : verified ? 'ALREADY' : 'NO_EFFECT';
  if (plannedOnly && !ctx.failed.length) status = 'PLANNED_ONLY';

  const balanceBefore = ctx.balanceBefore;
  const balanceAfter = ctx.balanceAfter;
  const failed = ctx.failed;
  const stepsDone = ctx.stepsDone;

  const execMs = Date.now() - t0;

  // 成本观测：① agent.metrics（最实时，但 destroy 后可能失效）
  //           ② model_call 表（计量代理写的，最可靠）
  // 报告 HTML 里没有 token 数据（实测 4.7MB 报告全是 webpack JS），所以不再解析报告。
  let usage: any = null;
  try {
    usage = usageFromMetrics((agent as any).metrics);
  } catch {}

  // metrics 必须在 destroy 之前抓，destroy 之后就读不到了
  try {
    usage = mergeUsage(usage, usageFromMetrics((agent as any).metrics));
  } catch {}

  try {
    if (status === 'OK') await agent.flushCache?.();
  } catch {}
  try {
    await agent.destroy?.();
  } catch {}
  const report = newestReport(previousReports);
  if (failed.length) {
    for (const name of attemptedRecipes) {
      const saved = reusedRecipes.get(name)!;
      try {
        updateObservedRecipeValidation(acct.id, act.id, { name, instruction: saved.instruction }, {
          taskName: name, instruction: saved.instruction, yamlHash: saved.recipe.yamlHash!,
          runId, report: report ?? '', timestamp: new Date().toISOString(),
          status: 'unknown', before: null, after: null,
        });
      } catch (error: any) {
        failed.push(`配方失效写入失败：${name}：${String(error?.message ?? error).slice(0, 140)}`);
      }
    }
  }

  const delta = balanceBefore !== null && balanceAfter !== null ? balanceAfter - balanceBefore : null;

  if (opts.dryRun) {
    return {
      ok: status === 'OK',
      status,
      runId: -1,
      prepMs: p.ms,
      execMs,
      balanceBefore,
      balanceAfter,
      delta,
      stepsDone,
      stepsFailed: failed,
      report,
      usage,
      detail: [stopInfo, err].filter(Boolean).join(' | ') || undefined,
      taskEvidence, taskEvidenceFile, evidencePlanFile, nextPlanFile,
    };
  }

  // 成本回填：model_call 表里现在有本轮的记录（因为执行期就有 runId）
  {
    const fromDb = usageFromDb(runId);
    if (fromDb) {
      usage = mergeUsage(usage, fromDb);
      console.log(`  成本：${usage?.calls ?? 0} 次调用，${usage?.totalTokens ?? 0} tokens（来自 model_call）`);
    } else if (usage) {
      console.log(`  成本：${usage.calls ?? 0} 次调用，${usage.totalTokens ?? 0} tokens（来自 agent.metrics）`);
    } else {
      console.log('  成本：无数据（metrics 与 model_call 均为空）');
    }
  }

  finishRun(runId, {
    status,
    prepMs: p.ms,
    execMs,
    balanceBefore,
    balanceAfter,
    error: [stopInfo, err, failed.join(' | ')].filter(Boolean).join(' || ').slice(0, 500) || null,
    evidenceDir: report,
    usage,
    modelName: process.env.MIDSCENE_MODEL_NAME ?? null,
  });

  if (balanceAfter !== null && act.assetId) {
    recordSnapshot({
      assetId: act.assetId,
      accountId: acct.id,
      balance: balanceAfter,
      runId,
      source: 'read',
    });
  }
  // Only the observed net movement is factual. Per-task estimates are not receipts.
  if (delta !== null && delta > 0) {
    recordGain({ runId, assetId: act.assetId, source: 'settle', units: delta,
      note: '同口径余额观测净增；任务/档位来源未单独确认' });
  }

  // ── 成本明细：按 intent 拆 ──
  try {
    const byIntent = (usage?.byIntent ?? {}) as Record<string, any>;
    for (const [kind, v] of Object.entries(byIntent)) {
      recordCost({
        runId,
        kind,
        calls: v?.calls ?? 0,
        promptTokens: v?.totalPromptTokens ?? 0,
        completionTokens: v?.totalCompletionTokens ?? 0,
        totalTokens: v?.totalTokens ?? 0,
        ms: execMs,
      });
    }
  } catch {}

  // 回填步骤归属：步骤是在建 run 之前就开始记的，用时间窗把孤儿步骤归到这个 run
  try {
    sqlite
      .prepare(
        `UPDATE run_step SET run_id = ?
          WHERE run_id = 0 AND started_at >= ? AND started_at <= ?`,
      )
      .run(runId, new Date(t0).toISOString(), new Date().toISOString());
  } catch {}

  bumpCache(acct.id, act.id, status === 'OK');

  return {
    ok: status === 'OK',
    status,
    runId,
    prepMs: p.ms,
    execMs,
    balanceBefore,
    balanceAfter,
    delta,
    stepsDone,
    stepsFailed: failed,
    report,
    usage,
    detail: [stopInfo, err].filter(Boolean).join(' | ') || undefined,
    taskEvidence, taskEvidenceFile, evidencePlanFile, nextPlanFile,
  };
}
