"""마케팅 노출 측정 공용 함수(수집기 mkt_collect.py와 리포트 mkt_report.py가 같이 쓴다).

수집한 화면의 링크를 URL 형태로 분류한다. 네이버·구글 화면 구조(CSS)는 자주 바뀌므로
화면 구조 대신 링크 주소 패턴에 기대어 분류한다. 원본 HTML은 data/measure/<날짜>/raw/에 남아
분류 규칙을 고친 뒤 다시 돌릴 수 있다.
"""
import csv
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
MKT = ROOT / "marketing"
CONFIG = MKT / "config"
MEASURE = ROOT / "data" / "measure"
CONSULTS = ROOT / "data" / "consults.csv"
LEDGER = ROOT / "data" / "published.csv"

# 콘텐츠 노출로 치는 분류(네이버 통합검색 안의 순서를 함께 센다)
CONTENT_CLASSES = ("blog", "cafe", "kin", "lawtalk", "web")

PLACE_RES = [
    re.compile(r"place\.naver\.com/(?:[a-z]+/)?(\d{5,})"),
    re.compile(r"map\.naver\.com/.*?(?:place|entry/place)/(\d{5,})"),
    re.compile(r"[?&](?:placeId|place_id|id)=(\d{7,})"),
]
BLOG_RE = re.compile(r"blog\.naver\.com/([A-Za-z0-9_-]+)/(\d{6,})")
CAFE_RE = re.compile(r"cafe\.naver\.com/([A-Za-z0-9_-]+)/(\d+)")
# 분류 대상이 아닌 네이버·구글 내부 링크
SKIP_HOSTS = ("search.naver.com", "nid.naver.com", "help.naver.com", "www.naver.com",
              "m.naver.com", "keep.naver.com", "policy.naver.com", "accounts.google.com",
              "support.google.com", "policies.google.com", "maps.google.com",
              "openstreetmap.org", "navercorp.com")
URL_IN_TEXT = re.compile(r"https?://[^\s|›]+")
DOMAIN_IN_TEXT = re.compile(r"\b((?:[a-z0-9-]+\.)+(?:com|co\.kr|kr|net|org|law))\b", re.I)


def norm(s):
    return re.sub(r"\s", "", s or "").lower()


def host_of(href):
    try:
        return urlparse(href).netloc.lower()
    except ValueError:
        return ""


def classify(href):
    """링크 하나를 (분류, 키)로 바꾼다. 분류 대상이 아니면 None."""
    if not href or not href.startswith("http"):
        return None
    h = host_of(href)
    if "ader.naver.com" in h or "adcr.naver.com" in h or "/adcr" in href:
        return ("ad", href)
    if "ad.search.naver.com" in h:  # 광고 '더보기' 링크
        return None
    for r in PLACE_RES:
        if "place.naver.com" in h or "map.naver.com" in h:
            m = r.search(href)
            if m:
                return ("place", m.group(1))
    if "blog.naver.com" in h:
        m = BLOG_RE.search(href)
        if m:
            return ("blog", f"{m.group(1)}/{m.group(2)}")
        q = parse_qs(urlparse(href).query)
        if q.get("blogId") and q.get("logNo"):
            return ("blog", f"{q['blogId'][0]}/{q['logNo'][0]}")
        return None
    if "cafe.naver.com" in h:
        m = CAFE_RE.search(href)
        return ("cafe", f"{m.group(1)}/{m.group(2)}") if m else None
    if "kin.naver.com" in h:
        q = parse_qs(urlparse(href).query)
        return ("kin", q.get("docId", [href])[0]) if "detail" in href else None
    if "lawtalk.co.kr" in h:
        return ("lawtalk", urlparse(href).path)
    if any(h == s or h.endswith("." + s) for s in SKIP_HOSTS) or h.endswith("naver.com"):
        return None
    if "google." in h or h.endswith("gstatic.com") or h.endswith("googleusercontent.com"):
        return None
    return ("web", h[4:] if h.startswith("www.") else h)


def resolve(href, text):
    """구글 모바일의 암호화된 이동 링크(/goto, /url)는 링크 문구에 보이는 주소로 바꿔 분류한다."""
    h = host_of(href)
    path = urlparse(href).path
    if "google." in h and path in ("/goto", "/url"):
        q = parse_qs(urlparse(href).query).get("q") or parse_qs(urlparse(href).query).get("url") or []
        if q and q[0].startswith("http"):
            return q[0]
        m = URL_IN_TEXT.search(text or "")
        if m:
            u = m.group(0)
            b = re.search(r"blog\.naver\.com\s*›\s*([A-Za-z0-9_-]+)", text)
            return f"https://blog.naver.com/{b.group(1)}/000000" if "blog.naver.com" in u and b else u
    return href


