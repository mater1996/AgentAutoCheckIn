"""实测2：小米手机分身(XSpace) 里能否独立装 App 并跑自动化。"""
import subprocess, json
def sh(c): 
    r=subprocess.run(c, shell=True, capture_output=True, text=True)
    return (r.stdout+r.stderr).strip()

res={}
# 分身用户 999 里已装了哪些包（能独立登录不同账号）
res["user999_taobao"] = sh("adb shell pm list packages --user 999 | grep -E 'taobao|jingdong|meituan|xingin' ")
res["user999_count"] = sh("adb shell pm list packages --user 999 | wc -l")
# 分身里启动 App 的正确方式：先切用户
res["switch_user_cmd"] = sh("adb shell am switch-user 999 2>&1 | head -3")
res["current_after"] = sh("adb shell am get-current-user")
# 切回来后前台包
res["fg_after_switch"] = sh("adb shell dumpsys window | grep -m1 mCurrentFocus")
# 切回主用户
sh("adb shell am switch-user 0")
res["current_back"] = sh("adb shell am get-current-user")
print(json.dumps(res, ensure_ascii=False, indent=2))
