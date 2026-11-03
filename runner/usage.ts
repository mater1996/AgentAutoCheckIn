/**
 * 成本回填：优先 agent.metrics，其次从 model_call 表取。
 *
 * 三个来源的可靠性（实测）：
 *   ① agent.metrics —— 最实时，但只在 agent 存活期有效。
 *      recordRun 发生在 destroy 之后，此时可能已读不到（run #20 的 usage_json 至今 NULL）。
 *   ② Midscene 报告 HTML —— **没有 token 数据**。
 *      实测 4.7MB 报告里 usage 字段是 webpack 打包的 JS 代码，不是数据；
 *      纯 JSON 块只有 sdkVersion / executions / tasks，不含任何 token 字段。
 *   ③ model_call 表 —— 计量代理写的，最可靠，但依赖 x-run-id 归因生效。
 *
 * 所以策略是 ① → ③ 兜底，报告解析彻底不用。
 */
import { sqlite } from '../db/client';

export type UsageSummary = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCachedInput: number;
  calls: number;
  byIntent: Record<string, { calls: number; totalTokens: number }>;
  byModel: Record<string, { calls: number; totalTokens: number }>;
};

/** 从 model_call 表读某次运行的用量 */
export function usageFromDb(runId: number | null | undefined): UsageSummary | null {
  if (!runId || runId <= 0) return null;
  try {
    const rows = sqlite
      .prepare(
        `SELECT caller, model, COUNT(*) calls,
                SUM(COALESCE(prompt_tokens,0)) pt,
                SUM(COALESCE(completion_tokens,0)) ct,
                SUM(COALESCE(total_tokens,0)) tt,
                SUM(COALESCE(cached_tokens,0)) cached
         FROM model_call
         WHERE run_id = ?
         GROUP BY caller, model`,
      )
      .all(runId) as Array<{
      caller: string;
      model: string;
      calls: number;
      pt: number;
      ct: number;
      tt: number;
      cached: number;
    }>;

    if (!rows.length) return null;

    let pt = 0;
    let ct = 0;
    let tt = 0;
    let cached = 0;
    let calls = 0;
    const byIntent: UsageSummary['byIntent'] = {};
    const byModel: UsageSummary['byModel'] = {};

    for (const r of rows) {
      pt += r.pt;
      ct += r.ct;
      tt += r.tt;
      cached += r.cached;
      calls += r.calls;
      byIntent[r.caller] = { calls: r.calls, totalTokens: r.tt };
      byModel[r.model] = { calls: r.calls, totalTokens: r.tt };
    }

    return {
      totalPromptTokens: pt,
      totalCompletionTokens: ct,
      totalTokens: tt || pt + ct,
      totalCachedInput: cached,
      calls,
      byIntent,
      byModel,
    };
  } catch {
    return null;
  }
}

/** 从 agent.metrics 归一化（优先来源，因为最实时） */
export function usageFromMetrics(m: any): UsageSummary | null {
  if (!m) return null;
  const tt = Number(m.totalTokens ?? 0);
  const calls = Number(m.calls ?? 0);
  if (!tt && !calls) return null;
  return {
    totalPromptTokens: Number(m.totalPromptTokens ?? 0),
    totalCompletionTokens: Number(m.totalCompletionTokens ?? 0),
    totalTokens: tt,
    totalCachedInput: Number(m.totalCachedInput ?? 0),
    calls,
    byIntent: (m.byIntent ?? {}) as UsageSummary['byIntent'],
    byModel: (m.byModel ?? {}) as UsageSummary['byModel'],
  };
}

/** 合并两个来源：metrics 优先，缺失字段用 DB 补 */
export function mergeUsage(a: UsageSummary | null, b: UsageSummary | null): UsageSummary | null {
  if (!a) return b;
  if (!b) return a;
  return {
    totalPromptTokens: a.totalPromptTokens || b.totalPromptTokens,
    totalCompletionTokens: a.totalCompletionTokens || b.totalCompletionTokens,
    totalTokens: a.totalTokens || b.totalTokens,
    totalCachedInput: a.totalCachedInput || b.totalCachedInput,
    calls: a.calls || b.calls,
    byIntent: Object.keys(a.byIntent ?? {}).length ? a.byIntent : b.byIntent,
    byModel: Object.keys(a.byModel ?? {}).length ? a.byModel : b.byModel,
  };
}