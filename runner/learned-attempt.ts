import { openTaskDestination } from './task-opening';
import type { TaskWorkflowResult } from './loop';
import { createTaskReceiptState, isValidTaskReceipt, recordTaskEntered, recordTaskReceipt, type TaskAttempt } from './task-receipt';

export type UnlearnedTask = { name: string; instruction: string; quota: string; reward: number };
export type UnlearnedTaskAgent = {
  aiTap(prompt: string): Promise<unknown>;
  aiAct(prompt: string): Promise<unknown>;
  aiQuery(prompt: string): Promise<unknown>;
};
export type UnlearnedTaskOptions = {
  completionMarkers: string[];
  returnToPanel: () => Promise<boolean>;
  overBudget?: () => boolean;
};

const boundaries = '仅允许当前App内普通浏览、停留、滚动和必要搜索。不购买、不加购、不支付、不授权登录、不切账号、不跳其他App、不领奖、不执行其他任务。遇到登录、验证码、会员或消费前提、阻挡弹窗或无法确认的页面立即停止。';

/** The caller supplies receipt policy and bounded navigation; this module owns no device. */
export async function executeUnlearnedTask(
  agent: UnlearnedTaskAgent,
  task: UnlearnedTask,
  attempt: TaskAttempt,
  options: UnlearnedTaskOptions,
): Promise<TaskWorkflowResult> {
  const started = Date.now();
  const state = createTaskReceiptState(attempt);
  const errors: string[] = [];
  const result = (): TaskWorkflowResult => ({
    ok: errors.length === 0, ...(errors.length ? { error: errors.join('；') } : {}), ms: Date.now() - started,
    taskEvidence: structuredClone(state), ...(state.receipt ? { taskReceipt: structuredClone(state.receipt) } : {}),
  });
  const act = async (prompt: string) => {
    try { await agent.aiAct(prompt); }
    catch (error: any) { errors.push(String(error?.message ?? error)); }
  };
  const target = JSON.stringify(task);
  try {
    if (!task.name?.trim() || !task.instruction?.trim() || attempt.name !== task.name || attempt.instruction !== task.instruction
        || !attempt.attemptId?.trim() || !Number.isSafeInteger(attempt.startedAt) || attempt.startedAt < 0 || attempt.startedAt > Date.now()) {
      throw new Error('任务回执身份与本次实际任务不符，或执行时间无效');
    }
    if (!Array.isArray(options.completionMarkers) || !options.completionMarkers.length
        || options.completionMarkers.some((marker) => typeof marker !== 'string' || !marker.trim())) {
      throw new Error('缺少配置的完整任务完成标记');
    }
    if (options.overBudget?.()) throw new Error('任务执行预算已耗尽，未打开任务');
    const readEntry = () => agent.aiQuery(`只观察当前屏幕，不操作、不返回。实际选中的任务为${target}。返回JSON {"pageIdentity":"实际页面身份或实际内容，不用任务名代替","destinationShown":boolean,"pageIsTaskPanel":boolean,"blocked":boolean,"instructions":"目的页实际可见操作要求、搜索词和倒计时，看不到空字符串","completionMarkers":["可见待完成条件或完整完成提示"],"targetName":"若仍在面板则抄目标完整名称，否则null","targetInstruction":"若仍在面板则抄目标完整要求，不含奖励，否则null","targetQuota":"若仍在面板则抄目标配额，否则null","inputRequired":是否实际要求输入后提交才能继续，布尔值,"inputValue":"根据可见明确要求或当前可见推荐词选取的普通输入文字，无依据null","inputTarget":"实际可编辑输入框描述，无则null","submitTarget":"实际提交按钮描述，无则null"}。只有明确离开面板进入本任务目的页destinationShown才true；面板自身不是阻挡。输入需求依据实际要求和完整页面上下文，不按任务名称或输入框存在猜测。不要猜测屏外信息。`);
    const opened = await openTaskDestination(agent, task, { observe: readEntry as () => Promise<any>, overBudget: options.overBudget });
    const raw: any = opened.observation;
    const config = { taskName: task.name, instruction: task.instruction, destination: raw?.pageIdentity };
    recordTaskEntered(state, config, raw);
    if (options.overBudget?.()) errors.push('任务执行预算已耗尽，停止后续操作');
    const observedRequirements = typeof raw.instructions === 'string' && !!raw.instructions.trim()
      || Array.isArray(raw.completionMarkers) && raw.completionMarkers.some((text: unknown) => typeof text === 'string' && !!text.trim());
    if (!errors.length && raw.inputRequired === true) {
      if (![raw.inputValue, raw.inputTarget, raw.submitTarget].every(v => typeof v === 'string' && v.trim())) throw new Error('输入要求缺少实际文字或控件依据');
      const checkBudget = () => { if (options.overBudget?.()) throw new Error('输入阶段预算已耗尽'); };
      checkBudget();
      await act(`只激活实际输入框${JSON.stringify(raw.inputTarget)}的焦点，看到光标或软键盘后停止，不输入不提交。${boundaries}`);
      if (errors.length) return result();
      const focus: any = await agent.aiQuery('只读当前输入状态，返回JSON {"inputFocused":是否明确目标输入框已有光标焦点,"keyboardShown":是否软键盘已打开}。看不清填null，不操作。');
      if (focus?.inputFocused !== true || focus.keyboardShown !== true) throw new Error('输入未确认：目标框焦点或键盘未就绪');
      checkBudget();
      await act(`只在已确认焦点的${JSON.stringify(raw.inputTarget)}填入当前实际页面选择的普通文字${JSON.stringify(raw.inputValue)}。不提交不搜索不返回。${boundaries}`);
      if (errors.length) return result();
      const entered: any = await agent.aiQuery(`只读目标输入框${JSON.stringify(raw.inputTarget)}实际内容，返回JSON {"inputText":"逐字原文，空则空串，读不到null"}。不能把占位词或下方联想词当输入。`);
      if (entered?.inputText !== raw.inputValue) throw new Error('输入未确认：实际输入文字与本次要求不符，未提交');
      checkBudget();
      await act(`只提交已经独立确认的非空输入${JSON.stringify(raw.inputValue)}，使用页面实际${JSON.stringify(raw.submitTarget)}操作。确认结果加载后停，不浏览不返回。${boundaries}`);
      if (errors.length) return result();
      const submitted: any = await agent.aiQuery(`只读提交结果，返回JSON {"resultsShown":是否真实结果已加载,"blocked":是否阻挡或验证,"inputText":"结果页实际搜索词"}。本次要求${JSON.stringify(raw.inputValue)}，看不到填null，不操作。`);
      if (submitted?.resultsShown !== true || submitted.blocked !== false || submitted.inputText !== raw.inputValue) throw new Error('输入提交未确认：实际结果或搜索词不符');
    }
    const alreadyComplete = Array.isArray(raw.completionMarkers)
      && raw.completionMarkers.some((text: unknown) => typeof text === 'string' && options.completionMarkers.includes(text));
    if (!errors.length && observedRequirements && !alreadyComplete) await act(`当前选中任务为${target}，已经确认进入目的页。本次实际观察为${JSON.stringify(raw)}。只按目的页当前实际可见说明完成这个任务最多一次配额，可根据页面实际要求浏览、滚动或搜索，禁止根据任务名称或自行猜测秒数套模板。若要求不明确就停止。出现属于本任务且逐字符合配置${JSON.stringify(options.completionMarkers)}的完整完成提示立即停止，不要返回任务面板，保留完成提示供独立取证。${boundaries}`);
    const completion = await agent.aiQuery(`只观察当前屏幕，不操作、不返回。实际任务为${target}，进入时原始页面身份为${JSON.stringify(config.destination)}。返回JSON {"pageIdentity":"实际页面身份，不要改写或推测","destinationShown":boolean,"pageIsTaskPanel":boolean,"blocked":boolean,"completionText":"逐字抄录当前目的页中属于本任务的完整完成提示，看不到则空字符串"}。destinationShown仅在明确仍属同一任务目的页时为true。只接受配置的完整原文${JSON.stringify(options.completionMarkers)}，标点空格也必须一致，不要补全不可见文字；任务面板、其他任务或泛泛已完成不算。`);
    recordTaskReceipt(state, { ...config, completionMarker: options.completionMarkers }, completion);
    if (!isValidTaskReceipt(state.receipt, attempt)) throw new Error('任务完成回执无效');
    if (!await options.returnToPanel()) throw new Error('任务完成回执已记录，但无法确认返回任务面板');
    return result();
  } catch (error: any) {
    errors.push(String(error?.message ?? error));
    return result();
  }
}
