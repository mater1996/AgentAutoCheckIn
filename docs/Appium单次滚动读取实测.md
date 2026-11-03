# Appium单次滚动后清缓存读取实测

结论：本轮未通过。Portal一次滚动真实改变任务视口，但Appium连续3次resetAccessibilityCache后读取仍是首屏8任务及旧坐标。因此现成Appium清自身无障碍缓存没有解决该现场，不需据此继续定制Portal APK；应重新评估观察路径。

版本沿用Appium3.9.0 / driver8.7.3 / server10.7.6，官方Portal0.7.30保持开启。未安装定制诊断APK。

操作：共享设备锁覆盖Portal服务、Appium session及清理；唤醒/免密码dismiss，确认前台淘宝，创建不重置/不启动/不强停目标的Appium会话。从当前Appium原树8任务的bounds推导列表纵向范围，只派发一次Portal swipe：(540,2005)→(540,1145)，450ms。返回success仅为派发结果，最终截图独立确认列表已滚动。没有任务点击或领奖，没有第二次滑动/回顶。

| 读取 | source耗时ms | 任务数 | 对照 |
| --- | --- | --- | --- |
| 滚动前 | 4067 | 8 | 对应首屏 |
| 滚动后reset1 | 2839 | 8 | 仍首屏旧坐标 |
| 滚动后reset2 | 3524 | 8 | 仍首屏旧坐标 |
| 滚动后reset3 | 3343 | 8 | 仍首屏旧坐标 |

reset请求耗时558/519/439ms，均成功返回null。原树中任务文字+bounds的SHA256四份完全相同：46237b74be3a43ca2746ee93ab829f7c19828938fe2734a3d0e0ec7f4a91de99。hash只证实不变，截图负责证明它与当前视口不符。

final.png实际视口：顶部残留蚂蚁森林行，随后支付宝农场、搜一搜、头条极速版、淘金币趣味课堂、来淘宝闪购分百亿补贴、百度极速版、看看#精致面霜、逛百县百品助农频道。树仍以任务到访得金币/发现精选好物/快闪开头，后续新行不存在，旧行位置未变。余额截图1430；顶部进度区已滚走，不从旧树9/20当作滚动后的当前可见进度证据。

前图Portal启动通知仍在屏幕顶部，没有覆盖任务列表/手势区域；final通知消失。该差异已披露，不影响任务区滚动与旧坐标对照，但不称截图完全仅一处差异。父Agent只在实验结束后核图，未补点；核图有视觉模型成本，未调用Midscene。

证据：evidence/appium-scroll-2026-10-31T15-00-53-762Z/，before.xml、after-1/2/3.xml、before/after-swipe/final.png、summary、comparison、cleanup。脚本probes/appium-one-scroll.ts。summary.outcome one-scroll-read-complete只表示命令完成，不是新鲜度验收成功。

解释限制：换到独立UiAutomation连接并执行清缓存仍旧，削弱“只是Portal HTTP/本地解析器缓存”的解释；尚不能单凭这一组精确区分淘宝WebView提供层、Android厂商实现或特定窗口/节点树机制。不要宣称已确诊淘宝Bug。静止3次成功不等于滚动成功，本轮正好证伪推广。

清理读回：session已DELETE，本机Appium停止，forward为空，8080/8081无监听，Portal原无障碍列表/enable=1保留，hidden_api_policy=null。当前手机保持滚动后的任务列表中段。未写业务账本/启调度，暂停。
