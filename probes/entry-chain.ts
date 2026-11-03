/**
 * 从任意状态回到任务面板：完整重放入口链。
 *
 * 为什么不能「从当前页想办法」：
 *   TMSActivity 容器里至少 4 种子页（游戏页/任务面板/品类周/商品详情），
 *   共用同一个 Activity，既读不到文字（部分 Canvas）也无法用 Activity 区分。
 *   在未知子页上点坐标必然乱跳（实测点 (130,1016) 从品类周跳到了商品区）。
 *
 * 所以每次都从冷启动走一遍完整链：
 *   am start -S → 我的淘宝 → 领淘金币 → 去赚金币 → 面板
 * 每步都用 dump 验证，验证不了就换候选坐标，绝不盲点下一步。
 */
import { execFileSync } from 'node:child_process';

const ADB = '/opt/homebrew/bin/adb';
const SERIAL = '3d8a7934';
const BTN = ['去完成', '去逛逛', '逛一逛', '已完成', '立即领取', '去使用'];

const adb = (args: string[], timeout = 30000) =>
  execFileSync(ADB, ['-P', '5037', '-s', SERIAL, ...args], { encoding: 'utf8', timeout });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tap = (x: number, y: number) => adb(['shell', 'input', 'tap', String(x), String(y)], 15000);

type N = { text: string; cx: number; cy: number; clickable: boolean };

