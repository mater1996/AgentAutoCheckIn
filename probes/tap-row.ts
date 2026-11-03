/**
 * 按行号点任务：从无障碍树取任务行，点同行按钮。
 *
 * 用法：npx tsx probes/tap-row.ts <index> [expectText]
 */
import { execFileSync } from 'node:child_process';

const ADB = '/opt/homebrew/bin/adb';
const SERIAL = '3d8a7934';
const BUTTON_LABELS = ['去完成', '去逛逛', '逛一逛', '已完成', '立即领取', '去使用'];
const TASK_LABEL = /^.{2,40}\((\d+)\/(\d+)\)$/;

type N = { text: string; cx: number; cy: number; clickable: boolean; area: number };

function adb(args: string[], timeout = 20000): string {
  return execFileSync(ADB, ['-P', '5037', '-s', SERIAL, ...args], { encoding: 'utf8', timeout });
}

function readNodes(): N[] {
  adb(['shell', 'uiautomator', 'dump', '/sdcard/_row.xml']);
  const xml = adb(['shell', 'cat', '/sdcard/_row.xml'], 10000);
  const out: N[] = [];
  for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const text = (/text="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
    const desc = (/content-desc="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
    const label = text || desc;
    if (!label) continue;
    const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!b) continue;
    const x1 = Number(b[1]);
    const y1 = Number(b[2]);
    const x2 = Number(b[3]);
    const y2 = Number(b[4]);
    if (y2 <= y1 || x2 <= x1) continue;
    out.push({
      text: label,
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
      clickable: /clickable="true"/.test(tag),
      area: (x2 - x1) * (y2 - y1),
    });
  }
  return out;
}

const index = Number(process.argv[2] ?? '0');
const expectText = process.argv[3];

const nodes = readNodes();
const isButton = (t: string) => BUTTON_LABELS.some((b) => t.startsWith(b));
const labels = nodes.filter((n) => TASK_LABEL.test(n.text) && !isButton(n.text)).sort((a, b) => a.cy - b.cy);

console.log(`节点 ${nodes.length}，任务行 ${labels.length}`);
labels.forEach((l, i) => console.log(`  [${i}] ${l.text}  y=${l.cy}`));

if (!labels.length) {
  console.log('❌ 读不到任务行：当前不在任务面板');
  process.exit(1);
}
if (index >= labels.length) {
  console.log(`❌ 行号 ${index} 越界`);
  process.exit(1);
}

const label = labels[index];
if (expectText && !label.text.includes(expectText)) {
  console.log(`❌ 第 ${index} 行是「${label.text}」，不是「${expectText}」，中止`);
  process.exit(1);
}

const btn = nodes
  .filter((n) => isButton(n.text) && n.clickable)
  .filter((n) => Math.abs(n.cy - label.cy) < 140)
  .sort((a, b) => b.cx - a.cx)[0];

if (!btn) {
  console.log(`❌ 第 ${index} 行「${label.text}」没有可点按钮`);
  process.exit(1);
}

console.log(`\n✅ 点第 ${index} 行「${label.text}」→「${btn.text}」(${btn.cx}, ${btn.cy})`);
adb(['shell', 'input', 'tap', String(btn.cx), String(btn.cy)], 15000);
console.log('已点击');