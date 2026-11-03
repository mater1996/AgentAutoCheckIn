# Portal层级辅助与Mac投屏：执行方案补充

日期：2026-10-31。状态：官方文档/源码核查，未安装Portal、Mobilerun或scrcpy，未操作手机，未完成真机可靠性对照。本轮PATH中未发现scrcpy/mobilerun/droidrun命令；不能据此断言系统任何目录均无相关文件。

## 决策

**将Portal真实页面覆盖与输入通道对照提前到OCR基准之前。**保留资产账本与有前后条件的流程设计；先利用现成的结构化状态和不同输入方式，再决定有多少区域必须补OCR。此前已提控件树，但仅用一次稀疏dump就偏重截图/OCR，没有充分验证服务式无障碍读取与输入通道，顺序应纠正。

建议顺序：

1. Portal节点树、焦点/键盘/前台状态＋截图交叉确认。
2. Portal手势与当前ADB shell tap对照同一入口。
3. 若仍不可靠，再用scrcpy默认输入/硬件模拟鼠标做有界对照。
4. 实测仍缺的文字/图形区域才引入OCR/视觉；回到正常入口全闭环验收。

不是默认整体迁移到另一个Agent。可以只使用Portal本地服务或mobilerun_core现成设备API，让本agent读取状态和执行受限动作。任务选择、前提/后验、预算、收益验收仍由现有业务平台维护。

## 1. Portal可提供什么

官方Portal是Android AccessibilityService，可输出交互元素编号、可点击/编辑/滚动/聚焦状态；完整树还有resourceId、className、text/content description、屏幕bounds、焦点及动作列表。phone_state返回当前App、焦点元素、键盘显示；state_full整合树与设备上下文。[1]

通过本地HTTP、WebSocket或ADB ContentProvider读取，不要求先购买云手机或启用云Agent；HTTP/WebSocket使用本地token。Portal需要手机安装APK并启用无障碍服务，官方设置还包括悬浮层权限。[1][2]

可以先仅查询：`a11y_tree_full?filter=false`、`phone_state`、`state_full?filter=false`。对比与同时间截图的文字/按钮/输入焦点，而不是拿节点总数当唯一质量标准。简化树与完整树分开保存，避免过滤把重要控件去掉。原始token不写进报告或模型上下文。

Portal仍依赖应用暴露的无障碍节点，不能自动创造Canvas/图片里的语义；底层同属Android可访问能力，不保证比UIAutomator2在每页都完整。每个页面状态分别实测。

## 2. 点击通道：确实有可测试的不同

当前我们使用ADB shell input tap。Portal本地API也能tap(x,y)，源码GestureController调用无障碍服务的dispatchGesture，属于另一条输入路径，值得对照。[2][5]

**节点树不等于所有点击均为原生节点ACTION_CLICK。**本轮核查的Portal本地tap接口仍是坐标；可用新鲜节点bounds定位，再通过Portal手势点击。返回dispatched=true只证明系统接受派发，不能证明按钮生效，更不能证明任务完成。[2][5]

节点编号只在当前观察里使用；页面变化后重新取树。即使完整树列出CLICK动作，也不能未经确认就宣称本地API已提供任意节点原生点击。

## 3. 投屏到Mac可行，但需要区分模式

| 方式 | 手机端实际输入 | 对当前问题的意义 |
| --- | --- | --- |
| ADB shell input tap | Android shell输入注入 | 当前失败样本，尚未确定根因 |
| Portal tap | AccessibilityService.dispatchGesture | 值得先试的独立路径；不需要桌面像素坐标转换 |
| scrcpy默认mouse=sdk | Android API层绝对坐标注入 | 不等同shell命令实现，但仍是API注入；换到Mac窗口不保证绕开输入问题 |
| scrcpy mouse=uhid | 手机UHID内核模块模拟实体鼠标 | 输入机制明显不同，可做硬件鼠标路径对照；实际设备支持待测 |
| scrcpy mouse=aoa | USB AOAv2模拟实体鼠标 | 仅USB，控制本身不依赖ADB；投屏仍需要另一传输路径，兼容性待测 |

