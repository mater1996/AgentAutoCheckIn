/**
 * L3 预测：拿到任务列表，查类型模板，直接生成每个任务的动作计划。
 * 0 模型调用。
 */
import { sqlite } from '../db/client';
import type { TaskRules } from './planner';
import { classify } from './planner';

export type PredictedTask = {
  task: string;
  kind: string;
  times: number;
  steps: { act: string; note?: string; seconds?: number; text_template?: string }[];
  /** 该模板的来源与可信度 */
  confidence: string;
  /** 是否需要模型（模板缺失时为 true） */
  needsAI: boolean;
  invariants: string[];
  failure_modes: string[];
};

export type Prediction = {
  platform: string;
  tasks: PredictedTask[];
  /** 全部可走模板的任务数 */
  covered: number;
  /** 需要现场学习的任务数 */
  uncovered: number;
  notes: string[];
};

/** 从库里读类型模板 */
export function loadTemplates(platform: string): Map<string, any> {
  const rows = sqlite.prepare(`SELECT * FROM task_template WHERE platform = ?`).all(platform) as any[];
  const m = new Map<string, any>();
  for (const r of rows) {
    m.set(r.kind, {
      kind: r.kind,
      steps: JSON.parse(r.steps_json),
      invariants: JSON.parse(r.invariants_json ?? '[]'),
      failure_modes: JSON.parse(r.failure_modes_json ?? '[]'),
      confidence: r.confidence,
      derived_from: JSON.parse(r.derived_from_json ?? '[]'),
    });
  }
  return m;
}

/** 核心：任务列表 → 动作计划 */
export function predict(
  platform: string,
  inventory: { tasks: { name: string; remaining: number; button: string }[] },
  rules: TaskRules,
): Prediction {
  const tpl = loadTemplates(platform);
  const notes: string[] = [];
  const tasks: PredictedTask[] = [];

  for (const t of inventory.tasks) {
    if (t.remaining <= 0 || /已完成/.test(t.button)) continue;
    const rule = classify(t.name, rules);
    const kind = rule.kind ?? 'unknown';
    const tplHit = tpl.get(kind);

    tasks.push({
      task: t.name,
      kind,
      times: t.remaining,
      steps: tplHit?.steps ?? [],
      confidence: tplHit?.confidence ?? 'none',
      needsAI: !tplHit,
      invariants: tplHit?.invariants ?? [],
      failure_modes: tplHit?.failure_modes ?? [],
    });
  }

  const covered = tasks.filter((x) => !x.needsAI).reduce((a, x) => a + x.times, 0);
  const uncovered = tasks.filter((x) => x.needsAI).reduce((a, x) => a + x.times, 0);

  if (uncovered > 0) {
    notes.push(`${uncovered} 次任务没有模板，执行时需现场学习（会调用模型）`);
  }
  if (covered > 0) {
    notes.push(`${covered} 次任务可直接按模板执行（0 调用）`);
  }

  return { platform, tasks, covered, uncovered, notes };
}