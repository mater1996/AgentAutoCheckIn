# Claude Agent SDK 接入方案

**结论先行：SDK 是可选编排层，不是必需依赖。配置全部读我们自己的 `config/agent.yaml`，不读 SDK 默认的散落环境变量。**

---

## 1. 为什么接、为什么不急着接

### 值得接的场景

- 平台改版导致流程大变，配置写不完，需要现场探索
- 需要在多个活动之间做取舍（先跑哪个、失败后改跑哪个）
- 需要"看不懂的页面"时让模型自己想办法

### 不值得接的场景（也就是现在）

- 日常签到：路径固定，`planner.ts` 已经能算清楚做哪些
- 失败处理：现在的失败是入口导航和任务判定问题，SDK 同样要靠 Midscene 看屏幕，解决不了
- 成本敏感：SDK 是第二个模型消费方，成本叠加

**所以：先把计量和 API 做好，SDK 留接口不实现。**

---

## 2. 配置约定：读我们自己的配置

### 2.1 唯一的配置文件

`config/agent.yaml`：

```yaml
agent:
  # 是否启用 SDK 编排层；false 时完全走平台自有执行器
  enabled: false

  # 走计量代理端口，这样 SDK 的调用也会被记账
  base_url: http://127.0.0.1:3427

  # 密钥从环境变量读，配置文件里不写明文
  auth_token_env: MAGPIE_API_KEY

  # 模型：与平台其他部分保持一致
  model: codex/gpt-6.1-terra

  # 单次任务最多轮次，防止跑飞
  max_turns: 12

  # 允许 SDK 调用的工具（白名单，不给 Bash/Write）
  allowed_tools:
    - collect_inventory
    - plan_activity
    - run_activity
    - read_run

  # 日志目录：SDK 每次会话一个 jsonl，用于事后归因
  log_dir: logs/agent
```

### 2.2 加载方式

```ts
// runner/agent-config.ts
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export type AgentCfg = {
  enabled: boolean;
  base_url: string;
  auth_token_env: string;
  model: string;
  max_turns: number;
  allowed_tools: string[];
  log_dir: string;
};

export function loadAgentCfg(): AgentCfg {
  const f = path.resolve('config', 'agent.yaml');
  const raw = fs.existsSync(f) ? YAML.parse(fs.readFileSync(f, 'utf8')).agent : {};
  return {
    enabled: raw.enabled === true,
    base_url: raw.base_url ?? 'http://127.0.0.1:3427',
    auth_token_env: raw.auth_token_env ?? 'MAGPIE_API_KEY',
    model: raw.model ?? 'codex/gpt-6.1-terra',
    max_turns: raw.max_turns ?? 12,
    allowed_tools: raw.allowed_tools ?? [],
    log_dir: raw.log_dir ?? 'logs/agent',
  };
}
```

**要点：SDK 需要的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` 三个环境变量，全部由 `loadAgentCfg()` 的返回值填充，不散落在各处。**

---

## 3. 启动方式

```ts
import { loadAgentCfg } from './agent-config';

const cfg = loadAgentCfg();
if (!cfg.enabled) throw new Error('agent.enabled = false，未启用 SDK 编排层');

// 由配置填充环境变量，再启动 SDK
process.env.ANTHROPIC_BASE_URL = cfg.base_url;
process.env.ANTHROPIC_AUTH_TOKEN = process.env[cfg.auth_token_env] ?? '';
process.env.ANTHROPIC_MODEL = cfg.model;

const { query } = await import('@anthropic-ai/claude-agent-sdk');

for await (const msg of query({
  prompt: '为 tb_main 的 tb_coin 活动生成执行计划，并调用 run_activity 执行',
  options: {
    maxTurns: cfg.max_turns,
    allowedTools: cfg.allowed_tools,
    mcpServers: { checkin: checkinTools },   // 平台自己的工具
  },
})) {
  // 落日志 + 记账，见第 4 节
}
```

### 3.1 网关兼容性（已验证）

| 项 | 结果 |
|---|---|
| `POST /v1/messages`（Anthropic 格式） | **HTTP 200**，返回 `{"content":[...],"id":"msg_..."}` |
| `POST /v1/chat/completions`（OpenAI 格式） | HTTP 200 |
| 模型 id | 用 `codex/gpt-6.1-terra`（网关自有 id，不是 `claude-*`） |

**注意：模型 id 必须是网关认识的。** 填 `claude-sonnet-4-5` 会返回 404。

---

## 4. 归因：SDK 日志 + 计量代理双记

### 4.1 SDK 日志记什么

SDK 每条消息带 usage（`input_tokens` / `output_tokens` / cache 字段），结果消息还带总用量。落地为：

```
logs/agent/<session-id>.jsonl
  {"type":"assistant","usage":{"input_tokens":812,"output_tokens":47}}
  {"type":"result","usage":{...},"num_turns":4}
```

### 4.2 但完整归因靠计量代理

SDK 日志只覆盖 SDK 自己那层。Midscene 内部的 planning/locate/insight 它看不到。

**所以两本账并存**：

| 来源 | 覆盖范围 | 用途 |
|---|---|---|
| `logs/agent/*.jsonl` | SDK 编排层 | 看"它怎么想的" |
| `model_call` 表（代理写入） | 所有调用方 | 看"钱花在哪" |

对账规则：`model_call` 里 `caller='agent'` 的汇总，应与 SDK 日志的 usage 之和接近（误差 < 1%）；不一致说明有调用绕过了代理。

---

## 5. 工具白名单（安全边界）

SDK **不允许**拿到 Bash / Write / Edit 这类工具。只给平台包装好的四个：

| 工具 | 作用 | 副作用 |
|---|---|---|
| `collect_inventory` | 收集任务清单与档位 | 只读 |
| `plan_activity` | 算计划 | 纯计算 |
| `run_activity` | 执行已定计划 | 会点屏幕 |
| `read_run` | 查历史运行 | 只读 |

**理由：SDK 是编排层，不是执行层。执行必须走平台代码，才能保证记账和风控闸门不被绕过。**

---

## 6. 限制与已知风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 模型 id 不匹配 | 网关只认自己的模型名 | 配置里写死 `codex/gpt-6.1-terra`，启动前 ping 一次 |
| SDK 版本 API 变动 | `query()` 选项可能随版本变化 | 锁版本，接入前先跑官方示例 |
| 成本叠加 | SDK 自身也是模型调用 | 只在 `agent.enabled=true` 时启用；默认 false |
| 绕过风控闸门 | SDK 若直接调 adb 就绕过了平台闸门 | 只给四个工具，不给 Bash |
| 日志膨胀 | 每次会话一个 jsonl | 按天清理，只留 7 天 |

---

## 7. 实施状态

| 项 | 状态 |
|---|---|
| `config/agent.yaml` + 加载器 | 本文档定义，代码待写 |
| 网关 `/v1/messages` 兼容性 | ✅ 已验证 HTTP 200 |
| SDK 安装与最小示例 | ⬜ 未做 |
| 四个工具包装 | ⬜ 未做（`run_activity` 已存在，其余待包） |
| 日志落盘与对账 | ⬜ 未做 |

**当前建议：`enabled: false`。** 等计量代理和 API 稳定后再开。
