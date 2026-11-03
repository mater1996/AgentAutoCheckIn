# AI面板首次真机复验记录

用户已批准让AI直接读任务列表与余额。AI_MODE仅改变观察来源，不扩大批准任务范围，不宣称零模型。

## 启动条件

第二轮保存三图真实模型语义核验通过，详见AI面板第二轮读取核验.md。子全量1804total/1798pass/0fail/6原TODO，exit0，日志ai-panel-integration-all-tests-corrected.log父读回核对。父staged生产类型exit0，AI模块/运行接线/main专项ai-parent-targeted.log exit0。

新增available-ai-panel-config.json，显式aiPanelReader=true、scriptValidationMode=false、balanceComponent=false、selectionAllowNew=false。保留原两批准候选、任务动作/回执/结算、预算和15000ms新鲜度。非live校验configValid=true、planTasks=2。

独立前备份data/backups/pre-text-policy-live-2026-11-02T00-08-55-905Z.db实际成功并quick_check=ok；文件名沿用备份probe，不表示使用旧OCR模式。随后正常入口--live --start-from-app，日志/Users/mater/.hermes/cache/scratch/ai-panel-first-live.log，进程proc_bf1206ecf45d。

## 状态

正式run218，session6ae7d10a-cc0f-4151-b5f5-9d4d3a5acf82，证据evidence/staged-2026-11-02T00-09-04-370Z。open_app→enter_activity→open_list→collect_list→select_task→open_task→task_receipt→return_list→settle→review_task全部completed，main exit0。

AI收集三屏，top/bottom/complete=true，20种任务名。当前列表动态选中发现精选好物/浏览，初始0/3。点击进入落地页，独立匹配已有50金币普通连续浏览合同，执行有界连续滑动（runtime起止相差17.024秒；并非只滑一次，stages中的单swipe是批量入口动作），不购物。保存回执40476858-b8d9-40e8-91c2-0643cf67f84b显示“已得50｜下单再得500”，只认已得50。一次back返回资产任务面板。

余额2265→2315；两次独立新帧40e6110f-c76e-422e-9ce2-d835e2b4a538、2dbb8aca-2602-434e-98f3-fdf1caa8c186都AI读2315，sidecar/source原图hash重放通过。父事后图审回执及首结算图各一张：确认已得50、正确金币资产面板2315；原发现精选好物行已替换为好物沉浸看1/3，不把替换行的进度当原任务完成证据。

DB只读读回run218 status=DIAGNOSTIC，gain_event39 units=50，note=Staged diagnostic receipt; independent replay not validated，quick_check=ok。final/result completed，gainCoins50，learningValidation=diagnostic_only；业务首次AI辅助闭环成功，不冒充稳定/正式成熟验收。

## 调用与归档

运行14次实际模型调用，109391tokens（prompt99938+completion9453），模型调用累计107971ms；从session开始到最后runtime事件160.637秒，不含末尾归档cleanup耗时。金额成本未知。之前离线两轮23716+24274tokens另计，不混成成功轮费用；父事后图审另计。

源码ai-panel-reader.ts实际归档data/stage-records/script-sources/1affb8755c370b1b1b32ab760ff823350a96bcb07a0fd18e08f4977fdad17229.ts，candidate_831f5cdad8f2e95fdb6adb8870fcb2b5166250711121244aa86c33b4e19c39f0绑定run218/session及reviewIndex9，provenance only。源码归档不授予稳定资格。

cleanup.errors=[]，读回mWakefulness=Dozing，手机已息屏；未启调度。

## 限制与后续

只完成一项的一轮；其他任务/跨账号未验证。AI辅助路径不满足旧whole-session-zero-model稳定政策，不能算稳定1/16。当前14次模型调用偏多，后续可减少重复读图，但先报告这一实测结果，不擅自更换架构或扩大任务范围。
