# Portal旧任务子树：最小诊断方案

状态：方案已确认，离线实现与构建已完成，尚未安装或操作手机；[构建与831项测试记录](../evidence/portal-diagnostic-build/status.md)。下文保留原设计及其当时状态描述，实际实现/验证状态以上述记录为准。目的为定位，不承诺修复。继续沿用现有TS/SQLite平台，不接业务执行或调度。

## 之前与拟议变化

之前：state_full重新遍历节点，但getChild可能拿到Android缓存；HTTP超时后仍可能返回旧JSON。正常标记、缓存年龄变化都不能证明任务视口正确。

拟议：增加仅调试构建可用的“单次诊断读取”，明确本次用了哪种缓存策略、哪些节点真的刷新成功、哪个窗口被读取。超时和不完整直接报错，禁止返回旧树。先静止对照，再单独验证滚动。

当前证据边界：3轮采集均未完成；重连后任务子树缺失。Pixi屏外按钮重连前就存在，不能作为修复入口。清缓存对照面对的是当前缺失现场；若旧树现场未能复现，不能把缺失恢复说成滚动旧树问题已解决。

## 已核实的接口

- Android 15公开API有AccessibilityService.clearCache()和clearCachedSubtree(node)。前者清当前服务连接的Android无障碍缓存，不是清淘宝数据、网页缓存或Portal序列化JSON缓存；返回true只证明缓存对象存在并执行了clear。[1][6]
- AccessibilityNodeInfo.refresh()通过bypassCache=true重新请求当前节点。它不是递归刷新；只刷新root不足以保证后代新鲜。false表示本次未能取得节点，不能沿用旧字段冒充刷新成功。[2]
- Portal A11yReadGate超时不取消后台读取，同key可能复用Future，迟到结果会更新JSON缓存。因此新诊断接口不能简单套用原wrap()，也不能边清Android缓存边让已有读取继续填充它。[3]
- Portal树构建在递归里getChild()，未在此链路逐节点refresh；诊断refresh必须先于读取该节点的bounds、childCount等字段。[4]

## 三种读取模式

| 模式 | 改变什么 | 可检验的问题 |
| --- | --- | --- |
| baseline | 沿用正常节点获取，但从头构建；禁止JSON兜底 | 当前节点树到底暴露什么 |
| clear_android_cache | 清服务连接缓存，再重新获取根和完整遍历 | 清客户端节点缓存是否恢复任务/视口 |
| refresh_each_node | 重新获取根，每个节点先refresh，再读字段和子节点 | 绕过缓存逐节点请求，页面提供的内容是否仍旧/缺失 |

按baseline→clear_android_cache先做一组，报告暂停。只有第一组无解释力且用户继续，才开展refresh_each_node。逐节点刷新可能大量Binder请求，不默认给700多个节点全量执行；先限定当前目标应用窗口，并硬限制节点数、深度、时间，触及上限标记incomplete，不作为可用清单。

三模式是顺序干预实验，不是假装彼此独立。clear会改变后续baseline，refresh也会更新缓存；记录顺序与时间。需要复现第二组时，重新建立并独立核验现场，不拿旧树top标记当复位依据。

## 最小代码改动范围（尚未实施）

1. 新增DiagnosticReadCoordinator，所有节点读取入口共用读锁/诊断租约：HTTP、WS、provider、周期读取和事件处理中的节点读取必须纳入。只对新入口加锁没有隔离作用。事件元数据写入不需做节点遍历。
2. 诊断开始先阻止新节点读取，再限时等已在途读取结束。未结束返回busy，不清缓存、不并发再开读取。不通过清inflight map或Future.cancel假装Binder已退出。
3. debug-only、现有认证保护的本地POST /diagnostics/a11y/read，显式mode、package、filter=false、requestId。单请求、单遍历，不接受任意节点动作或执行脚本。不对正式执行器自动切换策略。
4. 在StateRepository/RootResolver增加诊断包装，保存全部窗口描述和实际入选根，保持原选择顺序。若尝试其他窗口，只作为独立标记的补充结果，不悄悄替换baseline。
5. AccessibilityTreeBuilder增加可选诊断策略；正式调用默认行为不变。refresh必须在取bounds、生成key和枚举childCount前执行。失败保留元数据而不输出旧节点为成功；继续其他分支时整体结果仍incomplete，不能用于任务定位。
6. onAccessibilityEvent增加受控环形记录：只复制event自带元数据，回调里不调用event.source。保留事件类型、eventTime/接收uptime、package、class、windowId、contentChangeTypes、scrollX/Y/maxScrollX/Y、from/toIndex/itemCount。容量1000条，记录覆盖/丢弃数。source节点的读取会改变缓存并影响对照，首版不做。

HTTP等待预算拟10秒，整次遍历协作预算8秒，节点上限1200、最大深度沿用原限制；均为拟定诊断预算而非性能承诺。Binder单次调用可能越过协作预算：HTTP超时后保留运行中状态和独占租约，禁止下一次动作/诊断，待worker真实退出后才能释放；若持续不退出则报告blocked并暂停，不不断增开线程。

应用锁无法控制Android框架在事件处理过程中的缓存变更。事件仍需照常送达；因此结果是记录事件背景下的受控对照，不声称冻结Android所有缓存操作。

## 输出与验收标准

