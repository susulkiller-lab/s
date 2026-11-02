"""마케팅 노출 측정 공용 함수(수집기 mkt_collect.py와 리포트 mkt_report.py가 같이 쓴다).

수집한 화면의 링크를 URL 형태로 분류한다. 네이버·구글 화면 구조(CSS)는 자주 바뀌므로
화면 구조 대신 링크 주소 패턴에 기대어 분류한다. 원본 HTML은 data/measure/<날짜>/raw/에 남아
분류 규칙을 고친 뒤 다시 돌릴 수 있다.
"""
import csv
import io
import json
import re
import zlib
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
MKT = ROOT / "marketing"
CONFIG = MKT / "config"
MEASURE = ROOT / "data" / "measure"
CONSULTS = ROOT / "data" / "consults_local.csv"  # 상담 입력. 이 PC에만 둔다(.gitignore)
CONSULTS_OLD = ROOT / "data" / "consults.csv"  # 예전 입력 위치. 머리글만 저장소에 남겨 둔다
LEDGER = ROOT / "data" / "published.csv"

# 콘텐츠 노출로 치는 분류(네이버 통합검색 안의 순서를 함께 센다)
CONTENT_CLASSES = ("blog", "cafe", "kin", "lawtalk", "web")
# 분류 규칙을 바꾸면 올린다. 저장된 측정의 판이 다르면 리포트가 원본으로 다시 분석한 뒤 비교한다
PARSER_VERSION = 2
# 구글 결과처럼 블로그 주인을 알 수 없을 때의 자리표시자. 순위 칸은 차지하고 글 문구로만 업체와 맞춘다
UNKNOWN_OWNER = "_unknown"
# 같은 블로그 글이 이만큼 연달아 나오면 네이버 채널 카드 하나로 본다(실측은 12건 또는 1건뿐)
CARD_MIN = 3
AI_ENGINES = ("chatgpt", "gemini", "perplexity", "claude")
AI_EXPECTED_ENGINES = ("chatgpt", "gemini", "perplexity")
AI_MIN_CHARS = 200
AI_NOTICE_MAX_CHARS = 800  # 이보다 짧으면서 아래 문구가 있으면 답변이 아니라 안내문으로 본다
AI_NOTICE_MARKS = ("로그인", "log in", "sign in", "오류가 발생", "something went wrong", "captcha", "사용량", "rate limit")

PLACE_RES = [
    re.compile(r"place\.naver\.com/(?:[a-z]+/)?(\d{5,})"),
    re.compile(r"map\.naver\.com/.*?(?:place|entry/place)/(\d{5,})"),
    re.compile(r"[?&](?:placeId|place_id|id)=(\d{7,})"),
]
BLOG_RE = re.compile(r"blog\.naver\.com/([A-Za-z0-9_-]+)/(\d{6,})")
CAFE_RE = re.compile(r"cafe\.naver\.com/([A-Za-z0-9_-]+)/(\d+)")
KIN_RE = re.compile(r"/qna/dirs/\d+/docs/(\d+)")
BLOG_HOME_RE = re.compile(r"https?://(?:m\.)?blog\.naver\.com/([A-Za-z0-9_-]+)/?(?:\?.*)?$")
# 네이버 안에 있지만 화면에서 결과 한 칸을 차지하는 글(뉴스 기사, 동영상)
NAVER_CONTENT_RE = re.compile(r"https?://((?:n\.news|m\.entertain|m\.sports|tv)\.naver\.com/(?:(?:mnews/)?article/\d+/\d+|v/\d+))")
# 분류 대상이 아닌 네이버·구글 내부 링크
SKIP_HOSTS = ("search.naver.com", "nid.naver.com", "help.naver.com", "www.naver.com",
              "m.naver.com", "keep.naver.com", "policy.naver.com", "accounts.google.com",
              "support.google.com", "policies.google.com", "maps.google.com",
              "openstreetmap.org", "navercorp.com")
# 결과가 아니라 화면 조작·프로필 링크로 확인된 네이버 주소. 여기 없는 주소가 분류되지 않으면 구조 변화 신호로 알린다
NAV_HOSTS = ("m.search.naver.com", "m.keep.naver.com", "m.help.naver.com", "m.kin.naver.com", "kin.naver.com",
             "m.blog.naver.com", "blog.naver.com", "m.cafe.naver.com", "cafe.naver.com", "in.naver.com",
             "nmap.place.naver.com", "m.place.naver.com", "m.booking.naver.com", "media.naver.com",
             "msearch.shopping.naver.com", "dict.naver.com", "app.map.naver.com", "m.ad.search.naver.com",
             "clip.naver.com", "tv.naver.com", "n.news.naver.com", "m.entertain.naver.com", "m.sports.naver.com")
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
        if "detail" in href:
            return ("kin", q.get("docId", [href])[0])
        m = KIN_RE.search(href)
        return ("kin", m.group(1)) if m else None
    if "lawtalk.co.kr" in h:
        return ("lawtalk", urlparse(href).path)
    m = NAVER_CONTENT_RE.match(href)
    if m:
        return ("web", m.group(1))
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
            if "blog.naver.com" not in u:
                return u
            owner = b.group(1) if b else UNKNOWN_OWNER  # 문구에 주소만 있고 주인이 없어도 순위 칸은 남긴다
            return f"https://blog.naver.com/{owner}/{zlib.crc32(text.encode('utf-8')):010d}"
    return href


