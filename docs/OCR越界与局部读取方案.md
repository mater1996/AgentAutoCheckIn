# OCR 越界与局部读取方案（run207/208，离线研究）

结论：推荐 **独立、保留全部 raw 的 OCR 几何质量派生结果**，仅给合同保护区之外的轻微左边缘截字行标注“不可用于几何判断”，其文字仍参与全页风险与歧义拦截。不要全局放宽 `DeviceFrame.lines` 校验，不 clamp 坏行，不把裁图 OCR 替换成整页证据，也不增加截图重试次数。

这是可审阅方案和离线探针，生产尚未接入。现有 inspector 仍直接拒绝三张原始错误 frame。本次适配到旧 inspector 的内存对象只为定位后续门槛，不能作为执行 frame 或补写历史。run207/208 结果均仍 stopped、无 receipt、无 gain；不存在真实 completed50 新证据。

## 本地实测与复现

执行：

```sh
cd /Users/mater/Project/checkin-platform
node_modules/.bin/tsx docs/probes/ocr-boundary-local-probe.ts
```

最终结果：[result.json](probes/ocr-boundary-local/2026-11-01T16-06-50.235Z/result.json)。探针：[ocr-boundary-local-probe.ts](probes/ocr-boundary-local-probe.ts)。脚本每次写入独立时间目录，仅调用既有本地 Apple Vision 二进制与 `sharp`；不 import device/runtime/store、不连接设备、不调用远程模型、不打开数据库、不操作 cron。

本次实际 exit=0；10 个原图样本、20 类拒绝负例，均保留实际结果。完整矩形 `[878,1230,1060,1376)` 按 1x/3x 各运行三次，60 个裁图识别判定，54 个通过原合同。3 张失败原 PNG 各全页重读三次，9 次严格 bounds 校验全部失败。61 个已读历史/源码文件在结束时逐一 SHA-256 复核未变化。原始 PNG/JSON/OCR hash、二进制 hash、引擎/revision、实际裁图、映射坐标、OCR 原输出、耗时与拒绝详情均留在结果目录。输出中 `SYNTHETIC-NEGATIVE-*` 和 `SYNTHETIC-LIMIT-*` 是明确标记的负例/限制探针，绝非真实正例。

| 样本 | 保留 raw 的几何派生 + 原像素/唯一文本门槛（诊断） | 1x 固定 badge OCR | 3x 固定 badge OCR |
| --- | --- | --- | --- |
| run207 beaea497 原错误帧 | 唯一 browsing50 | 3/3 | 3/3 |
| run207 982d904e 后帧 | 唯一 browsing50 | 3/3 | 3/3 |
| run208 15a85a6e 原错误帧 | 唯一 browsing50 | 3/3 | 3/3 |
| run208 ada3c070 补采帧 | 唯一 browsing50 | 3/3 | 3/3 |
| run208 3d7cb0c2 receipt 阶段错误帧 | 唯一 browsing50 | 3/3 | 3/3 |
| 历史真实 browsing20 / 35 / 50（分别） | 各唯一正确 browsing | 各 3/3 | 各 3/3 |
| 历史真实 completed20 bac64856 | 唯一 completed20 | **0/3** | **0/3** |
| 历史真实 completed35 33f7f285 | 唯一 completed35 | 3/3 | 3/3 |

表中诊断结果保持原全图、原有效行坐标；在内存临时去除几何无效行并清错误字段才能调用旧 inspector。生产落地必须改成显式双轨输入，不能复制这个临时适配方式。三张错误 frame 原对象不经适配，原 inspector 对 20/35/50 均返回 null。

completed20 裁图失败有实质原因：**六次首先都在裁图严格坐标校验被拒绝**。1x 识别 `已得20` 的映射坐标约 `[924,1268,1018,1298]` 本身在 ±8px 内，但同一 badge 下部新增识别的 `下单再得500円` 局部 left=-0.000000101；3x 的 `下单再得500` 局部 left=-0.323639，均未被 clamp。3x 同时将 `已得20` 左界识别成 905.209，比期望 920 偏差约 14.791px，即使另行处理促销坏行，仍超出原回执门槛。这些均记录在 crops.repeats 的 malformed/lines/mapped 字段；本次六次都未进入后续 inspector，后一个坐标门槛是按源码比对得到。原全页 OCR 的真实 completed20 则只有准确的 `已得20`，直接通过。不得为裁图绿灯放宽 ±8px 或静默删掉同一区域的促销行；根据像素先分布局再采用不同文字窗可以另做研究，但它增加版式分支，不能称为当前最小通用方案。

