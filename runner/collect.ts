/** Collect and assess a complete inventory without executing tasks. */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';

import './model';
import { db, schema } from '../db/client';
import { DEVICE, getStayOn, setStayOn } from './adb';
import { withDeviceLock } from './device-lock';
import { injectAIContext } from './context';
import { execSteps } from './flow';
import { prepFor } from './config';
import { saveInventory } from './inventory';
import { collectInventory } from './inventory-scan';
import type { Inventory } from './inventory';
import { buildAssessmentPrompt, computeEvidencePlan } from './planner';
import type { CandidateAssessment, EvidencePlan } from './planner';
import { loadObservedRecipe } from './observed-recipe';
import { isOpeningNoEffectFailure, loadTaskFailures } from './task-failures';
import { prep } from './prep';
import { finishRun, startRun } from './ledger';
import { setRunContext } from './model';
import { mergeUsage, usageFromDb, usageFromMetrics } from './usage';

export type CollectResult = {
  ok: boolean;
  status: string;
  inventory: Inventory | null;
  plan: EvidencePlan | null;
  evidencePlanFile?: string;
  /** Retained for callers; coordinates are not execution evidence. */
  playbook: null;
  ms: number;
  detail?: string;
  runId?: number;
};

export type CollectOpts = {
  activityId: string;
  skip?: string[];
  supervisedLearning?: boolean;
  maxTasks?: number;
  revalidateOpeningFailures?: boolean;
};

type PlanCfg = { entry?: any[]; recover?: any[]; probes?: any[] };

/** One grouped assessment shared by collection and normal execution. */
export async function assessAndPlanInventory(agent: { aiQuery: (prompt: string) => Promise<any> }, inventory: Inventory, opts: {
  runId: number; supervisedLearning?: boolean; maxTasks?: number; cnyPerUnit?: number; skip?: string[];
  phase?: 'initial' | 'next'; revalidateOpeningFailures?: boolean;
}) {
  const validatedRecipes = inventory.tasks.flatMap(task => {
    const recipe = loadObservedRecipe(inventory.account, inventory.activity, task);
    return recipe ? [recipe] : [];
  });
  const response = await agent.aiQuery(buildAssessmentPrompt(inventory, {
    validatedRecipes: validatedRecipes.map(r => ({ task: r.taskName, instruction: r.instruction, yamlHash: r.yamlHash })),
  }));
  const modelAssessments = Array.isArray(response?.assessments) ? response.assessments : [];
  // Models cannot claim local validation. The pure planner checks identity and estimates.
  let assessments: CandidateAssessment[] = modelAssessments.map((a: any) => ({
    ...a, source: 'model_observation', disposition: a?.disposition === 'execute' ? 'skip' : a?.disposition,
  }));
  for (const recipe of validatedRecipes) {
    const matching = assessments.filter(a => a.task === recipe.taskName && a.instruction === recipe.instruction);
    const estimate = matching.length === 1 ? matching[0] : null;
    const validEstimate = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
    assessments = assessments.filter(a => a.task !== recipe.taskName || a.instruction !== recipe.instruction);
    assessments.push({ task: recipe.taskName, instruction: recipe.instruction, disposition: 'execute', source: 'validated_recipe',
      reason: `本地精确匹配已验证配方：${recipe.yamlHash}；估算背景：${estimate?.reason ?? '未知'}`,
      estimatedSeconds: validEstimate(estimate?.estimatedSeconds), estimatedModelTokens: validEstimate(estimate?.estimatedModelTokens) });
  }
  if (opts.skip?.length) assessments = assessments.map(a => opts.skip!.includes(a.task)
    ? { ...a, disposition: 'skip', reason: '人工跳过' } : a);
  // Actual failures take precedence over model assessments and validated recipes.
  // Replace every matching assessment (including missing/duplicate model entries).
  const dailyFailures = loadTaskFailures(inventory.account, inventory.activity);
  const openingRevalidations: { identity: { name: string; instruction: string }; sourceRunId: string | number; reason: string }[] = [];
  for (const task of inventory.tasks) {
    const matching = dailyFailures.filter(f => f.taskName === task.name && f.instruction === task.instruction);
    const failure = matching.sort((a, b) => b.evidence.attempt.startedAt - a.evidence.attempt.startedAt)[0];
    if (!failure) continue;
    if (opts.revalidateOpeningFailures === true && opts.supervisedLearning === true && opts.maxTasks === 1
      && isOpeningNoEffectFailure(failure)) {
      const reason = `显式单次开门复验：run ${failure.runId} 的结构化证据为 opening no_effect，前后任务配额不变且仍在未阻挡面板；保留历史失败，重新评估不代表成功或允许执行`;
      openingRevalidations.push({ identity: { name: task.name, instruction: task.instruction! }, sourceRunId: failure.runId, reason });
      // Reconsider the current model assessment without manufacturing eligibility,
      // including when a historical recipe would otherwise override a model skip.
      assessments = assessments.filter(a => a.task !== task.name || a.instruction !== task.instruction);
      assessments.push(...modelAssessments.filter((a: any) => a?.task === task.name && a.instruction === task.instruction)
        .map((a: any) => ({ ...a, source: 'model_observation',
          disposition: opts.skip?.includes(task.name) || a.disposition === 'execute' ? 'skip' : a.disposition,
          reason: `${reason}；${opts.skip?.includes(task.name) ? '人工跳过' : a.reason ?? ''}` })));
      continue;
    }
    assessments = assessments.filter(a => a.task !== task.name || a.instruction !== task.instruction);
    assessments.push({ task: task.name, instruction: task.instruction!, disposition: 'skip', source: 'model_observation',
      reason: `当日本地实际运行失败：run ${failure.runId}，${failure.timestamp}，verification=${failure.evidence.verification}，workflow.ok=${failure.evidence.workflow?.ok}；${failure.evidence.workflow?.error ?? '执行后未确认任务完成'}；本日不自动重试`,
      estimatedSeconds: null, estimatedModelTokens: null });
  }
  const plan = computeEvidencePlan(inventory, assessments, {
    supervisedLearning: opts.supervisedLearning ?? false, maxLearningTasks: 1,
    maxTasks: opts.maxTasks, cnyPerUnit: opts.cnyPerUnit, validatedRecipes,
  });
  const evidencePlanFile = path.resolve('data/evidence/plans', `run-${opts.runId}${opts.phase === 'next' ? '-next' : ''}.json`);
  fs.mkdirSync(path.dirname(evidencePlanFile), { recursive: true });
  fs.writeFileSync(evidencePlanFile, JSON.stringify({ runId: opts.runId, accountId: inventory.account,
    activityId: inventory.activity, inventory, modelAssessments, assessments, plan, openingRevalidations,
    ...(opts.phase === 'next' ? { executionAllowed: false, reason: '状态刷新后的建议；本轮任务或失败上限已停止后续执行' } : {}) }, null, 2) + '\n');
  console.log(`  任务评估与证据计划：${evidencePlanFile}`);
  return { plan, evidencePlanFile, validatedRecipes };
}

