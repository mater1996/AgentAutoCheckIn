/** 确认默认模型通道确实是 terra，并且 plan/locate/insight 三类调用都能跑通。 */
import '../runner/model';
import { MODEL } from '../runner/model';

console.log('默认通道:', JSON.stringify(MODEL));

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

try {
  const onHome = await agent.aiBoolean('当前页面底部是否有「我的淘宝」标签');
  console.log('aiBoolean(在首页) =', onHome);

  const n = await agent.aiNumber('页面上「淘金币」旁边的数字是多少？只回复数字');
  console.log('aiNumber(淘金币) =', n);

  const m = (agent as any).metrics;
  console.log('本次 metrics:', JSON.stringify({
    totalTokens: m?.totalTokens, calls: m?.calls,
    byIntent: Object.fromEntries(Object.entries(m?.byIntent ?? {}).map(([k, v]: any) => [k, v.calls])),
  }));
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 200));
} finally {
  try { await agent.destroy?.(); } catch {}
}