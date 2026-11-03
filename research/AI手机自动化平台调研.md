# AI 手机自动化平台调研（关键补充）

调研时间：2026-10-29
起因：上一版只查了「签到脚本」方向，漏掉了「AI 手机 Agent」这一整个方向。补上。

---

## 结论：找到了，而且比自建更好

**有现成的 AI 自动签到平台，成熟度远超我之前建议的自建方案。**

核心发现三件事：
1. **`Open-AutoGLM`（26,504 stars）** —— 智谱开源的手机 AI Agent 框架，整个生态的地基
2. **`AutoGLM-GUI`（1,131 stars，2026-10-28 仍在推送）** —— 带 Web 界面、定时任务、Docker、多设备、MCP 的完整平台
3. **`autoglm-phone` 模型在智谱 BigModel 平台「限时免费」** —— 成本几乎为零

这三条合起来，正好就是你要的「AI 自动签到平台」。

---

## 一、Open-AutoGLM（地基，26,504 stars）

- 仓库：https://github.com/zai-org/Open-AutoGLM
- Stars：**26,504** / forks 4,062
- 许可：Apache-2.0（代码）+ MIT（模型）
- 最后推送：2026-03-06

**它是什么**：智谱 2025-12 开源的「手机操作智能体」。模型看屏幕截图 → 输出下一步动作（点击/滑动/输入）→ 通过 ADB 执行 → 循环。

**关键特性**：
- 多模态理解屏幕，不需要 UI 树（不需要 text 属性）
- 覆盖 **50+ 高频中文 App** 的现成 Demo
- 模型 `AutoGLM-Phone-9B` 开源（HuggingFace: `zai-org/AutoGLM-Phone-9B`）
- 支持本地部署（8GB 显存可跑量化版）或云端 API

**为什么这比 uiautomator2 强**：
uiautomator2 依赖控件的 text/resource-id，淘宝那种自绘界面经常抓不到（我实测「红包签到」节点就在 XML 里但 selector 匹配不到）。
AutoGLM 是**看截图**，只要能看见就能点 —— 这才是应对「签到活动天天变」的正确方式。

---

## 二、AutoGLM-GUI（完整平台，1,131 stars，推荐）

- 仓库：https://github.com/suyiiyii/AutoGLM-GUI
- Stars：**1,131** / forks 177
- 许可：Apache-2.0
- 最后推送：**2026-10-28**（很活跃）
- PyPI：`pip install autoglm-gui`

**它已经实现了我之前方案里要自己写的大部分东西**：

| 我原方案要写的 | AutoGLM-GUI 已有 |
|---|---|
| 定时调度 | ✅ Cron 风格任务调度（明确写着「签到、检查、周期性任务」） |
| Web 面板 | ✅ 完整 Web UI |
| 多设备管理 | ✅ 支持多设备并发，状态隔离 |
| 实时看执行 | ✅ 基于 scrcpy 的低延迟视频流 |
| 执行记录 | ✅ 对话历史，可追溯每一步 |
| Docker 部署 | ✅ 预构建镜像，amd64 + arm64 |
| 多账号 | ✅ 多设备（配合系统双开） |
| 打断/重试 | ✅ <1 秒中断 |
| 对接 Agent | ✅ 内置 MCP 服务器（能接 Claude Desktop / Cursor） |

**平台支持**：
- macOS Apple Silicon 有现成 DMG（免装 Python 环境）
- Windows 便携 EXE
- Linux AppImage / deb
- 或 `pip install autoglm-gui` / `uvx autoglm-gui`
- 或 Docker（`ghcr.io/suyiiyii/autoglm-gui:main`）

**模型接入**：任何 OpenAI 兼容 API。官方推荐：
- 智谱 BigModel：`--base-url https://open.bigmodel.cn/api/paas/v4 --model autoglm-phone`
- ModelScope
- 自建服务

**分层代理模式**（v1.5 新增）：决策大模型 + 视觉小模型两层，规划与执行分离，适合多轮复杂任务。

**Workflow 工作流**：预定义常用任务，一键执行 —— 这就是「签到配方」的现成实现。

---

## 三、auto-phone-scheduler（专为签到，120 stars）

- 仓库：https://github.com/lxzagent/auto-phone-scheduler
- Stars：120 / forks 23
- 最后推送：2026-01-12
- 许可：MIT

**它的定位最贴合你的需求**（README 原文）：

> 应用场景：各种 APP 会员每日签到、定时打卡、自动化浏览做任务、定时清理单向好友等

特性：多设备管理、WiFi 无线连接、自动亮屏解锁、实时调试控制台、智能提示词配置、任务模版 + Cron 调度、完整执行记录（含屏幕录像）、钉钉/Telegram 通知。

**技术栈**：FastAPI + SQLAlchemy + APScheduler + SocketIO + React/Vite 前端 + scrcpy。

**但有个硬限制**（`backend/app/config.py` 注释原文）：

> 注意: 需要使用专门训练的 AutoGLM 模型 (如 autoglm-phone-9b)
> glm-4v-flash 等通用模型可能无法正确输出 action 格式

所以它必须配 AutoGLM 专用模型，不能随便接个通用视觉模型。

