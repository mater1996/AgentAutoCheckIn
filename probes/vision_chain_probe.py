#!/usr/bin/env python3
"""探测备选通道：能否接受图片 + 定位是否可用（单一小图，成本低）。"""
import base64
import json
import pathlib
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:3425/v1"
KEY = "magpie"
IMG = pathlib.Path("/Users/mater/Project/checkin-platform/probes/taobao-800.jpg")
b64 = base64.b64encode(IMG.read_bytes()).decode()

PROMPT = (
    "这是中国电商 App 淘宝的首页截图。请定位文字为「红包签到」的图标，"
    "返回其中心点归一化坐标（0~1，相对整张图宽高）。"
    '只输出 JSON：{"found":true,"x":0.00,"y":0.00}'
)
TRUTH = (0.117, 0.254)


def call(model, timeout=90):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
        "temperature": 0,
        "max_tokens": 300,
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
        return time.time() - t0, (d["choices"][0]["message"].get("content") or ""), d.get("usage", {}), None
    except urllib.error.HTTPError as e:
        return time.time() - t0, "", {}, f"HTTP {e.code}: {e.read().decode(errors='replace')[:160]}"
    except Exception as e:
        return time.time() - t0, "", {}, f"{type(e).__name__}: {e}"


for m in sys.argv[1:] or ["auto/GLM-5.2", "zhipu/glm-5", "zhipu/glm-4.7"]:
    dt, txt, usage, err = call(m)
    if err:
        print(f"[{m}] ❌ {dt:.1f}s  {err}")
        continue
    try:
        s = txt[txt.index("{"): txt.rindex("}") + 1]
        d = json.loads(s)
        x, y = float(d.get("x", -1)), float(d.get("y", -1))
        dist = ((x - TRUTH[0]) ** 2 + (y - TRUTH[1]) ** 2) ** 0.5
        verdict = "✅" if dist < 0.05 else ("△" if dist < 0.10 else "❌")
        ptok = usage.get("prompt_tokens") or 0
        # 关键校验：带图请求的 prompt_tokens 应在数千级。几百 = 图片被静默丢弃，
        # 模型其实是"凭空猜"坐标，给出了看似合理的错答案。
        warn = "  ⚠️ 图片可能未被处理（prompt_tokens 过低，坐标是猜的）" if ptok < 1000 else ""
        print(f"[{m}] {verdict} {dt:.1f}s  got=({x:.3f},{y:.3f}) truth={TRUTH} dist={dist:.3f}  tok={ptok}{warn}")
    except Exception:
        print(f"[{m}] ?? {dt:.1f}s 无法解析: {txt[:140]}")
