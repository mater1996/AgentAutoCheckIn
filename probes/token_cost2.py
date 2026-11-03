"""实测2：截图成本、手势、watcher、UI diff。"""
import sys, time, json, re, os
sys.path.insert(0,"/Users/mater/Project/checkin-platform/runner")
import uiautomator2 as u2

d = u2.connect("3d8a7934")
res = {}

# 1. 截图体积（→ vision token 成本）
d.screenshot("/tmp/tt.png")
sz = os.path.getsize("/tmp/tt.png")
res["screenshot"] = {"png_bytes": sz, "note": "1080x2400，vision 会缩放后计 token"}

# 2. 压缩截图（降分辨率）对体积的影响
try:
    import subprocess
    subprocess.run(["sips","-Z","800","/tmp/tt.png","--out","/tmp/tt800.jpg","-s","format","jpeg"],capture_output=True)
    res["screenshot_800_jpeg"] = {"bytes": os.path.getsize("/tmp/tt800.jpg")}
except Exception as e:
    res["screenshot_800_jpeg"] = {"error": str(e)[:50]}

# 3. 长按实测（签到常见：长按领奖）
try:
    x1,y1 = 540, 900
    t0=time.time(); d.long_click(x1,y1,0.8); dt=time.time()-t0
    res["long_click"] = {"ok": True, "sec": round(dt,2)}
except Exception as e:
    res["long_click"] = {"err": str(e)[:70]}

# 4. 滑动实测（签到常见：滑到任务区）
try:
    t0=time.time(); d.swipe(540, 1800, 540, 800, 0.4); dt=time.time()-t0
    res["swipe"] = {"ok": True, "sec": round(dt,2)}
except Exception as e:
    res["swipe"] = {"err": str(e)[:70]}

# 5. watcher：设备端自动点掉弹窗（不需要 LLM）
try:
    d.watcher.when("跳过").click()
    d.watcher.when("以后再说").click()
    d.watcher.start(interval=2.0)
    time.sleep(3)
    res["watcher"] = {"registered": True, "triggered": getattr(d.watcher, "triggered", "n/a")}
    d.watcher.stop()
except Exception as e:
    res["watcher"] = {"err": str(e)[:70]}

# 6. UI 变化检测：两次 dump 的 text 集合 diff 有多小
def tset():
    x = d.dump_hierarchy()
    return set(re.findall(r'text="([^"]{1,40})"', x))
a = tset(); time.sleep(1.5); b = tset()
res["ui_diff"] = {"before": len(a), "after": len(b),
                  "added": sorted(b-a)[:6], "removed": sorted(a-b)[:6],
                  "diff_chars": len(json.dumps({"add":sorted(b-a),"del":sorted(a-b)},ensure_ascii=False))}

# 7. 服务端 xpath 批量求值（一次拿多个候选，避免多次往返）
try:
    t0=time.time()
    out = d.xpath('//*[@clickable="true"]').all()
    res["xpath_all_clickable"] = {"count": len(out), "sec": round(time.time()-t0,2)}
except Exception as e:
    res["xpath_all_clickable"] = {"err": str(e)[:70]}

print(json.dumps(res, ensure_ascii=False, indent=2))
json.dump(res, open("/Users/mater/Project/checkin-platform/probes/token_cost2.json","w"), ensure_ascii=False, indent=2)
