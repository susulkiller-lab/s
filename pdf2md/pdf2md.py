"""PDF를 Markdown으로 바꾼다. 스캔 PDF(텍스트 층 없음)는 OCR로 읽는다.

  pdf2md.bat                 더블클릭 → 브라우저 화면에 PDF를 끌어놓는다
  pdf2md.bat 파일.pdf ...    PDF를 bat 아이콘에 끌어놓거나 인자로 주면 PDF 옆에 .md 저장
  python pdf2md.py --setup   가상환경 생성 + 패키지 설치 + OCR 모델 준비(최초 1회)
  python pdf2md.py --warmup  OCR 모델만 미리 내려받기

텍스트 층이 있는 쪽은 markitdown, 없는 쪽은 RapidOCR(한글 모델)로 읽는다.
모든 처리는 이 PC 안에서만 이뤄지고 문서는 외부로 전송되지 않는다.
(OCR 모델 파일만 최초 1회 인터넷에서 내려받는다.)
"""
import argparse
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from dataclasses import asdict, dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Queue
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
MIN_TEXT_CHARS = 20            # 쪽당 이 글자 수 미만이면 스캔 쪽으로 본다
OCR_DPI = 200
OCR_LANG = os.environ.get("PDF2MD_OCR_LANG", "korean")
LOW_CONF = 0.75                # 이 미만 줄은 '대조 권장'으로 센다
MAX_UPLOAD = 500 * 1024 * 1024
DEFAULT_PORT = 8765


class OcrUnavailable(RuntimeError):
    pass


def _missing_hint(name):
    return (f"'{name}' 패키지가 이 Python에 설치되어 있지 않습니다 (사용 중인 Python: {sys.executable}). "
            "pdf2md.bat로 실행하거나, 폴더의 .venv를 지우고 pdf2md.bat를 다시 실행하십시오.")


def print_env():
    """어느 Python으로 실행 중이고 필요한 패키지가 있는지 한 번 알려 준다(문제 확인용)."""
    from importlib.util import find_spec
    missing = [m for m in ("markitdown", "pypdfium2", "rapidocr") if find_spec(m) is None]
    print(f"Python: {sys.executable}")
    if missing:
        print(f"경고: 설치되지 않은 패키지 {', '.join(missing)}. pdf2md.bat로 실행하거나 .venv를 지우고 pdf2md.bat를 다시 실행하십시오.")


class _Encrypted(Exception):
    pass


@dataclass
class Result:
    status: str                # ok | scan_suspected | encrypted | error
    markdown: str = ""
    pages: int = 0
    scanned_pages: int = 0
    method: str = ""           # markitdown | ocr | mixed
    low_conf_lines: int = 0
    low_conf_pages: list = field(default_factory=list)
    seconds: float = 0.0
    message: str = ""


# ───────────────────────── 텍스트 층 판별 ─────────────────────────

def _open(path):
    import pypdfium2 as pdfium
    try:
        return pdfium.PdfDocument(str(path))
    except pdfium.PdfiumError as e:
        if "password" in str(e).lower():
            raise _Encrypted from e
        raise


def _page_text(page):
    tp = page.get_textpage()
    try:
        return tp.get_text_range()
    finally:
        tp.close()


def usable_text(text):
    """텍스트 층이 실제로 읽을 만한지. 글자 수 미달이나 깨진 글리프 과다면 False."""
    s = re.sub(r"\s", "", text or "")
    if len(s) < MIN_TEXT_CHARS:
        return False
    bad = sum(1 for ch in s if ch == "\ufffd" or "\ue000" <= ch <= "\uf8ff")
    bad += s.count("(cid:") * 6
    return bad / len(s) < 0.3


_MD = None


def _markitdown(path):
    global _MD
    if _MD is None:
        from markitdown import MarkItDown
        _MD = MarkItDown(enable_plugins=False)
    return _MD.convert(str(path)).text_content


# ───────────────────────── OCR ─────────────────────────

_ENGINE = None
_ENGINE_LOCK = threading.Lock()


