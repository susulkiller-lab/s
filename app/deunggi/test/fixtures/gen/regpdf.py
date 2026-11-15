"""Minimal PDF writer + layout engine that imitates the 인터넷등기소 등기사항전부증명서 layout.

Why not reportlab for the text PDFs: reportlab embeds TrueType fonts as simple fonts split
into 256-glyph subsets, so Hangul lines get chopped into many pdf.js text items at subset
boundaries. Here the font is embedded once as a Type0 / CIDFontType2 (Identity-H) subset
with a ToUnicode CMap, and every cell line is a single Tj, so pdf.js returns one text item
per cell line.

Drawing conventions (documented in ../README.md):
  * grid lines: black strokes,   "q 0.5 w 0 0 0 RG x1 y1 m x2 y2 l ... S Q"
  * strike lines: red strokes,   "q 0.6 w 1 0 0 RG x1 y m x2 y l S x1 y m x2 y l S ... Q"
    one horizontal segment per rendered text line of a struck cell line, at
    baseline + 0.33 * fontsize, spanning the text width +-0.5pt.
"""
import io
import random
import string
import zlib

from fontTools.ttLib import TTFont
from fontTools import subset as ftsubset

FONT_PATH = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
FONT_NUM = 0
FONT_NAME = 'WenQuanYiZenHei'

PAGE_W, PAGE_H = 595.28, 841.89
ML = 30.0
TW = PAGE_W - 2 * ML          # table width 535.28
TOP_FIRST = 766.0             # table top on page 1
TOP_OTHER = 798.0             # table top on page 2+
BOTTOM = 46.0                 # lowest y a table may reach
FS = 9.0                      # body font size
LEAD = 12.5
PAD_T, PAD_B, PAD_X = 3.5, 3.0, 3.0
GRID_W = 0.5
STRIKE_W = 0.6
STRIKE_RGB = (1, 0, 0)


# --------------------------------------------------------------------------- font metrics
class Metrics:
    def __init__(self):
        self.tt = TTFont(FONT_PATH, fontNumber=FONT_NUM, lazy=True)
        self.upem = self.tt['head'].unitsPerEm
        self.cmap = self.tt.getBestCmap()
        self.hmtx = self.tt['hmtx']
        self._w = {}

    def cw(self, ch):
        w = self._w.get(ch)
        if w is None:
            g = self.cmap.get(ord(ch))
            if g is None:
                raise ValueError('glyph missing for %r' % ch)
            w = round(self.hmtx[g][0] * 1000.0 / self.upem)
            self._w[ch] = w
        return w

    def sw(self, s, size):
        return sum(self.cw(c) for c in s) * size / 1000.0


M = Metrics()


def wrap(text, maxw, size=FS):
    """Greedy wrap preferring spaces, falling back to character breaks (as the registry does
    for long tokens such as case numbers)."""
    if text == '':
        return ['']
    lines, cur = [], ''
    for word in text.split(' '):
        cand = word if cur == '' else cur + ' ' + word
        if M.sw(cand, size) <= maxw:
            cur = cand
            continue
        if cur:
            lines.append(cur)
            cur = ''
        while M.sw(word, size) > maxw:
            i = len(word)
            while i > 1 and M.sw(word[:i], size) > maxw:
                i -= 1
            lines.append(word[:i])
            word = word[i:]
        cur = word
    lines.append(cur)
    return lines


