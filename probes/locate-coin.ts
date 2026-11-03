/** 定位器：用 aiLocate 拿真实坐标，再逐个试点击。 */
import '../runner/model';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

async function locate(desc: string) {
  try {
    const r = await agent.aiLocate(desc);
    console.log(`LOCATE ${desc} →`, JSON.stringify(r));
    return r;
  } catch (e: any) {
    console.log(`LOCATE ${desc} ❌`, e?.message?.slice(0, 100));
    return null;
  }
}

try {
  await locate('页面右侧竖排的「日常版」入口');
  await locate('页面下方的「去赚金币」按钮');
} finally {
  try {
    const m = (agent as any).metrics;
    console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls }));
  } catch {}
  try { await agent.destroy?.(); } catch {}
}