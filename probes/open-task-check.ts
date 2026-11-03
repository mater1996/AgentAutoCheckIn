import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { agentFromAdbDevice } from '@midscene/android';
import { DEVICE, getStayOn, setStayOn, wake, shell, sleep } from '../runner/adb';
import { withDeviceLock } from '../runner/device-lock';
import { injectAIContext } from '../runner/context';
import { startRun, finishRun } from '../runner/ledger';
import { setRunContext } from '../runner/model';
import { usageFromMetrics } from '../runner/usage';
import { openTaskDestination } from '../runner/task-opening';
const root = path.resolve('evidence/单步打开-2026-10-31'); fs.mkdirSync(root, { recursive: true });
await withDeviceLock(async () => {
  const previous = getStayOn(); const started = Date.now();
  const runId = startRun({ accountId: 'tb_main', activityId: 'tb_coin' }); setRunContext(runId);
  let agent: any; let error: string | null = null; const observations: any[] = [];
  try {
    setStayOn(15); wake();
    agent = await agentFromAdbDevice(DEVICE, { cache: false, replanningCycleLimit: 3 }); injectAIContext(agent, 'taobao');
    const before: any = await agent.aiQuery('只读当前任务面板，返回JSON {"pageIsTaskPanel":boolean,"blocked":boolean,"task":{"name":"当前可见完整名称好物沉浸看，若不存在null","instruction":"要求原文不含金币奖励","quota":"配额原文"}}。不点任务，任务面板本身不是遮挡，不猜别名。');
    if (before?.pageIsTaskPanel !== true || before.blocked !== false || !before.task?.name || !before.task?.instruction || !before.task?.quota) throw new Error('当前局部验证目标未明确');
    const opened = await openTaskDestination(agent, before.task, { observe: async () => {
      const raw = await agent.aiQuery(`只读当前页面，返回JSON {"pageIdentity":"实际页身份","pageIsTaskPanel":boolean,"blocked":boolean,"destinationShown":是否明确已离开面板进入选中任务目的页,"targetName":"若仍在面板准确名称否则null","targetInstruction":"若仍面板要求原文否则null","targetQuota":"若仍面板配额否则null"}。本次目标${JSON.stringify(before.task)}。不操作、不推断完成。`);
      observations.push(raw); return raw;
    }});
    shell('input keyevent KEYCODE_BACK'); await sleep(1500);
    const after = await agent.aiQuery('只读JSON {"pageIsTaskPanel":是否明确任务行配额操作按钮面板,"blocked":是否独立遮挡或验证}。任务面板自身不算阻挡。');
    const result = { runId, task: before.task, opened, after, observations, report: agent.reportFile };
    fs.writeFileSync(`${root}/local-${runId}.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
    if (after?.pageIsTaskPanel !== true || after.blocked !== false) throw new Error('返回未确认面板');
  } catch (e: any) { error = String(e?.message ?? e); console.log('LOCAL_FAILED', error); fs.writeFileSync(`${root}/local-${runId}-failed.json`, JSON.stringify({ runId, error, observations, report: agent?.reportFile }, null, 2)); }
  finally { finishRun(runId, { status: error ? 'OPEN_CHECK_FAILED' : 'OPEN_CHECK_OK', error, execMs: Date.now() - started, evidenceDir: agent?.reportFile, usage: usageFromMetrics(agent?.metrics) }); try { await agent?.destroy(); } finally { setRunContext(null); setStayOn(previous); } }
}, { serial: DEVICE });
