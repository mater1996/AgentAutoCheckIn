/** 探测：用 Midscene 进入赚金币任务页并读出真实结构。 */
import '../runner/model';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

try {
  await agent.ai('点击页面下方的「去赚金币」按钮，进入赚金币任务页');
  const state = await agent.aiQuery(
    '以 JSON 回复：{"progress":"a/b 格式的完成进度","balance":数字,"tasks":[{"name":任务名,"quota":"如0/1","reward":"如+20","button":"去完成或已完成"}]}',
  );
  console.log('STATE:', JSON.stringify(state));
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 300));
} finally {
  try {
    const m = (agent as any).metrics;
    console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls }));
  } catch {}
  try { await agent.destroy?.(); } catch {}
}