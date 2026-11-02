"""마케팅 측정 도구 시험. 브라우저와 네트워크를 쓰지 않는다.

  py -m unittest discover -s tools -p "test_mkt.py"

합성 자료로 규칙을 시험하고, data/measure의 저장 원본이 있으면 그것을 고정 입력으로도 돌린다.
"""
import contextlib
import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mkt_all  # noqa: E402
import mkt_collect  # noqa: E402
import mkt_common  # noqa: E402
import mkt_report  # noqa: E402
import mkt_stats  # noqa: E402
from mkt_common import classify, group_links, match_item  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
KEYWORDS = ["k1", "k2", "k3", "k4"]
ENTITIES = {
    "us": {"key": "우리", "names": ["우리법률"], "place_ids": ["100"], "blog_ids": ["ourblog"],
           "domains": ["our.example"], "phones": []},
    "competitors": [
        {"key": "가나", "names": ["가나법무법인"], "place_ids": ["200"], "blog_ids": [], "domains": ["ga.example"]},
        {"key": "다라", "names": ["다라법률"], "place_ids": ["300"], "blog_ids": [], "domains": ["da.example"]},
    ],
    "network_firms": ["네트워크"],
}
SCORING = {"rank_points": [[1, 10], [2, 8], [3, 6], [5, 4], [10, 2]],
           "ai_mention_points": [[1, 10], [2, 8], [3, 6], [5, 4], [99, 2]],
           "channel_weights": {"naver": 35, "place": 25, "google": 15, "ai": 15},
           "publish_gap_days": 28, "weak_top": 15, "discovery_top": 15,
           "min_channel_coverage": 0.7, "min_ai_coverage": 0.5}
LONG_ANSWER = "우리법률과 가나법무법인을 추천합니다. " * 30


def ent(key, names=(), blog_ids=(), domains=(), place_ids=()):
    return {"key": key, "names": list(names), "_names": [mkt_common.norm(n) for n in names],
            "blog_ids": list(blog_ids), "domains": list(domains), "place_ids": list(place_ids)}


def web(domain, pos, text=""):
    return {"cls": "web", "key": domain, "href": f"https://{domain}/", "text": text, "pos": pos, "content_pos": pos}


def place_row(pid, rank, name=""):
    return {"rank": rank, "id": pid, "name": name}


class Sandbox:
    """임시 폴더에 설정과 측정 결과를 만들어 실제 저장소를 건드리지 않고 도구를 돌린다."""

    def __enter__(self):
        self.root = Path(tempfile.mkdtemp())
        self.config = self.root / "marketing" / "config"
        self.config.mkdir(parents=True)
        self.measure = self.root / "data" / "measure"
        self.measure.mkdir(parents=True)
        self.consults = self.root / "data" / "consults_local.csv"
        self.consults_old = self.root / "data" / "consults.csv"
        (self.config / "entities.json").write_text(json.dumps(ENTITIES, ensure_ascii=False), encoding="utf-8")
        (self.config / "scoring.json").write_text(json.dumps(SCORING), encoding="utf-8")
        (self.config / "collect.json").write_text(json.dumps({"urls": {
            "naver": "https://m.search.naver.com/search.naver?query={q}",
            "google": "https://www.google.com/search?q={q}",
            "place": "https://pcmap.place.naver.com/place/list?query={q}{xy}"}}), encoding="utf-8")
        (self.config / "keywords.csv").write_text(
            "keyword,priority,volume\n" + "".join(f"{k},1,\n" for k in KEYWORDS), encoding="utf-8")
        (self.config / "ai_prompts.csv").write_text("id,prompt\na01,질문하나\na02,질문둘\n", encoding="utf-8")
        self.patches = [
            mock.patch.multiple(mkt_common, ROOT=self.root, MKT=self.root / "marketing", CONFIG=self.config,
                                MEASURE=self.measure, CONSULTS=self.consults, CONSULTS_OLD=self.consults_old,
                                LEDGER=self.root / "data" / "published.csv"),
            mock.patch.multiple(mkt_report, ROOT=self.root, CONSULTS=self.consults, CONSULTS_OLD=self.consults_old,
                                LEDGER=self.root / "data" / "published.csv"),
            mock.patch.multiple(mkt_collect, CONFIG=self.config, MEASURE=self.measure),
        ]
        for p in self.patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def write(self, date, naver=None, place=None, google=None, ai=None):
        """naver·google: {키워드: 항목 목록 또는 상태 문자열}, place: {키워드: 순위 목록 또는 상태 문자열}, ai: {파일명: 내용}."""
        d = self.measure / date
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(json.dumps({"date": date, "keywords": len(KEYWORDS), "device": "시험",
                                                 "parser_version": getattr(mkt_common, "PARSER_VERSION", 0)}), encoding="utf-8")

        def recs(src, field):
            out = {}
            for k, v in (src or {}).items():
                out[k] = {"status": v, field: []} if isinstance(v, str) else {"status": "ok", field: v}
            return out
        for name, src, field in (("naver_serp", naver, "items"), ("google", google, "items"), ("place_list", place, "places")):
            if src is not None:
                (d / f"{name}.json").write_text(json.dumps(recs(src, field), ensure_ascii=False), encoding="utf-8")
        if ai:
            (d / "ai").mkdir(exist_ok=True)
            for fname, text in ai.items():
                data = text if isinstance(text, bytes) else text.encode("utf-8")
                (d / "ai" / fname).write_bytes(data)
        return d

    def load(self, date, owner_names=None):
        cfg = mkt_common.load_entities()
        return mkt_report.load_measure(self.measure / date, cfg["_list"], mkt_common.read_keywords(),
                                       mkt_common.read_prompts(), mkt_common.load_scoring(), owner_names or {})

    def run_report(self, *args):
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["mkt_report.py", *args]), contextlib.redirect_stdout(buf):
            mkt_report.main()
        return buf.getvalue()

    def txt(self, date):
        return (self.root / "output" / "marketing" / f"{date}_리포트.txt").read_text(encoding="utf-8")

    def docx_text(self, date):
        import docx
        doc = docx.Document(str(self.root / "output" / "marketing" / f"{date}_리포트.docx"))
        parts = [p.text for p in doc.paragraphs]
        for t in doc.tables:
            for row in t.rows:
                parts.extend(c.text for c in row.cells)
        return "\n".join(parts)


def full_naver():
    return {k: [web("our.example", 1), web("ga.example", 2)] for k in KEYWORDS}