def _engine():
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is not None:
            return _ENGINE
        try:
            from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR
        except ImportError as e:
            raise OcrUnavailable("OCR 패키지(rapidocr)가 설치되어 있지 않습니다. pdf2md.bat를 다시 실행하세요.") from e
        try:
            eng = RapidOCR(params={
                "Global.log_level": "warning",
                "Rec.lang_type": LangRec(OCR_LANG),
                "Rec.model_type": ModelType.MOBILE,
                "Rec.ocr_version": OCRVersion.PPOCRV5,
            })
            # 모델은 첫 사용 때 내려받으므로 여기서 미리 불러 실패를 한 번에, 분명한 메시지로 알린다.
            for name in ("_load_det_model", "_load_cls_model", "_load_rec_model"):
                load = getattr(eng, name, None)
                if load:
                    load()
        except Exception as e:
            raise OcrUnavailable(
                "OCR 모델을 불러오지 못했습니다. 최초 1회는 인터넷 연결이 필요합니다. "
                f"({type(e).__name__}: {str(e)[:160]})") from e
        _ENGINE = eng
        return eng


@dataclass
class Item:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    score: float = 1.0

    @property
    def h(self):
        return self.y1 - self.y0

    @property
    def yc(self):
        return (self.y0 + self.y1) / 2


_MARK = re.compile(
    r"^(\d{1,2}[.)]\s|[가나다라마바사아자차카타파하][.)]\s|\(\d{1,2}\)|\([가-하]\)|[①-⑳]|[○●■□▶▷◆◇ㆍ※]\s?|[-•]\s)")


def _median(vals):
    vals = sorted(vals)
    return vals[len(vals) // 2]


def _percentile(vals, q):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(len(vals) * q))]


@dataclass
class _Row:
    items: list

    @property
    def x0(self):
        return min(i.x0 for i in self.items)

    @property
    def x1(self):
        return max(i.x1 for i in self.items)

    @property
    def y0(self):
        return min(i.y0 for i in self.items)

    @property
    def y1(self):
        return max(i.y1 for i in self.items)

    @property
    def h(self):
        return _median([i.h for i in self.items])

    @property
    def yc(self):
        return sum(i.yc for i in self.items) / len(self.items)

    @property
    def text(self):
        its = sorted(self.items, key=lambda i: i.x0)
        out = its[0].text.strip()
        for a, b in zip(its, its[1:]):
            gap = b.x0 - a.x1
            out += ("  " if gap > 2.5 * self.h else " ") + b.text.strip()
        return out


def layout_to_markdown(items, page_w):
    """OCR 줄 상자들을 문단 단위 Markdown으로 묶는다. 휴리스틱이므로 표·다단 편집은 보장하지 않는다."""
    items = [i for i in items if i.text.strip()]
    if not items:
        return ""
    mh = _median([i.h for i in items])
    rows = []
    for it in sorted(items, key=lambda i: (i.yc, i.x0)):
        if rows and abs(it.yc - rows[-1].yc) < 0.5 * mh:
            rows[-1].items.append(it)
        else:
            rows.append(_Row([it]))
    left_ref = _percentile([r.x0 for r in rows], 0.2)
    right_ref = _percentile([r.x1 for r in rows], 0.8)

    paras, cur = [], []

    def flush():
        if cur:
            paras.append(" ".join(cur))
            cur.clear()

    prev = None
    for r in rows:
        text = r.text
        heading = (r.h > 1.35 * mh and len(text) < 40
                   and abs((r.x0 + r.x1) / 2 - page_w / 2) < 0.1 * page_w)
        if heading:
            flush()
            paras.append("## " + text)
            prev = None
            continue
        if prev is not None:
            brk = (
                r.y0 - prev.y1 > 0.8 * mh                                   # 큰 줄 간격
                or prev.x1 < right_ref - 2.5 * mh                           # 앞 줄이 짧게 끝남
                or bool(_MARK.match(text))                                  # 번호 항목 시작
                or (r.x0 > left_ref + 1.2 * mh and r.x0 > prev.x0 + 1.2 * mh
                    and not _MARK.match(prev.text))                         # 첫 줄 들여쓰기
            )
            if brk:
                flush()
        cur.append(text)
        prev = r
    flush()
    return "\n\n".join(paras)


