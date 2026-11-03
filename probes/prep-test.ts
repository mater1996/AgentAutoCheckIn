/** 验证 prep 归位逻辑：三种起始状态都要能回到淘宝首页。 */
import { prep } from '../runner/prep';
import { currentPackage, screenTexts, shell, sleep } from '../runner/adb';

const CFG = {
  package: 'com.taobao.taobao',
  // 实测：图标区（领淘金币等）无障碍树里没有节点，只能用底部导航的 content-desc 判断在首页
  entryTextAny: ['我的淘宝', '购物车'],
  maxBacks: 3,
  maxPrepMs: 70000,
};

async function show(label: string) {
  const texts = screenTexts().slice(0, 6).join(' | ');
  console.log(`  [${label}] 前台=${currentPackage() || '?'}  首屏文本=${texts.slice(0, 70)}`);
}

async function runCase(name: string, setup: () => Promise<void>) {
  console.log(`\n--- ${name} ---`);
  await setup();
  await show('前置状态');
  const r = await prep(CFG);
  if (r.ok) {
    console.log(`  ✅ 归位成功  耗时 ${r.ms}ms  冷启动=${r.coldStart}  命中文本="${r.hitText}"`);
  } else {
    console.log(`  ❌ 失败 ${r.reason}: ${r.detail}  (${r.ms}ms)`);
  }
  return r.ok;
}

const results: boolean[] = [];

results.push(
  await runCase('用例1：已在首页（应秒过）', async () => {}),
);

results.push(
  await runCase('用例2：停在淘金币页（需 back 归位）', async () => {
    shell('input keyevent KEYCODE_BACK');
    await sleep(2000);
  }),
);

results.push(
  await runCase('用例3：回到桌面（需冷启动）', async () => {
    shell('input keyevent KEYCODE_HOME');
    await sleep(1500);
  }),
);

results.push(
  await runCase('用例4：杀掉再跑（冷启动 + 等待）', async () => {
    shell('am force-stop com.taobao.taobao');
    await sleep(1000);
  }),
);

console.log(`\n${'='.repeat(40)}\n通过 ${results.filter(Boolean).length}/${results.length}`);