def unclassified_hosts(links):
    """분류되지 않은 링크를 주소별로 센다. 화면 구조가 바뀌면 여기에 새 주소가 나타난다."""
    out = Counter()
    for ln in links:
        h = host_of(ln.get("href", ""))
        if not h or not ln.get("text") or classify(resolve(ln["href"], ln["text"])):
            continue
        if any(h == s or h.endswith("." + s) for s in SKIP_HOSTS) or h in NAV_HOSTS or "google." in h:
            continue
        out[h] += 1
    return out


def owner_names_from(links):
    """블로그 주인 프로필 링크의 문구를 모은다(주소만 적힌 문구는 뺀다)."""
    out = {}
    for ln in links:
        m = BLOG_HOME_RE.match(ln.get("href", ""))
        t = ln.get("text", "")
        if m and t and "blog.naver.com" not in t and t not in out.get(m.group(1), []):
            out.setdefault(m.group(1), []).append(t)
    return {k: " | ".join(v)[:1000] for k, v in out.items()}


def merge_cards(items):
    """같은 블로그 글이 연달아 나오는 채널 카드를 결과 1건으로 묶는다. 묶인 글 키는 card_keys에 남긴다."""
    out, i = [], 0
    while i < len(items):
        it = items[i]
        j = i + 1
        if it["cls"] == "blog" and not it["key"].startswith(UNKNOWN_OWNER + "/"):
            owner = it["key"].split("/")[0]
            while j < len(items) and items[j]["cls"] == "blog" and items[j]["key"].split("/")[0] == owner:
                j += 1
        if j - i >= CARD_MIN:
            run = items[i:j]
            it = dict(it, text=" | ".join(x["text"] for x in run)[:300], card=len(run), card_keys=[x["key"] for x in run])
            out.append(it)
            i = j
        else:
            out.append(it)
            i += 1
    return out


def has_post(items, key):
    """이 글이 결과에 있는지(채널 카드 안에 묶인 글 포함)."""
    return any(it["cls"] == "blog" and (it["key"] == key or key in it.get("card_keys", [])) for it in items)


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
    owners = owner_names_from(links)
    for it in items:
        if it["cls"] == "blog" and owners.get(it["key"].split("/")[0]):
            it["owner_name"] = owners[it["key"].split("/")[0]]
    items = merge_cards(items)
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
    if cls == "place" and ent["place_ids"]:  # 번호가 있으면 번호로만(같은 이름의 타지역 분사무소 제외)
        return key in [str(x) for x in ent["place_ids"]]
    if cls == "blog":
        owner = key.split("/")[0].lower()
        if owner in [b.lower() for b in ent["blog_ids"]]:
            return True
        # 글 제목에 이름이 든 남의 블로그는 세지 않는다. 주인 이름에 있거나, 주인을 모를 때만 문구로 본다
        t = norm(item.get("owner_name", "") + (" " + item.get("text", "") if owner == UNKNOWN_OWNER.lower() else ""))
        return any(n and n in t for n in ent["_names"])
    if cls in ("web", "gmap", "ad") and any(key == d or key.endswith("." + d) for d in ent["domains"]):
        return True
    if cls in ("place", "ad", "web", "gmap", "lawtalk"):
        t = norm(item.get("text", "") + " " + item.get("name", ""))
        return any(n and n in t for n in ent["_names"])
    return False


def read_rows(path):
    """CSV를 읽는다. 엑셀 기본 저장(CP949)도 받는다."""
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp949", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def to_number(v):
    """'1,200' 같은 숫자 문구를 읽는다. 숫자가 아니면 None."""
    try:
        return float(str(v or "").replace(",", "").strip())
    except ValueError:
        return None


