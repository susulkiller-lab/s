"""app/deunggi/template.html에 판독 엔진·예시·한글 CMap을 넣어 app/deunggi/deunggi.html을 만든다.

사용법: python3 app/deunggi/build.py
engine.js·template.html·samples.json을 고친 뒤 다시 실행하고, 결과 파일을 아티팩트로 재게시한다.
samples.json은 test/make_samples.js로 test/fixtures(가상 등기부)에서 다시 만든다.
"""
import base64
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
tpl = (HERE / "template.html").read_text(encoding="utf-8")
engine = (HERE / "engine.js").read_text(encoding="utf-8")
samples = (HERE / "samples.json").read_text(encoding="utf-8")
cmaps = {p.stem: base64.b64encode(p.read_bytes()).decode() for p in sorted((HERE / "cmaps").glob("*.bcmap"))}

def safe(s):
    return s.replace("</", "<\\/")

out = (tpl.replace("__ENGINE__", safe(engine))
          .replace("__SAMPLES__", safe(samples))
          .replace("__CMAPS__", json.dumps(cmaps)))
(HERE / "deunggi.html").write_text(out, encoding="utf-8")
print(f"app/deunggi/deunggi.html ({len(out.encode()):,} bytes, CMap {len(cmaps)}개)")