class ClassifyTests(unittest.TestCase):
    def test_kin_dirs_docs_address_is_classified(self):
        self.assertEqual(classify("https://m.kin.naver.com/qna/dirs/90111/docs/427647029?enc=utf8"), ("kin", "427647029"))

    def test_kin_detail_address_is_still_classified(self):
        self.assertEqual(classify("https://kin.naver.com/qna/detail.naver?d1id=6&docId=123"), ("kin", "123"))

    def test_kin_home_is_not_a_result(self):
        self.assertIsNone(classify("https://m.kin.naver.com/mobile/index.naver"))

    def test_naver_news_article_holds_its_own_slot(self):
        a = classify("https://n.news.naver.com/article/079/0004201422?sid=100")
        b = classify("https://n.news.naver.com/article/079/0004201423?sid=100")
        self.assertEqual(a[0], "web")
        self.assertNotEqual(a, b)

    def test_naver_tv_video_holds_a_slot_but_channel_home_does_not(self):
        self.assertEqual(classify("https://tv.naver.com/v/88438523")[0], "web")
        self.assertIsNone(classify("https://tv.naver.com/winninglaw21"))


class GroupLinksTests(unittest.TestCase):
    def card(self, owner, n=12):
        return [{"href": f"https://blog.naver.com/{owner}/{1000000 + i}", "text": f"글{i}"} for i in range(n)]

    def test_profile_card_counts_as_one_result(self):
        items = group_links(self.card("cardowner") + [{"href": "https://cafe.naver.com/c/1", "text": "카페"}])
        self.assertEqual([i["cls"] for i in items], ["blog", "cafe"])
        self.assertEqual(items[0]["card"], 12)
        self.assertEqual(items[1]["content_pos"], 2)

    def test_two_posts_from_one_owner_stay_separate(self):
        items = group_links(self.card("twoposts", 2))
        self.assertEqual(len(items), 2)
        self.assertNotIn("card", items[0])

    def test_post_inside_card_is_still_found_by_missing_check(self):
        items = group_links(self.card("cardowner"))
        self.assertTrue(mkt_common.has_post(items, "cardowner/1000005"))
        self.assertFalse(mkt_common.has_post(items, "cardowner/9999999"))

    def test_owner_name_comes_from_profile_link(self):
        items = group_links([{"href": "https://m.blog.naver.com/abc", "text": "가나법무법인 공식"},
                             {"href": "https://blog.naver.com/abc/1234567", "text": "제목"}])
        self.assertIn("가나법무법인", items[0]["owner_name"])

    def test_owner_name_keeps_firm_name_at_the_end_of_a_long_description(self):
        text = "약 1천 명의 구독자를 보유한 창원 변호사의 블로그. " + "□ 창원 변호사 " * 25 + "가나법무법인"
        items = group_links([{"href": "https://m.blog.naver.com/abc", "text": "창원 변호사"},
                             {"href": "https://m.blog.naver.com/abc", "text": text},
                             {"href": "https://blog.naver.com/abc/1234567", "text": "제목"}])
        self.assertIn("가나법무법인", items[0]["owner_name"])

    def test_owner_name_ignores_address_text(self):
        items = group_links([{"href": "https://blog.naver.com/abc", "text": "blog.naver.com › abc"},
                             {"href": "https://blog.naver.com/abc/1234567", "text": "제목"}])
        self.assertEqual(items[0].get("owner_name", ""), "")

    def test_unclassified_links_count_only_unknown_hosts(self):
        c = mkt_common.unclassified_hosts([{"href": "https://newblog.naver.com/x/1", "text": "새 형식"},
                                           {"href": "https://m.keep.naver.com/x", "text": "저장"},
                                           {"href": "https://blog.naver.com/a/1234567", "text": "분류됨"}])
        self.assertEqual(dict(c), {"newblog.naver.com": 1})


class MatchItemTests(unittest.TestCase):
    firm = ent("가나", names=["가나법무법인"], blog_ids=["registered"])

    def test_blog_matches_registered_id(self):
        self.assertTrue(match_item({"cls": "blog", "key": "registered/1", "text": ""}, self.firm))

    def test_blog_matches_owner_name(self):
        self.assertTrue(match_item({"cls": "blog", "key": "other/1", "text": "", "owner_name": "창원 가나 법무법인 공식"}, self.firm))

    def test_blog_title_alone_does_not_match(self):
        self.assertFalse(match_item({"cls": "blog", "key": "other/1", "text": "가나법무법인 후기"}, self.firm))

    def test_blog_with_unknown_owner_matches_by_text(self):
        self.assertTrue(match_item({"cls": "blog", "key": f"{mkt_common.UNKNOWN_OWNER}/1", "text": "가나법무법인 소식"}, self.firm))


class GoogleParseTests(unittest.TestCase):
    PAGE = """
    <a href="https://ad.example/">광고 문구 https://ad.example</a>
    <a href="https://shared.example/">웹사이트</a>
    <a href="https://shared.example/landing">공유 광고 https://shared.example</a>
    <div>웹 검색결과</div>
    <a href="https://map.example/">웹사이트</a>
    <a href="https://viewer.example/page">미리보기 제목</a>
    <a href="https://viewer.example/page">방문</a>
    <a href="https://www.google.com/goto?url=AAA">첫째 https://first.example 제목</a>
    <a href="https://www.google.com/goto?url=BBB">Naver Blog https://blog.naver.com 블로그 제목</a>
    <a href="https://www.google.com/goto?url=CCC">지도와 같은 곳 https://map.example 제목</a>
    <a href="https://www.google.com/goto?url=DDD">블로그 https://m.blog.naver.com 다른 블로그 제목</a>
    """

    def parsed(self):
        return mkt_collect.parse_google(self.PAGE, "https://www.google.com/search")["items"]

    def ranked(self):
        return [i for i in self.parsed() if i.get("content_pos")]

    def test_website_button_after_marker_is_map_result(self):
        self.assertIn(("gmap", "map.example"), [(i["cls"], i["key"]) for i in self.parsed()])

    def test_organic_result_is_not_merged_with_earlier_website_button(self):
        hit = next(i for i in self.ranked() if i["key"] == "map.example")
        self.assertEqual(hit["cls"], "web")
        self.assertEqual(hit["content_pos"], 3)

    def test_preview_viewer_links_get_no_rank(self):
        self.assertNotIn("viewer.example", [i["key"] for i in self.parsed()])

    def test_blog_without_owner_keeps_its_slot(self):
        keys = [i["key"] for i in self.ranked()]
        self.assertEqual(self.ranked()[1]["cls"], "blog")
        self.assertTrue(keys[1].startswith(mkt_common.UNKNOWN_OWNER + "/"))
        self.assertEqual(len(set(keys)), 4)

    def test_map_button_and_ad_on_same_domain_are_kept_apart(self):
        got = [(i["cls"], i["key"]) for i in self.parsed() if i["key"] == "shared.example"]
        self.assertIn(("gmap", "shared.example"), got)
        self.assertIn(("ad", "shared.example"), got)