def _ocr_page(eng, img):
    import numpy as np
    arr = np.asarray(img.convert("RGB"))[:, :, ::-1]      # RapidOCR은 BGR 입력
    r = eng(arr)
    if r is None or r.txts is None or r.boxes is None:
        return "", 0
    items, low = [], 0
    for box, txt, score in zip(r.boxes, r.txts, r.scores):
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append(Item(txt, min(xs), min(ys), max(xs), max(ys), float(score)))
        if score < LOW_CONF:
            low += 1
    return layout_to_markdown(items, img.width), low


# ───────────────────────── 변환 본체 ─────────────────────────

def convert(path, *, ocr=True, page_marks=True, progress=None):
    """PDF 한 건을 변환한다. progress(done, total, stage)는 쪽마다 호출된다."""
    t0 = time.time()
    path = Path(path)
    report = progress or (lambda *a: None)
    try:
        doc = _open(path)
    except _Encrypted:
        return Result("encrypted", message="암호가 걸린 PDF입니다. 암호를 해제한 뒤 다시 올려 주세요.")
    except ImportError as e:
        return Result("error", message=_missing_hint(getattr(e, "name", None) or "pypdfium2"))
    except Exception as e:
        return Result("error", message=f"PDF를 열 수 없습니다 (손상된 파일일 수 있습니다): {str(e)[:160]}")

    n = len(doc)
    if n == 0:
        return Result("error", message="쪽이 없는 PDF입니다.")
    report(0, n, "텍스트 층 확인")
    texts = [_page_text(doc[i]) for i in range(n)]
    scan = [not usable_text(t) for t in texts]
    n_scan = sum(scan)

    try:
        if n_scan == 0:
            note = ""
            try:
                md = _markitdown(path).strip()
            except ImportError as e:
                md = ""
                note = ("markitdown을 쓸 수 없어 기본 텍스트 추출로 변환했습니다. "
                        + _missing_hint(getattr(e, "name", None) or "markitdown"))
            if not md:
                md = "\n\n".join(re.sub(r"\r\n?", "\n", t).strip() for t in texts)
            report(n, n, "완료")
            return Result("ok", md, n, 0, "markitdown" if not note else "text", seconds=time.time() - t0, message=note)

        if not ocr:
            md = "\n\n".join(t.strip() for t, s in zip(texts, scan) if not s)
            return Result("scan_suspected", md, n, n_scan, "", seconds=time.time() - t0,
                          message=f"{n}쪽 중 {n_scan}쪽에 텍스트가 없습니다(스캔본). OCR을 켜고 다시 실행하세요.")

        eng = _engine()
        parts, low_total, low_pages = [], 0, []
        for i in range(n):
            report(i, n, f"{i + 1}쪽 " + ("OCR 중" if scan[i] else "텍스트 추출"))
            if scan[i]:
                img = doc[i].render(scale=OCR_DPI / 72).to_pil()
                body, low = _ocr_page(eng, img)
                if low:
                    low_total += low
                    low_pages.append(i + 1)
            else:
                body = texts[i].strip()
            parts.append((f"[{i + 1}쪽]\n\n" if page_marks else "") + body)
        report(n, n, "완료")
        msg = ""
        if low_total:
            msg = f"인식 신뢰도가 낮은 줄 {low_total}개({', '.join(map(str, low_pages))}쪽). 원본과 대조하세요."
        return Result("ok", "\n\n".join(parts), n, n_scan, "ocr" if n_scan == n else "mixed",
                      low_total, low_pages, time.time() - t0, msg)
    except OcrUnavailable as e:
        return Result("error", "", n, n_scan, "", seconds=time.time() - t0, message=str(e))
    except ImportError as e:
        return Result("error", "", n, n_scan, "", seconds=time.time() - t0,
                      message=_missing_hint(getattr(e, "name", None) or "필요한"))
    except Exception as e:
        return Result("error", "", n, n_scan, "", seconds=time.time() - t0,
                      message=f"변환 중 오류: {type(e).__name__}: {str(e)[:160]}")


# ───────────────────────── 브라우저 화면 ─────────────────────────

