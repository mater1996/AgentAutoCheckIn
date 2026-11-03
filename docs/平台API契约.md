# 平台 API 契约

**平台是服务，调用方只发意图。** 我、cron、别人的脚本，都只是 HTTP 调用方。

---

## 1. 端点总览

| 方法 | 路径 | 作用 | 耗时 |
|---|---|---|---|
| GET | `/api/activities` | 可跑的活动清单 | 即时 |
| POST | `/api/plan` | **只收集+算计划，不点屏幕** | 1~2 分钟 |
| POST | `/api/run` | 收集→决策→执行，一条龙 | 5~20 分钟 |
| GET | `/api/run/{id}` | 查运行详情（含成本归因） | 即时 |
| GET | `/api/runs` | 最近运行列表 | 即时 |
| GET | `/api/overview` | 资产总览 | 即时 |

`POST` 都是**异步**：立即返回 `id`，调用方轮询 `GET /api/run/{id}`。

---

## 2. POST /api/plan

只做收集与决策，**不执行任何点击**。用于人工审阅计划。

### 请求

```json
{ "account": "tb_main", "activity": "tb_coin" }
```

### 响应（202）

```json
{ "ok": true, "plan_id": 7, "status": "queued" }
```

### 结果（GET /api/run/7）

```json
{
  "id": 7,
  "kind": "plan",
  "status": "done",
  "inventory": {
    "progress": { "done": 12, "total": 20 },
    "tasks": [
      { "name": "看看你关注店铺的优惠", "quota": "0/1", "remaining": 1, "button": "去完成" },
      { "name": "拍立淘逛感兴趣的宝贝", "quota": "0/5", "remaining": 5, "button": "去完成" }
    ],
    "tiers": [
      { "coin": 30, "need": "已达成", "claimed": true },
      { "coin": 50, "need": "10次任务", "claimed": false },
      { "coin": 100, "need": "20次任务", "claimed": false }
    ],
    "total_remaining": 8
  },
  "plan": {
    "target": 20,
    "feasible": 20,
    "reachableTier": 20,
    "unreachableTier": null,
    "lossIfSkip": 0,
    "notes": ["策略 prefer_tier：把高风险任务加回计划，优先保档位"],
    "plan": [
      { "seq": 1, "task": "看看你关注店铺的优惠", "kind": "browse", "times": 1, "how": "adb", "estCny": 0 },
      { "seq": 2, "task": "拍立淘逛感兴趣的宝贝", "kind": "camera", "times": 5, "how": "aiTap", "estCny": 0.116, "risk": "需相机权限" }
    ]
  },
  "cost": { "total_tokens": 8123, "cny": 0.016 }
}
```

---

## 3. POST /api/run

### 请求

```json
{
  "account": "tb_main",
  "activity": "tb_coin",
  "mode": "auto",
  "skip": ["去支付宝农场逛逛哟"]
}
```

| 字段 | 说明 |
|---|---|
| `mode` | `auto`（默认）/ `plan-only`（等同 /api/plan） |
| `skip` | 显式跳过某些任务（覆盖规则） |

### 响应（202）

```json
{ "ok": true, "run_id": 21, "status": "queued" }
```

---

## 4. GET /api/run/{id}

### 运行中

```json
{ "id": 21, "status": "running", "stage": "execute", "progress": { "done": 14, "total": 20 }, "elapsed_ms": 184000 }
```

### 完成

```json
{
  "id": 21,
  "status": "OK",
  "stage": "done",
  "started_at": "2026-10-30T11:20:00+08:00",
  "finished_at": "2026-10-30T11:29:30+08:00",

  "gain": {
    "units": 185,
    "cny": 1.85,
    "breakdown": [
      { "source": "task", "units": 150, "note": "5 轮任务" },
      { "source": "tier", "units": 80,  "note": "已达档位" },
      { "source": "bonus", "units": -45, "note": "实测与推算差额" }
    ]
  },

  "cost": {
    "total_tokens": 152340,
    "cny": 0.305,
    "by_intent": { "planning": 32, "insight": 26, "locate": 6 },
    "by_caller": { "midscene": 152340 },
    "calls": 24
  },

  "steps": [
    { "seq": 1, "action": "entry",   "ok": true, "ms": 4200,  "tokens": 16300 },
    { "seq": 2, "action": "collect", "ok": true, "ms": 6100,  "tokens": 8123 },
    { "seq": 3, "action": "task:看看你关注店铺的优惠", "ok": true, "ms": 18500, "tokens": 7700 }
  ],

  "error": null,
  "report": "midscene_run/report/android-2026-10-30_11-20-00-abc.html"
}
```

**`cost.by_intent` + `cost.by_caller` + `steps[].tokens` 三者构成完整归因。**

---

## 5. 状态机

```
queued → running → (OK | ALREADY | NO_EFFECT | BAD_READ | ERROR | NEEDS_HUMAN | MODEL_DOWN)
```

| 状态 | 含义 | 是否计收益 |
|---|---|---|
| `OK` | 余额增长 | ✅ |
| `ALREADY` | 今日已领 | ❌ |
| `NO_EFFECT` | 跑了没变化 | ❌ |
| `BAD_READ` | 读数不可信 | ❌ |
| `ERROR` | 步骤抛错 | ❌ |
| `NEEDS_HUMAN` | 风控页/起始断言失败 | ❌ |
| `MODEL_DOWN` | 通道不可用，未执行 | ❌ |

---

## 6. 调用方视角

```bash
# 只看计划，不执行
curl -X POST localhost:8787/api/plan -d '{"account":"tb_main","activity":"tb_coin"}'

# 审阅后执行
curl -X POST localhost:8787/api/run -d '{"account":"tb_main","activity":"tb_coin"}'

# 轮询
curl localhost:8787/api/run/21
```

cron 里就是一句 `curl -X POST /api/run`，**不需要任何 agent**。

---

## 7. 与 SDK 的关系

`/api/run` 是**唯一执行入口**。Claude Agent SDK 如果启用，也只是调用这个接口的另一个调用方，不能绕过它直接点屏幕。

这样保证：

- 风控闸门不会被绕过
- 成本一定被记账
- 换任何调用方，行为一致
