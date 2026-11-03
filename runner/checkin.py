#!/usr/bin/env python3
"""签到执行器（Tier-1：确定性回放 + 验证）。

设计要点：
- 任务用 YAML 声明（入口关键词、验证规则、时间窗），改签到活动只改 YAML，不改代码
- 每个 App 跑一条「配方」(recipe)：一串语义化步骤，按文本/描述定位，不写死坐标
- 每步都验证；配方失效就返回 FAILED，交给 Tier-2（Hermes agent）现场看屏幕处理
- 全程留证：截图 + 界面文本 + 结果写入 ledger

CLI:
  python checkin.py discover <app>      # 探路：打开 App，扫描签到/任务入口，打印发现
  python checkin.py run <app>           # 按配方执行一次
  python checkin.py runall              # 跑当天所有到期任务
"""
import os
import re
import sys
import json
import time
import random
import datetime as dt

import yaml
import uiautomator2 as u2

ROOT = os.path.dirname(os.path.abspath(__file__))
TASKS = os.path.join(ROOT, "tasks")
RECIPES = os.path.join(ROOT, "recipes")
LEDGER = os.path.join(ROOT, "ledger")
EVIDENCE = os.path.join(ROOT, "evidence")
for p in (RECIPES, LEDGER, EVIDENCE):
    os.makedirs(p, exist_ok=True)

SERIAL = os.environ.get("CHECKIN_SERIAL", "3d8a7934")

# 通用弹窗/广告关闭词：出现即点，避免挡路
NOISE = ["跳过", "关闭", "以后再说", "我知道了", "暂不", "取消", "不再提醒",
         "允许", "始终允许", "同意并继续", "稍后", "下次再说", "拒绝"]

# 登录墙特征词：命中即判定需要人工登录，绝不能当成「没找到签到入口」
LOGIN_HINTS = ["登录", "注册", "验证码登录", "一键登录", "账号下线",
               "重新登录", "密码登录", "手机号登录", "其他登录方式",
               "我已阅读并同意"]


def connect():
    d = u2.connect(SERIAL)
    return d


def wake(d):
    """唤醒 + 解锁 + 收起通知栏。实测小米需 svc power stayon 才不自动熄屏。"""
    d.shell("svc power stayon true")
    for _ in range(4):
        d.shell("input keyevent KEYCODE_WAKEUP")
        time.sleep(0.8)
        d.shell("wm dismiss-keyguard")
        d.shell("cmd statusbar collapse")
        time.sleep(0.6)
        if d.info.get("screenOn"):
            return True
    return bool(d.info.get("screenOn"))


def ensure_foreground(d, pkg, tries=3):
    """确保 dump 抓到的是 App 而不是通知栏/锁屏。

    实测坑：App 打开后通知栏可能盖在上面，dump_hierarchy 会返回 systemui
    的节点树，看起来像「App 没有控件」。这里先收通知栏再校验包名。
    """
    for _ in range(tries):
        d.shell("cmd statusbar collapse")
        time.sleep(0.6)
        cur = d.info.get("currentPackageName", "")
        if cur == pkg:
            return True
    return d.info.get("currentPackageName", "") == pkg


def texts(d):
    """当前界面所有 text + content-desc，去空去重保序。"""
    # 实测坑：熄屏时 dump_hierarchy 返回空树（只有 systemui 骨架），
    # 会被误判成「App 没有控件」。每次 dump 前先确认屏幕亮着。
    if not d.info.get("screenOn"):
        d.shell("input keyevent KEYCODE_WAKEUP")
        time.sleep(0.8)
    x = d.dump_hierarchy()
    out = []
    for m in re.finditer(r'(?:text|content-desc)="([^"]{1,40})"', x):
        t = m.group(1).strip()
        if t and t not in out:
            out.append(t)
    return out, x


