import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { agentFromAdbDevice } from '@midscene/android';
import { DEVICE, getStayOn, setStayOn, wake, shell } from '../runner/adb';
import { injectAIContext } from '../runner/context';
import { startRun, finishRun } from '../runner/ledger';
import { setRunContext } from '../runner/model';
import { usageFromMetrics } from '../runner/usage';
import { execFileSync } from 'node:child_process';
import { withDeviceLock } from '../runner/device-lock';

// Manual supervised diagnostic entry; never scheduled. Midscene owns visual decisions.
const action = process.argv[2] ?? 'query';
const prompt = process.argv[3] ?? '描述当前屏幕，说明是否黑屏、锁屏、登录页或验证码；不要执行动作。';
if (!['query', 'tap', 'act', 'back', 'tap_native', 'tap_u2'].includes(action)) throw new Error('query | tap | act | back | tap_native | tap_u2');
const root = path.resolve(process.env.CHECKIN_EVIDENCE_DIR ?? 'evidence/闭环改进-2026-10-30');
fs.mkdirSync(root, { recursive: true });
await withDeviceLock(async () => {
const previous = getStayOn();
let agent: any;
const runId = startRun({ accountId: 'tb_main', activityId: 'tb_coin' });
setRunContext(runId);
let failure: string | null = null;
const started = Date.now();
try {
  setStayOn(15);
  wake();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  agent = await agentFromAdbDevice(DEVICE, { cache: false, persistExecutionDump: true, replanningCycleLimit: 3 });
  injectAIContext(agent, 'taobao');
  if (action === 'query') {
    const result = await agent.aiQuery(prompt);
    console.log(JSON.stringify(result, null, 2));
    const data = { at: new Date().toISOString(), action, prompt, result, report: agent.reportFile };
    fs.appendFileSync(path.join(root, 'supervised.jsonl'), JSON.stringify(data) + '\n');
    agent.dump.serializeToFiles(path.join(root, `trace-${Date.now()}.json`));
  } else {
    if (action === 'back') {
      shell('input keyevent KEYCODE_BACK');
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } else if (action === 'tap_native') {
      const target = await agent.aiLocate(prompt);
      const [x, y] = target.center;
      console.log('LOCATED', JSON.stringify({ x, y }));
      shell(`input tap ${Math.round(x)} ${Math.round(y)}`);
      await new Promise((resolve) => setTimeout(resolve, 7000));
    } else if (action === 'tap_u2') {
      const target = await agent.aiLocate(prompt);
      const [x, y] = target.center;
      execFileSync(path.resolve('.venv/bin/python'), ['-c', 'import uiautomator2 as u2,sys;d=u2.connect(sys.argv[1]);d.click(int(sys.argv[2]),int(sys.argv[3]))', DEVICE, String(Math.round(x)), String(Math.round(y))]);
      await new Promise((resolve) => setTimeout(resolve, 7000));
    } else if (action === 'tap') await agent.aiTap(prompt);
    else await agent.aiAct(prompt);
    const result = await agent.aiQuery('只观察不要操作，描述当前页面、任务计数、余额；如果读不到明确写未知。');
    console.log(JSON.stringify(result, null, 2));
    const data = { at: new Date().toISOString(), action, prompt, result, report: agent.reportFile };
    fs.appendFileSync(path.join(root, 'supervised.jsonl'), JSON.stringify(data) + '\n');
    agent.dump.serializeToFiles(path.join(root, `trace-${Date.now()}.json`));
  }
} catch (error: any) {
  failure = String(error?.message ?? error);
  throw error;
} finally {
  try {
    finishRun(runId, {
      status: failure ? 'DIAGNOSTIC_FAILED' : 'DIAGNOSTIC',
      execMs: Date.now() - started,
      error: failure,
      evidenceDir: agent?.reportFile ?? null,
      usage: usageFromMetrics(agent?.metrics),
      modelName: process.env.MIDSCENE_MODEL_NAME,
    });
    if (agent) {
      console.log('METRICS', JSON.stringify(agent.metrics));
      await agent.destroy();
    }
  } finally {
    setRunContext(null);
    setStayOn(previous);
  }
}
}, { serial: DEVICE });