scrcpy官方明确这些模式及差异；UHID/AOA会捕获鼠标，用相对移动控制手机上的指针，因此不能默认Mac窗口某绝对点一次click就等价于手机该点。[3]

Mac computer_use可以尝试操作投屏窗口；它读取的是Mac窗口的可访问树和图像。普通投屏窗口承载视频，不能假定它把淘宝按钮自动导出为Mac AX元素。截图仍需坐标映射、考虑缩放/留黑/窗口边框、焦点和画面延迟。这是技术推断，尚未在本机窗口实测。

因此，投屏优先用于人工观察和输入通道对照；如果最终证明UHID路径可靠，可以再接入控制，但不先把所有日常操作搬到Mac GUI。可将Portal提供的语义信息与另一条可靠输入路径组合，两者无需互斥。

## 4. 可直接给本agent用的现成接入

官方mobile-harness不是另一个Agent运行时，而是Markdown操作说明＋mobilerun_core Python设备API，适用于能读Markdown并执行Python的Agent。支持local-android-adb及Portal HTTP路径，避免为了本地节点查询启用另一整套规划Agent。其Python要求3.11/3.12/3.13；若使用SDK须建符合要求的隔离环境，不能拿Hermes当前解释器版本假定兼容。[4]

如果只做首轮读取，可直接使用Portal现成本地接口，不必先安装整个框架。之后若SDK能减少协议接线则优先复用。当前未安装，故“可接入”不是“已可直接调用”。

## 5. 下一次有界实验

用户当前要求逐步执行、每步汇报后暂停；此调研不自动恢复手机操作。

- 第一步仅安装/准备Portal，必要无障碍/悬浮权限明确处理，不擅自清空已有无障碍服务，也不开短信、云连接、自动安装或常驻调度。
- 然后只读当前淘宝首页：保存简化树、完整树、phone_state和同期截图；报告领淘金币是否有可靠节点、bounds与可点击父节点，坐标空间是否一致。读完暂停。
- 再对同一入口单次Portal点击，读取返回和页面实际变化。若成功，停止重复点击，不消费任务配额。若失败，保留派发结果，不等同ADB完全失效。
- 仍有必要时单独比较scrcpy SDK、UHID或AOA；每次只换一个变量，用户可观察。先确认窗口输入方式，再评估computer_use兼容性。
- 单个入口成功不等于完整签到成功。后续仍须正常主线自行收集、计划、执行、验收、记账与更新，不启用调度。

初期验收回答三件事：结构化信息是否真的覆盖目标、哪种输入通道能稳定产生预期页面变化、剩余哪些内容需要图像/OCR。当前没有可靠成功率、延迟和成本结果。

## 6. 维护与成本核查

GitHub API本轮直取：mobilerun 9883 stars、pushed_at=2026-10-28T20:57:49Z、未archived、MIT；portal 401 stars、pushed_at=2026-10-29T14:47:43Z、未archived，API许可显示NOASSERTION，但实际LICENSE原文为AGPL-3.0-or-later。元数据不代表当前设备兼容性，原文保留在本报告证据目录。

本地读取和操作不需要逐次支付云Agent费用；这不能等于总成本零，仍有安装、权限、设备运行与维护。若自行接入模型，原有模型通道与用量另计，不以云服务赠额作为成本前提。

## 证据

`research/evidence/Portal与投屏-2026-10-31/` 保存官方README、本地API、输入源码、scrcpy文档、维护元数据和许可原文；本文为方案补充，无真机比较结论。

## Sources

[1] https://raw.githubusercontent.com/droidrun/mobilerun-portal/main/README.md — Mobilerun Portal
[2] https://raw.githubusercontent.com/droidrun/mobilerun-portal/main/docs/local-api.md — Portal Local API
[3] https://raw.githubusercontent.com/Genymobile/scrcpy/master/doc/mouse.md — scrcpy Mouse
[4] https://docs.mobilerun.ai/skills/mobile-harness.md — Mobile Harness
[5] https://raw.githubusercontent.com/droidrun/mobilerun-portal/main/app/src/main/java/com/mobilerun/portal/service/GestureController.kt — Portal GestureController
