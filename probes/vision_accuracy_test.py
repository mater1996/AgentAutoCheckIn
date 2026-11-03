#!/usr/bin/env python3
"""用压缩后的小图测 codex 的定位精度与延迟（模拟 Midscene 实际送图大小）。"""
import base64
import json
import pathlib
import time
import urllib.request

BASE = "http://127.0.0.1:3425/v1"
KEY = "magpie"
IMG = pathlib.Path("/Users/mater/Project/checkin-platform/probes/taobao-800.jpg")

b64 = base64.b64encode(IMG.read_bytes()).decode()

CASES = [
    ("红包签到", 0.117, 0.254),
    ("我的淘宝", 0.907, 0.928),
    ("领淘金币", 0.546, 0.254),
    ("芭芭农场", 0.257, 0.254),
]

PROMPT = (
    "这是中国电商 App 淘宝的首页截图。请定位页面上文字为「{label}」的图标/按钮，"
    "返回其可点击区域的中心点。坐标用归一化值（0~1，相对整张图宽高）。"
    '只输出 JSON：{{"found":true/false,"x":0.00,"y":0.00}}'
)


def call(model, label, timeout=120):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT.format(label=label)},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        "temperature": 0,
        "max_tokens": 400,
    }
    req = urllib.request.Request(
        f"{BASE}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
        dt = time.time() - t0
        txt = (d["choices"][0]["message"].get("content") or "").strip()
        return dt, txt, d.get("usage", {})
    except Exception as e:
        return time.time() - t0, f"ERR {type(e).__name__}: {e}", {}


MODEL = "codex/gpt-6.1-sol"
print(f"image {IMG.name} {IMG.stat().st_size/1024:.0f}KB  model {MODEL}\n")
for label, tx, ty in CASES:
    dt, txt, usage = call(MODEL, label)
    try:
        s = txt[txt.index("{"): txt.rindex("}") + 1]
        d = json.loads(s)
        x, y = float(d.get("x", -1)), float(d.get("y", -1))
        dist = ((x - tx) ** 2 + (y - ty) ** 2) ** 0.5
        verdict = "✅" if dist < 0.05 else ("△" if dist < 0.10 else "❌")
        print(f"{verdict} {label:6s}  got=({x:.3f},{y:.3f})  truth=({tx:.3f},{ty:.3f})  dist={dist:.3f}  {dt:.1f}s  tok={usage.get('prompt_tokens')}")
    except Exception:
        print(f"?? {label:6s}  {dt:.1f}s  无法解析: {txt[:120]}")
