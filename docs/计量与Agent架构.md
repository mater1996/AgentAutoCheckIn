# 计量与 Agent 架构方案

针对「谁来驱动执行、怎么把 token 统计完全」这个问题的方案。先核对事实，再给架构。

---

## 1. 事实核对

### 1.1 Midscene 的 token 其实拿得到

本次会话实测（run #20，一次完整成功）：

| 意图 | 调用 | tokens |
|---|---|---|
| planning | 43 | 706,324 |
| insight | 13 | 92,915 |
| locate | 7 | 53,784 |
| 合计 | 63 | 853,023 |

来源是 `agent.metrics`，它由 Midscene 自己累计，含 `byIntent` / `byModel` / `totalCachedInput` 明细。

**所以「你调用 midscene 没办法统计 token」这个判断不成立。** 数据是有的，而且比 run 级汇总更细。

### 1.2 真正的缺口是这三条

| 缺口 | 表现 | 后果 |
|---|---|---|
| `agent.metrics` 偶发为空 | run #20 的 `usage_json` 至今是 NULL | 整轮成本丢失 |
| 只有 run 级聚合 | 无法回答「第 3 个任务花了多少」 | 无法定位成本热点 |
| 计量依赖调用方自觉 | 谁调的模型、用什么 key，库里不记 | 多调用方时无法归因 |

**这三条才是要解决的问题，而不是"换个 SDK 来调用"。**

### 1.3 Claude Agent SDK 能接，但它统计不到 Midscene 内部

已验证：网关 `/v1/messages` 返回 HTTP 200（Anthropic 格式可用），所以 SDK 可以通过 `ANTHROPIC_BASE_URL=http://127.0.0.1:3425` 接入，模型填 `codex/gpt-6.1-terra`。

但它记录的是**它自己那一层的调用**。Midscene 仍然直接打网关，SDK 看不到 Midscene 内部的 43 次 planning。

**结论：加一层 SDK，token 统计不会变完整，只会多一个花钱的层。**

---

## 2. 正确的解法：计量代理

### 2.1 原理

在模型网关前面加一个本地代理，**所有调用方都必须经过它**：

```
Midscene ──┐
执行器    ──┼──► 计量代理 :3426 ──► 网关 :3425 ──► 模型
Agent SDK ─┘        │
                    └──► SQLite: model_call 表
```

**端口即身份**：不同调用方走不同端口，代理据此归因，不依赖调用方自觉传 header。

| 端口 | 调用方 | 用途 |
|---|---|---|
| 3425 | 直连（保留） | 人工调试，不记账 |
| 3426 | Midscene | 平台执行器内的视觉调用 |
| 3427 | Agent SDK | 编排层调用 |
| 3428 | 探针/脚本 | 一次性实验 |

### 2.2 表结构

```sql
CREATE TABLE model_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  run_id INTEGER,              -- 由 x-run-id header 带入，可为空
  caller TEXT NOT NULL,        -- midscene | agent | probe | manual
  model TEXT NOT NULL,
  endpoint TEXT,               -- chat/completions | messages
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cached_tokens INTEGER,
  latency_ms INTEGER,
  status TEXT,                 -- ok | http_500 | timeout
  error TEXT,
  request_digest TEXT          -- prompt 的哈希，用于识别重复调用
);
CREATE INDEX idx_call_run ON model_call(run_id);
CREATE INDEX idx_call_ts ON model_call(ts);
```

有了这张表，「第 3 个任务花了多少」变成一条 SQL：

```sql
SELECT caller, model, SUM(total_tokens), COUNT(*)
FROM model_call WHERE run_id = 42 GROUP BY caller, model;
```

### 2.3 代理实现要点

- Node 原生 http，约 120 行，无新依赖
- 转发 `/v1/chat/completions` 和 `/v1/messages` 两种格式
- 流式响应需要边转发边累计 usage（SSE 最后一帧带 usage；若缺失则用 tiktoken 估算并标记 `estimated`）
- 超时/错误也要落库（`status` 字段），这样失败也有账
- 启动时打印「本次运行累计 ¥X」，实时可见

---

## 3. 执行层：平台自己驱动，SDK 可选

### 3.1 分层职责

| 层 | 负责 | 用什么 |
|---|---|---|
| 调度层 | 什么时候跑哪个活动、重试策略 | 平台（现有 cron + main.ts） |
| 决策层 | 收集清单 → 算计划 → 决定做不做 | 平台（`inventory.ts` + `planner.ts`，0 调用） |
| 执行层 | 按计划点屏幕 | 平台（`engine.ts`）+ Midscene 做定位 |
| 编排层（可选） | 遇到未预料情况时临场决策 | Claude Agent SDK |

**Midscene 只做"看图给坐标"，不做"决定做什么"。** 这一点现有代码已经是对的，不需要推翻。

### 3.2 Claude Agent SDK 放在哪

**建议：先不接。** 理由：

1. 当前失败的主要原因是**入口导航不稳**和**任务完成判定**，这两个问题 SDK 解决不了——它同样要靠 Midscene 看屏幕
2. 引入 SDK = 引入第二个模型消费方，成本叠加，收益不明确
3. 现有 `engine.ts` 已经是"配置驱动的执行器"，加 SDK 是重复造轮子

**什么时候值得接**：当出现"配置写不完的分支"时，例如平台改版导致流程大变、需要现场探索。那时 SDK 作为 fallback 编排层，且只在高价值活动上启用。

### 3.3 如果一定要接，怎么接

```ts
// 环境变量（已验证 /v1/messages 可用）
ANTHROPIC_BASE_URL=http://127.0.0.1:3427
ANTHROPIC_AUTH_TOKEN=magpie
ANTHROPIC_MODEL=codex/gpt-6.1-terra
```

SDK 的工具集里注册一个 `run_checkin_step` 工具，内部调平台的执行器；这样 SDK 负责决策、平台负责执行、代理负责记账，三者不重叠。

---

## 4. 实施顺序

| 步 | 内容 | 验收 | 工时 |
|---|---|---|---|
| 1 | 计量代理 + `model_call` 表 | 跑一次签到，表里出现该 run 的全部调用，且总数与 `agent.metrics` 对得上 | 2 小时 |
| 2 | 执行器打 `x-run-id` | 每次调用能归到具体 run | 30 分钟 |
| 3 | 面板加「成本明细」页 | 按 run / 按 intent / 按调用方三个维度可查 | 1 小时 |
| 4 | 失败调用也落库 | 通道挂掉时表里有 `status=http_500` 的记录 | 30 分钟 |
| 5 | （可选）Agent SDK 接入 | 一个只读的探索型任务跑通 | 4 小时 |

**第 1 步做完，「统计完全」就实现了**，不依赖任何 SDK。

---

## 5. 验收标准

| 指标 | 现状 | 目标 |
|---|---|---|
| 单次运行 token 可查 | 偶发 NULL | 100% 有记录 |
| 调用级明细 | 只有 byIntent 聚合 | 每次调用一行 |
| 失败调用成本 | 丢失 | 有记录 |
| 多调用方归因 | 无 | 按端口区分 |
| 与 agent.metrics 对账误差 | 未知 | < 1% |

---

## 6. 成本影响

代理本身不产生 token 成本，只增加一次本地转发（< 5ms）。

但它会让成本**第一次真正可见**——包括今天这种「一次失败烧 ¥1.05」的情况，以后在面板上直接能看到，不用等我事后算。
