/**
 * 锁档：做 1 次「发现精选好物」推到 20/20，拿 +100 档位。
 *
 * 坐标依据 2026-10-30 用户提供的三张高清截图（540x1200 缩放，×2 = 原图 1080x2400）：
 *   游戏页「去赚金币」        (130, 1010)
 *   面板「发现精选好物」去完成  (952, 874)
 *   搜索页历史搜索「麦片」      (536, 534)
 *
 * 无障碍树 dump 作为二次校验：读得到就按 bounds 点，读不到（面板有动画时
 * uiautomator 会报 could not get idle state）就用截图坐标，但每次都重试。
 */
import { execFileSync } from 'node:child_process';

const ADB = '/opt/homebrew/bin/adb';
const SERIAL = '3d8a7934';
const BTN = ['去完成', '去逛逛', '逛一逛', '已完成', '立即领取', '去使用'];

const adb = (args: string[], timeout = 25000) =>
  execFileSync(ADB, ['-P', '5037', '-s', SERIAL, ...args], { encoding: 'utf8', timeout });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tap = (x: number, y: number) => adb(['shell', 'input', 'tap', String(x), String(y)], 15000);

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

/** dump 带重试：面板有动画时 uiautomator 会报 could not get idle state */
async function dump(retries = 3): Promise<N[]> {
  for (let i = 0; i <= retries; i++) {
    const n = dumpOnce();
    if (n.length > 30) return n;
    await sleep(1200);
  }
  return dumpOnce();
}

const rows = (nodes: N[]) =>
  nodes
    .filter((n) => /^.{2,40}\((\d+)\/(\d+)\)$/.test(n.text) && !BTN.some((b) => n.text.startsWith(b)))
    .sort((a, b) => a.cy - b.cy);

const prog = (nodes: N[]) => nodes.find((n) => /^\d+\/\d+$/.test(n.text))?.text ?? '?';
const inPanel = (nodes: N[]) => rows(nodes).length >= 3;

/** 从无障碍树找某任务行的按钮 */
function findBtn(nodes: N[], name: string) {
  const label = rows(nodes).find((r) => r.text.includes(name));
  if (!label) return null;
  const btn = nodes
    .filter((n) => BTN.some((b) => n.text.startsWith(b)) && n.clickable)
    .filter((n) => Math.abs(n.cy - label.cy) < 140)
    .sort((a, b) => b.cx - a.cx)[0];
  return btn ? { label: label.text, btn } : null;
}

async function toPanel(): Promise<N[]> {
  let nodes = await dump();
  if (inPanel(nodes)) return nodes;

  // 退回容器页
  for (let i = 0; i < 5; i++) {
    const act = activity();
    if (act.includes('TMSActivity') || act.includes('TBMainActivity')) break;
    console.log(`  退回 (${i + 1}/5)：${act.split('/').pop()}`);
    adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
    await sleep(2500);
  }

  // 游戏页「去赚金币」（Canvas，只能坐标）
  for (const y of [994, 1012, 970, 1030]) {
    console.log(`  点「去赚金币」(130, ${y})`);
    tap(130, y);
    await sleep(6500);
    nodes = await dump();
    if (inPanel(nodes)) return nodes;
  }

  // 兜底：重放入口链
  console.log('  重放入口链');
  adb(['shell', 'am start -W -S -n com.taobao.taobao/com.taobao.tao.welcome.Welcome'], 40000);
  await sleep(10000);
  let n2 = await dump();
  const me = n2.find((n) => n.text === '我的淘宝' && n.clickable);
  if (me) {
    tap(me.cx, me.cy);
    await sleep(6500);
    n2 = await dump();
    const coin = n2.find((n) => n.text.includes('领淘金币') && n.clickable);
    if (coin) {
      console.log(`  ✓ 领淘金币 (${coin.cx},${coin.cy})`);
      tap(coin.cx, coin.cy);
      await sleep(7500);
    }
  }
  for (const y of [994, 1012, 970]) {
    tap(130, y);
    await sleep(6500);
    nodes = await dump();
    if (inPanel(nodes)) return nodes;
  }
  return dump();
}

// ── ① 回面板 ──
console.log('① 回面板');
let nodes = await toPanel();
let rs = rows(nodes);
console.log(`  行数 ${rs.length}，进度 ${prog(nodes)}`);
rs.forEach((r, i) => console.log(`    [${i}] ${r.text}  y=${r.cy}`));

if (!rs.length) {
  console.log('❌ 不在面板，中止');
  process.exit(1);
}

// ── ② 点「发现精选好物」 ──
const hit = findBtn(nodes, '发现精选好物');
let tx = 952;
let ty = 1042;
if (hit) {
  tx = hit.btn.cx;
  ty = hit.btn.cy;
  console.log(`\n② 无障碍树命中「${hit.label}」→ (${tx}, ${ty})`);
} else {
  console.log(`\n② 无障碍树未命中，用截图坐标「发现精选好物」→ (${tx}, ${ty})`);
}
tap(tx, ty);
await sleep(7500);
console.log(`  页面: ${activity().split('/').pop()}`);

// ── ③ 触发搜索 ──
console.log('\n③ 触发搜索');
let page = await dump();
const hist = page.find((n) => n.clickable && n.text === '麦片');
if (hist) {
  console.log(`  ✓ 无障碍树命中历史搜索「麦片」(${hist.cx}, ${hist.cy})`);
  tap(hist.cx, hist.cy);
} else {
  const card = page.find((n) => n.clickable && /麦片|洗发露/.test(n.text));
  if (card) {
    console.log(`  ✓ 搜索发现「${card.text}」(${card.cx}, ${card.cy})`);
    tap(card.cx, card.cy);
  } else {
    console.log(`  ⚠ 无搜索入口（节点 ${page.length}），用截图坐标 (516, 534)`);
    tap(516, 534);
  }
}
await sleep(9000);
console.log(`  搜索后: ${activity().split('/').pop()}`);

// ── ④ 浏览 ──
console.log('\n④ 浏览 10 秒');
await sleep(10000);

// ── ⑤ 回面板读进度 ──
console.log('\n⑤ 回面板');
for (let i = 0; i < 4; i++) {
  if (inPanel(await dump())) break;
  adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK'], 15000);
  await sleep(2500);
}
nodes = await toPanel();
rs = rows(nodes);
console.log(`  行数 ${rs.length}，进度 ${prog(nodes)}`);
rs.forEach((r, i) => console.log(`    [${i}] ${r.text}`));