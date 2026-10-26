"""template.html에 checks.js를 넣어 jaegagong.html(게시용 단일 파일)을 만든다. 사용법: python3 app/case/build.py"""
from pathlib import Path

D = Path(__file__).resolve().parent
html = (D / "template.html").read_text(encoding="utf-8").replace("/*__CHECKS__*/", (D / "checks.js").read_text(encoding="utf-8"))
(D / "jaegagong.html").write_text(html, encoding="utf-8")
print(f"app/case/jaegagong.html ({len(html.encode()):,} bytes)")
