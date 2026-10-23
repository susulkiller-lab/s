"""마케팅 노출 수집기. 창원 사무실 PC(윈도우)에서 크롬으로 실행한다.

  py tools\\mkt_collect.py                     # 전체(네이버·플레이스·구글·누락 점검)
  py tools\\mkt_collect.py --only naver,place  # 일부만
  py tools\\mkt_collect.py --limit 5           # 키워드 5개만(시험용)
  py tools\\mkt_collect.py --reparse 2026-10-23  # 브라우저 없이 저장된 원본 화면을 현재 규칙으로 다시 분석

결과: data/measure/<오늘 날짜>/ 아래 naver_serp.json, place_list.json, google.json, missing.json,
      원본 화면은 raw/(시범 기간에는 저장소에 함께 올림, .gitignore 참조). 중간에 끊겨도 다시 실행하면 끝난 키워드는 건너뛴다.
설정: marketing/config/collect.json(주소 형식·지연 시간·사무실 좌표), keywords.csv, entities.json
필요: 파이썬 3.10+, `py -m pip install playwright`, 크롬 설치. 측정 전용 프로필(로그아웃 상태)을 따로 쓴다.
보안문자가 뜨면 창에서 직접 풀고 콘솔에서 Enter를 누르면 이어서 진행한다.
"""
import argparse
import csv
import gzip
import json
import random
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from mkt_common import (CONFIG, LEDGER, MEASURE, apollo_from_html, group_links,  # noqa: E402
                        links_from_html, read_json, read_keywords, write_json)

SCROLL_JS = """() => { document.querySelectorAll('*').forEach(el => {
  if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; });
  window.scrollTo(0, document.body.scrollHeight); }"""

BLOCK_MARKS = ("자동입력 방지", "자동 입력 방지", "captcha", "비정상적인 트래픽", "unusual traffic", "/sorry/")


def parse_int(v):
    if v is None:
        return None
    m = re.search(r"\d[\d,]*", str(v))
    return int(m.group(0).replace(",", "")) if m else None


def refs(lst):
    return [x["__ref"] for x in lst or [] if isinstance(x, dict) and "__ref" in x]


def parse_place(page_html):
    """플레이스 목록 화면의 내장 데이터에서 자연 순위(광고 제외)와 공개 지표를 뽑는다.
    목록(placeList)과 광고(adBusinesses)는 별도 묶음이다. 같은 업체가 두 곳에 모두 있을 수 있다."""
    st = apollo_from_html(page_html) or {}
    rq = st.get("ROOT_QUERY", {})
    order, ads, total, inp = [], [], None, None
    for k, v in rq.items():
        if k.startswith("placeList(") and isinstance(v, dict):
            b = v.get("businesses") or {}
            order, total = refs(b.get("items")), b.get("total")
            m = re.match(r"placeList\((.*)\)$", k)
            inp = m.group(1) if m else None
        elif k.startswith("adBusinesses(") and isinstance(v, dict):
            ads = refs(v.get("items"))
    if not order:  # 구조가 바뀐 경우: 가장 긴 업체 목록 배열
        best = []

        def walk(o):
            nonlocal best
            if isinstance(o, list):
                r = [x for x in refs(o) if "Business" in x.split(":")[0]]
                if len(r) > len(best):
                    best = r
                for x in o:
                    walk(x)
            elif isinstance(o, dict):
                for x in o.values():
                    walk(x)
        walk(rq)
        order = best
    places = []
    for rank, ref in enumerate(order, 1):
        v = st.get(ref, {})
        hours = (v.get("newBusinessHours") or {}).get("status") if isinstance(v.get("newBusinessHours"), dict) else None
        places.append({
            "rank": rank, "id": ref.split(":")[-1], "name": v.get("name", ""),
            "category": v.get("category") or "",
            "visitor_reviews": parse_int(v.get("visitorReviewCount")),
            "visitor_score": v.get("visitorReviewScore"),
            "blog_reviews": parse_int(v.get("blogCafeReviewCount")),
            "image_count": parse_int(v.get("imageCount")),
            "booking": bool(v.get("hasBooking")),
            "talktalk": bool(v.get("talktalkUrl")),
            "coupon": bool(v.get("coupon")),
            "hours": hours,
            "phone": v.get("phone") or v.get("virtualPhone") or "",
            "distance": v.get("distance"),
            "address": v.get("roadAddress") or v.get("address") or "",
        })
    ad_list = [{"id": r.split(":")[-1], "name": (st.get(r) or {}).get("name", "")} for r in ads]
    return {"places": places, "ads": ad_list, "total": total, "input": inp}


