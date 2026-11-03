/** 模型通道配置。必须在导入 @midscene/android 之前执行。 */
// 默认走计量代理 :3426（caller=midscene），这样每次调用都会落 model_call 表。
// 代理未启动时会连不上，由 signin 的通道预检拦下并记 MODEL_DOWN。
process.env.MIDSCENE_MODEL_BASE_URL ||= 'http://127.0.0.1:3426/v1';
process.env.MIDSCENE_MODEL_API_KEY ||= process.env.CHECKIN_VISION_API_KEY ?? '';
// 默认 terra：实测在真实淘宝截图上与 sol 精度等同（平均偏差 0.031 vs 0.030，
// 中位延迟 7.7s vs 7.9s），瓶颈是图像清晰度而非模型档位。需要时可整体切 sol。
process.env.MIDSCENE_MODEL_NAME ||= 'codex/gpt-6.1-terra';
process.env.MIDSCENE_MODEL_FAMILY ||= 'gpt-6';
process.env.MIDSCENE_MODEL_TEMPERATURE ||= '0';
// 单次调用超时收紧到 90s：之前 180s × 重试会让一个步骤卡 5 分钟以上，
// 实测导致整轮超出 900s 预算还在跑（run#20 exec 1358s）
process.env.MIDSCENE_MODEL_TIMEOUT ||= '90000';
process.env.MIDSCENE_MODEL_RETRY_COUNT ||= '1';
// 重规划上限：默认 20 轮，实测导致一次运行 43 次 planning（占 83% tokens）。
// 2 太紧——entry 的复合导航（首页图标区是 Canvas，视觉定位会偏）需要几次自愈才成；
// 6 是折中：够 entry 纠错，又不至于雪崩。任务执行已改为纯 adb YAML，不受此影响。
process.env.MIDSCENE_REPLANNING_CYCLE_LIMIT ||= '6';
process.env.NO_PROXY ||= '127.0.0.1,localhost';
process.env.no_proxy ||= '127.0.0.1,localhost';

export const MODEL = {
  baseUrl: process.env.MIDSCENE_MODEL_BASE_URL,
  name: process.env.MIDSCENE_MODEL_NAME,
  family: process.env.MIDSCENE_MODEL_FAMILY,
};


/**
 * 把 run_id 注入 base_url，让计量代理能把调用归到具体 run。
 *
 * ⚠️ 必须放在**路径段**里，不能放 query。
 * OpenAI SDK 会在 base_url 后面直接拼 `/chat/completions`，
 * 如果 base_url 是 `.../v1?run_id=23`，拼出来就是
 * `.../v1?run_id=23/chat/completions` —— query 后面再接路径，网关直接 404。
 * 实测就是这个 bug 导致探测连续 3 次拿到 0/0。
 */
export function setRunContext(runId: number | null) {
  // 先剥掉可能已有的 /run/<n> 段，避免重复叠加
  let base = (process.env.MIDSCENE_MODEL_BASE_URL || 'http://127.0.0.1:3426/v1').replace(
    /\/run\/\d+/g,
    '',
  );
  base = base.split('?')[0];
  process.env.MIDSCENE_MODEL_BASE_URL = runId ? `${base}/run/${runId}` : base;
}
