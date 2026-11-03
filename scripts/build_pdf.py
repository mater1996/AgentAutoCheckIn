#!/usr/bin/env python3
"""把 最终技术方案.md 转成适合打印/手机阅读的 HTML，再用 Chrome 打成 PDF。"""
import pathlib
import re
import subprocess
import sys

import markdown

ROOT = pathlib.Path("/Users/mater/Project/checkin-platform")
SRC = ROOT / "docs" / "最终技术方案.md"
HTML = ROOT / "docs" / "最终技术方案.html"
PDF = ROOT / "docs" / "手机签到平台-技术方案v1.1.pdf"

md_text = SRC.read_text(encoding="utf-8")

body = markdown.markdown(
    md_text,
    extensions=["tables", "fenced_code", "sane_lists", "nl2br"],
    output_format="html5",
)

# markdown 的 nl2br 会让表格单元格里的换行变 <br>，这里不动它，只清理多余空段
body = re.sub(r"<p>\s*</p>", "", body)

CSS = """
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body {
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 10.5pt; line-height: 1.72; color: #1a1a1a;
  max-width: 100%; margin: 0;
}
h1 {
  font-size: 21pt; margin: 0 0 6pt; padding-bottom: 8pt;
  border-bottom: 3px solid #111; letter-spacing: -0.3pt;
}
h2 {
  font-size: 14pt; margin: 22pt 0 8pt; padding-left: 9pt;
  border-left: 4px solid #2b6cb0; page-break-after: avoid;
}
h3 {
  font-size: 11.5pt; margin: 15pt 0 6pt; color: #2b4a6f;
  page-break-after: avoid;
}
p { margin: 5pt 0; }
ul, ol { margin: 5pt 0; padding-left: 20pt; }
li { margin: 2.5pt 0; }
strong { color: #000; font-weight: 600; }
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 9pt; background: #f2f4f7; padding: 1pt 3.5pt;
  border-radius: 3pt; color: #b03060;
}
pre {
  background: #f7f8fa; border: 1px solid #e2e5ea; border-radius: 4pt;
  padding: 8pt 10pt; overflow-x: auto; page-break-inside: avoid;
  margin: 7pt 0;
}
pre code {
  background: none; padding: 0; color: #1f2933; font-size: 8.6pt;
  line-height: 1.5; white-space: pre-wrap; word-break: break-all;
}
table {
  border-collapse: collapse; width: 100%; margin: 8pt 0;
  font-size: 9.2pt; page-break-inside: avoid;
}
th {
  background: #eef2f7; font-weight: 600; text-align: left;
  border: 1px solid #ccd3dd; padding: 5pt 7pt;
}
td { border: 1px solid #dfe3e9; padding: 5pt 7pt; vertical-align: top; }
tr:nth-child(even) td { background: #fafbfc; }
hr { border: none; border-top: 1px solid #e5e7eb; margin: 16pt 0; }
blockquote {
  margin: 7pt 0; padding: 6pt 11pt; background: #fffbe6;
  border-left: 3px solid #e0b400; color: #5c4a00;
}
"""

html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>手机每日签到平台 · 技术方案 v1.1</title>
<style>{CSS}</style></head>
<body>{body}</body></html>
"""

HTML.write_text(html, encoding="utf-8")
print(f"HTML: {HTML} ({len(html)} bytes)")

chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
cmd = [
    chrome,
    "--headless",
    "--disable-gpu",
    "--no-pdf-header-footer",
    "--no-sandbox",
    f"--print-to-pdf={PDF}",
    HTML.as_uri(),
]
r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
print("chrome exit:", r.returncode)
if r.stderr.strip():
    print(r.stderr.strip()[:600])

if PDF.exists():
    print(f"PDF OK: {PDF} ({PDF.stat().st_size} bytes)")
else:
    print("PDF FAILED")
    sys.exit(1)