def parse_serp(page_html, base):
    return {"items": group_links(links_from_html(page_html, base))}


def parse_google(page_html, base):
    """구글 모바일: '웹 검색결과' 제목 앞은 광고와 지도 결과, 뒤가 자연검색이다.
    앞부분의 '웹사이트' 버튼은 지도 결과(gmap), 그 밖의 외부 주소는 광고(ad)로 센다."""
    i = page_html.find("웹 검색결과")
    if i < 0:
        return parse_serp(page_html, base)
    head = group_links(links_from_html(page_html[:i], base))
    pre = []
    for it in head:
        if it["cls"] in ("web", "blog", "lawtalk"):
            cls = "gmap" if it["text"].strip() == "웹사이트" else "ad"
            pre.append({"cls": cls, "key": it["key"], "href": it["href"], "text": it["text"]})
    for n, it in enumerate([x for x in pre if x["cls"] == "gmap"], 1):
        it["pos"] = n
    return {"items": pre + group_links(links_from_html(page_html[i:], base))}


class Collector:
    def __init__(self, page, outdir, cfg, headless):
        self.page, self.outdir, self.cfg, self.headless = page, outdir, cfg, headless
        self.n = len(list((outdir / "raw").glob("*.html.gz"))) if (outdir / "raw").exists() else 0

    def wait(self):
        lo, hi = self.cfg.get("delay_sec", [4, 8])
        time.sleep(random.uniform(lo, hi))

    def open(self, url, step):
        """페이지를 열어 원본을 저장하고 (상태, 원본 HTML, 저장 파일명)을 돌려준다."""
        try:
            self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
            self.page.wait_for_timeout(1500)
            if step == "place":
                for _ in range(3):
                    self.page.evaluate(SCROLL_JS)
                    self.page.wait_for_timeout(1200)
        except Exception as e:  # noqa: BLE001
            return f"error: {e.__class__.__name__}", "", ""
        if self.blocked():
            if self.headless:
                return "blocked", "", ""
            input("  보안문자 화면입니다. 브라우저에서 풀고 Enter를 누르세요...")
            if self.blocked():
                return "blocked", "", ""
        self.n += 1
        page_html = self.page.content()
        name = f"{step}__{self.n:03d}.html.gz"
        raw = self.outdir / "raw" / name
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_bytes(gzip.compress(page_html.encode("utf-8")))
        return "ok", page_html, name

    def blocked(self):
        try:
            body = (self.page.url + " " + self.page.inner_text("body")[:3000]).lower()
        except Exception:  # noqa: BLE001
            return False
        return any(m.lower() in body for m in BLOCK_MARKS)


def run_step(name, targets, out_json, fn):
    data = read_json(out_json, {})
    todo = [t for t in targets if data.get(t, {}).get("status") != "ok"]
    print(f"[{name}] {len(targets)}건 중 {len(todo)}건 수집")
    for i, t in enumerate(todo, 1):
        data[t] = fn(t)
        data[t]["at"] = datetime.now().isoformat(timespec="seconds")
        write_json(out_json, data)
        print(f"  {i}/{len(todo)} {t} -> {data[t]['status']}")
    return data


