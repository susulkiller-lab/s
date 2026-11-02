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
import math
import os
import re
import sys
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mkt_collect import reparse_if_old  # noqa: E402
from mkt_common import (AI_EXPECTED_ENGINES, CONSULTS, CONSULTS_OLD, CONTENT_CLASSES, LEDGER, ROOT, UNKNOWN_OWNER,  # noqa: E402
                        ai_expected, channel_status, check_ai_files, curve_points, is_network, load_entities,
                        load_scoring, match_item, measure_dirs, norm, points, read_json, read_keywords, read_prompts,
                        read_rows, write_json)
from mkt_stats import age_days, distance_km, name_kw, pct, spearman, wilson  # noqa: E402

CHANNELS = [("naver", "네이버 콘텐츠"), ("place", "네이버 플레이스"), ("google", "구글"), ("gmap", "구글 지도"),
            ("ai", "AI 검색")]
SEARCH = ("naver", "place", "google")  # 수집 단위 채널
SCORED = SEARCH + ("gmap",)  # 키워드 순위로 점수를 매기는 채널(구글 지도는 구글 화면에서 같이 읽는다)
CONSULT_HEADER = "date,channel,area,region,retained,memo"
PLACE_FIELDS = ("visitor_reviews", "visitor_score", "blog_reviews", "image_count", "booking", "talktalk", "coupon",
                "distance", "hours", "name")
XY_RE = re.compile(r'"x":"([\d.]+)","y":"([\d.]+)"')
LAW_WORDS = ("변호사", "법률", "법무", "로펌", "law")
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


def place_src(rec):
    """플레이스 목록의 측정 기준(좌표). 좌표가 다른 회차끼리는 순위를 비교하지 않는다."""
    xy = rec.get("xy") or {}
    if xy.get("lat"):
        return f"list@{float(xy['lng']):.4f},{float(xy['lat']):.4f}"
    m = XY_RE.search(str(rec.get("input") or ""))
    return f"list@{float(m.group(1)):.4f},{float(m.group(2)):.4f}" if m else "list"


def ranks_for(mdir, ents, kws, sc, owner_names=None, suffix=""):
    """키워드 × 업체별 채널 순위. 수집이 기준에 못 미친 채널은 미측정으로 돌린다. suffix="_rep"이면 재측정 파일."""
    serp = read_json(mdir / f"naver_serp{suffix}.json", {})
    plist = read_json(mdir / f"place_list{suffix}.json", {})
    goog = read_json(mdir / f"google{suffix}.json", {})
    fill_owner_names(serp, owner_names or {})
    fill_owner_names(goog, owner_names or {})
    status = channel_status(mdir, kws, suffix)
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
                r["gmap"] = best_rank([i for i in g_items if i["cls"] == "gmap"], e, "pos")
            row[e["key"]] = r
        out[kw] = {"weight": k["weight"], "ranks": row, "area": (k.get("area") or "").strip(),
                   "region": (k.get("region") or "").strip(),
                   "place_src": place_src(plist[kw]) if p_rows is not None else ("block" if s_items is not None and not no_place else None),
                   "measured": {"naver": s_items is not None, "place": not no_place and (p_rows is not None or s_items is not None),
                                "google": g_items is not None, "gmap": g_items is not None}}
    least = sc.get("min_channel_coverage", 0.7)
    have = {}
    for ch in SEARCH:
        n = sum(1 for v in out.values() if v["measured"][ch])
        have[ch] = bool(n) and n / max(status[ch]["target"], 1) >= least
        if not have[ch]:
            for v in out.values():
                v["measured"][ch] = False
    have["gmap"] = have["google"]
    if not have["gmap"]:
        for v in out.values():
            v["measured"]["gmap"] = False
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
    """모든 회차에서 측정된 키워드와 AI 답변만 남긴다. 플레이스는 출처(목록 좌표·통합검색 영역)까지 같아야 한다."""
    common = {}
    for ch in SCORED:
        kws = [kw for kw in measures[0]["ranks"]
               if all(kw in m["ranks"] and m["ranks"][kw]["measured"][ch] for m in measures)]
        if ch == "place":
            kws = [kw for kw in kws if len({m["ranks"][kw].get("place_src") for m in measures}) == 1]
        common[ch] = set(kws)
    return common, set.intersection(*[{ai_key(r) for r in m["ai"]} for m in measures])


def rescored(m, common, ai_keys, ents, sc):
    ranks = {kw: dict(v, measured={ch: v["measured"].get(ch, False) and kw in common[ch] for ch in SCORED})
             for kw, v in m["ranks"].items()}
    return score(ranks, {ch: bool(common[ch]) for ch in SCORED}, [r for r in m["ai"] if ai_key(r) in ai_keys], ents, sc)


def compare(cur, prev, ents, sc):
    """같은 키워드·채널·답변으로 두 회차를 다시 계산한 변동. 겹치는 범위가 기준보다 좁은 채널은 변동을 숨긴다."""
    least = sc.get("min_channel_coverage", 0.7)
    common, ai_keys = common_keys([cur, prev])
    counts, hidden = {}, {}
    for ch in SCORED:
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
        delta[e["key"]] = {x: round(a[x] - b[x], 1) for x in (*SCORED, "ai", "index")
                           if a.get(x) is not None and b.get(x) is not None}
    band = delta_band(cur, prev, common, ai_keys, ents, sc)
    return {"delta": delta, "counts": counts, "hidden": hidden, "band": band}


