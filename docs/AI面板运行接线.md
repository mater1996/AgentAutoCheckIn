# AI 面板运行接线

本次接通 runtime、readPanel、main 和 config；只做离线测试，不操作设备、ADB、模型服务、DB 或 cron。原 AI reader 模块、device、script-validation/audit 与旧配置未改。

## 显式模式

新配置设置 `aiPanelReader: true`，且必须显式设置 `scriptValidationMode: false`、`balanceComponent: false`。非 boolean 或冲突组合在配置校验中拒绝。未设置/false 保留旧默认观察路径。main 在 AI 模式把 `runner/staged/ai-panel-reader.ts` 纳入源码归档，保存真实 VisionClient usage；AI 运行不满足 auditStableScripts 的零模型标准，该政策未修改。

## 观察与证据

在 open_app、enter_activity、open_list、collect_list、select_task、return_list、settle 和开任务前读取当前原图。一个 runtime 内同 frame id 只尝试一次，失败也不自动重试。AI 调用统一消耗原 session agentCalls，并向 reader/model 传入 stage/session 剩余毫秒；调用前后均检查预算。设备 capture/owner 错误在 AI 模式直接停；OCR observationError 可保留并交 AI 读 PNG。

reader 保存原响应及 manifest。runtime 将返回的 `aiPanelEvidence` 追加到本 session 的原 frame JSON，保存原 lines、observationError、capturedAt 和其他字段。拒绝跨 session 图片或与磁盘原帧不一致的数据；不把历史原图写回旧 session。

readPanel 优先验证 AI 旁证。AI 旁证失效时不回退 OCR；未知 top/bottom 只作 false 使用。可信 isPanel 可直接提供导航 panel proof，review/source 标明 `ai-panel-v1`；AI 判非面板时，原 home/landing 导航仍可识别，但原 OCR panel 不会重新授予面板权限。

## 动作与任务范围

保留原 15000ms 新鲜度，模型耗时计入截图年龄，不修改 capturedAt。engine 和 device 原动作校验保留；collect/select 的滑动也检查当前 AI 面板、预算与帧年龄。AI 有效面板上的任务按钮可直接用于 currentRow/bindTask 和入口绑定，不再被冲突 OCR 文本否决；仅精确当前普通浏览按钮中心可通过该路径。

AI 模式只按原批准计划的 name+instruction 匹配，不因 `selectionAllowNew:true` 扩大候选。保留 reward、rewardMin/rewardMax、rewardOffers；不会把区间或下单最高额变成固定浏览收益。既有实际入口绑定、普通浏览合同、同 attempt 回执和两次正确资产面板稳定余额/正增量仍负责执行与结算。

已派发入口后的 browse/task_receipt 使用原本地执行合同，不额外读取 AI 面板；本地任务证据未知则停，不用模型恢复中断浏览。连续动作内部不插入新观察。

## 验证边界

`tests/staged-ai-panel-integration.test.ts` 明确使用 synthetic 模型响应；覆盖真实 runtime/engine/device 边界（仅 mock exec 和 HTTP 响应）、OCR 失败读图、帧 JSON 旁证、导航来源、sidecar 篡改、单帧一次、失败预算、剩余超时、15000ms 超龄、批准范围、已绑定入口及两次余额结算。其通过只证明接线，不代表真实模型语义或真机成功。

父任务第一轮真实模型报告 `evidence/ai-panel-reader-2026-11-01T23-57-20-512Z/report.json` 的 semanticAcceptance=false；父任务随后修正 prompt 并报告第二轮 `evidence/ai-panel-reader-2026-11-02T00-02-07-964Z/report.json`：三帧 top=[true,false,false]、bottom=[false,false,true]、余额均2265，批准候选 instruction=浏览，约8–9秒/帧。真实模型验收由父任务核对；此子任务未发模型请求，也未进行真机上线验收，不据离线测试宣称 live 可跑。

本次最终执行：专项加 main 回归 16/16 通过；全量使用正确 mock 参数和并发2，1804 total / 1798 pass / 0 fail / 6 原有 TODO，exit0。全量日志 `/Users/mater/.hermes/cache/scratch/ai-panel-integration-all-tests-corrected.log`。首次全量命令遗漏 module mocks 参数且在60秒超时，已以正确命令重跑，不作为通过依据。

离线命令：

```sh
node --experimental-test-module-mocks --import tsx --test tests/staged-ai-panel-integration.test.ts
node --experimental-test-module-mocks --import tsx --test --test-concurrency=2 tests/*.test.ts
```
