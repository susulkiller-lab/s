"""pdf2md 시험. 실행: python -m unittest test_pdf2md -v  (reportlab, pillow, pypdf 필요)

OCR 엔진은 모델 내려받기가 필요해 가짜 엔진으로 대체한다. 따라서 이 시험은
쪽 분류·조립·화면 서버의 배관을 확인할 뿐, 한글 OCR 정확도는 확인하지 않는다.
"""
import http.client
import io
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

import pdf2md

KO_FONT = "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"


def make_text_pdf(path, lines):
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(str(path))
    c.setFont("Helvetica", 12)
    y = 780
    for ln in lines:
        c.drawString(60, y, ln)
        y -= 20
    c.save()


def make_scan_pdf(path, pages=1):
    from PIL import Image, ImageDraw
    imgs = []
    for p in range(pages):
        im = Image.new("RGB", (1240, 1754), "white")
        ImageDraw.Draw(im).rectangle((100, 100, 600, 160), fill="black")   # 글자 대신 이미지 덩어리
        imgs.append(im)
    imgs[0].save(path, save_all=True, append_images=imgs[1:], resolution=150)


class FakeEngine:
    """RapidOCR 출력 형식(boxes, txts, scores)만 흉내 낸다."""
    def __call__(self, arr):
        def box(x0, y0, x1, y1):
            return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
        return SimpleNamespace(
            boxes=np.array([box(100, 100, 1100, 140), box(100, 160, 700, 200)], dtype=float),
            txts=("첫째 줄이 이어지는 문장", "마지막 줄"),
            scores=(0.99, 0.5))


