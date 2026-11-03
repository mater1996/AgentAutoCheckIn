import '../runner/model';
import fs from 'node:fs';
import path from 'node:path';
import { syncToDb } from '../runner/config';
import { runActivity } from '../runner/signin';

// One normal entry: no taskName, no candidateYaml and no currentPage bypass.
const root = path.resolve('evidence/正常入口闭环-2026-10-31');
fs.mkdirSync(root, { recursive: true });
syncToDb();
const result = await runActivity({ activityId: 'tb_coin', supervisedLearning: true,
  maxTasks: 1, budgetMs: 720000, cacheStrategy: 'read-only' });
fs.writeFileSync(path.join(root, `normal-${result.runId}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok && result.nextPlanFile ? 0 : 1;
