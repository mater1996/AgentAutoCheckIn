/** 打印当前配置解析出的 flow 结构，用于人工核对（不碰设备）。 */
import { estimateSteps, loadActivities, loadAssets, loadAccounts, syncToDb } from '../runner/config';

console.log('=== 同步配置到镜像表 ===');
syncToDb();

console.log('\n=== 资产 ===');
for (const x of loadAssets()) {
  console.log(`  ${x.id.padEnd(14)} ${x.name}  ${x.unit}  1单位=¥${x.cny_per_unit}  ${x.expiry_days ? x.expiry_days + '天过期' : '长期'}`);
}

console.log('\n=== 账号 ===');
for (const a of loadAccounts()) {
  console.log(`  ${a.id.padEnd(10)} ${a.package}  user=${a.user_id ?? 0}  cache=${a.cache_id}  enabled=${a.enabled !== false}`);
}

console.log('\n=== 活动 flow ===');
for (const a of loadActivities()) {
  console.log(`\n[${a.id}] ${a.name}`);
  console.log(`  账号=${a.account_id} 资产=${a.asset_id} 窗口=${a.window?.join('~') ?? '-'}`);

  // 新形态：目标驱动
  if (a.task?.steps?.length) {
    const o = a.objective ?? {};
    console.log(`  形态=目标驱动  策略=${o.strategy ?? 'all_tiers'}  上限=${o.max_seconds ?? 900}s  单任务=${o.unit_reward ?? 0}单位/${o.unit_seconds ?? 35}s`);
    console.log(`  档位: ${(a.tiers ?? []).map((t) => `${t.at}→${t.reward}`).join('  ') || '无'}`);
    console.log(`  探测: ${(a.probes ?? []).map((p) => `${p.id}(${p.parse ?? 'int'})`).join('  ')}`);
    console.log(`  入口 ${a.entry?.length ?? 0} 步 → 任务单元 ${a.task.steps.length} 步 → 领奖 ${a.collect?.steps?.length ?? 0} 步 → 结算 ${a.settle ? 1 : 0}`);
    continue;
  }

  const est = estimateSteps(a.flow ?? []);
  console.log(`  形态=flow  步骤 ${(a.flow ?? []).length} 条，模型调用上限 ${est.ai}`);
  let i = 0;
  for (const s of a.flow ?? []) {
    i++;
    let desc = s.do;
    if (s.do === 'ai') desc += `「${(s.say ?? '').slice(0, 36)}」${s.optional ? ' [optional]' : ''}`;
    else if (s.do === 'read') desc += ` as=${s.as ?? 'before'}「${(s.say ?? '').slice(0, 24)}」`;
    else if (s.do === 'dwell') desc += ` ${s.seconds}s`;
    else if (s.do === 'repeat') desc += ` max=${s.max} 内含 ${s.each?.length ?? 0} 步 stop_when=「${(s.stop_when ?? '').slice(0, 24)}」`;
    else if (s.do === 'back') desc += ` wait=${s.wait ?? 2}s`;
    console.log(`   ${String(i).padStart(2)}. ${desc}`);
  }
}