def tap_text(d, needle, exact=False, timeout=3.0):
    """按文本点击，返回是否点到。优先 text，其次 content-desc。"""
    end = time.time() + timeout
    while time.time() < end:
        for sel in (d(text=needle) if exact else d(textContains=needle),
                    d(descriptionContains=needle)):
            try:
                if sel.exists:
                    sel.click()
                    return True
            except Exception:
                pass
        time.sleep(0.4)
    return False


def dismiss_noise(d, rounds=3):
    """点掉挡住界面的弹窗。返回点掉的文本列表。"""
    hit = []
    for _ in range(rounds):
        found = False
        for w in NOISE:
            if tap_text(d, w, timeout=0.35):
                hit.append(w)
                found = True
                time.sleep(0.6)
                break
        if not found:
            break
    return hit


def open_app(d, pkg, wait=4.0):
    """启动 App 并确认它真的在前台。

    实测坑（踩过两次）：
    1. 别的 App 留着模态弹窗时 app_start 会静默失败，前台仍是旧 App。
    2. 目标 App 有透明 Activity（美团 YodaRouterTransparentActivity、
       小红书授权页）时，currentPackageName 会短暂报成旧 App。
    所以这里 force-stop 后重试启动，直到前台包名稳定等于目标包。
    """
    last = ""
    for attempt in range(3):
        if attempt == 0:
            d.app_stop(pkg)
            time.sleep(0.8)
        d.shell("cmd statusbar collapse")
        d.app_start(pkg, wait=False)
        time.sleep(wait)
        dismiss_noise(d, rounds=1)
        # 连续两次采样一致才算稳定，避开透明 Activity 的瞬时抖动
        a = d.info.get("currentPackageName", "")
        time.sleep(1.2)
        b = d.info.get("currentPackageName", "")
        last = b
        if a == pkg and b == pkg:
            return pkg
    return last


def snap(d, tag):
    path = os.path.join(EVIDENCE, f"{dt.date.today()}-{tag}.png")
    try:
        d.screenshot(path)
    except Exception:
        path = None
    return path


# ---------- 配方 ----------

def recipe_path(app):
    return os.path.join(RECIPES, f"{app}.json")


def load_recipe(app):
    p = recipe_path(app)
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return None


def save_recipe(app, steps, note=""):
    json.dump({"app": app, "updated": dt.datetime.now().isoformat(timespec="seconds"),
               "note": note, "steps": steps},
              open(recipe_path(app), "w", encoding="utf-8"), ensure_ascii=False, indent=2)


def load_task(app):
    p = os.path.join(TASKS, f"{app}.yaml")
    if not os.path.exists(p):
        return None
    return yaml.safe_load(open(p, encoding="utf-8"))


def all_tasks():
    out = []
    for f in sorted(os.listdir(TASKS)):
        if f.endswith(".yaml"):
            out.append(yaml.safe_load(open(os.path.join(TASKS, f), encoding="utf-8")))
    return out


# ---------- ledger ----------

def ledger_path():
    return os.path.join(LEDGER, f"{dt.date.today()}.json")


def ledger_load():
    p = ledger_path()
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def ledger_set(app, **kw):
    data = ledger_load()
    rec = data.get(app, {})
    rec.update(kw)
    rec["at"] = dt.datetime.now().strftime("%H:%M:%S")
    data[app] = rec
    json.dump(data, open(ledger_path(), "w", encoding="utf-8"), ensure_ascii=False, indent=2)


# ---------- 执行 ----------

