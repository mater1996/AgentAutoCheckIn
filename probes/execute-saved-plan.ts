import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { runActivity } from '../runner/signin';

// Supervised execution of the exact output of a persisted complete-list plan.
const file = process.argv[2];
if (!file) throw new Error('usage: tsx probes/execute-saved-plan.ts <plan.json>');
const document = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!document.inventory?.completeness?.full || !document.inventory.completeness.coverage.returnedToTop) throw new Error('计划缺少完整收集证据');
if (document.inventory.account !== 'tb_main' || document.inventory.activity !== 'tb_coin') throw new Error('计划会话不匹配');
const age = Date.now() - Date.parse(document.inventory.collected_at);
if (!(age >= 0 && age < 15 * 60000)) throw new Error('计划已过期');
const selected = [...document.plan.plan, ...document.plan.learning];
if (selected.length !== 1 || selected[0].times !== 1) throw new Error('本监督入口要求计划恰好一项一次');
const item = selected[0];
const task = document.inventory.tasks.find((t: any) => t.name === item.task && t.instruction === item.instruction && t.quota === item.quota);
if (!task || task.remaining <= 0) throw new Error('计划与原始清单不匹配');
console.log('EXECUTING_SAVED_PLAN', JSON.stringify({ source: path.resolve(file), sourceRunId: document.runId, task: item.task, instruction: item.instruction, reason: item.reason, times: 1 }));
const result = await runActivity({ activityId: 'tb_coin', currentPage: true, maxTasks: 1, taskName: item.task, budgetMs: 240000, cacheStrategy: 'read-only' });
const out = { sourcePlan: path.resolve(file), sourcePlanRunId: document.runId, selected: item, result };
const root = path.dirname(file);
fs.writeFileSync(path.join(root, `executed-plan-${result.runId ?? Date.now()}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
