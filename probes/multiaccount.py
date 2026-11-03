"""实测：多开账号的三种方式可行性（不改机、不 root）。"""
import sys, json, subprocess
def sh(c): return subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()

res = {}
# 1. 系统分身（小米 XSpace）——实测本机已存在
res["mi_xspace"] = "999" in sh("adb shell pm list users")
res["users"] = sh("adb shell pm list users")
# 2. 应用双开（小米）—— 查 dual app 用户
res["dual_app_hint"] = sh("adb shell pm list packages | grep -iE 'dual|second|clone' | head -5")
# 3. 工作资料 / 多用户能否 adb 切换
res["am_get_current_user"] = sh("adb shell am get-current-user")
# 4. 是否有第三方多开（已知本机包名清单里查）
res["third_party_clone"] = sh("adb shell pm list packages -3 | grep -iE 'parallel|clone|vmos|virtual|island|work' | head -8") or "(none)"
# 5. 应用能否用 --user 启动
res["launch_as_user_test"] = sh("adb shell am start --user 999 -n com.taobao.taobao/.MainFrameActivity 2>&1 | head -3")
print(json.dumps(res, ensure_ascii=False, indent=2))