def run_steps(d, app, steps):
    """按配方执行。每步：tap 文本 / wait / verify 关键词。返回 (ok, log)。"""
    log = []
    for i, st in enumerate(steps, 1):
        kind = st.get("do")
        if kind == "tap":
            ok = tap_text(d, st["text"], exact=st.get("exact", False), timeout=st.get("timeout", 4))
            log.append(f"{i}. tap '{st['text']}' -> {ok}")
            if not ok:
                return False, log
            time.sleep(st.get("after", 1.2))
        elif kind == "wait":
            time.sleep(st.get("sec", 1.0))
            log.append(f"{i}. wait {st.get('sec',1.0)}s")
        elif kind == "verify":
            ts, _ = texts(d)
            need = st.get("any", [])
            hit = [k for k in need if any(k in t for t in ts)]
            ok = bool(hit)
            log.append(f"{i}. verify {need} -> {ok} {hit}")
            if not ok:
                return False, log
    return True, log


def run_app(app, force_recipe=False):
    task = load_task(app)
    if not task:
        return {"app": app, "status": "NO_TASK"}
    d = connect()
    wake(d)
    pkg = task["package"]
    res = {"app": app, "pkg": pkg, "date": str(dt.date.today())}

    cur = open_app(d, pkg, wait=task.get("launch_wait", 4.0))
    res["opened"] = cur
    if cur != pkg:
        res["status"] = "LAUNCH_FAILED"
        res["evidence"] = snap(d, f"{app}-launch")
        ledger_set(app, status="LAUNCH_FAILED", evidence=res["evidence"])
        return res

    # 登录墙是第一瓶颈，比活动改版更常见。先判这个，别把登录页当成「没找到签到入口」。
    ts0, _ = texts(d)
    act = d.app_current().get("activity", "")
    wall_hits = [h for h in LOGIN_HINTS
                 if h in act or any(h in t for t in ts0)]
    if wall_hits or "login" in act.lower():
        res["status"] = "NEEDS_LOGIN"
        res["wall_hits"] = wall_hits
        res["screen"] = ts0[:30]
        res["evidence"] = snap(d, f"{app}-login")
        ledger_set(app, status="NEEDS_LOGIN", evidence=res["evidence"],
                   wall_hits=wall_hits)
        return res

    rec = None if force_recipe else load_recipe(app)
    if rec:
        ok, log = run_steps(d, app, rec["steps"])
        res["recipe"] = log
        if ok:
            res["status"] = "OK_RECIPE"
            res["evidence"] = snap(d, f"{app}-ok")
            ledger_set(app, status="OK_RECIPE", evidence=res["evidence"])
            return res
        res["recipe_failed"] = True

    # 配方缺失或失效 -> 交给 Tier-2。这里只做一次「看见什么」的采样
    ts, x = texts(d)
    res["status"] = "NEEDS_AGENT"
    res["screen"] = ts[:40]
    res["evidence"] = snap(d, f"{app}-agent")
    ledger_set(app, status="NEEDS_AGENT", evidence=res["evidence"], screen=ts[:40])
    return res


