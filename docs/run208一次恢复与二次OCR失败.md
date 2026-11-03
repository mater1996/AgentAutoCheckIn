# Run208：一次OCR恢复真机成功，第二次识别错误后保守停止

证据`evidence/staged-2026-11-01T15-35-31-731Z`；备份pre-run208-2026-11-01T15-35-15-288Z.db/quick_check=ok后正常main。1054pass/0fail/6TODO+类型，执行期代码冻结。

选中好物沉浸看2/6、浏览、列表20，baseline2155独立audit true。一次task tap942,1045；open_task status=completed、tap verified。当前海飞丝视频页由原沉浸合同确认。

必须读runtime.jsonl而非只看stage observed：打开过程中失败帧15a85a6e-5157-4539-9262-abbf8129651d发生OCR capture failed: Invalid OCR frame or bounds。entry_ocr_reobservation事件已保存failedFrame/freshFrame，fresh ada3c070-9a0c-4076-98b4-695ac7b5d4f1、acceptedObservation=true、extraWaitMs=0、observationWaitMs=1000；真实调用一次只读恢复成功。原失败帧在恢复事件中，不在engine observed的返回值中，不能因只见正常observed误称未触发。

task_receipt首帧3d7cb0c2-414d-4da9-81e8-6c88ef418bdb又同OCR bounds错误，已花一次恢复额度，0wait/action后停止；并非简单stage漏接。return初813a89ac-5cdf-46f4-832c-a64fd3871c77 OCR正常，普通一次back回c10f15f7-0c91-4f62-a43d-8df2e8a0113b panel2155。无真实completed/receipt，balanceAfter/gainCoins=null，gain_event208=[]/quick_check=ok，usage=[]，cleanupDozing/errors=[]，v2Archived=true/partial=false/issues=[]。

父已收共享补采冻结交付：open_task/task_receipt同attempt共一次，不增加次数；receipt首次使用必须destination已确认、dispatch已知，stage/session截止与采样/检查器晚归重新检查。39专项独立通过，父完整regression23：1089total/1083pass/0fail/6原TODO，类型通过，runtime SHA3bfe96c1716b56a02d05c4bfc9bb28098543b76144448740f5f4e02e4fdc1c3e；test SHAff6b9422a92c92bb9777d864181b2de5b13f93cfec51c994fe147511d6e27b27。真实208回放仍必须第二次错误停止，没有追加动作/读取返回帧来冒充恢复。

已委派更根本的只读方案研究：用207/208原PNG/raw OCR实测固定组件裁图读取与几何质量分层；所有越界行的文字仍须参与风险检查，关键控件/奖励坐标无效不能授权；保留raw hash/派生版本/原capturedAt，审计需可重算。不改生产/设备/ledger/调度。此次不再空跑已知仍会失败的手机流程。

父曾先说本轮未触发恢复，读完整runtime事件后已纠正；不得按错误初判扩大重试次数。委派改进仅共享open_task/task_receipt原一次额度（仅未消费时receipt可用）、补deadline/负例以及真实208二次失败必须停止回归。该改进本身不能把208跑成成功。后续要研究整页OCR数据校验如何不让无关越界文案反复堵塞完整任务；先有方案/原图/结构证据，不clamp无效bounds、不伪造原frame、不放宽任务/领奖组件身份。
