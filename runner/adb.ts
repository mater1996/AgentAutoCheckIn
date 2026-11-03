/** adb 封装：全部同步调用，避免并发操作同一台设备。
 *  原则：不在设备端用管道（grep 会让 dumpsys 断管丢输出），全部拉回本地解析。 */
import { execFileSync } from 'node:child_process';

export const DEVICE = process.env.ADB_SERIAL || '3d8a7934';

function adb(args: string[], timeoutMs = 25000): string {
  try {
    return execFileSync('adb', ['-s', DEVICE, ...args], {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e: any) {
    return e?.stdout ? String(e.stdout) : '';
  }
}

export const shell = (cmd: string, timeoutMs?: number) => adb(['shell', cmd], timeoutMs);
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isConnected(): boolean {
  return /device\b/.test(adb(['devices']));
}

export function screenOn(): boolean {
  return /mWakefulness=Awake/.test(shell('dumpsys power'));
}

export function wake(): void {
  if (!screenOn()) shell('input keyevent KEYCODE_WAKEUP');
  shell('wm dismiss-keyguard');
}

/** 前台 Activity。HyperOS 用 topResumedActivity，AOSP 用 mResumedActivity；再回退 mCurrentFocus。 */
export function currentActivity(): string {
  const act = shell('dumpsys activity activities', 40000);
  let m =
    act.match(/topResumedActivity=ActivityRecord\{\S+\s+u\d+\s+([\w.\/]+)/) ||
    act.match(/mResumedActivity:\s*ActivityRecord\{\S+\s+u\d+\s+([\w.\/]+)/);
  if (m) return m[1];

  const win = shell('dumpsys window', 40000);
  m = win.match(/mCurrentFocus=Window\{\S+\s+u\d+\s+([\w.\/]+)\}/);
  if (m) return m[1];
  m = win.match(/mFocusedApp=ActivityRecord\{\S+\s+u\d+\s+([\w.\/]+)/);
  return m ? m[1] : '';
}

export function currentPackage(): string {
  return currentActivity().split('/')[0] || '';
}

/** 取当前界面全部可识别文本（text + content-desc）。本地解析，0 模型调用。
 *  实测：淘宝首页图标区（领淘金币/红包签到/芭芭农场）在无障碍树里无任何节点，
 *  只能靠视觉定位；底部导航则以 content-desc 暴露（首页/视频/消息/购物车/我的淘宝）。 */
export function screenTexts(): string[] {
  const out = shell('uiautomator dump /sdcard/_d.xml >/dev/null 2>&1; cat /sdcard/_d.xml', 40000);
  const texts: string[] = [];
  for (const re of [/text="([^"]+)"/g, /content-desc="([^"]+)"/g]) {
    for (const m of out.matchAll(re)) {
      const t = m[1].trim();
      if (t) texts.push(t);
    }
  }
  return texts;
}

/**
 * 文本/描述 + 中心坐标 + 是否可点，用于按语义点击。
 *
 * clickable 很重要：淘宝首页同一个「领淘金币」会出现 3 个节点
 * （外层 FrameLayout 不可点、内层 FrameLayout 可点、文字 View 不可点）。
 * 不区分就会点到不可点的那个，表现为「点了没反应」。
 */
export function screenNodes(): Array<{
  text: string;
  cx: number;
  cy: number;
  kind: 'text' | 'desc';
  clickable: boolean;
  area: number;
}> {
  const out = shell('uiautomator dump /sdcard/_d.xml >/dev/null 2>&1; cat /sdcard/_d.xml', 40000);
  const nodes: Array<{
    text: string;
    cx: number;
    cy: number;
    kind: 'text' | 'desc';
    clickable: boolean;
    area: number;
  }> = [];

  // 必须按 <node ...> 逐个解析，不能用「text|content-desc 后接 bounds」的联合正则：
  // 淘宝节点普遍是 text="" content-desc="我的淘宝"，联合正则会先匹配到空的 text=，
  // 把后面的 content-desc 吞掉，导致所有 content-desc 节点都读不到（踩过这个坑）。
  for (const m of out.matchAll(/<node\b[^>]*>/g)) {
    const tag = m[0];
    const text = (/\btext="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
    const desc = (/\bcontent-desc="([^"]*)"/.exec(tag)?.[1] ?? '').trim();
    const label = text || desc;
    if (!label) continue;

    const b = /\bbounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(tag);
    if (!b) continue;
    const x1 = Number(b[1]);
    const y1 = Number(b[2]);
    const x2 = Number(b[3]);
    const y2 = Number(b[4]);

    nodes.push({
      text: label,
      kind: text ? 'text' : 'desc',
      cx: Math.round((x1 + x2) / 2),
      cy: Math.round((y1 + y2) / 2),
      clickable: /\bclickable="true"/.test(tag),
      area: Math.max(0, x2 - x1) * Math.max(0, y2 - y1),
    });
  }
  return nodes;
}

/** 按文本/描述找可点节点：优先 clickable，其次面积最大（外层容器） */
export function findNode(needle: string, nodes?: ReturnType<typeof screenNodes>) {
  const list = nodes ?? screenNodes();
  const hits = list.filter((n) => n.text.includes(needle));
  if (!hits.length) return null;
  const clickable = hits.filter((n) => n.clickable);
  const pool = clickable.length ? clickable : hits;
  return pool.sort((a, b) => b.area - a.area)[0];
}

export function hasAnyText(needles: string[], texts?: string[]): string | null {
  const list = texts ?? screenTexts();
  const joined = list.join('\u0001');
  for (const n of needles) if (joined.includes(n)) return n;
  return null;
}

/** 解析启动入口 Activity */
export function launcherActivity(pkg: string): string {
  const out = shell(`cmd package resolve-activity --brief ${pkg}`);
  const line = out.trim().split('\n').filter(Boolean).pop() || '';
  return line.includes('/') ? line.trim() : '';
}

/** 冷启动 App */
export function launchApp(pkg: string): boolean {
  const comp = launcherActivity(pkg);
  if (!comp) return false;
  shell(`am start -W -n ${comp}`, 45000);
  return true;
}

export function forceStop(pkg: string): void {
  shell(`am force-stop ${pkg}`);
}

export function batteryLevel(): number {
  const m = shell('dumpsys battery').match(/level:\s*(\d+)/);
  return m ? Number(m[1]) : -1;
}

/** 插电常亮位掩码：1=AC 2=USB 4=无线 8=底座；0=全关，15=全开 */
export function getStayOn(): number {
  const out = shell('settings get global stay_on_while_plugged_in').trim();
  const m = out.match(/^(\d+)$/);
  return m ? Number(m[1]) : 0;
}

export function setStayOn(v: number): void {
  shell(`settings put global stay_on_while_plugged_in ${v}`);
}
