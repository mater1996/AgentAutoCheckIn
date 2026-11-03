/** 验证 setAIContext 真的生效：注入后做一次无副作用的判断，看是否报错、token 是否包含上下文。 */
import '../runner/model';

import { injectAIContext } from '../runner/context';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

const chars = injectAIContext(agent, 'taobao');
console.log(`注入字数: ${chars}`);

try {
  // 无副作用：只判断，不点击
  const onTaobao = await agent.aiBoolean('当前页面是否是淘宝 App 的界面');
  console.log('aiBoolean 结果:', onTaobao);

  // 验证上下文是否真的被用上：问一个只有上下文里才有的信息
  const fromCtx = await agent.aiQuery('根据你的操作经验，淘金币的签到入口按钮叫什么？只回复按钮名称');
  console.log('上下文检索:', JSON.stringify(fromCtx));

  const m = (agent as any).metrics;
  console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls, byIntent: Object.keys(m?.byIntent ?? {}) }));
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 300));
} finally {
  try { await agent.destroy?.(); } catch {}
}