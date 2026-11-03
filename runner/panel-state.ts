const TASK_PANEL_PROMPT = `只观察当前可见截图，一次返回 JSON：
{
  "pageIsTaskPanel": 是否明确为任务列表面板，布尔值，无法判断填 null,
  "blocked": 是否存在登录、安全验证、滑块、加载或独立遮挡，布尔值，无法判断填 null,
  "pageIdentity": "当前页面身份和可见依据，无法辨认填 null"
}
pageIsTaskPanel=true 必须明确看到任务列表中的任务行、配额（如0/5）和对应操作按钮。
活动首页、奖励展示页、商品页与任务列表面板不同；只有活动标题、奖励或任务入口按钮不能证明已经打开任务列表。
任务面板本身（包括底部抽屉或浮层）不是 blocked；只有独立遮挡、登录、安全验证或加载才是 blocked。
不要推断屏外内容，不执行点击、返回或其他操作。`;

export async function ensureTaskPanel(
  agent: { aiQuery: (prompt: string) => Promise<unknown> },
  options: { recover?: () => Promise<void>; overBudget?: () => boolean },
): Promise<boolean> {
  try {
    if (options.overBudget?.()) return false;
    const raw = await agent.aiQuery(TASK_PANEL_PROMPT) as any;
    if (options.overBudget?.()) return false;
    if (!raw || typeof raw.pageIsTaskPanel !== 'boolean' || raw.blocked !== false) return false;
    if (raw.pageIsTaskPanel) return true;
    if (!options.recover) return false;
    await options.recover();
    if (options.overBudget?.()) return false;
    const recovered = await agent.aiQuery(TASK_PANEL_PROMPT) as any;
    if (options.overBudget?.()) return false;
    return recovered?.pageIsTaskPanel === true && recovered?.blocked === false;
  } catch {
    return false;
  }
}