**对比 AutoGLM-GUI**：这个更专（签到场景、有任务模板、有录像），但更新慢（2026-01）且星数少；AutoGLM-GUI 更通用、更活跃、部署方式更多。

---

## 四、成本：AutoGLM-Phone 模型「限时免费」

智谱 BigModel 官方文档（`docs.bigmodel.cn/cn/guide/models/vlm/autoglm-phone`）原文：

> **新模型上线，限时免费！**

- 上下文窗口 20K，最大输出 2048
- 支持中文 + Android
- 调用方式：OpenAI 兼容 API

**这意味着**：签到这种短任务（一般 5~20 步），token 消耗很小，免费额度大概率够用。

**风险**：限时免费随时可能结束。结束后价格未公开。所以方案要能切换到：
- ModelScope 免费额度（`api-inference.modelscope.cn`）
- 本地部署（8GB 显存可跑量化版；Mac Apple Silicon 也有人跑通）

---

## 五、云手机 / 商业平台（备选，不建议）

| 平台 | 价格 | 说明 |
|---|---|---|
| **DuoPlus 云手机** | $1.4/台/月起 | RPA 功能不额外收费，按设备时长计费。有 AI Agent 模板商店 |
| **GeeLark** | 免费 2 profile；付费 $13/月起；云手机 $0.007/分钟（$1.20/天封顶）或 $29.90/台/月 | 反检测云手机，社媒多账号为主 |
| **阿里云 Agentic Mobile**（无影云手机） | 企业定价 | 通义千问 + OpenClaw，云端 Android 沙箱 |
| **腾讯云手机 Computer Use Agent** | 企业定价 | 大模型 + GUI Agent + 云手机 PaaS |

**为什么不适合你**：
- 你已经有真机（专用机），云手机是重复投入
- 这些平台的强项是「批量多账号运营」（几十上百个），你是自用单账号
- 按分钟计费，签到每天跑十几分钟，成本不高但没必要

---

## 六、方案对比（含之前的自建方案）

| 方案 | 签到能力 | 平台化 | 成本 | 维护 | 结论 |
|---|---|---|---|---|---|
| **A. AutoGLM-GUI** | ✅ AI 看屏操作，抗改版 | ✅ Web/定时/多设备/记录/MCP | 模型限时免费 | 低（社区活跃） | **首选** |
| **B. auto-phone-scheduler** | ✅ 同上，专为签到 | ✅ 任务模板/录像/通知 | 同上 | 中（更新慢） | 备选 |
| **C. Hamibot 淘宝签到助手** | ✅ 但只覆盖淘宝+支付宝 | ⚠️ 有云端和 REST，无收益面板 | 免费（额度内） | 低 | 淘宝专项可用 |
| **D. 自建 uiautomator2** | ⚠️ 依赖 UI 树，自绘界面抓不到 | ❌ 全要自己写 | 0 token 正常跑 | 高 | **降级为兜底** |
| **E. 云手机平台** | ✅ | ✅ | $1.4~30/月 | 低 | 不需要 |

**核心判断**：
- **AI Agent 派（A/B）在「抗改版」上碾压脚本派**。它看截图，不看控件树；活动改版换个按钮位置它照样能点。这正是你最初问「签到活动会变怎么办」的答案。
- 我原来设计的「L2 LLM 现场决策 + 写回配方」，本质就是在自建一个弱化版 AutoGLM。既然有现成的，没必要重复造。

---

## 七、修正后的建议

### 主方案：AutoGLM-GUI

```
执行：AutoGLM-GUI（Docker 或 Mac DMG）
模型：智谱 autoglm-phone（限时免费）→ 备选 ModelScope / 本地
调度：AutoGLM-GUI 内置 Cron
面板：AutoGLM-GUI 自带 Web UI（看执行、看历史、看实时屏幕）
多账号：系统双开 + 多设备管理
```

**它已经覆盖了 80% 我之前要自己写的功能。**

### 我们还需要自己写的（剩下 20%）

**只有一块：收益记账。**

AutoGLM-GUI 记录的是「任务执行成功/失败 + 对话过程 + 录像」，**没有「积分→人民币、按账号/活动/时间汇总」**。
这仍然是我之前调研确认的空白。

具体做法：让 AI 任务在签到后多一步「读余额」，把结果写进我们的账本，再做一个汇总面板。

### 兜底：自建 uiautomator2

保留我实测的那套（`runner/checkin.py`），用途：
- AutoGLM 模型限时免费结束后，如果价格不可接受，退回自建
- 简单固定路径的签到（不消耗模型 token）
- 需要精确验证的场景

---

## 八、待确认

1. **先试 AutoGLM-GUI 还是 auto-phone-scheduler？**
   我倾向 **AutoGLM-GUI**：星数多 9 倍、更新近 9 个月、部署方式多（Mac 有 DMG）、有 MCP。
2. **模型用哪个？**
   - 智谱 autoglm-phone（限时免费，最省事）
   - ModelScope（免费额度）
   - 本地部署（要 8GB+ 显存 / Mac 统一内存，慢但零成本）
3. **要我先装 AutoGLM-GUI 跑通一个淘宝签到吗？**
   Mac DMG 双击就能装，但需要你注册智谱账号拿 API Key（这个我不能替你注册）。
