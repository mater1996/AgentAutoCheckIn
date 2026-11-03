/**
 * 验证 if 分支：全程 0 模型调用（flow 里没有 ai / read 步骤，条件用本地文本判）。
 * 期望：第一个 if 为真走 1s，第二个为假也走 1s → exec 约 2s。
 */
import { sqlite } from '../db/client';
import { runActivity } from '../runner/signin';

const flow = [
  {
    do: 'if',
    cond_text: ['我的淘宝'], // 淘宝首页底部导航，必然存在
    then: [{ do: 'dwell', seconds: 1 }, { do: 'tap_text', text: '绝不存在的按钮', optional: true }],
    else: [{ do: 'dwell', seconds: 4 }],
  },
  {
    do: 'if',
    cond_text: ['绝不存在的词ZZZ'], // 必然不存在
    then: [{ do: 'dwell', seconds: 4 }],
    else: [{ do: 'dwell', seconds: 1 }],
  },
];

sqlite
  .prepare(
    `INSERT OR REPLACE INTO activity
     (id, account_id, name, steps_json, verify_any, balance_query, entry_text_any, asset_id,
      window_start, window_end, enabled, state)
     VALUES ('selftest_if','tb_main','分支自测',?,'',NULL,NULL,NULL,NULL,NULL,1,'active')`,
  )
  .run(JSON.stringify(flow));

console.log('已写入测试活动 selftest_if（无 asset、无 verify、无 read）');
const t0 = Date.now();
const r = await runActivity({ activityId: 'selftest_if', coldStart: true });
console.log('\n结果:', JSON.stringify(r, null, 2));
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`exec_ms=${r.execMs} —— 若两个分支都走对，应约 2000~2500ms；`);
console.log(`  全走 else 会接近 8000ms，说明第一个条件判错了`);

sqlite.prepare(`DELETE FROM activity WHERE id='selftest_if'`).run();
console.log('\n已清理测试活动');
