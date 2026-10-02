"""src/template.html에 CSS, DOCX 라이브러리, 기관 데이터, 앱 코드를 넣어 dist/ 산출물을 만든다.

사용법: python3 finorder/build.py
- dist/finorder.html            아티팩트 게시용 조각(doctype·head·body 없음)
- dist/finorder.standalone.html 로컬 시험용(doctype 포함)
기관 데이터는 data/institutions.json을 쓴다. 없으면 빈 목록으로 만든다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"


def read(p: Path, default: str = "") -> str:
    return p.read_text(encoding="utf-8") if p.exists() else default


def main() -> int:
    tpl = read(SRC / "template.html")
    if not tpl:
        print("src/template.html이 없습니다", file=sys.stderr)
        return 1
    for mark in ("/*__CSS__*/", "/*__DOCX__*/", "/*__DATA__*/", "/*__APP__*/"):
        if tpl.count(mark) != 1:
            print(f"template.html에 {mark} 자리표시가 정확히 한 번 있어야 합니다(현재 {tpl.count(mark)}회)", file=sys.stderr)
            return 1

    css = re.sub(r"</style", r"<\\/style", read(SRC / "style.css"), flags=re.I)
    docx = re.sub(r"</script", r"<\\/script", read(ROOT / "vendor" / "docx-8.5.0.iife.js"), flags=re.I)
    # 라이브러리 안의 대체 문자(U+FFFD) 리터럴은 문자열 안에서만 쓰이므로 같은 뜻의 이스케이프로 바꾼다(게시 검사 통과용)
    docx = docx.replace("\ufffd", "\\ufffd")
    app = re.sub(r"</script", r"<\\/script", read(SRC / "app.js"), flags=re.I)

    data_path = ROOT / "data" / "institutions.json"
    if data_path.exists():
        data = json.loads(data_path.read_text(encoding="utf-8"))
    else:
        data = {"schema": 1, "asOf": "", "categories": [], "institutions": []}
        print("경고: data/institutions.json이 없어 빈 목록으로 빌드합니다", file=sys.stderr)
    data_js = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")

    out = tpl
    for mark, val in (("/*__CSS__*/", css), ("/*__DOCX__*/", docx), ("/*__DATA__*/", data_js), ("/*__APP__*/", app)):
        out = out.replace(mark, val)

    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    (dist / "finorder.html").write_text(out, encoding="utf-8")
    standalone = (
        '<!doctype html><html lang="ko"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
        + out
        + "</body></html>"
    )
    (dist / "finorder.standalone.html").write_text(standalone, encoding="utf-8")
    n = len(data.get("institutions", []))
    print(f"dist/finorder.html ({len(out.encode()):,} bytes, 기관 {n}곳)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