控制区也实际裁图识别：back/coin 都输出空文字，shell 读到“加入购物车”，促销区能读到直播/去逛逛。OCR 空文字不能证明返回箭头或金币存在，仍必须用原全图 `matchesControl`。本次 badge 1x recognitionMs 中位数约 14.977ms（范围 12.609–82.453），3x 中位数约 31.671ms（23.186–527.224），为该机器此次本地批次数据，不含未来调度/截图/完整校验预算承诺。

## 原始坏行与相交情况

只统计 `<frame UUID>.ocr.json`，不混入 title/balance 派生裁图：run207 为 16 帧、969 行、1 个坏帧、2 条超过既有 .001px 容差的坏行；run208 为 16 帧、902 行、2 个坏帧、5 条此类坏行。完整坐标与每条保护区相交结果可在 result.inventory 中查验。

| frame / 原始行索引（0 起） | 原文字 | left（px） | y 范围（px） | 保护区相交 |
| --- | --- | ---: | --- | --- |
| 207 beaea497 / 7 | 猫双I1xLOREAL | -1.493236 | 328.728–407.930 | 无 |
| 207 beaea497 / 38 | 3/支不用选！拍3支更划算 | -0.627910 | 1566.375–1643.432 | **35 专用左促销区** `[34,1640,202,1704)`，纵向重叠 3.432px；50 候选不使用该区域 |
| 208 15a85a6e / 10 | 双11母婴节 | -0.393983 | 399.471–458.668 | 无 |
| 208 15a85a6e / 15 | g 囤货更划算 | **-2.879945** | 566.421–675.805 | 无 |
| 208 15a85a6e / 16 | 硒洗发水」 | -0.257936 | 679.188–740.580 | 无 |
| 208 15a85a6e / 24 | ，到手共1040g;3：具体详情详见内页 | -0.620573 | 1322.255–1357.133 | 无；right=317.425，未触及 x≥878 的 badge |
| 208 3d7cb0c2 / 32 | 头屑消费者（自 | -0.558504 | 1585.404–1608.831 | 无 |

全部是有限、有序、仍含可见文字的左越界，未出现右/顶/底越界或畸形 schema。最大 2.879945px，因此“都只是 1–2px”不成立；探针也断言仅容许 2px 会拒绝 run208 入口帧。

还需区分设备容差和数学几何：run208 入口第 25 行 left=-0.000001094，receipt 第 12 行 left=-0.000000273，均在现设备 .001px 容差内，并非导致本次整帧失败的行。独立派生器不 clamp，连这些微小负数也保留 raw 并标为几何无效，所以三个错误帧在派生结果中的无效行数分别是 **2、5、2**。历史 browsing50 也有三条这种 epsilon 负坐标，现设备已 clamp 过的 frame 与原 raw 不完全相同。审计须能表达这种既有差异，而不能假装 frame.lines 永远等于 OCR 原输出。

## 三条路径的比较

| 路径 | 实际效果 | 复杂度与适用边界 | 页面安全/审计问题 |
| --- | --- | --- | --- |
| 1. 固定 reward/control 区重新 OCR，保留全页风险上下文 | browsing20/35/50、completed35 通过；固定整 badge 的 completed20 全失败 | 多一套裁图生成、缩放/坐标映射、原图绑定、超时和按布局选择；全页风险读取仍需要路径2或额外识别 | 不能只给 crop.lines。原 raw 风险词与所有金额候选必须继续参与拦截；crop 新读出的风险也必须拒绝。crop 与 raw 有冲突应停，不能投票/择优。当前实验不支持通用替换 |
| **2. 独立 raw 几何质量派生结果** | 10/10 历史样本保留原合同唯一识别；3 张错误帧实际为 browsing50 | 一次线性分类，无新 OCR；仅限明确版本、1080×2400、Taobao owner、已绑定沉浸合同、左侧≤3px 的非关键文案 | 原文/坐标全留，风险和歧义全量处理，严格有效行才能提供位置；需显式 checker/runtime/audit 共同接入。不会改善漏字或视频内遮挡 |
| 3. 再截图/全页重读 | 已有 run208 补采成功，下一 receipt 又失败；同 PNG 本地重读 9/9 重现失败 | 代码小但行为不可靠；截图得到新帧，重复 OCR 仍是旧帧 | 不修根因。继续增加 retry 会耗预算、混淆完成/连续性。保留现有共享一次补采边界即可，不增次数 |

