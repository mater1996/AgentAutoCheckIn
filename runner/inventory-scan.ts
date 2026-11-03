import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeInventory, type Inventory, type InventoryCompleteness, type InventoryPageObservation } from './inventory';

/** Matches the installed Midscene aiScroll(prompt, options) overload. */
export type InventoryScanAgent = {
  aiQuery: (prompt: string) => Promise<unknown>;
  aiScroll: (prompt: string | undefined, options: {
    direction: 'up' | 'down'; scrollType: 'scrollToTop' | 'singleAction'; distance?: number;
  }) => Promise<unknown>;
};
export type InventoryScanOptions = {
  account: string;
  activity: string;
  maxPages?: number;
  /** Pixels, deliberately smaller than a viewport to retain overlapping rows. */
  scrollDistance?: number;
  evidenceDir?: string;
  overBudget?: () => boolean;
};
export type InventoryScanResult = {
  ok: boolean;
  inventory: Inventory | null;
  completeness: InventoryCompleteness;
  pages: { page: number; raw: unknown }[];
  evidenceFile: string;
  detail?: string;
};

export const INVENTORY_PAGE_PROMPT = `只读取当前可见画面，一次返回以下 JSON，不执行点击，不推断屏外任务：
{
  "pageIsTaskPanel": 是否明确为本活动的任务列表面板，布尔值,
  "blocked": 是否有登录、安全验证、滑块、加载遮挡或另一个弹窗阻止读取任务列表，布尔值,
  "atTop": 是否明确已经到任务列表最顶部，布尔值,
  "atBottom": 是否明确看到任务列表末尾/底部，布尔值,
  "progress": "可见的本活动今日任务累计进度原文，如5/20；看不到填null",
  "tiers": [{"coin": 奖励数字, "need": "原文条件", "button": "原文按钮"}],
  "tasks": [{"name": "完整任务名称原文，保留全部字符", "instruction": "副标题/完成要求的完整原文；看不到填空字符串，禁止按名称猜测", "quota": "原文配额，如0/5", "button": "原文操作按钮", "reward": 可见奖励数字，读不到填0}]
}
任务面板本身（即使是底部抽屉/浮层）不是blocked；只有独立遮挡、登录、安全验证或加载才是blocked。
只收集名称、要求、配额、按钮均可读的完整任务行；不要截断名称，不要猜测下一行。
instruction只抄任务要求文字，不拼接右侧金币图标、币、+奖励数字、配额或按钮；这些信息已各有独立字段。原文中的标点保留，文字与奖励图标之间的布局空白不是标点，不添加逗号。
顶部/底部必须有可见依据；看不到后续行或滚动没变化不证明到底。下部页面进度和档位不可见时返回null和[]，不要编造。
不要返回按钮坐标，滚动后的坐标不能复用。`;
const SCROLL_TARGET = '当前活动任务面板内可滚动的任务列表区域，保留面板，不点击任何任务或领取按钮';

function validCounter(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d+\s*\/\s*\d+$/.test(value)) return false;
  const [done, total] = value.split('/').map(Number);
  return Number.isSafeInteger(done) && Number.isSafeInteger(total) && total > 0 && done >= 0 && done <= total;
}

function readPage(raw: any): InventoryPageObservation {
  if (!raw || ['pageIsTaskPanel', 'blocked', 'atTop', 'atBottom'].some(key => typeof raw[key] !== 'boolean')) {
    throw new Error('任务面板边界观测无效');
  }
  if (raw.pageIsTaskPanel !== true || raw.blocked !== false) throw new Error('任务面板未确认或存在遮挡');
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.tiers)) throw new Error('任务/档位列表观测无效');
  const tasks = raw.tasks.map((t: any) => {
    if (!t || typeof t.name !== 'string' || !t.name.trim() || typeof t.instruction !== 'string'
      || typeof t.button !== 'string' || !t.button.trim() || typeof t.quota !== 'string'
      || !validCounter(t.quota) || typeof t.reward !== 'number' || !Number.isFinite(t.reward) || t.reward < 0) {
      throw new Error('任务名称/要求/配额/按钮/奖励观测无效');
    }
    // Reuse quota validation, preserving the exact observed strings.
    normalizeInventory({ progress: '0/1', tasks: [t] }, '', '');
    return { name: t.name, instruction: t.instruction, quota: t.quota, button: t.button, reward: t.reward };
  });
  const tiers = raw.tiers.map((t: any) => {
    if (!t || typeof t.coin !== 'number' || !Number.isFinite(t.coin) || t.coin <= 0
      || typeof t.need !== 'string' || typeof t.button !== 'string') throw new Error('档位观测无效');
    return { coin: t.coin, need: t.need, button: t.button };
  });
  if (raw.progress != null && raw.progress !== '' && !validCounter(raw.progress)) throw new Error('任务累计进度无效');
  return { pageIsTaskPanel: true, blocked: false, atTop: raw.atTop, atBottom: raw.atBottom,
    progress: raw.progress, tasks, tiers };
}

