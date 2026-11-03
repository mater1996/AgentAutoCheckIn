/**
 * 锁档：做 1 次「发现精选好物」把进度推到 20/20，拿 +100 档位。
 *
 * 每步都验证结果再往下走，不盲点。
 * 坐标依据 2026-10-30 用户四张截图 + 无障碍树 bounds 交叉验证：
 *   游戏页「去赚金币」      (100, 980)
 *   面板「发现精选好物」去完成 (943, 1044)   ← XML bounds [853,1002][1034,1086]
 *   搜索页历史「麦片」        (534, 540)
 */
import { execFileSync } from 'node:child_process';

const ADB = '/opt/homebrew/bin/adb';
const SERIAL = '3d8a7934';
const BTN = ['去完成', '去逛逛', '逛一逛', '已完成', '立即领取', '去使用'];

const adb = (args: string[], timeout = 25000) =>
  execFileSync(ADB, ['-P', '5037', '-s', SERIAL, ...args], { encoding: 'utf8', timeout });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tap = (x: number, y: number) => adb(['shell', 'input', 'tap', String(x), String(y)], 15000);
const back = async (ms = 2500) => {
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
  await sleep(ms);
};

type N = { text: string; cx: number; cy: number; clickable: boolean };

function activity(): string {
  try {
    const out = adb(['shell', 'dumpsys window'], 30000);
    const m = /mCurrentFocus=Window\{[^ ]+ \S+ ([^}]+)\}/.exec(out);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function dumpOnce(): N[] {
  try {
    adb(['shell', 'uiautomator dump /sdcard/_p.xml'], 25000);
    const xml = adb(['shell', 'cat', '/sdcard/_p.xml'], 10000);
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

async function dump(retries = 3): Promise<N[]> {
  for (let i = 0; i <= retries; i++) {
    const n = dumpOnce();
    if (n.length > 30) return n;
    await sleep(1500);
  }
  return dumpOnce();
}

const rows = (nodes: N[]) =>
  nodes
    .filter((n) => /^.{2,40}\((\d+)\/(\d+)\)$/.test(n.text) && !BTN.some((b) => n.text.startsWith(b)))
    .sort((a, b) => a.cy - b.cy);
const prog = (nodes: N[]) => nodes.find((n) => /^\d+\/\d+$/.test(n.text))?.text ?? '?';
const inPanel = (nodes: N[]) => rows(nodes).length >= 3;

// ── ① 回到容器页（游戏页或面板） ──
console.log('① 回到容器页');
for (let i = 0; i < 6; i++) {
  const act = activity();
  if (act.includes('TMSActivity')) {
    console.log(`  ✓ 已在容器页（${act.split('/').pop()}）`);
    break;
  }
  console.log(`  退回 (${i + 1}/6)：${act.split('/').pop() || '未知'}`);
  await back();
}

// ── ② 打开面板 ──
console.log('\n② 打开任务面板');
let nodes = await dump();
if (inPanel(nodes)) {
  console.log(`  ✓ 面板已开（${rows(nodes).length} 行，进度 ${prog(nodes)}）`);
} else {
  for (const [x, y] of [[130, 994], [130, 1020], [120, 960], [140, 1010]]) {
    console.log(`  点「去赚金币」(${x}, ${y})`);
    tap(x, y);
    await sleep(7000);
    nodes = await dump();
    if (inPanel(nodes)) {
      console.log(`  ✓ 面板打开（${rows(nodes).length} 行，进度 ${prog(nodes)}）`);
      break;
    }
  }
}

const rs = rows(nodes);
if (!rs.length) {
  console.log('❌ 打不开面板，中止');
  process.exit(1);
}
rs.forEach((r, i) => console.log(`    [${i}] ${r.text}  y=${r.cy}`));

// ── ③ 点「发现精选好物」 ──
console.log('\n③ 点「发现精选好物」');
const label = rs.find((r) => r.text.includes('发现精选好物'));
if (!label) {
  console.log(`❌ 找不到该任务。当前: ${rs.map((r) => r.text).join(' / ')}`);
  process.exit(1);
}
const btn = nodes
  .filter((n) => BTN.some((b) => n.text.startsWith(b)) && n.clickable)
  .filter((n) => Math.abs(n.cy - label.cy) < 140)
  .sort((a, b) => b.cx - a.cx)[0];
const tx = btn?.cx ?? 956;
const ty = btn?.cy ?? 1044;
console.log(`  「${label.text}」→「${btn?.text ?? '去完成'}」(${tx}, ${ty})`);
tap(tx, ty);
await sleep(8000);

// ── ④ 在搜索页触发搜索 ──
console.log('\n④ 触发搜索');
let page = await dump();
console.log(`  页面: ${activity().split('/').pop()}，可读节点 ${page.length}`);

const hist = page.find((n) => n.clickable && n.text === '麦片');
const card = page.find((n) => n.clickable && /^麦片$|洗发露|燕麦片/.test(n.text));
if (hist) {
  console.log(`  ✓ 历史搜索「麦片」(${hist.cx}, ${hist.cy})`);
  tap(hist.cx, hist.cy);
} else if (card) {
  console.log(`  ✓ 搜索发现「${card.text}」(${card.cx}, ${card.cy})`);
  tap(card.cx, card.cy);
} else {
  console.log('  ⚠ 无障碍树无搜索入口，用截图坐标 (536, 544)');
  tap(536, 544);
}
await sleep(9000);
console.log(`  搜索后: ${activity().split('/').pop()}`);

// ── ⑤ 浏览 ──
console.log('\n⑤ 浏览 10 秒');
await sleep(10000);

// ── ⑥ 回面板读进度 ──
console.log('\n⑥ 回面板读进度');
for (let i = 0; i < 5; i++) {
  if (inPanel(await dump())) break;
  await back(2000);
}
nodes = await dump();
if (!inPanel(nodes)) {
  for (const [x, y] of [[130, 994], [130, 1020], [120, 960]]) {
    tap(x, y);
    await sleep(6500);
    nodes = await dump();
    if (inPanel(nodes)) break;
  }
}
const rs2 = rows(nodes);
console.log(`  行数 ${rs2.length}，进度 ${prog(nodes)}`);
rs2.forEach((r, i) => console.log(`    [${i}] ${r.text}`));