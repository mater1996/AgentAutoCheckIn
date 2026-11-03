/**
 * 执行前健康检查（preflight）。
 *
 * 为什么必须做：2026-10-30 实测，通道挂掉时一次运行仍会走到 agent 创建、prep、
 * 若干次调用，最后以 502 失败，白烧 ¥0.3~1.05；设备没连上时也一样会先启动 App 再失败。
 *
 * 五项检查，任何一项不过就整轮跳过，不碰手机、不花钱。
 */
import { execFileSync } from 'node:child_process';

import { sqlite } from '../db/client';

export type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  ms: number;
  /** 致命：false 时整轮不执行 */
  fatal: boolean;
};

export type PreflightResult = {
  ok: boolean;
  checks: CheckResult[];
  /** 第一个致命失败的名称 */
  blockedBy?: string;
};

const ADB = process.env.ADB_BIN || '/opt/homebrew/bin/adb';
const SERIAL = process.env.ADB_SERIAL || '3d8a7934';

function run(cmd: string, args: string[], timeout = 15000): string {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout });
}

// ── 1) 设备在线 ──
function checkDevice(): CheckResult {
  const t0 = Date.now();
  try {
    const out = run(ADB, ['devices']);
    const lines = out.split('\n').slice(1).filter((l) => l.trim());
    const target = lines.find((l) => l.includes(SERIAL));
    if (!target) {
      return { name: '设备连接', ok: false, detail: `找不到设备 ${SERIAL}（${lines.length} 台在线）`, ms: Date.now() - t0, fatal: true };
    }
    if (!target.includes('device')) {
      return { name: '设备连接', ok: false, detail: `设备状态异常：${target.trim()}`, ms: Date.now() - t0, fatal: true };
    }
    return { name: '设备连接', ok: true, detail: SERIAL, ms: Date.now() - t0, fatal: true };
  } catch (e: any) {
    return { name: '设备连接', ok: false, detail: `adb 不可用：${String(e?.message ?? e).slice(0, 80)}`, ms: Date.now() - t0, fatal: true };
  }
}

// ── 2) 电量 ──
function checkBattery(): CheckResult {
  const t0 = Date.now();
  try {
    const out = run(ADB, ['shell', 'dumpsys', 'battery']);
    const lv = out.match(/level:\s*(\d+)/);
    const ac = /AC powered:\s*true/.test(out);
    const level = lv ? Number(lv[1]) : -1;
    if (level >= 0 && level < 15) {
      return { name: '电量', ok: false, detail: `${level}% 过低，需充电`, ms: Date.now() - t0, fatal: true };
    }
    return {
      name: '电量',
      ok: true,
      detail: `${level}%${ac ? ' 充电中' : ' 未充电（跑任务会熄屏）'}`,
      ms: Date.now() - t0,
      fatal: false,
    };
  } catch (e: any) {
    return { name: '电量', ok: false, detail: String(e?.message ?? e).slice(0, 60), ms: Date.now() - t0, fatal: false };
  }
}

// ── 3) App 存在 ──
function checkApp(pkg: string): CheckResult {
  const t0 = Date.now();
  try {
    const out = run(ADB, ['shell', 'pm', 'list', 'packages', pkg]);
    if (!out.includes(pkg)) {
      return { name: 'App 安装', ok: false, detail: `${pkg} 未安装`, ms: Date.now() - t0, fatal: true };
    }
    return { name: 'App 安装', ok: true, detail: pkg, ms: Date.now() - t0, fatal: true };
  } catch (e: any) {
    return { name: 'App 安装', ok: false, detail: String(e?.message ?? e).slice(0, 60), ms: Date.now() - t0, fatal: true };
  }
}

// ── 4) 账号登录态（依据最近一次成功运行 + 是否被挤下线） ──
function checkLogin(accountId: string, pkg: string): CheckResult {
  const t0 = Date.now();
  try {
    // 最近 7 天是否有成功运行
    const lastOk = sqlite
      .prepare(
        `SELECT day, ts FROM run WHERE account_id = ? AND status IN ('OK','ALREADY')
           ORDER BY id DESC LIMIT 1`,
      )
      .get(accountId) as any;

    // 最近是否连续失败且错误里含登录相关字样
    const recent = sqlite
      .prepare(
        `SELECT status, error FROM run WHERE account_id = ?
           ORDER BY id DESC LIMIT 5`,
      )
      .all(accountId) as any[];
    // 只认真正的登录墙，不认我们自己写的说明文字。
    // 之前「登录」这个词太宽：一条解释性错误（"跨 App 任务跳转后落在登录页"）
    // 就把整轮判成 PREFLIGHT_FAILED，什么都不能跑。
    // 真正的登录墙有固定特征：跳到了登录 Activity，或出现「账号下线/请登录」。
    const LOGIN_WALL =
      /(LoginActivity|账号下线|请先登录|请重新登录|登录已失效|login_?required|not_?logged_?in)/i;
    const loginIssue = recent.find((r) => {
      const e = String(r.error ?? '');
      // 我们自己的解释性说明带「：」解释句，跳过
      if (/落在登录页|跳转后落在|未登录：/.test(e)) return false;
      return LOGIN_WALL.test(e);
    });

    if (loginIssue) {
      return { name: '账号登录', ok: false, detail: `检测到登录问题：${String(loginIssue.error).slice(0, 60)}`, ms: Date.now() - t0, fatal: true };
    }
    if (!lastOk) {
      return { name: '账号登录', ok: true, detail: '无历史成功记录，无法确认（首次运行）', ms: Date.now() - t0, fatal: false };
    }
    const days = Math.floor((Date.now() - new Date(lastOk.ts).getTime()) / 86400000);
    return {
      name: '账号登录',
      ok: true,
      detail: `最近成功 ${lastOk.day}（${days} 天前）`,
      ms: Date.now() - t0,
      fatal: false,
    };
  } catch (e: any) {
    return { name: '账号登录', ok: true, detail: `无法查询：${String(e?.message ?? e).slice(0, 50)}`, ms: Date.now() - t0, fatal: false };
  }
}