def _resample(ranks, ai, rng):
    """키워드와 AI 답변을 복원 추출한 표본 하나. 같은 키워드가 여러 번 뽑히면 이름을 달리해 따로 센다."""
    kws = list(ranks)
    pick = [rng.choice(kws) for _ in kws] if kws else []
    r2 = {f"{kw}#{i}": ranks[kw] for i, kw in enumerate(pick)}
    a2 = [rng.choice(ai) for _ in ai] if ai else []
    return r2, a2, pick


def _pos(per, key):
    v = per[key].get("index")
    if v is None:
        return None
    return 1 + sum(1 for x in per.values() if (x.get("index") or 0) > v)


def uncertainty(m, ents, sc, us):
    """키워드·답변을 다시 뽑아(부트스트랩) 우리 종합지수와 순위가 흔들릴 수 있는 범위(90%)를 낸다.
    다른 키워드를 골랐어도 나왔을 범위라, 이 범위 안의 차이는 측정 키워드 구성 탓일 수 있다."""
    import random
    B = int(sc.get("bootstrap", 0) or 0)
    if B <= 0 or m["per"][us].get("index") is None:
        return None
    rng = random.Random(20261102)
    idx, pos = [], []
    for _ in range(B):
        r2, a2, _ = _resample(m["ranks"], m["ai"], rng)
        per = score(r2, m["have"], a2, ents, sc)
        if per[us].get("index") is not None:
            idx.append(per[us]["index"])
            pos.append(_pos(per, us))
    if not idx:
        return None
    idx.sort()
    pos.sort()
    return {"index": (round(pct(idx, 0.05), 1), round(pct(idx, 0.95), 1)),
            "pos": (round(pct(pos, 0.05)), round(pct(pos, 0.95))), "n": len(idx)}


def delta_band(cur, prev, common, ai_keys, ents, sc):
    """두 회차의 공통 키워드·답변을 같은 방식으로 다시 뽑아 업체별 종합지수 변동의 90% 범위를 낸다.
    범위가 0을 포함하면 '변화 판단 불가'(키워드 구성에 따른 흔들림 안)로 본다."""
    import random
    B = int(sc.get("bootstrap", 0) or 0)
    kws = sorted(set().union(*common.values())) if common else []
    if B <= 0 or not kws:
        return {}
    rng = random.Random(20261103)
    ak = sorted(ai_keys)
    cur_ai = {ai_key(r): r for r in cur["ai"]}
    prev_ai = {ai_key(r): r for r in prev["ai"]}
    out = {e["key"]: [] for e in ents}
    for _ in range(B):
        pick = [rng.choice(kws) for _ in kws]
        apick = [rng.choice(ak) for _ in ak] if ak else []
        pers = []
        for m in (cur, prev):
            r2 = {}
            for i, kw in enumerate(pick):
                v = m["ranks"].get(kw)
                if v:
                    r2[f"{kw}#{i}"] = dict(v, measured={ch: v["measured"].get(ch, False) and kw in common[ch] for ch in SCORED})
            src = cur_ai if m is cur else prev_ai
            pers.append(score(r2, {ch: bool(common[ch]) for ch in SCORED}, [src[k] for k in apick], ents, sc))
        for e in ents:
            a, b = pers[0][e["key"]].get("index"), pers[1][e["key"]].get("index")
            if a is not None and b is not None:
                out[e["key"]].append(a - b)
    band = {}
    for k, v in out.items():
        if v:
            v.sort()
            band[k] = (round(pct(v, 0.05), 1), round(pct(v, 0.95), 1))
    return band


def judge(d, band):
    """변동값을 범위와 비교한 판정 문구."""
    if d is None or not band:
        return ""
    lo, hi = band
    if lo > 0:
        return "상승(범위 밖)"
    if hi < 0:
        return "하락(범위 밖)"
    return "변화 판단 불가(오차 범위 안)"


def rank_moves(cur, prev, us, thresh=None):
    """두 회차 모두 측정된 키워드에서만 우리 순위 변동을 찾는다. thresh: 채널별 최소 계단 수(재측정 흔들림 반영)."""
    moves = []
    thresh = thresh or {}
    for kw, v in cur["ranks"].items():
        old = prev["ranks"].get(kw)
        if not old:
            continue
        for ch, chn in [c for c in CHANNELS if c[0] in SCORED]:
            if not (v["measured"].get(ch) and old["measured"].get(ch)):
                continue
            if ch == "place" and v.get("place_src") != old.get("place_src"):
                continue
            a1, b1 = v["ranks"][us].get(ch), old["ranks"][us].get(ch)
            if (a1 is None) != (b1 is None) or (a1 and b1 and abs(a1 - b1) >= thresh.get(ch, 3)):
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
    """채널 점수 = Σ(키워드 가중치 × 순위 점수) ÷ Σ(키워드 가중치 × 10) × 100. 종합은 채널 가중 평균."""
    w = sc["channel_weights"]
    per = {e["key"]: {} for e in ents}
    for ch in SCORED:
        if not have.get(ch) or ch not in w:
            continue
        rows = [v for v in ranks.values() if v["measured"].get(ch)]
        den = sum(v["weight"] for v in rows) * 10
        for e in ents:
            num = sum(v["weight"] * curve_points(v["ranks"][e["key"]].get(ch), sc) for v in rows)
            per[e["key"]][ch] = round(num / den * 100, 1) if den else None
    if ai:
        for e in ents:
            pts = [points(r["order"].index(e["key"]) + 1 if e["key"] in r["order"] else None, sc["ai_mention_points"])
                   for r in ai]
            per[e["key"]]["ai"] = round(sum(pts) / (len(pts) * 10) * 100, 1)
            per[e["key"]]["ai_mention_rate"] = round(sum(1 for r in ai if e["key"] in r["order"]) / len(ai) * 100, 1)
    for e in ents:
        s = per[e["key"]]
        got = [(w[ch], s[ch]) for ch, _ in CHANNELS if s.get(ch) is not None and ch in w]
        tw = sum(x for x, _ in got)
        s["index"] = round(sum(x * y for x, y in got) / tw, 1) if tw else None
    return per


