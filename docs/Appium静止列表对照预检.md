# Appium静止列表对照：预检与暂停点

本轮用户同意使用现成Appium对照，范围仅静止读树，不滚动、不任务。

已完成本机项目内安装：tools/appium-static，Appium3.9.0、UiAutomator2 driver8.7.3、预编译server10.7.6。appium --version实际返回3.9.0；检查driver execute-method-map包含resetAccessibilityCache，server两个APK已随包下载。未在手机安装这些APK、未创建会话。

手机操作仅共享device-lock下读取状态/截图，以及一次KEYCODE_WAKEUP。开始Asleep，唤醒后截图为系统锁屏；没有尝试解锁、输入密码或恢复页面。ps只见淘宝channel进程，未确认原任务页面仍存在。不能沿用此前任务列表底部当实时基线。

/proc/net/unix发现browser_webview_devtools_remote_23231，ps读回PID23231为com.android.browser；不是淘宝WebView调试入口。此时未运行中的淘宝并不能据此判定永远不支持调试。

服务配置读回：Portal仍enabled=1；forward为空。所有手机证据位于evidence/appium-static-preflight/{preflight.json,awake.json,before.png,awake.png}。截图核验使用父Agent视觉，有模型成本，未调用Midscene。

计划会话参数保存在planned-capabilities.json：noReset=true/fullReset=false/autoLaunch=false/dontStopAppOnReset=true/forceAppLaunch=false/shouldTerminateApp=false/autoGrantPermissions=false/skipDeviceInitialization=true/skipUnlock=true/disableWindowAnimation=false/disableSuppressAccessibilityService=true。实际会话尚未执行，不能声称参数已生效或服务器读取成功。

阻塞：需用户手动解锁并回到当前淘金币任务列表（不点击任务）；如原页已丢失，告知重新进入，按新基线对照。设备解锁后再进行server安装/启动、resetAccessibilityCache和只读XML/截图对照，完成后暂停。
