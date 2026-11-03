/**
 * 平台经验上下文：把 config/context/<platform>.md 注入 Midscene。
 *
 * 为什么这样做：
 *   - 每条指令自带全部背景 → prompt 长、且平台知识没有统一出处
 *   - setAIContext('default', ...) 让所有 AI 调用共享一份经验，指令就能写得很短
 *
 * 成本：约 400~600 tokens/次调用，相对每次 4.5K 的截图只增加约 10%，可以忽略。
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('config', 'context');
const cache = new Map<string, string>();

/** 读取某平台的经验文本；没有则返回空串 */
export function buildAIContext(platform: string): string {
  if (!platform) return '';
  if (cache.has(platform)) return cache.get(platform)!;

  const file = path.join(DIR, `${platform}.md`);
  let text = '';
  try {
    if (fs.existsSync(file)) {
      const body = fs.readFileSync(file, 'utf8').trim();
      // 去掉 markdown 的引用块标记，减少噪声 token
      const cleaned = body
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('>'))
        .join('\n')
        .trim();
      if (cleaned) {
        text = `【平台操作经验，必须遵守】\n\n${cleaned}`;
      }
    }
  } catch {
    text = '';
  }

  cache.set(platform, text);
  return text;
}

/** 给 agent 注入上下文；返回实际注入的字数，便于日志核对 */
export function injectAIContext(agent: any, platform: string): number {
  const text = buildAIContext(platform);
  if (!text) return 0;
  try {
    agent.setAIContext('default', text);
    return text.length;
  } catch {
    return 0;
  }
}