def repeat_noise(mdir, cur, ents, kws, sc, owner_names):
    """같은 날 재측정(*_rep.json)과 본 측정의 차이. 이 폭 안의 변동은 측정 흔들림일 수 있다."""
    rep_keys = set()
    for fname in ("naver_serp_rep.json", "place_list_rep.json", "google_rep.json"):
        rep_keys |= set(read_json(mdir / fname, {}))
    rows = [k for k in kws if k["keyword"] in rep_keys and k["keyword"] in cur["ranks"]]
    if not rows:
        return None
    rr, rhave, _, _ = ranks_for(mdir, ents, rows, sc, owner_names, "_rep")
    out = {"n": len(rows), "ch": {}}
    for ch in SCORED:
        diffs, agree, total = [], 0, 0
        for k in rows:
            kw = k["keyword"]
            a_v, b_v = cur["ranks"][kw], rr[kw]
            if not (a_v["measured"].get(ch) and b_v["measured"].get(ch)):
                continue
            if ch == "place" and a_v.get("place_src") != b_v.get("place_src"):
                continue
            for e in ents:
                a, b = a_v["ranks"][e["key"]].get(ch), b_v["ranks"][e["key"]].get(ch)
                if not a and not b:
                    continue
                total += 1
                agree += (a is None) == (b is None)
                if a and b:
                    diffs.append(abs(a - b))
        if total:
            out["ch"][ch] = {"mean": round(sum(diffs) / len(diffs), 1) if diffs else 0.0,
                             "agree": round(agree / total * 100), "pairs": total}
    sub = {k["keyword"]: cur["ranks"][k["keyword"]] for k in rows}
    p1 = score(sub, cur["have"], [], ents, sc)
    p2 = score(rr, rhave, [], ents, sc)
    us = ents[0]["key"]
    d = [abs(p1[e["key"]]["index"] - p2[e["key"]]["index"]) for e in ents
         if p1[e["key"]].get("index") is not None and p2[e["key"]].get("index") is not None]
    out["idx_us"] = (p1[us].get("index"), p2[us].get("index"))
    out["idx_mean"] = round(sum(d) / len(d), 1) if d else None
    return out


def detail_metrics(ranks, key, ch):
    """한 업체·채널의 세부 지표: 측정 키워드 수, 상위 3·10위 키워드 수, 노출 키워드 수, 노출 시 평균 순위."""
    rs = [v["ranks"][key].get(ch) for v in ranks.values() if v["measured"].get(ch)]
    shown = [r for r in rs if r]
    return {"n": len(rs), "top3": sum(1 for r in shown if r <= 3), "top10": sum(1 for r in shown if r <= 10),
            "shown": len(shown), "avg": round(sum(shown) / len(shown), 1) if shown else None}


def detail_txt(d):
    return (f"상위3 {d['top3']} / 상위10 {d['top10']} / 노출 {d['shown']}"
            + (f" / 노출 시 평균 {d['avg']}위" if d["avg"] is not None else ""))


def group_indices(m, ents, sc, us, prompts):
    """분야별(형사·민사·가사·행정·종합)과 지역별 종합지수. 분야는 AI 질문의 분야도 같이 넣는다."""
    area_of = {x["id"]: (x.get("area") or "").strip() for x in prompts}
    out = []
    for kind, field in (("분야", "area"), ("지역", "region")):
        groups = list(dict.fromkeys(v[field] for v in m["ranks"].values() if v.get(field)))
        for g in groups:
            sub = {kw: v for kw, v in m["ranks"].items() if v.get(field) == g}
            ai = [r for r in m["ai"] if kind == "분야" and area_of.get(r["pid"]) == g]
            per = score(sub, m["have"], ai, ents, sc)
            if per[us].get("index") is None:
                continue
            top = max(ents, key=lambda e: per[e["key"]].get("index") or 0)
            ties = sum(1 for e in ents if per[e["key"]].get("index") == per[us]["index"])
            pos = _pos(per, us)
            out.append({"kind": kind, "group": g, "kws": len(sub), "ai": len(ai), "index": per[us]["index"],
                        "pos": pos, "pos_text": f"공동 {pos}위({ties}곳)" if ties > 1 else f"{pos}위",
                        "n": len(ents), "top": top["key"], "top_index": per[top["key"]].get("index")})
    return out


