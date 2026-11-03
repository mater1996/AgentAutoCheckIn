"""实测：不同取界面方式的信息量（=token 成本）。"""
import sys, time, json, re
sys.path.insert(0,"/Users/mater/Project/checkin-platform/runner")
import uiautomator2 as u2

d = u2.connect("3d8a7934")
d.shell("input keyevent KEYCODE_WAKEUP"); time.sleep(0.8)
d.shell("wm dismiss-keyguard"); d.shell("cmd statusbar collapse"); time.sleep(1)
d.app_stop("com.taobao.taobao"); time.sleep(1)
d.app_start("com.taobao.taobao", wait=False); time.sleep(9)
d.shell("cmd statusbar collapse"); time.sleep(1)
print("fg:", d.info.get("currentPackageName"))

res = {}

# A. 全量 XML（最贵）
t0=time.time(); x = d.dump_hierarchy(); t_a=time.time()-t0
res["A_dump_hierarchy"] = {"chars": len(x), "nodes": x.count("<node"), "sec": round(t_a,2)}

# B. 只取所有 text（仍从主机侧解析）
texts = re.findall(r'text="([^"]{1,40})"', x)
res["B_texts_only"] = {"chars": len(json.dumps(texts,ensure_ascii=False)), "count": len(texts)}

# C. xpath 服务端求值：只回命中节点
try:
    t0=time.time()
    hit = d.xpath("//*[@text='红包签到']")
    t_c=time.time()-t0
    info = hit.get().attrib if bool(hit.exists) else None
    res["C_xpath_server_side"] = {"exists": bool(hit.exists), "payload_chars": len(json.dumps(info,ensure_ascii=False)) if info else 0, "sec": round(t_c,2)}
except Exception as e:
    res["C_xpath_server_side"] = {"error": str(e)[:80]}

# D. exists 布尔判定（最省）
try:
    t0=time.time(); ok = bool(d(text="红包签到").exists); t_d=time.time()-t0
    res["D_exists_bool"] = {"exists": ok, "payload_chars": 5, "sec": round(t_d,2)}
except Exception as e:
    res["D_exists_bool"] = {"error": str(e)[:60]}

# E. 只取可点节点（缩小候选集）
try:
    t0=time.time()
    cl = d(clickable=True)
    n = cl.count
    sample = []
    for i in range(min(n,8)):
        i2 = cl[i].info
        sample.append({"t":(i2.get("text") or "")[:12],"b":i2.get("bounds")})
    res["E_clickable_only"] = {"count": n, "sample_chars": len(json.dumps(sample,ensure_ascii=False)), "sec": round(time.time()-t0,2)}
except Exception as e:
    res["E_clickable_only"] = {"error": str(e)[:60]}

# F. 界面指纹（变更检测）
try:
    fp = hash(tuple(texts))
    res["F_screen_fingerprint"] = {"payload_chars": len(str(fp)), "value": str(fp)[:12]}
except Exception as e:
    res["F_screen_fingerprint"] = {"error": str(e)[:60]}

# G. watcher 是否支持（设备端自动处理弹窗）
res["G_watcher"] = {"has_watcher": hasattr(d, "watcher")}

# H. 手势能力
res["H_gestures"] = {k: hasattr(d,k) for k in ["long_click","swipe","drag","gesture","swipe_ext","pinch_in","pinch_out"]}

print(json.dumps(res, ensure_ascii=False, indent=2))
json.dump(res, open("/Users/mater/Project/checkin-platform/probes/token_cost.json","w"), ensure_ascii=False, indent=2)
