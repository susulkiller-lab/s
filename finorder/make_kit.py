"""직원 배포용 설치 키트(kit/finorder-kit, kit/finorder-kit.zip)를 만든다.

사용법: python3 finorder/make_kit.py [--verify]
1) build.py로 dist/를 만들고
2) kit_src/(CLAUDE.md, 설치안내.txt, 사용설명서.docx, source_README.md)와 dist/finorder.kit.html, 원본을 모아 kit/finorder-kit/을 다시 만든 뒤
3) kit/finorder-kit.zip으로 묶는다.
--verify: 압축을 풀어 source에서 다시 빌드한 결과가 키트의 finorder.html과 같은지, 금지어가 없는지 확인한다.

사용설명서.docx는 kit_src/make_manual.js로 만든다:
  NODE_PATH=<docx가 설치된 node_modules> node finorder/kit_src/make_manual.js finorder/kit_src/사용설명서.docx
"""
import hashlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent            # finorder/
KIT_DIR = ROOT.parent / "kit" / "finorder-kit"
KIT_ZIP = ROOT.parent / "kit" / "finorder-kit.zip"
KS = ROOT / "kit_src"

# 키트에 넣는 원본(관리자용). 조사 원자료와 merge_data.py는 넣지 않는다.
SOURCE_FILES = [
    "SPEC.md", "build.py",
    "src/template.html", "src/style.css", "src/app.js",
    "data/institutions.json", "data/raw/user_list.json",
    "vendor/docx-8.5.0.iife.js",
]
TEST_GLOBS = ["*.js", "*.py", "*.sh", ".gitignore"]
FORBIDDEN = ["진앤솔", "강정한", "박재은", "930305", "/home/user", "/tmp/claude"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def build_kit() -> None:
    subprocess.run([sys.executable, str(ROOT / "build.py")], check=True)
    manual = KS / "사용설명서.docx"
    if not manual.exists():
        sys.exit("kit_src/사용설명서.docx가 없습니다. make_manual.js로 먼저 만드십시오.")

    if KIT_DIR.exists():
        shutil.rmtree(KIT_DIR)
    (KIT_DIR / "source").mkdir(parents=True)

    shutil.copy2(KS / "CLAUDE.md", KIT_DIR / "CLAUDE.md")
    shutil.copy2(KS / "설치안내.txt", KIT_DIR / "설치안내.txt")
    shutil.copy2(manual, KIT_DIR / "사용설명서.docx")
    shutil.copy2(ROOT / "dist" / "finorder.kit.html", KIT_DIR / "finorder.html")

    src = KIT_DIR / "source"
    shutil.copy2(KS / "source_README.md", src / "README.md")
    for rel in SOURCE_FILES:
        dst = src / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dst)
    (src / "tests").mkdir(exist_ok=True)
    for g in TEST_GLOBS:
        for f in sorted((ROOT / "tests").glob(g)):
            if f.is_file():
                shutil.copy2(f, src / "tests" / f.name)

    if KIT_ZIP.exists():
        KIT_ZIP.unlink()
    with zipfile.ZipFile(KIT_ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(KIT_DIR.rglob("*")):
            if f.is_file():
                z.write(f, Path("finorder-kit") / f.relative_to(KIT_DIR))
    files = sorted(p for p in KIT_DIR.rglob("*") if p.is_file())
    total = sum(p.stat().st_size for p in files)
    print(f"kit/finorder-kit/ ({len(files)}개 파일, {total:,} bytes)")
    print(f"kit/finorder-kit.zip ({KIT_ZIP.stat().st_size:,} bytes)")
    print(f"finorder.html {(KIT_DIR / 'finorder.html').stat().st_size:,} bytes, sha256 {sha(KIT_DIR / 'finorder.html')[:16]}")


def verify() -> int:
    errors = []
    with tempfile.TemporaryDirectory() as td:
        with zipfile.ZipFile(KIT_ZIP) as z:
            z.extractall(td)
        kit = Path(td) / "finorder-kit"
        # 필수 파일
        for rel in ["CLAUDE.md", "설치안내.txt", "사용설명서.docx", "finorder.html", "source/README.md", "source/build.py", "source/src/app.js"]:
            if not (kit / rel).exists():
                errors.append(f"필수 파일 없음: {rel}")
        # 금지어(텍스트 파일만)
        for f in kit.rglob("*"):
            if not f.is_file() or f.suffix in (".docx", ".png"):
                continue
            try:
                t = f.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for w in FORBIDDEN:
                if w in t:
                    errors.append(f"금지어 '{w}' 포함: {f.relative_to(kit)}")
        # 사용설명서에 금지어가 없는지(docx는 XML 안을 본다)
        with zipfile.ZipFile(kit / "사용설명서.docx") as dz:
            x = dz.read("word/document.xml").decode("utf-8")
        for w in FORBIDDEN[:4]:
            if w in x:
                errors.append(f"사용설명서.docx에 금지어 '{w}' 포함")
        # finorder.html 형식
        h = (kit / "finorder.html").read_text(encoding="utf-8")
        if not h.lstrip().startswith("<title>"):
            errors.append("finorder.html이 <title>로 시작하지 않음")
        if "�" in h:
            errors.append("finorder.html에 U+FFFD 포함")
        if max(len(l) for l in h.split("\n")) > 2000:
            errors.append("finorder.html에 2000자가 넘는 줄이 있음(Claude Code가 읽다가 잘릴 수 있음)")
        if "docx@" not in h or "/*__" in h:
            errors.append("finorder.html의 라이브러리 로드 또는 자리표시 처리가 이상함")
        # source에서 다시 빌드한 결과가 키트의 finorder.html과 같은가
        subprocess.run([sys.executable, str(kit / "source" / "build.py")], check=True, cwd=kit / "source", stdout=subprocess.DEVNULL)
        rebuilt = kit / "source" / "dist" / "finorder.kit.html"
        if sha(rebuilt) != sha(kit / "finorder.html"):
            errors.append("source에서 다시 빌드한 finorder.kit.html이 키트의 finorder.html과 다름")
        else:
            print("재빌드 일치: source에서 다시 만든 결과가 키트의 finorder.html과 같음")
    if errors:
        for e in errors:
            print("오류:", e)
        return 1
    print("키트 검증 통과")
    return 0


if __name__ == "__main__":
    build_kit()
    sys.exit(verify() if "--verify" in sys.argv else 0)