// ── 5) 模型通道可用（文本 + 识图能力） ──
async function checkModel(baseUrl: string, apiKey: string, model: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { name: '模型通道', ok: false, detail: `HTTP ${res.status} ${body.slice(0, 90)}`, ms, fatal: true };
    }
    return { name: '模型通道', ok: true, detail: `HTTP ${res.status}`, ms, fatal: true };
  } catch (e: any) {
    return { name: '模型通道', ok: false, detail: `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 90)}`, ms: Date.now() - t0, fatal: true };
  }
}

// ── 6) 识图能力（关键：HTTP 200 不代表能看图） ──
async function checkVision(baseUrl: string, apiKey: string, model: string): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    // 1x1 红点 PNG，base64
    const tiny =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '这张图是什么颜色？只回复颜色名' },
              { type: 'image_url', image_url: { url: tiny } },
            ],
          },
        ],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - t0;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { name: '识图能力', ok: false, detail: `HTTP ${res.status} ${body.slice(0, 90)}`, ms, fatal: true };
    }
    const d: any = await res.json().catch(() => ({}));
    const pt = d?.usage?.prompt_tokens ?? 0;
    // 带图请求的 prompt_tokens 明显大于纯文本；过小说明图片被静默丢弃
    if (pt > 0 && pt < 200) {
      return {
        name: '识图能力',
        ok: false,
        detail: `图片疑似被丢弃（prompt_tokens=${pt}，带图应 >200）`,
        ms,
        fatal: true,
      };
    }
    const txt = d?.choices?.[0]?.message?.content ?? '';
    return { name: '识图能力', ok: true, detail: `prompt_tokens=${pt} 回复=${String(txt).slice(0, 20)}`, ms, fatal: true };
  } catch (e: any) {
    return { name: '识图能力', ok: false, detail: `${e?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 90)}`, ms: Date.now() - t0, fatal: true };
  }
}

// ── 7) 风控闸门（当前屏幕是否有验证页） ──
function checkRiskControl(blockTexts: string[]): CheckResult {
  const t0 = Date.now();
  try {
    run(ADB, ['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], 5000);
    // 用无障碍文本粗筛（Canvas 页面读不到，但验证页通常是原生控件）
    const out = run(ADB, ['shell', 'uiautomator', 'dump', '/sdcard/_pf.xml'], 20000);
    const xml = run(ADB, ['shell', 'cat', '/sdcard/_pf.xml'], 10000);
    const hit = blockTexts.find((t) => xml.includes(t));
    if (hit) {
      return { name: '风控闸门', ok: false, detail: `屏幕命中「${hit}」，需人工处理`, ms: Date.now() - t0, fatal: true };
    }
    return { name: '风控闸门', ok: true, detail: `未命中验证页关键词（${blockTexts.length} 个）`, ms: Date.now() - t0, fatal: true };
  } catch (e: any) {
    // 读不到无障碍树不算失败（Canvas 页面本来就 0 节点）
    return { name: '风控闸门', ok: true, detail: `无障碍树不可读（正常，Canvas 页面）`, ms: Date.now() - t0, fatal: false };
  }
}

/** 完整 preflight：任何致命项失败 → ok=false，调用方直接跳过执行 */
export async function preflight(opts: {
  package: string;
  accountId: string;
  blockTextAny: string[];
  modelBaseUrl: string;
  modelApiKey: string;
  modelName: string;
  /** 跳过识图检查（例如已知通道只做文本） */
  skipVision?: boolean;
}): Promise<PreflightResult> {
  const checks: CheckResult[] = [];

  checks.push(checkDevice());
  if (!checks[0].ok) return { ok: false, checks, blockedBy: '设备连接' };

  checks.push(checkBattery());
  checks.push(checkApp(opts.package));
  checks.push(checkLogin(opts.accountId, opts.package));
  checks.push(await checkModel(opts.modelBaseUrl, opts.modelApiKey, opts.modelName));
  if (!checks[checks.length - 1].ok) {
    return { ok: false, checks, blockedBy: '模型通道' };
  }
  if (!opts.skipVision) {
    checks.push(await checkVision(opts.modelBaseUrl, opts.modelApiKey, opts.modelName));
  }
  checks.push(checkRiskControl(opts.blockTextAny));

  const failed = checks.find((c) => !c.ok && c.fatal);
  return { ok: !failed, checks, blockedBy: failed?.name };
}