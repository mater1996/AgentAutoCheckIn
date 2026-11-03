/** 记账：写 run / asset_snapshot / cache_state，并提供初始化种子数据。 */
import { eq, and } from 'drizzle-orm';
import { db, nowIso, schema, sqlite, today } from '../db/client';

export type RunInput = {
  accountId: string;
  activityId: string;
  status: string;
  cacheHit?: boolean | null;
  coldStart?: boolean;
  prepMs?: number | null;
  execMs?: number | null;
  balanceBefore?: number | null;
  balanceAfter?: number | null;
  error?: string | null;
  evidenceDir?: string | null;
  /** Midscene agent.metrics 快照 */
  usage?: {
    totalPromptTokens?: number;
    totalCompletionTokens?: number;
    totalTokens?: number;
    totalCachedInput?: number;
    calls?: number;
    byIntent?: Record<string, any>;
    byModel?: Record<string, any>;
  } | null;
  modelName?: string | null;
};

export function recordRun(r: RunInput): number {
  const u = r.usage;
  const info = db
    .insert(schema.run)
    .values({
      ts: nowIso(),
      day: today(),
      accountId: r.accountId,
      activityId: r.activityId,
      status: r.status,
      cacheHit: r.cacheHit == null ? null : r.cacheHit ? 1 : 0,
      coldStart: r.coldStart ? 1 : 0,
      prepMs: r.prepMs ?? null,
      execMs: r.execMs ?? null,
      balanceBefore: r.balanceBefore ?? null,
      balanceAfter: r.balanceAfter ?? null,
      error: r.error ?? null,
      evidenceDir: r.evidenceDir ?? null,
      promptTokens: u?.totalPromptTokens ?? null,
      completionTokens: u?.totalCompletionTokens ?? null,
      totalTokens: u?.totalTokens ?? null,
      cachedTokens: u?.totalCachedInput ?? null,
      modelCalls: u?.calls ?? null,
      modelName: r.modelName ?? null,
      usageJson: u ? JSON.stringify({ byIntent: u.byIntent, byModel: u.byModel }) : null,
    })
    .run();
  return Number(info.lastInsertRowid);
}

/**
 * 建一条「运行中」的 run，先拿到 id。
 *
 * 为什么必须先建：计量代理按 x-run-id 把模型调用归到具体 run。
 * 旧实现是跑完才 recordRun，执行期间 runId 一直是 0，
 * 所以 model_call 里的记录全归不到任何 run（实测 204 条里 203 条 run_id=999）。
 */
export function startRun(p: { accountId: string; activityId: string; coldStart?: boolean }): number {
  const info = db
    .insert(schema.run)
    .values({
      ts: nowIso(),
      day: today(),
      accountId: p.accountId,
      activityId: p.activityId,
      status: 'RUNNING',
      coldStart: p.coldStart ? 1 : 0,
    })
    .run();
  return Number(info.lastInsertRowid);
}

/** 跑完后回填结果 */
export function finishRun(
  runId: number,
  p: {
    status: string;
    prepMs?: number | null;
    execMs?: number | null;
    balanceBefore?: number | null;
    balanceAfter?: number | null;
    error?: string | null;
    evidenceDir?: string | null;
    usage?: RunInput['usage'];
    modelName?: string | null;
    cacheHit?: boolean | null;
  },
): void {
  const u = p.usage;
  sqlite
    .prepare(
      `UPDATE run SET status=?, prep_ms=?, exec_ms=?, balance_before=?, balance_after=?,
         error=?, evidence_dir=?, prompt_tokens=?, completion_tokens=?, total_tokens=?,
         cached_tokens=?, model_calls=?, model_name=?, usage_json=?
       WHERE id=?`,
    )
    .run(
      p.status,
      p.prepMs ?? null,
      p.execMs ?? null,
      p.balanceBefore ?? null,
      p.balanceAfter ?? null,
      p.error ?? null,
      p.evidenceDir ?? null,
      u?.totalPromptTokens ?? null,
      u?.totalCompletionTokens ?? null,
      u?.totalTokens ?? null,
      u?.totalCachedInput ?? null,
      u?.calls ?? null,
      p.modelName ?? null,
      u ? JSON.stringify({ byIntent: u.byIntent, byModel: u.byModel }) : null,
      runId,
    );
}

