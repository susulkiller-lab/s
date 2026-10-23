"""마케팅 노출 수집기. 창원 사무실 PC(윈도우)에서 크롬으로 실행한다.

  py tools\\mkt_collect.py                     # 전체(네이버·플레이스·구글·누락 점검)
  py tools\\mkt_collect.py --only naver,place  # 일부만
  py tools\\mkt_collect.py --limit 5           # 키워드 5개만(시험용)

결과: data/measure/<오늘 날짜>/ 아래 naver_serp.json, place_list.json, google.json, missing.json,
      원본 화면은 raw/(저장소에는 올리지 않음). 중간에 끊겨도 다시 실행하면 끝난 키워드는 건너뛴다.
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
from mkt_common import (CONFIG, LEDGER, MEASURE, group_links, read_json,  # noqa: E402
                        read_keywords, write_json)

LINKS_JS = """() => [...document.querySelectorAll('a[href]')].map(a => ({
  href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 150)
}))"""

PLACE_JS = """() => {
  const ids = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const m = a.href.match(/place\\/(\\d{5,})/); if (m && !ids.includes(m[1])) ids.push(m[1]);
  });
  return {apollo: window.__APOLLO_STATE__ || null, dom_ids: ids};
}"""

SCROLL_JS = """() => { document.querySelectorAll('*').forEach(el => {
  if (el.scrollHeight > el.clientHeight + 50) el.scrollTop = el.scrollHeight; });
  window.scrollTo(0, document.body.scrollHeight); }"""

BLOCK_MARKS = ("자동입력 방지", "자동 입력 방지", "captcha", "비정상적인 트래픽", "unusual traffic", "/sorry/")


def parse_int(v):
    if v is None:
        return None
    m = re.search(r"\d[\d,]*", str(v))
    return int(m.group(0).replace(",", "")) if m else None


def parse_apollo(state, dom_ids):
    """플레이스 목록 화면의 내장 데이터에서 순위와 공개 지표를 뽑는다."""
    places = {}
    for k, v in (state or {}).items():
        m = re.match(r"([A-Za-z]*(?:Place|Summary|Business)[A-Za-z]*):(\d+)", k)
        if m and isinstance(v, dict) and v.get("name"):
            places[m.group(2)] = v
    order, best = [], []

    def walk(o):
        nonlocal best
        if isinstance(o, list):
            refs = [x["__ref"].split(":")[-1] for x in o if isinstance(x, dict) and "__ref" in x]
            refs = [r for r in refs if r in places]
            if len(refs) > len(best):
                best = refs
            for x in o:
                walk(x)
        elif isinstance(o, dict):
            for x in o.values():
                walk(x)

    walk((state or {}).get("ROOT_QUERY"))
    order = best or [i for i in dom_ids if i in places] or list(dom_ids)
    out, rank = [], 0
    for pid in order:
        v = places.get(pid, {})
        ad = bool(v.get("adId") or v.get("isAd") or v.get("isAdPlace"))
        if not ad:
            rank += 1
        out.append({
            "rank": None if ad else rank, "ad": ad, "id": pid, "name": v.get("name", ""),
            "category": v.get("category") or v.get("categoryName") or "",
            "visitor_reviews": parse_int(v.get("visitorReviewCount")),
            "blog_reviews": parse_int(v.get("blogCafeReviewCount")),
            "total_reviews": parse_int(v.get("totalReviewCount") or v.get("reviewCount")),
            "address": v.get("roadAddress") or v.get("address") or "",
        })
    return out


class Collector:
    def __init__(self, page, outdir, cfg, headless):
        self.page, self.outdir, self.cfg, self.headless = page, outdir, cfg, headless
        self.n = 0

    def wait(self):
        lo, hi = self.cfg.get("delay_sec", [4, 8])
        time.sleep(random.uniform(lo, hi))

    def open(self, url, step):
        self.n += 1
        try:
            self.page.goto(url, wait_until="domcontentloaded", timeout=30000)
            self.page.wait_for_timeout(1500)
        except Exception as e:  # noqa: BLE001
            return f"error: {e.__class__.__name__}"
        if self.blocked():
            if self.headless:
                return "blocked"
            input("  보안문자 화면입니다. 브라우저에서 풀고 Enter를 누르세요...")
            if self.blocked():
                return "blocked"
        raw = self.outdir / "raw" / f"{step}__{self.n:03d}.html.gz"
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_bytes(gzip.compress(self.page.content().encode("utf-8")))
        return "ok"

    def blocked(self):
        try:
            body = (self.page.url + " " + self.page.inner_text("body")[:3000]).lower()
        except Exception:  # noqa: BLE001
            return False
        return any(m.lower() in body for m in BLOCK_MARKS)

    def links(self):
        return self.page.evaluate(LINKS_JS)


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="naver,place,google,missing")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--date", default=date.today().isoformat())
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--browser-path", default="", help="크롬 대신 쓸 실행 파일 경로")
    ap.add_argument("--config", default=str(CONFIG / "collect.json"))
    ap.add_argument("--missing-max", type=int, default=30, help="누락 점검할 최근 네이버 글 수")
    a = ap.parse_args()

    from playwright.sync_api import sync_playwright

    cfg = json.loads(Path(a.config).read_text(encoding="utf-8"))
    urls = cfg["urls"]
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
            def fn(q):
                c.wait()
                st = c.open(urls[url_key].format(q=quote(q)), step)
                return {"status": st, "items": group_links(c.links()) if st == "ok" else []}
            return fn

        def place(q):
            c.wait()
            st = c.open(urls["place"].format(q=quote(q), xy=xy), "place")
            if st != "ok":
                return {"status": st, "places": []}
            for _ in range(3):
                page.evaluate(SCROLL_JS)
                page.wait_for_timeout(1200)
            got = page.evaluate(PLACE_JS)
            places = parse_apollo(got.get("apollo"), got.get("dom_ids", []))
            return {"status": "ok" if places else "empty", "places": places}

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
                res = {"url": by_title[title]["url"], "date": by_title[title]["date"], "found": False}
                for uk in ("missing", "missing_blog"):
                    if uk not in urls:
                        continue
                    c.wait()
                    st = c.open(urls[uk].format(q=quote(title)), "missing")
                    if st != "ok":
                        res["status"] = st
                        return res
                    if any(it["cls"] == "blog" and it["key"] == key for it in group_links(c.links())):
                        res.update(found=True, where=uk)
                        break
                res["status"] = "ok"
                return res
            run_step("발행 글 누락 점검", list(by_title), outdir / "missing.json", missing)
        ctx.close()
    print(f"완료: {outdir}")


if __name__ == "__main__":
    main()
