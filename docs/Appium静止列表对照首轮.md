# Appium静止列表对照：首轮安装阻塞

Appium3.9.0/UiAutomator2 driver8.7.3本机可用。默认profile driver list为空，改项目独立APPIUM_HOME tools/appium-home并通过绝对路径local driver注册成功；首个相对路径注册失败未当成功。

真机已由ADB wakeup+dismiss-keyguard解锁；resolve launcher后正常start淘宝（未force-stop）。截图为淘宝首页，原任务面板未保留，本组需新基线。未使用截图定位点击。

首次创建Appium session时安装官方预编译UiAutomator2 server辅助APK，HyperOS返回INSTALL_FAILED_USER_RESTRICTED: Install canceled by user。失败截图stop.png仍显示USB安装提示及“继续安装/拒绝”按钮。需要用户手动批准安装；未自动点击系统安装批准。

会话创建失败，没有拿到有效session进行任务导航；任务入口点击0，source读取0，resetAccessibilityCache调用0，业务任务0。不能判断Appium读树是否可用。

清理：server进程已停止，ADB forward为空；pm读回没有io.appium包；Portal无障碍服务列表保留原值、accessibility_enabled=1；hidden_api_policy清理后null。Appium创建阶段曾尝试为不存在的io.appium.settings配置mock_location而失败，日志有记录，不是任务动作。

证据：evidence/appium-static-2026-10-31T14-49-08-433Z/{summary.json,stop.png,cleanup.json}；server日志evidence/appium-static-preflight/server.log。只读诊断脚本probes/appium-static-read.ts使用共享设备锁，finally删除成功建立的session；失败过程由Appium自身清理。

下一步需用户在重试安装时点“继续安装”（可能两个辅助包各一次），通过后才继续静止清缓存/读树；不滚动/不任务。
