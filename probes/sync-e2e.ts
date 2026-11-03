/** 同步配置 → 执行活动。用法：tsx probes/sync-e2e.ts [活动id] [--dry] */
import { syncToDb } from '../runner/config';
import { runActivity } from '../runner/signin';
import { sqlite } from '../db/client';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const activityId = args.find((a) => !a.startsWith('--')) || 'tb_coin';

console.log('=== 同步配置 ===');
syncToDb();

console.log('\n=== 配置概览 ===');
for (const r of sqlite.prepare('SELECT id,name,account_id,asset_id,window_start,window_end FROM activity').all()) {
  console.log(' ', JSON.stringify(r));
}
for (const r of sqlite.prepare('SELECT id,name,unit,cny_per_unit,expiry_days FROM asset').all()) {
  console.log(' ', JSON.stringify(r));
}

console.log(`\n=== 执行 ${activityId} ===`);
const r = await runActivity({ activityId, coldStart: true, cacheStrategy: 'read-write', dryRun: dry });
console.log(JSON.stringify(r, null, 2));

console.log('\n=== 资产汇总 ===');
for (const row of sqlite
  .prepare(
    `SELECT a.id, a.name, a.unit, a.cny_per_unit,
            (SELECT balance FROM asset_snapshot s WHERE s.asset_id=a.id ORDER BY day DESC, id DESC LIMIT 1) AS current,
            (SELECT COUNT(*) FROM asset_snapshot s WHERE s.asset_id=a.id) AS readings
       FROM asset a`,
  )
  .all()) {
  const x: any = row;
  const cny = x.current != null ? (x.current * x.cny_per_unit).toFixed(2) : '-';
  console.log(`  ${x.name}: ${x.current ?? '-'} ${x.unit}  ≈¥${cny}  读数 ${x.readings}`);
}

console.log('\n=== 最近 run ===');
for (const row of sqlite
  .prepare('SELECT id,day,status,cold_start,prep_ms,exec_ms,balance_before,balance_after,error FROM run ORDER BY id DESC LIMIT 5')
  .all()) {
  console.log(' ', JSON.stringify(row).slice(0, 300));
}
