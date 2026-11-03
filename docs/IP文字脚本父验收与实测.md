# IP文字脚本父验收与真机记录

## 父验收

读取实现和原合同确认：旧receiptOnly保持历史行为，新dwell-text-v2合同通过buildTextDwellContract加入run219真实要求来源；文字/位置检查，不比较商品/背景像素。原成功回执仍来源134，run219未改成功。

父staged类型检查exit0；真实engine/runtime专项与旧dwell/AI panel接线回归exit0，日志/Users/mater/.hermes/cache/scratch/ip-text-v2-parent-focused.log。

运行probes/build-ip-text-v2-config.ts产生独立新配置ai-ip-text-v2-config.json及plan，合同version=dwell-browse-candidate-v1:sha256:7a9ea5e9961852ce36c29480a88b339193ad5e555cfe25dbddebeb29dddf0f75，dwellMs5000，aiTaskRecovery=false。AI仅读取panel/余额；本轮仅IP任务，用于复验用户明确要求修好的流程，不冒充全16项主线完成。非live校验configValid=true、planTasks1。

最终全量回归1821total/1815pass/0fail/6原TODO，exit0，日志/Users/mater/.hermes/cache/scratch/ip-text-v2-parent-full.log。独立前备份data/backups/pre-text-policy-live-2026-11-02T00-50-13-997Z.db成功且quick_check=ok后，启动正常main ai-ip-text-v2-config.json --live --start-from-app，日志ip-text-v2-first-live.log，proc_a914bc02b741。运行结束，run220 evidence/staged-2026-11-02T00-50-22-665Z。open_app/enter_activity/open_list/collect_list均completed，select_task stopped，No eligible current task found in bounded selection。保存inventory程序标记top/bottom/complete均true，三屏合并20种原名，不含IP或周边；不能据程序完整标记推断独立识别准确率。未进入目标任务，新浏览等待分支本轮未触发、未真机验证；不能报脚本跑通或到账。cleanup原始power读回mWakefulness=Dozing且errors=[]。当前列表余额2325，相比run219 baseline2315不同，但无本次任务attempt/回执，不能补记IP收益或宣称来源已确定。收到用户问是否每项都需重新监督，明确复用已有完整脚本、正常主线自动执行核验，缺步骤才修，不重新人工学习全16项；本次单项配置仅缺陷复验，不替代主线。没有继续改生产或再次唤醒手机。
