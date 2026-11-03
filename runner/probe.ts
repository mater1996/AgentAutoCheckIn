/**
 * 探测与读数：把「现在是什么状态」变成数字。
 *
 * 这是业务层的核心之一，YAML 执行单元替代不了：
 *   - readBalance 有 aiNumber → aiQuery 双回退，防止读数口径漂移
 *   - runProbes 把 "13/20" 解析成 {done:13, total:20}，喂给 planner
 *
 * 读数卫生规则（血泪教训）：
 *   - fraction 必须走 aiQuery，aiNumber 会把 "13/20" 算成 0.65 小数
 *   - json 一次拿进度和剩余任务，避免两次调用口径不一致
 *   - 跨页读数不可比（京东「我的」页 888 vs 「京豆」页「今日获得 3」）
 */
import { isValidProbeState, parseFraction, parseIntStrict } from './objective';
import type { ProbeState } from './objective';
import type { ExecCtx } from './flow';

function safeJson(v: unknown): any | null {
  const txt = String(v ?? '');
  const a = txt.indexOf('{');
  const b = txt.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(txt.slice(a, b + 1));
  } catch {
    return null;
  }
}

function parseNumber(s: unknown): number | null {
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

export async function readBalance(ctx: ExecCtx, prompt?: string): Promise<number | null> {
  try {
    const n = await ctx.agent.aiNumber(
      prompt || '当前页面显示的这类虚拟资产（金币/积分/豆）的余额总数是多少？只回复数字',
    );
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  } catch {}
  try {
    return parseNumber(await ctx.agent.aiQuery(prompt || '当前页面显示的资产余额是多少？'));
  } catch {
    return null;
  }
}

export type ProbeDef = { id: string; ask: string; parse?: 'fraction' | 'int' | 'boolean' | 'json' };

export type ProbeResult = {
  state: ProbeState;
  raw: Record<string, unknown>;
  failed: string[];
  /** 新探测总会设置；可选以兼容旧调用方构造的结果。 */
  valid?: boolean;
};

export async function runProbes(ctx: ExecCtx, defs: ProbeDef[], opts?: { retry?: number }): Promise<ProbeResult> {
  const r = await runProbesOnce(ctx, defs);
  // 页面动画或任一计数缺失都需要重试，不能只检查进度分母。
  const retry = opts?.retry ?? 2;
  let out = r;
  for (let i = 0; !out.valid && i < retry; i++) {
    ctx.log(`  ↳ 观测无效（进度或剩余任务未知），1.5s 后重试 ${i + 1}/${retry}`);
    await new Promise((res) => setTimeout(res, 1500));
    out = await runProbesOnce(ctx, defs);
  }
  return out;
}

async function runProbesOnce(ctx: ExecCtx, defs: ProbeDef[]): Promise<ProbeResult> {
  const raw: Record<string, unknown> = {};
  const failed: string[] = [];
  let done = 0;
  let total = 0;
  let tasksLeft = -1;

  for (const d of defs) {
    let v: unknown = null;
    try {
      if (d.parse === 'boolean') {
        v = await ctx.agent.aiBoolean(d.ask);
      } else if (d.parse === 'json') {
        v = await ctx.agent.aiQuery(d.ask);
      } else if (d.parse === 'fraction') {
        // 必须走 aiQuery：aiNumber 会把 "6/20" 算成 0.3 小数，丢失 a/b 结构
        v = await ctx.agent.aiQuery(d.ask);
      } else {
        v = await ctx.agent.aiNumber(d.ask);
      }
    } catch (e: any) {
      try {
        v = await ctx.agent.aiQuery(d.ask);
      } catch {
        failed.push(`probe ${d.id} 失败: ${String(e?.message ?? e).slice(0, 80)}`);
      }
    }
    raw[d.id] = v;

    if (d.parse === 'json') {
      // 一次调用同时拿进度与剩余任务数，避免两次探测口径不一致
      const obj = typeof v === 'object' && v !== null ? (v as any) : safeJson(v);
      if (!obj) {
        failed.push(`probe ${d.id} 返回的不是 JSON：${String(v).slice(0, 80)}`);
      } else {
        const f = parseFraction(obj.progress);
        if (f) {
          done = f.done;
          total = f.total;
        } else failed.push(`probe ${d.id} progress 无法解析：${JSON.stringify(obj.progress)}`);
        const tl = typeof obj.tasks_left === 'number' ? obj.tasks_left : parseIntStrict(obj.tasks_left);
        tasksLeft = Number.isSafeInteger(tl) && tl! >= 0 ? tl! : -1;
        if (tasksLeft < 0) failed.push(`probe ${d.id} tasks_left 无法解析：${JSON.stringify(obj.tasks_left)}`);
      }
    } else if (d.parse === 'fraction') {
      const f = parseFraction(v);
      if (f) {
        done = f.done;
        total = f.total;
      } else {
        done = 0;
        total = 0;
        failed.push(`probe ${d.id} 无法解析成 a/b：${JSON.stringify(v)}`);
      }
    } else if (d.parse === 'int') {
      const n = typeof v === 'number' ? v : parseIntStrict(v);
      tasksLeft = Number.isSafeInteger(n) && n! >= 0 ? n! : -1;
      if (tasksLeft < 0) failed.push(`probe ${d.id} 无法解析成非负整数：${JSON.stringify(v)}`);
    }
  }

  const state = { done, total, tasksLeft };
  const valid = isValidProbeState(state) && failed.length === 0;
  // 整次观测失败时不留下可被误当成当前有效读数的部分结果。
  if (!valid) {
    failed.push('观测无效：需要当前完整的非负整数进度与剩余任务数');
    return { state: { done: 0, total: 0, tasksLeft: -1 }, raw, failed, valid };
  }
  return { state, raw, failed, valid };
}