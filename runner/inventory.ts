/**
 * 清单数据结构、兼容旧版单页观测的规整和持久化。
 * 完整滚动收集见 inventory-scan.ts。
 */
import path from 'node:path';
import {readStateFile,stateFileExists,writeStateFile} from './storage/structured.ts';

export type InventoryTask = {
  name: string;
  /** Actual visible requirement; never inferred from the display name. */
  instruction?: string;
  quota: string; // "0/1"
  button: string; // 去完成 / 去逛逛 / 已完成
  quotaTotal: number;
  quotaDone: number;
  remaining: number;
  /** 该任务单次完成给的淘金币数（实测每个任务不同：20~50） */
  reward: number;
  /** 该任务行右侧按钮的归一化坐标，收集时一次拿到，避免再单独定位 */
  at?: [number, number];
};

export type InventoryTier = {
  coin: number;
  need: string;
  button: string; // 立即领取 / 已领取 / 未达成
  claimed: boolean;
};

export type InventoryCompleteness = {
  full: boolean;
  reason: string;
  pages: number;
  coverage: { top: boolean; bottom: boolean; returnedToTop: boolean };
};

export type InventoryPageObservation = {
  pageIsTaskPanel: boolean;
  blocked: boolean;
  atTop: boolean;
  atBottom: boolean;
  progress?: string | null;
  tiers: { coin: number; need: string; button: string }[];
  tasks: { name: string; instruction: string; quota: string; button: string; reward: number }[];
};

export type Inventory = {
  collected_at: string;
  account: string;
  activity: string;
  progress: { done: number; total: number };
  tiers: InventoryTier[];
  tasks: InventoryTask[];
  total_remaining: number;
  completeness?: InventoryCompleteness;
  source?: { kind: 'scroll-scan'; evidenceFile: string };
};

export const INVENTORY_PROMPT = `只回复 JSON，不要任何解释文字：
{
  "progress": "今日累计奖励的完成进度，形如 6/20",
  "tiers": [{"coin": 数字, "need": "如10次任务/20次任务/已达成", "button": "立即领取或已领取或未达成"}],
  "tasks": [{
    "name": "任务名称",
    "instruction": "任务副标题/完成要求的原文；看不到填空字符串，不根据名称猜测",
    "quota": "如0/1或0/5",
    "button": "去完成或去逛逛或逛一逛或已完成",
    "reward": 该任务右侧标注的淘金币奖励数字（如 45），只要数字不要单位；读不到填 0,
    "at": [该任务这一行右侧按钮的归一化中心坐标 x, y，0~1 相对整屏宽高]
  }]
}
坐标必须是 0~1 的小数（例如 0.87、0.44），不是像素。`;

function parseQuota(q: unknown): { total: number; done: number } {
  const m = String(q ?? '').match(/(\d+)\s*\/\s*(\d+)/);
  if (!m || Number(m[2]) <= 0 || Number(m[1]) > Number(m[2])) {
    throw new Error(`任务配额 quota 无效：${JSON.stringify(q)}`);
  }
  return { done: Number(m[1]), total: Number(m[2]) };
}

function parseProgress(p: unknown): { done: number; total: number } {
  const m = String(p ?? '').match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m || Number(m[2]) <= 0) throw new Error(`任务进度 progress 无效：${JSON.stringify(p)}`);
  return { done: Number(m[1]), total: Number(m[2]) };
}

/** 把模型返回的原始对象规整成 Inventory */
export function normalizeInventory(
  raw: any,
  account: string,
  activity: string,
  options: { requireComplete?: boolean } = {},
): Inventory {
  const completeness: InventoryCompleteness | undefined = raw?.completeness;
  if (options.requireComplete && (!completeness?.full || !completeness.coverage?.top
    || !completeness.coverage?.bottom || !completeness.coverage?.returnedToTop
    || !Number.isInteger(completeness.pages) || completeness.pages < 1)) {
    throw new Error('任务清单不完整：需要完整滚动扫描并确认顶部、底部和归位');
  }
  const progress = parseProgress(raw?.progress);
  const tiers: InventoryTier[] = (Array.isArray(raw?.tiers) ? raw.tiers : []).map((t: any) => ({
    coin: Number(t?.coin ?? 0),
    need: String(t?.need ?? ''),
    button: String(t?.button ?? ''),
    claimed: /已领/.test(String(t?.button ?? '')),
  }));

  const tasks: InventoryTask[] = (Array.isArray(raw?.tasks) ? raw.tasks : []).map((t: any) => {
    const q = parseQuota(t?.quota);
    // 坐标容错：模型可能给 [x,y] 或 {x,y}
    let at: [number, number] | undefined;
    const cand = Array.isArray(t?.at) ? t.at : t?.at && typeof t.at === 'object' ? [t.at.x, t.at.y] : null;
    if (cand && cand.length === 2) {
      const x = Number(cand[0]);
      const y = Number(cand[1]);
      if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        at = [Number(x.toFixed(4)), Number(y.toFixed(4))];
      }
    }
    return {
      name: String(t?.name ?? ''),
      instruction: String(t?.instruction ?? ''),
      quota: String(t?.quota ?? ''),
      button: String(t?.button ?? ''),
      quotaTotal: q.total,
      quotaDone: q.done,
      remaining: Math.max(0, q.total - q.done),
      reward: Number(t?.reward) || 0,
      at,
    };
  });

  const total_remaining = tasks
    .filter((t) => !/已完成/.test(t.button))
    .reduce((a, t) => a + t.remaining, 0);

  return {
    collected_at: new Date().toISOString(),
    account,
    activity,
    progress,
    tiers,
    tasks,
    total_remaining,
    ...(completeness ? { completeness } : {}),
    ...(raw?.source ? { source: raw.source } : {}),
  };
}

/** 落盘：data/inventory/<account>_<activity>.json，同时保留一份带时间戳的历史 */
export function saveInventory(inv: Inventory): { latest: string; history: string } {
  const dir = path.resolve('data', 'inventory');
  const latest = path.join(dir, `${inv.account}_${inv.activity}.json`);
  writeStateFile(latest, inv);

  const stamp = inv.collected_at.replace(/[:.]/g, '-');
  const history = path.join(dir, `${inv.account}_${inv.activity}_${stamp}.json`);
  writeStateFile(history, inv);

  return { latest, history };
}

/** Only observations collected during this execution session are executable. */
export function inventoryMatchesSession(inv: Inventory, account: string, activity: string, started: Date): boolean {
  const observed = Date.parse(inv.collected_at);
  return inv.account === account && inv.activity === activity && Number.isFinite(observed)
    && observed >= started.getTime() && observed <= Date.now() + 1000;
}

/** 读最新的 inventory 文件；历史查看用，不能直接证明当前页面任务。 */
export function loadInventoryLatest(account: string, activity: string): Inventory | null {
  const f = path.resolve('data', 'inventory', `${account}_${activity}.json`);
  if (!stateFileExists(f)) return null;
  try {
    return readStateFile(f) as Inventory;
  } catch {
    return null;
  }
}
