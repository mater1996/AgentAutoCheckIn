export { executeUnlearnedTask } from './learned-attempt';
export type { UnlearnedTask, UnlearnedTaskAgent, UnlearnedTaskOptions } from './learned-attempt';

export function buildUnknownTaskPrompt(task: { name: string; instruction?: string; quota: string; reward: number }): string {
  return `当前任务面板中本次观察到的目标任务是：${JSON.stringify(task)}。
只完成这个目标的一次配额，不要根据名称猜测任务类型。读取当前行的完整说明，点击对应按钮后再次读取实际页面的提示、倒计时和要求，按实际提示执行。
仅允许浏览、停留、滚动、当前App内必要的普通搜索和返回；不购买、不加购、不支付、不授权登录、不切账号、不跳其他App。遇登录、验证码、会员/消费前提或无法确认的页面立即停止。
完成后回到原活动的任务面板就停止；不领奖、不做其他任务。按钮点击成功不代表任务完成，外层会独立读取此任务计数。若未完成或不能返回要如实报告。`;
}
