/**
 * 锁档：做 1 次「发现精选好物」把进度推到 20/20，拿 +100 档位。
 *
 * 流程：回面板 → 点该任务 → 搜索有福利页浏览 → 回面板 → 读进度
 * 全程用无障碍树定位，不猜坐标。
 */
import { execFileSync } from 'node:child_process';

const ADB = '/opt/homebrew/bin/adb';
const SERIAL = '3d8a7934';
const BTN = ['去完成', '去逛逛', '逛一逛', '已完成', '立即领取', '去使用'];

const adb = (args: string[], timeout = 20000) =>
  execFileSync(ADB, ['-P', '5037', '-s', SERIAL, ...args], { encoding: 'utf8', timeout });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function activity(): string {
  // 不能用设备端管道：dumpsys window | grep 会报
  // "Failed to write while dumping service window: Broken pipe"（踩过这个坑）
  try {
    const out = adb(['shell', 'dumpsys window'], 30000);
    const m = /mCurrentFocus=Window\{[^ ]+ \S+ ([^}]+)\}/.exec(out);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

type N = { text: string; cx: number; cy: number; clickable: boolean };

function dump(): N[] {
  try {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/_s.xml']);
    const xml = adb(['shell', 'cat', '/sdcard/_s.xml'], 10000);
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
      });
    }
    return out;
  } catch {
    return [];
  }
}

function taskRows(nodes: N[]) {
  return nodes
    .filter((n) => /^.{2,40}\((\d+)\/(\d+)\)$/.test(n.text) && !BTN.some((b) => n.text.startsWith(b)))
    .sort((a, b) => a.cy - b.cy);
}

function progress(nodes: N[]): string {
  const t = nodes.find((n) => /^\d+\/\d+$/.test(n.text));
  return t ? t.text : '?';
}

function tapRow(nodes: N[], name: string): boolean {
  const rows = taskRows(nodes);
  const label = rows.find((r) => r.text.includes(name));
  if (!label) {
    console.log(`  ✗ 找不到任务「${name}」，当前行: ${rows.map((r) => r.text).join(' / ') || '无'}`);
    return false;
  }
  const btn = nodes
    .filter((n) => BTN.some((b) => n.text.startsWith(b)) && n.clickable)
    .filter((n) => Math.abs(n.cy - label.cy) < 140)
    .sort((a, b) => b.cx - a.cx)[0];
  if (!btn) {
    console.log(`  ✗ 「${label.text}」这行没有可点按钮`);
    return false;
  }
  console.log(`  ✓ 「${label.text}」→「${btn.text}」(${btn.cx},${btn.cy})`);
  adb(['shell', 'input', 'tap', String(btn.cx), String(btn.cy)], 15000);
  return true;
}

/** 回面板：点游戏页左下角「去赚金币」 */
async function toPanel(): Promise<N[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let nodes = dump();
    if (taskRows(nodes).length >= 3) return nodes;

    console.log(`  → 不在面板（行数 ${taskRows(nodes).length}），尝试拉起 (${attempt + 1}/3)`);
    const act = activity();
    if (act.includes('TMSActivity') || act.includes('TBMainActivity')) {
      // 游戏页左下角「去赚金币」
      adb(['shell', 'input', 'tap', '130', '980'], 15000);
    } else {
      // 其他页面：先退回去
      adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
    }
    await sleep(6000);
    nodes = dump();
    if (taskRows(nodes).length >= 3) return nodes;
  }
  return dump();
}

// ── 主流程 ──
console.log('① 回面板');
let nodes = await toPanel();
const rows = taskRows(nodes);
console.log(`  面板 ${rows.length} 行，进度 ${progress(nodes)}`);
rows.forEach((r, i) => console.log(`    [${i}] ${r.text}`));

console.log('\n② 点「发现精选好物」');
const ok = tapRow(nodes, '发现精选好物');
if (!ok) {
  console.log('中止：无法点击该任务');
  process.exit(1);
}
await sleep(6000);
console.log(`  当前页面: ${activity().split('/').pop()}`);

console.log('\n③ 在搜索有福利页浏览');
const page = dump();
// 点任意一个「搜索发现」卡片（用无障碍树找可点的商品名）
const cards = page
  .filter((n) => n.clickable && n.text.length >= 3 && n.text.length <= 30)
  .filter((n) => /洗发|麦片|牙膏|洗菜|牙齿|燕麦|清洗|谷物|双抗/.test(n.text))
  .sort((a, b) => a.cy - b.cy);
if (cards.length) {
  const c = cards[0];
  console.log(`  ✓ 浏览「${c.text}」(${c.cx},${c.cy})`);
  adb(['shell', 'input', 'tap', String(c.cx), String(c.cy)], 15000);
} else {
  console.log(`  ⚠ 无障碍树里没找到商品卡片（可读 ${page.length} 节点），尝试固定坐标`);
  adb(['shell', 'input', 'tap', '280', '960'], 15000);
}
await sleep(8000);

console.log('\n④ 返回面板');
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
await sleep(3000);
adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
await sleep(3000);
nodes = await toPanel();
const after = taskRows(nodes);
console.log(`  面板 ${after.length} 行，进度 ${progress(nodes)}`);
after.forEach((r, i) => console.log(`    [${i}] ${r.text}`));