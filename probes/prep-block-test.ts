/** 验证风控闸门：桌面上的文本命中 block 词时应立即返回 NEEDS_HUMAN，不启动 App。 */
import { prep } from '../runner/prep';
import { currentPackage } from '../runner/adb';

const t0 = Date.now();
const r1 = await prep({
  package: 'com.jingdong.app.mall',
  entryTextAny: ['搜索栏', '推荐'],
  blockTextAny: ['热门', '系统应用'], // 桌面上的词，模拟风控页命中
  coldStart: false,
});
console.log(`[命中 block 词] ${r1.ok ? '⚠️ 未拦截' : '✅ 已拦截 ' + (r1 as any).reason + ' — ' + (r1 as any).detail}`);
console.log(`  耗时 ${Date.now() - t0}ms，前台仍是 ${currentPackage() || '?'}（不应启动京东）`);

const t1 = Date.now();
const r2 = await prep({
  package: 'com.jingdong.app.mall',
  entryTextAny: ['搜索栏', '推荐'],
  blockTextAny: ['绝不存在的词'],
  coldStart: false,
  maxPrepMs: 20000,
});
console.log(`\n[不命中 block 词] ${r2.ok ? '✅ 正常归位，冷启动=' + (r2 as any).coldStart : '· ' + (r2 as any).reason + ' — ' + (r2 as any).detail}`);
console.log(`  耗时 ${Date.now() - t1}ms`);
