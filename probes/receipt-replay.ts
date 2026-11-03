import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { agentFromAdbDevice } from '@midscene/android';
import { DEVICE, getStayOn, setStayOn, wake } from '../runner/adb';
import { withDeviceLock } from '../runner/device-lock';
import { injectAIContext } from '../runner/context';
import { startRun, finishRun, recordSnapshot, recordGain } from '../runner/ledger';
import { setRunContext } from '../runner/model';
import { usageFromMetrics } from '../runner/usage';
import { runWorkflowFile } from '../runner/workflow';
import { observeTaskChange } from '../runner/task-evidence';
import { createTaskAttempt, isValidTaskReceipt } from '../runner/task-receipt';

// Explicit supervised candidate replay; never promotes recipes or starts schedules.
const [yaml, taskName, instruction] = process.argv.slice(2);
if (!yaml || !taskName || !instruction) throw new Error('usage: tsx probes/receipt-replay.ts <yaml> <exact task> <exact instruction>');
const root = path.resolve('evidence/跨天闭环-2026-10-31');
await withDeviceLock(async () => {
  const previous = getStayOn();
  const runId = startRun({ accountId: 'tb_main', activityId: 'tb_coin' });
  let agent: any;
  const t0 = Date.now();
  const result: any = { runId, yaml: path.resolve(yaml), taskName, instruction, before: null, after: null, workflow: null };
  try {
    setStayOn(15); wake(); setRunContext(runId);
    agent = await agentFromAdbDevice(DEVICE, { cache: false, persistExecutionDump: true, replanningCycleLimit: 3 });
    injectAIContext(agent, 'taobao');
    const prompt = `只观察当前实际任务面板返回JSON {"name":"实际完整任务名，不含配额","instruction":"逐字读取目标副标题","done":目标已完成次数,"total":目标配额上限,"balance":左上角淘金币总余额,"panel":是否明确任务面板,"absent":是否明确目标行不存在}。目标名称${JSON.stringify(taskName)}。若目标不可见，name/done/total/instruction返回null；只有确认为任务面板且没有此目标行时absent=true，无法确认用null，不能猜测。`;
    result.before = await agent.aiQuery(prompt);
    const b = result.before;
    if (b?.panel !== true || b.name !== taskName || b.instruction !== instruction || observeTaskChange(b, b).status === 'unknown' || !Number.isFinite(b.balance) || b.done >= b.total) throw new Error('候选前提不匹配');
    result.attempt = createTaskAttempt({ name: taskName, instruction });
    result.workflow = await runWorkflowFile(yaml, agent, { serial: DEVICE, screen: { w: 1080, h: 2400 }, taskAttempt: result.attempt });
    result.after = await agent.aiQuery(prompt);
    const a = result.after;
    result.change = observeTaskChange(b, a);
    result.receiptValid = isValidTaskReceipt(result.workflow.taskReceipt, result.attempt);
    result.verification = result.change.status === 'completed' ? 'quota'
      : a?.panel === true && a.absent === true && a.name === null && a.done === null && a.total === null && result.receiptValid ? 'receipt' : 'unknown';
    result.ok = result.workflow.ok && a?.panel === true && result.verification !== 'unknown' && Number.isFinite(a.balance) && a.balance > b.balance;
    result.status = result.ok ? 'OK' : Number.isFinite(a?.balance) && a.balance > b.balance ? 'PARTIAL' : 'ERROR';
    if (!result.ok) result.error = result.workflow.error ?? '未同时确认本次任务完成和同口径余额增长';
  } catch (e: any) { result.ok = false; result.status = 'ERROR'; result.error = String(e?.message ?? e); }
  finally {
    result.at = new Date().toISOString(); result.report = agent?.reportFile ?? null;
    result.usage = usageFromMetrics(agent?.metrics); result.execMs = Date.now() - t0;
    const before = Number.isFinite(result.before?.balance) ? result.before.balance : null;
    const after = result.after?.panel === true && Number.isFinite(result.after.balance) ? result.after.balance : null;
    finishRun(runId, { status: result.status, execMs: result.execMs, balanceBefore: before, balanceAfter: after, error: result.error ?? null, evidenceDir: result.report, usage: result.usage, modelName: process.env.MIDSCENE_MODEL_NAME });
    if (after !== null) recordSnapshot({assetId: 'taobao_coins', accountId: 'tb_main', balance: after, runId, source: 'read'});
    if (after !== null && before !== null && after > before) recordGain({runId, assetId: 'taobao_coins', source: 'settle', units: after-before, note: `监督回执配方复验，完成证据=${result.verification ?? 'unknown'}`});
    fs.mkdirSync(root, {recursive: true});
    fs.writeFileSync(path.join(root, `receipt-replay-${runId}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    try { if (agent) await agent.destroy(); } finally { setRunContext(null); setStayOn(previous); }
  }
}, {serial: DEVICE});
