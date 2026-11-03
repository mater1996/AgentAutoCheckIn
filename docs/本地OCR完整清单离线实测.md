# 本地OCR完整任务清单离线实测

结论：Apple Vision在本次3张真实列表截图上读出全部21项任务，标题及已做/总次数与既有截图人工核对清单21/21匹配，无漏项、额外项或次数冲突。本轮未操作手机、未调用Midscene/LLM API。它绕开Appium滚动旧树问题，但尚未接入真机自主采集。

## 实际执行

macOS系统Vision框架VNRecognizeTextRequest，Swift编译小型本地程序，accurate、recognitionLanguages=[zh-Hans,en-US]、usesLanguageCorrection=false，未填customWords、未使用任务词典、模糊匹配或人工改OCR结果。官方属性参考：https://developer.apple.com/tutorials/data/documentation/vision/vnrecognizetextrequest.md 。本机Python无Vision/Quartz/PaddleOCR，选系统Swift原生调用，无需安装OCR包。

输入：evidence/appium-inventory-2026-10-31T23-34-47-389Z/page-2.png、page-3.png、page-4.png，1080x2400，分别顶部/中段/明确底部。本轮范围为已保存图像离线能力测试，不把旧截图当当前手机任务状态。

| 指标 | 实际结果 |
| --- | --- |
| 标题行 | 每图8条，共24条观测 |
| 重叠去重后 | 21项，与既有真值21项相同 |
| 名称+次数正确 | 21/21 |
| 漏项/额外项/次数冲突 | 0/0/0 |
| 顶部进度/底部说明 | OCR均读出 |
| 同图再跑 | 21项标题相同 |

比较前只做Unicode NFKC，将全角括号/标点转换为半角等标准形式；不替换汉字、数字或任务内容。充话费标题的全角感叹号因此也统一；这一口径已在audit.json写明。

## 耗时与限制

第一次运行第一图31.83秒，后两图各0.16/0.17秒，首次整进程约33.33秒；再次启动进程读同样3图约0.69秒（各0.27/0.18/0.17秒）。首图长延迟具体原因未定位，可能涉及首次初始化，不将冷启动成本隐去；不是每天稳定耗时承诺。没有显式LLM API调用，探针没有网络调用代码，但没有做系统框架网络流量审计，不能称已证实系统框架绝不联网。

正文要求存在错字/符号错误，例如原截图“点击去逛”的部分识别结果为“点舌去逛”，金币图标有时混入字母或重复“币”。因此本轮只通过整表标题/次数，不声称收益数字、要求语义、按钮绑定全部通过。

OCR提供了文字框坐标，当前只做文本清单去重；还没有实现任务行与按钮可靠绑定、全流程状态判断或按需视觉补读。没有从21/21推出点击成功或自动签到已可用。样本只有同一轮列表3张图；再次读同图只是确定性复核，不算另一轮独立准确率。

## 交付

- probes/apple-vision-ocr.swift：系统OCR调用，输出原始文字、置信分、像素框、识别耗时。
- probes/evaluate-ocr-inventory.py：先从OCR原文提取带次数标题，再与独立truth对比，不以truth补全OCR。
- evidence/apple-vision-ocr/raw.json、warm.json：两次原始输出。
- evidence/apple-vision-ocr/recognized-tasks.json：24条标题及位置/来源。
- evidence/apple-vision-ocr/audit.json、warm-comparison.json：程序统计与限制。
- 编译产物：/Users/mater/.hermes/cache/scratch/checkin-apple-ocr，可从源码重新swiftc编译，不作为长期部署路径。

下一步建议：确认后将OCR接入只读整表采集，真机完整滚动采集一轮，仍按全部任务的名称/次数/要求/奖励分别核验；先不执行任务。本轮结束，手机未触碰。