function activity(): string {
  try {
    const out = adb(['shell', 'dumpsys window']);
    const m = /mCurrentFocus=Window\{[^ ]+ \S+ ([^}]+)\}/.exec(out);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function dumpOnce(): N[] {
  try {
    adb(['shell', 'uiautomator dump /sdcard/_e.xml'], 25000);
    const xml = adb(['shell', 'cat', '/sdcard/_e.xml'], 10000);
    const out: N[] = [];
    for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
      const tag = m[0];
      const text = (/text="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
      const desc = (/content-desc="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
      const label = text || desc;
      if (!label) continue;
      const b = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
      if (!b) continue;
      const x1 = +b[1], y1 = +b[2], x2 = +b[3], y2 = +b[4];
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

const rows = (nodes: N[]) =>
  nodes
    .filter((n) => /^.{2,40}\((\d+)\/(\d+)\)$/.test(n.text) && !BTN.some((b) => n.text.startsWith(b)))
    .sort((a, b) => a.cy - b.cy);
const prog = (nodes: N[]) => nodes.find((n) => /^\d+\/\d+$/.test(n.text))?.text ?? '?';
const inPanel = (nodes: N[]) => rows(nodes).length >= 3;

/** 按名字找可点节点（clickable 优先） */
function findTap(nodes: N[], needle: string) {
  const hits = nodes.filter((n) => n.text.includes(needle));
  if (!hits.length) return null;
  const ck = hits.filter((n) => n.clickable);
  return (ck.length ? ck : hits).sort((a, b) => (b.cx * b.cy) - (a.cx * a.cy))[0];
}

async function step(label: string, fn: () => Promise<boolean>): Promise<boolean> {
  const ok = await fn();
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  return ok;
}

// ── ① 冷启动 ──
console.log('① 冷启动淘宝');
adb(['shell', 'am start -W -S -n com.taobao.taobao/com.taobao.tao.welcome.Welcome'], 40000);
await sleep(10000);
console.log(`  ${activity().split('/').pop()}`);

// ── ② 我的淘宝 ──
console.log('② 点「我的淘宝」');
let nodes = dumpOnce();
let me = findTap(nodes, '我的淘宝');
if (!me) {
  console.log('  dump 里没有，重试一次');
  await sleep(3000);
  nodes = dumpOnce();
  me = findTap(nodes, '我的淘宝');
}
if (me) {
  console.log(`  ✓ (${me.cx}, ${me.cy}) clickable=${me.clickable}`);
  tap(me.cx, me.cy);
  await sleep(7000);
} else {
  console.log('  ✗ 找不到「我的淘宝」，用坐标 (972,2203)');
  tap(972, 2203);
  await sleep(7000);
}
console.log(`  ${activity().split('/').pop()}`);

// ── ③ 领淘金币 ──
console.log('③ 点「领淘金币」');
nodes = dumpOnce();
const coin = findTap(nodes, '领淘金币');
if (coin) {
  console.log(`  ✓ (${coin.cx}, ${coin.cy}) clickable=${coin.clickable}`);
  tap(coin.cx, coin.cy);
} else {
  console.log('  ✗ 找不到，用坐标 (342,1369)');
  tap(342, 1369);
}
await sleep(8000);
console.log(`  ${activity().split('/').pop()}`);

// ── ④ 去赚金币（游戏页 Canvas，只能坐标）──
console.log('④ 点「去赚金币」开面板');
for (const [x, y] of [[150, 1010], [130, 1016], [110, 1000], [170, 1020], [150, 980]]) {
  tap(x, y);
  await sleep(6500);
  nodes = dumpOnce();
  if (inPanel(nodes)) {
    console.log(`  ✓ (${x}, ${y}) 面板打开：${rows(nodes).length} 行，进度 ${prog(nodes)}`);
    break;
  }
  console.log(`  · (${x}, ${y}) 未开面板（行数 ${rows(nodes).length}），换下一个`);
}

if (!inPanel(nodes)) {
  console.log('❌ 面板打不开，中止');
  process.exit(1);
}

const rs = rows(nodes);
rs.forEach((r, i) => console.log(`    [${i}] ${r.text}  y=${r.cy}`));

// ── ⑤ 点「发现精选好物」──
console.log('\n⑤ 点「发现精选好物」');
const label = rs.find((r) => r.text.includes('发现精选好物'));
if (!label) {
  console.log(`❌ 找不到。当前: ${rs.map((r) => r.text).join(' / ')}`);
  process.exit(1);
}
const btn = nodes
  .filter((n) => BTN.some((b) => n.text.startsWith(b)) && n.clickable)
  .filter((n) => Math.abs(n.cy - label.cy) < 140)
  .sort((a, b) => b.cx - a.cx)[0];
if (!btn) {
  console.log(`❌ 「${label.text}」没有可点按钮`);
  process.exit(1);
}
console.log(`  「${label.text}」→「${btn.text}」(${btn.cx}, ${btn.cy})`);
tap(btn.cx, btn.cy);
await sleep(8000);
console.log(`  页面: ${activity().split('/').pop()}`);

// ── ⑥ 搜索页点「麦片」──
console.log('\n⑥ 触发搜索');
nodes = dumpOnce();
console.log(`  可读节点 ${nodes.length}`);
const mai = findTap(nodes, '麦片');
if (mai) {
  console.log(`  ✓ 命中「${mai.text}」(${mai.cx}, ${mai.cy})`);
  tap(mai.cx, mai.cy);
} else {
  console.log('  ✗ 未命中，用坐标 (536,528)');
  tap(536, 528);
}
await sleep(10000);
console.log(`  搜索后: ${activity().split('/').pop()}`);

// ── ⑦ 浏览 ──
console.log('\n⑦ 浏览 10 秒');
await sleep(10000);

// ── ⑧ 回面板读进度 ──
console.log('\n⑧ 回面板');
for (let i = 0; i < 4; i++) {
  if (inPanel(dumpOnce())) break;
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
  await sleep(2500);
}
nodes = dumpOnce();
if (!inPanel(nodes)) {
  console.log('  再点一次去赚金币');
  for (const [x, y] of [[150, 1010], [130, 1016], [110, 1000]]) {
    tap(x, y);
    await sleep(6500);
    nodes = dumpOnce();
    if (inPanel(nodes)) break;
  }
}
const rs2 = rows(nodes);
console.log(`  行数 ${rs2.length}，进度 ${prog(nodes)}`);
rs2.forEach((r, i) => console.log(`    [${i}] ${r.text}`));