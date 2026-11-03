/**
 * 执行单元运行器：把一个任务 YAML 交给 Midscene Test 跑完。
 *
 * 分工：
 *   - 业务层（我们）：决定跑哪个 YAML、什么时候跑、跑完记账
 *   - Midscene Test：YAML 解析、步骤编排、超时、错误分类、报告
 *
 * 内置节点由 createMidsceneNodes 自动注入（aiAct / aiAssert / back /
 * runAdbShell / wait ...），自定义节点为 ensureNoPopup 和 tapRow。
 */
// 必须先于 @midscene/android 导入：model.ts 在模块顶层设置 MIDSCENE_MODEL_* 环境变量，
// agentFromAdbDevice 初始化时就要读到，否则报 "model name is required"。
import './model';

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { AndroidAgent, agentFromAdbDevice } from '@midscene/android';
import { CaseRunner, collectWorkflowDocument, type CaseInput, type CaseRunResult, type CollectedWorkflowDocument } from '@midscene/test';
import { createMidsceneNodes } from '@midscene/test/midscene';

import { ensureNoPopup } from './nodes/ensure-no-popup';
import type { FileContext } from './nodes/ensure-no-popup';
import { tapRow } from './nodes/tap-row';
import { taskEntered, taskReceipt } from './nodes/task-receipt';
import { createTaskReceiptState, type TaskCompletionReceipt, type TaskReceiptState } from './task-receipt';

export interface WorkflowResult {
  ok: boolean;
  name: string;
  steps: { node: string; status: string; ms: number; error?: string }[];
  ms: number;
  error?: string;
  taskReceipt?: TaskCompletionReceipt;
  taskEvidence?: TaskReceiptState;
}

/** 项目 CLI 和业务运行器共用的节点注册表；构建时不打开设备。 */
export function buildNodes() {
  const getAgent = (ctx: { context: FileContext }): AndroidAgent => ctx.context.agent;
  return [ensureNoPopup, tapRow, taskEntered, taskReceipt, ...createMidsceneNodes<FileContext>({ agentClass: AndroidAgent, getAgent })];
}

export interface WorkflowValidationResult {
  ok: boolean;
  name: string;
  stepCount: number;
  error?: string;
}

/** 官方 collect 只归一化输入，不验证节点 schema；这里显式补上静态 schema 校验。 */
function collectValidatedWorkflow(file: string, nodes = buildNodes()): CollectedWorkflowDocument {
  const abs = path.resolve(file);
  const registry = new Map(nodes.map((node) => [node.name, node]));
  const doc = collectWorkflowDocument(
    { projectId: 'checkin', projectName: 'checkin', absolutePath: abs, sourcePath: path.basename(abs) },
    { resolveNode: (name) => registry.get(name) },
  );
  // 任务执行单元仅支持一个 case，不能静默忽略其他 case 或生命周期步骤。
  if (doc.cases.length !== 1) throw new Error('任务 YAML 必须且只能包含一个 case');
  if (Object.values(doc.lifecycle).some((steps) => steps.length > 0)) {
    throw new Error('任务 YAML 不支持生命周期步骤；请把执行步骤写入唯一 case.steps');
  }
  for (const [index, step] of doc.cases[0].definition.steps.entries()) {
    const node = registry.get(step.node)!;
    const schema = node.inputSchema;
    if (!schema) continue;
    const result = schema.safeParse(step.input);
    if (!result.success) throw new Error(`步骤 ${index + 1} (${step.node}) 参数无效：${result.error.message}`);
  }
  return doc;
}

/** 纯离线入口：读取 YAML、注册节点并校验参数，不创建 agent、不执行节点。 */
export function validateWorkflowFile(file: string): WorkflowValidationResult {
  try {
    const doc = collectValidatedWorkflow(file);
    return { ok: true, name: doc.cases[0].definition.name, stepCount: doc.cases[0].definition.steps.length };
  } catch (error: any) {
    return { ok: false, name: path.basename(file), stepCount: 0, error: String(error?.message ?? error) };
  }
}

/** 以已安装 @midscene/test 的 CaseRunResult 契约判定成功，空/缺失执行绝不成功。 */
export function workflowResultFromCaseRun(result: CaseRunResult, expectedSteps: number, ms = result.durationMs): WorkflowResult {
  const allSteps = [...result.beforeEach, ...result.steps, ...result.afterEach];
  const steps = allSteps.map((step) => ({
    node: step.node,
    status: step.status,
    ms: step.durationMs ?? 0,
    error: step.error?.message.slice(0, 200),
  }));
  const errors = [
    ...allSteps.filter((step) => step.status !== 'success').map((step) => step.error?.message ?? `${step.node}: ${step.status}`),
    ...(result.executionErrors ?? []).map((error) => error.message),
    ...(result.teardownErrors ?? []).map((error) => error.message),
  ];
  if (expectedSteps < 1 || result.steps.length !== expectedSteps) errors.push(`步骤数量不符：预期 ${expectedSteps}，实际 ${result.steps.length}`);
  if (result.status !== 'success') errors.push(`Case 状态：${result.status}`);
  if (result.executionStatus && result.executionStatus !== 'success') errors.push(`执行状态：${result.executionStatus}`);
  if (result.pendingOperations?.length) errors.push('Case 仍有未结束操作');
  return { ok: errors.length === 0, name: result.name, steps, ms, ...(errors.length ? { error: errors.join('；').slice(0, 500) } : {}) };
}