export async function collectAndPlan(opts: CollectOpts): Promise<CollectResult> {
  return withDeviceLock(async () => {
    const previous = getStayOn();
    setStayOn(15);
    try { return await collectAndPlanInner(opts); }
    finally { setRunContext(null); setStayOn(previous); }
  }, { serial: DEVICE });
}

async function collectAndPlanInner(opts: CollectOpts): Promise<CollectResult> {
  const t0 = Date.now();
  const act = db.select().from(schema.activity).where(eq(schema.activity.id, opts.activityId)).get();
  if (!act) throw new Error(`activity 不存在: ${opts.activityId}`);
  const acct = db.select().from(schema.account).where(eq(schema.account.id, act.accountId)).get();
  if (!acct) throw new Error(`account 不存在: ${act.accountId}`);
  const planCfg: PlanCfg | null = act.planJson ? JSON.parse(act.planJson) : null;
  if (!planCfg?.entry?.length) throw new Error('该活动没有 entry 配置，无法收集');
  const prepCfg = prepFor(acct.id);
  const p = await prep({ package: acct.package, entryTextAny: prepCfg.entryTextAny,
    blockTextAny: prepCfg.blockTextAny, coldStart: true, maxBacks: prepCfg.maxBacks, maxPrepMs: prepCfg.maxPrepMs });
  if (!p.ok) return { ok: false, status: p.reason, inventory: null, plan: null, playbook: null, ms: Date.now() - t0, detail: p.detail };

  const { agentFromAdbDevice } = await import('@midscene/android');
  const agent = await agentFromAdbDevice(DEVICE, { cache: { strategy: 'read-only', id: acct.cacheId } });
  injectAIContext(agent, acct.app);
  const runId = startRun({ accountId: acct.id, activityId: act.id, coldStart: false });
  setRunContext(runId);
  const ctx: any = { agent, runId, balanceBefore: null, balanceAfter: null, stepsDone: 0, failed: [],
    overBudget: () => Date.now() - t0 > 180000, log: (s: string) => console.log(s) };
  let finalStatus = 'COLLECT_FAILED';
  let finalError: string | null = null;
  try {
    await execSteps(ctx, planCfg.entry);
    if (ctx.failed.length) throw new Error(`入口未通过：${ctx.failed.join(' | ')}`);
    const scan = await collectInventory(agent, { account: acct.id, activity: act.id, overBudget: ctx.overBudget });
    if (!scan.ok || !scan.inventory) {
      finalStatus = 'COLLECT_INCOMPLETE';
      finalError = scan.detail ?? '任务清单不完整';
      return { ok: false, status: finalStatus, inventory: scan.inventory, plan: null, playbook: null,
        ms: Date.now() - t0, runId, detail: `${finalError}；原始分页证据：${scan.evidenceFile}` };
    }
    const inv = scan.inventory;
    if (!inv.tasks.length || inv.progress.total === 0) {
      finalStatus = 'COLLECT_EMPTY';
      return { ok: false, status: finalStatus, inventory: inv, plan: null, playbook: null, ms: Date.now() - t0, runId,
        detail: `清单为空或进度读不到：progress=${inv.progress.done}/${inv.progress.total}，tasks=${inv.tasks.length}` };
    }
    saveInventory(inv);
    const asset = act.assetId ? db.select().from(schema.asset).where(eq(schema.asset.id, act.assetId)).get() : undefined;
    const { plan, evidencePlanFile } = await assessAndPlanInventory(agent, inv, { ...opts, runId, cnyPerUnit: asset?.cnyPerUnit });
    finalStatus = 'PLANNED';
    return { ok: true, status: finalStatus, inventory: inv, plan, playbook: null, evidencePlanFile, ms: Date.now() - t0, runId };
  } catch (error: any) {
    finalError = String(error?.message ?? error);
    return { ok: false, status: finalStatus, inventory: null, plan: null, playbook: null, ms: Date.now() - t0, runId, detail: finalError };
  } finally {
    let usage: any = null;
    try { usage = mergeUsage(usageFromMetrics((agent as any).metrics), usageFromDb(runId)); } catch {}
    try { await agent.destroy?.(); } catch {}
    finishRun(runId, { status: finalStatus, error: finalError, usage, modelName: process.env.MIDSCENE_MODEL_NAME ?? null });
    if (usage) console.log(`  收集成本：${usage.calls} 次调用，${usage.totalTokens} tokens`);
  }
}
