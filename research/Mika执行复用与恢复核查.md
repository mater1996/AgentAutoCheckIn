# Mika 执行复用与恢复核查

范围：只读 Mika 提交 `ebb0e44750d80aabb6b642c69908825d6b1a8107`，本地 HEAD 已核对一致；未安装依赖、构建、运行模型或连接手机。下列 GitHub 链接固定到该提交。checkin-platform 对照依据已有审计与最新实施记录，未重验其历史图像或收益。

## 结论

**“为什么可能快”有明确源码依据；“实际快多少、跨页面长期更稳”缺少本次可取得的对照运行结果。** Mika 将连续动作、动作后读屏、元素差量、按需图片和可中断回放放进通用执行层，能减少模型往返及输入。它也保留模型接管和错误退路，避免每个陌生页面都先补一份本地像素模板。但其路由适用范围很窄，学习成功口径也弱于真实业务回执/正收益验收，不能将两种“成功”直接比较。

## 1. Agent loop：一次模型调用能推进多少

- 常规循环每轮只取第一个工具调用，交统一 `ActionExecutor`；所以不是任意多工具并发。批量能力来自显式 `do_steps` 与复合工具。[AgentLoop:468](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt#L468)、[AgentLoop:580–600](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/AgentLoop.kt#L580)。
- `BatchRunner` 单批最多20步；逐步走同一执行入口，第二步起等界面稳定；可指定文字出现/消失、App 与稳定条件；失败、异常切页、输入不一致或新插话会停下交回。批内等待通过本地读屏，不额外询问模型。这是减少往返的实质机制，并非完全省掉观察。[BatchRunner:33–68](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/BatchRunner.kt#L33)。
- 动作结果可附当前界面差量，差量链失效或过长回全量；`adaptiveVision` 只在元素质量不足时附图。仍可能为归档截图，不能把“不发模型图片”说成“不截图”。[ScreenSession:260–318](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L260)。
- 核心 `SpeedFlags` 默认关闭，不代表 App 产品默认关闭。App 设置升级明确开启 inlineScreen、batchSteps、adaptiveVision 和 replay；lightSteps 不在这组默认开启项内。[FeatureFlags:130–138](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/settings/FeatureFlags.kt#L130)。大小模型分工是实验开关，轻量模型需支持工具；失败、守卫提示或画面不变后两步强制主模型。不能据此断言所有操作都由小模型低延迟执行。[ModelRouter:20–58](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/ModelRouter.kt#L20)。

## 2. 路由复用：模型选路，本地执行，随时交回

**不是确定性语义缓存，也不是随意改写任务都能命中。** `RouteMatcher` 先按字符二元组相似度或 App 获取最多5条候选，再调用一次模型选路并抽槽（超时20秒）。代码要求槽值在新原话恰好出现一次，填回模板后去空白必须等于新原话。普通同义改写可能无法复用；有候选但不适配还可能增加一次模型延迟。[RouteMatcher:23–86](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteMatcher.kt#L23)。

选定后 `Replayer` 内不调模型：每步重新读屏、核对包名和至少所需的少数文字锚点、按 role/resourceId/name 重新找当前目标，使用当前 ref/snapshotId。重复目标只在特定记录条件下按序号及位置邻近处理；并非直接回放旧坐标。[Replayer:59–118](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/Replayer.kt#L59)、[Replayer:147–159](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/Replayer.kt#L147)。

其动作后“到达”条件是 OR：changed=true、verification=match、某些有效打开动作，或出现任一记录的 after 文字即可；**不能将它理解成严格目的页或业务完成证明**。异常即停，记录该步是否真的执行，交主模型完整当前读屏及经过；走完也还需要模型回答。同一步连续失配两次停用路线。[RouteReplay:79–131](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/RouteReplay.kt#L79)。

记录路线要求事件有效且完整；追问、接管、确认、保护页、网页/沙箱等其他能力会排除。输入只能绑定本次原话片段，不能随便把抓取来的文字记成下次参数。[RouteRecorder:13–38](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/replay/RouteRecorder.kt#L13)。App 版本虽被保存，但 matcher/replayer 没有据此自动拒绝不同版本；不能称为“版本变化自动失效”。存储有进程共享锁、fsync 和原子替换，是写盘可靠性机制，不能代替路线正确性。[TaskRun:1113–1121](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L1113)、[FileRouteStore:60–87](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/replay/FileRouteStore.kt#L60)。

## 3. 学习：技能草稿与自动路线是两条路径

个人技能在 Ui 任务判定办成后起草，默认进入 pending，自动批准只用于显式评测钩子；使用个人技能或已发生匹配回放的运行避免重复起草。App 知识则也能从失败/磕绊运行提炼待确认修订。先通知结果，再后台学习，确实缩短用户等待交付的时间，但不一定减少整次运行总模型消耗。[RunLearning:85–156](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/RunLearning.kt#L85)、[RunLearning:188–193](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/RunLearning.kt#L188)。

试用技能办成一次即可转 active，失败或核查拒绝可暂停；正式技能最近3次有效结果中2次非 verified，或本次照做被核查拒绝时暂停。但 verified **包含没跑独立核查却被判办成** 的情形，属于产品内部状态。[SkillOutcomes:29–67](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/skills/SkillOutcomes.kt#L29)。

最重要的口径差异：`OutcomeJudge` 输入是用户要求、回答及少量前文，不读取完整动作/回执账本；`LearnGate` 接受 Succeeded+Done+没有未确认或 doubtful。产品 `TaskRun` 设置 reviewFinalAnswer=false。因此存在“回答被分类为已办成→形成路线/技能”的可能，不能将其学习门槛等同于我们要求的同 attempt 真回执、后续新帧和稳定正增量。[OutcomeJudge:40–71](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/OutcomeJudge.kt#L40)、[LearnGate:5–21](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/LearnGate.kt#L5)、[TaskRun:763](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/TaskRun.kt#L763)。

## 4. Read-script 与 prompt cache 的边界

`web_evaluate_js`/站点命令能一次提取当前网页多项数据，避免逐项视觉读取；结果入观察账本并标记不可信，站点命令按当前域名与声明参数检查。[ReadScriptTool:28–107](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/cap/web/ReadScriptTool.kt#L28)。这是网页能力，不能直接推出第三方手机 App 都能读取 DOM/API。

实现 `ReadScript.kt` 明确限制为已加载 DOM，只读包装，并阻断 fetch 等网络接口；工具文件中“同源 GET”注释滞后，应以协议实现为准。[ReadScript:18–37](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/cap/web/ReadScript.kt#L18)。

上下文采用相对稳定前缀和追加历史，压缩在副本进行，`ContextRecovery` 补回遗失的用户消息及固定规则。这有利于服务商 prompt cache；**并不保证每次命中，更不是模型结果缓存**。缓存比率需要服务商返回的 cached token 及真实请求记录。[architecture:257–264](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/docs/dev/architecture.md#L257)、[ContextRecovery:8–36](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/ContextRecovery.kt#L8)。

## 5. 故障恢复究竟恢复什么

| 层级 | 实际行为 | 不能推出的保证 |
|---|---|---|
| 模型瞬态错误 | 429、5xx、网络、流中断等最多重试3次，退避与任务等待预算；非瞬态拒绝不重试 | 不是工具动作失败后自动重复，不能证明未知派发可安全重做 |
| 回放或批操作偏离 | 停当前自动段，带进度及当前观察交模型 | 不保证模型下一步一定恢复到正确业务状态 |
| 运行进程中断 | 标中断、补送已知结果、处理投递不明和通知，明确从不从操作中途续跑 | 不具备通用持久断点续跑或业务事务回滚 |
| 系统改动善后 | 静音前存原值；恢复失败保留记录；加密留底剪贴板，避免覆盖用户后来换的内容；跳过 live 任务 | 不代表自动恢复订单/浏览任务本身 |

源码：[RetryPolicy:7–52](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/agent/RetryPolicy.kt#L7)、[RunRecovery:29–36](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/RunRecovery.kt#L29)、[TaskRecovery:83–115](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/TaskRecovery.kt#L83)、[TaskRecovery:139–217](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/task/TaskRecovery.kt#L139)。

## 6. 评测有框架，缺可比实测结果

程序枚举 `eval/tasks/**/*.json` 共128题：read 43、web 22、skills 20、write 11、memory 10、irreversible 9、impossible 8、barrier 5。题量不是执行量或通过量。

评测器经 TaskService 真路径逐题运行；有 tune/holdout 分池、技能训练/测试配对、读答案 grounding、写操作 marker 找回、false_success 与未核实错误分类、登录接管单列。指标覆盖总时长、首次反馈、模型调用、token/cache、模型/读屏/动作耗时，且支持 flags、网页/App 渠道消融。[eval README:20–29](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/eval/README.md#L20)、[eval README:49–65](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/eval/README.md#L49)、[Scoring:58–80](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/eval/Scoring.kt#L58)。

但文档明确结果拉到仓库外、不提交。本次仓库文件检索未取得 summary.md/scores.jsonl/metrics.json 真机结果，无法核实成功率、耗时分布、回放命中率和恢复率；不能给出“比我们快几倍”。评测默认关闭技能/记忆，且评测节奏缺省 FAST、产品缺省 STANDARD，后续对照必须控制这些条件。[eval README:83–95](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/eval/README.md#L83)、[architecture:152](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/docs/dev/architecture.md#L152)。README 演示标注4×播放，不是测得四倍提速。[README:24](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/README.md#L24)。

源码确有目标重复、无效果、失配交回、两次失配停用、回放走完仍需回答等假屏幕/假模型测试。这支持设计可测试性，本次未运行这些测试，也不将测试代码当真机可靠性成绩。[ReplayerTest:95](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/test/kotlin/com/wangzan101/mika/core/replay/ReplayerTest.kt#L95)、[AgentLoopReplayTest:69](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/test/kotlin/com/wangzan101/mika/core/agent/AgentLoopReplayTest.kt#L69)。

## 7. 对我们的启发与应保留的差异

既有[主线审计](/Users/mater/Project/checkin-platform/docs/审计-主线复用与结算归档.md:64)显示：旧主线每新帧完整 AI panel、首页/landing 另有像素门槛、导航无模型预算、单任务 session 与次数消费断开。**慢和脆可以来自“先付AI成本、再被不相关本地门槛拒绝”的组合，不能全部归咎于模型能力或缺少16类首学。** 本次未重算旧 usage，沿用该审计的原记录。

状态必须更新：最新[公共导航实施记录](/Users/mater/Project/checkin-platform/docs/公共导航与路由实施记录.md:19)已记载 current-text-v1、正常首页/landing 本地判断、同帧有界 AI 歧义补证及私有路由记录交付；已有专项与类型通过记录，文档所述全量仍在复核，且未真机。不能再把旧像素规则说成新配置唯一现状，也不能宣称公共第一步已 live 成功。

可借鉴的是：把当前观察、目标唯一性、逐步等待、动作效果和模型交回做成公共原语；对确定连续动作减少重复模型往返；归档和必要截图保留，但发模型的内容按阶段裁剪；用真实 usage 做消融。路由应记录“实际做过/效果未知/当前落点”，而非把计划或相似页面当成功。

应保留的是我们业务的更强完成合同：完整浏览要求、同 attempt 回执、不同后续新帧、稳定正收益、次数消费及未知派发不重放。Mika 的 changed/单锚点匹配和回答分类不能直接替代它们。下一轮若做对照，应使用同设备/模型/节奏/任务，分别比较冷启动、重复参数任务、页面漂移和中断场景，报告成功率与错误成功、往返数、耗时分布及成本；在拿到数据前，结论限定为“架构有减往返与容错依据，效果幅度尚未证实”。
