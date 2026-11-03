/**
 * 前置定位：在规划阶段就把每个需要点击的元素坐标测出来，落成 playbook。
 *
 * 为什么必须前置：
 *   - 执行阶段拿坐标直接 input tap，0 模型调用
 *   - 坐标是可审阅的产物，和计划一起给人看
 *   - 改版失效时只需重跑定位，不用整轮重学
 *
 * 成本：每个元素一次 aiLocate（约 7.7K tokens）。8 个任务 + 5 个固定元素 ≈ ¥0.2，一次性。
 */
import path from 'node:path';
import {readStateFile,stateFileExists,writeStateFile} from './storage/structured.ts';

export type Point = [number, number]; // 归一化 0~1

export type Playbook = {
  version: number;
  learned_at: string;
  account: string;
  activity: string;
  screen: { w: number; h: number };
  /** 固定元素 */
  fixed: Record<string, Point>;
  /** 任务名 → 该任务行右侧按钮坐标（仅作参考，任务名每天会变） */
  tasks: Record<string, Point>;
  /**
   * 按行位置索引：任务列表是固定行高列表，第 N 行按钮永远在同一位置，
   * 与任务叫什么无关。执行时优先用这个，避免任务改名后坐标失效。
   */
  task_rows: Point[];
  /** 相邻两行的 Y 间距（归一化），可用于推算第 N 行 */
  row_pitch: number;
  /** 模型定位失败（应报警，回退 aiTap） */
  failed: string[];
  /** 元素当前不在页面上（正常，不算错） */
  absent: string[];
};

const DIR = () => path.resolve('data', 'playbook');

/** 把 aiLocate 的像素结果转归一化 */
export function toPoint(loc: any, w: number, h: number): Point | null {
  const c =
    loc?.center ??
    (loc?.rect
      ? [loc.rect.left + loc.rect.width / 2, loc.rect.top + loc.rect.height / 2]
      : null);
  if (!c || !Array.isArray(c)) return null;
  const x = Number(c[0]);
  const y = Number(c[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  // 已经是 0~1 就直接用，否则按像素归一化
  if (x <= 1 && y <= 1) return [Number(x.toFixed(4)), Number(y.toFixed(4))];
  return [Number((x / w).toFixed(4)), Number((y / h).toFixed(4))];
}

/** 固定元素清单：每个活动声明要测哪些 */
export type FixedSpec = { key: string; locate: string };

/** 在规划阶段测出所有坐标 */
export async function locateAll(opts: {
  agent: any;
  screen: { w: number; h: number };
  account: string;
  activity: string;
  fixed: FixedSpec[];
  taskNames: string[];
  /** 任务按钮的描述模板，{name} 会被替换 */
  taskButtonTemplate?: string;
  log?: (s: string) => void;
}): Promise<Playbook> {
  const log = opts.log ?? (() => {});
  const fixed: Record<string, Point> = {};
  const tasks: Record<string, Point> = {};
  const failed: string[] = [];
  const absent: string[] = [];

  /** 判断错误信息是否属于"元素不存在"而非"模型失败" */
  const isAbsent = (msg: string) =>
    /未找到|没有找到|不存在|未显示|not found|cannot find|no such/i.test(msg);

  for (const f of opts.fixed) {
    try {
      const loc = await opts.agent.aiLocate(f.locate);
      const p = toPoint(loc, opts.screen.w, opts.screen.h);
      if (p) {
        fixed[f.key] = p;
        log(`  定位 ${f.key} → (${p[0]}, ${p[1]})`);
      } else failed.push(`fixed:${f.key}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (isAbsent(msg)) {
        absent.push(`fixed:${f.key}`);
        log(`  ${f.key} 当前不在页面（正常）`);
      } else {
        failed.push(`fixed:${f.key}`);
        log(`  定位 ${f.key} 失败: ${msg.slice(0, 60)}`);
      }
    }
  }

  const tpl = opts.taskButtonTemplate ?? '任务列表里「{name}」这一行右侧的按钮';
  for (const name of opts.taskNames) {
    try {
      const loc = await opts.agent.aiLocate(tpl.replace('{name}', name));
      const p = toPoint(loc, opts.screen.w, opts.screen.h);
      if (p) {
        tasks[name] = p;
        log(`  定位任务「${name.slice(0, 16)}」→ (${p[0]}, ${p[1]})`);
      } else failed.push(`task:${name}`);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (isAbsent(msg)) {
        absent.push(`task:${name}`);
        log(`  任务「${name.slice(0, 16)}」当前不可见（可能需滚动）`);
      } else {
        failed.push(`task:${name}`);
        log(`  定位任务「${name.slice(0, 16)}」失败: ${msg.slice(0, 60)}`);
      }
    }
  }

  // 按 Y 排序生成行索引；X 取这些行的中位数（同一列按钮 X 应一致）
  const pts = Object.values(tasks).sort((a, b) => a[1] - b[1]);
  const medianX = pts.length ? pts.map((p) => p[0]).sort((a, b) => a - b)[Math.floor(pts.length / 2)] : 0.874;
  const task_rows: Point[] = pts.map((p) => [medianX, p[1]]);
  const gaps: number[] = [];
  for (let i = 1; i < task_rows.length; i++) gaps.push(task_rows[i][1] - task_rows[i - 1][1]);
  const row_pitch = gaps.length
    ? Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(4))
    : 0;

  return {
    version: 2,
    learned_at: new Date().toISOString(),
    account: opts.account,
    activity: opts.activity,
    screen: opts.screen,
    fixed,
    tasks,
    task_rows,
    row_pitch,
    failed,
    absent,
  };
}

/** 按行号取坐标：优先用已测行，超出则用 row_pitch 推算 */
export function rowPoint(pb: Playbook, index: number): Point | null {
  if (pb.task_rows?.length) {
    if (index < pb.task_rows.length) return pb.task_rows[index];
    const last = pb.task_rows[pb.task_rows.length - 1];
    if (pb.row_pitch > 0) {
      const y = last[1] + pb.row_pitch * (index - pb.task_rows.length + 1);
      // 屏幕底部有导航栏，Y 超过 0.96 就认为该行不可见，需要滚动
      if (y <= 0.96) return [last[0], Number(y.toFixed(4))];
    }
  }
  return null;
}

export function savePlaybook(pb: Playbook): string {
  const f = path.join(DIR(), `${pb.account}_${pb.activity}.json`);
  writeStateFile(f, pb);
  return f;
}

export function loadPlaybook(account: string, activity: string): Playbook | null {
  const f = path.join(DIR(), `${account}_${activity}.json`);
  if (!stateFileExists(f)) return null;
  try {
    return readStateFile(f) as Playbook;
  } catch {
    return null;
  }
}