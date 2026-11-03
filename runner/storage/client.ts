/** SQLite 连接 + 建表 + 常用查询。better-sqlite3 同步 API，WAL 模式。 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema';
import {resolveDatabasePath} from './index.ts';

const DB_PATH = resolveDatabasePath();
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');

const DDL = `
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY, app TEXT NOT NULL, package TEXT NOT NULL,
  user_id INTEGER NOT NULL DEFAULT 0, cache_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1, note TEXT
);
CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
  steps_json TEXT NOT NULL, verify_any TEXT NOT NULL, balance_query TEXT,
  entry_text_any TEXT, asset_id TEXT, window_start TEXT, window_end TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'pending',
  plan_json TEXT
);
CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL,
  cny_per_unit REAL NOT NULL, expiry_days INTEGER, redeem_path TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS asset_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
  asset_id TEXT NOT NULL, account_id TEXT NOT NULL, balance REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'read', run_id INTEGER, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_snap_day ON asset_snapshot(day);
CREATE INDEX IF NOT EXISTS idx_snap_asset ON asset_snapshot(asset_id, day);
CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, day TEXT NOT NULL,
  account_id TEXT NOT NULL, activity_id TEXT NOT NULL, status TEXT NOT NULL,
  cache_hit INTEGER, cold_start INTEGER NOT NULL DEFAULT 0, prep_ms INTEGER,
  exec_ms INTEGER, balance_before REAL, balance_after REAL, error TEXT, evidence_dir TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER,
  cached_tokens INTEGER, model_calls INTEGER, model_name TEXT, usage_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_day ON run(day);
CREATE INDEX IF NOT EXISTS idx_run_act ON run(activity_id, day);
CREATE TABLE IF NOT EXISTS cache_state (
  account_id TEXT NOT NULL, activity_id TEXT NOT NULL, cache_file TEXT, updated_at TEXT,
  hits INTEGER NOT NULL DEFAULT 0, fails INTEGER NOT NULL DEFAULT 0,
  rebuild_count INTEGER NOT NULL DEFAULT 0, last_rebuild_at TEXT,
  PRIMARY KEY (account_id, activity_id)
);
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, account_id TEXT,
  activity_id TEXT, status TEXT NOT NULL DEFAULT 'queued', attempt INTEGER NOT NULL DEFAULT 0,
  max_attempt INTEGER NOT NULL DEFAULT 2, payload TEXT, error TEXT,
  created_at TEXT, started_at TEXT, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_status ON job(status, id);
CREATE TABLE IF NOT EXISTS objective (
  activity_id TEXT PRIMARY KEY, strategy TEXT NOT NULL DEFAULT 'all_tiers',
  max_seconds INTEGER NOT NULL DEFAULT 900, min_marginal_cny_per_hour REAL,
  fixed_count INTEGER, unit_reward REAL NOT NULL DEFAULT 0,
  unit_seconds REAL NOT NULL DEFAULT 35
);
CREATE TABLE IF NOT EXISTS tier (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL,
  at INTEGER NOT NULL, reward REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tier_act ON tier(activity_id, at);
CREATE TABLE IF NOT EXISTS probe (
  id INTEGER PRIMARY KEY AUTOINCREMENT, activity_id TEXT NOT NULL,
  probe_id TEXT NOT NULL, ask TEXT NOT NULL, parse TEXT NOT NULL DEFAULT 'int',
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_probe_act ON probe(activity_id, seq);
CREATE TABLE IF NOT EXISTS gain_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL,
  asset_id TEXT, source TEXT NOT NULL, units REAL NOT NULL, note TEXT
);
CREATE INDEX IF NOT EXISTS idx_gain_run ON gain_event(run_id);
CREATE TABLE IF NOT EXISTS cost_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, kind TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0, prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0, total_tokens INTEGER NOT NULL DEFAULT 0,
  ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cost_run ON cost_event(run_id);
CREATE TABLE IF NOT EXISTS model_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, run_id INTEGER,
  caller TEXT NOT NULL, model TEXT NOT NULL, endpoint TEXT,
  prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER,
  cached_tokens INTEGER, latency_ms INTEGER, status TEXT, error TEXT,
  request_digest TEXT
);
CREATE INDEX IF NOT EXISTS idx_call_run ON model_call(run_id);
CREATE INDEX IF NOT EXISTS idx_call_ts ON model_call(ts);
CREATE TABLE IF NOT EXISTS recipe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL, activity_id TEXT NOT NULL,
  task_name TEXT NOT NULL, kind TEXT,
  steps_json TEXT NOT NULL, run_id INTEGER,
  observed_at TEXT NOT NULL, outcome TEXT, retries INTEGER,
  tokens INTEGER, confidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipe_task ON recipe(activity_id, task_name);
CREATE TABLE IF NOT EXISTS run_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  stage TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  started_at TEXT NOT NULL,
  ms INTEGER,
  tokens INTEGER,
  calls INTEGER,
  ok INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_step_run ON run_step(run_id, seq);
CREATE TABLE IF NOT EXISTS task_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL, kind TEXT NOT NULL,
  steps_json TEXT NOT NULL, invariants_json TEXT, failure_modes_json TEXT,
  derived_from_json TEXT, confidence TEXT, updated_at TEXT,
  UNIQUE(platform, kind)
);
`;

sqlite.exec(DDL);

/** 增量迁移：给已存在的库补列（SQLite 支持 ADD COLUMN，重复执行安全） */
function ensureColumns(table: string, cols: Record<string, string>) {
  const existing = new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((r) => r.name),
  );
  for (const [name, type] of Object.entries(cols)) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

