"""원고 품질 검수.

사용법:
  python3 tools/seo_check.py output/원고.txt --channel naver --kw "대여금 소멸시효" \
      --lsi "차용증,지급명령,시효중단,변제기,이자" [--json]

원고 형식: 첫 줄 '제목: ...', 소제목 줄은 '## '로 시작, 문단은 빈 줄로 구분.
종료코드: 0 = 통과(경고만 있을 수 있음), 1 = 발행 불가 항목 존재.
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (ROOT, channel_spec, count_kw, iter_corpus, jaccard, load_json,  # noqa: E402
                    nospace_len, parse_doc, sentences, shingles)

SIM_WARN = 0.20
SIM_FAIL = 0.35
# "승소 보장은 없습니다"처럼 바로 뒤에서 부정하는 경우는 금지 표현으로 보지 않는다.
NEGATED = re.compile(r"\S{0,2}\s?(없|않|아닙|못)")


def check(path, channel, kw, lsi, compare_dirs):
    text = Path(path).read_text(encoding="utf-8")
    doc = parse_doc(text)
    spec = channel_spec(channel)
    body = doc["body"]
    full = "\n".join([doc["title"], *doc["subheads"], body])
    items = []

    def add(level, name, detail):
        items.append({"level": level, "item": name, "detail": detail})

    # 1. 분량
    n = nospace_len(body)
    if n < spec["chars_min"] or n > spec["chars_max"]:
        add("warn", "분량", f"본문 {n}자(공백 제외). 기준 {spec['chars_min']}~{spec['chars_max']}자")
    else:
        add("ok", "분량", f"본문 {n}자")

    # 2. 제목
    t = doc["title"]
    if not t:
        add("fail", "제목", "첫 줄 '제목:' 없음")
    else:
        tl = len(t)
        if tl < spec["title_len_min"] or tl > spec["title_len_max"]:
            add("warn", "제목 길이", f"{tl}자. 기준 {spec['title_len_min']}~{spec['title_len_max']}자")
        if kw:
            pos = re.sub(r"\s", "", t).find(re.sub(r"\s", "", kw))
            if pos < 0:
                add("fail", "제목 키워드", f"대표 키워드 '{kw}'가 제목에 없음")
            elif pos > 10:
                add("warn", "제목 키워드", f"대표 키워드가 제목 앞부분이 아님(위치 {pos})")
            else:
                add("ok", "제목 키워드", "앞부분 배치")

    # 3. 키워드 밀도·분포
    if kw:
        c = count_kw(body, kw)
        per1k = c / max(n, 1) * 1000
        lo, hi = spec["kw_per_1000_min"], spec["kw_per_1000_max"]
        lvl = "ok"
        if per1k > hi * 1.5:
            lvl = "fail"
        elif per1k > hi or per1k < lo:
            lvl = "warn"
        add(lvl, "키워드 밀도", f"'{kw}' {c}회, 1,000자당 {per1k:.2f}회. 기준 {lo}~{hi}")
        lead = re.sub(r"\s", "", body)[: spec["lead_chars"]]
        if count_kw(lead, kw) == 0:
            add("warn", "도입부 키워드", f"첫 {spec['lead_chars']}자 안에 대표 키워드 없음")
        # 4등분 분포
        flat = re.sub(r"\s", "", body)
        q = max(len(flat) // 4, 1)
        dist = [count_kw(flat[i * q:(i + 1) * q if i < 3 else None], kw) for i in range(4)]
        if dist.count(0) >= 2:
            add("warn", "키워드 분포", f"4등분 구간별 출현 {dist}. 한쪽에 몰림")
        else:
            add("ok", "키워드 분포", f"4등분 구간별 출현 {dist}")
        sub_hits = sum(1 for s in doc["subheads"] if count_kw(s, kw))
        if doc["subheads"] and sub_hits == len(doc["subheads"]):
            add("warn", "소제목 키워드", "모든 소제목에 대표 키워드 반복. 절반 이하로 줄일 것")

    # 4. LSI 커버리지
    if lsi:
        missing = [w for w in lsi if count_kw(full, w) == 0]
        heavy = [w for w in lsi if count_kw(body, w) / max(n, 1) * 1000 > spec["kw_per_1000_max"] * 1.5]
        cov = (len(lsi) - len(missing)) / len(lsi)
        add("ok" if cov >= 0.7 else "warn", "LSI 커버리지",
            f"{len(lsi) - len(missing)}/{len(lsi)}" + (f", 누락: {', '.join(missing)}" if missing else ""))
        if heavy:
            add("warn", "LSI 과다", f"과다 반복: {', '.join(heavy)}")

    # 5. 소제목 수
    sh = len(doc["subheads"])
    if sh < spec["subheadings_min"] or sh > spec["subheadings_max"]:
        add("warn", "소제목 수", f"{sh}개. 기준 {spec['subheadings_min']}~{spec['subheadings_max']}개")
    dup_sh = [s for s, k in Counter(doc["subheads"]).items() if k > 1]
    if dup_sh:
        add("fail", "소제목 중복", ", ".join(dup_sh))

    # 6. 문장·문단 호흡
    sents = sentences(body)
    long_s = [s for s in sents if nospace_len(s) > spec["sentence_max_chars"]]
    if long_s:
        add("warn", "긴 문장", f"{len(long_s)}개 ({spec['sentence_max_chars']}자 초과). 예: {long_s[0][:40]}...")
    long_p = [p for p in doc["paragraphs"] if len(sentences(p)) > spec["para_max_sentences"]]
    if long_p:
        add("warn", "긴 문단", f"{len(long_p)}개 ({spec['para_max_sentences']}문장 초과). 예: {long_p[0][:30]}...")
    # 문말 단조로움: 같은 종결어미 5연속
    ends = [re.sub(r"[.?!\s]+$", "", s)[-3:] for s in sents]
    run, worst = 1, (1, "")
    for a, b in zip(ends, ends[1:]):
        run = run + 1 if a == b else 1
        if run > worst[0]:
            worst = (run, b)
    if worst[0] >= 5:
        add("warn", "문말 단조", f"'~{worst[1]}' 종결 {worst[0]}연속")

    # 7. 반복 어구(어절 3-gram 3회 이상)
    toks = re.findall(r"\S+", body)
    grams = Counter(" ".join(toks[i:i + 3]) for i in range(len(toks) - 2))
    reps = [(g, k) for g, k in grams.most_common(10) if k >= 3]
    if reps:
        add("warn", "반복 어구", "; ".join(f"'{g}' {k}회" for g, k in reps[:5]))
    dup_sents = [s for s, k in Counter(sents).items() if k > 1 and nospace_len(s) > 15]
    if dup_sents:
        add("fail", "중복 문장", f"{len(dup_sents)}개. 예: {dup_sents[0][:40]}")

    # 8. 금지 표현
    banned = load_json("banned.json")
    for rule in banned["rules"]:
        hits = [p for p in rule["patterns"] if any(
            not NEGATED.match(full, m.end()) for m in re.finditer(re.escape(p), full))]
        if hits:
            add(rule["severity"], rule["category"], f"{', '.join(hits)} (근거: {rule['basis']})")
    for rx in banned["format_regex"]:
        if re.search(rx["regex"], text):
            add(rx["severity"], rx["category"], rx["label"])

    # 9. 유사문서(기존 팀 글·기발행 원고와 5글자 shingle 자카드)
    me = shingles(body)
    sims = []
    for f in iter_corpus(compare_dirs):
        if f.resolve() == Path(path).resolve():
            continue
        other = parse_doc(f.read_text(encoding="utf-8"))["body"]
        sims.append((jaccard(me, shingles(other)), f.relative_to(ROOT)))
    sims.sort(reverse=True)
    if sims:
        s, f = sims[0]
        lvl = "fail" if s >= SIM_FAIL else "warn" if s >= SIM_WARN else "ok"
        add(lvl, "유사문서", f"최대 유사도 {s:.2f} ({f}). 경고 {SIM_WARN}, 불가 {SIM_FAIL}")
    else:
        add("warn", "유사문서", "비교 대상 코퍼스 없음")

    return {"file": str(path), "channel": channel, "provisional_spec": spec.get("provisional", False),
            "items": items, "pass": not any(i["level"] == "fail" for i in items)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("draft")
    ap.add_argument("--channel", required=True, choices=["naver", "lawtalk", "tistory"])
    ap.add_argument("--kw", default="")
    ap.add_argument("--lsi", default="")
    ap.add_argument("--compare", default="corpus/posts,output",
                    help="유사도 비교 폴더(쉼표 구분)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    lsi = [w.strip() for w in a.lsi.split(",") if w.strip()]
    r = check(a.draft, a.channel, a.kw.strip(), lsi, a.compare.split(","))
    if a.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        mark = {"ok": "통과", "warn": "경고", "fail": "불가"}
        print(f"[검수] {r['file']} / 채널 {r['channel']}" + (" / 기준치 임시값" if r["provisional_spec"] else ""))
        for i in r["items"]:
            print(f"  {mark[i['level']]:2}  {i['item']}: {i['detail']}")
        print("결과:", "발행 가능" if r["pass"] else "발행 불가 항목 있음")
    sys.exit(0 if r["pass"] else 1)


if __name__ == "__main__":
    main()