def discover(app):
    """探路：打开 App，扫全屏关键词，报告有没有签到入口。不点、不猜。"""
    task = load_task(app)
    if not task:
        return {"app": app, "status": "NO_TASK"}
    d = connect()
    wake(d)
    pkg = task["package"]
    cur = open_app(d, pkg, wait=task.get("launch_wait", 4.0))
    ts, x = texts(d)
    kw = ["签到", "打卡", "任务中心", "领奖", "领取", "金币", "积分", "福利", "签到有礼", "每日"]
    hits = [t for t in ts if any(k in t for k in kw)]
    res = {"app": app, "pkg": pkg, "opened": cur, "nodes": x.count("<node"),
           "texts_total": len(ts), "texts": ts[:50], "checkin_hits": hits,
           "evidence": snap(d, f"{app}-discover")}
    return res


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "discover":
        print(json.dumps(discover(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "run":
        print(json.dumps(run_app(sys.argv[2], force_recipe="--force" in sys.argv),
                         ensure_ascii=False, indent=2))
    elif cmd == "runall":
        out = []
        for t in all_tasks():
            out.append(run_app(t["app"]))
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif cmd == "ledger":
        print(json.dumps(ledger_load(), ensure_ascii=False, indent=2))
    else:
        print(__doc__)
        return 1
    return 0


def in_window(task):
    """判断当前是否落在任务的允许时间窗内（如 09:00-21:00）。"""
    w = task.get("window")
    if not w or "-" not in w:
        return True
    a, b = [s.strip() for s in w.split("-")]
    now = dt.datetime.now().strftime("%H:%M")
    return a <= now <= b


def doctor():
    """体检：逐个检查 App 的登录态。这是每日签到真正的瓶颈。"""
    out = []
    d = connect()
    wake(d)
    for t in all_tasks():
        app, pkg = t["app"], t["package"]
        row = {"app": app, "name": t.get("name", app)}
        try:
            cur = open_app(d, pkg, wait=t.get("launch_wait", 6.0))
            ts, x = texts(d)
            act = d.app_current().get("activity", "")
            hits = [h for h in LOGIN_HINTS if h in act or any(h in t2 for t2 in ts)]
            row.update({"foreground": cur, "activity": act,
                        "nodes": x.count("<node"),
                        "logged_in": not hits and "login" not in act.lower(),
                        "login_hits": hits})
        except Exception as e:
            row.update({"error": str(e)[:80]})
        out.append(row)
        print(f"{app:15s} logged_in={row.get('logged_in')} "
              f"act={str(row.get('activity'))[-40:]}")
    json.dump(out, open(os.path.join(EVIDENCE, f"{dt.date.today()}-doctor.json"), "w"),
              ensure_ascii=False, indent=2)
    return out


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    cmd = sys.argv[1]
    if cmd == "discover":
        print(json.dumps(discover(sys.argv[2]), ensure_ascii=False, indent=2))
    elif cmd == "run":
        print(json.dumps(run_app(sys.argv[2], force_recipe="--force" in sys.argv),
                         ensure_ascii=False, indent=2))
    elif cmd == "runall":
        out = [run_app(t["app"]) for t in all_tasks() if in_window(t)]
        print(json.dumps(out, ensure_ascii=False, indent=2))
    elif cmd == "doctor":
        doctor()
    elif cmd == "ledger":
        print(json.dumps(ledger_load(), ensure_ascii=False, indent=2))
    else:
        print(__doc__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
# 登录墙特征词：命中即判定需要人工登录，绝不能当成「没找到签到入口」
LOGIN_HINTS = ["登录", "注册", "验证码登录", "一键登录", "账号下线",
               "重新登录", "密码登录", "手机号登录", "其他登录方式",
               "我已阅读并同意"]


def current_activity(d, pkg):
    """取当前 Activity，但只认属于目标包名的。

    实测坑：d.app_current() 会返回残留任务的 Activity（前台是淘宝，
    却报出 com.meituan...YodaRouterTransparentActivity），
    拿它判登录墙会误判。这里直接读窗口焦点，并校验包名前缀。
    """
    try:
        out = d.shell("dumpsys window | grep -m1 mCurrentFocus").output or ""
        m = re.search(r"([\w.]+)/([\w.$]+)", out)
        if m and m.group(1).startswith(pkg):
            return f"{m.group(1)}/{m.group(2)}"
    except Exception:
        pass
    cur = d.info.get("currentPackageName", "")
    return cur if cur == pkg else ""


def detect_login_wall(d, pkg):
    """判定是否停在登录墙。返回 (是否, 命中词)。

    两类故障要分开：
    - 未登录：停在 LoginActivity / 有"验证码登录"等
    - 被挤下线：信息流还在，但有"账号下线通知""重新登录"模态框
    后者不处理会挡死后续所有点击，必须优先识别。
    """
    ts, _ = texts(d)
    act = current_activity(d, pkg)
    hits = []
    if "login" in act.lower():
        hits.append("activity:" + act.split("/")[-1][:24])
    for h in LOGIN_HINTS:
        if any(h in t for t in ts):
            hits.append(h)
    return bool(hits), hits
