/** 单独跑健康检查，不执行任务。用法：npx tsx probes/preflight.ts [活动id] */
import '../runner/model';
import { eq } from 'drizzle-orm';

import { db, schema } from '../db/client';
import { prepFor } from '../runner/config';
import { preflight } from '../runner/preflight';

const activityId = process.argv[2] ?? 'tb_coin';

const act = db.select().from(schema.activity).where(eq(schema.activity.id, activityId)).get();
if (!act) {
  console.error(`活动不存在: ${activityId}`);
  process.exit(1);
}
const acct = db.select().from(schema.account).where(eq(schema.account.id, act.accountId)).get();
if (!acct) {
  console.error(`账号不存在: ${act.accountId}`);
  process.exit(1);
}
const prepCfg = prepFor(acct.id);

console.log(`=== 健康检查：${act.name}（${acct.id}）===\n`);

const t0 = Date.now();
const pf = await preflight({
  package: acct.package,
  accountId: acct.id,
  blockTextAny: prepCfg.blockTextAny,
  modelBaseUrl: process.env.MIDSCENE_MODEL_BASE_URL!,
  modelApiKey: process.env.MIDSCENE_MODEL_API_KEY!,
  modelName: process.env.MIDSCENE_MODEL_NAME!,
});

for (const c of pf.checks) {
  const mark = c.ok ? '✅' : c.fatal ? '❌' : '⚠️';
  console.log(`${mark} ${c.name.padEnd(10)} ${c.detail}  (${c.ms}ms)`);
}

console.log(`\n结果: ${pf.ok ? '✅ 可以执行' : `❌ 被「${pf.blockedBy}」拦住，不执行`}`);
console.log(`总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(pf.ok ? 0 : 1);