/** Read-only inventory collection: bounded scrolls and grouped observations, never task actions. */
export async function collectInventory(agent: InventoryScanAgent, options: InventoryScanOptions): Promise<InventoryScanResult> {
  const maxPages = options.maxPages ?? 12;
  const distance = options.scrollDistance ?? 200;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('maxPages 必须是1到100的整数');
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('scrollDistance 必须是正数');
  const evidenceDir = path.resolve(options.evidenceDir ?? 'data/evidence/inventory-scans');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidenceFile = path.join(evidenceDir, `${randomUUID()}.json`);
  const pages: InventoryScanResult['pages'] = [];
  const coverage = { top: false, bottom: false, returnedToTop: false };
  const tasks = new Map<string, InventoryPageObservation['tasks'][number]>();
  const tiers = new Map<string, InventoryPageObservation['tiers'][number]>();
  let progress: string | undefined;
  let reason = 'MAX_PAGES';
  let detail: string | undefined;
  let returnToTop: { raw?: unknown; error?: string } = {};
  let lastSignature: string | undefined;
  let repeats = 0;
  let topSignature: string | undefined;
  const fail = (error: unknown) => String((error as Error)?.message ?? error);
  const persist = () => fs.writeFileSync(evidenceFile, JSON.stringify({ account: options.account, activity: options.activity,
    pages, returnToTop, completeness: { full: false, reason, pages: pages.length, coverage }, detail }, null, 2), 'utf8');
  const signature = (p: InventoryPageObservation) => JSON.stringify({
    tasks: p.tasks.map(t => ({ ...t, quota: t.quota.split('/').map(Number).join('/') }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    tiers: [...p.tiers].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });
  try {
    await agent.aiScroll(SCROLL_TARGET, { direction: 'up', scrollType: 'scrollToTop' });
    for (let i = 0; i < maxPages; i++) {
      if (options.overBudget?.()) { reason = 'BUDGET'; break; }
      const raw = await agent.aiQuery(INVENTORY_PAGE_PROMPT);
      pages.push({ page: i + 1, raw });
      persist(); // Keep the raw observation even if validation or the next call fails.
      const p = readPage(raw);
      if (i === 0) {
        if (!p.atTop) throw new Error('扫描起点未确认列表顶部');
        if (!p.progress) throw new Error('顶部未读到有效任务累计进度');
        coverage.top = true;
        progress = p.progress;
        topSignature = signature(p);
      }
      if (p.progress && p.progress !== progress) throw new Error('扫描期间累计进度冲突');
      for (const t of p.tasks) {
        const previous = tasks.get(t.name);
        if (previous && (previous.instruction !== t.instruction || previous.quota.split('/').map(Number)[1] !== t.quota.split('/').map(Number)[1])) {
          throw new Error(`同名任务要求冲突：${t.name}`);
        }
        if (previous && (previous.quota.split('/').map(Number)[0] !== t.quota.split('/').map(Number)[0] || (previous.reward > 0 && t.reward > 0 && previous.reward !== t.reward) || previous.button !== t.button)) {
          throw new Error(`重叠任务配额/奖励/按钮冲突：${t.name}`);
        }
        // The page prompt reserves zero for an unreadable reward; it is not conflicting evidence.
        tasks.set(t.name, previous && t.reward === 0 ? { ...t, reward: previous.reward } : t);
      }
      for (const t of p.tiers) {
        const key = JSON.stringify([t.coin, t.need]);
        if (tiers.has(key) && tiers.get(key)!.button !== t.button) throw new Error('重叠档位状态冲突');
        tiers.set(key, t);
      }
      if (p.atBottom) {
        if (!tasks.size) throw new Error('完整任务清单为空，无法确认收集成功');
        coverage.bottom = true; reason = 'BOTTOM'; break;
      }
      const semantic = signature(p);
      repeats = semantic === lastSignature ? repeats + 1 : 0;
      lastSignature = semantic;
      if (repeats >= 2) { reason = 'STALLED'; break; }
      if (i + 1 < maxPages) await agent.aiScroll(SCROLL_TARGET, { direction: 'down', scrollType: 'singleAction', distance });
    }
  } catch (error) { reason = 'INVALID_OBSERVATION'; detail = fail(error); }
  finally {
    try {
      await agent.aiScroll(SCROLL_TARGET, { direction: 'up', scrollType: 'scrollToTop' });
      returnToTop.raw = await agent.aiQuery(INVENTORY_PAGE_PROMPT);
      const p = readPage(returnToTop.raw);
      coverage.returnedToTop = p.atTop && p.progress === progress && signature(p) === topSignature;
      if (!coverage.returnedToTop) throw new Error('扫描后未确认相同顶部任务面板');
    } catch (error) {
      coverage.returnedToTop = false;
      returnToTop.error = fail(error);
      detail = [detail, returnToTop.error].filter(Boolean).join(' | ');
      if (reason === 'BOTTOM') reason = 'RETURN_FAILED';
    }
    persist();
  }
  const completeness: InventoryCompleteness = { full: reason === 'BOTTOM' && coverage.top && coverage.bottom && coverage.returnedToTop,
    reason, pages: pages.length, coverage };
  let inventory: Inventory | null = null;
  if (progress) {
    inventory = normalizeInventory({ progress, tasks: [...tasks.values()], tiers: [...tiers.values()], completeness,
      source: { kind: 'scroll-scan', evidenceFile } }, options.account, options.activity, { requireComplete: completeness.full });
  }
  fs.writeFileSync(evidenceFile, JSON.stringify({ account: options.account, activity: options.activity, pages, returnToTop, completeness, detail }, null, 2), 'utf8');
  return { ok: completeness.full, inventory, completeness, pages, evidenceFile,
    ...(!completeness.full ? { detail: detail ?? `任务清单不完整：${reason}` } : {}) };
}
