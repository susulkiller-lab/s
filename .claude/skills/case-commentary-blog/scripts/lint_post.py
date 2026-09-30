#!/usr/bin/env python3
"""판례 해설 블로그 초안 점검기.
사용: python3 lint_post.py post.txt --keyword "가압류 후 합의해제" --target 10000 --forbid 전부명령 --forbid 본압류이후
출력: 글자수, 소제목, 형식 위반, 금지 표현, 문장 길이, 문단 길이, 키워드 빈도, 검증 대상 인용 목록.
종료 코드: 위반이 있으면 1, 없으면 0.
"""
import re
import sys
import argparse

BANNED = {
    "갈래 계열": r"갈래|세 축|두 축|층위|크게 [^.]{0,20}나뉩니다|핵심은 [^.]{0,12}가지",
    "가른다 계열": r"갈린|갈립|가른|갈라|판가름",
    "은유·번역투": r"경로를|경로가|통로|장치를 마련|지형|그림을 그|문을 연|문을 열|올려놓|위에 놓|분절",
    "서다 계열": r"논리가 선|이 선다|에 선다|입장에 서|서 있(?:다|습)|서게 됩",
    "방향 은유": r"반대 방향|방향을 가리|같은 방향",
    "흩어짐 계열": r"흩어|새어나|무너[진지]|빠져나",
    "어긋남": r"어긋",
    "보여준다 계열": r"보여주(?:는|었|며|고|기)|보여줍니다|나타나 있",
    "좀비 문장": r"필요가 있습니다|살펴야|구별되어야|검토되어야|따로 심리|짚어볼|면밀|중요합니다",
    "접속·상투": r"정리하면|결론적으로|한 걸음 더|뿐만 아니라|첫째|둘째|셋째",
}
FORMAT = {
    "마크다운 강조·머리표": r"\*\*|__|^#{1,6}\s|`",
    "HTML 태그": r"</?[a-zA-Z][^>]*>",
    "표 기호": r"^\s*\|.*\|\s*$",
    "번호 목차": r"^\s*(?:\d+[.)]|[가-하][.)]|제\d+[장절편])\s+\S",
}


def strip_cites(s):
    return re.sub(r"\([^)]*\)", "", s)


def split_sentences(p):
    p = re.sub(r"(\d)\.(?=\d)", r"\1§", p)
    p = re.sub(r"(\d)\.(?=\s)", r"\1§", p)
    return [s.strip() for s in re.split(r"(?<=[.?!])\s+", p) if s.strip()]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--keyword", action="append", default=[])
    ap.add_argument("--target", type=int, default=0, help="목표 글자수(공백 제외)")
    ap.add_argument("--forbid", action="append", default=[], help="이 사건에서 쓰면 안 되는 단어")
    ap.add_argument("--maxlen", type=int, default=75)
    a = ap.parse_args()

    t = open(a.path, encoding="utf-8").read()
    bad = 0
    n = len(re.sub(r"\s", "", t))
    print(f"[글자수] 공백 제외 {n}자", end="")
    if a.target:
        gap = (n - a.target) / a.target * 100
        print(f" (목표 {a.target}자 대비 {gap:+.0f}%)", end="")
        if abs(gap) > 10:
            bad += 1
    print()

    blocks = [b for b in re.split(r"\n\s*\n", t) if b.strip()]
    heads = [b.strip() for b in blocks
             if "\n" not in b.strip() and len(b.strip()) <= 60 and not b.strip().endswith(".")]
    print(f"[소제목] {len(heads)}개")
    for h in heads:
        print("  -", h)

    print("[형식 위반]")
    for name, pat in FORMAT.items():
        for m in re.finditer(pat, t, flags=re.M):
            bad += 1
            print(f"  {name}: {m.group(0).strip()[:40]}")

    print("[금지 표현]")
    for name, pat in BANNED.items():
        for m in re.finditer(pat, t):
            bad += 1
            s = max(0, m.start() - 15)
            print(f"  {name}: ...{t[s:m.end() + 15]}...".replace("\n", " "))
    for w in a.forbid:
        for m in re.finditer(re.escape(w), t):
            bad += 1
            s = max(0, m.start() - 15)
            print(f"  사건별 금지어({w}): ...{t[s:m.end() + 15]}...".replace("\n", " "))
    if len(re.findall("자료", t)) > 3:
        bad += 1
        print("  '자료' 과다 사용")

    print(f"[문장 길이] {a.maxlen}자 초과 (인용 괄호 제외)")
    over = 0
    many = []
    for b in blocks:
        if b.strip() in heads:
            continue
        ss = split_sentences(strip_cites(b.strip()))
        if len(ss) > 4:
            many.append((len(ss), b.strip()[:30]))
        for s in ss:
            if len(s) > a.maxlen:
                over += 1
                print(f"  {len(s)}자: {s.replace(chr(0xa7), '.')[:90]}")
    print(f"  초과 문장 {over}개")
    print(f"[문단 길이] 4문장 초과 {len(many)}개")
    for c, h in many:
        print(f"  {c}문장: {h}...")
    if over > 8 or many:
        bad += 1

    for k in a.keyword:
        print(f"[키워드] '{k}' {t.count(k)}회")

    print("[검증 대상 인용]")
    cases = sorted(set(re.findall(r"\d{2,4}(?:다|두|허|누|구합|가합|나|노|도|헌마|헌바|헌가|마|카)\d+", t)))
    laws, last = [], ""
    pat = r"((?:같은 법|[가-힣]{1,20}법(?: 시행령| 시행규칙)?)\s?제\d+조(?:의\d+)?(?:\s?제\d+항)?(?:\s?제\d+호)?(?:,\s?제\d+조(?:의\d+)?(?:\s?제\d+항)?)*)"
    for m in re.finditer(pat, t):
        x = m.group(1)
        if x.startswith("같은 법"):
            x = (last + x[len("같은 법"):]) if last else x
        else:
            last = re.match(r"[가-힣]{1,20}법(?: 시행령| 시행규칙)?", x).group(0)
        parts = [p.strip() for p in x.split(",")]
        head = parts[0]
        law = re.match(r"[가-힣]{1,20}법(?: 시행령| 시행규칙)?", head).group(0)
        for p in [head] + [law + " " + q for q in parts[1:]]:
            if p not in laws:
                laws.append(p)
    print("  사건번호:", ", ".join(cases) or "없음")
    print("  조문:", "; ".join(sorted(laws)) or "없음")
    print(f"  검증 대상 합계 {len(cases) + len(laws)}건")
    print("  -> 위 목록을 legal_analysis(mode=verify_citations)로 검증할 것 (기본 15건까지, maxCitations로 최대 30건)")

    print("결과:", "위반 있음" if bad else "통과")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
