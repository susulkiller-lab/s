"""template.html에 checks.js를 넣어 jaegagong.html(게시용 단일 파일)을 만들고, 설치 키트에 복사해 다시 압축한다.

사용법: python3 app/case/build.py
"""
import shutil
import zipfile
from pathlib import Path

D = Path(__file__).resolve().parent
KIT = D.parent.parent / "kit" / "jaegagong-kit"
html = (D / "template.html").read_text(encoding="utf-8").replace("/*__CHECKS__*/", (D / "checks.js").read_text(encoding="utf-8"))
(D / "jaegagong.html").write_text(html, encoding="utf-8")
print(f"app/case/jaegagong.html ({len(html.encode()):,} bytes)")

shutil.copyfile(D / "jaegagong.html", KIT / "jaegagong.html")
with zipfile.ZipFile(KIT.parent / "jaegagong-kit.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(KIT.iterdir()):
        if f.name != "설정.json":  # 사무소 설정은 키트 배포본에 넣지 않는다(필요한 사람에게 따로 전달)
            z.write(f, f"{KIT.name}/{f.name}")
print(f"kit/jaegagong-kit.zip 갱신")