## 推荐的最小合同

保留 `DeviceFrame` 严格验证；增添独立 `ImmersiveOcrQuality`（名称建议）sidecar，状态分为 schema/page binding rejected、geometry classified、safety rejected、component accepted。它不是“修复后的整页 frame”。该模块先完成 raw envelope/schema 和精确原图身份绑定，再逐行建立原 index、text、原 bounds、geometryValid、overshoot、intersects/reason，返回原始所有行与有效行索引。无效行的坐标永远不用于 tap、回执位置或页面布局。

最窄许可建议固定为左越界 `0 < -left <= 3px`；其余三边在页内、矩形正面积且有可见部分、不涉及任何任务/收益文字，不与该**候选状态及金额**实际使用的保护区相交。右/上/下越界、>3px、全在页外、反向矩形、非有限值、错类型都拒绝，不做双边泛化。3px 是本次受限候选的显式新版本策略，有实际 2.880px 样本支持；不能称为 Apple Vision 保证、也不能外推所有布局。

保护区保留现 checker 的 badge `[878,1230,1060,1376)`、back `[48,136,80,184)`、coin `[910,1100,980,1210)`、shell `[316,1924,1040,2030)`；browsing35 另加 `[34,1640,202,1704)` 和 `[892,1640,1048,1704)`。run207 不能走“坏行不触及任何合同区域”笼统豁免：它触及 35 分支区域，所以 **35 分支须拒绝**；50 分支可在完整风险文本、唯一得50、原像素门槛全部通过后成立。生产应在每个候选分支使用固定保护区，不以 raw 的文字预先赋予金额权。探针根据 raw 含不含得35选择附加区域，只用于本次样本分类，不是最终金额选择实现。

全页安全必须先扫描所有 raw 文字，包括负坐标行；沿用现 immersive 拒绝词，再覆盖 runtime/面板风险词，至少登录/验证/验证码/授权/允许/隐私/温馨提示/确认/取消/同意/任务列表/赚金币抵钱/当前页下单/再得500金币。NFKC/去空格后逐行及跨行组合检查，不以“不在 crop 内”或“bounds 无效”跳过风险。全页 `浏览`、`得N`、`已得N` 的数量、金额和歧义也必须纳入 **全部 raw**：关键字出现在越界行时直接拒绝，而不是把它过滤掉获得唯一结果。不得把未知文案自动视为安全；关键区域缺文字、OCR 相互矛盾、金额不支持都停。

像素比较继续打开同一个原 PNG，不重绘、不修补、不降低 tile/RGB/边缘门槛，不把变化视频误当静态模板。20/35 回执仍需原坐标 ±8px、完整完成 badge、原控制边缘、同一 owning attempt、真实返回 quota 与稳定余额等后续证据。这里只让合法关键组件有机会被检查，不提供新的完成判据。

## 证据、权限与现链路缺口

建议 sidecar 明确保存：schema/algorithmVersion、source frame id/path/capturedAt/package/user、原 PNG hash、原 frame JSON hash、原 OCR 文件路径与**字节 hash**、engine/revision/languages/correction 配置、所有行分类/索引、保护区域版本、风险命中、component 识别结果。派生时间单列 derivedAt；原 id 和 capturedAt 不变。若走路径1，还须保存固定 ROI、scale、裁图 hash、OCR 字节 hash、映射公式 `source=(crop/scale)+origin`，并让审计独立重算 crop 字节验证。

当前生产接入至少有四处缺口，不能只删错误字段：

