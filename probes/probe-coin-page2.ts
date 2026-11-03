/** 尝试进入淘金币「日常版」任务页，并回报当前看到什么。 */
import '../runner/model';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

try {
  // 先回到淘金币首页
  await agent.ai('如果当前不在淘金币页面，就返回直到回到淘金币页面');
  await agent.ai('点击页面右侧竖排的「日常版」标签，进入淘金币日常版页面');
  const seen = await agent.aiQuery(
    '当前页面能看到什么？用一句话说明页面标题，以及是否有任务列表（有则为任务名，无则说明没有）',
  );
  console.log('SEEN:', JSON.stringify(seen));
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 300));
} finally {
  try {
    const m = (agent as any).metrics;
    console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls }));
  } catch {}
  try { await agent.destroy?.(); } catch {}
}