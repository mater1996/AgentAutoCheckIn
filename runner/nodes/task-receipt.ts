import { defineNode, z } from '@midscene/test';
import type { FileContext } from './ensure-no-popup';
import { recordTaskEntered, recordTaskReceipt, type TaskDestinationConfig, type TaskReceiptConfig } from '../task-receipt';

const destinationFields = {
  taskName: z.string().min(1),
  instruction: z.string().min(1),
  destination: z.string().min(1).describe('预期目的页身份，如商品搜索结果页；不绑定动态商品名'),
};
function observationPrompt(config: TaskDestinationConfig | TaskReceiptConfig): string {
  const marker = 'completionMarker' in config ? config.completionMarker : undefined;
  return `只观察当前屏幕，不点击、不返回。当前实际选中任务为${JSON.stringify(config.taskName)}，行内说明为${JSON.stringify(config.instruction)}。
判断是否仍在任务列表面板、是否有登录/验证/弹窗阻挡，识别目的页身份；预期为${JSON.stringify(config.destination)}，符合则使用此身份，不符合则说明实际页面。
返回JSON {"pageIdentity":"当前页面身份，可描述实际内容而不强求固定名称","destinationShown":boolean,"pageIsTaskPanel":boolean,"blocked":boolean${marker === undefined ? '' : ',"completionText":"逐字抄录当前目的页中属于本任务的完整完成提示，看不到则空字符串","rewardText":"可见奖励原文，看不到则空字符串"'}}。destinationShown只有在明确进入预期目的页时为true。
${marker === undefined ? '' : `完成提示只接受以下配置的逐字原文${JSON.stringify(marker)}；标点和空格也需一致。任务面板其他行的已完成、通用按钮或无关提示均不算。`}
不要返回任务名称作为身份判断，不要推测不可见文字。`;
}
function receiptContext(context: unknown, input: TaskDestinationConfig): FileContext {
  const ctx = context as FileContext;
  if (!ctx.taskEvidence || !ctx.taskAttempt) throw new Error('任务回执缺少本次执行上下文');
  if (input.taskName !== ctx.taskAttempt.name || input.instruction !== ctx.taskAttempt.instruction) {
    throw new Error('任务回执配置与实际选中任务不符');
  }
  return ctx;
}

export const taskEntered = defineNode({
  name: 'taskEntered',
  title: '记录当前任务目的页进入证据',
  inputSchema: z.strictObject(destinationFields),
  async execute({ input, context }) {
    const ctx = receiptContext(context, input);
    // Clear earlier evidence before even querying: a failed new entry cannot reuse it.
    delete ctx.taskEvidence!.entered;
    delete ctx.taskEvidence!.receipt;
    const raw = await ctx.agent.aiQuery(observationPrompt(input));
    const entry = recordTaskEntered(ctx.taskEvidence!, input, raw);
    return { summary: `任务目的页已确认：${entry.destination}`, data: entry };
  },
});

export const taskReceipt = defineNode({
  name: 'taskReceipt',
  title: '在返回前记录当前任务完成回执',
  inputSchema: z.strictObject({ ...destinationFields, completionMarker: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).describe('完整完成原文，或允许的精确原文变体数组') }),
  async execute({ input, context }) {
    const ctx = receiptContext(context, input);
    delete ctx.taskEvidence!.receipt;
    if (!ctx.taskEvidence!.entered) throw new Error('任务完成回执缺少先行 taskEntered');
    const raw = await ctx.agent.aiQuery(observationPrompt(input));
    const receipt = recordTaskReceipt(ctx.taskEvidence!, input, raw);
    return { summary: `任务完成回执：${receipt.completionMarker}`, data: receipt };
  },
});
