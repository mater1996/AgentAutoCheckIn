/**
 * 配置加载 + 同步到 SQLite。
 * YAML 是唯一真源；DB 是只读镜像，供执行器和面板查询。
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { db, schema, sqlite } from '../db/client';

export type PrepCfg = {
  entry_text_any?: string[];
  /** 出现即中止（风控/验证/滑块），命中交人工，不绕过 */
  block_text_any?: string[];
  max_backs?: number;
  max_prep_ms?: number;
};

export type AccountCfg = {
  id: string;
  app: string;
  package: string;
  user_id?: number;
  cache_id?: string;
  enabled?: boolean;
  note?: string;
  prep?: PrepCfg;
};

export type Step = {
  do:
    | 'ai'
    | 'read'
    | 'dwell'
    | 'back'
    | 'swipe'
    | 'repeat'
    | 'tap_text'
    | 'wait_for'
    | 'if'
    | 'assert_text'
    /** 归一化坐标点击：0 调用，用于已验证的固定路径 */
    | 'tap'
    /** 执行任意 adb shell 命令：0 调用，用于强制归位等 */
    | 'shell'
    /** 单步视觉定位点击：只 locate 不 planning，比 ai 便宜一半以上 */
    | 'ai_tap'
    /** 单步视觉输入：只 locate 输入框 + 输入，不 planning */
    | 'ai_input';
  say?: string;
  optional?: boolean;
  as?: 'before' | 'after';
  seconds?: number;
  wait?: number;
  times?: number;
  direction?: 'up' | 'down';
  max?: number;
  stop_when?: string;
  each?: Step[];
  text?: string;
  timeout_ms?: number;
  /** tap 步骤的归一化坐标（0~1） */
  x?: number;
  y?: number;
  /** if 分支：本地文本条件（命中任一即真），0 模型调用 */
  cond_text?: string[];
  /** if 分支：自然语言条件，走 aiBoolean（1 次调用） */
  cond_ai?: string;
  /** if 分支：条件成立时执行 */
  then?: Step[];
  /** if 分支：条件不成立时执行 */
  else?: Step[];
  /** assert_text：要求屏幕上出现任一文本，否则抛错（0 调用） */
  any?: string[];
};

export type ActivityCfg = {
  id: string;
  name: string;
  account_id: string;
  asset_id?: string;
  window?: [string, string];
  budget_ms?: number;
  /** 旧形态：一条直线流程。新形态（objective+task）可以省略 */
  flow?: Step[];
  verify?: { any?: string[]; balance_grew_counts?: boolean };

  // ── 新形态：目标驱动的标准流程 ──
  /** 要什么、追到哪里停 */
  objective?: {
    strategy?: 'all_tiers' | 'first_tier' | 'fixed';
    max_seconds?: number;
    min_marginal_cny_per_hour?: number;
    fixed_count?: number;
    unit_reward?: number;
    unit_seconds?: number;
  };
  /** 档位阶梯 */
  tiers?: { at: number; reward: number }[];
  /** 进入任务页的步骤（含 before 读数） */
  entry?: Step[];
  /** 探测定义 */
  probes?: { id: string; ask: string; parse?: 'fraction' | 'int' | 'boolean' }[];
  /** 任务单元：做什么 + 怎么做 */
  task?: { select?: string; steps: Step[]; completion_markers?: string[] };
  /** 领奖励 */
  collect?: { when?: 'claimable' | 'always' | 'never'; probe?: string; steps: Step[] };
  /** 结算 */
  settle?: { read?: 'before' | 'after'; say: string; steps?: Step[] };
  /** 探测失败时的补救步骤（通常是"没进到目标页"） */
  recover?: Step[];
};

const ROOT = process.cwd();
const ACCOUNTS = path.join(ROOT, 'config', 'accounts.yaml');
const ASSETS = path.join(ROOT, 'config', 'assets.yaml');
const ACT_DIR = path.join(ROOT, 'config', 'activities');