def content_owners(serp, ents, kws, sc):
    """네이버 콘텐츠 상위 10건의 주인 구성. 미등록 법률 블로그가 많은 키워드는 경쟁사 블로그를 못 찾았을 수 있어
    네이버 콘텐츠 비교를 참고용으로 본다."""
    tally, alert = Counter(), []
    n_kw = 0
    for k in kws:
        rec = serp.get(k["keyword"]) or {}
        top = [it for it in rec.get("items", []) if it.get("content_pos") and it["content_pos"] <= 10]
        if not top:
            continue
        n_kw += 1
        c = Counter()
        for it in top:
            if any(match_item(it, e) for e in ents):
                c["등록 업체"] += 1
            elif it["cls"] == "blog":
                nm = (it.get("owner_name") or "").lower()
                c["미등록 법률 블로그" if nm and any(w in nm for w in LAW_WORDS) else ("주인 미상 블로그" if not nm else "일반 블로그")] += 1
            else:
                c["카페·지식인·웹"] += 1
        tally.update(c)
        if c["미등록 법률 블로그"] / len(top) >= sc.get("law_blog_alert", 0.4):
            alert.append(k["keyword"])
    total = sum(tally.values())
    shares = [(name, round(tally[name] / total * 100)) for name in
              ("등록 업체", "미등록 법률 블로그", "주인 미상 블로그", "일반 블로그", "카페·지식인·웹") if total] if total else []
    return {"keywords": n_kw, "shares": shares, "alert": alert}


def freshness(serp, ents, day, days):
    """네이버 콘텐츠 상위 10건의 게시 시점. 업체별로 상위 10위 안 글 수와 그중 최근 글 수를 센다."""
    known = fresh = 0
    per = {e["key"]: [0, 0] for e in ents}
    for rec in serp.values():
        for it in rec.get("items", []):
            if not it.get("content_pos") or it["content_pos"] > 10:
                continue
            age = age_days(it.get("text", ""), day)
            if age is not None:
                known += 1
                fresh += age <= days
            for e in ents:
                if match_item(it, e):
                    per[e["key"]][0] += 1
                    per[e["key"]][1] += age is not None and age <= days
                    break
    return {"known": known, "fresh": fresh, "per": per}


