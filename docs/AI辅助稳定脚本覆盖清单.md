# AI辅助稳定脚本覆盖清单

证据截止：2026-11-02T08:23:42.121166+08:00；已落盘结果run218至run219，最新完整盘点run219。此文件是只读取证快照，**不是live状态**；父任务后续执行不自动进入本报告。项目相对路径均指 `/Users/mater/Project/checkin-platform`。

**16类均有首学来源，但目前没有一类达到新的稳定标准。** 新AI模式只有精选好物run218正常入口一次成功、+50；IP run219停止，回执和结算缺失。旧首学、监督恢复、离线测试和读旧图模型探针均不补当前独立成功次数。

稳定要求来自 `docs/AI辅助稳定脚本推进方案.md`：同一适用执行过程至少两个独立正常入口session；同attempt真实回执；正确资产页两张新帧稳定正收益；源码/配置归档；预算、清理通过；无聊天手工坐标或修账。脚本内部AI判断允许。影响执行过程的修改仍需重新验证，不能把旧零模型审计删掉条件后直接称稳定。

统计口径：Python按任务名＋要求核对16类；最新完整盘点去重20项。其中6类精确出现、1类同名要求不一致、9类缺席。可见5类额度为0/1（到访、闪购、IP、话费、金币加抵），均不能同日凑两次成功；当前没有证据显示它们已耗尽额度。缺席、缺配置、执行停止分开记录，不互相替代。

配置简称：D = `data/evidence/plans/stable-scripts-20261101/ai-batch-dwell-config.json`（10项dwell合同、AI面板、单session一项）；A = 同目录 `available-ai-panel-config.json`（精选好物/沉浸视频AI配置）；C = 同目录 `continuous-config.json`（旧连续浏览配置、仍为scriptValidationMode=true）。这些只是候选配置，不等于已验证可在当前落地页完成。

| # | 已学任务＋原要求 | 实际脚本／可用配置 | 最新完整名单 | 新AI成功／停止 | 当前缺口 |
|---|---|---|---|---|---|
| 1 | 任务到访得金币<br>每日来任务面板 | panel-claim → controller-route/runtime；缺controllerCandidates配置 | 0/1，领取奖励；日限1次 | 0 / 0 | 补候选配置和瞬时toast快采，跨日两次正常入口 |
| 2 | 你关注的商品都可抵<br>浏览15秒 | dwell-browse；D，15秒 | 缺席 | 0 / 0 | 等精确入口出现，再验两次 |
| 3 | 逛逛金币加抵好货<br>浏览5秒 | dwell-browse；D，5秒 | 0/1，逛一逛；日限1次 | 0 / 0 | 已配未跑；每日1次，需跨日 |
| 4 | 来淘宝闪购分百亿补贴<br>下单最高+1000，浏览5秒 | dwell-browse；D但plan为pending，落地历史10秒 | 同名要求不一致；0/1，去完成；日限1次 | 0 / 0 | 当前要求“下单，浏览5秒”；须核对独立浏览条件，不能按同名替换原要求 |
| 5 | 充话费0元起！<br>浏览5秒 | dwell-browse；D，5秒 | 0/1，逛一逛；日限1次 | 0 / 0 | 已配未跑；每日1次，需跨日 |
| 6 | 天天签到免费拿IP周边<br>浏览最新礼盒得 | dwell-browse；D，receiptOnly | 0/1，去完成；日限1次 | 0 / 1 | run219合同不匹配停止；未证实到账或额度耗尽，需复核实际页面 |
| 7 | 逛好店赚一大波金币<br>浏览15秒 | shop-browse → controller-route/runtime；缺配置及learningBudget | 缺席 | 0 / 0 | 缺当前卡片绑定、候选手势预算、店内和店铺列表双层回执及两次返回验证 |
| 8 | 好物沉浸看<br>浏览 | immersive-browse/transition/ocr-quality；A | 缺席 | 0 / 0 | run218返回文案不算本类成功；等真实视频入口 |
| 9 | 看看#精致面霜<br>浏览 | learned-browse/continuous-contract；C | 缺席 | 0 / 0 | C仍为旧模式且AI计划未列本任务；当前缺席；不能拿“看看#海飞”顶替 |
| 10 | 发现精选好物<br>浏览 | learned-browse/continuous-contract；A | 1/3，去完成 | 1 / 0 | run218仅1次；需要第二独立正常session并核验实际落地合同 |
| 11 | 去芭芭农场逛一逛<br>浏览5秒 | dwell-browse；D，5秒 | 缺席 | 0 / 0 | 等精确入口；不可用支付宝农场代替 |
| 12 | 去省钱卡领红包<br>浏览5秒 | dwell-browse；D，5秒 | 缺席 | 0 / 0 | 等精确入口，领红包名称不自动扩展领取权限 |
| 13 | 拍立淘逛感兴趣的宝贝<br>浏览5秒 | dwell-browse；D，5秒；另有pali-config旧配置 | 0/5，去完成 | 0 / 0 | 已配未跑；0/5可见，需两个新独立成功 |
| 14 | 查看我的会员等级<br>浏览5秒 | dwell-browse；D，5秒 | 缺席 | 0 / 0 | 等精确入口出现，再验两次 |
| 15 | 看看你关注的新品动态<br>浏览5秒 | dwell-browse；D，5秒 | 缺席 | 0 / 0 | 等精确入口出现，再验两次 |
| 16 | 养小羊免费赚话费<br>浏览5秒 | dwell-browse通用模块存在；缺本任务合同/配置 | 缺席 | 0 / 0 | run168首学存在，但10项dwell中没有本任务，不能拿充值话费合同代替 |

