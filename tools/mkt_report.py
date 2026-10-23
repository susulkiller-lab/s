"""마케팅 노출 리포트. 수집 결과(data/measure/<날짜>/)로 점수·비교·약점 목록을 만든다. 표준 라이브러리만 쓴다.

  py tools\\mkt_report.py                 # 가장 최근 측정 vs 직전 측정
  py tools\\mkt_report.py --date 2026-10-27 --prev 2026-10-20

결과: output/marketing/<날짜>_리포트.txt, <날짜>_키워드표.csv(엑셀용), data/measure/<날짜>/scores.json
AI 답변: data/measure/<날짜>/ai/<엔진>__<질문id>__<회차>.txt (marketing/AI_PROTOCOL.md 참조)
상담 실적: data/consults.csv
"""
import argparse
import csv
import re
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mkt_common import (CONSULTS, CONTENT_CLASSES, LEDGER, ROOT, is_network, load_entities,  # noqa: E402
                        load_scoring, match_item, measure_dirs, norm, points, read_json,
                        read_keywords, read_prompts, write_json)

CHANNELS = [("naver", "네이버 콘텐츠"), ("place", "네이버 플레이스"), ("google", "구글"), ("ai", "AI 검색")]
PLACE_FIELDS = ("visitor_reviews", "visitor_score", "image_count", "booking", "talktalk", "coupon")
PHONE_RE = re.compile(r"0\d{1,2}[-.\s)]?\d{3,4}[-.\s]?\d{4}")


def best_rank(items, ent, field):
    ranks = [it[field] for it in items if it.get(field) and match_item(it, ent)]
    return min(ranks) if ranks else None


def ranks_for(mdir, ents, kws):
    """키워드 × 업체별 채널 순위."""
    serp = read_json(mdir / "naver_serp.json", {})
    plist = read_json(mdir / "place_list.json", {})
    goog = read_json(mdir / "google.json", {})
    have = {"naver": bool(serp), "place": bool(plist) or bool(serp), "google": bool(goog)}
    out = {}
    for k in kws:
        kw = k["keyword"]
        s_items = serp.get(kw, {}).get("items", []) if serp.get(kw, {}).get("status") == "ok" else None
        p_rows = plist.get(kw, {}).get("places", []) if plist.get(kw, {}).get("status") == "ok" else None
        no_place = plist.get(kw, {}).get("status") == "none"  # 플레이스 결과가 없는 키워드는 플레이스 채널에서 뺀다
        g_items = goog.get(kw, {}).get("items", []) if goog.get(kw, {}).get("status") == "ok" else None
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
                   "measured": {"naver": s_items is not None, "place": not no_place and (p_rows is not None or s_items is not None),
                                "google": g_items is not None}}
    return out, have


def ai_results(mdir, ents, prompts, sc):
    """AI 답변 파일에서 업체별 언급 순서를 센다."""
    d = mdir / "ai"
    files = sorted(d.glob("*.txt")) if d.exists() else []
    pid_ok = {p["id"] for p in prompts}
    res = []
    for f in files:
        parts = f.stem.split("__")
        if len(parts) < 2 or parts[1] not in pid_ok:
            continue
        text = f.read_text(encoding="utf-8")
        t = norm(text)
        firsts = {}
        for e in ents:
            idx = [t.find(n) for n in e["_names"] if n and t.find(n) >= 0]
            if idx:
                firsts[e["key"]] = min(idx)
        order = sorted(firsts, key=firsts.get)
        cites = [e["key"] for e in ents if any(x and x.lower() in text.lower() for x in e["domains"] + e["blog_ids"])]
        res.append({"engine": parts[0], "pid": parts[1], "file": f.name, "order": order, "cites": cites,
                    "text": text})
    return res


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


def consult_summary(start, end):
    if not CONSULTS.exists():
        return None
    with CONSULTS.open(encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("date") or "").strip()]

    def pick(a, b):
        return [r for r in rows if a < r["date"].strip() <= b]
    cur = pick(start, end)
    span = (date.fromisoformat(end) - date.fromisoformat(start)).days
    prev_start = (date.fromisoformat(start) - timedelta(days=span)).isoformat()
    prev = pick(prev_start, start)
    return cur, prev


def fmt(v, suffix=""):
    return "-" if v is None else f"{v}{suffix}"


