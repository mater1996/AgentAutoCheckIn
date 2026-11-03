# 失败归档 userId 诊断

对象：`evidence/staged-2026-11-01T18-01-26-451Z`，session `0959fd6f-9be5-4496-9b2e-6bc47120cd3e`。原始 `runId=null`，不是正式 run 212。本次没有补写或改写该历史，也没有执行设备、模型或调度。

根因是 `runtime.ts` 的 local review 把真实动作记录复制到 `orderedSteps` 和 `candidateConfig.steps`。本轮两处 `[0].action` 都是 `{type:'launch',package:'com.taobao.taobao',userId:0}`，同时携带 `frameId/source/status/error`。store 先校验 candidateConfig，因此先抛 `Operational data in shared candidate: userId`；只修这一处仍会在 orderedSteps 再次拒绝。review 的 events 中也有 frame.userId，但原 store 没有把 events 选进共享候选，所以不是本次第一个触发点。原本的设备错误是 `Foreground missing or ambiguous`。

修复位于 `source-archive.ts` 的共享知识投影和 store 调用边界。只识别带 `action.type + frameId + source + status` 的完整执行记录，将整条记录排除出共享的两个步骤数组；不递归删 userId，也不把丢失 owner 的动作变成可重放步骤。原始 review、events、actions、scope 和 frame 仍完整保存在 session 的 stages/reviews。普通学习步骤、配置和源码归档保持原行为，候选继续是 `validation:candidate / crossAccountValidated:false`。未知 operational 字段继续拒绝，并补上 frame/session/receipt 标识校验；review scope 只允许 app/activity/stage。账号和 Android user 的数据库隔离未放宽，runtime.ts 和 task-records 契约未修改。

真实验证：新增 `tests/staged-failed-archive.test.ts` 直接读取上述 session-state 的真实 stages/reviews/result，仅把归档目标重定位到 `~/.hermes/cache/scratch/failed-archive-*`，用 DDL 新建空 SQLite 和最小账号/活动，不复制或打开真实账本。首轮 RED 在 store candidateConfig 校验处复现完全相同的 userId 异常；修复后 GREEN。另有 engine 的 pending/verified/observed/rejected/unknown 状态、普通知识不变、未知 frame 和 review userId 的 RED→GREEN，以及 session save boundary、六类 scope/知识拒绝、错误保留与零 gain/asset snapshot 测试。本轮原始证据目录全部文件 SHA-256 前后比较一致，result.json/stages.json 仍不存在。隔离重放写入的 UNKNOWN run 仅是测试库记录，不是历史成功或真实收益。

执行命令：

```sh
node --import tsx --test tests/staged-failed-archive.test.ts tests/staged-store.test.ts tests/staged-source-archive.test.ts tests/task-records-v2.test.ts tests/task-records.test.ts tests/staged-session.test.ts tests/staged-session-persistence.test.ts
```

结果：87 tests，87 pass，0 fail；含新增 12 tests。正常 completed 路径的原有 ledger/V2 验证、15 种 main 源码归档模式、不可变冲突和账号隔离回归均通过。所有写操作只发生在隔离 scratch 根；测试结束清理。未运行全量可能涉及设备的测试，也未验证真实设备 foreground 修复。