class ReparseTests(unittest.TestCase):
    URLS = {"naver": "https://m.search.naver.com/search.naver", "google": "https://www.google.com/search",
            "place": "https://pcmap.place.naver.com/place/list"}

    def setup_place(self, sb, status="empty", raw="place__001.html.gz"):
        d = sb.measure / "2026-01-01"
        (d / "raw").mkdir(parents=True)
        html = 'window.__APOLLO_STATE__ = {"ROOT_QUERY": {"placeList(x)": {"businesses": {"items": [], "total": 0}}}};'
        (d / "raw" / "place__001.html.gz").write_bytes(gzip.compress(html.encode("utf-8")))
        (d / "place_list.json").write_text(json.dumps({"k1": {"status": status, "raw": raw, "places": [], "total": 0}}), encoding="utf-8")
        return d

    def test_old_empty_place_record_becomes_no_result(self):
        with Sandbox() as sb:
            d = self.setup_place(sb)
            with contextlib.redirect_stdout(io.StringIO()):
                mkt_collect.reparse(d, self.URLS)
            self.assertEqual(json.loads((d / "place_list.json").read_text(encoding="utf-8"))["k1"]["status"], "none")

    def test_reparse_stamps_current_rule_version(self):
        with Sandbox() as sb:
            d = self.setup_place(sb)
            with contextlib.redirect_stdout(io.StringIO()):
                mkt_collect.reparse(d, self.URLS)
            self.assertEqual(json.loads((d / "meta.json").read_text(encoding="utf-8"))["parser_version"], mkt_common.PARSER_VERSION)

    def test_missing_raw_file_leaves_version_unstamped(self):
        with Sandbox() as sb:
            d = self.setup_place(sb, raw="gone.html.gz")
            with contextlib.redirect_stdout(io.StringIO()):
                mkt_collect.reparse(d, self.URLS)
            self.assertIsNone(mkt_common.read_json(d / "meta.json", {}).get("parser_version"))

    def test_reparse_of_missing_round_creates_nothing(self):
        with Sandbox() as sb:
            ghost = sb.measure / "2026-09-09"
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertFalse(mkt_collect.reparse(ghost, self.URLS))
            self.assertFalse(ghost.exists())

    def test_resuming_old_round_brings_records_to_current_rules(self):
        with Sandbox() as sb:
            d = self.setup_place(sb)
            with contextlib.redirect_stdout(io.StringIO()):
                meta = mkt_collect.start_meta(d, "2026-01-01", ["k1"], {"device": "시험"}, {}, ["place"])
            self.assertEqual(meta["parser_version"], mkt_common.PARSER_VERSION)
            self.assertEqual(json.loads((d / "place_list.json").read_text(encoding="utf-8"))["k1"]["status"], "none")

    def test_new_round_is_stamped_without_reparse(self):
        with Sandbox() as sb:
            d = sb.measure / "2026-02-02"
            d.mkdir()
            meta = mkt_collect.start_meta(d, "2026-02-02", ["k1"], {"device": "시험"}, {}, ["naver"])
            self.assertEqual(meta["parser_version"], mkt_common.PARSER_VERSION)

    def test_resume_collects_again_when_ok_page_had_no_items(self):
        with Sandbox() as sb:
            out = sb.measure / "steps.json"
            out.write_text(json.dumps({"k1": {"status": "ok", "items": []}, "k2": {"status": "ok", "items": [{"x": 1}]}}), encoding="utf-8")
            asked = []

            def fetch(t):
                asked.append(t)
                return {"status": "ok", "items": [{"x": 2}]}
            with contextlib.redirect_stdout(io.StringIO()):
                mkt_collect.run_step("시험", ["k1", "k2"], out, fetch, "items")
            self.assertEqual(asked, ["k1"])

    def test_report_reparses_measure_made_with_old_rules(self):
        with Sandbox() as sb:
            d = self.setup_place(sb)
            (d / "naver_serp.json").write_text(json.dumps({k: {"status": "ok", "items": [web("our.example", 1)]} for k in KEYWORDS}), encoding="utf-8")
            sb.run_report("--date", "2026-01-01")
            self.assertEqual(json.loads((d / "place_list.json").read_text(encoding="utf-8"))["k1"]["status"], "none")


