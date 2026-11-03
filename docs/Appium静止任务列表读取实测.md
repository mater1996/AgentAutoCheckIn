# Appium静止任务列表读取实测

结论：Appium现成resetAccessibilityCache接口已在本机成功调用，3次静止读取均取得当前任务列表首屏8条，文字/配额/位置与事后截图相符。尚未测试滚动刷新，不声称解决原滚动旧子树问题。

版本：Appium3.9.0，UiAutomator2 driver8.7.3，server10.7.6；原Portal保持启用。辅助APK已前轮安装。

过程保留失败：
1. 首次session成功，但前台是小米桌面，3次读取98节点，没有动作后停止。
2. 恢复淘宝前台，首页多层父子节点重复暴露“领淘金币”，严格唯一门禁停止，未动作。将同文字/desc且bounds包含的重复候选作为一个入口后再试。
3. Appium一次clickGesture返回成功但截图仍首页，未进入淘金币，不重复。输入效果不计成功。
4. 改用已验证Portal只负责进入：从当前淘宝首页（未force-stop）2次入口tap到列表、5次读取中2次降级，24.254秒；无Midscene补点。证据evidence/appium-portal-entry/round-1/。
5. 列表静止，创建Appium新会话，actions为空，首次panel读取331节点。连续3次reset后读取：

| 次数 | reset耗时ms | XML读取耗时ms | XML节点数 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 15 | 4704 | 331 | 8任务，与截图相符 |
| 2 | 1861 | 4073 | 331 | 同上 |
| 3 | 1063 | 2917 | 331 | 同上 |

reset返回null为成功接口响应，不是任务结果。每次返回后下一次前等2秒。Source本身也有缓存重置逻辑；静止页面无法分离显式reset的单独贡献，不声称重置修复已证实。

8任务：任务到访得金币0/1、发现精选好物1/5、逛爆款好物抵扣快闪0/1、去蚂蚁庄园逛逛哟0/1、去蚂蚁森林收能量0/1、去支付宝农场逛逛哟0/1、搜一搜你心仪的宝贝0/5、头条极速版刷视频0/1。只读，不点击领奖或业务任务。截图余额1430、进度9/20；XML余额仍是滚轮数字串，不能直接还原余额。

Python从XML计算每份8个任务文字+bounds，3份一致；静止时一致是预期，不把一致单独当新鲜证明。父Agent事后截图核对有视觉成本，未调用Midscene；此前首页定位后失败图也做事后核验。

成功证据：evidence/appium-static-2026-10-31T14-56-11-045Z/，含session、panel-1.xml、static-1/2/3.xml、before/after-reset.png、summary、task-comparison.json。
失败证据：evidence/appium-static-2026-10-31T14-52-52-156Z/、14-53-40-295Z/、14-54-26-621Z/。

清理：session DELETE成功，Appium本机服务停止，ADB forward为空，Portal服务列表保持原值/启用1，hidden_api_policy=null。查询dumpsys activity instrumentation不支持，完整activity未发现可识别instrumentation段，因此不凭该输出宣称Android所有测试进程均退出；session日志和转发清理已确认。

下一步：用户继续后仅一次Portal列表滚动，再让Appium清缓存+读树，对照当前任务/bounds是否更新。该动作未执行。本轮未写收益账本、未启调度。