def read_keywords():
    rows = [r for r in read_rows(CONFIG / "keywords.csv") if (r.get("keyword") or "").strip()]
    vols = [v for v in (to_number(r.get("volume")) for r in rows) if v is not None]
    fill = sorted(vols)[len(vols) // 2] if vols else 1.0
    for r in rows:
        r["keyword"] = r["keyword"].strip()
        v = to_number(r.get("volume"))
        r["weight"] = max(fill if v is None else v, 1.0) * (to_number(r.get("priority")) or 1)
    return rows


def read_prompts():
    return [r for r in read_rows(CONFIG / "ai_prompts.csv") if (r.get("id") or "").strip()]


def load_scoring():
    return json.loads((CONFIG / "scoring.json").read_text(encoding="utf-8"))


def curve_points(rank, sc):
    """검색 채널 순위 점수. scoring.json에 rank_curve가 있으면 1위 10점에서 한 계단마다 decay배로 줄어
    max_rank위까지 점수를 준다(10위 밖 변동도 보이게). 없으면 예전 계단식 rank_points를 쓴다."""
    cv = sc.get("rank_curve")
    if not cv:
        return points(rank, sc["rank_points"])
    if not rank or rank > cv.get("max_rank", 30):
        return 0
    return 10 * cv.get("decay", 0.85) ** (rank - 1)


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


def _failure_label(status):
    if status == "blocked":
        return "차단"
    if status == "empty":
        return "빈 화면"
    return "오류" if str(status).startswith("error") else str(status)


def channel_status(mdir, kws, suffix=""):
    """채널별 수집 결과를 키워드 단위로 센다. target은 결과 없음(none)을 뺀 측정 대상 수.
    suffix="_rep"이면 같은 날 재측정 파일(naver_serp_rep.json 등)을 센다."""
    out = {}
    for ch, fname, field in (("naver", "naver_serp", "items"), ("place", "place_list", "places"),
                             ("google", "google", "items")):
        data = read_json(Path(mdir) / f"{fname}{suffix}.json", {})
        ok, none, failed = 0, 0, Counter()
        for k in kws:
            rec = data.get(k["keyword"])
            if rec is None:
                failed["미수집"] += 1
            elif rec.get("status") == "none":
                none += 1
            elif rec.get("status") != "ok":
                failed[_failure_label(rec.get("status"))] += 1
            elif rec.get(field):
                ok += 1
            else:
                failed["빈 화면"] += 1
        out[ch] = {"ok": ok, "target": len(kws) - none, "none": none, "failed": dict(failed)}
    return out


def check_ai_files(mdir, prompts):
    """AI 답변 파일을 검사해 (유효 목록, [(파일명, 이유)])를 돌려준다. 유효 항목은 dict(engine, pid, round, file, text)."""
    d = Path(mdir) / "ai"
    pids = {p["id"] for p in prompts}
    good, bad = [], []
    for f in sorted(d.glob("*.txt")) if d.exists() else []:
        parts = f.stem.split("__")
        if len(parts) != 3 or parts[0] not in AI_ENGINES or parts[1] not in pids or not parts[2].isdigit():
            bad.append((f.name, "파일 이름 형식 오류"))
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            bad.append((f.name, "UTF-8이 아님"))
            continue
        n = len(text.strip())
        low = text.lower()
        has_notice = any(m in low for m in AI_NOTICE_MARKS)
        if n < AI_NOTICE_MAX_CHARS and has_notice:
            bad.append((f.name, "로그인·오류 안내문"))
        elif n < AI_MIN_CHARS:
            bad.append((f.name, "내용이 너무 짧음"))
        else:
            good.append({"engine": parts[0], "pid": parts[1], "round": parts[2], "file": f.name, "text": text})
    return good, bad


def ai_rounds():
    """질문당 AI 답변 회차(collect.json의 ai_rounds, 기본 1)."""
    try:
        return max(int(read_json(CONFIG / "collect.json", {}).get("ai_rounds", 1)), 1)
    except (TypeError, ValueError):
        return 1


def ai_expected(prompts):
    return len(prompts) * len(AI_EXPECTED_ENGINES) * ai_rounds()


def collection_problems(mdir):
    """기준에 못 미친 수집을 사람이 읽을 문장으로 돌려준다. 원클릭은 이 목록이 있으면 결과를 올리지 않는다."""
    kws = read_keywords()
    least = load_scoring().get("min_channel_coverage", 0.7)
    names = {"naver": "네이버 콘텐츠", "place": "네이버 플레이스", "google": "구글"}
    st = channel_status(mdir, kws)
    out = []
    for ch, name in names.items():
        s = st[ch]
        if ch == "place" and st["naver"]["ok"] / max(st["naver"]["target"], 1) >= least:
            continue  # 플레이스 목록이 막혀도 통합검색 플레이스 영역으로 대체된다
        if s["target"] and s["ok"] / s["target"] < least:
            why = ", ".join(f"{k} {v}" for k, v in s["failed"].items())
            out.append(f"{name} {s['ok']}/{s['target']}" + (f"({why})" if why else ""))
    return out