ensureColumns('activity', { plan_json: 'TEXT' });
ensureColumns('job', {
  result: 'TEXT', stage: 'TEXT', run_id: 'INTEGER',
  worker_pid: 'INTEGER', lease_token: 'TEXT', heartbeat_at: 'TEXT',
});

ensureColumns('run', {
  prompt_tokens: 'INTEGER',
  completion_tokens: 'INTEGER',
  total_tokens: 'INTEGER',
  cached_tokens: 'INTEGER',
  model_calls: 'INTEGER',
  model_name: 'TEXT',
  usage_json: 'TEXT',
});

export const db = drizzle(sqlite, { schema });
export { schema };
export const dbPath = DB_PATH;

/** 本地日期（CST）。不能用 toISOString 的 UTC 日期，否则凌晨跑会记到前一天。 */
export const today = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
export const nowIso = () => new Date().toISOString();

/** 最新一次余额 */
export function latestBalance(assetId: string, accountId: string): number | null {
  const row = sqlite
    .prepare(
      `SELECT balance FROM asset_snapshot WHERE asset_id = ? AND account_id = ?
       ORDER BY day DESC, id DESC LIMIT 1`,
    )
    .get(assetId, accountId) as { balance: number } | undefined;
  return row ? row.balance : null;
}

/** 某种资产：存量 / 今日净增 / 7 日均速 */
export function assetSummary(assetId: string, accountId: string) {
  const cur = latestBalance(assetId, accountId);
  const first = sqlite
    .prepare(
      `SELECT balance FROM asset_snapshot WHERE asset_id = ? AND account_id = ?
       ORDER BY day ASC, id ASC LIMIT 1`,
    )
    .get(assetId, accountId) as { balance: number } | undefined;
  const weekAgo = sqlite
    .prepare(
      `SELECT balance FROM asset_snapshot WHERE asset_id = ? AND account_id = ?
         AND day <= date('now','-7 day') ORDER BY day DESC, id DESC LIMIT 1`,
    )
    .get(assetId, accountId) as { balance: number } | undefined;

  const since = cur !== null && first ? cur - first.balance : null;
  const week = cur !== null && weekAgo ? cur - weekAgo.balance : null;
  return { current: cur, sinceFirst: since, weekDelta: week, weeklyAvg: week !== null ? week / 7 : null };
}