def place_factors(plist, kws):
    """플레이스 순위와 공개지표의 상관을 키워드 안에서 계산해 평균한다(표본 8곳 이상인 키워드만, 업체 수 가중).
    음수일수록 '지표가 클수록 상위'와 관련. 거리는 가까울수록 큰 값이 되도록 뒤집었다."""
    metrics = (("방문자리뷰", lambda x, kw: x.get("visitor_reviews")),
               ("블로그리뷰", lambda x, kw: x.get("blog_reviews")),
               ("사진 수", lambda x, kw: x.get("image_count")),
               ("업체명의 키워드 단어", lambda x, kw: name_kw(x.get("name"), kw)[0]),
               ("가까움(거리 역순)", lambda x, kw: -distance_km(x.get("distance")) if distance_km(x.get("distance")) is not None else None))
    out = []
    for name, fn in metrics:
        acc, n_kw, n_rows = 0.0, 0, 0
        for k in kws:
            rows = [(x["rank"], fn(x, k["keyword"])) for x in (plist.get(k["keyword"]) or {}).get("places", []) if x.get("rank")]
            rows = [(a, b) for a, b in rows if b is not None]
            if len(rows) < 8:
                continue
            rho = spearman([a for a, _ in rows], [b for _, b in rows])
            if rho is None:
                continue
            acc += rho * len(rows)
            n_kw += 1
            n_rows += len(rows)
        out.append((name, round(acc / n_rows, 2) if n_rows else None, n_kw, n_rows))
    return out


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
    write_json(mdir / "scores.json", {"scores": per, "ranks": ranks, "ai": [{k: v for k, v in r.items() if k != "text"} for r in ai],
                                      "scoring": {k: sc.get(k) for k in ("rank_curve", "channel_weights")}})
    # 두 회차의 분류 규칙이 같을 때만 비교한다
    prev = load_measure(pdir, ents, kws, prompts, sc, owner_names) if pdir and fresh[pdir.name] and fresh[mdir.name] else None
    cmp = compare(cur, prev, ents, sc) if prev else None
    deltas = cmp["delta"] if cmp else {}
    has_delta = any(deltas.values())
    noise = repeat_noise(mdir, cur, ents, kws, sc, owner_names)
    unc = uncertainty(cur, ents, sc, us)
    meta = read_json(mdir / "meta.json", {})
    pmeta = read_json(pdir / "meta.json", {}) if pdir else {}

    warnings = measure_warnings(cur, ents, prompts)
    if not fresh[mdir.name]:
        warnings.append("이번 회차 원본이 없어 옛 분류 규칙 결과를 그대로 썼습니다")
    if pdir and not prev:
        warnings.append(f"원본이 없어 {pdir.name} 측정과 분류 규칙을 맞추지 못했습니다. 변동을 표시하지 않습니다")
    if cmp and cmp["hidden"]:
        names = dict(CHANNELS)
        warnings.append("변동 미표시: " + ", ".join(f"{names[ch]}(겹치는 범위 {n}/{m})" for ch, (n, m) in cmp["hidden"].items()))
    if not any(r.get("volume") not in (None, "") and str(r.get("volume")).strip() for r in kws):
        warnings.append("키워드 검색량 미입력: 모든 키워드를 같은 무게로 셉니다(keywords.csv의 volume 칸에 네이버 검색광고 월간 검색수를 넣으면 반영)")
    if prev and meta.get("pc") and pmeta.get("pc") and meta["pc"] != pmeta["pc"]:
        warnings.append("측정 PC가 직전 회차와 다릅니다. 구글 결과는 접속 위치(인터넷 회선)의 영향을 받을 수 있어 구글 변동은 참고로 보세요")
    if prev:
        moved = [kw for kw, v in ranks.items() if kw in prev["ranks"] and str(v.get("place_src", "")).startswith("list@")
                 and str(prev["ranks"][kw].get("place_src", "")).startswith("list@")
                 and v["place_src"] != prev["ranks"][kw]["place_src"]]
        if moved:
            warnings.append(f"플레이스 측정 좌표가 바뀐 키워드 {len(moved)}개({', '.join(moved[:4])}{' 등' if len(moved) > 4 else ''})는 플레이스 변동 비교에서 뺐습니다(지역 좌표 적용)")

    L = []
    p = L.append
    p(f"진앤솔법률사무소 마케팅 노출 리포트 ({mdir.name} 측정)")
    p(f"비교 기준: {pdir.name + ' 측정' if pdir else '직전 측정 없음(이번이 기준선)'}")
    collect = status_line(cur, prompts)
    p(f"수집 현황: {collect}")
    compare_txt = compare_line(cmp) if cmp else ""
    if compare_txt:
        p(f"변동 비교 범위(두 회차 공통/이번 회차): {compare_txt}")
    when = (f", 측정 시각 {meta['started_at'][11:16]}~{meta.get('finished_at', '')[11:16]}({meta.get('weekday', '')})"
            if meta.get("started_at") else "")
    regions = ", ".join(meta.get("regions", {})) if meta.get("regions") else ""
    conditions = (f"키워드 {len(kws)}개, 기기 {meta.get('device', '-')}, 수집 단계 {', '.join(meta.get('steps', [])) or '-'}, "
                  f"AI 답변 {len(ai)}건{when}" + (f", 플레이스 지역 좌표 {regions}(그 밖은 사무실)" if regions else "")
                  + (f", 같은 날 재측정 {noise['n']}개 키워드" if noise else ""))
    p(f"측정 조건: {conditions}")
    missing_ch = [n for ch, n in CHANNELS if (ch == "ai" and not ai) or (ch != "ai" and not have[ch])]
    if missing_ch:
        p(f"미측정 채널: {', '.join(missing_ch)} (종합지수는 측정된 채널 가중치로만 환산)")
    for w_line in warnings:
        p(f"주의: {w_line}")
    p("")
    # 문서(DOCX)용 구조화 데이터. 텍스트 리포트와 같은 값을 담는다.
    R = {"date": mdir.name, "prev": pdir.name if pdir else None, "us": us, "collect": collect, "compare": compare_txt,
         "warnings": warnings, "has_delta": has_delta,
         "conditions": conditions,
         "missing_channels": missing_ch, "channel_names": [n for _, n in CHANNELS]}

    # 1. 결론
    s_us = per[us]
    comps = [e for e in ents if e["role"] == "competitor"]
    ranked = sorted(ents, key=lambda e: per[e["key"]].get("index") or 0, reverse=True)
    idx_us = s_us.get("index")
    d_us = deltas.get(us, {})
    band_us = (cmp or {}).get("band", {}).get(us)
    verdict = judge(d_us.get("index"), band_us)
    if idx_us is None:
        pos_text = "순위 없음(측정된 채널 없음)"
    else:
        pos_us = 1 + sum(1 for e in ents if (per[e["key"]].get("index") or 0) > idx_us)
        ties = sum(1 for e in ents if per[e["key"]].get("index") == idx_us)
        pos_text = f"공동 {pos_us}위({ties}곳)" if ties > 1 else f"{pos_us}위"
    p("1. 결론")
    p(f"- 우리 종합 노출지수 {fmt(idx_us)}{delta(d_us.get('index'))}, 비교군 {len(ents)}곳 중 {pos_text}")
    unc_txt = (f"지수 {unc['index'][0]}~{unc['index'][1]}, 순위 {unc['pos'][0]}~{unc['pos'][1]}위" if unc else "")
    if unc:
        p(f"- 오차 범위(측정 키워드·답변을 다시 뽑아 계산한 90% 범위): {unc_txt}")
    if verdict:
        p(f"- 직전 대비 판정: {verdict}, 변동 범위 {band_us[0]:+}~{band_us[1]:+}")
    if noise and noise["idx_us"][0] is not None and noise["idx_us"][1] is not None:
        p(f"- 같은 날 재측정({noise['n']}개 키워드): 우리 지수 {noise['idx_us'][0]} / {noise['idx_us'][1]}, "
          f"비교군 평균 차이 {fmt(noise['idx_mean'])}점")
    total = sum(per[e['key']].get('index') or 0 for e in ents)
    if total and comps:
        p(f"- 노출 점유율 {round((s_us.get('index') or 0) / total * 100, 1)}% (비교군 지수 합 대비)")
        lead = ranked[0] if ranked[0]["key"] != us else (ranked[1] if len(ranked) > 1 else None)
        if lead:
            gap = round((per[lead['key']].get('index') or 0) - (s_us.get('index') or 0), 1)
            p(f"- {'1위 대비 격차' if ranked[0]['key'] != us else '2위와의 차이'}: {lead['key']} {fmt(per[lead['key']].get('index'))} / 차이 {gap}")
    if not comps:
        p("- 비교군 미등록: 아래 11번 후보에서 골라 marketing/config/entities.json의 competitors에 넣으면 다음 리포트부터 비교합니다.")
    p("")
    R["summary"] = {"index": fmt(idx_us), "index_delta": delta(d_us.get("index")),
                    "pos_text": pos_text, "n": len(ents), "unc": unc_txt, "verdict": verdict,
                    "band": f"{band_us[0]:+}~{band_us[1]:+}" if band_us else "",
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
    cv = sc.get("rank_curve")
    R["curve_note"] = (f"순위 점수: 1위 10점에서 한 계단마다 {round((1 - cv.get('decay', 0.85)) * 100)}%씩 줄어 "
                       f"{cv.get('max_rank', 30)}위까지 반영(10위 밖 변동도 점수에 나타남)" if cv
                       else "순위 점수: 1위 10, 2위 8, 3위 6, 4~5위 4, 6~10위 2")
    p(R["curve_note"])
    head = "업체".ljust(16) + "".join(n.ljust(14) for _, n in CHANNELS) + "종합"
    p(head)
    for e in ranked:
        s, ds = per[e["key"]], deltas.get(e["key"], {})
        line = (e["key"][:14] + ("*" if e["key"] == us else "")).ljust(16)
        for ch, _ in CHANNELS:
            line += (fmt(s.get(ch)) + delta(ds.get(ch))).ljust(14)
        line += fmt(s.get("index")) + delta(ds.get("index"))
        p(line)
    adv = Counter()
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

    def ci_txt(e):
        k = sum(1 for r in ai if e["key"] in r["order"])
        c = wilson(k, len(ai))
        return f"{c[0]}~{c[1]}%" if c else "-"
    R["ai_table"] = [(e["key"], e["key"] == us, [sum(1 for r in ai if r["engine"] == en and e["key"] in r["order"]) for en in engines],
                      fmt(per[e["key"]].get("ai_mention_rate"), "%"), sum(1 for r in ai if e["key"] in r["cites"]), ci_txt(e))
                     for e in sorted(ents, key=lambda e: -(per[e["key"]].get("ai_mention_rate") or 0))] if ai else []
    ptext = {x["id"]: x["prompt"] for x in prompts}
    R["ai_us"] = [(r["engine"], ptext.get(r["pid"], r["pid"]), r["order"].index(us) + 1, len(r["order"]))
                  for r in ai if us in r["order"]]

    # 3. 세부 지표
    p("3. 채널별 세부 지표 (우리 vs 그 채널 점수 1위 업체, 키워드 수)")
    R["detail"] = []
    for ch, chn in CHANNELS:
        if ch == "ai" or not have.get(ch):
            continue
        dm = detail_metrics(ranks, us, ch)
        leader = max(comps, key=lambda e: per[e["key"]].get(ch) or 0) if comps else None
        dl = detail_metrics(ranks, leader["key"], ch) if leader else None
        p(f"- {chn}(측정 {dm['n']}): 우리 {detail_txt(dm)}" + (f" | {leader['key']} {detail_txt(dl)}" if dl else ""))
        R["detail"].append((chn, dm, leader["key"] if leader else "-", dl))
    if ai:
        k_us = sum(1 for r in ai if us in r["order"])
        c = wilson(k_us, len(ai))
        first = sum(1 for r in ai if r["order"][:1] == [us])
        p(f"- AI 검색(답변 {len(ai)}): 우리 언급 {k_us}건({fmt(s_us.get('ai_mention_rate'), '%')}, 95% 범위 {c[0]}~{c[1]}%), "
          f"등록 업체 중 첫 번째 언급 {first}건, 출처 인용 {sum(1 for r in ai if us in r['cites'])}건")
        R["detail_ai"] = (len(ai), k_us, fmt(s_us.get("ai_mention_rate"), "%"), f"{c[0]}~{c[1]}%", first,
                          sum(1 for r in ai if us in r["cites"]))
    p("")

    # 4. 분야·지역별
    p("4. 분야·지역별 종합지수 (그 분야·지역 키워드만으로 다시 계산, 분야에는 같은 분야 AI 질문 포함)")
    groups = group_indices(cur, ents, sc, us, prompts)
    for g in groups:
        p(f"- [{g['kind']}] {g['group']}(키워드 {g['kws']}" + (f", AI {g['ai']}" if g["ai"] else "") + f"): 우리 {g['index']}, "
          f"{g['n']}곳 중 {g['pos_text']} / 1위 {g['top']} {fmt(g['top_index'])}")
    small = [g["group"] for g in groups if g["kws"] < 3]
    if small:
        p(f"- 키워드 3개 미만 그룹({', '.join(small)})은 한두 키워드 결과에 크게 흔들립니다")
    R["groups"] = groups
    p("")

    # 5. 측정 신뢰도
    p("5. 측정 신뢰도 (이 범위 안의 차이는 실제 변화가 아니라 측정 흔들림일 수 있습니다)")
    rel = []
    if unc:
        rel.append(f"종합지수 오차 범위: {unc_txt} (키워드·답변 {sc.get('bootstrap')}회 재추출, 90%)")
    if noise:
        names = dict(CHANNELS)
        for ch, v in noise["ch"].items():
            rel.append(f"같은 날 재측정 {names[ch]}: 노출 여부 일치 {v['agree']}%, 노출 순위 평균 차이 {v['mean']}계단 (비교 {v['pairs']}건)")
    else:
        rel.append("같은 날 재측정 없음(collect.json의 repeat_keywords를 넣고 수집하면 흔들림 폭을 잽니다)")
    if ai:
        rel.append(f"AI 답변 {len(ai)}건 기준 언급률 95% 범위: " + ", ".join(
            f"{k} {rate}({ci})" for k, _, _, rate, _, ci in R["ai_table"][:6] if rate not in ("0.0%", "-")))
    own = content_owners(cur["serp"], ents, kws, sc)
    if own["shares"]:
        rel.append("네이버 콘텐츠 상위 10건의 주인 구성: " + ", ".join(f"{n} {v}%" for n, v in own["shares"]))
    if own["alert"]:
        rel.append(f"미등록 법률 블로그가 상위 10건의 {round(sc.get('law_blog_alert', 0.4) * 100)}% 이상인 키워드 {len(own['alert'])}개"
                   f"({', '.join(own['alert'][:6])}{' 등' if len(own['alert']) > 6 else ''}): 경쟁사 블로그를 못 찾았을 수 있어 네이버 콘텐츠 비교는 참고")
    for r_line in rel:
        p(f"- {r_line}")
    R["reliability"] = rel
    p("")

    # 6. 약점 목록
    p("6. 약점 목록 (경쟁사가 우리보다 위에 있는 키워드, 가중치 × 점수 차 순)")
    gaps, gap_rows = [], []
    for kw, v in ranks.items():
        mine = v["ranks"][us]
        for ch, chn in [c for c in CHANNELS if c[0] in SCORED]:
            if not v["measured"].get(ch):
                continue
            mp = curve_points(mine.get(ch), sc)
            best = None
            for e in comps:
                r = v["ranks"][e["key"]].get(ch)
                if r and (best is None or r < best[1]):
                    best = (e["key"], r)
            if best and curve_points(best[1], sc) > mp:
                g = v["weight"] * (curve_points(best[1], sc) - mp)
                note = ""
                li, mi = (v["ranks"][best[0]].get("place_info") or {}), (mine.get("place_info") or {})
                if ch == "place" and li:
                    nk_l, nk_t = name_kw(li.get("name"), kw)
                    nk_m, _ = name_kw(mi.get("name"), kw) if mi else (None, None)
                    note = (f" / 방문자리뷰 {fmt(li.get('visitor_reviews'))} vs 우리 {fmt(mi.get('visitor_reviews'))},"
                            f" 블로그리뷰 {fmt(li.get('blog_reviews'))} vs {fmt(mi.get('blog_reviews'))},"
                            f" 사진 {fmt(li.get('image_count'))} vs {fmt(mi.get('image_count'))},"
                            f" 업체명 키워드 {nk_l}/{nk_t} vs {fmt(nk_m)}/{nk_t},"
                            f" 거리 {fmt(li.get('distance'))} vs {fmt(mi.get('distance'))},"
                            f" 톡톡 {yn(li.get('talktalk'))} vs {yn(mi.get('talktalk'))}, 쿠폰 {yn(li.get('coupon'))} vs {yn(mi.get('coupon'))}")
                gaps.append((g, f"- [{chn}] {kw}: 우리 {rank_txt(mine.get(ch))}, {best[0]} {best[1]}위{note}", ch, kw))
                if ch == "place" and li:
                    nk_l, nk_t = name_kw(li.get("name"), kw)
                    nk_m = name_kw(mi.get("name"), kw)[0] if mi else "-"
                    cells = [f"{fmt(li.get('visitor_reviews'))} / {fmt(mi.get('visitor_reviews'))}",
                             f"{fmt(li.get('blog_reviews'))} / {fmt(mi.get('blog_reviews'))}",
                             f"{fmt(li.get('image_count'))} / {fmt(mi.get('image_count'))}",
                             f"{nk_l} / {nk_m}",
                             f"{yn(li.get('talktalk'))}·{yn(li.get('coupon'))} / "
                             + (f"{yn(mi.get('talktalk'))}·{yn(mi.get('coupon'))}" if mi else "-")]
                else:
                    cells = ["-"] * 5
                gap_rows.append((g, [chn.replace("네이버 ", ""), kw, rank_txt(mine.get(ch)), f"{best[0]} {best[1]}위", *cells]))
    gaps.sort(key=lambda x: -x[0])
    R["gaps"] = [r for _, r in sorted(gap_rows, key=lambda x: -x[0])][: sc.get("weak_top", 15)]
    if gaps:
        for _, line, _, _ in gaps[: sc.get("weak_top", 15)]:
            p(line)
    else:
        p("- 해당 없음" + ("(비교군 미등록)" if not comps else ""))
    p("")

    # 7. 키워드 변동
    thresh = {ch: max(3, math.ceil(2 * v["mean"])) for ch, v in (noise or {}).get("ch", {}).items()}
    p("7. 우리 순위 변동 (직전 대비, 노출·미노출 전환 또는 " + (
        "재측정 흔들림의 2배 이상: " + ", ".join(f"{dict(CHANNELS)[c]} {t}계단" for c, t in thresh.items()) if thresh else "3계단 이상") + ")")
    moves = rank_moves(cur, prev, us, thresh) if prev else []
    for m in moves or ["- 해당 없음" if prev else "- 직전 측정 없음"]:
        p(m)
    R["moves"] = [m[2:] for m in (moves or ["- 해당 없음" if prev else "- 직전 측정 없음"])]
    R["moves_note"] = ("노출·미노출 전환 또는 재측정 흔들림의 2배 이상 움직인 것" if thresh else "3계단 이상 또는 노출·미노출 전환")
    p("")

    # 8. 운영 점검(우리 측 감점 항목)
    p("8. 운영 점검 (우리 측 감점 항목, 관측된 것만)")
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
                     f" 블로그리뷰 {fmt(mi.get('blog_reviews'))}, 사진 {fmt(mi.get('image_count'))}, 예약 {yn(mi.get('booking'))},"
                     f" 톡톡 {yn(mi.get('talktalk'))}, 쿠폰 {yn(mi.get('coupon'))}")
        pr = [f"{kw} {rank_txt(v['ranks'][us].get('place'))}/{fmt(v['ranks'][us].get('place_total'))}"
              + (f"(상위 {math.ceil(v['ranks'][us]['place'] / v['ranks'][us]['place_total'] * 100)}%)"
                 if v['ranks'][us].get('place') and v['ranks'][us].get('place_total') else "")
              for kw, v in ranks.items() if v["measured"]["place"] and v["ranks"][us].get("place_total")]
        if pr:
            flags.append("- 우리 플레이스 순위(전체 업체 수 대비): " + ", ".join(pr))
    for fl in flags or ["- 관측된 감점 항목 없음"]:
        p(fl)
    R["flags"] = [fl[2:] for fl in flags if fl.startswith("- ") and not fl.startswith("- 우리 플레이스 순위")]
    R["lost"] = [(v.get("date", ""), t) for t, v in lost[:10]]
    R["place_ranks"] = [(kw, rank_txt(v["ranks"][us].get("place")), fmt(v["ranks"][us].get("place_total")),
                         f"{math.ceil(v['ranks'][us]['place'] / v['ranks'][us]['place_total'] * 100)}%" if v["ranks"][us].get("place") else "-")
                        for kw, v in ranks.items() if v["measured"]["place"] and v["ranks"][us].get("place_total")]
    p("")

    # 9. 플레이스 요인
    p("9. 플레이스 순위와 공개지표의 상관 (키워드 안에서 계산한 스피어만 평균, -1에 가까울수록 지표가 클수록 상위)")
    plist = read_json(mdir / "place_list.json", {})
    R["corr"] = []
    for name, rho, n_kw, n_rows in place_factors(plist, kws):
        p(f"- {name}: {fmt(rho)} (키워드 {n_kw}개, 업체 {n_rows}건)")
        R["corr"].append((name, fmt(rho), f"키워드 {n_kw}개 / {n_rows}건"))
    p("- 상관관계이며 인과가 아닙니다. 업체명 키워드는 관측 요인일 뿐이며, '전문' 등 표시는 광고 규정 검토가 먼저입니다.")
    p("")

    # 10. 콘텐츠 최근성
    p(f"10. 네이버 콘텐츠 최근성 (상위 10위 안 글의 게시 시점, 최근 = {sc.get('fresh_days', 30)}일 이내)")
    fr = freshness(cur["serp"], ents, mdir.name, sc.get("fresh_days", 30))
    if fr["known"]:
        p(f"- 게시 시점이 보이는 상위 글 {fr['known']}건 중 최근 글 {fr['fresh']}건({round(fr['fresh'] / fr['known'] * 100)}%)")
    act = sorted(((k, n, f) for k, (n, f) in fr["per"].items() if n), key=lambda x: -x[1])
    if act:
        p("- 업체별 상위 10위 안 글 수(그중 최근 글): " + ", ".join(f"{k} {n}({f})" for k, n, f in act))
    if not any(k == us for k, _, _ in act):
        p("- 우리 글은 상위 10위 안에 없습니다")
    R["fresh"] = {"known": fr["known"], "fresh": fr["fresh"], "act": act, "days": sc.get("fresh_days", 30)}
    p("")

    # 11. 비교군 후보
    p("11. 비교군 후보 (우리·등록 업체·네트워크펌 제외, 상위 노출 가중 점수 순)")
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

    # 12. 상담 실적
    p("12. 상담·수임 실적")
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

    # 13. 다음 과제 후보
    p("13. 다음 과제 후보 (위 관측 결과에서 기계적으로 도출, 최종 선택은 사무장님)")
    todo = []
    content_kw = [kw for _, _, ch, kw in gaps if ch in ("naver", "google")]
    place_kw = [kw for _, _, ch, kw in gaps if ch == "place"]
    if content_kw:
        todo.append(f"- 콘텐츠 열세 키워드 주제 기획 투입(topic-planner): {', '.join(dict.fromkeys(content_kw[:6]))}")
    if place_kw:
        todo.append(f"- 플레이스 열세 키워드 점검(정보 충실도, 소식 게시, 키워드 등록, 정당한 리뷰 요청): {', '.join(dict.fromkeys(place_kw[:6]))}")
    weak_groups = [g["group"] for g in groups if g["kind"] == "분야" and g["kws"] >= 3 and g["pos"] and g["pos"] > len(ents) // 2]
    if weak_groups:
        todo.append(f"- 분야별 지수 하위권(비교군 절반 아래) 분야 콘텐츠 보강: {', '.join(weak_groups)}")
    if ai and (s_us.get("ai_mention_rate") or 0) < 50:
        todo.append("- AI 언급률 50% 미만: 지역·분야명이 들어간 FAQ형 글과 홈페이지·플레이스 정보 일치 점검")
    if own["alert"]:
        todo.append("- 비교군 블로그 등록(11번 블로그 후보 확인 후 entities.json blog_ids): 네이버 콘텐츠 비교 정확도 개선")
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
        w.writerow(["키워드", "분야", "지역", "가중치", "업체", "네이버콘텐츠", "플레이스", "통합검색플레이스블록", "구글", "구글지도", "파워링크"])
        for kw, v in ranks.items():
            for e in ents:
                r = v["ranks"][e["key"]]
                w.writerow([kw, v.get("area", ""), v.get("region", ""), round(v["weight"], 1), e["key"], r.get("naver") or "",
                            r.get("place") or "", r.get("place_block") or "", r.get("google") or "", r.get("gmap") or "",
                            "Y" if r.get("ad") else ""])
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
