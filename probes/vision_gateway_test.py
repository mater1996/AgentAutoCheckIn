#!/usr/bin/env python3
"""测试本地 magpie 网关是否支持视觉输入，以及各模型的 UI 定位能力。"""
import base64
import json
import pathlib
import sys
import time

import urllib.request

BASE = "http://127.0.0.1:3425/v1"
KEY = "magpie"

IMG = pathlib.Path("/Users/mater/Project/checkin-platform/runner/evidence/2026-10-29-taobao-discover.png")
if not IMG.exists():
    print("screenshot missing:", IMG)
    sys.exit(1)

b64 = base64.b64encode(IMG.read_bytes()).decode()
print(f"image: {IMG.name}  {IMG.stat().st_size/1024:.0f} KB  base64 {len(b64)/1024:.0f} KB")

PROMPT = (
    "这是一张 Android 手机截图，分辨率 1242x2688。"
    "请找出底部导航栏中「我的淘宝」这个标签，返回它的中心点坐标。"
    "只输出 JSON：{\"found\":true/false,\"x\":归一化0-1,\"y\":归一化0-1,\"label\":\"看到的文字\"}"
)


def call(model: str, timeout=120):
    body = {
        "model": model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
        }],
        "temperature": 0,
        "max_tokens": 200,
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
        txt = d["choices"][0]["message"].get("content") or ""
        usage = d.get("usage", {})
        return {"ok": True, "s": round(dt, 1), "txt": txt.strip()[:300], "usage": usage}
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        return {"ok": False, "s": round(time.time() - t0, 1), "err": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"ok": False, "s": round(time.time() - t0, 1), "err": f"{type(e).__name__}: {e}"}


models = sys.argv[1:] or ["copilot/claude-fable-5.1", "codex/gpt-6.1-sol", "kimi/k3.1-pro", "auto/GLM-5.2"]
for m in models:
    r = call(m)
    if r["ok"]:
        print(f"\n[{m}] {r['s']}s usage={r['usage']}")
        print("  ", r["txt"].replace("\n", " ")[:280])
    else:
        print(f"\n[{m}] FAILED {r['s']}s  {r['err']}")
