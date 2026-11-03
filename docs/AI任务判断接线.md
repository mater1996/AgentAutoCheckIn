# AI任务判断接线

`aiTaskRecovery: true` 是显式任务恢复开关，配合 `aiPanelReader: true`、`scriptValidationMode: false` 与已有 learnedBrowse 候选使用。配置校验由父任务接入；未开启时保持旧本地任务合同硬停。该模式不是零模型验收。

## 本地优先与当前帧

已批准任务仍先从当前资产面板唯一行绑定并真实派发入口。open_task/task_receipt 先运行已有本地 inspector；只有返回 unknown/null 后，才通过原 describe/query 观察当前原图。当前 session、taskAttemptId、任务 name/instruction、真实入口 sourceFrameId/entryActionId/dispatched、最近动作、原图年龄和剩余预算一起交给模型。回复必须回显这些绑定；不同 attempt、owner、旧帧、派发 unknown 或 resume 不获得恢复权限。

同 stage/frame ID 只尝试一次，check 和 agentStep 共享同一 Promise，失败也不重发。原响应经现有 agent_result 持久化，VisionClient usage 计入失败，仍消耗 session agentCalls。模型耗时不会刷新 capturedAt，15000ms 原帧新鲜度与 stage/session/action 预算保持不变。

## 动作与回执边界

AI 每次只提出同 dispatcher 支持的 tap/swipe/back/wait。恢复动作经 engine 原帧校验和 validateProposedAction；tap 还必须命中本帧唯一 OCR 控件，且仅允许继续浏览、普通关闭/返回，敏感控件原本地 gate 保持。裸坐标、地址/授权/购买/游戏/输入等动作均不能取得权限。OCR 不可用时仅能安全 back/wait，不确认完成。

连续滑动仍使用原本地合同与 revalidation，内部不插入模型观察。恢复动作通过该帧同 dispatcher 单次派发，不被当成连续滑动段；等待每次至多5000ms，再读新帧。任何 dispatch unknown 不能重试，下一次进入该 attempt 仍停止。

任务完成只接受当前目的页、同真实入口 attempt 的明确完成回执；报价、浏览秒数或其他列表行不作回执。AI 回执还须在当前 OCR 中核实完成原文，不能只凭非空 quote。settle 继续要求原 attempt 回执、正确 owner 资产面板、两个不同新帧稳定余额与正增量。

返回未知模态在本地第一次普通 back 后，可在已有同 attempt 回执与入口绑定下交 AI；仅安全 back/wait 或当前帧本地核实的普通关闭/返回控件。不从任务名或页面任意“关闭”全局匹配获取权限。旧 flash 精确合同不放宽，home/landing 未知导航不扩展。

## 离线证据

新增 tests/staged-ai-task-recovery.test.ts 使用真实 runtime/engine/VisionClient、注入 HTTP 响应与离线 device。模型回复均明确是 synthetic；未操作设备、真实模型、DB 或 cron。

首先在原 runtime 复现 RED：已派发入口本地 unknown 后，预期一次 AI 观察，实际0次。父 run219 的原始 `59fd5523-153a-4811-812d-f61d1dc3fdd7.png/json` 另做 RED/GREEN 重放：原图商品骨架加载、右下浏览5秒得奖励；普通地址入口不是模态。字节保持不变，只赋离线重放 frame ID/time，实际本地 dwell inspector 返回 unknown 后合成 AI 给 bounded wait；只验证原图/context/dispatcher 接线，未声称真实模型判断或产生 live 回执/收益。

覆盖本地优先、单帧一次、同 attempt 完成和两帧结算、错误任务/owner、禁止裸坐标/敏感点击、未知派发不重试、返回安全退出、预算耗尽、模型失败 usage、超龄不续期和旧默认无 fallback。

运行命令：

```sh
node --experimental-test-module-mocks --import tsx --test tests/staged-ai-task-recovery.test.ts tests/staged-ai-panel-integration.test.ts tests/staged-continuous-contract-runtime.test.ts tests/staged-entry-ocr-reobservation.test.ts
node --experimental-test-module-mocks --import tsx --test --test-concurrency=2 tests/*.test.ts
```

专项最终结果：73 tests / 73 pass / 0 fail，exit0，日志 `/Users/mater/.hermes/cache/scratch/ai-task-recovery-focused-final.log`。全量最终日志 `/Users/mater/.hermes/cache/scratch/ai-task-recovery-all-tests-final.log`；最终结果见子任务交付。离线通过不等于已满足两个独立正常入口真实成功的稳定标准。
