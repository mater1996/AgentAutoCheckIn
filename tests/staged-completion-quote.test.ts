import test from 'node:test';
import assert from 'node:assert/strict';
import {currentCompletionQuote} from '../runner/staged/observations.ts';

test('explicit current completion survives unrelated product and other-task text',()=>{
 for(const unrelated of ['如果喜欢这款商品可以收藏','例如新款面料介绍','新手教程','其他任务未完成']){
  assert.equal(currentCompletionQuote([unrelated,'任务已完成！']),'任务已完成！');
  assert.equal(currentCompletionQuote(['任务已完成！',unrelated]),'任务已完成！');
 }
 assert.equal(currentCompletionQuote(['商品介绍：如果喜欢可以收藏。任务已完成！']),'任务已完成！');
});

test('completion tolerates normal punctuation and wrapping without fuzzy characters',()=>{
 for(const text of ['任务已完成！','任务已完成。','任务已完成，继续逛逛吧','任务 已 完成','任务\n已完成','浏览完成！','已完成浏览。'])assert.ok(currentCompletionQuote([text]),text);
 assert.ok(currentCompletionQuote(['任务','已完成']));
 assert.equal(currentCompletionQuote(['任务已完成\n商品介绍：如果喜欢可以收藏']),'任务已完成');
 assert.equal(currentCompletionQuote(['已得30金币\n下单再得500']),'已得30金币');
 for(const text of ['任务己完成','任各已完成','浏览完戌','+30','得奖励','已得30','任务未完成'])assert.equal(currentCompletionQuote([text]),null,text);
});

test('earned-coin receipt is extracted without requiring the following promotion',()=>{
 assert.equal(currentCompletionQuote(['，已得币50|下单再得币500-']),'，已得币50');
 assert.equal(currentCompletionQuote(['已得50｜下单再得500最高']),'已得50');
 assert.equal(currentCompletionQuote(['已得30金币|下单再得500']),'已得30金币');
 assert.equal(currentCompletionQuote(['已获得 30 金币｜下单再得500']),'已获得 30 金币');
 assert.equal(currentCompletionQuote(['已得\n30金币']),'已得\n30金币');
});

test('negated and tutorial completion context cannot become a receipt even across adjacent fragments',()=>{
 for(const texts of [
  ['未完成'],['任务尚未完成'],['没有完成任务'],['未获得30金币'],
  ['教程：任务已完成'],['例如任务已完成'],['如果任务已完成'],['任务已完成后再领取'],
  ['如果浏览完成，任务已完成'],['任务已完成仅为示例'],
  ['教程','任务已完成'],['如果','任务已完成'],['未显示','任务已完成'],['并非','任务已完成'],
  ['如果满足条件','任务已完成'],['任务已完成','后再领取奖励'],
 ])assert.equal(currentCompletionQuote(texts),null,JSON.stringify(texts));
});
