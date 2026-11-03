/**
 * 按本次观察到的完整任务名匹配无障碍树，再绑定同一行的按钮。
 * 不使用任务名推断类型；旧行号仅在 expectText 精确验证后兼容。
 * XML 解析、行选择和按钮绑定都是纯函数，离线校验不触碰设备。
 */
import { execFileSync } from 'node:child_process';
import { defineNode, z } from '@midscene/test';

const ADB = process.env.ADB_BIN || '/opt/homebrew/bin/adb';
const ACTION_LABELS = ['去完成', '去逛逛', '逛一逛', '立即领取', '去使用'];
const TASK_LABEL = /^(.*?)\s*[（(](\d+)\s*\/\s*(\d+)[）)]$/u;

export interface AccessibilityNode {
  id: number;
  parentId?: number;
  text: string;
  texts: string[];
  x1: number; y1: number; x2: number; y2: number;
  cx: number; cy: number;
  clickable: boolean;
  enabled: boolean;
}

export interface TaskRowTarget {
  text?: string;
  index?: number;
  expectText?: string;
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (all, entity: string) => {
    const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (entity.startsWith('#')) {
      const n = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return named[entity] ?? all;
  });
}

/** 解析 uiautomator XML；保留空文本的可点父节点，供按钮子标签回溯。 */
export function parseAccessibilityNodes(xml: string): AccessibilityNode[] {
  const nodes: AccessibilityNode[] = [];
  const parents: number[] = [];
  for (const match of xml.matchAll(/<\/?node\b[^>]*>/g)) {
    const tag = match[0];
    if (tag.startsWith('</')) { parents.pop(); continue; }
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], decodeXml(m[2])]));
    const b = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attrs.bounds ?? '');
    const [x1, y1, x2, y2] = b ? b.slice(1).map(Number) : [0, 0, 0, 0];
    const texts = [...new Set([attrs.text, attrs['content-desc']].map((v) => v?.trim()).filter((v): v is string => !!v))];
    const id = nodes.length;
    nodes.push({ id, parentId: parents.at(-1), text: texts[0] ?? '', texts,
      x1, y1, x2, y2, cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2),
      clickable: attrs.clickable === 'true', enabled: attrs.enabled !== 'false' });
    if (!tag.endsWith('/>')) parents.push(id);
  }
  return nodes;
}

function taskName(text: string): string {
  return (TASK_LABEL.exec(text.trim())?.[1] ?? text).trim();
}

/** 精确任务名匹配；进度后缀不参与身份识别。多行同名、错误行号均中止。 */
export function selectTaskRow(nodes: readonly AccessibilityNode[], target: TaskRowTarget): AccessibilityNode {
  const labels = nodes.filter((n) => n.x2 > n.x1 && n.y2 > n.y1 && TASK_LABEL.test(n.text))
    .sort((a, b) => a.cy - b.cy);
  if (!labels.length) throw new Error('面板上读不到任何任务行（可能不在任务面板）');
  if (target.text) {
    const matches = labels.filter((n) => taskName(n.text) === taskName(target.text!));
    if (matches.length !== 1) throw new Error(`任务「${target.text}」匹配 ${matches.length} 行，无法唯一定位`);
    return matches[0];
  }
  if (!Number.isInteger(target.index) || target.index! < 0 || !target.expectText?.trim()) {
    throw new Error('tapRow 需要 text；兼容 index 时必须提供 expectText 精确校验');
  }
  const label = labels[target.index!];
  if (!label) throw new Error(`行号 ${target.index} 越界（面板只有 ${labels.length} 行）`);
  if (taskName(label.text) !== taskName(target.expectText)) {
    throw new Error(`第 ${target.index} 行实际是「${label.text}」，与预期「${target.expectText}」不符，已中止以免点错`);
  }
  return label;
}

