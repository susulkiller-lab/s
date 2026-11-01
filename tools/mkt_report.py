"""마케팅 노출 리포트. 수집 결과(data/measure/<날짜>/)로 점수·비교·약점 목록을 만든다. 표준 라이브러리만 쓴다.

  py tools\\mkt_report.py                 # 가장 최근 측정 vs 직전 측정
  py tools\\mkt_report.py --date 2026-10-27 --prev 2026-10-20

결과: output/marketing/<날짜>_리포트.txt, <날짜>_키워드표.csv(엑셀용), data/measure/<날짜>/scores.json
AI 답변: data/measure/<날짜>/ai/<엔진>__<질문id>__<회차>.txt (marketing/AI_PROTOCOL.md 참조)
상담 실적: data/consults_local.csv(이 PC에만 둔다). 요약은 output/local/<날짜>_상담요약.txt로 따로 남기고 리포트에는 넣지 않는다

변동값은 저장된 점수를 빼지 않는다. 두 회차를 현재 설정으로 다시 계산하고, 두 회차 모두 측정된 같은 키워드·같은 답변만 비교한다.
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mkt_collect import reparse_if_old  # noqa: E402
from mkt_common import (AI_EXPECTED_ENGINES, CONSULTS, CONSULTS_OLD, CONTENT_CLASSES, LEDGER, ROOT, UNKNOWN_OWNER,  # noqa: E402
                        ai_expected, channel_status, check_ai_files, is_network, load_entities, load_scoring,
                        match_item, measure_dirs, norm, points, read_json, read_keywords, read_prompts,
                        read_rows, write_json)

CHANNELS = [("naver", "네이버 콘텐츠"), ("place", "네이버 플레이스"), ("google", "구글"), ("ai", "AI 검색")]
SEARCH = ("naver", "place", "google")
CONSULT_HEADER = "date,channel,area,region,retained,memo"
PLACE_FIELDS = ("visitor_reviews", "visitor_score", "image_count", "booking", "talktalk", "coupon")
PHONE_RE = re.compile(r"0\d{1,2}[-.\s)]?\d{3,4}[-.\s]?\d{4}")


def best_rank(items, ent, field):
    ranks = [it[field] for it in items if it.get(field) and match_item(it, ent)]
    return min(ranks) if ranks else None


def owner_names_all(dirs):
    """모든 회차에서 블로그 주인 이름을 모은다. 프로필 링크가 없는 화면도 같은 주인으로 맞추기 위해서다."""
    out = {}
    for d in dirs:
        for fname in ("naver_serp.json", "google.json"):
            for rec in read_json(d / fname, {}).values():
                for owner, name in rec.get("blog_owners", {}).items():
                    if name not in out.get(owner, ""):
                        out[owner] = (out[owner] + " | " + name) if owner in out else name
    return out


def fill_owner_names(pages, owner_names):
    for rec in pages.values():
        for it in rec.get("items", []):
            if it["cls"] == "blog" and owner_names.get(it["key"].split("/")[0]):
                it["owner_name"] = owner_names[it["key"].split("/")[0]]


def usable(rec, field):
    """정상 수집이고 내용이 있는 화면만 돌려준다. 그 밖에는 None(미측정)."""
    return rec[field] if rec and rec.get("status") == "ok" and rec.get(field) else None


def ranks_for(mdir, ents, kws, sc, owner_names=None):
    """키워드 × 업체별 채널 순위. 수집이 기준에 못 미친 채널은 미측정으로 돌린다."""
    serp = read_json(mdir / "naver_serp.json", {})
    plist = read_json(mdir / "place_list.json", {})
    goog = read_json(mdir / "google.json", {})
    fill_owner_names(serp, owner_names or {})
    fill_owner_names(goog, owner_names or {})
    status = channel_status(mdir, kws)
    out = {}
    for k in kws:
        kw = k["keyword"]
        s_items = usable(serp.get(kw), "items")
        p_rows = usable(plist.get(kw), "places")
        no_place = plist.get(kw, {}).get("status") == "none"  # 플레이스 결과가 없는 키워드는 플레이스 채널에서 뺀다
        g_items = usable(goog.get(kw), "items")
        row = {}
        for e in ents:
            r = {}
            if s_items is not None:
                r["naver"] = best_rank(s_items, e, "content_pos")
                r["ad"] = any(it["cls"] == "ad" and match_item(it, e) for it in s_items)
                r["place_block"] = best_rank([i for i in s_items if i["cls"] == "place"], e, "pos")
            if p_rows is not None:
                pr = [dict(cls="place", key=x["id"], text=x["name"], **x) for x in p_rows if x.get("rank")]
                r["place"] = best_rank(pr, e, "rank")
                hit = next((x for x in pr if match_item(x, e)), None)
                if hit:
                    r["place_info"] = {f: hit.get(f) for f in PLACE_FIELDS}
                r["place_total"] = plist[kw].get("total")
            elif s_items is not None and not no_place:
                r["place"] = r.get("place_block")
            if g_items is not None:
                r["google"] = best_rank([i for i in g_items if i["cls"] in CONTENT_CLASSES], e, "content_pos")
                r["gmap"] = any(i["cls"] == "gmap" and match_item(i, e) for i in g_items)
            row[e["key"]] = r
        out[kw] = {"weight": k["weight"], "ranks": row,
                   "place_src": "list" if p_rows is not None else ("block" if s_items is not None and not no_place else None),
                   "measured": {"naver": s_items is not None, "place": not no_place and (p_rows is not None or s_items is not None),
                                "google": g_items is not None}}
    least = sc.get("min_channel_coverage", 0.7)
    have = {}
    for ch in SEARCH:
        n = sum(1 for v in out.values() if v["measured"][ch])
        have[ch] = bool(n) and n / max(status[ch]["target"], 1) >= least
        if not have[ch]:
            for v in out.values():
                v["measured"][ch] = False
    return out, have, status, serp


def ai_results(mdir, ents, prompts, sc):
    """유효한 AI 답변에서 업체별 언급 순서를 센다. 유효 답변이 기준에 못 미치면 AI 채널을 미측정으로 돌린다."""
    good, bad = check_ai_files(mdir, prompts)
    usable_ai = len(good) / max(ai_expected(prompts), 1) >= sc.get("min_ai_coverage", 0.5)
    res = []
    for g in good if usable_ai else []:
        text = g["text"]
        t = norm(text)
        firsts = {}
        for e in ents:
            idx = [t.find(n) for n in e["_names"] if n and t.find(n) >= 0]
            if idx:
                firsts[e["key"]] = min(idx)
        order = sorted(firsts, key=firsts.get)
        cites = [e["key"] for e in ents if any(x and x.lower() in text.lower() for x in e["domains"] + e["blog_ids"])]
        res.append({"engine": g["engine"], "pid": g["pid"], "round": g["round"], "file": g["file"], "order": order,
                    "cites": cites, "text": text})
    return res, good, bad


def load_measure(mdir, ents, kws, prompts, sc, owner_names=None):
    """한 회차를 현재 설정으로 계산한다. 저장된 scores.json은 쓰지 않는다."""
    ranks, have, status, serp = ranks_for(mdir, ents, kws, sc, owner_names)
    ai, ai_good, ai_bad = ai_results(mdir, ents, prompts, sc)
    return {"dir": mdir, "name": mdir.name, "ranks": ranks, "have": have, "status": status, "serp": serp, "ai": ai,
            "ai_good": ai_good, "ai_bad": ai_bad, "per": score(ranks, have, ai, ents, sc)}


def ai_key(r):
    return (r["engine"], r["pid"], r["round"])


def common_keys(measures):
    """모든 회차에서 측정된 키워드와 AI 답변만 남긴다. 플레이스는 출처(목록·통합검색 영역)까지 같아야 한다."""
    common = {}
    for ch in SEARCH:
        kws = [kw for kw in measures[0]["ranks"]
               if all(kw in m["ranks"] and m["ranks"][kw]["measured"][ch] for m in measures)]
        if ch == "place":
            kws = [kw for kw in kws if len({m["ranks"][kw].get("place_src") for m in measures}) == 1]
        common[ch] = set(kws)
    return common, set.intersection(*[{ai_key(r) for r in m["ai"]} for m in measures])


def rescored(m, common, ai_keys, ents, sc):
    ranks = {kw: dict(v, measured={ch: v["measured"][ch] and kw in common[ch] for ch in SEARCH})
             for kw, v in m["ranks"].items()}
    return score(ranks, {ch: bool(common[ch]) for ch in SEARCH}, [r for r in m["ai"] if ai_key(r) in ai_keys], ents, sc)


def compare(cur, prev, ents, sc):
    """같은 키워드·채널·답변으로 두 회차를 다시 계산한 변동. 겹치는 범위가 기준보다 좁은 채널은 변동을 숨긴다."""
    least = sc.get("min_channel_coverage", 0.7)
    common, ai_keys = common_keys([cur, prev])
    counts, hidden = {}, {}
    for ch in SEARCH:
        mine = sum(1 for v in cur["ranks"].values() if v["measured"][ch])
        counts[ch] = (len(common[ch]), mine)
        if mine and len(common[ch]) / mine < least:
            hidden[ch] = counts[ch]
            common[ch] = set()
    counts["ai"] = (len(ai_keys), len(cur["ai"]))
    if cur["ai"] and len(ai_keys) / len(cur["ai"]) < least:
        hidden["ai"] = counts["ai"]
        ai_keys = set()
    c, p = rescored(cur, common, ai_keys, ents, sc), rescored(prev, common, ai_keys, ents, sc)
    delta = {}
    for e in ents:
        a, b = c[e["key"]], p[e["key"]]
        delta[e["key"]] = {x: round(a[x] - b[x], 1) for x in ("naver", "place", "google", "ai", "index")
                           if a.get(x) is not None and b.get(x) is not None}
    return {"delta": delta, "counts": counts, "hidden": hidden}


def rank_moves(cur, prev, us):
    """두 회차 모두 측정된 키워드에서만 우리 순위 변동을 찾는다."""
    moves = []
    for kw, v in cur["ranks"].items():
        old = prev["ranks"].get(kw)
        if not old:
            continue
        for ch, chn in CHANNELS[:3]:
            if not (v["measured"][ch] and old["measured"][ch]):
                continue
            if ch == "place" and v.get("place_src") != old.get("place_src"):
                continue
            a1, b1 = v["ranks"][us].get(ch), old["ranks"][us].get(ch)
            if (a1 is None) != (b1 is None) or (a1 and b1 and abs(a1 - b1) >= 3):
                moves.append(f"- [{chn}] {kw}: {rank_txt(b1)} -> {rank_txt(a1)}")
    return moves


def index_trend(measures, us, ents, sc):
    """여러 회차에 공통인 키워드·답변만으로 종합지수 추이를 다시 계산한다."""
    common, ai_keys = common_keys(measures)
    return [(m["name"], rescored(m, common, ai_keys, ents, sc)[us].get("index")) for m in measures]


def status_line(m, prompts):
    """수집 현황 한 줄: 채널별 성공 수와 실패 이유."""
    parts = []
    for ch, name in CHANNELS[:3]:
        st = m["status"][ch]
        notes = [f"{k} {v}" for k, v in st["failed"].items()]
        if st["none"]:
            notes.append(f"결과 없음 {st['none']}")
        if ch == "place":
            n = sum(1 for v in m["ranks"].values() if v.get("place_src") == "block")
            if n:
                notes.append(f"통합검색 영역으로 대체 {n}")
        parts.append(f"{name} {st['ok']}/{st['target']}" + (f"({', '.join(notes)})" if notes else "")
                     + ("" if m["have"][ch] else " 미측정 처리"))
    by = Counter(g["engine"] for g in m["ai_good"])
    parts.append(f"AI 검색 {len(m['ai_good'])}/{ai_expected(prompts)}" + (f"({', '.join(f'{k} {v}' for k, v in sorted(by.items()))})" if by else "")
                 + (" 미측정 처리" if m["ai_good"] and not m["ai"] else ""))
    return ", ".join(parts)


def compare_line(cmp):
    names = dict(CHANNELS)
    return ", ".join(f"{names[ch]} {cmp['counts'][ch][0]}/{cmp['counts'][ch][1]}" for ch, _ in CHANNELS if cmp["counts"][ch][1])


def measure_warnings(m, ents, prompts):
    """측정값을 읽을 때 알아야 할 것. 텍스트 리포트 첫머리와 문서에 같이 넣는다."""
    out = []
    comps = [e for e in ents if e["role"] == "competitor"]
    items = [it for rec in m["serp"].values() for it in rec.get("items", []) if it["cls"] == "blog"]
    by_id, by_name, none = 0, 0, []
    for e in comps:
        hits = [it for it in items if match_item(it, e)]
        if not hits:
            none.append(e["key"])
        elif any(it["key"].split("/")[0].lower() in [b.lower() for b in e["blog_ids"]] for it in hits):
            by_id += 1
        else:
            by_name += 1
    if comps and items:
        out.append(f"비교군 블로그: 등록 ID {by_id}곳, 블로그명 일치 {by_name}곳, 못 찾음 {len(none)}곳"
                   + (f"({', '.join(none)})" if none else "") + ". 못 찾은 곳의 네이버 블로그 노출은 점수에 들어가지 않습니다")
    if m["ai_bad"]:
        shown = ", ".join(f"{n}({why})" for n, why in m["ai_bad"][:5])
        out.append(f"AI 답변 제외 {len(m['ai_bad'])}건: {shown}")
    by = Counter(g["engine"] for g in m["ai_good"])
    short = [en for en in AI_EXPECTED_ENGINES if by[en] < len(prompts)]
    if m["ai"] and short:
        out.append(f"AI 부분 측정: {', '.join(short)} 답변이 질문 수보다 적습니다")
    other = Counter()
    for fname in ("naver_serp.json", "google.json"):
        for rec in read_json(m["dir"] / fname, {}).values():
            other.update(rec.get("unclassified", {}))
    if other:
        top = ", ".join(f"{h} {n}" for h, n in other.most_common(5))
        out.append(f"분류하지 못한 링크 {sum(other.values())}건({top}). 새 주소가 보이면 화면 구조가 바뀐 것일 수 있습니다")
    return out


def blog_owner_candidates(serp, ents, kws, top=10):
    """상위 노출 블로그 중 등록 업체와 연결되지 않은 주인. 비교군 blog_ids에 넣을 후보다."""
    w = {k["keyword"]: k["weight"] for k in kws}
    pts, names = Counter(), {}
    for kw, rec in serp.items():
        for it in rec.get("items", []):
            pos = it.get("content_pos")
            owner = it["key"].split("/")[0] if it["cls"] == "blog" else None
            if not owner or owner == UNKNOWN_OWNER or not pos or pos > 10 or any(match_item(it, e) for e in ents):
                continue
            pts[owner] += w.get(kw, 1) * (11 - pos)
            names[owner] = it.get("owner_name", "").split(" | ")[0][:30]
    return [(o, names[o], round(n)) for o, n in pts.most_common(top)]


def score(ranks, have, ai, ents, sc):
    rp = sc["rank_points"]
    per = {e["key"]: {} for e in ents}
    for ch in ("naver", "place", "google"):
        if not have[ch]:
            continue
        for e in ents:
            num = den = 0.0
            for kw, v in ranks.items():
                if not v["measured"][ch]:
                    continue
                num += v["weight"] * points(v["ranks"][e["key"]].get(ch), rp)
                den += v["weight"] * 10
            per[e["key"]][ch] = round(num / den * 100, 1) if den else None
    if ai:
        for e in ents:
            pts = [points(r["order"].index(e["key"]) + 1 if e["key"] in r["order"] else None, sc["ai_mention_points"])
                   for r in ai]
            per[e["key"]]["ai"] = round(sum(pts) / (len(pts) * 10) * 100, 1)
            per[e["key"]]["ai_mention_rate"] = round(sum(1 for r in ai if e["key"] in r["order"]) / len(ai) * 100, 1)
    w = sc["channel_weights"]
    for e in ents:
        s = per[e["key"]]
        got = [(w[ch], s[ch]) for ch, _ in CHANNELS if s.get(ch) is not None]
        tw = sum(x for x, _ in got)
        s["index"] = round(sum(x * y for x, y in got) / tw, 1) if tw else None
    return per


def spearman(xs, ys):
    n = len(xs)
    if n < 5:
        return None

    def rk(v):
        o = sorted(range(n), key=lambda i: v[i])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and v[o[j + 1]] == v[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    a, b = rk(xs), rk(ys)
    ma, mb = sum(a) / n, sum(b) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((y - mb) ** 2 for y in b) ** 0.5
    return round(cov / (va * vb), 2) if va and vb else None


def discover(mdir, cfg, ents, kws):
    """비교군 후보: 우리·등록 업체·네트워크펌을 뺀 상위 노출 플레이스."""
    plist = read_json(mdir / "place_list.json", {})
    serp = read_json(mdir / "naver_serp.json", {})
    w = {k["keyword"]: k["weight"] for k in kws}
    score_c, names = Counter(), {}
    for kw, v in plist.items():
        for x in v.get("places", []):
            if x.get("rank") and x["rank"] <= 10:
                score_c[x["id"]] += w.get(kw, 1) * (11 - x["rank"])
                names[x["id"]] = x["name"]
    if not plist:
        for kw, v in serp.items():
            for it in v.get("items", []):
                if it["cls"] == "place" and it["pos"] <= 10:
                    score_c[it["key"]] += w.get(kw, 1) * (11 - it["pos"])
                    names[it["key"]] = it["text"].split("|")[0].strip()[:40]
    out = []
    for pid, s in score_c.most_common():
        item = {"cls": "place", "key": pid, "text": names[pid]}
        if any(match_item(item, e) for e in ents) or is_network(names[pid], cfg):
            continue
        out.append((names[pid], pid, round(s)))
    return out


def prepare_consults():
    """상담 입력 파일을 준비한다. 예전 위치(data/consults.csv)에 입력한 행이 있으면 이 PC 전용 파일로 옮기고
    예전 파일은 머리글만 남긴다. 예전 파일은 저장소에 있어 내용이 남아 있으면 올라갈 수 있다."""
    fields = CONSULT_HEADER.split(",")
    CONSULTS.parent.mkdir(parents=True, exist_ok=True)
    if not CONSULTS.exists():
        CONSULTS.write_text(CONSULT_HEADER + "\n", encoding="utf-8-sig")
    old = [r for r in read_rows(CONSULTS_OLD) if any(isinstance(v, str) and v.strip() for v in r.values())] if CONSULTS_OLD.exists() else []
    if not old:
        return
    try:
        rows = read_rows(CONSULTS) + old
        with CONSULTS.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        CONSULTS_OLD.write_text(CONSULT_HEADER + "\n", encoding="utf-8")
        print(f"상담 입력 {len(old)}행을 data/{CONSULTS.name}로 옮겼습니다.")
    except PermissionError:
        print("상담 입력 파일이 열려 있어 옮기지 못했습니다. 닫고 다시 실행해 주세요.")


def parse_date(s):
    """2026-10-27, 2026.10.27, 2026/1/5 같은 날짜를 ISO 형식으로 바꾼다. 못 읽으면 None."""
    m = re.fullmatch(r"(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?", s.strip())
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def consult_summary(start, end):
    """(이번 기간 행, 앞선 같은 기간 행, 날짜를 못 읽은 행 수)."""
    if not CONSULTS.exists():
        return [], [], 0
    rows = [r for r in read_rows(CONSULTS) if (r.get("date") or "").strip()]
    for r in rows:
        r["_date"] = parse_date(r["date"])
    bad = sum(1 for r in rows if not r["_date"])

    def pick(a, b):
        return [r for r in rows if r["_date"] and a < r["_date"] <= b]
    cur = pick(start, end)
    span = (date.fromisoformat(end) - date.fromisoformat(start)).days
    prev_start = (date.fromisoformat(start) - timedelta(days=span)).isoformat()
    prev = pick(prev_start, start)
    return cur, prev, bad


def consult_lines(start, end, cs):
    """상담 요약 문장. 공개 저장소에 올리지 않는 파일에만 쓴다."""
    cur, prv, bad = cs
    ret = sum(1 for r in cur if (r.get("retained") or "").strip().upper() in ("Y", "O", "수임"))
    lines = [f"기간 {start} 다음날 ~ {end}: 상담 {len(cur)}건 (앞선 같은 기간 {len(prv)}건), 수임 {ret}건"]
    by = Counter((r.get("channel") or "미기재").strip() for r in cur)
    if by:
        lines.append("유입 경로: " + ", ".join(f"{k} {v}" for k, v in by.most_common()))
    if bad:
        lines.append(f"날짜를 읽지 못한 행 {bad}건은 빠졌습니다(2026-10-27 형식으로 고쳐 주세요)")
    return lines


def save_docx(build, R, dp):
    """임시 이름으로 만든 뒤 교체한다. 문서가 열려 있어 못 바꾸면 '(새본)'으로 남겨 옛 문서와 어긋나지 않게 한다."""
    tmp = dp.with_name(dp.stem + ".tmp.docx")
    build(R, tmp)
    try:
        os.replace(tmp, dp)
    except PermissionError:
        pass
    else:
        for stale in dp.parent.glob(dp.stem + "(새본*).docx"):  # 지난번 새본이 열려 있으면 그대로 둔다
            try:
                stale.unlink()
            except PermissionError:
                pass
        return dp
    alt = dp.with_name(dp.stem + "(새본).docx")
    try:
        os.replace(tmp, alt)
    except PermissionError:  # 새본까지 열려 있을 때
        alt = dp.with_name(f"{dp.stem}(새본 {datetime.now():%H%M%S}).docx")
        os.replace(tmp, alt)
    print(f"문서가 열려 있어 새 이름으로 저장했습니다: {alt}")
    return alt


def fmt(v, suffix=""):
    return "-" if v is None else f"{v}{suffix}"


def delta(d):
    return "" if d is None else f" ({'+' if d >= 0 else ''}{d})"


def yn(v):
    return "-" if v is None else ("있음" if v else "없음")


def rank_txt(r):
    return f"{r}위" if r else "미노출"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default="")
    ap.add_argument("--prev", default="")
    a = ap.parse_args()

    dirs = measure_dirs()
    if not dirs:
        sys.exit("측정 결과가 없습니다. 먼저 tools/mkt_collect.py를 실행하세요.")
    mdir = next((d for d in dirs if d.name == a.date), None) if a.date else dirs[-1]
    if mdir is None:
        sys.exit(f"{a.date} 측정 결과가 없습니다.")
    earlier = [d for d in dirs if d.name < mdir.name]
    pdir = next((d for d in dirs if d.name == a.prev), None) if a.prev else (earlier[-1] if earlier else None)
    if a.prev and pdir is None:
        sys.exit(f"{a.prev} 측정 결과가 없습니다.")
    prepare_consults()

    cfg = load_entities()
    ents = cfg["_list"]
    for e in ents:
        e.setdefault("key", e["names"][0] if e["names"] else "?")
    sc = load_scoring()
    kws = read_keywords()
    prompts = read_prompts()
    us = ents[0]["key"]

    trend_dirs = [d for d in dirs if d.name <= mdir.name][-8:]
    fresh = {d.name: reparse_if_old(d) for d in {mdir, *trend_dirs, *([pdir] if pdir else [])}}
    owner_names = owner_names_all(dirs)
    cur = load_measure(mdir, ents, kws, prompts, sc, owner_names)
    ranks, have, ai, per = cur["ranks"], cur["have"], cur["ai"], cur["per"]
    write_json(mdir / "scores.json", {"scores": per, "ranks": ranks, "ai": [{k: v for k, v in r.items() if k != "text"} for r in ai]})
    # 두 회차의 분류 규칙이 같을 때만 비교한다
    prev = load_measure(pdir, ents, kws, prompts, sc, owner_names) if pdir and fresh[pdir.name] and fresh[mdir.name] else None
    cmp = compare(cur, prev, ents, sc) if prev else None
    deltas = cmp["delta"] if cmp else {}
    has_delta = any(deltas.values())

    warnings = measure_warnings(cur, ents, prompts)
    if not fresh[mdir.name]:
        warnings.append("이번 회차 원본이 없어 옛 분류 규칙 결과를 그대로 썼습니다")
    if pdir and not prev:
        warnings.append(f"원본이 없어 {pdir.name} 측정과 분류 규칙을 맞추지 못했습니다. 변동을 표시하지 않습니다")
    if cmp and cmp["hidden"]:
        names = dict(CHANNELS)
        warnings.append("변동 미표시: " + ", ".join(f"{names[ch]}(겹치는 범위 {n}/{m})" for ch, (n, m) in cmp["hidden"].items()))

    L = []
    p = L.append
    p(f"진앤솔법률사무소 마케팅 노출 리포트 ({mdir.name} 측정)")
    p(f"비교 기준: {pdir.name + ' 측정' if pdir else '직전 측정 없음(이번이 기준선)'}")
    collect = status_line(cur, prompts)
    p(f"수집 현황: {collect}")
    compare_txt = compare_line(cmp) if cmp else ""
    if compare_txt:
        p(f"변동 비교 범위(두 회차 공통/이번 회차): {compare_txt}")
    meta = read_json(mdir / "meta.json", {})
    p(f"측정 조건: 키워드 {len(kws)}개, 기기 {meta.get('device', '-')}, 수집 단계 {', '.join(meta.get('steps', [])) or '-'}, AI 답변 {len(ai)}건")
    missing_ch = [n for ch, n in CHANNELS if (ch == "ai" and not ai) or (ch != "ai" and not have[ch])]
    if missing_ch:
        p(f"미측정 채널: {', '.join(missing_ch)} (종합지수는 측정된 채널 가중치로만 환산)")
    for w_line in warnings:
        p(f"주의: {w_line}")
    p("")
    # 문서(DOCX)용 구조화 데이터. 텍스트 리포트와 같은 값을 담는다.
    R = {"date": mdir.name, "prev": pdir.name if pdir else None, "collect": collect, "compare": compare_txt,
         "warnings": warnings, "has_delta": has_delta,
         "conditions": f"키워드 {len(kws)}개, 기기 {meta.get('device', '-')}, 수집 단계 "
                       f"{', '.join(meta.get('steps', [])) or '-'}, AI 답변 {len(ai)}건",
         "missing_channels": missing_ch, "channel_names": [n for _, n in CHANNELS]}

    # 1. 결론
    s_us = per[us]
    comps = [e for e in ents if e["role"] == "competitor"]
    ranked = sorted(ents, key=lambda e: per[e["key"]].get("index") or 0, reverse=True)
    idx_us = s_us.get("index")
    d_us = deltas.get(us, {})
    if idx_us is None:
        pos_text = "순위 없음(측정된 채널 없음)"
    else:
        pos_us = 1 + sum(1 for e in ents if (per[e["key"]].get("index") or 0) > idx_us)
        ties = sum(1 for e in ents if per[e["key"]].get("index") == idx_us)
        pos_text = f"공동 {pos_us}위({ties}곳)" if ties > 1 else f"{pos_us}위"
    p("1. 결론")
    p(f"- 우리 종합 노출지수 {fmt(idx_us)}{delta(d_us.get('index'))}, 비교군 {len(ents)}곳 중 {pos_text}")
    total = sum(per[e['key']].get('index') or 0 for e in ents)
    if total and comps:
        p(f"- 노출 점유율 {round((s_us.get('index') or 0) / total * 100, 1)}% (비교군 지수 합 대비)")
        lead = ranked[0] if ranked[0]["key"] != us else (ranked[1] if len(ranked) > 1 else None)
        if lead:
            gap = round((per[lead['key']].get('index') or 0) - (s_us.get('index') or 0), 1)
            p(f"- {'1위 대비 격차' if ranked[0]['key'] != us else '2위와의 차이'}: {lead['key']} {fmt(per[lead['key']].get('index'))} / 차이 {gap}")
    if not comps:
        p("- 비교군 미등록: 아래 7번 후보에서 골라 marketing/config/entities.json의 competitors에 넣으면 다음 리포트부터 비교합니다.")
    p("")
    R["summary"] = {"index": fmt(idx_us), "index_delta": delta(d_us.get("index")),
                    "pos_text": pos_text, "n": len(ents),
                    "share": round((s_us.get("index") or 0) / total * 100, 1) if total and comps else None}
    if comps and total:
        lead = ranked[0] if ranked[0]["key"] != us else ranked[1]
        R["summary"].update(lead=lead["key"], lead_index=per[lead["key"]].get("index"), lead_is_first=ranked[0]["key"] != us,
                            gap=round((per[lead["key"]].get("index") or 0) - (s_us.get("index") or 0), 1))
    ch_rank = {}
    for ch, n in CHANNELS:
        vals = sorted((per[e["key"]].get(ch) for e in ents if per[e["key"]].get(ch) is not None), reverse=True)
        if s_us.get(ch) is not None and vals:
            ch_rank[n] = (vals.index(s_us[ch]) + 1, len(vals), s_us[ch], vals[0], vals.count(s_us[ch]))
    R["channel_rank"] = ch_rank

    # 2. 채널별 점수
    p("2. 채널별 점수 (0~100" + (", 괄호는 직전 대비: 두 회차 모두 측정된 같은 키워드·답변으로 다시 계산" if has_delta else "") + ")")
    head = "업체".ljust(16) + "".join(n.ljust(14) for _, n in CHANNELS) + "종합"
    p(head)
    for e in ranked:
        s, ds = per[e["key"]], deltas.get(e["key"], {})
        line = (e["key"][:14] + ("*" if e["key"] == us else "")).ljust(16)
        for ch, _ in CHANNELS:
            line += (fmt(s.get(ch)) + delta(ds.get(ch))).ljust(14)
        line += fmt(s.get("index")) + delta(ds.get("index"))
        p(line)
    if have["naver"]:
        p("파워링크 노출 키워드 수: " + ", ".join(
            f"{e['key']} {sum(1 for v in ranks.values() if v['ranks'][e['key']].get('ad'))}" for e in ranked))
        serp = read_json(mdir / "naver_serp.json", {})
        adv = Counter(it["key"] for v in serp.values() for it in v.get("items", []) if it["cls"] == "ad")
        if adv:
            p("파워링크 광고주(노출 키워드 수): " + ", ".join(f"{k} {n}" for k, n in adv.most_common(10)))
    if have["google"]:
        p("구글 지도 결과 노출 키워드 수: " + ", ".join(
            f"{e['key']} {sum(1 for v in ranks.values() if v['ranks'][e['key']].get('gmap'))}" for e in ranked))
    if ai:
        p("AI 언급률: " + ", ".join(f"{e['key']} {fmt(per[e['key']].get('ai_mention_rate'), '%')}" for e in ranked))
    p("")
    R["channels"] = [(e["key"], e["key"] == us,
                      [fmt(per[e["key"]].get(ch)) + delta(deltas.get(e["key"], {}).get(ch)) for ch, _ in CHANNELS],
                      fmt(per[e["key"]].get("index")) + delta(deltas.get(e["key"], {}).get("index")))
                     for e in ranked]
    R["counts"] = [(e["key"], e["key"] == us,
                    sum(1 for v in ranks.values() if v["ranks"][e["key"]].get("ad")) if have["naver"] else None,
                    sum(1 for v in ranks.values() if v["ranks"][e["key"]].get("gmap")) if have["google"] else None)
                   for e in ranked]
    R["advertisers"] = adv.most_common(10) if have["naver"] else []
    engines = sorted({r["engine"] for r in ai})
    R["ai_engines"] = engines
    R["ai_total"] = {en: sum(1 for r in ai if r["engine"] == en) for en in engines}
    R["ai_table"] = [(e["key"], e["key"] == us, [sum(1 for r in ai if r["engine"] == en and e["key"] in r["order"]) for en in engines],
                      fmt(per[e["key"]].get("ai_mention_rate"), "%"), sum(1 for r in ai if e["key"] in r["cites"]))
                     for e in sorted(ents, key=lambda e: -(per[e["key"]].get("ai_mention_rate") or 0))] if ai else []
    ptext = {x["id"]: x["prompt"] for x in prompts}
    R["ai_us"] = [(r["engine"], ptext.get(r["pid"], r["pid"]), r["order"].index(us) + 1, len(r["order"]))
                  for r in ai if us in r["order"]]

    # 3. 약점 목록
    p("3. 약점 목록 (경쟁사가 우리보다 위에 있는 키워드, 가중치 × 점수 차 순)")
    gaps, gap_rows = [], []
    for kw, v in ranks.items():
        mine = v["ranks"][us]
        for ch, chn in CHANNELS[:3]:
            if not v["measured"][ch]:
                continue
            mp = points(mine.get(ch), sc["rank_points"])
            best = None
            for e in comps:
                r = v["ranks"][e["key"]].get(ch)
                if r and (best is None or r < best[1]):
                    best = (e["key"], r)
            if best and points(best[1], sc["rank_points"]) > mp:
                g = v["weight"] * (points(best[1], sc["rank_points"]) - mp)
                note = ""
                if ch == "place":
                    li, mi = v["ranks"][best[0]].get("place_info"), mine.get("place_info")
                    if li:
                        mi = mi or {}
                        note = (f" / 방문자리뷰 {fmt(li.get('visitor_reviews'))} vs 우리 {fmt(mi.get('visitor_reviews'))},"
                                f" 사진 {fmt(li.get('image_count'))} vs {fmt(mi.get('image_count'))},"
                                f" 톡톡 {yn(li.get('talktalk'))} vs {yn(mi.get('talktalk'))}, 쿠폰 {yn(li.get('coupon'))} vs {yn(mi.get('coupon'))}")
                gaps.append((g, f"- [{chn}] {kw}: 우리 {rank_txt(mine.get(ch))}, {best[0]} {best[1]}위{note}", ch, kw))
                li, mi = (v["ranks"][best[0]].get("place_info") or {}), (mine.get("place_info") or {})
                pair = (lambda f, fn: f"{fn(li.get(f))} / {fn(mi.get(f))}") if ch == "place" and li else (lambda f, fn: "-")
                gap_rows.append((g, [chn.replace("네이버 ", ""), kw, rank_txt(mine.get(ch)), best[0],
                                     pair("visitor_reviews", fmt), pair("image_count", fmt), pair("talktalk", yn), pair("coupon", yn)]))
    gaps.sort(key=lambda x: -x[0])
    R["gaps"] = [r for _, r in sorted(gap_rows, key=lambda x: -x[0])][: sc.get("weak_top", 15)]
    if gaps:
        for _, line, _, _ in gaps[: sc.get("weak_top", 15)]:
            p(line)
    else:
        p("- 해당 없음" + ("(비교군 미등록)" if not comps else ""))
    p("")

    # 4. 키워드 변동
    p("4. 우리 순위 변동 (직전 대비, 3계단 이상 또는 노출·미노출 전환)")
    moves = rank_moves(cur, prev, us) if prev else []
    for m in moves or ["- 해당 없음" if prev else "- 직전 측정 없음"]:
        p(m)
    R["moves"] = [m[2:] for m in (moves or ["- 해당 없음" if prev else "- 직전 측정 없음"])]
    p("")

    # 5. 운영 점검(우리 측 감점 항목)
    p("5. 운영 점검 (우리 측 감점 항목, 관측된 것만)")
    flags = []
    miss = read_json(mdir / "missing.json", {})
    lost = [(t, v) for t, v in miss.items() if v.get("status") == "ok" and not v.get("found")]
    checked = [v for v in miss.values() if v.get("status") == "ok"]
    if checked:
        flags.append(f"- 발행 글 누락 의심 {len(lost)}건 / 점검 {len(checked)}건 (제목 검색 시 우리 글 미노출)")
        for t, v in lost[:10]:
            flags.append(f"    {v.get('date', '')} {t}")
    if LEDGER.exists():
        with LEDGER.open(encoding="utf-8") as f:
            ds = sorted(r["date"] for r in csv.DictReader(f) if r.get("date"))
        if ds:
            gap_days = (date.fromisoformat(mdir.name) - date.fromisoformat(ds[-1])).days
            if gap_days > sc.get("publish_gap_days", 28):
                flags.append(f"- 발행 공백 {gap_days}일 (마지막 발행 {ds[-1]})")
    phones = [norm(x).replace("-", "") for x in cfg["us"].get("phones", []) if x]
    if phones:
        for r in ai:
            if us not in r["order"]:
                continue
            t = r["text"]
            for n in ents[0]["names"]:
                i = t.find(n)
                if i < 0:
                    continue
                seg = t[i: i + 250]
                # 우리 항목 안만 본다: 다음 순번 항목이나 다른 업체 이름이 나오면 거기서 끊는다
                cut = [m.start() for m in re.finditer(r"\n\s*\d+\.\s", seg)]
                for e in ents[1:]:
                    cut += [seg.find(x) for x in e["names"] if seg.find(x) > 0]
                seg = seg[: min(cut)] if cut else seg
                for m in PHONE_RE.finditer(seg):
                    ph = re.sub(r"\D", "", m.group(0))
                    if ph not in phones:
                        flags.append(f"- AI 답변 전화번호 불일치 의심: {r['file']} ({m.group(0)})")
                break
    mine_place = [v["ranks"][us].get("place_info") for v in ranks.values() if v["ranks"][us].get("place_info")]
    if mine_place:
        mi = mine_place[0]
        flags.append(f"- 우리 플레이스 공개지표: 방문자리뷰 {fmt(mi.get('visitor_reviews'))}(평점 {fmt(mi.get('visitor_score'))}),"
                     f" 사진 {fmt(mi.get('image_count'))}, 예약 {yn(mi.get('booking'))}, 톡톡 {yn(mi.get('talktalk'))}, 쿠폰 {yn(mi.get('coupon'))}")
        pr = [f"{kw} {rank_txt(v['ranks'][us].get('place'))}/{fmt(v['ranks'][us].get('place_total'))}"
              for kw, v in ranks.items() if v["measured"]["place"] and v["ranks"][us].get("place_total")]
        if pr:
            flags.append("- 우리 플레이스 순위(전체 업체 수 대비): " + ", ".join(pr))
    for fl in flags or ["- 관측된 감점 항목 없음"]:
        p(fl)
    R["flags"] = [fl[2:] for fl in flags if fl.startswith("- ") and not fl.startswith("- 우리 플레이스 순위")]
    R["lost"] = [(v.get("date", ""), t) for t, v in lost[:10]]
    R["place_ranks"] = [(kw, rank_txt(v["ranks"][us].get("place")), fmt(v["ranks"][us].get("place_total")))
                        for kw, v in ranks.items() if v["measured"]["place"] and v["ranks"][us].get("place_total")]
    p("")

    # 6. 플레이스 상관 분석
    p("6. 플레이스 순위와 공개지표의 상관 (스피어만, -1에 가까울수록 지표가 클수록 상위)")
    plist = read_json(mdir / "place_list.json", {})
    rows = [x for v in plist.values() for x in v.get("places", []) if x.get("rank") and x["rank"] <= 20]
    for f, n in (("visitor_reviews", "방문자리뷰"), ("image_count", "사진 수")):
        pr = [(x["rank"], x[f]) for x in rows if x.get(f) is not None]
        rho = spearman([a1 for a1, _ in pr], [b1 for _, b1 in pr])
        p(f"- {n}: {fmt(rho)} (표본 {len(pr)}건)")
        R.setdefault("corr", []).append((n, fmt(rho), f"{len(pr)}건"))
    p("- 상관관계이며 인과가 아닙니다. 같은 업체가 여러 키워드에 중복 집계되고, 4주 이상 누적해야 경향으로 읽을 수 있습니다.")
    p("")

    # 7. 비교군 후보
    p("7. 비교군 후보 (우리·등록 업체·네트워크펌 제외, 상위 노출 가중 점수 순)")
    cand = discover(mdir, cfg, ents, kws)
    R["candidates"] = cand[: sc.get("discovery_top", 15)]
    for name, pid, s in cand[: sc.get("discovery_top", 15)] or [("- 후보 없음", "", "")]:
        p(f"- {name} (플레이스 {pid}) 점수 {s}" if pid else name)
    R["blog_candidates"] = blog_owner_candidates(cur["serp"], ents, kws)
    if R["blog_candidates"]:
        p("상위 노출 블로그 중 등록 업체와 연결되지 않은 주인(비교군이면 entities.json의 blog_ids에 넣는다)")
        for owner, name, s in R["blog_candidates"]:
            p(f"- {owner}{' (' + name + ')' if name else ''} 점수 {s}")
    p("")

    # 8. 상담 실적
    p("8. 상담·수임 실적")
    n8 = len(L)
    start = pdir.name if pdir else (date.fromisoformat(mdir.name) - timedelta(days=7)).isoformat()
    cs = consult_summary(start, mdir.name)
    if any(cs):
        lp = ROOT / "output" / "local" / f"{mdir.name}_상담요약.txt"
        lp.parent.mkdir(parents=True, exist_ok=True)
        lp.write_text("\n".join(consult_lines(start, mdir.name, cs)) + "\n", encoding="utf-8")
        p("- 리포트가 저장소에 올라가므로 상담 수치는 넣지 않았습니다. 이 PC의 output/local 폴더에 있는 상담요약 파일을 보세요")
    else:
        p(f"- 입력 없음(data/{CONSULTS.name}는 이 PC에만 남고 올라가지 않습니다)")
    measures = [load_measure(d, ents, kws, prompts, sc, owner_names) for d in trend_dirs if fresh[d.name]]
    hist = index_trend(measures, us, ents, sc) if len(measures) >= 2 else []
    if len([h for h in hist if h[1] is not None]) >= 2:
        p("- 노출지수 추이(모든 회차에 공통인 키워드·답변 기준): " + " / ".join(f"{d} {fmt(v)}" for d, v in hist))
    R["consults"] = [x[2:] for x in L[n8:]]
    p("")

    # 9. 다음 과제 후보
    p("9. 다음 과제 후보 (위 관측 결과에서 기계적으로 도출, 최종 선택은 사무장님)")
    todo = []
    content_kw = [kw for _, _, ch, kw in gaps if ch in ("naver", "google")]
    place_kw = [kw for _, _, ch, kw in gaps if ch == "place"]
    if content_kw:
        todo.append(f"- 콘텐츠 열세 키워드 주제 기획 투입(topic-planner): {', '.join(dict.fromkeys(content_kw[:6]))}")
    if place_kw:
        todo.append(f"- 플레이스 열세 키워드 점검(정보 충실도, 소식 게시, 키워드 등록, 정당한 리뷰 요청): {', '.join(dict.fromkeys(place_kw[:6]))}")
    if ai and (s_us.get("ai_mention_rate") or 0) < 50:
        todo.append("- AI 언급률 50% 미만: 지역·분야명이 들어간 FAQ형 글과 홈페이지·플레이스 정보 일치 점검")
    if checked and lost:
        todo.append(f"- 누락 의심 글 {len(lost)}건 원인 점검(중복 문구, 금지 표현, 발행 직후 수정 여부)")
    for t in todo or ["- 도출된 과제 없음"]:
        p(t)
    R["todo"] = []
    for t in todo or ["- 도출된 과제 없음"]:
        head, _, items = t[2:].partition(": ")
        R["todo"].append((head, items.split(", ") if items else []))

    outdir = ROOT / "output" / "marketing"
    outdir.mkdir(parents=True, exist_ok=True)
    rp = outdir / f"{mdir.name}_리포트.txt"
    rp.write_text("\n".join(L) + "\n", encoding="utf-8")
    cp = outdir / f"{mdir.name}_키워드표.csv"
    with cp.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["키워드", "가중치", "업체", "네이버콘텐츠", "플레이스", "통합검색플레이스블록", "구글", "파워링크"])
        for kw, v in ranks.items():
            for e in ents:
                r = v["ranks"][e["key"]]
                w.writerow([kw, round(v["weight"], 1), e["key"], r.get("naver") or "", r.get("place") or "",
                            r.get("place_block") or "", r.get("google") or "", "Y" if r.get("ad") else ""])
    print("\n".join(L))
    print(f"\n저장: {rp}\n저장: {cp}")
    try:
        from mkt_docx import build
    except ImportError:
        print("DOCX 생략: python-docx 미설치(py -m pip install python-docx)")
        return
    dp = save_docx(build, R, outdir / f"{mdir.name}_리포트.docx")
    print(f"저장: {dp}")


if __name__ == "__main__":
    main()
