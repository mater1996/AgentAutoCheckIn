# AI面板第二轮真实读取核验

父独立核对第一轮原响应，确认模型混淆固定header与列表起点、instruction仍含奖励金额、全局免责声明导致跨页奖励字段不一致。旧记录不修改。

修改AI_PANEL_PROMPT：固定标题和余额不证明top，实际奖励进度卡才证明列表起点；instruction仅要求原文、保留时长但奖励金额单独存；reward表行内展示浏览标价，不代表到账，全局最高奖励免责声明不改变行内表达，行内最高/区间仍单独记录。

再次真实运行node --import tsx probes/ai-panel-reader-probe.ts，exit0，无重试/设备/账本。结果目录evidence/ai-panel-reader-2026-11-02T00-02-07-964Z，三图余额2265；top=[true,false,false]、bottom=[false,false,true]，20种原名。闪购浏览20/下单最高1000分开，课堂10~30在条件offer保留；两批准候选instruction均浏览。Python实际比对重叠(name,instruction)的done/total/reward/range/offers无冲突。原PNG/JSON SHA不变。

耗时9386/8619/8422ms，prompt7139/7139/7138，总tokens24274。第一轮23716另计，不把两轮试错成本当单轮；金额成本未知。staged AI模块类型检查父实跑exit0（子之前报告@types/node不可用，父工作目录实际可用）。

此结果是保存三图离线真实模型观测，一轮prompt调整后已修已知语义错误；不是手机实测、长期准确率或稳定执行结论。新prompt版本对应源码必须归档，旧响应不冒充新prompt。当前AI_PANEL_VERSION仍ai-panel-v1，首次未上线，源码SHA用于区分两次候选。
