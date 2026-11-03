import {z} from 'zod';
import {taskIdentity, type RoundAttempt, type RoundInventory, type RoundPlan, type RoundPlanItem} from './round.ts';

const assessment = z.object({
  name: z.string().min(1), instruction: z.string(),
  decision: z.enum(['do', 'skip', 'pending']), times: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(1), actionType: z.string().trim().min(1),
  category: z.enum(['ordinary-in-app', 'invite', 'spending', 'game', 'cross-app', 'auth', 'install', 'phone', 'camera', 'unknown']),
  routeSupported: z.boolean(), stopConditions: z.array(z.string().trim().min(1)).nonempty(),
}).passthrough();
const responseSchema = z.object({items: z.array(assessment)}).passthrough();

export interface RoundPlannerInput {
  inventory: RoundInventory; cfg: unknown; priorPlans?: unknown; knowledge?: unknown;
  attempts?: RoundAttempt[]; policy?: unknown; context?: unknown;
  model: {query(request: {prompt: string; context: unknown}): Promise<unknown>};
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export function explicitlySkipped(input: Pick<RoundPlannerInput, 'cfg' | 'priorPlans' | 'policy'>, task: {name: string; instruction: string}): boolean {
  const priorSkips = array(input.priorPlans).flatMap(source => {
    const plan = object(object(source).plan);
    return array(plan.items ?? plan.tasks).filter(item => object(item).userSkip === true);
  });
  return [...array(object(object(input.cfg).round).exactSkips), ...array(object(input.policy).userSkips), ...priorSkips]
    .some(skip => typeof skip === 'string' ? skip === task.name : object(skip).name === task.name
      && (object(skip).instruction === undefined || object(skip).instruction === task.instruction));
}
export function supportsRoute(cfgValue: unknown, task: {name: string; instruction: string}, actionType: string): boolean {
  const cfg = object(cfgValue), learned = object(cfg.learnedBrowse);
  const action = actionType.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-');
  const matches = (value: unknown) => object(value).name === task.name && object(value).instruction === task.instruction;
  const owned: string[] = [];
  for (const value of array(cfg.interactionRoutes)) {
    const route = object(value);
    if (matches(route.task)) owned.push(['search-browse', 'quiz', 'home-revisit'].includes(String(route.type)) ? String(route.type) : 'unknown');
  }
  for (const value of array(cfg.controllerCandidates)) {
    const route = object(value);
    if (matches(route.task)) owned.push(['panel-claim', 'shop-browse'].includes(String(route.family)) ? String(route.family) : 'unknown');
  }
  const dwell = object(cfg.dwellBrowse), immersive = object(cfg.immersiveBrowse);
  for (const contract of array(dwell.contracts)) {
    if (matches(object(contract).task)) owned.push(dwell.version === 'dwell-browse-candidate-v1' ? 'dwell-browse' : 'unknown');
  }
  if (immersive.enabled === true && matches(immersive.task)) owned.push(
    ['immersive-browse-candidate-v1', 'immersive-browse-candidate-v2'].includes(String(immersive.version)) && immersive.sourceRunId === 145 ? 'immersive-browse' : 'unknown');
  // An exact route owns execution; generic recovery cannot override its action type.
  if (owned.length) return owned.length === 1 && owned[0] !== 'unknown' && owned[0] === action;
  return ['browse', 'ordinary-browse', 'dwell-browse', 'continuous-browse'].includes(action)
    && learned.enabled === true && learned.version === 'continuous-browse-candidate-v1' && learned.sourceRunId === 153
    && cfg.aiTaskRecovery === true && cfg.aiPanelReader === true && cfg.scriptValidationMode === false;
}
export const ROUND_PLANNER_PROMPT = `依据完整 full inventory 原始名称、原始说明、配额、页面上下文、现有 routes、既有计划、知识和尝试历史进行本轮业务规划。逐行理解实际完整要求，严禁按标题关键词或名称猜测类别；标题含游戏等字不表示该独立浏览任务就是游戏。旧计划 do=0 不阻止规划同批次尚未尝试的新身份。观察与规划不授予设备输入权限。
对完整清单每个身份恰好返回一个条目，JSON: {"items":[{"name":"逐字名称","instruction":"逐字说明","decision":"do|skip|pending","times":非负整数,"reason":"基于完整要求与路线的理由","actionType":"browse|dwell-browse|continuous-browse|panel-claim|shop-browse|search-browse|quiz|home-revisit|none","category":"ordinary-in-app|invite|spending|game|cross-app|auth|install|phone|camera|unknown","routeSupported":boolean,"stopConditions":["明确停止条件"]}]}。
actionType 必须对应实际执行路线：interactionRoutes 按逐字 name/instruction 匹配 task，使用其 type；controllerCandidates 按逐字 task 匹配并使用 family；dwellBrowse.contracts 精确任务使用 dwell-browse；启用的 immersiveBrowse 精确任务额外允许 immersive-browse。仅 learnedBrowse.enabled=true 且 aiTaskRecovery=true 等实际运行开关成立时，普通独立浏览可使用 browse、dwell-browse、continuous-browse（兼容 ordinary-browse 别名）。精确路线拥有该任务时不得用其他动作类型覆盖；未知或不支持填 none/pending，routeSupported 自述不授予权限。cfg.round.exactSkips、priorPlans 的 {path,plan} 中 userSkip:true 和 policy.userSkips 是本地强制排除，模型不得覆盖。
按清单顶部到底部排序。do 仅在独立允许的同应用实际行为且存在支持路线时成立，times 不超过剩余配额；一次身份仅尝试一次，既有失败不自动重试。times 是业务剩余次数规划，不是重复执行授权。没有足够要求/路线证据填 pending，不以猜测替代。完成填 skip。邀请、消费、实际游戏行为、外部应用、登录授权、安装、电话和相机均不执行。逐字排除 玩消消乐领金币 和 养小羊免费赚话费。已消费身份与未决 reservation 不重试。
stopConditions 包含输入结果未知、登录/验证码/授权障碍、任务实际要求越界、返回归属未验证、持久化失败；奖励未知不得宣称完成。不得发起动作、发明路线、任意限制时间/次数或排序优化。`;

/** Model business judgement over complete observations; no name heuristics or device authority. */
export async function planRoundInventory(input: RoundPlannerInput): Promise<RoundPlan> {
  if (input.inventory.complete !== true || !Array.isArray(input.inventory.pages) || !input.inventory.pages.length
    || !Array.isArray(input.inventory.tasks) || input.inventory.tasks.some(task => !task.name?.trim()
      || typeof task.instruction !== 'string' || !Number.isSafeInteger(task.done) || !Number.isSafeInteger(task.total)
      || task.done < 0 || task.total < 1 || task.done > task.total)) throw Error('Complete valid inventory required');
  const raw = await input.model.query({prompt: ROUND_PLANNER_PROMPT, context: {
    inventory: input.inventory, cfg: input.cfg, priorPlans: input.priorPlans ?? [],
    knowledge: input.knowledge ?? [], attempts: input.attempts ?? [],
    policy: input.policy ?? {}, context: input.context ?? {},
  }});
  const parsed = responseSchema.parse(raw);
  const identities = new Set(input.inventory.tasks.map(taskIdentity));
  if (identities.size !== input.inventory.tasks.length || parsed.items.length !== identities.size
    || new Set(parsed.items.map(taskIdentity)).size !== identities.size
    || parsed.items.some(item => !identities.has(taskIdentity(item)))) throw Error('Model plan identity coverage mismatch');
  const items: RoundPlanItem[] = input.inventory.tasks.map(task => {
    const item = parsed.items.find(item => taskIdentity(item) === taskIdentity(task))!;
    const consumed = input.attempts?.some(a => a.identity === taskIdentity(task) && a.status === 'consumed');
    const reserved = input.attempts?.some(a => a.identity === taskIdentity(task) && a.status === 'reserved');
    const userSkip = explicitlySkipped(input, task);
    const routeSupported = item.routeSupported && supportsRoute(input.cfg, task, item.actionType);
    const blocked = task.name === '玩消消乐领金币' || task.name === '养小羊免费赚话费'
      || ['invite', 'spending', 'game', 'cross-app', 'auth', 'install', 'phone', 'camera'].includes(item.category);
    let decision = item.decision, reason = item.reason;
    if (userSkip || blocked || consumed || task.done >= task.total) {
      decision = 'skip'; reason += userSkip ? '; explicit user skip' : blocked ? '; outside authorized scope' : consumed ? '; batch identity already consumed' : '; quota complete';
    } else if (reserved || item.category === 'unknown' || !routeSupported || !task.instruction.trim()) {
      decision = 'pending'; reason += reserved ? '; unresolved reservation' : '; requirement or route evidence insufficient';
    }
    const times = decision === 'do' ? Math.min(item.times, task.total - task.done) : 0;
    if (decision === 'do' && times === 0) throw Error('Executable plan needs positive times');
    return {...task, ...item, name: task.name, instruction: task.instruction, done: task.done, total: task.total, decision, reason, times, routeSupported,
      ...(userSkip ? {userSkip: true} : {})};
  });
  return {items, modelResponse: structuredClone(raw)};
}
