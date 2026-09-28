"""app/template.html에 팀 글 코퍼스를 넣어 app/wonkosil.html을 만든다.

사용법: python3 app/build.py
corpus/posts/common/*.md를 고치거나 늘린 뒤 다시 실행하고, 결과 파일을 아티팩트로 재게시한다.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from common import parse_doc  # noqa: E402

corpus = []
for f in sorted((ROOT / "corpus" / "posts" / "common").glob("*.md")):
    raw = f.read_text(encoding="utf-8")
    d = parse_doc(raw)
    body = raw.split("---\n", 2)[2].strip()  # 소제목 '## ' 표시를 살린 본문
    corpus.append({"title": d["title"], "kw": d["meta"].get("main_kw", ""), "text": body})

tpl = (ROOT / "app" / "template.html").read_text(encoding="utf-8")
out = tpl.replace("__CORPUS__", json.dumps(corpus, ensure_ascii=False).replace("</", "<\\/"))
(ROOT / "app" / "wonkosil.html").write_text(out, encoding="utf-8")
print(f"app/wonkosil.html ({len(out.encode()):,} bytes, 팀 글 {len(corpus)}편)")
