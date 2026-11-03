# Mika 对照调研与整改建议

## 结论

当前脆弱主要来自我们执行器的判定策略和复用方式，并非手机只能这样控制。把历史截图里的背景、商品、字形、绝对位置当作普通流程的硬条件，会把正常变化误判为陌生页面；多套检查器独立叠加又让局部修复难以推进主线。与此同时，面板每新帧完整询问 AI 带来明显耗时。Mika 的可借鉴之处是端上常驻控制、当前元素重新定位、动作后轻量检查、批执行和路线偏离后交回 Agent。不能据演示断言其在本机淘宝一定更快或稳定。

本轮只读源码及既有证据，未安装 Mika、未操作手机、未调用其模型、未改业务代码或配置、未写账本及调度。修改现有实施记录仅核实最终回归结果。

## 调研范围与版本

- 仓库：https://github.com/wangzan101/mika
- 源码 commit：`ebb0e44750d80aabb6b642c69908825d6b1a8107`，提交说明“版本 0.1.33”。本轮 git 读取，不以网页默认分支变化作为固定证据。
- 临时只读副本：`/Users/mater/.hermes/cache/scratch/mika-reference`。该目录会清理；下列 GitHub commit 链接长期作为来源。
- 按 github、tool-landscape-survey、android-device-automation 技能核对已有产品、源码和本机实测边界；未执行外部仓库内的安装指令。

## Mika 为什么有条件减少耗时

| 机制 | 源码实际行为 | 对我们意味着什么 |
|---|---|---|
| 手机端常驻助手 | `ShellService` 以 shell uid 2000 常驻，通过 Binder 接口操作；反射失败时部分能力回退 shell | 减少逐步从电脑启动 shell、读取整份 dump 的需要；不是已经测出的加速倍数 |
| 控件树与端上 OCR | 当前无障碍窗口构建结构；树足够时不额外 OCR，否则补本帧可见文字；ML Kit 中英文两模型端上并行 | 有结构就用结构，缺失部分再补读，避免每页完整视觉调用；不能把树“足够”当作滚动后绝对新鲜的证明 |
| 元素引用与重新定位 | ref 绑定 snapshot；最新节点先 refresh 检查类型/文字/id/位置，失效则按当前页面唯一目标重新定位 | 保存“找哪个控件”，而非把历史坐标当长期权威 |
| 动作后检查 | 等待界面事件/树/当前画面变化，并返回结果及当前视图 | 可以减少重复发起观察；画面发生变化不等于业务目标已经达成 |
| `phone_run` 批操作 | 一次交一组命令，每步重新找目标，通过统一动作入口；失败、切App、图像需复核等停止 | 减少每次点击之间的模型往返；批量并不等于不检查 |
| 成功路线回放 | 保存目标选择器、动作前后锚点；回放各步不调模型，偏离即交回模型 | 复用已成功步骤，不强求全页面等于历史图片；路线选择本身仍可能调用一次模型 |
| 按需图像 | 自适应模式下树不够用才附图；也有直接视觉模式 | 快慢与实际模式/树覆盖/模型响应有关，不能说 Mika 总是零图像零推理 |

固定源码：