每个请求输出：requestId、mode、server/sessionId、开始结束uptime、是否重用任务（诊断必须false）、cacheClear返回、窗口id/type/layer/active/focused/选中原因、root数量、visited/emitted/nullChild/refreshOk/refreshFailed/exception计数、完整性、timeout/blocked、事件序号范围，以及完整原树。

节点本次路径只是本次树内位置，不跨请求充当稳定身份。跨帧对照按任务完整文字、要求、quota、bounds和祖先结构做，并保留歧义；不从名称猜任务类型。事件无可靠源节点id时明确unknown，不用窗口id冒充任务子树id。

每次读取前后各保存截图，截图只作对照证据；请求本身不允许输入动作。对列表当前可见任务的名称/配额/坐标与截图逐项核对。HTTP成功、节点变多、全树hash变化、两次signature相同，均不能单独算恢复。

静止阶段：当前任务面板保持不动，baseline最多2读；clear一次后最多2读。无目标前台、遮挡、登录验证、窗口变化或屏幕熄灭就停止。若任务子树仍缺失，不用滚动来“修复”，先报告。

后续滚动阶段需单独“继续”：从独立确认的任务视口出发，仅一次Portal列表滚动，核对截图确实移动后，对比baseline和clear。仅task名称/bounds随实际视口正确更新，才支持清缓存能缓解旧树；禁止点击任务、领奖或编计划。

## 结果怎么解释

| 观测 | 支持的判断 | 仍不能声称 |
| --- | --- | --- |
| 清缓存后恢复，且重复对照一致 | Android节点缓存参与问题 | 已定位具体缺失事件/淘宝无责 |
| 清缓存无效，逐节点refresh恢复 | 节点重取方式影响结果 | 仅root刷新足够/永久修复 |
| refresh成功但仍旧或缺失 | 服务重取仍未拿到所需内容 | 单凭此已证明淘宝Bug；仍需核对窗口/节点选择 |
| refresh失败或超时 | 本次获取不完整 | 页面确实没有任务 |
| 无scroll/content事件 | 本次日志未收到相应事件 | Android框架完全未处理；环形覆盖与日志启用时机需核对 |
| 有事件但任务仍旧 | 收到事件不足以保证任务更新 | 可由windowId确定事件源属于任务列表 |

## 构建、安装与回退

已只读核对：固定Portal源码SHA a4f7f4164db2507e66dcd85b71f99d27e93047f8，compileSdk/targetSdk=34、minSdk=26；release签名来自项目外keystore配置。[5]

本机当前检查：/usr/bin/java -version报告找不到Java Runtime；未配置JAVA_HOME/ANDROID_HOME/ANDROID_SDK_ROOT；标准Android SDK目录和Android Studio JBR不存在，PATH无gradle/apksigner/aapt2。不能把“写好了Kotlin”当构建通过。实施时先准备JDK和SDK并用仓库Gradle wrapper构建，保存依赖版本与构建输出。

签名策略：不假设拥有官方签名，不直接覆盖安装官方包，更不卸载官方Portal清数据。优先并行安装独立包名的诊断构建；同时修改并检查provider authorities、所有硬编码包名/content URI、服务组件和更新入口，诊断构建关闭自动更新。不仅加applicationIdSuffix就宣称隔离完毕。

独立包名的服务连接是新连接，安装/切服务本身可能改变现场，不能与安装前树直接声称单变量比较。必须在诊断服务内重新取得baseline并复现问题，再进行各模式对照。实验时只让一个Portal服务运行，保留其他无障碍服务原值；HyperOS已拒绝ADB secure写入，预计切服务仍需用户手动操作，不尝试绕过。

回退：停止诊断server/forward，关闭诊断无障碍服务，恢复原Portal服务，读回设置与实际绑定；原APK和数据保留。不会在未确认情况下卸载诊断应用或其他应用。

## 实施前可审查的检查项

离线验证需要覆盖：默认模式不变、clear发生在root获取前、refresh发生在字段读取前、失败不复用旧字段、超时不返回旧JSON、不与既有后台读并发、迟到结果不覆盖其他请求、节点回收、事件缓冲有界且无source读取、debug路由鉴权/发布版关闭、诊断包authority隔离。

这些是拟实施验收项，目前未编写或运行测试。该方案已完成源码/公开API核对；尚未验证编译、安装可行性和真机效果。实施应先离线构建与验证，报告暂停，再由用户继续授权安装/切服务与真机实验。

## Sources

[1] https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-15.0.0_r1/core/java/android/accessibilityservice/AccessibilityService.java
[2] https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-15.0.0_r1/core/java/android/view/accessibility/AccessibilityNodeInfo.java
[3] https://raw.githubusercontent.com/droidrun/mobilerun-portal/a4f7f4164db2507e66dcd85b71f99d27e93047f8/app/src/main/java/com/mobilerun/portal/api/A11yReadGate.kt
[4] https://raw.githubusercontent.com/droidrun/mobilerun-portal/a4f7f4164db2507e66dcd85b71f99d27e93047f8/app/src/main/java/com/mobilerun/portal/core/AccessibilityTreeBuilder.kt
[5] https://raw.githubusercontent.com/droidrun/mobilerun-portal/a4f7f4164db2507e66dcd85b71f99d27e93047f8/app/build.gradle.kts
[6] https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-15.0.0_r1/core/api/current.txt
