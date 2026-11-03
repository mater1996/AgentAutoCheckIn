/** 端到端：建库 + 归位 + 淘金币签到 + 读余额 + 记账。跑两次验证缓存。 */
import { seed } from '../runner/ledger';
import { runActivity } from '../runner/signin';
import { sqlite } from '../db/client';

seed();
console.log('种子数据已写入');

const pass = process.argv[2] ? Number(process.argv[2]) : 1;

for (let i = 1; i <= pass; i++) {
  console.log(`\n${'='.repeat(60)}\n第 ${i} 次执行`);
  const r = await runActivity({
    activityId: 'tb_coin_signin',
    coldStart: true,
    cacheStrategy: i === 1 ? 'write-only' : 'read-only',
  });
  console.log(JSON.stringify(r, null, 2));
}

console.log(`\n${'='.repeat(60)}\n--- run 表 ---`);
for (const row of sqlite.prepare('SELECT id,day,status,cache_hit,cold_start,prep_ms,exec_ms,balance_before,balance_after FROM run ORDER BY id DESC LIMIT 6').all()) {
  console.log(JSON.stringify(row));
}

console.log('\n--- asset_snapshot 表 ---');
for (const row of sqlite.prepare('SELECT id,day,asset_id,balance,source,run_id FROM asset_snapshot ORDER BY id DESC LIMIT 6').all()) {
  console.log(JSON.stringify(row));
}

console.log('\n--- 资产汇总 ---');
for (const row of sqlite.prepare(`
  SELECT a.id, a.name, a.unit,
         (SELECT balance FROM asset_snapshot s WHERE s.asset_id=a.id ORDER BY day DESC, id DESC LIMIT 1) AS current,
         (SELECT COUNT(*) FROM asset_snapshot s WHERE s.asset_id=a.id) AS readings
  FROM asset a`).all()) {
  console.log(JSON.stringify(row));
}