1. [ShellService.kt 50–61：常驻 shell/Binder](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/shell/ShellService.kt#L50-L61)
2. [ScreenSession.kt 465–496：树质量与条件 OCR](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L465-L496)
3. [PhoneOcr.kt 20–76：端上并行 OCR](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/PhoneOcr.kt#L20-L76)
4. [AndroidScreen.kt 1585–1610：ref 刷新和重新定位](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1585-L1610)
5. [AndroidScreen.kt 1126–1142：动作效果检查](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1126-L1142)
6. [PhoneRun.kt 26–153：本地批操作及停止](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/cap/phone/PhoneRun.kt#L26-L153)
7. [Replayer.kt 39–118：逐步重定位、检查、偏离交还](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/Replayer.kt#L39-L118)
8. [RouteMatcher.kt 23–50：有候选时一次模型选路线](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteMatcher.kt#L23-L50)
9. [ScreenSession.kt 158–199：按模式附图](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L158-L199)

## 我们为什么还脆弱

### 把历史来源校验与当前画面匹配混在了一起

保存原图及 hash 能说明“这个脚本从哪里学来”，有必要。要求现在的商品、促销、背景和历史图像相同，则是另一项策略，不能提升为普通等待/滑动的必需条件。

run223 首页原文字和目标位置通过，但搜索栏两条装饰区域不匹配就停止。9份停留合同仍保留旧像素路径，连续浏览还核验商品内容/价格徽标等，视频保留部分促销及图标 gate。IP 虽已迁移文字识别，仍有部分历史几何依赖。第一批新导航只解决公共导航，未解决任务内所有路径。

证据：[首页失败诊断](../docs/run223首页导航停止.md)、[页面检查审计](../docs/审计-页面识别与执行检查.md)。

### 多套检查器各管一段，没有统一接力

一个页面在观察时认出来，派发或审计还可能用旧规则拒绝。公共导航这次已把 runtime→派发→audit 用同一 policy 接通；多数任务内规则尚未完成同类迁移。临时增加参考图只会继续增加维护面。

### 模型用在了重复观察，不只用在真实歧义

run218 真实完成“发现精选好物”，2265→2315，+50。但整个 session 约160.637秒，14次模型调用、109391 tokens，模型累计107.971秒，约占67.2%，平均每次约7.71秒。比例由已有记录数值计算；不是本轮新真机结果，也不代表下一轮必然相同。模型累计时长不能等同于可全部消除的耗时。

旧路径在首页/入口也读完整面板。新导航已去掉明确 home/landing 的完整 AI panel 请求，但任务列表、重新选择、返回、结算等阶段仍有完整面板读取。尚无新 live 数据证明已降低多少。

依据：[run218 原结果](../evidence/staged-2026-11-02T00-09-04-370Z/result.json)、[成本与接线审计](../docs/审计-主线复用与结算归档.md)、[新导航接线](../docs/公共导航接线实现.md)。当前 `device.ts:243–299` 每帧仍走前台读取→截图传输→前台读取→本机OCR及证据持久化；点击前还有前台检查。它们提供证据及账号边界，但与端上常驻方案有不同成本，需实测再决定优化。

### 有首学记录，但不等于完整可执行脚本

IP 旧版只有完成态，没有“浏览中等待→重新读→核完成”的步骤。连续业务计划也还存在 maxTasks=1、按名字屏蔽当天成功任务、计划次数未消费等问题。它们与识图能力是不同缺口，换一个点击驱动不会自动补齐。

这些是当前实现缺陷与维护策略问题，不能笼统归结为淘宝太复杂。回执、账号隔离和真实到账检查应保留；商品/背景必须像历史图并非这些边界的必要条件。

## Mika 也有哪些未证实或较弱的地方

- [README 演示明确写4倍速](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/README.md#L22-L24)。不能拿动图时间作为耗时基准。
- [eval/README.md](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/eval/README.md) 是评测方法/脚本说明。本轮副本没有 eval/results 目录；未找到可据此确认本机淘宝端到端成功率与性能的运行记录。
- 树质量判断是控件数量、命名比例、盲区、OCR补缺等启发式；足够丰富但已陈旧的子树仍可能被判断够用。refresh 和重新定位降低风险，不证明我们此前“画面滑了、树仍旧”的问题已解决。
- 有当前帧比较，但其 `StillFrameRead` 是检查前后画面是否停稳/是否换整页，**不是要求与历史商品图片一样**。不能把它简单说成“完全不做图片比较”。
- `Replayer` 动作后的放行可以来自 changed、输入回读、启动成功或新锚点之一；这比资产结算要求弱。点击生效、路线走完不能代替同 attempt 回执及资产余额正增量。
- 虚拟屏能隔离手机使用，但 ROM、App、多显示支持需要真机确认；它不提供淘宝私有业务接口，也不保证可直接读内部路由。
- 路线自动提取有严格适用边界，包含用户接管/确认/付款/某些其他通道的运行不记路线；不是所有任务成功一次都能自动零模型复跑。见 [RouteRecorder.kt](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteRecorder.kt#L13-L38)。

## 借鉴到现有流程的具体方案

用户明确本次目的：参考 Mika 改善现有流程。此前建议优先安装/试用 Mika 偏离该目的，撤回。保留现有 TS／SQLite、单一动作派发及业务执行主线，以下为待确认实施方案；本轮仅改文档。

| 借鉴机制 | 之前是什么 | 建议改成什么 | 实施位置与当前状态 |
|---|---|---|---|
| 保存目标与前后条件，执行时重新定位 | 多数任务除了识别业务文字，还要求商品、装饰、历史绝对位置匹配 | 脚本保存页面身份、实际要求、目标所属组件与唯一性、动作、完成条件；在当前帧重新定位。历史图保留为学习与回归来源 | activity-navigation公共导航已离线实现、未live；后续统一dwell/continuous/immersive/controller及dispatch/audit的对应判据，覆盖多个任务，不按名称新增分支 |
| 一个新观察供各阶段消费，按目的读数据 | 收集、选择、入口、返回、结算各阶段多次新拍并读取整张任务表 | 完整收集时逐屏一次AI读取；同一有效观察的任务/余额/结构供选择复用。派发前需要新采样时，只重新绑定选中行和目标；结算新帧重点读资产区及必要任务状态 | runtime/ai-panel-reader/observations。缓存已有同frame promise，但仍有跨阶段新帧重复调用，需要编排层处理；不跨滚动借旧坐标。AI面板主读保持，局部AI schema/独立audit需明确接线后验收 |
| 脚本连续推进，偏离才交回AI | 一个熟悉步骤仍可能被重复完整询问模型；unknown之后通常整阶段停止 | 已知条件满足即走已学步骤。遇真实歧义，把当前原图、选中任务、最近动作、未决效果和预算交AI，取得一个允许动作；新观察达到已知检查点便还给脚本 | runtime/engine/既有task recovery可复用，但当前开关false。需统一适用范围和检查条件后再启用；漏等待/滑动等已知缺步骤仍补脚本，不用AI掩盖。新策略/业务问题按用户要求报决策，不自行扩权 |
| 动作后返回观察并确认效果 | 动作层主要确认命令下发；上层在多个阶段另行采样判断 | 在既有dispatcher→observer链上形成同一个“动作→新观察→实际落点”结果；下一阶段复用仍有效的结果。有界等待按实际变化推进，未决派发不重发 | device/runtime/engine/navigation-records；先复用现有capture，不先新建手机服务。画面变化只说明可能生效，仍需目标页业务条件，不能拿changed代替完成 |
| 结构化过程自动归档与复用 | 首学成功记录和可执行步骤/当前适用条件未完全连接，仍有receiptOnly漏流程 | 归档完整浏览中→等待或连续滑动→复查→回执→返回过程，以及适用条件、例外、超时；下一次只在这些条件相符时复用，失败记录用于具体修订 | dwell/continuous/experience与archive，已有流程优先复用；不让16类全部重新人工首学。共享脚本与账号运行证据分开 |

### 拿一个已学普通浏览任务说明建议流程

以下是优化后的目标流程，不代表已全部实现或真机验通。

1. AI完整收集当前任务，保存任务要求、次数、奖励条件和做/跳过决策；随后由本地匹配已有完整过程。收集结果直接交选择阶段，不为“换了阶段”再完整读一遍。
2. 点击前从当前新帧重绑选中任务行的唯一入口，确认账号与允许范围；入口不确定时只补这部分读取。滚动后的旧坐标失效。
3. 进入任务后确认当前独立浏览要求与所选过程相符，用公共业务组件识别浏览中/完成态；动态商品和装饰不决定能否执行。按真实要求等待或连续滑动，已知段不再每步问AI。
4. 真实歧义才让AI根据当前上下文判断一个下一动作；确认已知检查点即交回脚本。若要求变为未授权业务或出现新策略问题则停止报告。
5. 保存本次真实回执，按当前落点返回。返回得到的有效观察供后续阶段使用；结算仍需资产所属页面上两个不同新帧、稳定正增量。
6. 幂等记账、归档本次使用的过程版本和原始证据，按真实剩余额度更新计划。当前单项完成报告/暂停边界继续有效；次数规划与跨任务执行权限分别处理，不能靠修改maxTasks暗中扩大范围。

### 推进顺序与验收

1. 先完成已批准公共导航的正常入口真机验收，记录实际到达、模型调用及耗时。离线全量通过不代替本步。
2. 作为下一批方案，统一任务内当前业务组件识别及其派发/审计判据；同时消除因阶段切换而重复完整读表的调用。以一个已学任务从收集到结算的完整链验收，再用其他真实任务页检验组件复用；不为每项重新写模板或重新人工首学。
3. 用既有AI恢复接口完成检查点交接，明确哪些歧义可自行补证、哪些新问题必须报告；验证接管后确实能回到脚本，而非全程交AI。
4. 接通按当前额度消费计划次数及状态归档，避免按名字“一次成功全天屏蔽”。单项回执、结算和用户逐步执行边界保持。
5. 分段统计前台查询、截图、OCR、模型、动作、任务必需等待和归档耗时。只有实测显示设备采集是主要剩余瓶颈，才另评估端上常驻采集。当前不先开发Android服务或虚拟屏。

验收同时报告主线实际完成/未完成、装饰变化误拒、未知派发与错误完成、真实收益及模型/总耗时。耗时可与run218等历史基线比较，但任务与页面差异要明确，不能许诺固定倍数。此方案保留AI作为已批准的面板主读，仅缩小重复查询和按阶段所需字段；不是借降耗切回OCR主读。


## 本轮验证状态

公共导航串行全量已实际结束：1933 total，1927 pass，0 fail，6 TODO，exit0；日志 `/Users/mater/.hermes/cache/scratch/current-navigation-parent-full-serial.log`。这仅说明离线回归通过，未做新真机 run，无新增收益，不称已上线/稳定。

独立核查已落盘并由父读取：[手机控制源码](Mika手机控制源码核查.md)、[执行复用与恢复](Mika执行复用与恢复核查.md)。父另读 TaskRun、OutcomeJudge、RunRecovery 核对以下边界：

- 当前产品 TaskRun 明确 `reviewFinalAnswer=false`；后台 OutcomeJudge 主要以要求与回答分类结局，不输入完整动作及资产回执账本。它的学习成功口径不能替代本项目的同 attempt 回执和真实到账。参见 [OutcomeJudge 49–62](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/OutcomeJudge.kt#L49-L62)。这不等于其动作层完全没有检查。
- 进程中断恢复明确“从不从中间续跑”，主要善后与补投结果；不要把运行中路线偏离后交回模型说成持久断点恢复。参见 [RunRecovery 29–36](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/RunRecovery.kt#L29-L36)。
- 设备核查确认虚拟屏持续帧与本地 Bitmap OCR 的实现，但节点刷新和图像稳定检查仍非原子快照，旧树与列表复用风险存在。本轮不因两个报告完成而新增安装、真机或迁移授权。

