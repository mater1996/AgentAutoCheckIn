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

// Explicit supervised replay only. Never promoted automatically by this harness.
const yaml = process.argv[2];
if (!yaml) throw new Error('usage: tsx probes/observed-replay.ts <candidate.yaml>');
await withDeviceLock(async () => {
  const previous = getStayOn();
  const runId = startRun({ accountId: 'tb_main', activityId: 'tb_coin' });
  let agent: any;
  const t0 = Date.now();
  const result: any = { runId, yaml: path.resolve(yaml), before: null, after: null, workflow: null, change: null };
  try {
    setStayOn(15); wake(); setRunContext(runId);
    agent = await agentFromAdbDevice(DEVICE, { cache: false, persistExecutionDump: true, replanningCycleLimit: 2 });
    injectAIContext(agent, 'taobao');
    const prompt = '只观察当前任务面板，返回JSON {"name":"拍立淘逛感兴趣的宝贝","instruction":"逐字读取副标题","done":已完成次数,"total":配额上限,"balance":左上角淘金币总余额,"panel":是否明确任务面板}。看不到任何字段则设null，不推测。';
    result.before = await agent.aiQuery(prompt);
    if (result.before?.panel !== true || result.before?.instruction !== '浏览5秒' || observeTaskChange(result.before, result.before).status === 'unknown' || !Number.isFinite(result.before?.balance) || result.before.done >= result.before.total) throw new Error('候选前提不匹配');
    result.workflow = await runWorkflowFile(yaml, agent, { serial: DEVICE, screen: { w: 1080, h: 2400 } });
    result.after = await agent.aiQuery(prompt);
    result.change = observeTaskChange(result.before, result.after);
    result.ok = result.workflow.ok && result.after?.panel === true && result.change.status === 'completed' && Number.isFinite(result.after?.balance) && result.after.balance > result.before.balance;
    result.status = result.ok ? 'OK' : 'ERROR';
    if (!result.ok) result.error = result.workflow.error ?? '未同时确认任务配额和同页余额增长';
  } catch (e: any) { result.ok = false; result.status = 'ERROR'; result.error = String(e?.message ?? e); }
  finally {
    result.at = new Date().toISOString();
    result.report = agent?.reportFile ?? null;
    result.usage = usageFromMetrics(agent?.metrics);
    result.execMs = Date.now() - t0;
    finishRun(runId, { status: result.status, execMs: result.execMs, balanceBefore: result.before?.balance ?? null, balanceAfter: result.after?.panel === true ? result.after.balance : null, error: result.error ?? null, evidenceDir: result.report, usage: result.usage, modelName: process.env.MIDSCENE_MODEL_NAME });
    if (result.ok) {
      recordSnapshot({assetId: 'taobao_coins', accountId: 'tb_main', balance: result.after.balance, runId, source: 'read'});
      recordGain({runId, assetId: 'taobao_coins', source: 'settle', units: result.after.balance - result.before.balance, note: '监督配方复验，同任务配额与同页余额均增长'});
    }
    fs.mkdirSync('evidence/闭环改进-2026-10-30', {recursive: true});
    fs.writeFileSync(`evidence/闭环改进-2026-10-30/replay-${runId}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    try { if (agent) await agent.destroy(); } finally { setRunContext(null); setStayOn(previous); }
  }
}, {serial: DEVICE});
