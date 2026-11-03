/**
 * 关键假设验证：ai() 的规划缓存能否在 Android 上命中，第二次是否省掉规划调用。
 * 每次都从完全相同的状态（强杀 + 冷启动 + 等首页）开始，保证可比。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

process.env.MIDSCENE_MODEL_BASE_URL = 'http://127.0.0.1:3425/v1';
process.env.MIDSCENE_MODEL_API_KEY ||= process.env.CHECKIN_VISION_API_KEY ?? '';
process.env.MIDSCENE_MODEL_NAME = 'codex/gpt-6.1-sol';
process.env.MIDSCENE_MODEL_FAMILY = 'gpt-6';
process.env.MIDSCENE_MODEL_TEMPERATURE = '0';
process.env.MIDSCENE_MODEL_TIMEOUT = '180000';
process.env.NO_PROXY = '127.0.0.1,localhost';
process.env.no_proxy = '127.0.0.1,localhost';
process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`;

const DEVICE = process.env.ADB_SERIAL || '3d8a7934';
const PKG = 'com.taobao.taobao';
const CACHE_ID = 'probe-ai-tb-coin';
const CACHE_FILE = `midscene_run/cache/${CACHE_ID}.cache.yaml`;

const adb = (...args: string[]) => execFileSync('adb', ['-s', DEVICE, ...args], { encoding: 'utf8' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 冷启动淘宝并等到首页（纯 adb，0 模型调用） */
async function resetToHome() {
  adb('shell', 'am', 'force-stop', PKG);
  await sleep(1200);
  adb('shell', 'am', 'start', '-n', `${PKG}/com.taobao.tao.welcome.Welcome`);
  for (let i = 0; i < 25; i++) {
    await sleep(800);
    try {
      adb('shell', 'uiautomator', 'dump', '/sdcard/h.xml');
      const xml = adb('shell', 'cat', '/sdcard/h.xml');
      // 首页特征：底部导航 + 图标区
      if (xml.includes('我的淘宝') && (xml.includes('领淘金币') || xml.includes('芭芭农场'))) {
        return true;
      }
    } catch {}
  }
  return false;
}

function cacheInfo() {
  try {
    const y = readFileSync(CACHE_FILE, 'utf8');
    const n = (y.match(/-\s*id:/g) || []).length;
    return `${y.trim().split('\n').length} 行, 条目数≈${n}`;
  } catch {
    return '文件不存在';
  }
}

const { agentFromAdbDevice } = await import('@midscene/android');

const TASK = '点击淘宝首页上方的「领淘金币」图标，进入淘金币页面';

for (const pass of [1, 2]) {
  console.log(`\n${'='.repeat(56)}\n第 ${pass} 次执行`);
  const ok = await resetToHome();
  console.log(`  归位到首页: ${ok ? '✅' : '❌'}`);
  if (!ok) break;

  const agent = await agentFromAdbDevice(DEVICE, {
    cache: { strategy: 'read-write', id: CACHE_ID },
  });

  const t0 = Date.now();
  let err = '';
  try {
    await agent.ai(TASK);
  } catch (e: any) {
    err = e?.message || String(e);
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  let landed = false;
  try {
    adb('shell', 'uiautomator', 'dump', '/sdcard/a.xml');
    const xml = adb('shell', 'cat', '/sdcard/a.xml');
    landed = /淘金币/.test(xml) && !/芭芭农场/.test(xml);
  } catch {}

  console.log(`  耗时: ${dt}s  结果: ${err ? '❌ ' + err.slice(0, 120) : '✅ 无异常'}`);
  console.log(`  是否进入淘金币页: ${landed ? '✅ 是' : '❌ 否（仍在首页）'}`);
  console.log(`  缓存: ${cacheInfo()}`);

  try {
    await agent.flushCache?.();
  } catch {}
  try {
    await agent.destroy?.();
  } catch {}
}
