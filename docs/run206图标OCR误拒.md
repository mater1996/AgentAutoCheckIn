# Run206：返回箭头偶发OCR造成相同像素页误拒

证据`evidence/staged-2026-11-01T15-16-32-943Z`。open_app completed；enter_activity stopped、0action/task/receipt/gain；usage=[]、cleanup Dozing/errors=[]。

5788b3d7-172a-46c5-b9ad-16497acbcb7f对201第二参考所有七ROI全部通过；额外OCR是返回箭头“←”与系统导航“三”，原参考箭头没有OCR行。205只排系统导航后仍被返回图标OCR误拒。scratch/nav206-probe.json保存逐参考数值。没有图像变化或入口变化的证据。

父真实206断言landing实际RED后，保留七ROI像素守卫和所有安全/owner/唯一身份/金币入口bounds/完整按钮检查，只让文本区域额外OCR参与逐字核验：菜单文字、金币标题、完整金币入口；返回/购物车/声音/Android导航图标仅由原像素阈值负责，不为“←”“4）”“三”增加别名。新增遮挡返回图标必须拒绝，原所有文本/遮挡负例保留。

完整regression21：1050total/1044pass/0fail/6原TODO，类型通过。备份pre-run207-2026-11-01T15-18-57-262Z.db/quick_check=ok后启动run207正常main入口，代码冻结；结果待实际读回。run206原stopped不改。