/** 把一个 YAML 文件跑完。agent 由调用方传入，便于同一轮复用。 */
export async function runWorkflowFile(
  file: string,
  agent: AndroidAgent,
  ctx: Omit<FileContext, 'agent' | 'taskEvidence'>,
): Promise<WorkflowResult> {
  const t0 = Date.now();
  const abs = path.resolve(file);

  if (!fs.existsSync(abs)) {
    return { ok: false, name: path.basename(file), steps: [], ms: 0, error: `文件不存在：${abs}` };
  }

  // ① 与离线入口使用完全相同的解析、节点名及 schema 校验。
  const nodes = buildNodes();
  let doc: CollectedWorkflowDocument;
  try {
    doc = collectValidatedWorkflow(abs, nodes);
  } catch (e: any) {
    return { ok: false, name: path.basename(file), steps: [], ms: Date.now() - t0, error: `解析失败：${e?.message ?? e}` };
  }
  const caseDef = doc.cases[0].definition;
  // CaseRunner.run 接受原生步骤形态；由已验证快照重建，避免二次读盘丢失变量解析或发生漂移。
  const rawSteps: CaseInput['steps'] = caseDef.steps.map((step) => ({
    [step.node]: {
      ...step.input,
      $: {
        'continue-on-error': step.meta.continueOnError,
        ...(step.meta.timeoutMs === undefined ? {} : { timeout: step.meta.timeoutMs }),
      },
    },
  }));

  // ② 执行
  const context: FileContext = { ...ctx, agent,
    taskAttempt: ctx.taskAttempt ? { ...ctx.taskAttempt } : undefined,
    taskEvidence: ctx.taskAttempt ? createTaskReceiptState(ctx.taskAttempt) : undefined,
  };
  const evidence = () => context.taskEvidence ? {
    taskEvidence: structuredClone(context.taskEvidence),
    ...(context.taskEvidence.receipt ? { taskReceipt: structuredClone(context.taskEvidence.receipt) } : {}),
  } : {};
  const runner = new CaseRunner({
    nodes,
    context,
  });

  try {
    const result = await runner.run({ name: caseDef.name, tags: caseDef.tags, steps: rawSteps });
    return { ...workflowResultFromCaseRun(result, caseDef.steps.length, Date.now() - t0), ...evidence() };
  } catch (e: any) {
    return {
      ok: false,
      name: caseDef.name ?? path.basename(file, '.yaml'),
      steps: [],
      ms: Date.now() - t0,
      error: String(e?.message ?? e).slice(0, 300),
      ...evidence(),
    };
  }
}

/** 打开设备并跑一个 YAML，跑完释放 agent。 */
export async function runWorkflowOnce(
  file: string,
  opts: { serial?: string; screen?: { w: number; h: number } } = {},
): Promise<WorkflowResult> {
  const serial = opts.serial ?? process.env.ADB_SERIAL ?? '3d8a7934';
  const screen = opts.screen ?? { w: 1080, h: 2400 };

  let agent: AndroidAgent | null = null;
  try {
    agent = await agentFromAdbDevice(serial);
    return await runWorkflowFile(file, agent, { serial, screen });
  } catch (e: any) {
    return { ok: false, name: path.basename(file), steps: [], ms: 0, error: String(e?.message ?? e).slice(0, 300) };
  } finally {
    try {
      await (agent as any)?.destroy?.();
    } catch {
      /* 释放失败不影响结果 */
    }
  }
}

/** 列出某个账号+活动的所有任务 YAML */
export function listWorkflows(account: string, activity: string): string[] {
  const dir = path.resolve('data/playbooks', `${account}_${activity}`);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.join(dir, f));
}

/** npx tsx runner/workflow.ts --validate <task.yaml>：只校验，退出码 0/1。 */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , mode, file, ...extra] = process.argv;
  if (mode !== '--validate' || !file || extra.length) {
    console.error('用法：tsx runner/workflow.ts --validate <task.yaml>');
    process.exitCode = 2;
  } else {
    const result = validateWorkflowFile(file);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  }
}