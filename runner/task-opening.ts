export type OpeningTask = { name: string; instruction: string; quota: string };
export type OpeningObservation = Record<string, any>;
/** A successful tap is not an opened task; only independent page facts authorize progression. */
export async function openTaskDestination(
  agent: { aiTap: (prompt: string) => Promise<unknown> }, task: OpeningTask,
  options: { observe: () => Promise<OpeningObservation | null>; overBudget?: () => boolean },
): Promise<{ observation: OpeningObservation; attempts: number }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (options.overBudget?.()) throw new Error('打开任务预算已到');
    await agent.aiTap(`只打开当前实际任务行${JSON.stringify(task)}对应的操作按钮中心。名称、要求、配额必须同一行精确匹配；不选相邻任务、领取或购物按钮，不执行目的页动作。`);
    const raw = await options.observe();
    if (raw?.pageIsTaskPanel === false && raw.blocked === false && raw.destinationShown === true
      && typeof raw.pageIdentity === 'string' && raw.pageIdentity.trim()) return { observation: raw, attempts: attempt };
    const unchanged = raw?.pageIsTaskPanel === true && raw.blocked === false && raw.destinationShown === false
      && raw.targetName === task.name && raw.targetInstruction === task.instruction && raw.targetQuota === task.quota;
    if (!unchanged) throw new Error('打开任务后页面/身份未知或存在阻挡，停止重试');
    if (attempt === 2) throw new Error('两次定位点击后任务仍未打开');
  }
  throw new Error('任务未打开');
}
