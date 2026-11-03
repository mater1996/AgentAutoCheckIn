/**
 * Prep：把手机带到活动要求的确定起始状态。全程 adb 本地判断，0 模型调用。
 *
 * P0 设备健康 → P1 清干扰 → P2 启动 App → P3 等待就绪 → P4 归位 → P5 起始断言
 *
 * 设计要点（实测得出）：
 * - 淘宝所有页面共用一个 Activity，判断"在哪一页"只能靠页面文本特征，不能看 Activity 名
 * - 不在设备端用管道 grep（会让 dumpsys 断管丢输出）
 * - back 归位优先，冷启动兜底（冷启动会触发首屏广告，反而更慢）
 */
import {
  batteryLevel,
  currentActivity,
  currentPackage,
  forceStop,
  hasAnyText,
  isConnected,
  launchApp,
  screenNodes,
  screenTexts,
  shell,
  sleep,
  wake,
} from './adb';

export type PrepConfig = {
  package: string;
  /** 判定「已在目标起始页」的特征文本 */
  entryTextAny: string[];
  /** 一旦出现就立即中止（风控/验证/滑块）。命中即 NEEDS_HUMAN，不尝试绕过 */
  blockTextAny?: string[];
  maxBacks?: number;
  maxPrepMs?: number;
  /** 强制冷启动（每天该 App 第一个活动用） */
  coldStart?: boolean;
  dismissKeywords?: string[];
};

export type PrepResult =
  | { ok: true; coldStart: boolean; ms: number; hitText: string }
  | {
      ok: false;
      reason: 'DEVICE_ERROR' | 'LAUNCH_FAILED' | 'NEEDS_HUMAN';
      detail: string;
      ms: number;
    };

const DEFAULT_DISMISS = [
  '跳过', '关闭', '以后再说', '我知道了', '暂不', '不同意', '稍后再说', '立即更新',
];

/**
 * 页面稳定检测：两次采样签名相同才算稳定。
 * 为什么需要：Prep 的 P5 断言可能在「渲染过渡态」的一瞬间通过，
 * 紧接着交给 Midscene 的第一步就会看到半成品页面（实测因此漏判过一次条件）。
 */
async function settle(maxMs = 6000): Promise<boolean> {
  const start = Date.now();
  let prev = '';
  let same = 0;
  while (Date.now() - start < maxMs) {
    const t = screenTexts();
    if (!t.length) {
      await sleep(400);
      continue;
    }
    const sig = `${t.length}|${t[0] ?? ''}|${t[t.length - 1] ?? ''}`;
    if (sig === prev) {
      same++;
      if (same >= 1) return true; // 连续两次一致
    } else {
      same = 0;
      prev = sig;
    }
    await sleep(450);
  }
  return false;
}

/** 点掉挡路弹窗。只在命中关键词时才解析节点，省 dumpsys 次数。 */
function dismissNoise(keywords: string[]): number {
  shell('cmd statusbar collapse');
  let closed = 0;
  for (let round = 0; round < 4; round++) {
    const nodes = screenNodes();
    const target = nodes.find((n) => keywords.some((k) => n.text === k || n.text.includes(k)));
    if (!target) break;
    shell(`input tap ${target.cx} ${target.cy}`);
    closed++;
    sleep(800);
  }
  return closed;
}

