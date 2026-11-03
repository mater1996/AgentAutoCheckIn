/**
 * Midscene 冒烟测试：验证能否通过本机 magpie 网关驱动 codex 模型操作真机。
 * 只做安全动作：启动淘宝 → 等待首页 → 定位并点击「领淘金币」→ 读页面数值。
 */
process.env.MIDSCENE_MODEL_BASE_URL = 'http://127.0.0.1:3425/v1';
process.env.MIDSCENE_MODEL_API_KEY ||= process.env.CHECKIN_VISION_API_KEY ?? '';
process.env.MIDSCENE_MODEL_NAME = 'codex/gpt-6.1-sol';
process.env.MIDSCENE_MODEL_FAMILY = 'gpt-6';
process.env.MIDSCENE_MODEL_TEMPERATURE = '0';
process.env.MIDSCENE_MODEL_TIMEOUT = '120000';
// 走本机网关，不要被 shell 代理拦到外网
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';

const DEVICE = process.env.ADB_SERIAL || '3d8a7934';

const t0 = Date.now();
const step = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

const { agentFromAdbDevice } = await import('@midscene/android');

let agent: any;
try {
  step('连接设备 ' + DEVICE);
  agent = await agentFromAdbDevice(DEVICE, {
    cache: { strategy: 'read-write', id: 'smoke-tb-coin' },
  });
  step('✅ 已连接');

  step('启动淘宝');
  await agent.launch('com.taobao.taobao');

  step('等待首页加载');
  await agent.aiWaitFor('淘宝首页已经加载完成，能看到底部导航栏', { timeoutMs: 60000 });
  step('✅ 首页就绪');

  step('定位并点击「领淘金币」');
  await agent.aiTap('首页上方图标区的「领淘金币」');
  step('✅ 已点击');
} catch (e: any) {
  console.error('\n❌ 失败:', e?.message || e);
  if (e?.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
} finally {
  if (agent) {
    try {
      await agent.flushCache?.();
      step('缓存已写盘');
    } catch (e: any) {
      console.error('flushCache 失败:', e?.message);
    }
    try {
      await agent.destroy?.();
    } catch {}
  }
  step('结束');
}