# --------------------------------------------------------------------------- PDF objects
class PDF:
    def __init__(self):
        self.objs = []

    def alloc(self):
        self.objs.append(None)
        return len(self.objs)

    def put(self, n, body):
        self.objs[n - 1] = body.encode('latin-1') if isinstance(body, str) else body

    def add(self, body):
        n = self.alloc()
        self.put(n, body)
        return n

    def add_stream(self, d, data, compress=True, n=None):
        if compress:
            data = zlib.compress(data, 9)
            d += ' /Filter /FlateDecode'
        body = ('<< %s /Length %d >>\nstream\n' % (d, len(data))).encode('latin-1') + data + b'\nendstream'
        if n is None:
            return self.add(body)
        self.put(n, body)
        return n

    def save(self, path, root, info):
        out = io.BytesIO()
        out.write(b'%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
        offs = []
        for i, body in enumerate(self.objs, 1):
            offs.append(out.tell())
            out.write(b'%d 0 obj\n' % i + body + b'\nendobj\n')
        x = out.tell()
        out.write(b'xref\n0 %d\n0000000000 65535 f \n' % (len(self.objs) + 1))
        for o in offs:
            out.write(b'%010d 00000 n \n' % o)
        out.write(b'trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF\n'
                  % (len(self.objs) + 1, root, info, x))
        with open(path, 'wb') as f:
            f.write(out.getvalue())


def pdf_text_string(s):
    """UTF-16BE hex string for /Info values."""
    return '<FEFF' + s.encode('utf-16-be').hex().upper() + '>'


def embed_font(pdf, chars, seed):
    """Subset the font to `chars`, embed as Type0/Identity-H. Returns (font obj num, char->gid)."""
    opts = ftsubset.Options()
    opts.layout_features = []
    opts.hinting = False
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.name_IDs = [0, 1, 2, 3, 4, 5, 6]
    opts.drop_tables += ['BDF ', 'FFTM', 'GDEF', 'GPOS', 'GSUB', 'vhea', 'vmtx', 'gasp']
    font = TTFont(FONT_PATH, fontNumber=FONT_NUM)
    sub = ftsubset.Subsetter(opts)
    sub.populate(unicodes=sorted(ord(c) for c in chars))
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    ttf = buf.getvalue()
    cmap = font.getBestCmap()
    gid = {c: font.getGlyphID(cmap[ord(c)]) for c in chars}
    upem = font['head'].unitsPerEm
    hmtx = font['hmtx']
    rnd = random.Random(seed)
    tag = ''.join(rnd.choice(string.ascii_uppercase) for _ in range(6))
    base = '%s+%s' % (tag, FONT_NAME)

    # widths, grouped as [gid [w ...]] runs
    by_gid = sorted((g, round(hmtx[font.getGlyphName(g)][0] * 1000.0 / upem)) for g in set(gid.values()))
    parts, run_start, run = [], None, []
    for g, w in by_gid:
        if run and g == run_start + len(run):
            run.append(w)
        else:
            if run:
                parts.append('%d [%s]' % (run_start, ' '.join(map(str, run))))
            run_start, run = g, [w]
    if run:
        parts.append('%d [%s]' % (run_start, ' '.join(map(str, run))))

    s = 1000.0 / upem
    head = font['head']
    hhea = font['hhea']
    ff = pdf.add_stream('/Length1 %d' % len(ttf), ttf)
    fd = pdf.add('<< /Type /FontDescriptor /FontName /%s /Flags 4 /FontBBox [%d %d %d %d] /ItalicAngle 0 '
                 '/Ascent %d /Descent %d /CapHeight 700 /StemV 80 /FontFile2 %d 0 R >>'
                 % (base, head.xMin * s, head.yMin * s, head.xMax * s, head.yMax * s,
                    hhea.ascent * s, hhea.descent * s, ff))
    cid = pdf.add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s '
                  '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
                  '/FontDescriptor %d 0 R /DW 1000 /W [%s] /CIDToGIDMap /Identity >>'
                  % (base, fd, ' '.join(parts)))
    # ToUnicode
    pairs = sorted((g, c) for c, g in gid.items())
    cm = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
          '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
          '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
          '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange']
    for i in range(0, len(pairs), 100):
        chunk = pairs[i:i + 100]
        cm.append('%d beginbfchar' % len(chunk))
        for g, c in chunk:
            cm.append('<%04X> <%s>' % (g, c.encode('utf-16-be').hex().upper()))
        cm.append('endbfchar')
    cm += ['endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end']
    tu = pdf.add_stream('', '\n'.join(cm).encode('ascii'))
    t0 = pdf.add('<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H '
                 '/DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>' % (base, cid, tu))
    return t0, gid


