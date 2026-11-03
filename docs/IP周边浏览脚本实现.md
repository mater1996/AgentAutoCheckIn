# IP周边浏览5秒文字合同

本次仅修改 `runner/staged/dwell-browse.ts`，新增 `tests/staged-ip-dwell-v2.test.ts` 和本文。runtime、main、observations、audit、生产配置、历史图像/JSON 均未修改；未连接设备、真实模型、数据库或 cron。

## 显式启用与来源

新增 `buildTextDwellContract(base, sourceRef)`，输入已验证旧 v1 合同和学习帧 Reference（额外包含 `rawPath`、`rawSha256`）。不以 task.name 或 run219 分支识别目的页。旧合同无 `textPolicy` 时完全沿用原 receiptOnly/像素路径；新合同深拷贝旧合同，保留原成功来源和 provenance，新增 `textPolicy.version='dwell-text-v2'`、`learningRequirementEvidence`，设 `receiptOnly=false`、`dwellMs=5000`。`contractVersion` 算法和外层 `dwell-browse-candidate-v1` 不改，新增字段自然进入哈希。配置只能保留一份精确匹配任务的合同，不能并列旧新两份造成歧义。

学习来源是 run219 `59fd5523-153a-4811-812d-f61d1dc3fdd7`：淘宝成就标题、右下浏览5秒/得奖励；页面商品 skeleton、地址设置入口和背景不参与模板匹配。完成来源仍为旧 run134 原成功回执 `c49cc7ff-85c7-45f9-8530-c861231fe0e8`。run219 只提供等待要求，绝不被追认为成功。

新路径验证来源 PNG、保存 frame JSON、原始 OCR 的 SHA-256；当前 PNG 能解码且保存 frame 的 id/path/capturedAt/尺寸/owner 对得上，原始 OCR 的 pages.file/尺寸也必须属于当前帧。只将标题与要求/回执关键文字在 saved/raw/current 三者对齐，避免既有其他任务标题 refinement 和无关灰色/细字 OCR 差异阻断。没有增加像素模板、背景或商品匹配。

标题唯一并落在来源位置（±6px）；浏览5秒与得奖励分别唯一且位于来源右下组件。错 owner、错页、5改10、重复要求、移位、验证码/登录/授权等阻断拒绝。完成必须同一组件唯一出现任务已完成与继续逛逛吧，且不得同时存在浏览秒数或得奖励；兼容原历史“任务已完成“”边缘引号以及正常任务已完成，quote 逐行保留当前原文。无需旧页面“更多”等其他历史文字。

## 生成配置的调用方式

在项目根目录由配置生成流程调用下列逻辑，输出到一个新配置文件；不要覆盖旧配置或历史合同。示例的 `oldContract` 来自既有配置中 `sourceRunIds:[134]` 那一份，`frameJsonPath` 指向以上 run219 原 frame JSON。

```ts
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildTextDwellContract} from '../runner/staged/dwell-browse.ts';
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const frame = JSON.parse(await readFile(frameJsonPath, 'utf8'));
const rawPath = frame.path.replace(/\.png$/, '.ocr.json');
const contract = await buildTextDwellContract(oldContract, {
  path: frame.path, sha256: sha256(await readFile(frame.path)),
  ocrPath: frameJsonPath, ocrSha256: sha256(await readFile(frameJsonPath)),
  frameId: frame.id, rawPath, rawSha256: sha256(await readFile(rawPath)),
});
newConfig.dwellBrowse.contracts = oldConfig.dwellBrowse.contracts.map(c =>
  c.version === oldContract.version ? contract : c);
newConfig.aiTaskRecovery = false;
```

runtime 原有精确合同路由接收 `{state:'browsing',waitMs:5000,version}`，派发本地 wait 并重新观察，继续沿用 5 秒切片及 `dwellMs+5000` 总预算（此处 10 秒）。同 attempt 的入口/回执绑定、返回和两帧余额结算由原 runtime 负责。

## 实际验证

TDD 首次运行先确认旧真实完成帧通过、run219 返回 null，再断言预期 browsing/5000，得到实际 RED（null vs browsing）；实现后 GREEN。随后正常无引号完成文字和重复冲突完成文字均先验证失败，再补最小文字规则。

离线测试通过真实 `createStagedRuntime` 和其调用的 engine，未替换 dwell inspector：初始 AI panel → 一次入口 tap → run219 真实浏览帧 → 一次脚本 wait 5000 → 原真实历史完成帧 → 一次 back → 两帧不同 id 的 owning panel 余额。断言等待前后重观察、回执 taskAttemptId、脚本 action source、任务 AI 调用为零。返回阶段的原 AI panel reader 允许在仍显示目的页时得到 isPanel=false，这只是面板识别，不提出任务动作。另测始终浏览帧在 ≤10000ms 虚拟累计等待后停止，无回执、无任务 AI、无第二次入口。

重放 PNG 原样复制到 scratch，frame/raw 的路径和新 capture id/time 只在 scratch 重定位，清除不属于新 capture 的历史 title/balance sidecar。阶段转换、累计等待时间和面板模型返回显式为 synthetic，余额2315→2325仅用于离线结算断言；本测试不证明新真机收益，也不修改旧 run219。

执行命令：

```sh
node --import tsx --test tests/staged-ip-dwell-v2.test.ts tests/staged-dwell-browse.test.ts tests/staged-dwell-runtime.test.ts tests/staged-dwell-real-runtime.test.ts tests/staged-dwell-evidence.test.ts tests/staged-ai-panel-integration.test.ts
node_modules/.bin/tsc --noEmit --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck runner/staged/*.ts
```

前述相关回归56项全通过，staged 类型检查通过。新增测试仅依赖本地归档，不声明真实设备或新 session 验证。