def delta(a, b):
    if a is None or b is None:
        return ""
    d = round(a - b, 1)
    return f" ({'+' if d >= 0 else ''}{d})"


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

    cfg = load_entities()
    ents = cfg["_list"]
    for e in ents:
        e.setdefault("key", e["names"][0] if e["names"] else "?")
    sc = load_scoring()
    kws = read_keywords()
    prompts = read_prompts()
    us = ents[0]["key"]

    ranks, have = ranks_for(mdir, ents, kws)
    ai = ai_results(mdir, ents, prompts, sc)
    per = score(ranks, have, ai, ents, sc)
    write_json(mdir / "scores.json", {"scores": per, "ranks": ranks, "ai": [{k: v for k, v in r.items() if k != "text"} for r in ai]})
    prev = read_json(pdir / "scores.json", {}) if pdir else {}
    pper = prev.get("scores", {})
    pranks = prev.get("ranks", {})

    L = []
    p = L.append
    p(f"진앤솔법률사무소 마케팅 노출 리포트 ({mdir.name} 측정)")
    p(f"비교 기준: {pdir.name + ' 측정' if pdir else '직전 측정 없음(이번이 기준선)'}")
    meta = read_json(mdir / "meta.json", {})
    p(f"측정 조건: 키워드 {meta.get('keywords', len(kws))}개, 기기 {meta.get('device', '-')}, 수집 단계 {', '.join(meta.get('steps', [])) or '-'}, AI 답변 {len(ai)}건")
    missing_ch = [n for ch, n in CHANNELS if (ch == "ai" and not ai) or (ch != "ai" and not have[ch])]
    if missing_ch:
        p(f"미측정 채널: {', '.join(missing_ch)} (종합지수는 측정된 채널 가중치로만 환산)")
    p("")

    # 1. 결론
    s_us = per[us]
    comps = [e for e in ents if e["role"] == "competitor"]
    ranked = sorted(ents, key=lambda e: per[e["key"]].get("index") or 0, reverse=True)
    pos_us = [e["key"] for e in ranked].index(us) + 1
    p("1. 결론")
    p(f"- 우리 종합 노출지수 {fmt(s_us.get('index'))}{delta(s_us.get('index'), pper.get(us, {}).get('index'))}, 비교군 {len(ents)}곳 중 {pos_us}위")
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

    # 2. 채널별 점수
    p("2. 채널별 점수 (0~100, 괄호는 직전 대비)")
    head = "업체".ljust(16) + "".join(n.ljust(14) for _, n in CHANNELS) + "종합"
    p(head)
    for e in ranked:
        s, ps = per[e["key"]], pper.get(e["key"], {})
        line = (e["key"][:14] + ("*" if e["key"] == us else "")).ljust(16)
        for ch, _ in CHANNELS:
            line += (fmt(s.get(ch)) + delta(s.get(ch), ps.get(ch))).ljust(14)
        line += fmt(s.get("index")) + delta(s.get("index"), ps.get("index"))
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

    # 3. 약점 목록
    p("3. 약점 목록 (경쟁사가 우리보다 위에 있는 키워드, 가중치 × 점수 차 순)")
    gaps = []
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
    gaps.sort(key=lambda x: -x[0])
    if gaps:
        for _, line, _, _ in gaps[: sc.get("weak_top", 15)]:
            p(line)
    else:
        p("- 해당 없음" + ("(비교군 미등록)" if not comps else ""))
    p("")

    # 4. 키워드 변동
    p("4. 우리 순위 변동 (직전 대비, 3계단 이상 또는 노출·미노출 전환)")
    moves = []
    for kw, v in ranks.items():
        old = pranks.get(kw, {}).get("ranks", {}).get(us, {})
        for ch, chn in CHANNELS[:3]:
            a1, b1 = v["ranks"][us].get(ch), old.get(ch)
            if not v["measured"][ch] or kw not in pranks:
                continue
            if (a1 is None) != (b1 is None) or (a1 and b1 and abs(a1 - b1) >= 3):
                moves.append(f"- [{chn}] {kw}: {rank_txt(b1)} -> {rank_txt(a1)}")
    for m in moves or ["- 해당 없음" if pranks else "- 직전 측정 없음"]:
        p(m)
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
                for m in PHONE_RE.finditer(t[max(0, i - 50): i + 250]):
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
    p("")

    # 6. 플레이스 상관 분석
    p("6. 플레이스 순위와 공개지표의 상관 (스피어만, -1에 가까울수록 지표가 클수록 상위)")
    plist = read_json(mdir / "place_list.json", {})
    rows = [x for v in plist.values() for x in v.get("places", []) if x.get("rank") and x["rank"] <= 20]
    for f, n in (("visitor_reviews", "방문자리뷰"), ("image_count", "사진 수")):
        pr = [(x["rank"], x[f]) for x in rows if x.get(f) is not None]
        rho = spearman([a1 for a1, _ in pr], [b1 for _, b1 in pr])
        p(f"- {n}: {fmt(rho)} (표본 {len(pr)}건)")
    p("- 상관관계이며 인과가 아닙니다. 같은 업체가 여러 키워드에 중복 집계되고, 4주 이상 누적해야 경향으로 읽을 수 있습니다.")
    p("")

    # 7. 비교군 후보
    p("7. 비교군 후보 (우리·등록 업체·네트워크펌 제외, 상위 노출 가중 점수 순)")
    cand = discover(mdir, cfg, ents, kws)
    for name, pid, s in cand[: sc.get("discovery_top", 15)] or [("- 후보 없음", "", "")]:
        p(f"- {name} (플레이스 {pid}) 점수 {s}" if pid else name)
    p("")

    # 8. 상담 실적
    p("8. 상담·수임 실적 (data/consults.csv 입력분)")
    start = pdir.name if pdir else (date.fromisoformat(mdir.name) - timedelta(days=7)).isoformat()
    cs = consult_summary(start, mdir.name)
    if cs is None:
        p("- 입력 파일 없음")
    else:
        cur, prv = cs
        ret = sum(1 for r in cur if (r.get("retained") or "").strip().upper() in ("Y", "O", "수임"))
        p(f"- 기간 {start} 다음날 ~ {mdir.name}: 상담 {len(cur)}건 (앞선 같은 기간 {len(prv)}건), 수임 {ret}건")
        by = Counter((r.get("channel") or "미기재").strip() for r in cur)
        if by:
            p("- 유입 경로: " + ", ".join(f"{k} {v}" for k, v in by.most_common()))
        hist = [(d.name, read_json(d / "scores.json", {}).get("scores", {}).get(us, {}).get("index")) for d in dirs if d.name <= mdir.name]
        if len([h for h in hist if h[1] is not None]) >= 2:
            p("- 노출지수 추이: " + " / ".join(f"{d} {fmt(v)}" for d, v in hist[-8:]))
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


if __name__ == "__main__":
    main()