/** 只接受与目标标签纵向重叠、右侧且最近属于该行的唯一可操作按钮。 */
export function selectRowButton(nodes: readonly AccessibilityNode[], label: AccessibilityNode): AccessibilityNode {
  const progress = TASK_LABEL.exec(label.text);
  if (progress && Number(progress[2]) >= Number(progress[3])) throw new Error(`任务「${label.text}」已完成`);
  const labels = nodes.filter((n) => TASK_LABEL.test(n.text) && n.x2 > n.x1 && n.y2 > n.y1);
  const buttons = new Map<number, AccessibilityNode>();
  for (const n of nodes) {
    const buttonText = n.texts.find((t) => ACTION_LABELS.includes(t));
    if (!buttonText || !n.enabled) continue;
    let clickable: AccessibilityNode | undefined = n;
    while (clickable && !clickable.clickable) {
      clickable = clickable.parentId === undefined ? undefined : nodes[clickable.parentId];
    }
    if (!clickable?.enabled || clickable.x2 <= clickable.x1 || clickable.y2 <= clickable.y1) continue;
    // 空文本的整行/面板容器不是独立按钮，不能把它的中心当按钮中心。
    if (clickable.x1 < label.x2 || clickable.y1 >= label.y2 || clickable.y2 <= label.y1) continue;
    const distance = Math.abs(clickable.cy - label.cy);
    if (labels.some((other) => other.id !== label.id && Math.abs(clickable!.cy - other.cy) <= distance)) continue;
    buttons.set(clickable.id, { ...clickable, text: buttonText });
  }
  if (buttons.size !== 1) throw new Error(`任务「${label.text}」同一行匹配 ${buttons.size} 个可点按钮，已中止`);
  return [...buttons.values()][0];
}

export function selectTaskRowButton(xml: string, target: TaskRowTarget) {
  const nodes = parseAccessibilityNodes(xml);
  const label = selectTaskRow(nodes, target);
  return { label, button: selectRowButton(nodes, label) };
}

export const tapRow = defineNode({
  name: 'tapRow',
  title: '按当前任务文本点击同行按钮',
  description: '精确匹配本次观察到的完整任务名并点击同一行唯一按钮；行号仅兼容且必须验证 expectText。',
  inputSchema: z.strictObject({
    text: z.string().trim().min(1).optional().describe('本次观察到的完整任务名，精确匹配（可含进度后缀）'),
    index: z.number().int().min(0).max(20).optional().describe('兼容旧任务的行号，必须同时提供 expectText'),
    expectText: z.string().trim().min(1).optional().describe('兼容行号模式的完整任务名校验'),
    waitMs: z.number().int().min(0).default(1500).describe('点击后等待毫秒'),
  }).refine(
    (input) => input.text !== undefined
      ? input.index === undefined && input.expectText === undefined
      : input.index !== undefined && input.expectText !== undefined,
    '提供 text，或提供 index + expectText；两种定位模式不能混用',
  ),
  async execute({ input, context }) {
    const serial = (context as { serial?: string })?.serial;
    if (!serial) throw new Error('tapRow 缺少设备 serial');
    execFileSync(ADB, ['-P', '5037', '-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/_row.xml'], {
      encoding: 'utf8', timeout: 20000,
    });
    const xml = execFileSync(ADB, ['-P', '5037', '-s', serial, 'shell', 'cat', '/sdcard/_row.xml'], {
      encoding: 'utf8', timeout: 10000,
    });
    const { label, button: btn } = selectTaskRowButton(xml, input);
    execFileSync(ADB, ['-P', '5037', '-s', serial, 'shell', 'input', 'tap', String(btn.cx), String(btn.cy)], { timeout: 15000 });
    if (input.waitMs > 0) await new Promise((r) => setTimeout(r, input.waitMs));
    return {
      summary: `「${label.text}」→ 点「${btn.text}」(${btn.cx},${btn.cy})`,
      data: { task: label.text, btn: btn.text, x: btn.cx, y: btn.cy },
    };
  },
});
