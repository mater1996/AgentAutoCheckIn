/** 数据表定义（Drizzle）。资产导向：snapshot 是主数据，run 是执行记录。 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  app: text('app').notNull(),
  package: text('package').notNull(),
  userId: integer('user_id').notNull().default(0),
  cacheId: text('cache_id').notNull(),
  enabled: integer('enabled').notNull().default(1),
  note: text('note'),
});

export const activity = sqliteTable('activity', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  stepsJson: text('steps_json').notNull(),
  /** 新形态：{ entry, probes, task, collect, settle } */
  planJson: text('plan_json'),
  verifyAny: text('verify_any').notNull(),
  balanceQuery: text('balance_query'),
  entryTextAny: text('entry_text_any'),
  assetId: text('asset_id'),
  windowStart: text('window_start'),
  windowEnd: text('window_end'),
  enabled: integer('enabled').notNull().default(1),
  state: text('state').notNull().default('pending'),
});

/** 一种虚拟资产：淘金币 / 京豆 / … */
export const asset = sqliteTable('asset', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  /** 1 单位 = 多少人民币 */
  cnyPerUnit: real('cny_per_unit').notNull(),
  /** 有效期天数，null = 长期 */
  expiryDays: integer('expiry_days'),
  redeemPath: text('redeem_path'),
  note: text('note'),
});

/** 每次读到的余额（主数据） */
export const assetSnapshot = sqliteTable(
  'asset_snapshot',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    day: text('day').notNull(),
    assetId: text('asset_id').notNull(),
    accountId: text('account_id').notNull(),
    balance: real('balance').notNull(),
    source: text('source').notNull().default('read'),
    runId: integer('run_id'),
    note: text('note'),
  },
  (t) => ({
    idxDay: index('idx_snap_day').on(t.day),
    idxAsset: index('idx_snap_asset').on(t.assetId, t.day),
  }),
);

/** 每次执行 */
export const run = sqliteTable(
  'run',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ts: text('ts').notNull(),
    day: text('day').notNull(),
    accountId: text('account_id').notNull(),
    activityId: text('activity_id').notNull(),
    status: text('status').notNull(),
    cacheHit: integer('cache_hit'),
    coldStart: integer('cold_start').notNull().default(0),
    prepMs: integer('prep_ms'),
    execMs: integer('exec_ms'),
    balanceBefore: real('balance_before'),
    balanceAfter: real('balance_after'),
    error: text('error'),
    evidenceDir: text('evidence_dir'),
  },
  (t) => ({
    idxDay: index('idx_run_day').on(t.day),
    idxAct: index('idx_run_act').on(t.activityId, t.day),
  }),
);

/** 缓存健康 */
export const cacheState = sqliteTable('cache_state', {
  accountId: text('account_id').notNull(),
  activityId: text('activity_id').notNull(),
  cacheFile: text('cache_file'),
  updatedAt: text('updated_at'),
  hits: integer('hits').notNull().default(0),
  fails: integer('fails').notNull().default(0),
  rebuildCount: integer('rebuild_count').notNull().default(0),
  lastRebuildAt: text('last_rebuild_at'),
});

/** 任务队列 */
export const job = sqliteTable(
  'job',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind').notNull(),
    accountId: text('account_id'),
    activityId: text('activity_id'),
    status: text('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    maxAttempt: integer('max_attempt').notNull().default(2),
    payload: text('payload'),
    error: text('error'),
    createdAt: text('created_at'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => ({ idxStatus: index('idx_job_status').on(t.status, t.id) }),
);

// ────────────────────────────────────────────────────────────
// 目标模型：把"做到什么程度为止"从自然语言里拆出来变成数据
// ────────────────────────────────────────────────────────────

/** 活动目标：追什么、追到哪里停、时间上限 */
export const objective = sqliteTable('objective', {
  activityId: text('activity_id').primaryKey(),
  /** all_tiers 追完所有档位 / first_tier 只追首档 / fixed 固定次数 */
  strategy: text('strategy').notNull().default('all_tiers'),
  /** 硬时间上限（秒） */
  maxSeconds: integer('max_seconds').notNull().default(900),
  /** 边际收益阈值（¥/小时），null = 不筛选 */
  minMarginalCnyPerHour: real('min_marginal_cny_per_hour'),
  /** strategy=fixed 时的目标次数 */
  fixedCount: integer('fixed_count'),
  /** 单任务预计获得单位数 */
  unitReward: real('unit_reward').notNull().default(0),
  /** 单任务预计耗时（秒） */
  unitSeconds: real('unit_seconds').notNull().default(35),
});

/** 档位阶梯：进度到 at 时解锁 reward */
export const tier = sqliteTable(
  'tier',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    activityId: text('activity_id').notNull(),
    at: integer('at').notNull(),
    reward: real('reward').notNull(),
  },
  (t) => ({ idxAct: index('idx_tier_act').on(t.activityId, t.at) }),
);

/** 探测定义：问什么、怎么解析 */
export const probe = sqliteTable(
  'probe',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    activityId: text('activity_id').notNull(),
    probeId: text('probe_id').notNull(),
    ask: text('ask').notNull(),
    /** fraction = a/b 进度 / int = 纯整数 / boolean = 是非 */
    parse: text('parse').notNull().default('int'),
    seq: integer('seq').notNull().default(0),
  },
  (t) => ({ idxAct: index('idx_probe_act').on(t.activityId, t.seq) }),
);

/** 收益明细：+120 拆成 90（任务）+ 30（档位） */
export const gainEvent = sqliteTable(
  'gain_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id').notNull(),
    assetId: text('asset_id'),
    /** task / tier / bonus / settle */
    source: text('source').notNull(),
    units: real('units').notNull(),
    note: text('note'),
  },
  (t) => ({ idxRun: index('idx_gain_run').on(t.runId) }),
);

/** 成本明细：按调用意图拆分 token */
export const costEvent = sqliteTable(
  'cost_event',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id').notNull(),
    /** planning / locate / insight */
    kind: text('kind').notNull(),
    calls: integer('calls').notNull().default(0),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    ms: integer('ms'),
  },
  (t) => ({ idxRun: index('idx_cost_run').on(t.runId) }),
);
