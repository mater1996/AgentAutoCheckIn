#!/usr/bin/env python3
"""对比 gpt-6.1 各档位在真实手机截图上的 UI 定位精度。
真值来自人工读图（1080x2400 淘宝首页）。
"""
import base64
import json
import pathlib
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3425/v1"
KEY = "magpie"
IMG = pathlib.Path("/Users/mater/Project/checkin-platform/probes/taobao-800.jpg")
b64 = base64.b64encode(IMG.read_bytes()).decode()

CASES = [
    ("红包签到", 0.117, 0.254),
    ("我的淘宝", 0.907, 0.928),
    ("领淘金币", 0.546, 0.231),
    ("芭芭农场", 0.257, 0.231),
]
PROMPT = (
    "这是中国电商 App 淘宝的首页截图。请定位文字为「{label}」的图标/按钮，"
    "返回其可点击区域中心点，坐标用归一化值（0~1，相对整张图宽高）。"
    '只输出 JSON：{{"found":true/false,"x":0.00,"y":0.00}}'
)


def call(model, label, timeout=120):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT.format(label=label)},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        "temperature": 0, "max_tokens": 300,
    }
    req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "Authorization": f"Bearer {KEY}"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
        return time.time() - t0, (d["choices"][0]["message"].get("content") or ""), d.get("usage", {}), None
    except urllib.error.HTTPError as e:
        return time.time() - t0, "", {}, f"HTTP {e.code}: {e.read().decode(errors='replace')[:140]}"
    except Exception as e:
        return time.time() - t0, "", {}, f"{type(e).__name__}: {str(e)[:120]}"


models = sys.argv[1:] or ["codex/gpt-6.1-terra", "codex/gpt-6.1-sol"]
for m in models:
    print(f"\n{'='*60}\n{m}")
    dists, toks, lat = [], [], []
    for label, tx, ty in CASES:
        dt, txt, usage, err = call(m, label)
        if err:
            print(f"  ❌ {label:6s} {dt:.1f}s  {err}")
            continue
        try:
            s = txt[txt.index("{"): txt.rindex("}") + 1]
            d = json.loads(s)
            x, y = float(d["x"]), float(d["y"])
            dist = ((x - tx) ** 2 + (y - ty) ** 2) ** 0.5
            dists.append(dist); toks.append(usage.get("prompt_tokens") or 0); lat.append(dt)
            v = "✅" if dist < 0.05 else ("△" if dist < 0.10 else "❌")
            print(f"  {v} {label:6s} got=({x:.3f},{y:.3f}) truth=({tx:.3f},{ty:.3f}) dist={dist:.3f} {dt:.1f}s tok={usage.get('prompt_tokens')}")
        except Exception:
            print(f"  ?? {label:6s} {dt:.1f}s 解析失败: {txt[:100]}")
    if dists:
        print(f"  → 平均偏差 {statistics.mean(dists):.3f}  最大 {max(dists):.3f}  中位延迟 {statistics.median(lat):.1f}s  平均 prompt tok {statistics.mean(toks):.0f}")