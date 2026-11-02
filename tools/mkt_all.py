"""원클릭 측정·리포트. 저장소 맨 위의 '원클릭리포트.bat'을 더블클릭하면 이 파일이 돈다.

순서: 준비(패키지 자동 설치) → 최신 코드 받기 → 검색 수집 → AI 답변 수집(Claude Code + Chrome)
      → 리포트(txt·csv·docx) → 결과 저장소에 올리기 → 리포트 열기
사람 손이 필요한 때: 보안문자가 뜰 때뿐(창에서 풀고 Enter). 그 밖의 실패는 건너뛰고 마지막에 알려준다.
수집이 기준(scoring.json의 min_channel_coverage)에 못 미치면 리포트만 만들고 올리지 않는다.
상담 입력 파일(data/consults_local.csv)은 올리지 않는다.

  py tools\\mkt_all.py                # 전체
  py tools\\mkt_all.py --no-ai        # AI 답변 수집 생략
  py tools\\mkt_all.py --skip-collect # 검색 수집 생략(이미 수집한 날 리포트만 다시)
  py tools\\mkt_all.py --push-anyway  # 수집이 기준에 못 미쳐도 올리기
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
    "엔진은 chatgpt, gemini, perplexity, 질문 전체, 회차 {r}. 이미 저장된 파일은 다시 하지 마. "
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
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "claude.exe"),
        os.path.join(os.environ.get("APPDATA", ""), "npm", "claude.cmd"))


def git(g, *args):
    return subprocess.run([g, *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")


def publish(g, d):
    """측정 결과와 리포트만 올린다. 거부되면 최신 내용을 합쳐 한 번 더 시도한다. 성공하면 True.
    합칠 때 rebase를 쓰지 않는다. rebase는 이번 커밋의 파일을 다시 쓰므로 문서가 열려 있으면 중간에 멈춘다."""
    paths = [p for p in ("data/measure", "output/marketing") if (ROOT / p).exists()]
    r = git(g, "add", *paths)
    if r.returncode:
        notes.append(f"올릴 파일 고르기 실패: {r.stderr.strip()[-200:]}")
        return False
    if git(g, "diff", "--cached", "--quiet").returncode:
        c = git(g, "commit", "-m", f"측정 {d}")
        print(c.stdout.strip()[-300:])
        if c.returncode:
            notes.append(f"결과 저장 실패: {(c.stderr or c.stdout).strip()[-200:]}")
            return False
    p = git(g, "push")
    if p.returncode:
        print("올리기가 거부되어 최신 내용을 합쳐 다시 시도합니다.")
        r = git(g, "pull", "--no-rebase", "--no-edit")
        if r.returncode:
            git(g, "merge", "--abort")
            notes.append(f"최신 내용 합치기 실패: {(r.stderr or r.stdout).strip()[-200:]}")
            return False
        p = git(g, "push")
    print((p.stdout + p.stderr).strip()[-300:])
    if p.returncode:
        notes.append(f"올리기 실패(다음 실행 때 다시 시도합니다): {p.stderr.strip()[-200:]}")
        return False
    return True


def newest_report(d):
    """이번에 만든 문서를 고른다. 열린 문서 때문에 새 이름으로 저장됐으면 그 파일이다."""
    out = ROOT / "output" / "marketing"
    hits = [p for p in out.glob(f"{d}_리포트*.docx") if not p.name.endswith(".tmp.docx")]
    return max(hits, key=lambda p: p.stat().st_mtime) if hits else out / f"{d}_리포트.docx"


def open_report(path):
    if hasattr(os, "startfile"):
        os.startfile(path)  # 윈도우: 워드로 바로 열기


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--skip-collect", action="store_true")
    ap.add_argument("--no-push", action="store_true")
    ap.add_argument("--push-anyway", action="store_true", help="수집이 기준에 못 미쳐도 결과를 올린다")
    a = ap.parse_args()
    d = a.date

    step("1/6 준비")
    refresh_path()
    ensure_packages()
    g = find_git()

    step("2/6 최신 코드 받기")
    if g:
        me = Path(__file__).read_bytes()
        r = git(g, "pull", "--ff-only")
        print(r.stdout.strip() or r.stderr.strip())
        if r.returncode:
            notes.append("최신 코드 받기 실패: 지금 PC에 있는 코드로 진행했습니다. 계속되면 이 창을 캡처해 주세요.")
        elif Path(__file__).read_bytes() != me and not os.environ.get("MKT_RESTARTED"):
            print("프로그램이 새로 바뀌어 새 버전으로 다시 시작합니다.")
            os.environ["MKT_RESTARTED"] = "1"
            sys.exit(subprocess.run([PY, __file__, *sys.argv[1:]]).returncode)
    else:
        notes.append("git이 없어 최신 코드 받기와 결과 올리기를 건너뜀.")
        print("git 없음: 건너뜀")

    # 최신 코드를 받은 뒤에 불러와야 이번 실행부터 새 규칙이 적용된다
    sys.path.insert(0, str(ROOT / "tools"))
    from mkt_common import MEASURE, ai_expected, ai_rounds, check_ai_files, collection_problems, read_prompts

    if not a.skip_collect:
        step("3/6 네이버·플레이스·구글 수집과 핵심 키워드 재측정 (30~40분, 보안문자가 뜨면 창에서 풀고 Enter)")
        r = subprocess.run([PY, str(ROOT / "tools" / "mkt_collect.py"), "--date", d], cwd=ROOT)
        if r.returncode:
            notes.append("검색 수집 중 오류: 다시 실행하면 끝난 키워드는 건너뛰고 이어서 합니다.")

    if not a.no_ai:
        step("4/6 AI 답변 수집 (회차당 40~50분, 크롬을 닫지 마세요)")
        claude = find_claude()
        if not claude:
            notes.append("Claude Code를 찾지 못해 AI 수집을 건너뜀. 명령 프롬프트에서 where claude 를 입력한 결과를 캡처해 주세요.")
        else:
            print("Claude Code:", claude)
            (ROOT / "data" / "measure" / d / "ai").mkdir(parents=True, exist_ok=True)
            rounds = "1회" if ai_rounds() == 1 else f"1~{ai_rounds()}회(회차마다 새 대화)"
            r = subprocess.run([claude, "-p", "--chrome", "--permission-mode", "auto", AI_PROMPT.format(d=d, r=rounds)], cwd=ROOT)
            prompts = read_prompts()
            good, bad = check_ai_files(MEASURE / d, prompts)
            n, want = len(good), ai_expected(prompts)
            print(f"AI 답변 유효 {n}건, 제외 {len(bad)}건")
            if r.returncode or n < want or bad:
                notes.append(f"AI 답변 유효 {n}/{want}건" + (f", 제외 {len(bad)}건" if bad else "")
                             + ". 제외된 파일을 지우고 원클릭리포트.bat을 다시 실행하면 빠진 것만 이어서 수집합니다.")

    step("5/6 리포트 만들기")
    r = subprocess.run([PY, str(ROOT / "tools" / "mkt_report.py"), "--date", d], cwd=ROOT)
    docx = newest_report(d)
    report_ok = not r.returncode and docx.exists()
    if not report_ok:
        notes.append("리포트 생성 실패: 화면의 오류를 캡처해 주세요.")
    elif docx.name != f"{d}_리포트.docx":
        notes.append(f"문서가 열려 있어 새 리포트를 '{docx.name}'으로 저장했습니다. 예전 문서를 닫고 다시 실행하면 정리됩니다.")

    step("6/6 결과 올리기")
    problems = collection_problems(MEASURE / d)
    if problems:
        notes.append("수집이 기준에 못 미침: " + ", ".join(problems) + ". 다시 실행하면 빠진 것만 이어서 수집합니다.")
    if g and not a.no_push and (not problems or a.push_anyway):
        publish(g, d)
    else:
        print("수집이 기준에 못 미쳐 올리지 않았습니다." if problems and not a.no_push else "건너뜀")
    if report_ok:  # 올리기가 끝난 뒤에 연다. 문서가 열려 있으면 git이 그 파일을 바꾸지 못한다
        open_report(docx)

    print("\n===== 끝 =====")
    print(f"리포트: {docx}")
    for n in notes:
        print("확인:", n)


if __name__ == "__main__":
    main()