export async function prep(cfg: PrepConfig): Promise<PrepResult> {
  const t0 = Date.now();
  const done = (r: PrepResult) => ({ ...r, ms: Date.now() - t0 });
  const dismiss = cfg.dismissKeywords ?? DEFAULT_DISMISS;
  const deadline = t0 + (cfg.maxPrepMs ?? 75000);

  // ---- P0 设备健康 ----
  if (!isConnected()) {
    return done({ ok: false, reason: 'DEVICE_ERROR', detail: '设备未连接', ms: 0 });
  }
  const lvl = batteryLevel();
  if (lvl > 0 && lvl < 15) {
    return done({ ok: false, reason: 'DEVICE_ERROR', detail: `电量过低 ${lvl}%`, ms: 0 });
  }
  wake();

  // ---- P0.5 风控闸门（仅当目标 App 已在前台时才判定）----
  // 不能无条件检查当前屏幕：如果别的 App 卡在验证页，会把所有活动全挡住。
  const blockTextAny = cfg.blockTextAny ?? ['验证后', '滑块', '人机验证', '安全验证', '拖动滑块'];
  const checkBlock = (): string | null => {
    if (!blockTextAny.length) return null;
    return hasAnyText(blockTextAny);
  };
  if (currentPackage() === cfg.package) {
    const blocked = checkBlock();
    if (blocked) {
      return done({
        ok: false,
        reason: 'NEEDS_HUMAN',
        detail: `目标 App 当前停在风控验证页（命中「${blocked}」），已停止，不尝试绕过`,
        ms: 0,
      });
    }
  }

  // ---- P1 清干扰 ----
  dismissNoise(dismiss);

  // ---- P2 启动 App ----
  let coldStart = false;
  const needStart = cfg.coldStart || currentPackage() !== cfg.package;
  if (needStart) {
    if (cfg.coldStart) forceStop(cfg.package);
    if (!launchApp(cfg.package)) {
      return done({
        ok: false,
        reason: 'LAUNCH_FAILED',
        detail: '解析不到启动入口 Activity',
        ms: 0,
      });
    }
    coldStart = true;
    let up = false;
    for (let i = 0; i < 8; i++) {
      sleep(800);
      if (currentPackage() === cfg.package) {
        up = true;
        break;
      }
    }
    if (!up) {
      return done({
        ok: false,
        reason: 'LAUNCH_FAILED',
        detail: `启动后前台是 ${currentPackage() || '未知'}`,
        ms: 0,
      });
    }
  }

  // ---- P2.5 启动后闸门：目标 App 一起来就在验证页，立刻停 ----
  {
    const blocked = checkBlock();
    if (blocked) {
      return done({
        ok: false,
        reason: 'NEEDS_HUMAN',
        detail: `目标 App 启动后停在风控验证页（命中「${blocked}」），已停止，不尝试绕过`,
        ms: 0,
      });
    }
  }

  // ---- P3 等待就绪 ----
  // 淘宝首页已全 Canvas 化（dump 只有 1 个节点，读不到任何文本），
  // 所以有 entryActivityAny 时用 Activity 名判定，文本判定只作兜底。
  const actAny = (cfg as any).entryActivityAny ?? [];
  const hitEntry = (): string | null => {
    if (actAny.length) {
      const a = currentActivity();
      return actAny.find((k: string) => a.includes(k)) ?? null;
    }
    return hasAnyText(cfg.entryTextAny);
  };
  // 轮询间隔压到 400ms：screenTexts 本身约 1.5~2s，所以一次循环 ≈ 2s
  for (let i = 0; i < 20 && Date.now() < deadline; i++) {
    const hit = hitEntry();
    if (hit) {
      await settle(); // 等页面渲染稳定再交给 Midscene
      return done({ ok: true, coldStart, ms: 0, hitText: hit });
    }
    await sleep(400);
    // 每 5 轮清一次干扰（首屏广告/更新弹窗）
    if (i > 0 && i % 5 === 0) dismissNoise(dismiss);
  }

  // ---- P4 归位：back 逐步退回 ----
  // 配了 entryActivityAny 的平台（如淘宝）跳过这一步：
  // 淘宝二级页读不到任何文本，判定必然失败，按 back 只会把 App 退到桌面。
  // 这类平台的归位由 entry 的 `am start -W -S` 负责。
  const maxBacks = actAny.length ? 0 : (cfg.maxBacks ?? 3);
  for (let i = 0; i < maxBacks && Date.now() < deadline; i++) {
    shell('input keyevent KEYCODE_BACK');
    sleep(1400);
    dismissNoise(dismiss);
    const hit = hitEntry();
    if (hit) {
      await settle(); // 等页面渲染稳定再交给 Midscene
      return done({ ok: true, coldStart, ms: 0, hitText: hit });
    }
  }

  // ---- P4b 冷启动兜底 ----
  if (!coldStart) {
    forceStop(cfg.package);
    sleep(600);
    if (launchApp(cfg.package)) {
      coldStart = true;
      for (let i = 0; i < 12 && Date.now() < deadline; i++) {
        sleep(1100);
        dismissNoise(dismiss);
        const hit = hitEntry();
        if (hit) {
      await settle(); // 等页面渲染稳定再交给 Midscene
      return done({ ok: true, coldStart, ms: 0, hitText: hit });
    }
      }
    }
  }

  // ---- P5 起始断言失败 ----
  // 配了 entryActivityAny 的平台：只要目标 App 在前台就放行，
  // 因为「停在哪个页面」由 entry 的 am start -S 负责，不该在这里判死。
  if (actAny.length && currentPackage() === cfg.package) {
    return done({
      ok: true,
      coldStart,
      ms: 0,
      hitText: `app-foreground:${currentActivity()}`,
    });
  }
  return done({
    ok: false,
    reason: 'NEEDS_HUMAN',
    detail: `归位失败，界面无特征文本：${cfg.entryTextAny.join(' / ')}`,
    ms: 0,
  });
}