def reparse(outdir, urls):
    """저장된 원본 화면(raw)을 현재 분류 규칙으로 다시 분석한다."""
    def load(name):
        return gzip.decompress((outdir / "raw" / name).read_bytes()).decode("utf-8")
    for fname, kind in (("naver_serp", "naver"), ("google", "google"), ("place_list", "place")):
        data = read_json(outdir / f"{fname}.json", {})
        for k, v in data.items():
            if v.get("status") != "ok" or not v.get("raw"):
                continue
            h = load(v["raw"])
            base = urls[kind].split("?")[0]
            v.update(parse_place(h) if kind == "place" else (parse_google if kind == "google" else parse_serp)(h, base))
            if kind == "place" and not v["places"]:
                v["status"] = "empty"
        if data:
            write_json(outdir / f"{fname}.json", data)
            print(f"재분석: {fname} {len(data)}건")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="naver,place,google,missing")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--browser-path", default="", help="크롬 대신 쓸 실행 파일 경로")
    ap.add_argument("--config", default=str(CONFIG / "collect.json"))
    ap.add_argument("--missing-max", type=int, default=30, help="누락 점검할 최근 네이버 글 수")
    ap.add_argument("--reparse", metavar="DATE", help="해당 날짜 원본 화면을 다시 분석(브라우저 불필요)")
    a = ap.parse_args()

    cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    urls = cfg["urls"]
    if a.reparse:
        reparse(MEASURE / a.reparse, urls)
        return

    from playwright.sync_api import sync_playwright

    steps = [s.strip() for s in a.only.split(",") if s.strip()]
    kws = [r["keyword"] for r in read_keywords()]
    if a.limit:
        kws = kws[: a.limit]
    outdir = MEASURE / a.date
    outdir.mkdir(parents=True, exist_ok=True)
    office = cfg.get("office") or {}
    xy = f"&x={office['lng']}&y={office['lat']}" if office.get("lat") and office.get("lng") else ""

    meta = read_json(outdir / "meta.json", {})
    meta.update({"date": a.date, "keywords": len(kws), "device": cfg.get("device"),
                 "office": office, "steps": sorted(set(meta.get("steps", [])) | set(steps))})
    write_json(outdir / "meta.json", meta)

    with sync_playwright() as p:
        dev = dict(p.devices[cfg.get("device", "Pixel 7")])
        dev.pop("default_browser_type", None)
        opts = dict(headless=a.headless, locale="ko-KR", timezone_id="Asia/Seoul", **dev)
        if office.get("lat") and office.get("lng"):
            opts.update(geolocation={"latitude": office["lat"], "longitude": office["lng"]},
                        permissions=["geolocation"])
        if a.browser_path:
            opts["executable_path"] = a.browser_path
        else:
            opts["channel"] = "chrome"
        profile = Path(cfg.get("profile_dir", "~/.jinnsol-measure-profile")).expanduser()
        ctx = p.chromium.launch_persistent_context(str(profile), **opts)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        c = Collector(page, outdir, cfg, a.headless)

        def serp(url_key, step):
            parser = parse_google if step == "google" else parse_serp

            def fn(q):
                c.wait()
                st, h, raw = c.open(urls[url_key].format(q=quote(q)), step)
                rec = {"status": st, "raw": raw, "items": []}
                if st == "ok":
                    rec.update(parser(h, page.url))
                return rec
            return fn

        def place(q):
            c.wait()
            st, h, raw = c.open(urls["place"].format(q=quote(q), xy=xy), "place")
            rec = {"status": st, "raw": raw, "places": []}
            if st == "ok":
                rec.update(parse_place(h))
                if not rec["places"]:
                    rec["status"] = "empty"
            return rec

        if "naver" in steps:
            run_step("네이버 통합검색", kws, outdir / "naver_serp.json", serp("naver", "naver"))
        if "place" in steps:
            run_step("네이버 플레이스 목록", kws, outdir / "place_list.json", place)
        if "google" in steps:
            run_step("구글", kws, outdir / "google.json", serp("google", "google"))
        if "missing" in steps:
            posts = []
            if LEDGER.exists():
                with LEDGER.open(encoding="utf-8") as f:
                    posts = [r for r in csv.DictReader(f) if r["channel"] == "naver" and r.get("url")]
            posts = posts[-a.missing_max:]
            by_title = {r["title"]: r for r in posts}

            def missing(title):
                m = re.search(r"blog\.naver\.com/([^/]+)/(\d+)", by_title[title]["url"])
                key = f"{m.group(1)}/{m.group(2)}" if m else ""
                res = {"url": by_title[title]["url"], "date": by_title[title]["date"], "found": False, "raw": []}
                for uk in ("missing", "missing_blog"):
                    if uk not in urls:
                        continue
                    c.wait()
                    st, h, raw = c.open(urls[uk].format(q=quote(title)), "missing")
                    if st != "ok":
                        res["status"] = st
                        return res
                    res["raw"].append(raw)
                    if any(it["cls"] == "blog" and it["key"] == key for it in parse_serp(h, page.url)["items"]):
                        res.update(found=True, where=uk)
                        break
                res["status"] = "ok"
                return res
            run_step("발행 글 누락 점검", list(by_title), outdir / "missing.json", missing)
        ctx.close()
    print(f"완료: {outdir}")


if __name__ == "__main__":
    main()
