/** 只跑 entry 导航，然后截图，用于确认任务页真实布局 */
import '../runner/model';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { agentFromAdbDevice } from '@midscene/android';
import { injectAIContext } from '../runner/context';
import { prepFor, syncToDb } from '../runner/config';
import { prep } from '../runner/prep';
import { db, schema } from '../db/client';
import { execSteps } from '../runner/flow';
import type { ExecCtx } from '../runner/flow';
import { sleep, DEVICE } from '../runner/adb';

syncToDb();
const act = db.select().from(schema.activity).all().find((x) => x.id === 'tb_coin')!;
const plan = JSON.parse(act.planJson!);

const ctx: ExecCtx = {
  agent: null as any, seq: 0, stage: 'entry',
  balanceBefore: null, balanceAfter: null, stepsDone: 0, failed: [],
  overBudget: () => false, log: (s) => console.log(s),
};

const agent = await agentFromAdbDevice(DEVICE);
ctx.agent = agent;
await injectAIContext(agent, act.accountId);

const cfg = prepFor(act.accountId);
const p = await prep(cfg);
console.log('prep:', p.ok, p.detail ?? '');

console.log('=== 执行 entry ===');
await execSteps(ctx, plan.entry ?? []);
console.log('failed:', ctx.failed);
console.log('balanceBefore:', ctx.balanceBefore);

await sleep(2000);
const buf = execFileSync('/opt/homebrew/bin/adb', ['-s', DEVICE, 'exec-out', 'screencap', '-p'], { maxBuffer: 24 * 1024 * 1024 });
fs.writeFileSync('/tmp/entry-done.png', buf);
console.log('截图: /tmp/entry-done.png');
await agent.destroy?.();
