# AI 面板读取实现与 run217 实测

实现范围仅新增 `runner/staged/ai-panel-reader.ts`、`tests/staged-ai-panel-reader.test.ts`、`probes/ai-panel-reader-probe.ts` 和本文。runtime/main/observations/config 的接线由父任务负责。

## 接口与证据

```ts
await readAiPanel({frame, owner, model, modelName?, evidenceDir, maxMs})
loadAiPanel(frame) // 同步，panel 或 null，不发模型请求
```

`owner` 必须有 package/userId，并匹配 capture frame。`modelName` 是新增的兼容可选参数，main 可传 cfg.model.name；不修改 VisionClient。调用方负责挂 `frame.aiPanelEvidence` 并保存 frame JSON。模块不改 frame，不读取 lines，不因 OCR 的 observationError 拒绝；PNG、owner、尺寸、capture 身份仍需有效。

每次 read 恰好一条 query，无隐式重试。供给现有 VisionClient 的 frame 只含 id/path/width/height/capturedAt；VisionClient 将原 PNG 字节放入 image_url，未把 OCR 当视觉输入。模型只报告可见原文及已有按钮，没有动作建议/设备接口。

证据 version 为 ai-panel-v1：manifest 的 path/sha256、frameId、sourcePngSha256、owner、width/height/capturedAt、createdAt、可选 modelName、status/error、该次 usage、原始结构化响应的 path/sha256。schema 拒绝也保留原响应；query 失败保留拒绝 manifest 与 usage。模型网关密钥、headers、请求凭据不保存。现有 VisionClient 仅返回解析后的 JSON 对象，因此这里“原响应”为未经业务清洗的 JSON 对象，不是 HTTP envelope 或逐字 JSON string；HTTP 无效 JSON/非成功响应不会交回模块，只有 usage.error 可留存。

load 每次同步复核 sidecar/manifest/原响应/PNG hash、frame/owner/version 绑定及 schema。PNG、manifest、响应必须在同一会话目录，使用 realpath 拒绝越界和外指 symlink。未知金额为 null；quota 为安全整数、done≤total；原文非空；title/button bounds 在图内，point 匹配按钮中心；标题行、按钮不允许重叠绑定，同名同要求歧义拒绝。schema 禁止额外 action 字段。reward 仅独立浏览/访问条件；答题/下单/游戏条件在 rewardOffers 中保留，range 不截成一个值。非面板不得携带余额和任务。top/bottom 可为 null，表示无明确证据。

## TDD 与回归

命令：

```sh
node --import tsx --test tests/staged-ai-panel-reader.test.ts
node --import tsx --test tests/staged-ai-panel-reader.test.ts tests/staged-vision.test.ts tests/staged-ai-panel-integration.test.ts
node --import tsx probes/ai-panel-reader-probe.ts
```

先观察模块不存在的 RED，再写最小实现；几何/quotas 反例从 accepted 触发第二次 RED；可选 modelName 从 undefined 触发第三次 RED。最后独立模块 5/5，通过父任务当前 integration 与既有 VisionClient 合计 22/22。mock 仅 HTTP/模型边界，任务文本明确 synthetic，PNG 为保存的真实图。

覆盖：原 PNG exact bytes 实际进入 image_url、OCR 错误/空 lines 可读、frame 不变、单次 query 和预算传递、PNG/响应/sidecar 篡改、错 owner/frame/capture/version、跨会话路径、歧义几何、quota/range/金额类型、未知余额、分条件奖励、失败 usage 和拒绝记录。

尝试独立 tsc --noEmit 时工作区缺少可用的 @types/node，不能完成静态类型检查；未改依赖或项目配置。tsx 实际运行及相关测试通过。

## 真实模型验证（2026-11-01T23:57Z）

配置取 `data/evidence/plans/stable-scripts-20261101/available-entry-recovery-config.json` 的 model，实际 `codex/gpt-6.1-terra`、已配置本机网关，timeout/maxMs 45000。apiKey 优先 CHECKIN_VISION_API_KEY，其次沿用 main 已有本机 fallback；不输出 key。无 provider 切换、无重试、无设备/DB/cron 操作。

全部证据位于 `evidence/ai-panel-reader-2026-11-01T23-57-20-512Z/`，汇总 `report.json`。三图在此目录只读复制后递归重定位历史 JSON 中源会话 path，持久 sidecar 仅写副本。三份原 PNG 和原 JSON 前后 hash 全部一致。

| PNG frameId | 端到端 ms | VisionClient ms | prompt tokens | completion tokens | balance | 完整行 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4cfce720-55ce-4c26-bdbd-4f11d5d73eaf | 9133 | 9124 | 6937 | 969 | 2265 | 8 |
| e0880d1a-6cb5-41af-b16d-bae14f6a286a | 8895 | 8889 | 6937 | 983 | 2265 | 8 |
| 04f46a15-6cc3-47ab-a0fc-f3450cd66a6d | 9020 | 9014 | 6936 | 954 | 2265 | 8 |

三次均各一 HTTP attempt，共 23716 tokens，VisionClient 合计 27027ms。prompt 约 6.9k，结合边界 exact-image-byte 测试和实际可见内容提供了图片确实送达的证据。金额成本未测量。

完整行合计 24，跨页按原名去重 20 个，第二图截断“天天签到免费拿IP周边”放 clippedRows，未补齐。独立原图复核余额都为 2265；庄园 instruction 为“点击去逛 +50”、reward=50；闪购完整 instruction 保留“下单最高+1000，浏览5秒 +20”，reward=20，rewardOffers 分别最高1000和浏览20；课堂 reward=null，rewardOffers 中参与答题为10~30。title/quota/按钮标签及中心与图中所在行相符，但未做独立像素级坐标精度基准。

## 未通过的语义验收与限制

三图 schema 均 accepted，只代表完整性和结构验证通过，不代表语义全正确。独立图片核对发现：

1. 模型三图都输出 top=true。第二/三图没有“完成进度”或列表起点，正确应为 false/unknown；top 语义实测错误。仅首图 top=true 可独立支持。
2. 末图看到全局“以上奖励均为最高奖励”后，把同样的可见 +50/+30 写成 reward=null/rewardMax=50/30，而中图重叠行写 reward=50/30。跨页语义不一致，当前不能宣称全量 reward reconciliation 通过。原图免责声明确实存在，模型没有把“标价”与“最高奖励”统一成一个稳定输出语义。
3. instruction 保留了原奖励数字，例如“浏览5秒 +20”，与旧 OCR 删除奖励片段的 instruction 不同。调用方匹配既有获准计划时需明确处理，不能悄悄凭名称扩任务授权。

按“模型错误后停止”的约束，三图逐次调用完成后在独立审核发现上述问题，未继续发新请求或重写历史原响应。需父任务决定后续 prompt/schema 调整与新的有限验证；当前不可直接作为已通过全量采集的上线验收。

三次实际调用本身均小于15s，但测试使用旧图，capture 年龄当然已过期，不能用于点击。未修改15s动作新鲜度阈值，load 本身只验证证据，不续期动作权限。实际设备 freshness、业务执行、到账和稳定性均未验证。