**新的AI会话证据。** 两次session都正常启动，不能把同一attempt恢复另算一次。源码归档SHA已用真实文件逐份核验；“source archive通过”只说明来源完整，不代表稳定。

- run218：发现精选好物＋浏览，completed；session `6ae7d10a-cc0f-4151-b5f5-9d4d3a5acf82`，attempt `3db4b229-7993-42ca-9b45-bd6c0cd7c598`。AI 14次、109391 tokens，模型耗时合计107971ms。源码/配置归档27份，全部SHA一致；cleanup errors=[]，息屏读回Dozing/Asleep通过。证据目录 `evidence/staged-2026-11-02T00-09-04-370Z`，JSON内逐项列出source archive路径/hash。
  余额2265→2315，净增50；本attempt原图 `40476858-b8d9-40e8-91c2-0643cf67f84b.png` 显示“已得50”，下单再得500是另一条件，未记作收益。结算两帧 `40e6110f-c76e-422e-9ce2-d835e2b4a538.png` 和 `2dbb8aca-2602-434e-98f3-fdf1caa8c186.png` 都在所属活动面板显示2315。连续滑动锁定50短合同（16次/18秒上限）；阶段动作来源均script，runtime未见manual/recovery/continuation类事件。保留为一次AI辅助成功；learningValidation=diagnostic_only，不发布稳定标记。
- run219：天天签到免费拿IP周边＋浏览最新礼盒得，stopped；session `65c4e45c-4fb5-4f2c-bdc0-e5f9e296ec58`，attempt `12e2e0f3-5627-4b57-a219-5050e8c591b3`。AI 13次、103999 tokens，模型耗时合计117849ms。源码/配置归档29份，全部SHA一致；cleanup errors=[]，息屏读回Dozing/Asleep通过。证据目录 `evidence/staged-2026-11-02T00-19-22-514Z`，JSON内逐项列出source archive路径/hash。
  IP入口已派发，open_task停止：`AI panel mode requires existing local task/receipt contract; model interruption disabled`。receipt=null、balanceAfter=null、gainCoins=null；不能报0收益，也不能报成功，不能擅自重发已消费attempt。现有AI面板模式在落地合同未知时仍硬停，未完整实现推进方案的未知页交给AI判断。

**任务身份与真实要求。** run218入口原图显示“发现精选好物(0/3)／浏览+50”，返回两张结算图显示“好物沉浸看(1/3)／浏览+50”；run219完整盘点又读作“发现精选好物(1/3)”。已派发入口、连续导航、同attempt回执和正增量支持把run218归于所选精选好物的一次成功，但无稳定业务ID证明两个名称永久等价，不能把它再算视频类成功。原图路径列在JSON的identityDrift。闪购原列表要求是“下单最高+1000，浏览5秒”，历史run131落地实际是“浏览10秒得奖励”，当前列表是“下单，浏览5秒”并拆出普通浏览20和下单最高1000两条件；D计划已pending。不得用任务名消除要求差异。

**现有模块的边界。** dwell合同包含目的页归属、原要求和回执；IP是只识回执的特殊合同，不应按1秒配置值声称页面只需1秒。连续浏览先由真实落地组件唯一选20/50或25秒合同，再执行有界滑动；不是看见“浏览”就通用滑动。沉浸视频20秒只是观察预算，代码仍标50完成模板synthetic_only，不能拿离线合成图补真机成功。到访controller需要快速捕获toast、逛店controller需要双层回执；正常入口接线有离线证据，但目前配置目录没有填controllerCandidates的可执行候选。养小羊缺exact task+requirement配置。

