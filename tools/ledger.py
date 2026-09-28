"""발행 기록(data/published.csv) 관리. 주제 중복(키워드 잠식) 방지용.

  python3 tools/ledger.py check "대여금 소멸시효"      # 겹치는 기발행 글 조회
  python3 tools/ledger.py add --date 2026-09-28 --channel naver --title "..." --kw "..." [--url ...]
  python3 tools/ledger.py list [--days 60]
"""
import argparse
import csv
import re
import sys
from datetime import date, timedelta
from pathlib import Path

LEDGER = Path(__file__).resolve().parent.parent / "data" / "published.csv"
FIELDS = ["date", "channel", "title", "main_kw", "url"]


def rows():
    if not LEDGER.exists():
        return []
    with LEDGER.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def norm(s):
    return re.sub(r"\s", "", s)


def overlap(kw, row):
    k = norm(kw)
    t, m = norm(row["title"]), norm(row["main_kw"])
    if k and (k == m or k in t or (m and m in k)):
        return "강"
    toks = [w for w in re.findall(r"[가-힣A-Za-z0-9]{2,}", kw)]
    hit = [w for w in toks if w in row["title"] or w in row["main_kw"]]
    if toks and len(hit) / len(toks) >= 0.5:
        return "중"
    return ""


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("check"); c.add_argument("kw")
    a = sub.add_parser("add")
    for fld in ("date", "channel", "title", "kw"):
        a.add_argument("--" + fld, required=fld != "date")
    a.add_argument("--url", default="")
    ls = sub.add_parser("list"); ls.add_argument("--days", type=int, default=0)
    x = ap.parse_args()

    if x.cmd == "check":
        hits = [(overlap(x.kw, r), r) for r in rows()]
        hits = [h for h in hits if h[0]]
        if not hits:
            print(f"'{x.kw}': 겹치는 기발행 글 없음")
            return
        for lvl, r in sorted(hits, key=lambda h: h[0] != "강"):
            print(f"[{lvl}] {r['date']} {r['channel']} | {r['title']} | {r['main_kw']} | {r['url']}")
        sys.exit(2 if any(l == "강" for l, _ in hits) else 0)
    elif x.cmd == "add":
        new = not LEDGER.exists()
        with LEDGER.open("a", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, FIELDS)
            if new:
                w.writeheader()
            w.writerow({"date": x.date or date.today().isoformat(), "channel": x.channel,
                        "title": x.title, "main_kw": x.kw, "url": x.url})
        print("기록 완료")
    else:
        since = (date.today() - timedelta(days=x.days)).isoformat() if x.days else ""
        for r in rows():
            if r["date"] >= since:
                print(f"{r['date']} {r['channel']:8} {r['main_kw']:16} {r['title']}")


if __name__ == "__main__":
    main()
