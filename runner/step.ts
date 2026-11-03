/**
 * 步骤级计时与计费。
 *
 * 为什么要这一层：run 表只有整体 prep_ms/exec_ms，无法回答
 * "第 3 个任务花了多少时间、多少 token"。
 *
 * 做法：每一步开始时记时间戳，结束时算耗时，并按「该时段内代理记到的调用」
 * 分摊 token。分摊依据是时间窗，不依赖调用方自觉传 run_id。
 */
import { sqlite, nowIso } from '../db/client';

export type StepRecord = {
  runId: number;
  seq: number;
  stage: string; // prep | entry | probe | task | collect | settle | verify
  action: string; // tap / input / dwell / back / ai / ...
  detail?: string;
};

/** 开一步，返回结束函数 */
export function stepBegin(r: StepRecord): (ok: boolean, tokens?: number, calls?: number, error?: string) => void {
  const startedAt = nowIso();
  const t0 = Date.now();
  const t0iso = startedAt;

  return (ok: boolean, tokens?: number, calls?: number, error?: string) => {
    const ms = Date.now() - t0;
    let tok = tokens ?? 0;
    let cl = calls ?? 0;

    // 没显式给 token 时，按时间窗从 model_call 里查
    if (tokens === undefined) {
      try {
        const row = sqlite
          .prepare(
            `SELECT COALESCE(SUM(total_tokens),0) tok, COUNT(*) c
               FROM model_call WHERE ts >= ? AND ts <= ? AND status = 'ok'`,
          )
          .get(t0iso, nowIso()) as any;
        tok = Number(row?.tok ?? 0);
        cl = Number(row?.c ?? 0);
      } catch {}
    }

    try {
      sqlite
        .prepare(
          `INSERT INTO run_step (run_id, seq, stage, action, detail, started_at, ms, tokens, calls, ok, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(r.runId, r.seq, r.stage, r.action, r.detail ?? null, startedAt, ms, tok, cl, ok ? 1 : 0, error ?? null);
    } catch (e: any) {
      console.error('[step] 落库失败:', e?.message);
    }
  };
}

/** 查某次运行的步骤明细 */
export function stepsOf(runId: number) {
  return sqlite
    .prepare(`SELECT * FROM run_step WHERE run_id = ? ORDER BY seq`)
    .all(runId) as any[];
}

/** 步骤汇总：按 stage 聚合 */
export function stepsSummary(runId: number) {
  return sqlite
    .prepare(
      `SELECT stage, COUNT(*) n, SUM(ms) ms, SUM(tokens) tokens, SUM(calls) calls
         FROM run_step WHERE run_id = ? GROUP BY stage ORDER BY SUM(ms) DESC`,
    )
    .all(runId) as any[];
}