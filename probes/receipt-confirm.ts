import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { agentFromAdbDevice } from '@midscene/android';
import { DEVICE, getStayOn, setStayOn, wake } from '../runner/adb';
import { withDeviceLock } from '../runner/device-lock';
import { injectAIContext } from '../runner/context';
import { setRunContext } from '../runner/model';
import { startRun, finishRun } from '../runner/ledger';
import { usageFromMetrics } from '../runner/usage';
import { readTaskObservation } from '../runner/task-observation';
import { isValidTaskReceipt } from '../runner/task-receipt';
const original = JSON.parse(fs.readFileSync('evidence/跨天闭环-2026-10-31/platform-79.json', 'utf8'));
await withDeviceLock(async () => {
  const previous = getStayOn(); const runId = startRun({accountId:'tb_main', activityId:'tb_coin'});
  const started = Date.now(); let agent: any; const result: any = {runId, originalRunId:79};
  try {
    setStayOn(15); wake(); setRunContext(runId);
    agent = await agentFromAdbDevice(DEVICE, {cache:false}); injectAIContext(agent,'taobao');
    result.observation = await readTaskObservation(agent,{name:'拍立淘逛感兴趣的宝贝'});
    const e = original.taskEvidence[0];
    result.originalReceiptValid = isValidTaskReceipt(e.workflow.taskReceipt,e.attempt);
    result.confirmed = result.originalReceiptValid && e.workflow.ok === true && result.observation?.absent === true && result.observation?.pageIsTaskPanel === true;
    result.status = result.confirmed ? 'DIAGNOSTIC' : 'DIAGNOSTIC_FAILED';
    result.note = '只读补证，不新执行任务、不把旧回执用于新任务、不改写run79原始PARTIAL';
  } catch(e:any){ result.status='DIAGNOSTIC_FAILED';result.error=String(e.message); }
  finally {
    result.report=agent?.reportFile;result.at=new Date().toISOString();result.usage=usageFromMetrics(agent?.metrics);
    finishRun(runId,{status:result.status,execMs:Date.now()-started,error:result.error,evidenceDir:result.report,usage:result.usage});
    fs.writeFileSync(path.resolve(`evidence/跨天闭环-2026-10-31/confirmation-${runId}.json`),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
    try{await agent?.destroy();}finally{setRunContext(null);setStayOn(previous);}
  }
},{serial:DEVICE});