class CompareTests(unittest.TestCase):
    def compare(self, sb, cur="2026-01-08", prev="2026-01-01"):
        return mkt_report.compare(sb.load(cur), sb.load(prev), mkt_common.load_entities()["_list"], SCORING)

    def test_delta_uses_only_keywords_measured_in_both(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", place={"k1": [place_row("100", 1)], "k2": [place_row("100", 1)], "k3": [place_row("100", 1)], "k4": "none"})
            sb.write("2026-01-08", place={"k1": [place_row("100", 1)], "k2": [place_row("100", 1)], "k3": [place_row("100", 1)], "k4": [place_row("200", 1)]})
            cmp = self.compare(sb)
            self.assertEqual(cmp["counts"]["place"], (3, 4))
            self.assertEqual(cmp["delta"]["우리"]["place"], 0.0)

    def test_channel_missing_before_gets_no_delta_and_index_uses_common_channels(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver=full_naver())
            sb.write("2026-01-08", naver=full_naver(), ai={f"{e}__{p}__1.txt": LONG_ANSWER for e in ("chatgpt", "gemini", "perplexity") for p in ("a01", "a02")})
            cmp = self.compare(sb)
            self.assertIsNone(cmp["delta"]["우리"].get("ai"))
            self.assertEqual(cmp["delta"]["우리"]["index"], 0.0)

    def test_too_few_common_keywords_hide_delta(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver={k: [web("our.example", 1)] for k in KEYWORDS[:3]} | {"k4": "blocked"})
            prev = sb.load("2026-01-01")
            for kw in ("k2", "k3"):
                prev["ranks"][kw]["measured"]["naver"] = False
            sb.write("2026-01-08", naver=full_naver())
            cmp = mkt_report.compare(sb.load("2026-01-08"), prev, mkt_common.load_entities()["_list"], SCORING)
            self.assertIsNone(cmp["delta"]["우리"].get("naver"))
            self.assertIn("naver", cmp["hidden"])

    def test_previous_is_rescored_with_current_entities(self):
        with Sandbox() as sb:
            item = {"cls": "blog", "key": "newid/1234567", "href": "", "text": "", "pos": 1, "content_pos": 1}
            sb.write("2026-01-01", naver={k: [item] for k in KEYWORDS})
            sb.write("2026-01-08", naver={k: [item] for k in KEYWORDS})
            (sb.measure / "2026-01-01" / "scores.json").write_text(json.dumps({"scores": {"가나": {"naver": 0.0, "index": 0.0}}, "ranks": {}}), encoding="utf-8")
            cfg = json.loads(json.dumps(ENTITIES))
            cfg["competitors"][0]["blog_ids"] = ["newid"]
            (sb.config / "entities.json").write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
            self.assertEqual(self.compare(sb)["delta"]["가나"]["naver"], 0.0)

    def test_place_list_and_search_block_are_not_compared(self):
        with Sandbox() as sb:
            blk = {"cls": "place", "key": "100", "href": "", "text": "", "pos": 1}
            sb.write("2026-01-01", naver={k: [blk] for k in KEYWORDS})
            sb.write("2026-01-08", naver={k: [blk] for k in KEYWORDS}, place={k: [place_row("100", 2)] for k in KEYWORDS})
            cmp = self.compare(sb)
            self.assertEqual(cmp["counts"]["place"], (0, 4))
            self.assertIsNone(cmp["delta"]["우리"].get("place"))

    def test_current_round_on_old_rules_gets_no_delta(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", place={k: "none" for k in KEYWORDS}, naver={k: [web("ga.example", 1)] for k in KEYWORDS})
            d = sb.write("2026-01-08", place={k: "none" for k in KEYWORDS}, naver=full_naver())
            (d / "meta.json").write_text(json.dumps({"date": "2026-01-08", "parser_version": 1}), encoding="utf-8")
            sb.run_report("--date", "2026-01-08")
            text = sb.txt("2026-01-08")
            line = next(x for x in text.splitlines() if x.startswith("- 우리 종합 노출지수"))
            self.assertNotIn("(+", line)
            self.assertIn("분류 규칙", text)

    def test_unknown_previous_date_is_an_error(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            with self.assertRaises(SystemExit):
                sb.run_report("--date", "2026-01-08", "--prev", "2026-01-02")

    def test_rank_move_needs_keyword_measured_before(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver={"k1": [web("ga.example", 1)], "k2": [web("ga.example", 1)], "k3": [web("ga.example", 1)], "k4": "blocked"})
            sb.write("2026-01-08", naver=full_naver())
            moves = mkt_report.rank_moves(sb.load("2026-01-08"), sb.load("2026-01-01"), "우리")
            self.assertEqual(len(moves), 3)
            self.assertFalse(any("k4" in m for m in moves))


class OwnerNameTests(unittest.TestCase):
    def test_owner_name_seen_only_on_another_page_still_matches(self):
        page_with_profile = """<a href="https://m.blog.naver.com/abc">창원 가나법무법인 블로그</a>"""
        page_with_post = """<a href="https://blog.naver.com/abc/1234567">제목</a>"""
        base = "https://m.search.naver.com/search.naver"
        with Sandbox() as sb:
            d = sb.measure / "2026-01-01"
            d.mkdir()
            serp = {"k1": dict(mkt_collect.parse_serp(page_with_profile, base), status="ok"),
                    "k2": dict(mkt_collect.parse_serp(page_with_post, base), status="ok")}
            (d / "naver_serp.json").write_text(json.dumps(serp, ensure_ascii=False), encoding="utf-8")
            names = mkt_report.owner_names_all([d])
            self.assertIn("가나법무법인", mkt_common.norm(names["abc"]))
            m = sb.load("2026-01-01", names)
            self.assertEqual(m["ranks"]["k2"]["ranks"]["가나"]["naver"], 1)


class CoverageTests(unittest.TestCase):
    def test_blocked_keyword_is_counted(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", google={"k1": [web("a.example", 1)], "k2": [web("a.example", 1)], "k3": [web("a.example", 1)], "k4": "blocked"})
            st = mkt_common.channel_status(sb.measure / "2026-01-01", mkt_common.read_keywords())
            self.assertEqual(st["google"]["ok"], 3)
            self.assertEqual(st["google"]["target"], 4)
            self.assertEqual(st["google"]["failed"], {"차단": 1})

    def test_channel_below_minimum_is_not_scored(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver=full_naver(),
                     google={"k1": [web("our.example", 1)], "k2": "blocked", "k3": "blocked", "k4": "blocked"})
            m = sb.load("2026-01-01")
            self.assertFalse(m["have"]["google"])
            self.assertIsNone(m["per"]["우리"].get("google"))

    def test_ok_page_with_no_items_is_not_measured(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver={"k1": [web("our.example", 1)], "k2": [], "k3": [web("our.example", 1)], "k4": [web("our.example", 1)]})
            m = sb.load("2026-01-01")
            self.assertFalse(m["ranks"]["k2"]["measured"]["naver"])
            self.assertEqual(m["status"]["naver"]["failed"], {"빈 화면": 1})

    def test_problems_name_channels_below_minimum(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver=full_naver(), google={"k1": "blocked", "k2": "blocked", "k3": "blocked", "k4": "blocked"})
            problems = mkt_common.collection_problems(sb.measure / "2026-01-01")
            self.assertTrue(any("구글" in p and "0/4" in p for p in problems))
            self.assertFalse(any("네이버 콘텐츠" in p for p in problems))


class AiCheckTests(unittest.TestCase):
    def check(self, files):
        with Sandbox() as sb:
            d = sb.write("2026-01-01", ai=files)
            return mkt_common.check_ai_files(d, mkt_common.read_prompts())

    def test_full_answer_is_valid(self):
        good, bad = self.check({"chatgpt__a01__1.txt": LONG_ANSWER})
        self.assertEqual((len(good), bad), (1, []))

    def test_short_file_is_rejected(self):
        good, bad = self.check({"chatgpt__a01__1.txt": "짧은 답"})
        self.assertEqual(good, [])
        self.assertIn("짧", bad[0][1])

    def test_login_notice_is_rejected(self):
        good, bad = self.check({"chatgpt__a01__1.txt": "계속하려면 로그인하세요. " * 20})
        self.assertEqual(good, [])
        self.assertIn("안내", bad[0][1])

    def test_long_answer_mentioning_login_is_kept(self):
        good, _ = self.check({"chatgpt__a01__1.txt": LONG_ANSWER + "홈페이지 로그인 후 상담 신청이 가능합니다. " + LONG_ANSWER})
        self.assertEqual(len(good), 1)

    def test_bad_file_name_is_rejected(self):
        good, bad = self.check({"chatgpt_a01_1.txt": LONG_ANSWER, "chatgpt__a99__1.txt": LONG_ANSWER, "unknown__a01__1.txt": LONG_ANSWER})
        self.assertEqual((good, len(bad)), ([], 3))

    def test_undecodable_file_is_rejected_without_crash(self):
        good, bad = self.check({"chatgpt__a01__1.txt": b"\xff\xfe\x00\x81" * 200})
        self.assertEqual((good, len(bad)), ([], 1))

    def test_invalid_answer_stays_out_of_the_denominator(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver=full_naver(), ai={"chatgpt__a01__1.txt": LONG_ANSWER, "chatgpt__a02__1.txt": LONG_ANSWER,
                                                          "gemini__a01__1.txt": LONG_ANSWER, "gemini__a02__1.txt": "로그인"})
            self.assertEqual(sb.load("2026-01-01")["per"]["우리"]["ai_mention_rate"], 100.0)

    def test_too_few_answers_leave_ai_unmeasured(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", naver=full_naver(), ai={"chatgpt__a01__1.txt": LONG_ANSWER})
            m = sb.load("2026-01-01")
            self.assertEqual(m["ai"], [])
            self.assertIsNone(m["per"]["우리"].get("ai"))


class CsvTests(unittest.TestCase):
    def test_consults_saved_in_cp949_are_read(self):
        with Sandbox() as sb:
            sb.consults.write_bytes("date,channel,area,region,retained\n2026-01-05,플레이스,형사,창원,Y\n".encode("cp949"))
            cur, prev, bad = mkt_report.consult_summary("2026-01-01", "2026-01-08")
            self.assertEqual((len(cur), bad), (1, 0))

    def test_other_date_styles_are_read_and_unreadable_ones_counted(self):
        with Sandbox() as sb:
            sb.consults.write_text("date,channel,area,region,retained\n2026.1.5,가,,,\n2026/01/06,나,,,\n어제,다,,,\n", encoding="utf-8")
            cur, _, bad = mkt_report.consult_summary("2026-01-01", "2026-01-08")
            self.assertEqual((len(cur), bad), (2, 1))

    def test_keyword_volume_with_comma_is_read(self):
        with Sandbox() as sb:
            (sb.config / "keywords.csv").write_text('keyword,priority,volume\nk1,1,"1,200"\nk2,1,\n', encoding="utf-8")
            self.assertEqual(mkt_common.read_keywords()[0]["weight"], 1200.0)

    def test_keywords_saved_in_cp949_are_read(self):
        with Sandbox() as sb:
            (sb.config / "keywords.csv").write_bytes("keyword,priority,volume\n창원,1,\n".encode("cp949"))
            self.assertEqual(mkt_common.read_keywords()[0]["keyword"], "창원")


class ReportOutputTests(unittest.TestCase):
    def two_rounds(self, sb):
        none = {k: "none" for k in KEYWORDS}  # 플레이스 결과가 없는 키워드만 두어 네이버 변동이 그대로 지수에 나오게 한다
        sb.write("2026-01-01", place=none, naver={k: [web("ga.example", 1), web("our.example", 2)] for k in KEYWORDS})
        sb.write("2026-01-08", place=none, naver=full_naver(), google={"k1": [web("our.example", 1)], "k2": [web("our.example", 1)],
                                                           "k3": [web("our.example", 1)], "k4": "blocked"})

    def test_first_lines_show_collection_counts(self):
        with Sandbox() as sb:
            self.two_rounds(sb)
            sb.run_report("--date", "2026-01-08")
            head = "\n".join(sb.txt("2026-01-08").splitlines()[:6])
            self.assertIn("구글 3/4(차단 1)", head)
            self.assertIn("네이버 콘텐츠 4/4", head)

    def test_txt_delta_is_on_common_basis(self):
        with Sandbox() as sb:
            self.two_rounds(sb)
            sb.run_report("--date", "2026-01-08")
            line = next(x for x in sb.txt("2026-01-08").splitlines() if x.startswith("- 우리 종합 노출지수"))
            self.assertIn("(+20.0)", line)

    def test_docx_shows_the_same_delta(self):
        with Sandbox() as sb:
            self.two_rounds(sb)
            sb.run_report("--date", "2026-01-08")
            self.assertIn("(+20.0)", sb.docx_text("2026-01-08"))

    def test_docx_without_previous_does_not_mention_delta(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.run_report("--date", "2026-01-08")
            self.assertNotIn("괄호는", sb.docx_text("2026-01-08"))

    def test_no_channel_means_no_rank(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver={k: "blocked" for k in KEYWORDS})
            sb.run_report("--date", "2026-01-08")
            self.assertNotIn("1위", sb.txt("2026-01-08").split("2. 채널별 점수")[0])
            self.assertNotIn("None", sb.docx_text("2026-01-08"))

    def test_tie_is_not_reported_as_sole_first(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver={k: [web("x.example", 1)] for k in KEYWORDS})
            sb.run_report("--date", "2026-01-08")
            self.assertIn("공동 1위", sb.txt("2026-01-08"))

    def test_consult_counts_stay_out_of_uploaded_report(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.consults.write_text("date,channel,area,region,retained\n2026-01-05,플레이스,형사,창원,Y\n", encoding="utf-8")
            sb.run_report("--date", "2026-01-08")
            uploaded = sb.txt("2026-01-08") + sb.docx_text("2026-01-08")
            for leak in ("상담 1건", "수임 1건", "유입 경로"):
                self.assertNotIn(leak, uploaded)
            local = (sb.root / "output" / "local" / "2026-01-08_상담요약.txt").read_text(encoding="utf-8")
            self.assertIn("상담 1건", local)
            self.assertIn("유입 경로", local)

    def test_docx_points_to_local_folder_without_mangling_a_date(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.consults.write_text("date,channel,area,region,retained\n2026-01-05,플레이스,형사,창원,Y\n", encoding="utf-8")
            sb.run_report("--date", "2026-01-08")
            line = next(x for x in sb.docx_text("2026-01-08").splitlines() if "output/local" in x)
            self.assertNotIn("2026.", line)

    def test_rows_typed_in_old_file_move_to_local_file_once(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.consults_old.write_text("date,channel,area,region,retained,memo\n2026-01-05,플레이스,형사,창원,Y,메모\n", encoding="utf-8")
            sb.run_report("--date", "2026-01-08")
            sb.run_report("--date", "2026-01-08")
            self.assertEqual(sb.consults_old.read_text(encoding="utf-8").strip(), "date,channel,area,region,retained,memo")
            rows = mkt_common.read_rows(sb.consults)
            self.assertEqual([(r["date"], r["memo"]) for r in rows], [("2026-01-05", "메모")])

    def test_consult_template_is_made_when_missing(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.run_report("--date", "2026-01-08")
            self.assertTrue(sb.consults.read_text(encoding="utf-8-sig").startswith("date,channel,area,region,retained"))

    def test_trend_uses_same_keywords_across_rounds(self):
        with Sandbox() as sb:
            none = {k: "none" for k in KEYWORDS}
            sb.write("2026-01-01", place=none, naver={"k1": [web("our.example", 1)], "k2": [web("our.example", 1)], "k3": [web("our.example", 1)], "k4": "blocked"})
            sb.write("2026-01-08", place=none, naver={"k1": [web("our.example", 1)], "k2": [web("our.example", 1)], "k3": [web("our.example", 1)], "k4": [web("ga.example", 1)]})
            sb.run_report("--date", "2026-01-08")
            self.assertIn("2026-01-01 100.0 / 2026-01-08 100.0", sb.txt("2026-01-08"))

    def test_blog_warning_names_firms_without_a_blog(self):
        with Sandbox() as sb:
            item = {"cls": "blog", "key": "gablog/1234567", "href": "", "text": "", "owner_name": "가나법무법인", "pos": 1, "content_pos": 1}
            sb.write("2026-01-08", naver={k: [item] for k in KEYWORDS})
            sb.run_report("--date", "2026-01-08")
            line = next(x for x in sb.txt("2026-01-08").splitlines() if "비교군 블로그" in x)
            self.assertIn("블로그명 일치 1곳", line)
            self.assertIn("다라", line)

    def test_invalid_ai_file_is_reported(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver(), ai={"chatgpt__a01__1.txt": "로그인"})
            sb.run_report("--date", "2026-01-08")
            self.assertIn("chatgpt__a01__1.txt", sb.txt("2026-01-08"))

    def test_ai_order_is_labelled_among_registered_firms(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver(), ai={f"{e}__{p}__1.txt": LONG_ANSWER for e in ("chatgpt", "gemini", "perplexity") for p in ("a01", "a02")})
            sb.run_report("--date", "2026-01-08")
            self.assertIn("등록 업체 중 1번째", sb.docx_text("2026-01-08"))

    def test_locked_docx_is_written_as_new_copy(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.run_report("--date", "2026-01-08")
            real = os.replace

            def locked(src, dst):
                if str(dst).endswith("_리포트.docx"):
                    raise PermissionError("locked")
                return real(src, dst)
            with mock.patch.object(mkt_report.os, "replace", locked):
                out = sb.run_report("--date", "2026-01-08")
            self.assertTrue((sb.root / "output" / "marketing" / "2026-01-08_리포트(새본).docx").exists())
            self.assertIn("새본", out)
            self.assertEqual([p.name for p in (sb.root / "output" / "marketing").glob("*.tmp.docx")], [])

    def test_main_and_new_copy_both_open_still_saves_a_report(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            real = os.replace

            def locked(src, dst):
                if str(dst).endswith(("_리포트.docx", "(새본).docx")):
                    raise PermissionError("locked")
                return real(src, dst)
            with mock.patch.object(mkt_report.os, "replace", locked):
                sb.run_report("--date", "2026-01-08")
            names = [p.name for p in (sb.root / "output" / "marketing").glob("*.docx")]
            self.assertEqual(len(names), 1)
            self.assertIn("새본", names[0])

    def test_open_old_new_copy_does_not_fail_a_normal_save(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", naver=full_naver())
            sb.run_report("--date", "2026-01-08")
            stale = sb.root / "output" / "marketing" / "2026-01-08_리포트(새본).docx"
            stale.write_bytes(b"x")
            real = Path.unlink

            def locked(path, *a, **k):
                if path == stale:
                    raise PermissionError("locked")
                return real(path, *a, **k)
            with mock.patch.object(Path, "unlink", locked):
                sb.run_report("--date", "2026-01-08")
            self.assertTrue((sb.root / "output" / "marketing" / "2026-01-08_리포트.docx").exists())


class PublishTests(unittest.TestCase):
    """실제 git으로 임시 원격과 복제본을 만들어 올리기 단계를 시험한다."""

    def run_git(self, cwd, *args):
        return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=cwd,
                              capture_output=True, text=True, encoding="utf-8", errors="replace")

    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.base, ignore_errors=True)
        self.remote = self.base / "remote.git"
        self.run_git(self.base, "init", "--bare", "-b", "main", str(self.remote))
        self.repo = self.base / "repo"
        self.run_git(self.base, "clone", str(self.remote), str(self.repo))
        self.run_git(self.repo, "checkout", "-b", "main")
        for c in (("config", "user.name", "t"), ("config", "user.email", "t@example.com")):
            self.run_git(self.repo, *c)
        (self.repo / "data" / "measure" / "2026-01-01").mkdir(parents=True)
        (self.repo / "data" / "consults.csv").write_text("date\n", encoding="utf-8")
        (self.repo / "data" / "measure" / "2026-01-01" / "a.json").write_text("{}", encoding="utf-8")
        self.run_git(self.repo, "add", ".")
        self.run_git(self.repo, "commit", "-m", "처음")
        self.run_git(self.repo, "push", "-u", "origin", "HEAD")
        patcher = mock.patch.object(mkt_all, "ROOT", self.repo)
        patcher.start()
        self.addCleanup(patcher.stop)
        notes = mock.patch.object(mkt_all, "notes", [])
        notes.start()
        self.addCleanup(notes.stop)

    def change(self):
        (self.repo / "data" / "measure" / "2026-01-01" / "a.json").write_text('{"x": 1}', encoding="utf-8")

    def publish(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return mkt_all.publish("git", "2026-01-01")

    def remote_files(self):
        return self.run_git(self.repo, "ls-tree", "-r", "--name-only", "origin/main").stdout

    def test_consult_file_is_never_uploaded(self):
        self.change()
        (self.repo / "data" / "consults.csv").write_text("date\n2026-01-01\n", encoding="utf-8")
        self.assertTrue(self.publish())
        log = self.run_git(self.repo, "log", "-1", "--name-only", "--format=").stdout
        self.assertNotIn("consults", log)

    def test_missing_output_folder_does_not_cancel_upload(self):
        self.change()
        self.assertTrue(self.publish())
        self.assertIn("a.json", self.run_git(self.repo, "log", "-1", "--name-only", "--format=").stdout)
        self.assertNotIn("ahead", self.run_git(self.repo, "status", "-sb").stdout)

    def test_nothing_new_is_not_a_failure(self):
        self.assertTrue(self.publish())
        self.assertEqual(mkt_all.notes, [])

    def remote_moves_ahead(self):
        other = self.base / "other"
        self.run_git(self.base, "clone", str(self.remote), str(other))
        (other / "news.txt").write_text("x", encoding="utf-8")
        self.run_git(other, "add", ".")
        self.run_git(other, "commit", "-m", "다른 세션")
        self.run_git(other, "push")

    def assert_published_cleanly(self):
        self.run_git(self.repo, "fetch")
        self.assertIn("news.txt", self.remote_files())
        self.assertEqual(self.run_git(self.repo, "rev-parse", "HEAD").stdout, self.run_git(self.repo, "rev-parse", "origin/main").stdout)
        self.assertFalse((self.repo / ".git" / "rebase-merge").exists())
        self.assertFalse((self.repo / ".git" / "MERGE_HEAD").exists())

    def test_rejected_push_is_retried_after_taking_remote_changes(self):
        self.remote_moves_ahead()
        self.change()
        self.assertTrue(self.publish())
        self.assert_published_cleanly()

    def test_document_left_open_does_not_break_the_retry(self):
        out = self.repo / "output" / "marketing"
        out.mkdir(parents=True)
        doc = out / "2026-01-01_리포트.docx"
        doc.write_bytes(b"old")
        self.run_git(self.repo, "add", ".")
        self.run_git(self.repo, "commit", "-m", "문서")
        self.run_git(self.repo, "push")
        self.remote_moves_ahead()
        doc.write_bytes(b"new")
        with doc.open("rb"):  # 워드가 연 것처럼 쥐고 있는다. 윈도우에서는 지우거나 덮어쓸 수 없다
            self.assertTrue(self.publish())
        self.assert_published_cleanly()
        self.assertEqual(doc.read_bytes(), b"new")

    def run_main(self, sb, *args):
        """수집·리포트는 부르지 않고 원클릭의 마지막 순서만 본다."""
        calls = []
        out = sb.root / "output" / "marketing"
        out.mkdir(parents=True, exist_ok=True)
        (out / "2026-01-08_리포트.docx").write_bytes(b"x")
        done = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.multiple(mkt_all, ROOT=sb.root, ensure_packages=mock.DEFAULT, refresh_path=mock.DEFAULT,
                                 find_git=lambda: "git", git=lambda *a: done,
                                 publish=lambda g, d: calls.append("올리기") or True,
                                 open_report=lambda p: calls.append(p.name)), \
             mock.patch.object(mkt_all.subprocess, "run", lambda *a, **k: done), \
             mock.patch.object(sys, "argv", ["mkt_all.py", "--skip-collect", "--no-ai", "--date", "2026-01-08", *args]), \
             contextlib.redirect_stdout(io.StringIO()):
            mkt_all.main()
        return calls

    def test_document_opens_after_upload(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", place={k: "none" for k in KEYWORDS}, naver=full_naver(), google=full_naver())
            self.assertEqual(self.run_main(sb), ["올리기", "2026-01-08_리포트.docx"])

    def test_collection_below_minimum_is_not_uploaded(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", place={k: "none" for k in KEYWORDS}, naver=full_naver(), google={k: "blocked" for k in KEYWORDS})
            self.assertEqual(self.run_main(sb), ["2026-01-08_리포트.docx"])
            self.assertTrue(any("구글" in n for n in mkt_all.notes))

    def test_push_anyway_uploads_below_minimum(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", place={k: "none" for k in KEYWORDS}, naver=full_naver(), google={k: "blocked" for k in KEYWORDS})
            self.assertIn("올리기", self.run_main(sb, "--push-anyway"))

    def test_newest_copy_is_opened_and_mentioned(self):
        with Sandbox() as sb:
            sb.write("2026-01-08", place={k: "none" for k in KEYWORDS}, naver=full_naver(), google=full_naver())
            out = sb.root / "output" / "marketing"
            out.mkdir(parents=True)
            newer = out / "2026-01-08_리포트(새본).docx"
            newer.write_bytes(b"y")
            with mock.patch.object(mkt_all, "newest_report", lambda d: newer):
                self.assertEqual(self.run_main(sb)[-1], newer.name)
            self.assertTrue(any("새본" in n for n in mkt_all.notes))

    def test_commit_failure_is_reported(self):
        hook = self.repo / ".git" / "hooks" / "pre-commit"
        hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        self.change()
        self.assertFalse(self.publish())
        self.assertTrue(any("저장" in n for n in mkt_all.notes))


class RepoRuleTests(unittest.TestCase):
    def test_consult_file_is_ignored_by_git(self):
        if not (REPO / ".git").exists():
            self.skipTest("git 저장소 아님")
        r = subprocess.run(["git", "check-ignore", "data/consults_local.csv"], cwd=REPO, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)


class StoredRawTests(unittest.TestCase):
    """저장 원본을 고정 입력으로 쓴다. 규칙을 고치고 --reparse를 안 하면 여기서 걸린다."""
    DATE = "2026-11-01"

    def setUp(self):
        self.mdir = REPO / "data" / "measure" / self.DATE
        if not (self.mdir / "raw").exists():
            self.skipTest("저장 원본 없음")
        self.urls = json.loads((mkt_common.CONFIG / "collect.json").read_text(encoding="utf-8"))["urls"]

    def records(self, fname, n=3):
        data = mkt_common.read_json(self.mdir / fname, {})
        return [v for v in data.values() if v.get("status") == "ok" and v.get("raw")][:n]

    def html(self, rec):
        return gzip.decompress((self.mdir / "raw" / rec["raw"]).read_bytes()).decode("utf-8")

    def test_stored_naver_items_equal_reparse(self):
        for rec in self.records("naver_serp.json"):
            got = mkt_collect.parse_serp(self.html(rec), self.urls["naver"].split("?")[0])
            self.assertEqual({k: rec.get(k) for k in got}, got)
            self.assertIn("blog_owners", rec)

    def test_stored_google_items_equal_reparse(self):
        for rec in self.records("google.json"):
            got = mkt_collect.parse_google(self.html(rec), self.urls["google"].split("?")[0])
            self.assertEqual({k: rec.get(k) for k in got}, got)

    def test_no_owner_fills_the_naver_top_ten_with_one_card(self):
        for rec in mkt_common.read_json(self.mdir / "naver_serp.json", {}).values():
            top = [i for i in rec.get("items", []) if i.get("content_pos") and i["content_pos"] <= 10 and i["cls"] == "blog"]
            owners = [i["key"].split("/")[0] for i in top]
            self.assertLessEqual(max([owners.count(o) for o in owners] or [0]), 3)

    def test_website_buttons_get_no_google_rank(self):
        for rec in mkt_common.read_json(self.mdir / "google.json", {}).values():
            self.assertFalse([i for i in rec.get("items", []) if i.get("content_pos") and i["text"].strip() == "웹사이트"])

    def test_place_keywords_without_results_match_between_rounds(self):
        prev = mkt_common.read_json(REPO / "data" / "measure" / "2026-10-23" / "place_list.json", {})
        cur = mkt_common.read_json(self.mdir / "place_list.json", {})
        self.assertEqual({k for k, v in prev.items() if v.get("status") == "none"},
                         {k for k, v in cur.items() if v.get("status") == "none"})


class PrecisionTests(unittest.TestCase):
    """세부·신뢰도 보완: 순위 곡선, 오차 범위, 재측정, 지역 좌표, 분야별 지수."""
    CURVE = dict(SCORING, rank_curve={"decay": 0.85, "max_rank": 30},
                 channel_weights={"naver": 35, "place": 25, "google": 10, "gmap": 5, "ai": 15}, bootstrap=50)

    def test_curve_gives_points_beyond_tenth_place(self):
        self.assertEqual(mkt_common.curve_points(1, self.CURVE), 10)
        self.assertGreater(mkt_common.curve_points(18, self.CURVE), mkt_common.curve_points(21, self.CURVE))
        self.assertGreater(mkt_common.curve_points(18, self.CURVE), 0)
        self.assertEqual(mkt_common.curve_points(31, self.CURVE), 0)
        self.assertEqual(mkt_common.curve_points(7, SCORING), 2)  # rank_curve가 없으면 예전 계단식

    def test_wilson_interval(self):
        lo, hi = mkt_stats.wilson(2, 24)
        self.assertAlmostEqual(lo, 2.3, places=1)
        self.assertAlmostEqual(hi, 25.8, places=1)
        self.assertIsNone(mkt_stats.wilson(0, 0))

    def test_post_age_is_read_from_snippet(self):
        self.assertEqual(mkt_stats.age_days("43분 전 | 제목", "2026-11-01"), 0)
        self.assertEqual(mkt_stats.age_days("3주 전 | 제목", "2026-11-01"), 21)
        self.assertEqual(mkt_stats.age_days("2026.10.02. | 제목", "2026-11-01"), 30)
        self.assertIsNone(mkt_stats.age_days("제목만 있음", "2026-11-01"))

    def test_keyword_words_in_firm_name(self):
        self.assertEqual(mkt_stats.name_kw("법무법인나우 창원형사이혼전문변호사", "창원 형사변호사"), (2, 2))
        self.assertEqual(mkt_stats.name_kw("진앤솔 법률사무소", "창원 형사변호사"), (0, 2))
        self.assertEqual(mkt_stats.distance_km("330m"), 0.33)

    def test_region_keyword_uses_region_coordinates(self):
        cfg = {"office": {"lat": 35.1, "lng": 128.1}, "regions": {"마산": {"lat": 35.2, "lng": 128.5}}}
        self.assertIn("x=128.5", mkt_collect.place_xy("마산", cfg)[0])
        self.assertIn("x=128.1", mkt_collect.place_xy("창원", cfg)[0])

    def test_place_lists_from_different_coordinates_are_not_compared(self):
        with Sandbox() as sb:
            sb.write("2026-01-01", place={k: [place_row("100", 1)] for k in KEYWORDS})
            sb.write("2026-01-08", place={k: [place_row("100", 2)] for k in KEYWORDS})
            for date, x in (("2026-01-01", 128.1), ("2026-01-08", 128.5)):
                f = sb.measure / date / "place_list.json"
                data = json.loads(f.read_text(encoding="utf-8"))
                data["k1"]["xy"] = {"lat": 35.2, "lng": x}
                f.write_text(json.dumps(data), encoding="utf-8")
            cmp = mkt_report.compare(sb.load("2026-01-08"), sb.load("2026-01-01"), mkt_common.load_entities()["_list"], SCORING)
            self.assertEqual(cmp["counts"]["place"], (3, 4))

    def test_map_result_is_scored_as_its_own_channel(self):
        with Sandbox() as sb:
            (sb.config / "scoring.json").write_text(json.dumps(self.CURVE), encoding="utf-8")
            gm = {"cls": "gmap", "key": "our.example", "href": "", "text": "웹사이트", "pos": 1}
            sb.write("2026-01-01", google={k: [gm, web("ga.example", 1)] for k in KEYWORDS})
            m = sb.load("2026-01-01")
            self.assertEqual(m["per"]["우리"]["gmap"], 100.0)
            self.assertEqual(m["per"]["우리"]["google"], 0.0)
            self.assertEqual(m["ranks"]["k1"]["ranks"]["우리"]["gmap"], 1)

    def test_uncertainty_and_delta_band(self):
        with Sandbox() as sb:
            (sb.config / "scoring.json").write_text(json.dumps(self.CURVE), encoding="utf-8")
            sb.write("2026-01-01", naver={"k1": [web("our.example", 1)], "k2": [web("ga.example", 1)],
                                          "k3": [web("our.example", 2)], "k4": [web("ga.example", 1)]})
            sb.write("2026-01-08", naver=full_naver())
            ents = mkt_common.load_entities()["_list"]
            cur, prev = sb.load("2026-01-08"), sb.load("2026-01-01")
            unc = mkt_report.uncertainty(prev, ents, self.CURVE, "우리")
            self.assertLess(unc["index"][0], unc["index"][1])
            band = mkt_report.compare(cur, prev, ents, self.CURVE)["band"]["우리"]
            self.assertGreater(band[1], 0)
            self.assertEqual(mkt_report.judge(1.0, (0.5, 2.0)), "상승(범위 밖)")
            self.assertIn("판단 불가", mkt_report.judge(0.2, (-1.0, 1.5)))

    def test_same_day_repeat_measures_noise(self):
        with Sandbox() as sb:
            d = sb.write("2026-01-01", naver={k: [web("our.example", 1), web("ga.example", 2)] for k in KEYWORDS})
            (d / "naver_serp_rep.json").write_text(json.dumps({
                "k1": {"status": "ok", "items": [web("ga.example", 1), web("our.example", 3)]},
                "k2": {"status": "ok", "items": [web("our.example", 1), web("ga.example", 2)]}}), encoding="utf-8")
            ents = mkt_common.load_entities()["_list"]
            m = sb.load("2026-01-01")
            n = mkt_report.repeat_noise(d, m, ents, mkt_common.read_keywords(), SCORING, {})
            self.assertEqual(n["n"], 2)
            self.assertEqual(n["ch"]["naver"]["mean"], 0.8)  # 우리 1→3, 가나 2→1, 나머지 그대로: (2+1+0+0)/4
            self.assertEqual(n["ch"]["naver"]["agree"], 100)

    def test_area_index_uses_only_that_area(self):
        with Sandbox() as sb:
            (sb.config / "keywords.csv").write_text(
                "keyword,area,region,priority,volume\nk1,형사,창원,1,\nk2,형사,창원,1,\nk3,민사,마산,1,\nk4,민사,마산,1,\n",
                encoding="utf-8")
            sb.write("2026-01-01", naver={"k1": [web("our.example", 1)], "k2": [web("our.example", 1)],
                                          "k3": [web("ga.example", 1)], "k4": [web("ga.example", 1)]})
            ents = mkt_common.load_entities()["_list"]
            g = {(x["kind"], x["group"]): x for x in mkt_report.group_indices(sb.load("2026-01-01"), ents, SCORING, "우리", [])}
            self.assertGreater(g[("분야", "형사")]["index"], 50)  # 통합검색 플레이스 영역(0점)도 같이 환산된다
            self.assertEqual(g[("분야", "민사")]["index"], 0.0)
            self.assertEqual(g[("분야", "형사")]["kws"], 2)
            self.assertEqual(g[("지역", "마산")]["top"], "가나")

    def test_report_has_new_sections(self):
        with Sandbox() as sb:
            (sb.config / "scoring.json").write_text(json.dumps(self.CURVE), encoding="utf-8")
            sb.write("2026-01-01", naver=full_naver(), place={k: [place_row("200", 1, "가나법무법인 k1"), place_row("100", 2)] for k in KEYWORDS})
            sb.write("2026-01-08", naver=full_naver(), place={k: [place_row("100", 1), place_row("200", 2)] for k in KEYWORDS})
            sb.run_report("--date", "2026-01-08")
            text = sb.txt("2026-01-08")
            for head in ("3. 채널별 세부 지표", "4. 분야·지역별", "5. 측정 신뢰도", "오차 범위", "직전 대비 판정", "13. 다음 과제 후보"):
                self.assertIn(head, text)
            doc = sb.docx_text("2026-01-08")
            self.assertIn("5. 측정 신뢰도", doc)


if __name__ == "__main__":
    unittest.main()