**16类首学及历史结果。** 下表所有次数均是run218以前原result的状态计数，包含监督/恢复，不能读成当前稳定成功次数。completed/监督成功按原文保留；stopped/unknown不等于证明业务没有发生。相同attempt如IP133→134、店铺136→137→138、视频145→146只是一条执行/恢复链。旧状态报告没有覆盖所有后续旧run；本次还直接枚举原result，补入194、207–209等；逐run路径保存在JSON的historicalRecordedResultsBefore218。

| 任务 | 首学证据与实际净增 | run218前原状态次数 |
|---|---|---|
| 任务到访得金币 | run128，+10；`evidence/ocr-arrival-2026-11-01T00-05-01-247Z/result.json` | supervised_success=1 |
| 你关注的商品都可抵 | run129，+30；`evidence/ocr-browse-2026-11-01T00-08-18-455Z/result.json` | supervised_success=1 |
| 逛逛金币加抵好货 | run130，+30；`evidence/ocr-browse-2026-11-01T00-35-12-957Z/result.json` | supervised_success=1 |
| 来淘宝闪购分百亿补贴 | run131，+20；`evidence/ocr-browse-2026-11-01T00-53-49-661Z/result.json` | supervised_success=1 |
| 充话费0元起！ | run132，+20；`evidence/ocr-browse-2026-11-01T01-18-29-192Z/result.json` | supervised_success=1 |
| 天天签到免费拿IP周边 | run134，+10；`evidence/staged-reconcile-2026-11-01T02-18-43-435Z/result.json` | unknown=1；completed=1 |
| 逛好店赚一大波金币 | run138，+30；`evidence/shop-supervised-reconcile-2026-11-01T03-11-12-313Z/result.json` | unknown=1；stopped=1；completed=1 |
| 好物沉浸看 | run146，+20；`evidence/immersive-supervised-reconcile-2026-11-01T04-13-33-035Z/result.json` | unknown=1；completed=1；stopped=8 |
| 看看#精致面霜 | run153，+50；`evidence/continuous-supervised-2026-11-01T05-18-43-216Z/result.json` | unknown=3；stopped=1；completed=1 |
| 发现精选好物 | run157，+50；`evidence/staged-2026-11-01T07-17-55-917Z/result.json` | unknown=4；stopped=3；completed=2 |
| 去芭芭农场逛一逛 | run160，+30；`evidence/staged-2026-11-01T07-39-51-677Z/result.json` | completed=1 |
| 去省钱卡领红包 | run161，+30；`evidence/staged-2026-11-01T07-49-31-673Z/result.json` | completed=1 |
| 拍立淘逛感兴趣的宝贝 | run162，+20；`evidence/staged-2026-11-01T07-51-23-154Z/result.json` | completed=4；unknown=4 |
| 查看我的会员等级 | run164，+30；`evidence/staged-2026-11-01T07-53-12-088Z/result.json` | completed=1 |
| 看看你关注的新品动态 | run165，+20；`evidence/staged-2026-11-01T07-54-26-636Z/result.json` | completed=1 |
| 养小羊免费赚话费 | run168，+10；`evidence/staged-2026-11-01T07-57-48-797Z/result.json` | completed=1 |

**下一轮取证条件。** 当前可复用D候选应按新鲜全列表选实际task＋requirement；IP的已消费attempt先查结果归属和原图，未知不能重发。拍立淘0/5、精选好物1/3有可见余次，不因“今日跑过”永久屏蔽；到访/话费/金币加抵/IP及闪购各0/1，成功后第二次必须等下一日有真实额度。缺席的9类等下次完整盘点再看，不能强刷或用新名字替代。缺配置的到访/逛店/养小羊需补明确合同与入口后再验证。

本次仅新增派生清单与 `docs/probes/ai-assisted-coverage.json`，未修改生产脚本、配置、旧报告、账本或任何原证据；未连接设备、运行任务模型或调度。离线旧图AI探针 `evidence/ai-panel-reader-2026-11-02T00-02-07-964Z/report.json` 只证明读图能力，不是新任务session。机器清单含取证SHA、16类身份、配置映射、完整新会话证据与每类历史run路径；统计由Python核对。