export type AssetCfg = {
  id: string;
  platform: string;
  name: string;
  unit: string;
  cny_per_unit: number;
  expiry_days?: number | null;
  redeem_path?: string;
  note?: string;
};

export function loadAssets(): AssetCfg[] {
  if (!fs.existsSync(ASSETS)) return [];
  const doc = readYaml<{ assets?: AssetCfg[] }>(ASSETS);
  return doc.assets ?? [];
}

function readYaml<T>(p: string): T {
  return YAML.parse(fs.readFileSync(p, 'utf8')) as T;
}

export function loadAccounts(): AccountCfg[] {
  if (!fs.existsSync(ACCOUNTS)) return [];
  const doc = readYaml<{ accounts?: AccountCfg[] }>(ACCOUNTS);
  return doc.accounts ?? [];
}

export function loadActivities(): ActivityCfg[] {
  if (!fs.existsSync(ACT_DIR)) return [];
  const out: ActivityCfg[] = [];
  for (const f of fs.readdirSync(ACT_DIR).filter((x) => /\.ya?ml$/.test(x))) {
    const doc = readYaml<{ app?: string; activities?: ActivityCfg[] }>(path.join(ACT_DIR, f));
    for (const a of doc.activities ?? []) {
      if (!a.id || !a.account_id) {
        throw new Error(`${f}: 活动 ${a.id ?? '(无 id)'} 缺少必需字段（id / account_id）`);
      }
      // 两种形态二选一：旧 flow，或新 task 驱动
      const hasFlow = Array.isArray(a.flow) && a.flow.length > 0;
      const hasTask = !!a.task?.steps?.length;
      if (!hasFlow && !hasTask) {
        throw new Error(`${f}: 活动 ${a.id} 必须提供 flow 或 task.steps 之一`);
      }
      if (hasTask && !a.probes?.length) {
        throw new Error(`${f}: 活动 ${a.id} 用了 task 但没定义 probes（无法探测状态）`);
      }
      out.push(a);
    }
  }
  return out;
}

/** 统计流程里会用到的模型调用上限，用于预算与可观测 */
export function estimateSteps(flow: Step[]): { ai: number; total: number } {
  let ai = 0;
  let total = 0;
  for (const s of flow) {
    total++;
    if (s.do === 'ai' || s.do === 'wait_for') ai++;
    if (s.do === 'repeat' && Array.isArray(s.each)) {
      const inner = estimateSteps(s.each);
      ai += inner.ai * (s.max ?? 1);
      total += inner.total * (s.max ?? 1);
    }
  }
  return { ai, total };
}