class Job:
    def __init__(self, name, path, ocr):
        self.id = secrets.token_urlsafe(9)
        self.name, self.path, self.ocr = name, path, ocr
        self.state, self.done, self.total, self.stage = "queued", 0, 0, "대기 중"
        self.result = None
        self.created = time.time()

    def progress(self, done, total, stage):
        self.done, self.total, self.stage = done, total, stage

    def view(self):
        return {"id": self.id, "name": self.name, "state": self.state, "done": self.done,
                "total": self.total, "stage": self.stage,
                "result": asdict(self.result) if self.result else None}


JOBS = {}
QUEUE = Queue()


def _worker():
    while True:
        job = QUEUE.get()
        job.state = "running"
        job.stage = "시작"
        try:
            job.result = convert(job.path, ocr=job.ocr, progress=job.progress)
        except Exception as e:      # convert가 예외를 삼키지만 방어
            job.result = Result("error", message=f"처리 중 오류: {e}")
        finally:
            shutil.rmtree(job.path.parent, ignore_errors=True)
        job.state = "done"


def _purge():
    cutoff = time.time() - 3600
    for k in [k for k, j in JOBS.items() if j.state == "done" and j.created < cutoff]:
        JOBS.pop(k, None)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):      # 파일명이 로그에 남지 않게 한다
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _guard(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]").lower()
        if host not in ("127.0.0.1", "localhost"):          # DNS 리바인딩 차단
            self._send(403, {"error": "forbidden"})
            return False
        return True

    def do_GET(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, (HERE / "ui.html").read_bytes(), "text/html; charset=utf-8")
        elif path == "/favicon.ico":
            self._send(204, b"", "image/x-icon")
        elif path.startswith("/api/jobs/"):
            job = JOBS.get(path.rsplit("/", 1)[1])
            if job:
                self._send(200, job.view())
            else:
                self._send(404, {"error": "not found"})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._guard():
            return
        u = urlparse(self.path)
        if u.path != "/api/convert" or self.headers.get("X-Pdf2md") != "1":
            self._send(403 if u.path == "/api/convert" else 404, {"error": "forbidden"})
            return
        q = parse_qs(u.query)
        name = Path(q.get("name", ["문서.pdf"])[0]).name or "문서.pdf"
        ocr = q.get("ocr", ["1"])[0] != "0"
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            self._send(400, {"error": "빈 파일입니다."})
            return
        if length > MAX_UPLOAD:
            self._send(413, {"error": "파일이 너무 큽니다(500MB 초과)."})
            return
        tmp = Path(tempfile.mkdtemp(prefix="pdf2md_"))
        dest = tmp / "in.pdf"
        remaining = length
        with dest.open("wb") as f:
            while remaining:
                chunk = self.rfile.read(min(1 << 20, remaining))
                if not chunk:
                    break
                f.write(chunk)
                remaining -= len(chunk)
        with dest.open("rb") as f:
            head = f.read(1024)
        if remaining or b"%PDF" not in head:
            shutil.rmtree(tmp, ignore_errors=True)
            self._send(400, {"error": "PDF 파일이 아니거나 전송이 끊겼습니다."})
            return
        _purge()
        job = Job(name, dest, ocr)
        JOBS[job.id] = job
        QUEUE.put(job)
        self._send(200, {"id": job.id})


def make_server(port=0):
    ports = [port] if port else [DEFAULT_PORT, 0]
    for p in ports:
        try:
            return ThreadingHTTPServer(("127.0.0.1", p), Handler)
        except OSError:
            continue
    raise OSError("사용 가능한 포트가 없습니다.")


def serve(port=0, open_browser=True):
    srv = make_server(port)
    threading.Thread(target=_worker, daemon=True).start()
    threading.Thread(target=lambda: _try(_engine), daemon=True).start()     # OCR 모델 미리 로드
    url = f"http://127.0.0.1:{srv.server_port}/"
    print_env()
    print(f"PDF → Markdown 화면: {url}")
    print("이 창을 닫으면 종료됩니다. 문서는 이 PC 밖으로 전송되지 않습니다.")
    if open_browser:
        webbrowser.open(url)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def _try(fn):
    try:
        fn()
    except Exception:
        pass


# ───────────────────────── 명령줄 ─────────────────────────

