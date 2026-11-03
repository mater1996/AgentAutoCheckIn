# Token 优化 · 实测数据与规则

实测设备：Xiaomi 12S Pro（1080×2400，385 节点的淘宝首页）
实测脚本：`probes/token_cost.py`、`probes/token_cost2.py`
原始数据：`probes/token_cost.json`、`probes/token_cost2.json`

---

## 一、实测数据

### 取界面的各种方式（同一屏，淘宝首页）

| 方式 | 数据量 | 相对成本 | 耗时 |
|---|---|---|---|
| `dump_hierarchy()` 全量 XML | **182,234 字符** | 1× | 0.91s |
| 只提取 text 列表 | **239 字符** | **0.13%** | — |
| `xpath` 服务端求值（命中 0 个） | **0 字符** | 0 | 0.00s |
| `exists` 布尔判定 | **5 字符** | ≈0 | 0.14s |
| 可点节点（43 个）取样 8 个 | 571 字符 | 0.3% | 1.31s |
| `xpath('//*[@clickable="true"]').all()` | 31 个节点 | 中 | 0.54s |
| UI 指纹（文本集合哈希） | **19 字符** | ≈0 | — |
| 两次 UI diff（只传变化） | **35 字符** | ≈0 | — |

**结论：全量 XML 是 text 列表的 760 倍。绝不能把 dump_hierarchy 的原始输出塞进模型上下文。**

### 截图成本

| 形式 | 字节数 |
|---|---|
| 全屏 PNG（1080×2400） | **1,908,788** |
| 压成 800px JPEG | **100,804**（约 1/19） |

### 能力探测

| 项 | 结果 |
|---|---|
| `d.watcher` | ✅ 可用（设备端自动处理弹窗，0 token） |
| `long_click` | ✅ 0.95s |
| `swipe` | ✅ 1.57s |
| `drag` | ✅ |
| `swipe_ext` | ✅ |
| `gesture` / `pinch_in` / `pinch_out` | ❌ 不存在，需 shell 或 minitouch |

---

## 二、五条规则（按顺序执行）

### 规则 1：默认不看图，看文本，最好连文本都不取

正常执行全程只用 `exists` 布尔判定和本地 Python 字符串比较，**不进模型上下文，0 token**。

```python
# 0 token：本地判断
if d(text="签到").exists:
    d(text="签到").click()
```

只有本地判断失败、需要「看懂界面」时才升级。

### 规则 2：升级时只给结构化摘要，不给原始 XML

失败时构造的包（约 500~800 字符，而不是 182KB）：

```
界面文本（去重，≤40 条）：["我的","京豆","签到","任务中心","领京豆","已签到"...]
可点节点（≤15 个，含归一化坐标）：
  [{"t":"签到","x":0.5,"y":0.62},{"t":"领京豆","x":0.31,"y":0.44}]
当前包名/Activity：com.jingdong.app.mall/.MainFrameActivity
目标：找到并完成「每日签到」
```

实测全量 XML 182KB → 这个包约 800 字符，**省 220 倍**。

### 规则 3：必须看图时，压缩 + 裁区域

```python
d.screenshot("/tmp/s.png")
sips -Z 800 /tmp/s.png --out /tmp/s.jpg -s format jpeg   # 1.9MB → 100KB
```

进一步：只截关键区域（任务区通常在下半屏），再省一半。

```python
d.screenshot("/tmp/s2.png", region=(0, 1200, 1080, 1200))  # 只截下半屏
```

### 规则 4：用 diff 做变更检测

判断「点了有没有生效」，不需要传两次全量：

```python
before = set(texts(d))
click()
after = set(texts(d))
diff = {"add": list(after-before), "del": list(before-after)}   # 实测 35 字符
```

实测：两次 dump 的差异只有 `{"add":["86.1 "],"del":["189 "]}` —— 35 字符。

### 规则 5：设备端 watcher 处理常规弹窗

```python
d.watcher.when("跳过").click()
d.watcher.when("以后再说").click()
d.watcher.when("我知道了").click()
d.watcher.start(interval=2.0)
```

**设备端每 2 秒自动检查并点击，纯本地行为，0 token。** 实测 `has_watcher: true`。

---

## 三、token 预算

8 个 App / 账号的场景：

| 场景 | LLM 调用 | 输入量 | 频率 |
|---|---|---|---|
| 一切正常 | **0 次** | 0 | 每天 |
| 单个活动改版 | 1 次 | ~800 字符 + 200 输出 | 月均几次 |
| 需看截图 | 1 次 | 100KB JPEG + 200 输出 | 罕见 |
| 掉登录 | **0 次** | 0（只推送截图） | 偶发 |
| 验证失败重试 | 0 次 | 0（本地判定） | 每天 |

**正常日子完全不花 token。** 这是方案能长期跑的前提。

---

## 四、反模式（别这么做）

| 反模式 | 代价 | 正确做法 |
|---|---|---|
| 每次执行都 `dump_hierarchy()` 塞进上下文 | 182KB/次 × 8 App × 365 天 | 只本地解析，不传 |
| 每次都截图给 LLM 看 | 1.9MB/次 | 只在 L2 失败时，且压缩+裁区域 |
| 用 LLM 判断「点了成功没有」 | 每天 8 次 | 本地 diff 判断，0 token |
| 把整棵 XML 当 prompt | 爆上下文 | 只给文本列表 + 可点节点 |
| 每次失败都重试 3 次并每次问 LLM | 成本 ×3 | 本地重试，只升级一次 |

---

## 五、可重跑

```bash
cd /Users/mater/Project/android-checkin
.venv/bin/python probes/token_cost.py    # 基础取界面成本
.venv/bin/python probes/token_cost2.py   # 截图/手势/watcher/diff
```

结果自动写入 `probes/token_cost*.json`。
