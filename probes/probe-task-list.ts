/** 进入赚金币任务页，读出真实任务清单与档位。 */
import '../runner/model';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

try {
  await agent.ai('点击页面上橙色的「赚更多金币」大按钮，进入赚金币任务页');
  const info = await agent.aiQuery(
    '只回 JSON：{"progress":"a/b","tiers":[{"coin":数字,"need":"如10次任务或已达成","button":"立即领取/已领取/未达成"}],"tasks":[{"name":"任务名","quota":"如0/1","button":"去完成/已完成"}]}',
  );
  console.log('INFO:', typeof info === 'string' ? info : JSON.stringify(info));
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 300));
} finally {
  try {
    const m = (agent as any).metrics;
    console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls }));
  } catch {}
  try { await agent.destroy?.(); } catch {}
}