export function recordSnapshot(p: {
  assetId: string;
  accountId: string;
  balance: number;
  runId?: number | null;
  source?: string;
  note?: string;
}) {
  db.insert(schema.assetSnapshot)
    .values({
      ts: nowIso(),
      day: today(),
      assetId: p.assetId,
      accountId: p.accountId,
      balance: p.balance,
      source: p.source ?? 'read',
      runId: p.runId ?? null,
      note: p.note ?? null,
    })
    .run();
}

/** 收益明细：把一次执行的收益拆成来源（task / tier / bonus） */
export function recordGain(p: {
  runId: number;
  assetId?: string | null;
  source: 'task' | 'tier' | 'bonus' | 'settle';
  units: number;
  note?: string;
}) {
  if (!Number.isFinite(p.units) || p.units === 0) return;
  db.insert(schema.gainEvent)
    .values({
      runId: p.runId,
      assetId: p.assetId ?? null,
      source: p.source,
      units: p.units,
      note: p.note ?? null,
    })
    .run();
}

/** 成本明细：按调用意图拆分 token */
export function recordCost(p: {
  runId: number;
  kind: string;
  calls?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  ms?: number | null;
}) {
  db.insert(schema.costEvent)
    .values({
      runId: p.runId,
      kind: p.kind,
      calls: p.calls ?? 0,
      promptTokens: p.promptTokens ?? 0,
      completionTokens: p.completionTokens ?? 0,
      totalTokens: p.totalTokens ?? 0,
      ms: p.ms ?? null,
    })
    .run();
}

export function bumpCache(accountId: string, activityId: string, hit: boolean) {
  const row = db
    .select()
    .from(schema.cacheState)
    .where(and(eq(schema.cacheState.accountId, accountId), eq(schema.cacheState.activityId, activityId)))
    .get();

  if (!row) {
    db.insert(schema.cacheState)
      .values({
        accountId,
        activityId,
        updatedAt: nowIso(),
        hits: hit ? 1 : 0,
        fails: hit ? 0 : 1,
      })
      .run();
    return;
  }
  sqlite
    .prepare(
      `UPDATE cache_state SET hits = hits + ?, fails = fails + ?, updated_at = ?
       WHERE account_id = ? AND activity_id = ?`,
    )
    .run(hit ? 1 : 0, hit ? 0 : 1, nowIso(), accountId, activityId);
}

/** 初始化：账号 + 资产 + 活动 */
export function seed() {
  db.insert(schema.asset)
    .values([
      {
        id: 'taobao_coins',
        platform: 'taobao',
        name: '淘金币',
        unit: '金币',
        cnyPerUnit: 0.01,
        expiryDays: null,
        redeemPath: '淘宝下单抵扣 / 淘金币频道兑换',
      },
      {
        id: 'jd_beads',
        platform: 'jd',
        name: '京豆',
        unit: '京豆',
        cnyPerUnit: 0.01,
        expiryDays: 180,
        redeemPath: '京东下单抵扣（单笔最高抵 50%）',
      },
    ])
    .onConflictDoNothing()
    .run();

  db.insert(schema.account)
    .values({
      id: 'tb_main',
      app: 'taobao',
      package: 'com.taobao.taobao',
      userId: 0,
      cacheId: 'tb_main',
      enabled: 1,
      note: '主空间淘宝',
    })
    .onConflictDoNothing()
    .run();

  db.insert(schema.activity)
    .values({
      id: 'tb_coin_signin',
      accountId: 'tb_main',
      name: '淘金币签到',
      assetId: 'taobao_coins',
      stepsJson: JSON.stringify([
        '点击淘宝首页上方图标区的「领淘金币」，进入淘金币页面',
        '点击页面下方的「赚更多金币」按钮，进入赚金币任务页',
        '点击页面顶部的「立即领取」按钮，领取今日已完成的累计奖励',
      ]),
      verifyAny: '已领取,领取成功,明天再来,已领完',
      balanceQuery: '页面顶部「淘金币」字样旁边显示的金币总数是多少？只回复数字，不要单位和逗号',
      entryTextAny: '我的淘宝,购物车',
      windowStart: '09:00',
      windowEnd: '21:00',
      enabled: 1,
      state: 'active',
    })
    .onConflictDoNothing()
    .run();
}