# --------------------------------------------------------------------------- document layout
def fmt(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


class Doc:
    """Collects drawing ops per page. Op kinds:
       ('text', x, y, size, s)
       ('grid', [(x1, y1, x2, y2), ...])
       ('strike', [(x1, y, x2), ...])
    """

    def __init__(self, meta):
        self.meta = meta
        self.body_pages = []
        self.summary_pages = []
        self.pages = self.body_pages
        self.page = None
        self.y = None
        self.split_log = []   # (section, rank, page_from, page_to)

    # ---- pages
    def new_page(self):
        self.page = []
        self.pages.append(self.page)
        first = (self.pages is self.body_pages and len(self.body_pages) == 1)
        self.y = TOP_FIRST if first else TOP_OTHER
        return self.page

    def text(self, x, y, s, size=FS):
        if s:
            self.page.append(('text', x, y, size, s))

    def text_c(self, x0, w, y, s, size=FS):
        self.text(x0 + (w - M.sw(s, size)) / 2.0, y, s, size)

    def text_r(self, xr, y, s, size=FS):
        self.text(xr - M.sw(s, size), y, s, size)

    def grid(self, segs):
        self.page.append(('grid', segs))

    def strike(self, segs):
        if segs:
            self.page.append(('strike', segs))

    # ---- table primitives
    def title_bar(self, title):
        h = 20.0
        top = self.y
        self.grid([(ML, top, ML + TW, top), (ML, top - h, ML + TW, top - h),
                   (ML, top, ML, top - h), (ML + TW, top, ML + TW, top - h)])
        self.text_c(ML, TW, top - 13.6, title, 10)
        self.y = top - h

    def header_row(self, cols):
        h = 18.0
        top = self.y
        xs = self._xs(cols)
        segs = [(ML, top, ML + TW, top), (ML, top - h, ML + TW, top - h)]
        segs += [(x, top, x, top - h) for x in xs]
        self.grid(segs)
        for (name, w, _a), x in zip(cols, xs):
            self.text_c(x, w, top - 12.0, name, FS)
        self.y = top - h

    @staticmethod
    def _xs(cols):
        xs, x = [], ML
        for c in cols:
            xs.append(x)
            x += c[1]
        xs.append(x)
        return xs

    def draw_row_part(self, cols, cells, start, n, partial_top):
        """Draw lines [start, start+n) of a row. cells: per column list of (text, struck)."""
        top = self.y
        h = PAD_T + n * LEAD + PAD_B
        xs = self._xs(cols)
        segs = [(ML if not partial_top else xs[1], top, ML + TW, top)]
        segs += [(x, top, x, top - h) for x in xs]
        self.grid(segs)
        strikes = []
        for ci, ((_name, w, align), x) in enumerate(zip(cols, xs)):
            for li in range(start, min(start + n, len(cells[ci]))):
                s, struck = cells[ci][li]
                if not s:
                    continue
                base = top - PAD_T - (li - start) * LEAD - LEAD * 0.78
                tw = M.sw(s, FS)
                tx = x + (w - tw) / 2.0 if align == 'c' else x + PAD_X
                self.text(tx, base, s)
                if struck:
                    strikes.append((tx - 0.5, base + FS * 0.33, tx + tw + 0.5))
        self.strike(strikes)
        self.y = top - h

    def close_segment(self):
        self.grid([(ML, self.y, ML + TW, self.y)])

    def section(self, title, cols, rows, section_key=None):
        """rows: list of dicts {cells: [[(text, struck), ...] per col], partial_top: bool, rank: str}"""
        min_need = 20 + 18 + PAD_T + 2 * LEAD + PAD_B
        if self.page is None or self.y - min_need < BOTTOM:
            self.new_page()
        self.title_bar(title)
        self.header_row(cols)
        for row in rows:
            cells = row['cells']
            nlines = max(len(c) for c in cells)
            start = 0
            partial = row.get('partial_top', False)
            while start < nlines:
                avail = self.y - BOTTOM - PAD_T - PAD_B
                fit = int(avail // LEAD)
                remaining = nlines - start
                if fit >= remaining:
                    self.draw_row_part(cols, cells, start, remaining, partial)
                    start = nlines
                    break
                if fit >= 2 and remaining >= 4:
                    # split the entry across the page break (continuation keeps column lines aligned)
                    self.draw_row_part(cols, cells, start, fit, partial)
                    page_from = len(self.pages)
                    start += fit
                    self.close_segment()
                    self.new_page()
                    self.title_bar(title)
                    self.header_row(cols)
                    self.split_log.append({'section': section_key or title, 'rank': row.get('rank'),
                                           'pages': [page_from, page_from + 1]})
                    partial = False
                    continue
                self.close_segment()
                self.new_page()
                self.title_bar(title)
                self.header_row(cols)
                partial = False
        self.close_segment()
        self.y -= 10

    def no_record_section(self, title, cols):
        min_need = 20 + 18 + 22
        if self.page is None or self.y - min_need < BOTTOM:
            self.new_page()
        self.title_bar(title)
        self.header_row(cols)
        top = self.y
        h = PAD_T + LEAD + PAD_B
        self.grid([(ML, top, ML, top - h), (ML + TW, top, ML + TW, top - h)])
        self.text_c(ML, TW, top - PAD_T - LEAD * 0.78, '기록사항 없음')
        self.y = top - h
        self.close_segment()
        self.y -= 10

    def end_block(self, office, notes):
        need = 18 + 18 + 14 * len(notes) + 8
        if self.y - need < BOTTOM - 10:
            self.new_page()
        self.y -= 6
        self.text_c(ML, TW, self.y - 9, '-- 이 하 여 백 --', 9)
        self.y -= 26
        self.text(ML, self.y, '관할등기소 ' + office, 9)
        for n in notes:
            self.y -= 14
            self.text(ML, self.y, n, 8)

    # ---- summary page
    def start_summary(self):
        self.pages = self.summary_pages
        self.new_page()
        self.y = 812.0

    def s_text(self, s, size=FS, x=ML, gap=None, center=False):
        g = gap if gap is not None else size + 5
        self.y -= g
        if self.y < BOTTOM:
            self.new_page()
            self.y = 800 - g
        if center:
            self.text_c(ML, TW, self.y, s, size)
        else:
            self.text(x, self.y, s, size)

    def notice_box(self, head, body):
        lines = []
        for para in body:
            lines += wrap(para, TW - 16, 8.5)
        h = 10 + 13 + 12 * len(lines) + 6
        top = self.y - 6
        self.grid([(ML, top, ML + TW, top), (ML, top - h, ML + TW, top - h),
                   (ML, top, ML, top - h), (ML + TW, top, ML + TW, top - h)])
        self.text_c(ML, TW, top - 16, head, 9)
        yy = top - 16
        for l in lines:
            yy -= 12
            self.text(ML + 8, yy, l, 8.5)
        self.y = top - h

    def simple_table(self, cols, rows):
        """Summary tables: rows = list of lists of cell strings (\n separated)."""
        self.y -= 4
        self.header_row(cols)
        for r in rows:
            cells = []
            for (name, w, a), s in zip(cols, r):
                cl = []
                for ln in (s.split('\n') if s else ['']):
                    cl += [(t, False) for t in wrap(ln, w - 2 * PAD_X)]
                cells.append(cl)
            n = max(len(c) for c in cells)
            if self.y - (PAD_T + n * LEAD + PAD_B) < BOTTOM:
                self.close_segment()
                self.new_page()
                self.y = 800
                self.header_row(cols)
            self.draw_row_part(cols, cells, 0, n, False)
        self.close_segment()

    # ---- serialization
    def finalize(self, path, info_title, seed):
        m = self.meta
        nb = len(self.body_pages)
        label = '[%s] %s' % (m['kind'], m['address'])
        # page headers / footers for body pages
        for i, pg in enumerate(self.body_pages, 1):
            hdr = []
            if i == 1:
                title = '등기사항전부증명서(말소사항 포함) - %s' % m['kind']
                hdr.append(('text', ML + (TW - M.sw(title, 15)) / 2.0, 806, 15, title))
                hdr.append(('text', ML, 779, 9.5, label))
                u = '고유번호 ' + m['unique_no']
                hdr.append(('text', ML + TW - M.sw(u, 9.5), 779, 9.5, u))
            else:
                hdr.append(('text', ML, 812, 8.5, label))
            foot = '열람일시 : ' + m['viewed_at']
            pn = '%d/%d' % (i, nb)
            hdr.append(('text', ML, 26, 8, foot))
            hdr.append(('text', ML + TW - M.sw(pn, 8), 26, 8, pn))
            pg[:0] = hdr
        pages = self.body_pages + self.summary_pages

        chars = set()
        for pg in pages:
            for op in pg:
                if op[0] == 'text':
                    chars.update(op[4])
        pdf = PDF()
        catalog = pdf.alloc()
        pages_n = pdf.alloc()
        font, gid = embed_font(pdf, chars, seed)
        kids = []
        for pg in pages:
            out = []
            for op in pg:
                if op[0] == 'text':
                    _, x, y, size, s = op
                    hexs = ''.join('%04X' % gid[c] for c in s)
                    out.append('BT /F1 %s Tf 1 0 0 1 %s %s Tm <%s> Tj ET' % (fmt(size), fmt(x), fmt(y), hexs))
                elif op[0] == 'grid':
                    segs = ' '.join('%s %s m %s %s l' % tuple(map(fmt, s)) for s in op[1])
                    out.append('q %s w 0 0 0 RG %s S Q' % (fmt(GRID_W), segs))
                elif op[0] == 'strike':
                    segs = ' '.join('%s %s m %s %s l S' % (fmt(a), fmt(y), fmt(b), fmt(y)) for a, y, b in op[1])
                    out.append('q %s w %s RG %s Q' % (fmt(STRIKE_W), ' '.join(map(fmt, STRIKE_RGB)), segs))
            content = pdf.add_stream('', ('\n'.join(out) + '\n').encode('latin-1'))
            kids.append(pdf.add('<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] '
                                '/Resources << /Font << /F1 %d 0 R >> /ProcSet [/PDF /Text] >> '
                                '/Contents %d 0 R >>' % (pages_n, fmt(PAGE_W), fmt(PAGE_H), font, content)))
        pdf.put(pages_n, '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join('%d 0 R' % k for k in kids), len(kids)))
        pdf.put(catalog, '<< /Type /Catalog /Pages %d 0 R >>' % pages_n)
        info = pdf.add('<< /Title %s /Producer (registry-fixture-gen) /Creator (registry-fixture-gen) '
                       '/CreationDate (D:20261110103015+09\'00\') >>' % pdf_text_string(info_title))
        pdf.save(path, catalog, info)
        return {'body_pages': nb, 'total_pages': len(pages)}
