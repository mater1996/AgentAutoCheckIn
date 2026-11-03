# Run205：系统导航OCR多识别“三”造成误拒

run205目录`evidence/staged-2026-11-01T15-13-15-888Z`，备份pre-run205-2026-11-01T15-13-02-234Z.db/quick_check=ok后正常main入口。open_app完成，enter_activity stopped，0action/0task/null余额收益、usage=[]、cleanup Dozing/errors[]。

当前978bb211-fdf4-484b-98a2-a4fe75f68e94对201第二参考七个原ROI全部通过，包括系统导航全宽[0,2280,1080,2400]；唯一额外OCR为底部“三”bounds[271.74,2323.26,428.52,2361.63]，它触发原“所有保护ROI新增OCR必须逐字与源一致”拒绝。不是去赚金币按钮变化、没有未知点击。

父真实205回归实际RED后，仅把Android系统导航ROI排除于额外OCR逐字比较；七ROI严格像素比较仍全保留，所有应用chrome/完整金币入口/唯一bounds/安全文字门槛不变。新同帧系统导航遮挡负例必须拒绝；不是为“三”加别名、不忽略底部像素。父完整regression20：1049total/1043pass/0fail/6原TODO，类型通过。

备份pre-run206-2026-11-01T15-16-20-082Z.db/quick_check=ok后启动run206正常main、严格零模型/单任务单轮。结果待读回；生产代码冻结，旧205不补成功或收益。
