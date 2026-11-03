/**
 * L2 归因：把 L1 的实例动作序列归纳成类型模板。
 *
 * 只在这一步用模型（1 次调用）。理由：从"这次点了这些"到"这类任务永远这样做"
 * 需要判断，而不是解析。
 */
import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';

import { sqlite, nowIso } from '../db/client';
import {writeStateFile} from './storage/structured.ts';
import { loadAgentCfg, applyAgentEnv } from './agent-config';

export type Template = {
  kind: string;
  steps: { act: string; note?: string; seconds?: number; text_template?: string }[];
  invariants: string[];
  failure_modes: string[];
  confidence: 'high' | 'medium' | 'low';
  derived_from: string[];
};

/** 读某活动的所有 L1 实例 */
export function loadObservations(activityId: string): any[] {
  return sqlite
    .prepare(`SELECT task_name, kind, steps_json, retries, outcome FROM recipe WHERE activity_id = ?`)
    .all(activityId) as any[];
}

/** 用 SDK 归纳模板；失败时退回规则推断 */
export async function deriveTemplates(
  platform: string,
  observations: any[],
): Promise<{ templates: Template[]; how: 'agent' | 'rules'; log?: string }> {
  if (!observations.length) return { templates: [], how: 'rules' };

  // ── 优先：让 SDK 归纳 ──
  try {
    const cfg = loadAgentCfg();
    // 通道预检：挂了就别让 SDK 重试 20 轮（实测一次会烧 20 次 502）
    const { checkModelHealth } = await import('./health');
    const h = await checkModelHealth(cfg.base_url, process.env[cfg.auth_token_env] ?? '', cfg.model, 15000);
    if (!h.ok) {
      console.log(`  通道不可用（${h.detail.slice(0, 60)}），改用规则推断`);
      throw new Error('model down');
    }
    if (cfg.enabled) {
      applyAgentEnv(cfg);
      const sdk = await import('@anthropic-ai/claude-agent-sdk');
      const prompt = `下面是某平台做任务时观测到的实际动作序列。请归纳成可复用的类型模板。

观测数据：
${JSON.stringify(observations.map((o) => ({ task: o.task_name, steps: JSON.parse(o.steps_json), retries: o.retries })), null, 2)}

要求：只回复 JSON，结构如下，不要任何解释：
{
  "templates": [
    {
      "kind": "类型名（browse/search/miniapp/camera/crossapp）",
      "steps": [{"act":"tap|input|dwell|back|swipe","note":"这步在做什么","seconds":可选,"text_template":"如{keyword}"}],
      "invariants": ["这类任务必须满足的条件，例如必须真的输入文字"],
      "failure_modes": ["已知会导致不计数的做法"],
      "confidence": "high|medium|low",
      "derived_from": ["来自哪个任务名"]
    }
  ]
}`;

      let text = '';
      const stream = sdk.query({
        prompt,
        options: {
          maxTurns: 2,
          allowedTools: [],
          permissionMode: 'bypassPermissions',
          model: cfg.model,
          env: {
            ...process.env,
            CLAUDE_CONFIG_DIR: path.resolve('.claude-agent'),
            ANTHROPIC_BASE_URL: cfg.base_url,
            ANTHROPIC_AUTH_TOKEN: process.env[cfg.auth_token_env] ?? '',
            ANTHROPIC_MODEL: cfg.model,
            NO_PROXY: '127.0.0.1,localhost',
            no_proxy: '127.0.0.1,localhost',
          },
        },
      });
      for await (const msg of stream as any) {
        if (msg?.type === 'result' && typeof msg.result === 'string') text = msg.result;
        if (msg?.type === 'assistant') {
          for (const b of msg.message?.content ?? []) if (b?.type === 'text') text += b.text;
        }
      }
      const a = text.indexOf('{');
      const b = text.lastIndexOf('}');
      if (a >= 0 && b > a) {
        const parsed = JSON.parse(text.slice(a, b + 1));
        if (Array.isArray(parsed?.templates) && parsed.templates.length) {
          return { templates: parsed.templates, how: 'agent' };
        }
      }
    }
  } catch (e: any) {
    // 落到规则推断
  }

  // ── 兜底：规则推断 ──
  const rules: Template[] = [];
  const kinds = new Map<string, any[]>();
  for (const o of observations) {
    const k = o.kind ?? 'unknown';
    if (!kinds.has(k)) kinds.set(k, []);
    kinds.get(k)!.push(o);
  }
  // 各类型的固有规律（来自实测经验，不依赖模型）
  const KNOWN: Record<string, { invariants: string[]; failure_modes: string[] }> = {
    browse: {
      invariants: ['点开后必须停留 12 秒以上，停留不足不计入进度', '完成后必须返回任务页'],
      failure_modes: ['点开后立刻返回 → 不计数', '停留时屏幕熄灭 → 计时中断'],
    },
    search: {
      invariants: ['必须在搜索框真的输入关键词并点搜索按钮', '只停留不算完成', '搜索按钮在搜索框同一行右侧'],
      failure_modes: ['搜索框为空就返回 → 不计数', '输入法弹起遮挡按钮 → 点不到搜索'],
    },
    miniapp: {
      invariants: ['必须真的进入小程序页面', '停留 15 秒以上'],
      failure_modes: ['只跳到小程序首页就返回 → 不计数'],
    },
    camera: {
      invariants: ['需要开启相机或相册权限', '按页面提示走完拍照/选图流程'],
      failure_modes: ['权限弹窗未处理 → 流程中断', '相机界面每次不同，坐标不可复用'],
    },
    crossapp: {
      invariants: ['会离开淘宝进入支付宝', '返回后需重新确认在淘金币页面'],
      failure_modes: ['跳转后未返回 → 后续任务全错'],
    },
  };

  for (const [kind, list] of kinds) {
    const first = list[0];
    const known = KNOWN[kind] ?? { invariants: [], failure_modes: [] };
    // 动作归一化：连续多个 input 合并成一个（实际是同一输入框重复输入）
    const rawSteps = JSON.parse(first.steps_json) as any[];
    const merged: any[] = [];
    for (const s of rawSteps) {
      if (s.act === 'input' && merged[merged.length - 1]?.act === 'input') continue;
      if (s.act === 'sleep') continue; // sleep 是模型自己加的，不是业务步骤
      merged.push({
        act: s.act,
        note: s.target,
        seconds: s.act === 'dwell' ? (kind === 'miniapp' ? 15 : 12) : undefined,
        text_template: s.act === 'input' ? '{keyword}' : undefined,
      });
    }
    // 保证末尾有 back
    if (merged.length && merged[merged.length - 1].act !== 'back') {
      merged.push({ act: 'back', note: '返回任务页' });
    }
    rules.push({
      kind,
      steps: merged,
      invariants: known.invariants,
      failure_modes: known.failure_modes,
      confidence: 'medium',
      derived_from: list.map((x) => x.task_name),
    });
  }
  return { templates: rules, how: 'rules' };
}

/** 落盘：文件 + SQLite */
export function saveTemplates(platform: string, templates: Template[]) {
  const dir = path.resolve('data', 'templates');
  writeStateFile(path.join(dir, `${platform}.json`), { platform, templates });

  for (const t of templates) {
    sqlite
      .prepare(
        `INSERT INTO task_template (platform, kind, steps_json, invariants_json, failure_modes_json, derived_from_json, confidence, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(platform, kind) DO UPDATE SET
           steps_json=excluded.steps_json, invariants_json=excluded.invariants_json,
           failure_modes_json=excluded.failure_modes_json, derived_from_json=excluded.derived_from_json,
           confidence=excluded.confidence, updated_at=excluded.updated_at`,
      )
      .run(
        platform,
        t.kind,
        JSON.stringify(t.steps),
        JSON.stringify(t.invariants ?? []),
        JSON.stringify(t.failure_modes ?? []),
        JSON.stringify(t.derived_from ?? []),
        t.confidence,
        nowIso(),
      );
  }
}