def group_links(links):
    """화면 순서대로 링크를 묶어 분류별 순위를 매긴다. 같은 대상의 링크 문구는 합친다."""
    items, index = [], {}
    for ln in links:
        c = classify(resolve(ln.get("href", ""), ln.get("text", "")))
        if not c:
            continue
        if c[0] == "ad":  # 광고 한 건에 링크가 여러 개라 문구 속 도메인으로 묶는다
            m = DOMAIN_IN_TEXT.search(ln.get("text", ""))
            if not m:
                continue
            c = ("ad", m.group(1).lower())
        key = c
        if key in index:
            it = items[index[key]]
            if ln.get("text") and ln["text"] not in it["text"]:
                it["text"] = (it["text"] + " | " + ln["text"])[:300]
            continue
        index[key] = len(items)
        items.append({"cls": c[0], "key": c[1], "href": ln["href"], "text": ln.get("text", "")[:300]})
    pos = {}
    content_pos = 0
    for it in items:
        pos[it["cls"]] = pos.get(it["cls"], 0) + 1
        it["pos"] = pos[it["cls"]]
        if it["cls"] in CONTENT_CLASSES:
            content_pos += 1
            it["content_pos"] = content_pos
    return items


class _Anchors(HTMLParser):
    SKIP = {"script", "style", "svg", "noscript"}

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.out, self.stack, self.skip = base, [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "a":
            href = dict(attrs).get("href")
            self.stack.append([urljoin(self.base, href) if href else "", []])

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag == "a" and self.stack:
            href, buf = self.stack.pop()
            if href:
                self.out.append({"href": href, "text": re.sub(r"\s+", " ", " ".join(buf)).strip()[:300]})

    def handle_data(self, data):
        if not self.skip and self.stack and data.strip():
            for a in self.stack:
                a[1].append(data.strip())


def links_from_html(page_html, base):
    """원본 HTML에서 화면 순서대로 링크 주소와 문구를 뽑는다(수집 때와 재분석 때 같은 코드)."""
    p = _Anchors(base)
    p.feed(page_html)
    return p.out


def apollo_from_html(page_html):
    i = page_html.find("window.__APOLLO_STATE__")
    if i < 0:
        return None
    j = page_html.find("=", i) + 1
    try:
        st, _ = json.JSONDecoder().raw_decode(page_html[j:].lstrip())
        return st
    except ValueError:
        return None


def load_entities():
    data = json.loads((CONFIG / "entities.json").read_text(encoding="utf-8"))
    ents = [dict(data["us"], role="us")]
    for c in data.get("competitors", []):
        ents.append(dict(c, role="competitor"))
    for e in ents:
        e.setdefault("names", [])
        e.setdefault("place_ids", [])
        e.setdefault("blog_ids", [])
        e.setdefault("domains", [])
        e["_names"] = [norm(n) for n in e["names"] if n]
    data["_list"] = ents
    return data


def is_network(name, entities_cfg):
    n = norm(name)
    return any(norm(x) in n for x in entities_cfg.get("network_firms", []) if x)


def match_item(item, ent):
    """수집 항목이 해당 업체 것인지 판단한다."""
    cls, key = item["cls"], str(item["key"])
    if cls == "place" and key in [str(x) for x in ent["place_ids"]]:
        return True
    if cls == "blog" and key.split("/")[0].lower() in [b.lower() for b in ent["blog_ids"]]:
        return True
    if cls in ("web", "gmap", "ad") and any(key == d or key.endswith("." + d) for d in ent["domains"]):
        return True
    if cls in ("place", "ad", "web", "gmap", "lawtalk"):
        t = norm(item.get("text", "") + " " + item.get("name", ""))
        return any(n and n in t for n in ent["_names"])
    return False


def read_keywords():
    with (CONFIG / "keywords.csv").open(encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("keyword") or "").strip()]
    vols = [float(r["volume"]) for r in rows if (r.get("volume") or "").strip()]
    fill = sorted(vols)[len(vols) // 2] if vols else 1.0
    for r in rows:
        r["keyword"] = r["keyword"].strip()
        v = float(r["volume"]) if (r.get("volume") or "").strip() else fill
        r["weight"] = max(v, 1.0) * float(r.get("priority") or 1)
    return rows


def read_prompts():
    with (CONFIG / "ai_prompts.csv").open(encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if (r.get("id") or "").strip()]


def load_scoring():
    return json.loads((CONFIG / "scoring.json").read_text(encoding="utf-8"))


def points(rank, table):
    """순위를 점수로 바꾼다. table = [[이 순위까지, 점수], ...]."""
    if not rank:
        return 0
    for upto, pts in table:
        if rank <= upto:
            return pts
    return 0


def measure_dirs():
    if not MEASURE.exists():
        return []
    return sorted(p for p in MEASURE.iterdir() if p.is_dir() and re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.name))


def read_json(path, default=None):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(path, data):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
