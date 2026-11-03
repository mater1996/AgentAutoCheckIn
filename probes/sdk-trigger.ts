/**
 * 触发 SDK 编排层，只拿结果。
 *
 * 用法：
 *   npx tsx probes/sdk-trigger.ts "为 tb_main 收集 tb_coin 的任务清单并给出计划，不要执行"
 *   npx tsx probes/sdk-trigger.ts "执行 tb_coin 签到"
 */
import { orchestrate } from '../runner/orchestrator';

const prompt = process.argv.slice(2).join(' ') || '收集 tb_coin 的任务清单并给出计划，不要执行';

const t0 = Date.now();
const r = await orchestrate(prompt);
const ms = Date.now() - t0;

console.log('=== SDK 编排结果 ===');
console.log('ok:', r.ok);
console.log('turns:', r.turns);
console.log('usage:', JSON.stringify(r.usage));
console.log('logFile:', r.logFile);
if (r.error) console.log('error:', r.error);
console.log(`耗时 ${(ms / 1000).toFixed(1)}s`);
console.log('\n=== 输出 ===');
console.log(r.text || '(空)');
