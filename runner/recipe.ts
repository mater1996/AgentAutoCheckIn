/**
 * L1 抽取：从 Midscene 报告里抽出每个任务的实际动作序列。
 *
 * 为什么不用模型：报告里是结构化数据（type/bbox/prompt），正则解析即可，
 * 让模型读 90MB HTML 是浪费。
 */
import fs from 'node:fs';

export type ObservedStep = {
  act: 'tap' | 'input' | 'dwell' | 'back' | 'swipe' | 'sleep' | 'other';
  target?: string;
  text?: string;
  at?: [number, number];
  bbox?: [number, number, number, number];
  seconds?: number;
};

export type ObservedTask = {
  task: string;
  steps: ObservedStep[];
  /** 同一目标被重复定位的次数：越高说明这个任务越难做 */
  retries: number;
  outcome: 'success' | 'unknown';
};

const W = 1080;
const H = 2400;

function norm(px: number, py: number): [number, number] {
  return [Number((px / W).toFixed(4)), Number((py / H).toFixed(4))];
}

/**
 * 从报告 HTML 里抽取所有「任务指令 → 动作序列」。
 * 只取最后一次完整尝试（重规划会产生大量重复，只留最终成功的链）。
 */
export function extractFromReport(htmlPath: string): ObservedTask[] {
  if (!fs.existsSync(htmlPath)) return [];
  const s = fs.readFileSync(htmlPath, 'utf8');

  // 按 Act 分块：name 是用户指令，后面跟着该次执行的所有动作
  const blocks = [...s.matchAll(/"name":"(Act - .{0,300}?)","tasks":\[(.*?)\]\}\],/g)];
  if (!blocks.length) return [];

  // 按指令归组（同一指令会有多次重规划）
  const byInstruction = new Map<string, string[]>();
  for (const b of blocks) {
    const name = b[1];
    const body = b[2];
    if (!byInstruction.has(name)) byInstruction.set(name, []);
    byInstruction.get(name)!.push(body);
  }

  const out: ObservedTask[] = [];

  for (const [instruction, bodies] of byInstruction) {
    // 取动作最丰富的那次（重规划过程中动作数递增，最后一条最完整）
    const best = bodies
      .map((b) => ({ b, n: (b.match(/"type":"Tap"/g) ?? []).length }))
      .sort((a, z) => z.n - a.n)[0];
    if (!best || best.n === 0) continue;

    const body = best.b;
    const steps: ObservedStep[] = [];
    const seenTargets = new Map<string, number>();

    // 按出现顺序扫 Tap / Input / Sleep
    const re =
      /"type":"(Tap|Input|Sleep|Back|Scroll)"[^\]]{0,200}?(?:"prompt":"([^"]{0,80})")?(?:[^\]]{0,120}?"center":\[(\d+\.?\d*),(\d+\.?\d*)\])?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) {
      const t = m[1];
      const prompt = m[2] ?? '';
      const cx = m[3] ? Number(m[3]) : null;
      const cy = m[4] ? Number(m[4]) : null;

      if (t === 'Tap') {
        const step: ObservedStep = { act: 'tap' };
        if (prompt) {
          step.target = prompt;
          seenTargets.set(prompt, (seenTargets.get(prompt) ?? 0) + 1);
        }
        if (cx !== null && cy !== null) step.at = norm(cx, cy);
        steps.push(step);
      } else if (t === 'Input') {
        steps.push({ act: 'input', target: prompt || undefined });
      } else if (t === 'Sleep') {
        steps.push({ act: 'sleep' });
      } else if (t === 'Back') {
        steps.push({ act: 'back' });
      }
    }

    if (!steps.length) continue;

    // retries = 同一目标重复定位次数之和（减 1，第一次不算重试）
    let retries = 0;
    for (const n of seenTargets.values()) retries += Math.max(0, n - 1);

    out.push({
      task: instruction.replace(/^Act - /, ''),
      steps,
      retries,
      outcome: 'unknown',
    });
  }

  return out;
}