class Classify(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_text_pdf_goes_through_markitdown(self):
        p = self.tmp / "t.pdf"
        make_text_pdf(p, ["Plaintiff shall pay the defendant KRW 1,000,000 within thirty days."])
        r = pdf2md.convert(p)
        self.assertEqual((r.status, r.method, r.scanned_pages), ("ok", "markitdown", 0))
        self.assertIn("Plaintiff shall pay", r.markdown)

    @unittest.skipUnless(Path(KO_FONT).exists(), "한글 글꼴 없음")
    def test_korean_text_pdf(self):
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen import canvas
        pdfmetrics.registerFont(TTFont("K", KO_FONT, subfontIndex=0))
        p = self.tmp / "k.pdf"
        c = canvas.Canvas(str(p))
        c.setFont("K", 14)
        c.drawString(60, 780, "피고는 원고에게 금 1,000,000원을 지급하라. 소송비용은 피고가 부담한다.")
        c.save()
        r = pdf2md.convert(p)
        self.assertEqual(r.method, "markitdown")
        self.assertIn("금 1,000,000원을 지급하라", r.markdown)

    def test_scan_without_ocr_is_flagged_not_silent(self):
        p = self.tmp / "s.pdf"
        make_scan_pdf(p, pages=2)
        r = pdf2md.convert(p, ocr=False)
        self.assertEqual((r.status, r.pages, r.scanned_pages), ("scan_suspected", 2, 2))
        self.assertIn("스캔본", r.message)

    def test_scan_with_stub_engine(self):
        p = self.tmp / "s.pdf"
        make_scan_pdf(p, pages=2)
        orig = pdf2md._engine
        pdf2md._engine = lambda: FakeEngine()
        try:
            seen = []
            r = pdf2md.convert(p, progress=lambda d, t, s: seen.append((d, t)))
        finally:
            pdf2md._engine = orig
        self.assertEqual((r.status, r.method, r.scanned_pages), ("ok", "ocr", 2))
        self.assertIn("[1쪽]", r.markdown)
        self.assertIn("[2쪽]", r.markdown)
        self.assertIn("첫째 줄이 이어지는 문장 마지막 줄", r.markdown)    # 같은 문단으로 묶임
        self.assertEqual((r.low_conf_lines, r.low_conf_pages), (2, [1, 2]))
        self.assertEqual(seen[-1], (2, 2))

    def test_ocr_unavailable_reports_error(self):
        p = self.tmp / "s.pdf"
        make_scan_pdf(p)
        orig = pdf2md._engine

        def boom():
            raise pdf2md.OcrUnavailable("모델 없음")
        pdf2md._engine = boom
        try:
            r = pdf2md.convert(p)
        finally:
            pdf2md._engine = orig
        self.assertEqual((r.status, r.message), ("error", "모델 없음"))

    def test_encrypted(self):
        from pypdf import PdfReader, PdfWriter
        src = self.tmp / "t.pdf"
        make_text_pdf(src, ["secret"])
        w = PdfWriter()
        for pg in PdfReader(str(src)).pages:
            w.add_page(pg)
        w.encrypt("pw")
        enc = self.tmp / "e.pdf"
        with enc.open("wb") as f:
            w.write(f)
        self.assertEqual(pdf2md.convert(enc).status, "encrypted")

    def test_broken_file(self):
        p = self.tmp / "b.pdf"
        p.write_bytes(b"%PDF-1.4 not really a pdf")
        self.assertEqual(pdf2md.convert(p).status, "error")

    def _without_module(self, name):
        import sys
        old = sys.modules.get(name, "absent")
        sys.modules[name] = None          # import가 ModuleNotFoundError를 내게 한다
        return lambda: (sys.modules.pop(name, None) if old == "absent" else sys.modules.__setitem__(name, old))

    def test_missing_markitdown_falls_back_with_notice(self):
        p = self.tmp / "t.pdf"
        make_text_pdf(p, ["Plaintiff shall pay the defendant KRW 1,000,000 within thirty days."])
        restore = self._without_module("markitdown")
        pdf2md._MD = None
        try:
            r = pdf2md.convert(p)
        finally:
            restore()
        self.assertEqual((r.status, r.method), ("ok", "text"))
        self.assertIn("Plaintiff shall pay", r.markdown)
        self.assertIn("markitdown", r.message)
        self.assertIn("pdf2md.bat", r.message)

    def test_missing_pdfium_is_install_problem_not_corruption(self):
        p = self.tmp / "t.pdf"
        make_text_pdf(p, ["Plaintiff shall pay the defendant KRW 1,000,000 within thirty days."])
        restore = self._without_module("pypdfium2")
        try:
            r = pdf2md.convert(p)
        finally:
            restore()
        self.assertEqual(r.status, "error")
        self.assertIn("pypdfium2", r.message)
        self.assertNotIn("손상", r.message)

    def test_garbled_text_layer_counts_as_scan(self):
        self.assertFalse(pdf2md.usable_text("\ue001" * 40))
        self.assertFalse(pdf2md.usable_text("(cid:12)(cid:34)(cid:56)(cid:78)"))
        self.assertFalse(pdf2md.usable_text("짧음"))
        self.assertTrue(pdf2md.usable_text("원고는 피고에게 금전을 대여하였다." * 2))


def I(text, x0, y0, x1, y1):
    return pdf2md.Item(text, x0, y0, x1, y1)


class Layout(unittest.TestCase):
    W = 1654

    def test_wrapped_lines_join_and_short_line_ends_paragraph(self):
        items = [I("피고는 원고에게 금전을 대여하고", 180, 300, 1480, 340),
                 I("그 이자를 지급하기로 약정하였다.", 180, 350, 900, 390),
                 I("원고는 이에 따라 청구한다.", 180, 400, 800, 440)]
        md = pdf2md.layout_to_markdown(items, self.W)
        self.assertEqual(md, "피고는 원고에게 금전을 대여하고 그 이자를 지급하기로 약정하였다.\n\n원고는 이에 따라 청구한다.")

    def test_numbered_items_start_new_paragraphs(self):
        items = [I("1. 피고는 원고에게 금전을 지급하라.", 180, 300, 1480, 340),
                 I("2. 소송비용은 피고가 부담한다.", 180, 350, 1480, 390),
                 I("3. 제1항은 가집행할 수 있다.", 180, 400, 1480, 440)]
        self.assertEqual(pdf2md.layout_to_markdown(items, self.W).count("\n\n"), 2)

    def test_hanging_indent_continuation_stays_in_paragraph(self):
        items = [I("가. 원고는 2023. 3. 2. 피고에게 대여하였다", 180, 300, 1480, 340),
                 I("그리고 변제기를 정하였다.", 260, 350, 1480, 390),
                 I("나. 피고는 변제하지 않았다.", 180, 400, 900, 440)]
        md = pdf2md.layout_to_markdown(items, self.W)
        self.assertEqual(md.split("\n\n"), ["가. 원고는 2023. 3. 2. 피고에게 대여하였다 그리고 변제기를 정하였다.", "나. 피고는 변제하지 않았다."])

    def test_centered_large_line_becomes_heading(self):
        items = [I("서울중앙지방법원 판결", 500, 150, 1150, 215),
                 I("사건 설명 첫 줄이 길게 이어진다", 180, 300, 1480, 340),
                 I("둘째 줄", 180, 350, 700, 390),
                 I("셋째 줄도 있다", 180, 400, 1480, 440)]
        md = pdf2md.layout_to_markdown(items, self.W)
        self.assertTrue(md.startswith("## 서울중앙지방법원 판결\n\n"))

    def test_same_row_boxes_merge_with_wide_gap(self):
        items = [I("사 건", 180, 300, 300, 340), I("2024가합12345 대여금", 500, 302, 1000, 342)]
        self.assertEqual(pdf2md.layout_to_markdown(items, self.W), "사 건  2024가합12345 대여금")

    def test_empty(self):
        self.assertEqual(pdf2md.layout_to_markdown([], self.W), "")


class Setup(unittest.TestCase):
    """설치 흐름의 분기만 확인한다(pip와 venv 생성은 가짜로 대체)."""
    def setUp(self):
        import subprocess
        self.sp = subprocess
        self.tmp = Path(tempfile.mkdtemp())
        self.old_here, self.old_cc, self.old_call = pdf2md.HERE, subprocess.check_call, subprocess.call
        pdf2md.HERE = self.tmp
        (self.tmp / "requirements.txt").write_text("x\n")
        self.calls = []
        self.fail_pip = False

        def check_call(cmd, *a, **k):
            self.calls.append([str(c) for c in cmd])
            if self.fail_pip and "pip" in cmd:
                raise subprocess.CalledProcessError(1, cmd)
            return 0
        subprocess.check_call = check_call
        subprocess.call = lambda cmd, *a, **k: 0

    def tearDown(self):
        pdf2md.HERE = self.old_here
        self.sp.check_call, self.sp.call = self.old_cc, self.old_call

    def fake_venv(self, ver):
        py = self.tmp / ".venv" / "bin" / "python"
        py.parent.mkdir(parents=True)
        py.write_text(f"#!/bin/sh\necho {ver}\n")
        py.chmod(0o755)

    def run_setup(self):
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = pdf2md.setup()
        return rc, buf.getvalue()

    def test_venv_from_other_python_version_is_recreated(self):
        self.fake_venv("3 15")
        rc, out = self.run_setup()
        self.assertEqual(rc, 0)
        self.assertIn("새로 만듭니다", out)
        self.assertTrue(any(c[1:3] == ["-m", "venv"] for c in self.calls))

    def test_venv_from_same_python_version_is_kept(self):
        import sys
        self.fake_venv(f"{sys.version_info[0]} {sys.version_info[1]}")
        rc, out = self.run_setup()
        self.assertEqual(rc, 0)
        self.assertFalse(any(c[1:3] == ["-m", "venv"] for c in self.calls))

    def test_pip_failure_removes_half_built_venv_and_explains(self):
        self.fake_venv("3 15")
        self.fail_pip = True
        rc, out = self.run_setup()
        self.assertEqual(rc, 1)
        self.assertFalse((self.tmp / ".venv").exists())
        self.assertIn("Python 3.13", out)
        self.assertIn("onnxruntime", out)


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = pdf2md.make_server(port=0)
        cls.port = cls.srv.server_port
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        threading.Thread(target=pdf2md._worker, daemon=True).start()
        cls.tmp = Path(tempfile.mkdtemp())

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data

    def test_index_served(self):
        st, data = self.req("GET", "/")
        self.assertEqual(st, 200)
        self.assertIn("PDF → Markdown".encode(), data)

    def test_upload_and_poll(self):
        p = self.tmp / "t.pdf"
        make_text_pdf(p, ["Server round trip text for the upload test."])
        st, data = self.req("POST", "/api/convert?name=%EB%AC%B8%EC%84%9C.pdf&ocr=0", p.read_bytes(), {"X-Pdf2md": "1"})
        self.assertEqual(st, 200)
        jid = json.loads(data)["id"]
        for _ in range(100):
            st, data = self.req("GET", "/api/jobs/" + jid)
            j = json.loads(data)
            if j["state"] == "done":
                break
            time.sleep(0.1)
        self.assertEqual(j["name"], "문서.pdf")
        self.assertEqual(j["result"]["status"], "ok")
        self.assertIn("Server round trip text", j["result"]["markdown"])

    def test_rejects_post_without_header(self):
        st, _ = self.req("POST", "/api/convert?name=a.pdf", b"%PDF-1.4")
        self.assertEqual(st, 403)

    def test_rejects_foreign_host_header(self):
        st, _ = self.req("GET", "/", headers={"Host": "evil.example"})
        self.assertEqual(st, 403)

    def test_rejects_non_pdf(self):
        st, _ = self.req("POST", "/api/convert?name=a.pdf", b"hello world", {"X-Pdf2md": "1"})
        self.assertEqual(st, 400)

    def test_unknown_job(self):
        st, _ = self.req("GET", "/api/jobs/nope")
        self.assertEqual(st, 404)


if __name__ == "__main__":
    unittest.main()
