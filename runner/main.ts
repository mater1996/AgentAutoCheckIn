/**
 * 每日总调度：同步配置 → 按时间窗挑活动 → 串行执行 → 输出汇总。
 * 由 cron / launchd 拉起；汇总文本可直接作为通知内容。
 */
import { sqlite } from '../db/client';
import { syncToDb } from './config';
import { runActivity } from './signin';
import type { RunActivityResult } from './signin';

function inWindow(start?: string | null, end?: string | null): boolean {
  if (!start || !end) return true;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return cur >= sh * 60 + sm && cur <= eh * 60 + em;
}

const ICON: Record<string, string> = {
  OK: '✅',
  ALREADY: '🔁',
  NO_EFFECT: '⚠️',
  ERROR: '❌',
  NEEDS_LOGIN: '🔑',
  NEEDS_HUMAN: '🙋',
  LAUNCH_FAILED: '💥',
  DEVICE_ERROR: '📴',
};

async function main() {
  const force = process.argv.includes('--force');
  console.log('=== 同步配置 ===');
  syncToDb();

  const acts = sqlite
    .prepare(`SELECT a.*, ac.package, ac.id AS acc_id FROM activity a JOIN account ac ON ac.id=a.account_id
              WHERE a.enabled=1 AND ac.enabled=1 ORDER BY a.account_id, a.id`)
    .all() as any[];

  const due = acts.filter((a) => force || inWindow(a.window_start, a.window_end));
  console.log(`\n=== 待执行 ${due.length}/${acts.length} 个活动 ===`);

  const results: Array<RunActivityResult & { name: string }> = [];
  const startedApps = new Set<string>();

  for (const a of due) {
    const first = !startedApps.has(a.acc_id);
    startedApps.add(a.acc_id);
    console.log(`\n--- ${a.name} (${a.id}) 冷启动=${first} ---`);
    try {
      const r = await runActivity({ activityId: a.id, coldStart: first });
      results.push({ ...r, name: a.name });
      console.log(
        `  ${ICON[r.status] ?? '•'} ${r.status}  prep=${(r.prepMs / 1000).toFixed(1)}s exec=${(r.execMs / 1000).toFixed(1)}s  余额 ${r.balanceBefore ?? '-'} → ${r.balanceAfter ?? '-'}  delta=${r.delta ?? '-'}`,
      );
      if (r.stepsFailed.length) console.log(`  失败步骤: ${r.stepsFailed.slice(0, 2).join(' ; ')}`);
    } catch (e: any) {
      console.log(`  ❌ 异常: ${e?.message ?? e}`);
      results.push({
        ok: false,
        status: 'ERROR',
        name: a.name,
        runId: -1,
        prepMs: 0,
        execMs: 0,
        balanceBefore: null,
        balanceAfter: null,
        delta: null,
        stepsDone: 0,
        stepsFailed: [String(e?.message ?? e)],
        report: null,
      });
    }
    await new Promise((r) => setTimeout(r, 3000)); // 活动之间留间隔，避免固定节奏
  }

  // ---- 汇总 ----
  const ok = results.filter((r) => r.status === 'OK').length;
  const already = results.filter((r) => r.status === 'ALREADY').length;
  const bad = results.filter((r) => !['OK', 'ALREADY'].includes(r.status));

  const assets = sqlite
    .prepare(
      `SELECT a.id, a.name, a.unit, a.cny_per_unit,
              (SELECT balance FROM asset_snapshot s WHERE s.asset_id=a.id ORDER BY day DESC, id DESC LIMIT 1) AS cur,
              (SELECT balance FROM asset_snapshot s WHERE s.asset_id=a.id AND day < date('now','localtime') ORDER BY day DESC, id DESC LIMIT 1) AS prev
         FROM asset a`,
    )
    .all() as any[];

  const totalCny = assets.reduce((s, x) => s + (x.cur ?? 0) * x.cny_per_unit, 0);

  const lines: string[] = [];
  lines.push(`📊 签到汇总 ${new Date().toLocaleString('zh-CN')}`);
  lines.push(`成功 ${ok} · 已签 ${already} · 异常 ${bad.length}`);
  lines.push('');
  for (const a of assets) {
    if (a.cur == null) continue;
    const d = a.prev != null ? a.cur - a.prev : null;
    lines.push(
      `${a.name}: ${a.cur} ${a.unit} ≈¥${(a.cur * a.cny_per_unit).toFixed(2)}${d != null ? ` (${d > 0 ? '+' : ''}${d})` : ''}`,
    );
  }
  lines.push(`合计账面 ¥${totalCny.toFixed(2)}`);
  if (bad.length) {
    lines.push('');
    lines.push('需处理:');
    for (const b of bad) lines.push(`· ${b.name}: ${b.status}${b.detail ? ` — ${b.detail.slice(0, 60)}` : ''}`);
  }

  const summary = lines.join('\n');
  console.log('\n' + summary);

  // 供 cron 抓取
  const fs = await import('node:fs');
  fs.mkdirSync('logs', { recursive: true });
  fs.writeFileSync(
    `logs/summary-${new Date().toISOString().slice(0, 10)}.txt`,
    summary + '\n',
    'utf8',
  );
}

main().catch((e) => {
  console.error('调度失败:', e);
  process.exit(1);
});