def _unique(p):
    if not p.exists():
        return p
    i = 1
    while True:
        q = p.with_name(f"{p.stem} ({i}){p.suffix}")
        if not q.exists():
            return q
        i += 1


def run_files(files, *, ocr=True, page_marks=True, out_dir=None):
    print_env()
    bad = 0
    for k, f in enumerate(files, 1):
        src = Path(f)
        print(f"[{k}/{len(files)}] {src.name}")

        def prog(done, total, stage):
            print(f"\r    {stage} ({done}/{total})".ljust(60), end="", flush=True)

        res = convert(src, ocr=ocr, page_marks=page_marks, progress=prog)
        print()
        if res.status == "ok":
            dest = _unique(Path(out_dir or src.parent) / (src.stem + ".md"))
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(res.markdown, encoding="utf-8")
            how = {"markitdown": "텍스트 PDF", "text": "텍스트 PDF(기본 추출)", "ocr": "OCR", "mixed": "텍스트+OCR"}.get(res.method, "")
            print(f"    저장: {dest}  ({res.pages}쪽, {how}, {res.seconds:.1f}초)")
            if res.message:
                print(f"    주의: {res.message}")
        else:
            bad += 1
            print(f"    실패({res.status}): {res.message}")
    return 1 if bad else 0


def setup():
    """가상환경을 만들고 패키지를 설치한 뒤 OCR 모델을 받는다. 표준 라이브러리만 쓴다."""
    venv = HERE / ".venv"
    py = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not py.exists():
        print("가상환경을 만드는 중...")
        subprocess.check_call([sys.executable, "-m", "venv", str(venv)])
    print("필요한 패키지를 설치하는 중... (수 분 걸릴 수 있습니다)")
    try:
        subprocess.check_call([str(py), "-m", "pip", "install", "--upgrade", "pip"])
        subprocess.check_call([str(py), "-m", "pip", "install", "-r", str(HERE / "requirements.txt")])
    except subprocess.CalledProcessError:
        print("패키지 설치에 실패했습니다. 인터넷 연결을 확인하고, 위쪽의 오류 문구를 알려 주십시오.")
        return 1
    if subprocess.call([str(py), str(HERE / "pdf2md.py"), "--warmup"]) != 0:
        print("OCR 모델은 지금 받지 못했습니다. 텍스트 PDF 변환은 바로 쓸 수 있고, "
              "스캔 PDF를 처음 읽을 때 다시 받습니다(인터넷 필요).")
    print("설치가 끝났습니다.")
    return 0


def warmup():
    print("OCR 모델을 준비하는 중... (최초 1회 인터넷 연결 필요)")
    try:
        _engine()
    except OcrUnavailable as e:
        print(f"실패: {e}")
        return 1
    print("OCR 모델 준비 완료.")
    return 0


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(errors="replace")
        except Exception:
            pass
    ap = argparse.ArgumentParser(description="PDF를 Markdown으로 변환(스캔 PDF는 OCR)")
    ap.add_argument("files", nargs="*", help="변환할 PDF (없으면 브라우저 화면 실행)")
    ap.add_argument("--setup", action="store_true", help="가상환경·패키지·OCR 모델 설치")
    ap.add_argument("--warmup", action="store_true", help="OCR 모델만 내려받기")
    ap.add_argument("--no-ocr", action="store_true", help="OCR을 쓰지 않음(스캔 쪽은 경고만)")
    ap.add_argument("--no-page-marks", action="store_true", help="OCR 결과에 [N쪽] 표시를 넣지 않음")
    ap.add_argument("--out", help="저장 폴더(기본: 각 PDF와 같은 폴더)")
    ap.add_argument("--port", type=int, default=0, help="화면 서버 포트(기본 8765, 사용 중이면 자동)")
    ap.add_argument("--no-browser", action="store_true", help="브라우저를 자동으로 열지 않음")
    a = ap.parse_args(argv)
    if a.setup:
        return setup()
    if a.warmup:
        return warmup()
    if a.files:
        return run_files(a.files, ocr=not a.no_ocr, page_marks=not a.no_page_marks, out_dir=a.out)
    serve(a.port, not a.no_browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