1. `device.ts:202–228` 在严格整页校验失败时保留 PNG 和原 OCR，但 frame.lines 空且 observationError 非空。`DeviceFrame`（device.ts:16）没有上述质量 sidecar。应保持原捕获结果不可变，将派生结果与 source 原记录并存；严格 raw schema 失败不得触发文字筛选豁免。
2. `immersive-browse.ts:155–176` 对 observationError/任意非法坐标一律 null，风险/金额检查目前只看 frame.lines。需要显式新版本输入（例如原 frame + 经过校验的 quality），让全 raw 安全/歧义与有效行几何分别使用，并保持后续像素谓词不变。探针旧对象适配不可直接搬进生产。
3. `runtime.ts:220–243` 的共享一次 OCR 补采已覆盖 open_task/task_receipt，但没有派生质量通道；各安全门目前只见 frame.lines。未来须在原 observed 与 quality 事件中清楚记录关联，先做本帧派生再决定是否触发现有一次补采；不得复位 entry.ocrRetryUsed、发第二 tap、添加模型 fallback，或借 quality 接受未知 dispatch。browsing 只锁当前唯一金额和有限 wait；它仍不是 receipt。stage/session/dwell/abort 预算与当前 owner/attempt 绑定继续生效。
4. `script-validation.ts:205–216` 的 frame() 要求 stages 内对象严格等于 `<原PNG>.json`；之后 receiptVisible/inspectImmersiveBrowse 读取同一 frame.lines。把历史 raw frame 换成过滤对象必然 `frame_unverified`，探针已断言。正确做法是原 observed 保持原样，新增已归档派生器及只读审计 replay：校验 source bytes/hash、重新分类、重算 sidecar、独立重跑全 raw 安全/金额/像素，再允许 receipt 使用明确关联且核实的派生 quote。还须将新模块纳入源码归档/指纹，拒绝 sidecar 版本不明、被篡改、frame/id/time/hash 不同、缺事件或不一致的情况。仅让运行时通过而审计忽略派生不成立。

历史资料只能离线识别，不产生 fresh 权限：原 capturedAt 既不随重新 OCR 更新，也不能因新 derivedAt 变新。future/stale 检查应以原捕获时间和当前执行期限为准（探针验证未来与超5秒拒绝示例；生产仍使用各层现有配置，不替换为探针固定值）。新执行的 capture 必须是当前真实采样，owner 在采样前后及动作前重新核验；同一 frame id 派生不能冒充独立观测、不能用于余额两次稳定读回、不能延长既有观察/dwell 预算。原 frame 的消费状态不因 sidecar 而恢复；currentFrame 比对必须继续以设备持有的不可变 capture 身份为准。

## 负例与尚未解决的风险

实际 20 类负例全部按预期拒绝：越界风险词、跨行风险词、关键得50越界、普通行穿过 badge、左越界3.01px、右越界、完全页外、字符串坐标、NaN、反向矩形、null 行、错 raw 文件、错尺寸、任务面板、登录文字遮挡、35 专用保护区被越界行触及、重复得50、badge 灰块遮挡、复制文字到另一布局 PNG、原捕获未来/过期。前16类在质量层拒绝，重复金额和像素负例由原 inspector 拒绝；最后一类验证权限新鲜度是独立条件。

**没有证明所有遮挡都会拒绝。** 探针额外把 400×160 的纯灰块放在视频内部 `[300,700,700,860)`，保留原 OCR、组件与控制，旧 checker 仍识别 browsing50。此实验只隔离像素层局限，并未对合成灰块重新 OCR；它证明仅靠组件像素不能排除视频内无可读文字遮挡，与原 checker 注释一致。全 raw 风险文字能拦截识别到的登录/授权框，却无法保证 OCR 漏识别的对话框、手势层、透明遮挡都被发现。若验收要求“所有形式遮挡必须拒绝”，当前三条方案都不满足，需单独增加有真实负例支持的全页安全判断，不能声称最小 OCR 修复已解决。

本次 3px 判据还存在误分类可能：有限正面积的左越界不证明整行文字完全可靠；因此只允许无关键字且不触保护区的文案退出几何用途，全 raw 文本仍保守参与拦截。3 次重复识别只证明本批固定历史图行为，不证明新视频、引擎更新、其他分辨率/字体长期稳定。completed50 仍只有原合同已有 synthetic_only 支持，本研究没有生成或“验证”真实完成50。未连接设备，因此也未声称收益恢复或16项稳定目标已达成。

建议父实施时先做一个明确新版本的“原 frame + 独立质量 + 原组件检查 + 审计 replay”切片，先保持纯离线回放与上述拒绝负例，再进入有新鲜权限的正常流程验证；上线前必须把审计和权限接入完成。不要将本 probe 的诊断绿灯直接计入历史成功次数或稳定性指标。
