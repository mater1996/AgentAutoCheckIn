/**
 * 自定义节点：弹窗处理。
 *
 * ⚠️ 核心原则：绝不用 back 关弹窗。
 * back 是破坏性操作——它会退出当前页面。实测在淘金币任务页误判后按 back，
 * 整个任务页被退掉，后续步骤全在错误页面上执行（整轮直接废掉）。
 *
 * 正确做法：
 *   ① 本地无障碍文本快筛，但关键词必须是「只有弹窗才有的词」
 *      （"关闭""跳过"这种页面上到处都是的词不能用）
 *   ② 命中 → 让模型找关闭按钮并点击，不按 back
 *   ③ 未命中 → 直接返回，不调模型
 *
 * 成本策略：本地命中才动作（0 调用），需要模型时只调一次。
 */
import { execFileSync } from 'node:child_process';

import { defineNode, z } from '@midscene/test';

import type { AndroidAgent } from '@midscene/android';

const ADB = process.env.ADB_BIN || '/opt/homebrew/bin/adb';

export interface FileContext {
  agent: AndroidAgent;
  serial: string;
  screen: { w: number; h: number };
  taskAttempt?: import('../task-receipt').TaskAttempt;
  taskEvidence?: import('../task-receipt').TaskReceiptState;
}

/**
 * 高置信度弹窗词：只在这些词出现时才认为有弹窗。
 *
 * 选择标准：这些词在正常页面里几乎不会出现，只在弹窗/浮层里出现。
 * 反例（绝不能加）：关闭、跳过、取消、确定、我知道了 —— 正常页面到处都有，
 * 一旦命中就动作，等于把正常页面当成弹窗处理。
 */
const STRONG_POPUP_WORDS = [
  '以后再说',
  '暂不开启',
  '暂不需要',
  '不同意并退出',
  '跳过广告',
  '残忍拒绝',
  '下次再说',
  '先逛逛别的',
  // 淘宝外跳安全提示：点任务后弹「下个页面不受我们控制哦」，必须点「取消」。
  // 点「浏览器打开」会离开淘宝、任务不计数。实测「头条极速版刷视频」必弹。
  '下个页面不受我们控制',
  '使用时请注意安全',
];

/** 读当前屏幕的无障碍文本（Canvas 页面可能为空） */
function screenTexts(serial: string): string[] {
  try {
    execFileSync(ADB, ['-P', '5037', '-s', serial, 'shell', 'uiautomator', 'dump', '/sdcard/_popup.xml'], {
      encoding: 'utf8',
      timeout: 12000,
    });
    const xml = execFileSync(ADB, ['-P', '5037', '-s', serial, 'shell', 'cat', '/sdcard/_popup.xml'], {
      encoding: 'utf8',
      timeout: 8000,
    });
    return [...xml.matchAll(/(?:text|content-desc)="([^"]+)"/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/**
 * 异常路径的弹窗恢复：只在任务失败或连续无进展时调用。
 *
 * 为什么不放在每个任务 YAML 里：
 *   正常路径 0 成本，异常才花钱。淘宝的浮层很多是纯图标（X），
 *   本地无障碍读不到，只能让模型看一次——所以这个调用要省着用。
 *
 * @returns 是否尝试过恢复
 */
export async function recoverPopup(agent: any): Promise<{ tried: boolean; closed: boolean; detail: string }> {
  try {
    const has = await agent.aiBoolean(
      '当前页面是否有遮挡内容的弹窗、浮层或全屏广告（注意：底部横幅、悬浮球也算）',
    );
    if (!has) return { tried: true, closed: false, detail: '无遮挡弹窗' };

    await agent.aiAct('关闭当前遮挡内容的弹窗、浮层或全屏广告：点击关闭按钮、叉号或「以后再说」这类按钮，不要按返回键');
    await new Promise((r) => setTimeout(r, 1200));
    return { tried: true, closed: true, detail: '已关闭弹窗' };
  } catch (e: any) {
    return { tried: true, closed: false, detail: `恢复失败：${String(e?.message ?? e).slice(0, 60)}` };
  }
}

export const ensureNoPopup = defineNode({
  name: 'ensureNoPopup',
  title: '清理弹窗',
  description:
    '检查并关闭遮挡弹窗。只用高置信度词本地快筛，命中才让模型关闭；绝不按 back（back 会退出页面）。',
  inputSchema: z.strictObject({
    /** 额外的高置信度词，会并入内置清单 */
    extraWords: z.array(z.string()).default([]).describe('额外的高置信度弹窗词'),
    /** 本地未命中时是否让模型兜底检查（贵，默认关闭） */
    useAI: z.boolean().default(false).describe('本地未命中时是否让模型检查'),
  }),
  async execute({ input, context }) {
    const { agent, serial } = context as FileContext;

    // ① 本地快筛：只认高置信度词
    const words = [...STRONG_POPUP_WORDS, ...input.extraWords];
    const texts = screenTexts(serial);
    const hit = words.find((w) => texts.some((t) => t.includes(w)));

    if (hit) {
      // 命中 → 让模型找关闭按钮并点击（不按 back）
      // 「不受我们控制」这类外跳提示要选「取消」，不是「浏览器打开」
      const isOutbound = /不受我们控制|请注意安全/.test(hit);
      const instruction = isOutbound
        ? '点击弹窗里的「取消」按钮（不要点「浏览器打开」），关闭这个外跳提示'
        : `关闭当前弹窗（点击关闭、叉号或「${hit}」这类按钮），不要按返回键`;
      try {
        await agent.aiAct(instruction);
        await new Promise((r) => setTimeout(r, 1200));
        return { summary: `关闭弹窗（本地命中「${hit}」）`, data: { how: 'local+ai', keyword: hit } };
      } catch (e: any) {
        return {
          summary: `弹窗关闭失败：${String(e?.message ?? e).slice(0, 60)}`,
          data: { how: 'local+ai-fail', keyword: hit },
        };
      }
    }

    // ② 本地未命中：默认直接放行（省钱），需要时才让模型查
    if (!input.useAI) {
      return { summary: '本地未发现弹窗', data: { how: 'local-none' } };
    }

    try {
      const has = await agent.aiBoolean('当前页面是否有遮挡内容的弹窗、浮层或全屏广告（不是页面本身的内容）');
      if (!has) return { summary: '无弹窗', data: { how: 'ai', has: false } };

      await agent.aiAct('关闭当前遮挡内容的弹窗、浮层或全屏广告，点击关闭按钮或叉号，不要按返回键');
      await new Promise((r) => setTimeout(r, 1200));
      return { summary: 'AI 关闭弹窗', data: { how: 'ai', has: true } };
    } catch (e: any) {
      // 弹窗检查失败不该让整个任务崩掉
      return {
        summary: `弹窗检查失败（忽略）：${String(e?.message ?? e).slice(0, 60)}`,
        data: { how: 'error' },
      };
    }
  },
});