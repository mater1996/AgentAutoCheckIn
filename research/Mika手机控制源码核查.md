# Mika 手机控制：源码机制与边界

核查基线：`wangzan101/mika@ebb0e44750d80aabb6b642c69908825d6b1a8107`，本地 checkout 的 HEAD 已核对。只读源码，未安装、构建或运行 Mika、ADB、OCR、模型；以下耗时均为代码配置，**不是性能实测**。对照本项目当前 `runner/adb.ts`、`runner/staged/device.ts`，不推定所有执行路径都相同。

**结论：Mika 把读屏、画面采集、OCR 和大部分动作放在手机常驻进程内，减少逐步调用主机命令和传图的开销；它用节点刷新、有限重定位、事件与画面检查来降低误操作，但没有根本消除旧树、旧坐标或业务误判。** 我们的脆弱点也不等于“ADB 不可靠”：当前跨进程采集链路较长、OCR 只有文字与几何、观察与执行间存在时间差，业务状态仍需另外验证。

## 1. 手机内的控制链路为何可能更快

- **常驻 helper + Binder IPC。** 无线调试或 USB 首次以 shell 身份启动 `app_process` helper，之后进入 `Looper.loop()`，向 App 交付 `IMikaShell` Binder；不是每点一下都重新走主机 `adb shell input`。AIDL 接口提供建屏、启动 App、注入按键/触摸等方法。helper 能在 App 进程死亡后继续存在、清理状态并按策略重新交接；这不是设备重启后永续有效的保证。证据：[HelperProcess.kt L27–63](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/shell/HelperProcess.kt#L27-L63)、[L185–216](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/shell/HelperProcess.kt#L185-L216)、[IMikaShell.aidl L9–18](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/aidl/com/wangzan101/mika/shell/IMikaShell.aidl#L9-L18)、[HelperHub.kt L85–92](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/shell/HelperHub.kt#L85-L92)。
- **虚拟屏持续产帧，OCR 直接读内存位图。** `ImageReader` 接收虚拟屏 Surface，`acquireLatestImage()` 丢弃旧帧，处理间隔至少 100ms（≤10 帧/秒），预览宽≤360，另留原尺寸画面。OCR 复制原尺寸 Bitmap，避免 PNG 编解码及主机传输；显式截图仍会编码 PNG。这个 100ms 是处理节流参数，不能解读为截图一定在 100ms 内新鲜。证据：[AgentDisplay.kt L18–115](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/display/AgentDisplay.kt#L18-L115)。
- **节点动作优先，触摸逐级兜底。** 优先对节点或最近可点祖先 `ACTION_CLICK`，失败后做坐标手势，再由 helper 注入触摸；触摸路径还主动加入操作节奏延迟，不能声称所有动作都追求最短耗时。证据：[AndroidScreen.kt L1689–1706](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1689-L1706)。

## 2. 树 + OCR 是补充融合，不是让 OCR 变成可靠节点

`ScreenReader` 遍历无障碍窗口，输出层级树、可操作元素和定位特征；树已够用或受保护时跳过 OCR，其余按树质量给 OCR 2 秒或 5 秒预算。手机端中文、拉丁 ML Kit 识别器对同帧并行运行；过滤低置信度和噪声，按文字与位置剔除树中已有内容及双模型重复结果，再作为独立 `visibleText` 返回，坐标统一为 0–999。

**OCR 行没有节点引用，也不证明可点击。** 自绘按钮、图标、文字歧义仍需要模型/视觉定位与动作后检查；树的覆盖度判定若过于乐观，也可能跳过缺失内容的 OCR。

证据：[ScreenReader.kt L63–126](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/ScreenReader.kt#L63-L126)、[ScreenSession.kt L41–44](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L41-L44)、[L466–496](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/ScreenSession.kt#L466-L496)、[PhoneOcr.kt L20–76](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/PhoneOcr.kt#L20-L76)、[VisibleText.kt L9–72](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/VisibleText.kt#L9-L72)。

## 3. nodeId 如何失效，旧树解决到什么程度

这里的 `@e1` 等是**每次快照重新生成的引用**，不是 Android 永久 nodeId。引用必须配 `snapshotId`；默认只保留最近 4 次快照。最新引用先 `node.refresh()`，比较角色、名字、资源 ID、中心等定位特征；失败或引用来自旧快照，则重新读当前树、按特征找唯一对应项。重定位要求新旧唯一、上下文相符、移动不超过屏幕短边 15%；对整体静止页面的倒计时/输入提示语另有放宽。找不到或歧义时返回 `ref_expired`。

边界：

- 只解决“能识别出变化并重新找到”的情况。最新引用的快捷检查不比较上下文；列表复用后若角色、标签、资源 ID、中心等恰好相同，不能据此证明仍是同一业务条目。
- 读树前后哈希不同只标记 `changedDuringRead`，该层仍返回快照；不能把标记解释成原子一致性。
- 树先取、OCR 随后取；OCR 会检查识别期间是否大幅换页，但没有把树和图绑定成同一原子版本。检查与实际动作间也仍有竞态。
- OCR 的坐标点击不经过上述节点重定位。

证据：[NodeIds.kt L9–51](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/NodeIds.kt#L9-L51)、[AndroidScreen.kt L175–200](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L175-L200)、[L1585–1610](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1585-L1610)、[Accuracy.kt L10–91](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/core/src/main/kotlin/com/wangzan101/mika/core/uistate/Accuracy.kt#L10-L91)。

## 4. 动作后等待比固定 sleep 更细，但不是业务成功判定

动作前记录树哈希与画面亮度格子，并订阅事件；动作成功下发后：事件安静≥400ms 且树变化可返回；仅画面变化时还需相邻帧相近；最长检查 2500ms，超时按当时树/图差异判 `changed`。**当前实现无“稳定且未变化就提前返回 false”的分支，始终未变化会走到上限。** `changed=true` 可以来自无关变化，`false` 也不能证明动作未被业务处理，因此不能盲目重试。

OCR 前每 120ms 检查画面，最多等 1200ms；识别期间若至少 25% 亮度格子明显变化，最多重认一次。它容忍局部动画，也意味着小范围文字/按钮改变可能不触发重认；亮度抽样是启发式，不是逐像素或业务语义校验。

证据：[AndroidScreen.kt L1130–1142](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1130-L1142)、[ChangeWait.kt L18–53](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/ChangeWait.kt#L18-L53)、[StillFrameRead.kt L14–39](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/StillFrameRead.kt#L14-L39)、[FrameMath.kt L9–44](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/display/FrameMath.kt#L9-L44)。

## 5. 虚拟屏的作用和宣传边界

虚拟屏使 App 在另一块屏运行，减少用户主屏交互干扰，**不是修复 App 无障碍树的技术**。系统权限不允许可信屏时会退回不可信标志，并明确失去独立焦点的保障。App 启动到主屏、系统选择器、认证窗口等仍需迁回或用户接管；受保护页面不能因此绕过。

README 声称“什么 App 都能用”“不占你的屏幕”；同页也要求 Android 12+、推荐 14+，并说明安全页面需用户接管。演示 GIF 标注**加速 4 倍**，不能拿视频观感作为真实速度证据。本次没有同机同任务基准，不能给出“比我们快几倍”或全 App 成功率。

证据：[ShellService.kt L90–116](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/shell/ShellService.kt#L90-L116)、[AndroidScreen.kt L1492–1497](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/app/src/main/java/com/wangzan101/mika/cap/phone/a11y/AndroidScreen.kt#L1492-L1497)、[README.zh-CN.md L25](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/docs/readme/README.zh-CN.md#L25)、[L61–62](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/docs/readme/README.zh-CN.md#L61-L62)、[L127–145](https://github.com/wangzan101/mika/blob/ebb0e44750d80aabb6b642c69908825d6b1a8107/docs/readme/README.zh-CN.md#L127-L145)。

## 6. 对照我们：先改哪些地方

| 维度 | Mika 实现 | 我们已核查路径与含义 |
|---|---|---|
| 采集与传输 | 设备端 ImageReader 持续保留最新帧，OCR 直接用 Bitmap | `runner/staged/device.ts:243–299`：前台检查→`adb exec-out screencap -p`→PNG 落盘→再次检查前台→独立本机 OCR 进程→读 JSON；跨进程及传图开销更多，但未测各段耗时 |
| 元素操作 | 树节点点击优先，旧引用有受限重定位 | `runner/adb.ts:77–131`：dump XML、按文本/可点性/面积挑中心；`runner/staged/device.ts:315–329`：帧坐标点击。后者缺少节点语义和刷新能力，文字同名、布局变化仍可能误点 |
| 新鲜度防线 | 快照引用、refresh、重定位、图像稳定检查 | 我们**已经有**默认 5 秒帧时限、单次消费、动作前包名/用户检查（`runner/staged/device.ts:303–329`）；这些应保留。时限内也可换布局，前台相同不等于目标仍在 |
| 动作后判定 | 树哈希+事件+画面粗差异，返回 changed | `runner/staged/device.ts:310–361` 的一般 tap/swipe 路径在该层主要确认命令无报错，效果由上层承担；不能据此断言整个项目没有业务校验 |

建议顺序：

1. **先分段计时**：前台查询、截图、传输/落盘、OCR、决策、下发与效果确认分别记时，避免把模型慢、ADB 慢和业务等待混为一谈。
2. **优先完善动作后的观察契约**：事件与画面共同判断是否稳定，保留明确超时；另用业务后置条件判断完成，不把“画面变了”当领取成功。
3. **需要吞吐时做设备常驻服务试验**：提供带帧序号/时间的采集与 OCR，树和位图尽量同批交付，减少每步 PNG 跨设备传输；继续保留现有证据落盘、前台/用户检查、帧过期与消费约束。
4. **树可用才引入节点动作与保守重定位**：自绘页继续 OCR/视觉，列表必须加入业务行身份与歧义拒绝。虚拟屏用于隔离交互，可独立验证机型兼容性，不能替代新鲜度与业务成功校验。
