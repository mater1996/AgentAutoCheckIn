import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { agentFromAdbDevice } from '@midscene/android';
import { DEVICE, getStayOn, setStayOn, wake } from '../runner/adb';
import { injectAIContext } from '../runner/context';
import { withDeviceLock } from '../runner/device-lock';
import { startRun, finishRun } from '../runner/ledger';
import { setRunContext } from '../runner/model';
import { usageFromMetrics } from '../runner/usage';
import { collectInventory } from '../runner/inventory-scan';
import { saveInventory } from '../runner/inventory';
import { buildAssessmentPrompt, computeEvidencePlan } from '../runner/planner';
import { loadObservedRecipe } from '../runner/observed-recipe';

// Supervised, read-only collection/planning; no task actions or scheduling.
const root = path.resolve('evidence/规划闭环-2026-10-31');
fs.mkdirSync(root, { recursive: true });
await withDeviceLock(async () => {
  const previous = getStayOn();
  const runId = startRun({ accountId: 'tb_main', activityId: 'tb_coin' });
  setRunContext(runId);
  let agent: any;
  let failure: string | null = null;
  const started = Date.now();
  try {
    setStayOn(15); wake();
    agent = await agentFromAdbDevice(DEVICE, { cache: false, persistExecutionDump: true, replanningCycleLimit: 3 });
    injectAIContext(agent, 'taobao');
    const scan = await collectInventory(agent, { account: 'tb_main', activity: 'tb_coin', evidenceDir: root + '/pages', maxPages: 12, scrollDistance: 200, overBudget: () => Date.now() - started > 300000 });
    fs.writeFileSync(`${root}/scan-${runId}.json`, JSON.stringify(scan, null, 2));
    if (!scan.ok || !scan.inventory) throw new Error(scan.detail ?? '扫描未完成');
    saveInventory(scan.inventory);
    const recipes = scan.inventory.tasks.map(t => loadObservedRecipe('tb_main', 'tb_coin', t)).filter(Boolean);
    const raw: any = await agent.aiQuery(buildAssessmentPrompt(scan.inventory, { capabilities: ['ordinary_in_app_browse', 'ordinary_in_app_search'] }));
    if (!Array.isArray(raw?.assessments)) throw new Error('完整列表评估缺失');
    const plan = computeEvidencePlan(scan.inventory, raw.assessments, { supervisedLearning: true, maxLearningTasks: 1, maxTasks: 1, validatedRecipes: recipes as any });
    const result = { runId, source: 'full-scroll-collection-and-model-assessment', inventory: scan.inventory, assessments: raw.assessments, plan, report: agent.reportFile };
    fs.writeFileSync(`${root}/plan-${runId}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (e: any) { failure = String(e?.message ?? e); throw e; }
  finally {
    finishRun(runId, { status: failure ? 'PLAN_CHECK_FAILED' : 'PLANNED', error: failure, execMs: Date.now() - started, evidenceDir: agent?.reportFile ?? null, usage: usageFromMetrics(agent?.metrics), modelName: process.env.MIDSCENE_MODEL_NAME });
    try { if (agent) await agent.destroy(); }
    finally { setRunContext(null); setStayOn(previous); }
  }
}, { serial: DEVICE });
