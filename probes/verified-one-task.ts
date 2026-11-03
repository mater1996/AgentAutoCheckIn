import '../runner/model';
import fs from 'node:fs';
import { runActivity } from '../runner/signin';

const taskName = process.argv[2];
if (!taskName) throw new Error('usage: tsx probes/verified-one-task.ts <current exact task name>');
const result = await runActivity({ activityId: 'tb_coin', currentPage: true, maxTasks: 1, taskName, budgetMs: 240_000, cacheStrategy: 'read-only' });
fs.mkdirSync('evidence/闭环改进-2026-10-30', { recursive: true });
fs.writeFileSync('evidence/闭环改进-2026-10-30/platform-one-task.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
