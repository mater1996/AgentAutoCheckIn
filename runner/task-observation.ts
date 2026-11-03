import { observeTaskChange } from './task-evidence';
import type { TaskObservation } from './loop';

/** Visibility is local to this screenshot; it never asserts task completion. */
export async function readTaskObservation(agent: { aiQuery: (prompt: string) => Promise<any> }, task: { name: string }): Promise<TaskObservation> {
  try {
    const raw = await agent.aiQuery(`只观察当前截图，返回JSON {"pageIsTaskPanel":是否明确任务列表面板,"blocked":是否加载/遮挡/登录验证,"targetVisible":当前截图是否可见目标任务行,"name":"可见目标完整名称，不含配额","done":可见目标已完成次数,"total":目标上限}。目标名称${JSON.stringify(task.name)}。只报告当前截图中的可见性，不判断整个滚动列表是否存在目标，不推断完成。面板清楚且目标当前不可见时targetVisible=false，name/done/total用null；无法判断可见性用null。`);
    if (!raw || raw.pageIsTaskPanel !== true || raw.blocked !== false) return null;
    if (raw.targetVisible === false) return { name: task.name, absent: true, pageIsTaskPanel: true, scope: 'visible' };
    if (raw.targetVisible !== true || raw.name !== task.name) return null;
    const counter = { name: raw.name, done: raw.done, total: raw.total };
    return observeTaskChange(counter, counter).status === 'unknown' ? null : counter;
  } catch { return null; }
}
