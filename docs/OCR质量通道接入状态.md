# OCR质量通道接入状态

研究入口为`docs/OCR越界与局部读取方案.md`，原图/完整探针保存在文中。用户持续授权16任务稳定；此切片仅解决无关左越界文案导致沉浸页全帧弃用，不扩大业务权限。

## 已完成

共享一次补采runtime已冻结，父39/39专项与完整1083pass/0fail/6原TODO、类型验证。真实208仍第二次错误停；不增加重试次数，不回填旧收益。

父独立读取207/208原全页OCR，验证三张错误图都是左越界，最大2.879945px；保持原raw/PNG/JSON不变。纯固定badge裁图真实completed20不能可靠通过，原图重读9/9越界，故不采用裁图替换或反复重读。

新增显式`immersiveBrowse.ocrQuality` boolean配置，true只允许enabled v2。配置缺校验测试实际RED，补校验后5/5 GREEN。当前仅配置验证落地，运行尚未使用，未创建启用的live配置。

## 已交付并经父独立验证

独立质量模块`immersive-ocr-quality.ts`和checker显式第四参数已交付：保留原frame错误/空lines和原raw所有行；每次使用重新核原PNG/frameJSON/rawOCR字节和完整派生对象，风险/金额与可定位几何分开。新模块+原checker父独立35/35通过；未把completed50合成样本当真实完成。

正常main save实际源码归档已补：所有enabled immersive都保存quality模块，因为checker有静态import，无论ocrQuality开关是否true都是实现依赖。先后真实RED证实缺档，补后17/17通过（涵盖默认immersive、transition与启用quality三种模式）；真实store生成归档及session review绑定，并非只核路径数组。日志`/Users/mater/.hermes/cache/scratch/ocr-quality-source-archive-green2.log`。

## 实施中

runtime与audit两个独立子任务已启动，限定各自文件避免交叉写；质量事件约定`immersive_ocr_quality`，绑定stage/attempt/entry frame/entry action/current frame/reward及完整quality。原frame不改，先质量判断再考虑原一次补采，预算/unknown/晚归不放宽。独立审计须限定session真实路径并从原文件重算，不信quality自报。尚未收到并验收接线交付，不能声称运行可用。

## 接线交付及首轮实测

runtime/audit交付已父独立核验；补旧fixture新依赖归档、runtime类型收窄后完整1184pass/0fail/6原TODO，类型通过。正常main归档已覆盖新模块。详见`docs/run209质量通道接入后首轮实测.md`。

run209已正常入口执行，自动完整收集3页（20不同原始名称）、选择好物沉浸看0/3列表50、一次tap942,644进入视频；OCR无越界错误，新quality事件0，故质量路径未live触发。原完整合同仍拒，停止后一次back返回面板，usage=[]、无receipt/gain、Dozing/errors=[]。基线2155父独立audit true，DB quick_check=ok/gain209=[]。当前只读逐gate诊断中，不在无证据下扩大合同，稳定0/16。

剩余：run209拒绝根因诊断与最小修复、真实quality分支触发、完整正常闭环重复验收；不能将离线合成回放或单次进入视频当稳定。
