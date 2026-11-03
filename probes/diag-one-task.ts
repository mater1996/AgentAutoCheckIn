/** 单轮诊断：点第一个「去完成」→ 观察页面 → 返回 → 再看进度。 */
import '../runner/model';
import { shell, sleep } from '../runner/adb';

const { agentFromAdbDevice } = await import('@midscene/android');
const agent = await agentFromAdbDevice(process.env.ADB_SERIAL || '3d8a7934', {
  cache: { strategy: 'read-only', id: 'tb_main' },
});

const shot = (name: string) => {
  shell(`screencap -p /sdcard/${name}.png`);
  shell(`cp /sdcard/${name}.png /sdcard/${name}.png`);
  console.log(`SHOT ${name}`);
};

async function state(tag: string) {
  try {
    const v = await agent.aiQuery(
      '只回复 JSON：{"progress":"完成进度，形如 6/20","tasks_left":还显示「去完成」或「去逛逛」的条目数}',
    );
    console.log(`STATE[${tag}]`, JSON.stringify(v));
    return v as any;
  } catch (e: any) {
    console.log(`STATE[${tag}] ❌`, e?.message?.slice(0, 120));
    return null;
  }
}

try {
  await state('before');
  await agent.ai('点击任务列表里第一个显示「去完成」的任务');
  await sleep(3000);
  console.log('已点击第一个任务');
  shot('t1');

  const opened = await agent.aiQuery('当前页面是什么？用一句话说明（例如"商品详情页""任务列表页""弹窗"）');
  console.log('OPENED:', JSON.stringify(opened));

  await sleep(15000);
  shot('t2');
  const after15 = await agent.aiQuery('当前页面是什么？是否显示"已完成""浏览成功""+X金币"之类的提示？');
  console.log('AFTER15:', JSON.stringify(after15));

  shell('input keyevent KEYCODE_BACK');
  await sleep(3000);
  shot('t3');
  await state('after');
} catch (e: any) {
  console.error('❌', e?.message?.slice(0, 300));
} finally {
  try {
    const m = (agent as any).metrics;
    console.log('METRICS:', JSON.stringify({ tokens: m?.totalTokens, calls: m?.calls }));
  } catch {}
  try { await agent.destroy?.(); } catch {}
}