"""팀 기존 글(corpus/posts/<채널>/*.md)을 계측해 채널별 합격 기준(config/baseline.json)과
보고서(corpus/REPORT.md)를 만든다.

사용법: python3 tools/corpus_stats.py
채널별 글이 3편 미만이면 그 채널은 기준치를 만들지 않고 임시값(channels.json)을 유지한다.
"""
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import CONFIG, ROOT, count_kw, nospace_len, parse_doc, sentences  # noqa: E402

MIN_POSTS = 3
PARTICLES = re.compile(r"(은|는|이|가|을|를|의|에|와|과|도|로|으로|에서|까지|부터)$")


def title_keyword(title, body):
    """제목 어절(조사 제거) 중 본문 출현이 가장 많은 것을 대표 키워드 추정치로 쓴다."""
    cands = set()
    words = [PARTICLES.sub("", w) for w in re.findall(r"[가-힣A-Za-z0-9]+", title)]
    words = [w for w in words if len(w) >= 2]
    cands.update(words)
    cands.update(a + " " + b for a, b in zip(words, words[1:]))
    if not cands:
        return "", 0
    counts = {w: count_kw(body, w) for w in cands}
    top = max(counts.values())
    if top == 0:
        return "", 0
    # 최다 출현 어절의 60% 이상 나오는 후보 중 가장 긴 것(복합 키워드 우선)
    best = max((w for w in cands if counts[w] >= top * 0.6), key=lambda w: (len(w), counts[w]))
    return best, counts[best]


def measure(f):
    d = parse_doc(f.read_text(encoding="utf-8"))
    n = nospace_len(d["body"])
    kw, c = title_keyword(d["title"], d["body"])
    sents = sentences(d["body"])
    return {
        "file": str(f.relative_to(ROOT)),
        "title": d["title"],
        "title_len": len(d["title"]),
        "chars": n,
        "subheads": len(d["subheads"]),
        "paragraphs": len(d["paragraphs"]),
        "sent_avg": round(statistics.mean(nospace_len(s) for s in sents), 1) if sents else 0,
        "sent_p90": sorted(nospace_len(s) for s in sents)[int(len(sents) * 0.9)] if sents else 0,
        "para_sent_avg": round(statistics.mean(len(sentences(p)) for p in d["paragraphs"]), 1) if d["paragraphs"] else 0,
        "kw_est": kw,
        "kw_count": c,
        "kw_per_1000": round(c / max(n, 1) * 1000, 2),
    }


def q(vals, p):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, max(0, round((len(vals) - 1) * p)))]


def main():
    posts_root = ROOT / "corpus" / "posts"
    baseline, lines = {}, ["# 팀 글 계측 보고서", "", "자동 생성: tools/corpus_stats.py", ""]
    for ch_dir in sorted(p for p in posts_root.iterdir() if p.is_dir()):
        files = [f for f in sorted(ch_dir.glob("*.md"))]
        rows = [measure(f) for f in files]
        lines += [f"## {ch_dir.name} ({len(rows)}편)", ""]
        if not rows:
            lines += ["수집된 글 없음", ""]
            continue
        lines.append("| 파일 | 제목 | 글자수 | 소제목 | 평균문장 | 추정 키워드 | 1000자당 |")
        lines.append("|---|---|---|---|---|---|---|")
        for r in rows:
            lines.append(f"| {r['file']} | {r['title']} | {r['chars']} | {r['subheads']} | {r['sent_avg']} | {r['kw_est']} | {r['kw_per_1000']} |")
        lines.append("")
        if len(rows) < MIN_POSTS:
            lines += [f"{MIN_POSTS}편 미만이라 기준치 미산출(임시값 유지)", ""]
            continue
        b = {
            "_n": len(rows),
            "chars_min": q([r["chars"] for r in rows], 0.2),
            "chars_max": q([r["chars"] for r in rows], 0.8),
            "title_len_min": q([r["title_len"] for r in rows], 0.1),
            "title_len_max": q([r["title_len"] for r in rows], 0.9),
            "subheadings_min": q([r["subheads"] for r in rows], 0.1),
            "subheadings_max": q([r["subheads"] for r in rows], 0.9),
            "kw_per_1000_min": q([r["kw_per_1000"] for r in rows], 0.2),
            "kw_per_1000_max": q([r["kw_per_1000"] for r in rows], 0.8),
            "sentence_max_chars": max(60, q([r["sent_p90"] for r in rows], 0.5)),
            "provisional": False,
        }
        baseline[ch_dir.name] = b
        lines += ["기준치: " + json.dumps(b, ensure_ascii=False), ""]
    (CONFIG / "baseline.json").write_text(json.dumps(baseline, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "corpus" / "REPORT.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