export function syncToDb() {
  const assets = loadAssets();
  const accounts = loadAccounts();
  const activities = loadActivities();

  for (const x of assets) {
    const v = {
      platform: x.platform,
      name: x.name,
      unit: x.unit,
      cnyPerUnit: x.cny_per_unit,
      expiryDays: x.expiry_days ?? null,
      redeemPath: x.redeem_path ?? null,
      note: x.note ?? null,
    };
    db.insert(schema.asset)
      .values({ id: x.id, ...v })
      .onConflictDoUpdate({ target: schema.asset.id, set: v })
      .run();
  }

  for (const a of accounts) {
    db.insert(schema.account)
      .values({
        id: a.id,
        app: a.app,
        package: a.package,
        userId: a.user_id ?? 0,
        cacheId: a.cache_id ?? a.id,
        enabled: a.enabled === false ? 0 : 1,
        note: a.note ?? null,
      })
      .onConflictDoUpdate({
        target: schema.account.id,
        set: {
          app: a.app,
          package: a.package,
          userId: a.user_id ?? 0,
          cacheId: a.cache_id ?? a.id,
          enabled: a.enabled === false ? 0 : 1,
          note: a.note ?? null,
        },
      })
      .run();
  }

  for (const a of activities) {
    const est = estimateSteps(a.flow ?? a.task?.steps ?? []);
    const verifyAny = (a.verify?.any ?? []).join(',');
    const planJson = a.task
      ? JSON.stringify({
          entry: a.entry ?? [],
          probes: a.probes ?? [],
          task: a.task,
          collect: a.collect ?? null,
          settle: a.settle ?? null,
          recover: a.recover ?? [],
        })
      : null;
    const vals = {
      accountId: a.account_id,
      name: a.name,
      stepsJson: JSON.stringify(a.flow ?? []), // 旧形态；新形态为空数组
      planJson, // 新形态的结构化计划
      verifyAny,
      assetId: a.asset_id ?? null,
      windowStart: a.window?.[0] ?? null,
      windowEnd: a.window?.[1] ?? null,
    };
    db.insert(schema.activity)
      .values({
        id: a.id,
        ...vals,
        balanceQuery: null,
        entryTextAny: null,
        enabled: 1,
        state: 'active',
      })
      .onConflictDoUpdate({ target: schema.activity.id, set: vals })
      .run();

    // ── 目标模型落库 ──
    if (a.objective) {
      const o = {
        strategy: a.objective.strategy ?? 'all_tiers',
        maxSeconds: a.objective.max_seconds ?? 900,
        minMarginalCnyPerHour: a.objective.min_marginal_cny_per_hour ?? null,
        fixedCount: a.objective.fixed_count ?? null,
        unitReward: a.objective.unit_reward ?? 0,
        unitSeconds: a.objective.unit_seconds ?? 35,
      };
      db.insert(schema.objective)
        .values({ activityId: a.id, ...o })
        .onConflictDoUpdate({ target: schema.objective.activityId, set: o })
        .run();
    }

    // 档位与探测：先清后插，保证 YAML 是唯一真源
    sqlite.prepare('DELETE FROM tier WHERE activity_id = ?').run(a.id);
    for (const t of a.tiers ?? []) {
      db.insert(schema.tier).values({ activityId: a.id, at: t.at, reward: t.reward }).run();
    }
    sqlite.prepare('DELETE FROM probe WHERE activity_id = ?').run(a.id);
    (a.probes ?? []).forEach((p, i) => {
      db.insert(schema.probe)
        .values({ activityId: a.id, probeId: p.id, ask: p.ask, parse: p.parse ?? 'int', seq: i })
        .run();
    });

    const mode = a.task ? `task 驱动（${a.probes?.length ?? 0} 个探测、${a.tiers?.length ?? 0} 个档位）` : `flow ${a.flow!.length} 步`;
    console.log(`  sync ${a.id}: ${mode}, 预计模型调用 ≤${est.ai}`);
  }

  console.log(`同步完成：${accounts.length} 个账号，${activities.length} 个活动`);
  return { accounts: accounts.length, activities: activities.length };
}

/** 读某账号的 Prep 配置 */
export function prepFor(accountId: string) {
  const a = loadAccounts().find((x) => x.id === accountId);
  return {
    // package 必须带上：prep 里冷启动要 am start，缺了它 launchApp(undefined) 直接失败
    package: a?.package ?? '',
    coldStart: false,
    entryActivityAny: a?.prep?.entry_activity_any ?? [],
    entryTextAny: a?.prep?.entry_text_any ?? ['我的淘宝', '购物车'],
    blockTextAny: a?.prep?.block_text_any ?? ['验证后', '滑块', '人机验证', '安全验证'],
    maxBacks: a?.prep?.max_backs ?? 3,
    maxPrepMs: a?.prep?.max_prep_ms ?? 75000,
  };
}


/** 读某平台的任务类型规则（config/tasks/<platform>.yaml） */
export function loadTaskRules(platform: string): any | null {
  const f = path.join(ROOT, 'config', 'tasks', `${platform}.yaml`);
  if (!fs.existsSync(f)) return null;
  return readYaml<any>(f);
}
