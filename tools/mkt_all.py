"""원클릭 측정·리포트. 저장소 맨 위의 '원클릭리포트.bat'을 더블클릭하면 이 파일이 돈다.

순서: 준비(패키지 자동 설치) → 최신 코드 받기 → 검색 수집 → AI 답변 수집(Claude Code + Chrome)
      → 리포트(txt·csv·docx) → 리포트 열기 → 결과 저장소에 올리기
사람 손이 필요한 때: 보안문자가 뜰 때뿐(창에서 풀고 Enter). 그 밖의 실패는 건너뛰고 마지막에 알려준다.

  py tools\\mkt_all.py                # 전체
  py tools\\mkt_all.py --no-ai        # AI 답변 수집 생략
  py tools\\mkt_all.py --skip-collect # 검색 수집 생략(이미 수집한 날 리포트만 다시)
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
AI_PROMPT = (
    "marketing/AI_PROTOCOL.md 절차대로 data/measure/{d}/ai 폴더에 AI 답변을 수집해줘. "
    "엔진은 chatgpt, gemini, perplexity, 질문 전체, 회차 1회. 이미 저장된 파일은 다시 하지 마. "
    "사람에게 묻지 말고 끝까지 진행하고, 막힌 항목은 건너뛰고 마지막에 목록으로 알려줘. "
    "답변 저장 외에 다른 파일은 고치지 마."
)
notes = []


def step(title):
    print(f"\n===== {title} =====", flush=True)


def ensure_packages():
    need = []
    for mod, pkg in (("playwright", "playwright"), ("docx", "python-docx")):
        try:
            __import__(mod)
        except ImportError:
            need.append(pkg)
    if need:
        print("설치:", ", ".join(need))
        subprocess.run([PY, "-m", "pip", "install", "-q", *need], check=False)


def refresh_path():
    """설치 직후 바탕화면 바로가기로 실행하면 새로 깔린 프로그램 경로가 PATH에 없을 수 있다.
    윈도우 레지스트리의 사용자·시스템 PATH를 다시 읽어 붙인다."""
    if os.name != "nt":
        return
    import winreg
    extra = []
    for hive, key in ((winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
                      (winreg.HKEY_CURRENT_USER, r"Environment")):
        try:
            with winreg.OpenKey(hive, key) as k:
                extra.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    os.environ["PATH"] = os.pathsep.join([os.environ.get("PATH", ""), *extra])


def first(*patterns):
    for pat in patterns:
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return None


def find_git():
    home, local = os.path.expanduser("~"), os.environ.get("LOCALAPPDATA", "")
    return shutil.which("git") or first(
        os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "cmd", "git.exe"),
        os.path.join(local, "Programs", "Git", "cmd", "git.exe"),
        os.path.join(local, "GitHubDesktop", "app-*", "resources", "app", "git", "cmd", "git.exe"),
        os.path.join(home, "scoop", "shims", "git.exe"))


def find_claude():
    home = os.path.expanduser("~")
    return shutil.which("claude") or first(
        os.path.join(home, ".local", "bin", "claude.exe"),
        os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd"))


def git(g, *args):
    return subprocess.run([g, *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--skip-collect", action="store_true")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    d = a.date

    step("1/6 준비")
    refresh_path()
    ensure_packages()
    g = find_git()

    step("2/6 최신 코드 받기")
    if g:
        r = git(g, "pull", "--ff-only")
        print(r.stdout.strip() or r.stderr.strip())
        if r.returncode:
            notes.append("최신 코드 받기 실패: GitHub Desktop에서 Pull origin을 눌러 주세요.")
    else:
        notes.append("git이 없어 최신 코드 받기와 결과 올리기를 건너뜀(GitHub Desktop에서 직접).")
        print("git 없음: 건너뜀")

    if not a.skip_collect:
        step("3/6 네이버·플레이스·구글 수집 (20~30분, 보안문자가 뜨면 창에서 풀고 Enter)")
        r = subprocess.run([PY, str(ROOT / "tools" / "mkt_collect.py"), "--date", d], cwd=ROOT)
        if r.returncode:
            notes.append("검색 수집 중 오류: 다시 실행하면 끝난 키워드는 건너뛰고 이어서 합니다.")

    if not a.no_ai:
        step("4/6 AI 답변 수집 (40~50분, 크롬을 닫지 마세요)")
        claude = find_claude()
        if not claude:
            notes.append("Claude Code를 찾지 못해 AI 수집을 건너뜀. 윈도우를 다시 시작한 뒤 원클릭리포트를 다시 실행해 주세요.")
        else:
            (ROOT / "data" / "measure" / d / "ai").mkdir(parents=True, exist_ok=True)
            r = subprocess.run([claude, "-p", "--chrome", "--permission-mode", "auto", AI_PROMPT.format(d=d)], cwd=ROOT)
            n = len(list((ROOT / "data" / "measure" / d / "ai").glob("*.txt")))
            print(f"AI 답변 파일 {n}건")
            if r.returncode or n < 24:
                notes.append(f"AI 답변 {n}/24건. 빠진 것은 원클릭리포트.bat을 다시 실행하면 이어서 수집합니다.")

    step("5/6 리포트 만들기")
    r = subprocess.run([PY, str(ROOT / "tools" / "mkt_report.py"), "--date", d], cwd=ROOT)
    docx = ROOT / "output" / "marketing" / f"{d}_리포트.docx"
    if r.returncode or not docx.exists():
        notes.append("리포트 생성 실패: 화면의 오류를 캡처해 주세요.")
    elif hasattr(os, "startfile"):
        os.startfile(docx)  # 윈도우: 워드로 바로 열기

    step("6/6 결과 올리기")
    if g and not a.no_push:
        git(g, "add", f"data/measure/{d}", "output/marketing", "data/consults.csv")
        c = git(g, "commit", "-m", f"측정 {d}")
        p = git(g, "push")
        print((c.stdout + p.stdout + p.stderr).strip()[-500:])
        if p.returncode:
            notes.append("올리기 실패: GitHub Desktop에서 Push origin을 눌러 주세요.")
    else:
        print("건너뜀")

    print("\n===== 끝 =====")
    print(f"리포트: {docx}")
    for n in notes:
        print("확인:", n)


if __name__ == "__main__":
    main()
