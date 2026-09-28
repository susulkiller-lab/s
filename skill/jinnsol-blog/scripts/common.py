"""공용 유틸: 원고·코퍼스 파일 파싱과 기본 계측. 표준 라이브러리만 사용한다."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"


def load_json(name):
    return json.loads((CONFIG / name).read_text(encoding="utf-8"))


def channel_spec(channel):
    """baseline.json(코퍼스 실측)이 있으면 channels.json(임시값) 위에 덮어쓴다."""
    spec = load_json("channels.json")[channel].copy()
    base_path = CONFIG / "baseline.json"
    if base_path.exists():
        all_base = json.loads(base_path.read_text(encoding="utf-8"))
        # 채널별 실측이 없으면 채널 미상 팀 글(common) 실측을 쓴다
        base = all_base.get(channel) or all_base.get("common", {})
        spec.update({k: v for k, v in base.items() if not k.startswith("_")})
    return spec


def parse_doc(text):
    """YAML 머리(--- ... ---) 선택. '제목:' 첫 줄 선택. '## '로 시작하는 줄은 소제목."""
    meta = {}
    body = text
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
        body = text[m.end():]
    lines = body.strip("\n").splitlines()
    if lines and lines[0].startswith("제목:"):
        meta["title"] = lines[0][3:].strip()
        lines = lines[1:]
    subheads = [l[3:].strip() for l in lines if l.startswith("## ")]
    plain_lines = [l for l in lines if not l.startswith("## ")]
    body_text = "\n".join(plain_lines).strip()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body_text) if p.strip()]
    paragraphs = [p for p in paragraphs if p != "[이미지]"]
    return {
        "meta": meta,
        "title": meta.get("title", ""),
        "subheads": subheads,
        "body": body_text.replace("[이미지]", ""),
        "paragraphs": paragraphs,
    }


def nospace_len(s):
    return len(re.sub(r"\s", "", s))


def sentences(text):
    parts = re.split(r"(?<=[.?!])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.strip()) > 1]


def count_kw(text, kw):
    """공백 무시 부분일치 횟수. '대여금 반환'과 '대여금반환'을 같게 본다."""
    if not kw:
        return 0
    t = re.sub(r"\s", "", text)
    k = re.sub(r"\s", "", kw)
    return t.count(k)


def shingles(text, n=5):
    t = re.sub(r"\s", "", text)
    return {t[i:i + n] for i in range(max(0, len(t) - n + 1))}


def jaccard(a, b):
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def iter_corpus(dirs):
    for d in dirs:
        p = ROOT / d
        if not p.exists():
            continue
        for f in sorted(p.rglob("*")):
            if f.suffix in (".md", ".txt") and f.name not in ("INDEX.md", "ACCESS.md", "README.md"):
                yield f
