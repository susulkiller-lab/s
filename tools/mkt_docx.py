"""마케팅 노출 리포트 DOCX 출력(mkt_report.py가 호출). 양식: 맑은 고딕, A4, 여백 2cm, 표 머리 음영.

필요: python-docx (`py -m pip install python-docx`). 없으면 mkt_report.py는 DOCX만 건너뛴다.
"""
import re

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Twips

FONT = "맑은 고딕"
NAVY = RGBColor(0x1F, 0x38, 0x64)
GRAY = RGBColor(0x59, 0x59, 0x59)
HEAD_FILL, US_FILL, BOX_FILL, LINE = "DCE3EE", "FFF2CC", "F2F5FA", "BFBFBF"
BODY = 8.5
WIDTH = 9638  # A4 폭 - 좌우 여백(트윕)
ENGINE = {"chatgpt": "ChatGPT", "gemini": "Gemini", "perplexity": "Perplexity", "claude": "Claude"}


def dot(s):
    """2026-10-23 → 2026. 10. 23."""
    return re.sub(r"(\d{4})-(\d{2})-(\d{2})", lambda m: f"{m.group(1)}. {int(m.group(2))}. {int(m.group(3))}.", s)


def run(par, text, size=BODY, bold=False, color=None):
    r = par.add_run(text)
    r.font.name = FONT
    r._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    r.font.size = Pt(size)
    r.font.bold = bold
    if color is not None:
        r.font.color.rgb = color
    return r


def para(doc, text="", size=BODY, bold=False, color=None, align=None, before=0, after=60, style=None):
    p = doc.add_paragraph(style=style)
    if text:
        run(p, text, size, bold, color)
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Pt(before / 20), Pt(after / 20)
    if align:
        p.alignment = align
    return p


def heading(doc, text):
    p = doc.add_paragraph(style="Heading 1")
    run(p, text, 12, True, NAVY)
    pf = p.paragraph_format
    pf.space_before, pf.space_after = Twips(320), Twips(120)
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:color", "1F3864"), ("w:sz", "8"), ("w:space", "2")):
        b.set(qn(k), v)
    bdr.append(b)
    p._p.get_or_add_pPr().append(bdr)


def note(doc, text):
    return para(doc, text, color=GRAY, after=80)


def subhead(doc, text):
    return para(doc, text, 10, True, before=160, after=80)


def bullet(doc, text, level=0):
    return para(doc, text, style="List Bullet 2" if level else "List Bullet", after=40)


def _cell_props(cell, width, fill=None, margin=(50, 80)):
    tcPr = cell._tc.get_or_add_tcPr()
    w = OxmlElement("w:tcW")
    w.set(qn("w:type"), "dxa")
    w.set(qn("w:w"), str(width))
    tcPr.append(w)
    borders = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        e = OxmlElement(f"w:{side}")
        for k, v in (("w:val", "single"), ("w:color", LINE), ("w:sz", "4")):
            e.set(qn(k), v)
        borders.append(e)
    tcPr.append(borders)
    if fill:
        shd = OxmlElement("w:shd")
        for k, v in (("w:fill", fill), ("w:color", "auto"), ("w:val", "clear")):
            shd.set(qn(k), v)
        tcPr.append(shd)
    mar = OxmlElement("w:tcMar")
    for side, v in (("top", margin[0]), ("left", margin[1]), ("bottom", margin[0]), ("right", margin[1])):
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:type"), "dxa")
        e.set(qn("w:w"), str(v))
        mar.append(e)
    tcPr.append(mar)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    for p in cell.paragraphs:
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.0


def _table(doc, ncols, widths):
    t = doc.add_table(rows=0, cols=ncols)
    t.autofit = False
    tblPr = t._tbl.tblPr
    tw = OxmlElement("w:tblW")
    tw.set(qn("w:type"), "dxa")
    tw.set(qn("w:w"), str(sum(widths)))
    tblPr.append(tw)
    grid = t._tbl.tblGrid
    for i, gc in enumerate(grid.findall(qn("w:gridCol"))):
        gc.set(qn("w:w"), str(widths[i]))
    return t


def table(doc, headers, rows, widths, align=None, highlight=()):
    """headers: 열 제목, rows: 문자열 목록의 목록, widths: 트윕(합계 WIDTH), align: 열별 'l'/'c', highlight: 강조 행 번호."""
    align = align or ["c"] * len(headers)
    t = _table(doc, len(headers), widths)
    hdr = t.add_row()
    tr = hdr._tr.get_or_add_trPr()
    tr.append(OxmlElement("w:tblHeader"))
    for i, h in enumerate(headers):
        c = hdr.cells[i]
        _cell_props(c, widths[i], HEAD_FILL)
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(c.paragraphs[0], h, bold=True)
    for ri, row in enumerate(rows):
        r = t.add_row()
        hl = ri in highlight
        for i, val in enumerate(row):
            c = r.cells[i]
            _cell_props(c, widths[i], US_FILL if hl else None)
            c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.LEFT if align[i] == "l" else WD_ALIGN_PARAGRAPH.CENTER
            run(c.paragraphs[0], str(val), bold=hl)
    para(doc, after=0)
    return t


def boxes(doc, items):
    """결론 요약 칸: (제목, 큰 숫자, 설명)."""
    w = [WIDTH // len(items)] * len(items)
    w[0] += WIDTH - sum(w)
    t = _table(doc, len(items), w)
    r = t.add_row()
    for i, (label, big, sub) in enumerate(items):
        c = r.cells[i]
        _cell_props(c, w[i], BOX_FILL, (120, 120))
        c.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(c.paragraphs[0], label, color=GRAY)
        p2 = c.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_before = p2.paragraph_format.space_after = Twips(40)
        run(p2, big, 16, True, NAVY)
        p3 = c.add_paragraph()
        p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run(p3, sub, color=GRAY)
    para(doc, after=0)


def footer(section):
    p = section.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(p, "- ", 8, color=RGBColor(0x80, 0x80, 0x80))
    r = run(p, "", 8, color=RGBColor(0x80, 0x80, 0x80))
    for kind, text in (("begin", None), (None, "PAGE"), ("end", None)):
        if kind:
            f = OxmlElement("w:fldChar")
            f.set(qn("w:fldCharType"), kind)
            r._r.append(f)
        else:
            it = OxmlElement("w:instrText")
            it.set(qn("xml:space"), "preserve")
            it.text = text
            r._r.append(it)
    run(p, " -", 8, color=RGBColor(0x80, 0x80, 0x80))


def build(R, path):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Twips(11906), Twips(16838)
    for side in ("top_margin", "bottom_margin", "left_margin", "right_margin"):
        setattr(sec, side, Twips(1134))
    st = doc.styles["Normal"]
    st.font.name = FONT
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    st.font.size = Pt(BODY)
    st.paragraph_format.space_before = st.paragraph_format.space_after = Pt(0)
    st.paragraph_format.line_spacing = 1.15
    footer(sec)

    para(doc, "진앤솔법률사무소 마케팅 노출 리포트", 17, True, NAVY, WD_ALIGN_PARAGRAPH.CENTER, after=40)
    para(doc, f"측정일 {dot(R['date'])}", 10, color=GRAY, align=WD_ALIGN_PARAGRAPH.CENTER, after=200)
    meta = [("비교 기준", dot(R["prev"]) + " 측정" if R["prev"] else "직전 측정 없음(이번이 기준선)"),
            ("수집 현황", R["collect"])]
    if R["compare"]:
        meta.append(("변동 비교 범위", f"두 회차 공통/이번 회차: {R['compare']}"))
    meta.append(("측정 조건", R["conditions"]))
    if R["missing_channels"]:
        meta.append(("미측정 채널", f"{', '.join(R['missing_channels'])} (종합지수는 측정된 채널 가중치로만 환산)"))
    meta.extend(("주의", w) for w in R["warnings"])
    table(doc, ["항목", "내용"], meta, [1800, WIDTH - 1800], ["c", "l"])

    # 1. 결론
    heading(doc, "1. 결론")
    S = R["summary"]
    items = [("종합 노출지수", S["index"] + S["index_delta"], f"비교군 {S['n']}곳 중 {S['pos_text']}")]
    if S.get("share") is not None:
        items.append(("노출 점유율", f"{S['share']}%", "비교군 지수 합 대비"))
    if S.get("lead"):
        items.append(("1위 대비 격차" if S["lead_is_first"] else "2위와의 차이", str(S["gap"]),
                      f"{'1위' if S['lead_is_first'] else '2위'} {S['lead']} {S['lead_index']}"))
    boxes(doc, items)
    if S.get("unc"):
        bullet(doc, f"오차 범위(측정 키워드·답변을 다시 뽑아 계산한 90% 범위): {S['unc']}")
    if S.get("verdict"):
        bullet(doc, f"직전 대비 판정: {S['verdict']}, 변동 범위 {S['band']}")
    if R.get("channel_rank"):
        subhead(doc, "채널별 우리 위치")
        for n, (pos, cnt, mine, top, ties) in R["channel_rank"].items():
            rank = f"공동 {pos}위({ties}곳)" if ties > 1 else f"{pos}위"
            bullet(doc, f"{n}: {cnt}곳 중 {rank}, 우리 {mine} / 1위 {top}")

    # 2. 채널별 점수
    heading(doc, "2. 채널별 점수")
    note(doc, "점수 범위 0~100. 진앤솔 행은 음영 표시. " + R.get("curve_note", "") + "."
         + (" 괄호는 직전 대비로, 두 회차 모두 측정된 같은 키워드·답변으로 다시 계산한 값입니다." if R["has_delta"] else ""))
    names = R["channel_names"]
    w0 = 1838
    table(doc, ["업체"] + names + ["종합"],
          [[k + ("*" if us else "")] + vals + [idx] for k, us, vals, idx in R["channels"]],
          [w0] + [(WIDTH - w0) // (len(names) + 1)] * len(names) + [WIDTH - w0 - (WIDTH - w0) // (len(names) + 1) * len(names)],
          ["l"] + ["c"] * (len(names) + 1), {i for i, r in enumerate(R["channels"]) if r[1]})

    subhead(doc, "업체별 노출 키워드 수")
    table(doc, ["업체", "파워링크 노출 키워드 수", "구글 지도 결과 노출 키워드 수"],
          [[k, "-" if a is None else a, "-" if g is None else g] for k, _, a, g in R["counts"]],
          [3212, 3213, 3213], ["l", "c", "c"], {i for i, r in enumerate(R["counts"]) if r[1]})
    if R["advertisers"]:
        subhead(doc, "파워링크 광고주(노출 키워드 수)")
        table(doc, ["광고주 도메인", "노출 키워드 수"], [[d, n] for d, n in R["advertisers"]], [6425, 3213], ["l", "c"])

    if R["ai_table"]:
        subhead(doc, "AI 검색 엔진별 언급")
        en = R["ai_engines"]
        shown = [r for r in R["ai_table"] if r[1] or sum(r[2])]
        hidden = len(R["ai_table"]) - len(shown)
        note(doc, "엔진별 칸은 언급된 답변 수 / 전체 답변 수. 95% 범위는 답변 수가 적어 생기는 언급률의 오차 범위(윌슨 방식). "
             "출처 인용은 답변 안에 그 업체 홈페이지·블로그 주소가 나온 건수."
             + (f" 언급이 없는 {hidden}곳은 생략." if hidden else ""))
        we = (WIDTH - 1638 - 1000 - 1500 - 1000) // len(en)
        widths = [1638] + [we] * len(en) + [1000, 1500, WIDTH - 1638 - we * len(en) - 2500]
        table(doc, ["업체"] + [ENGINE.get(x, x) for x in en] + ["언급률", "95% 범위", "출처 인용"],
              [[k] + [f"{c} / {R['ai_total'][x]}" for c, x in zip(cnt, en)] + [rate, ci, cites] for k, _, cnt, rate, cites, ci in shown],
              widths, ["l"] + ["c"] * (len(en) + 3), {i for i, r in enumerate(shown) if r[1]})
        if R["ai_us"]:
            subhead(doc, "진앤솔이 언급된 AI 답변")
            table(doc, ["엔진", "질문", "언급 순서"],
                  [[ENGINE.get(e, e), q, f"등록 업체 중 {pos}번째 / 등록 업체 {n}곳 언급"] for e, q, pos, n in R["ai_us"]],
                  [1400, 5838, 2400], ["c", "l", "c"])

    # 3. 세부 지표
    heading(doc, "3. 채널별 세부 지표")
    note(doc, "키워드 수 기준. 우리와 그 채널 점수 1위 업체를 나란히 둡니다. 평균 순위는 노출된 키워드만의 평균.")
    if R.get("detail"):
        rows, hl = [], set()
        for chn, dm, lead, dl in R["detail"]:
            hl.add(len(rows))
            rows.append([chn, R.get("us", "진앤솔"), dm["n"], dm["top3"], dm["top10"], dm["shown"], "-" if dm["avg"] is None else f"{dm['avg']}위"])
            if dl:
                rows.append(["", lead, dl["n"], dl["top3"], dl["top10"], dl["shown"], "-" if dl["avg"] is None else f"{dl['avg']}위"])
        table(doc, ["채널", "업체", "측정", "상위 3위", "상위 10위", "노출", "평균 순위"], rows,
              [1638, 1600, 1000, 1300, 1300, 1300, 1500], ["l", "l", "c", "c", "c", "c", "c"], hl)
    if R.get("detail_ai"):
        n, k, rate, ci, first, cites = R["detail_ai"]
        bullet(doc, f"AI 검색: 답변 {n}건 중 우리 언급 {k}건({rate}, 95% 범위 {ci}), 등록 업체 중 첫 번째 언급 {first}건, 출처 인용 {cites}건")

    # 4. 분야·지역별
    heading(doc, "4. 분야·지역별 종합지수")
    note(doc, "그 분야·지역 키워드만으로 다시 계산. 분야에는 같은 분야 AI 질문을 포함. 키워드 3개 미만 그룹은 크게 흔들립니다.")
    if R.get("groups"):
        table(doc, ["구분", "그룹", "키워드", "AI 답변", "우리 지수", "우리 순위", "1위 업체"],
              [[g["kind"], g["group"], g["kws"], g["ai"] or "-", g["index"], f"{g['n']}곳 중 {g['pos_text']}",
                f"{g['top']} {g['top_index']}"] for g in R["groups"]],
              [900, 1100, 900, 1000, 1200, 2200, WIDTH - 7300], ["c", "c", "c", "c", "c", "c", "l"])

    # 5. 측정 신뢰도
    heading(doc, "5. 측정 신뢰도")
    note(doc, "이 범위 안의 차이는 실제 변화가 아니라 측정 흔들림일 수 있습니다.")
    for r_line in R.get("reliability", []):
        bullet(doc, r_line)

    # 6. 약점 목록
    heading(doc, "6. 약점 목록")
    note(doc, '경쟁사가 우리보다 위에 있는 키워드, 가중치 × 점수 차 순. 지표는 "1위 업체 / 우리" 순서로 표기. '
              "업체명 키워드는 키워드의 지역·분야 단어(예: 창원 형사변호사 → 창원, 형사) 중 업체명에 든 개수.")
    if R["gaps"]:
        table(doc, ["채널", "키워드", "우리 순위", "1위 업체", "방문자리뷰", "블로그리뷰", "사진", "업체명 키워드", "톡톡·쿠폰"], R["gaps"],
              [950, 1500, 800, 1300, 1000, 1100, 800, 1000, WIDTH - 8450])
    else:
        bullet(doc, "해당 없음")

    # 7. 순위 변동
    heading(doc, "7. 우리 순위 변동")
    note(doc, "직전 대비, " + R.get("moves_note", "3계단 이상 또는 노출·미노출 전환"))
    for m in R["moves"]:
        bullet(doc, m)

    # 8. 운영 점검
    heading(doc, "8. 운영 점검")
    note(doc, "우리 측 감점 항목, 관측된 것만")
    for fl in R["flags"] or ["관측된 감점 항목 없음"]:
        bullet(doc, dot(fl))
        if fl.startswith("발행 글 누락"):
            for d, t in R["lost"]:
                bullet(doc, f'{dot(d)} 발행 "{t}"', 1)
    if R["place_ranks"]:
        subhead(doc, "우리 플레이스 순위(전체 업체 수 대비)")
        pr = R["place_ranks"]
        half = (len(pr) + 1) // 2
        rows = [list(pr[i]) + (list(pr[i + half]) if i + half < len(pr) else ["", "", "", ""]) for i in range(half)]
        table(doc, ["키워드", "순위", "전체", "상위"] * 2, rows, [1919, 900, 1000, 1000, 1919, 900, 1000, 1000],
              ["l", "c", "c", "c", "l", "c", "c", "c"])

    # 9. 상관
    heading(doc, "9. 플레이스 순위와 공개지표의 상관")
    note(doc, "키워드마다 따로 계산한 스피어만 상관계수의 평균(업체 8곳 이상인 키워드). -1에 가까울수록 지표가 클수록 상위. "
              "거리는 가까울수록 큰 값이 되도록 뒤집었습니다.")
    table(doc, ["지표", "상관계수", "표본"], [list(x) for x in R.get("corr", [])], [3212, 3213, 3213])
    note(doc, "상관관계이며 인과가 아닙니다. 업체명 키워드는 관측 요인일 뿐이며, '전문' 등 표시는 광고 규정 검토가 먼저입니다.")

    # 10. 최근성
    heading(doc, "10. 네이버 콘텐츠 최근성")
    F = R.get("fresh") or {}
    note(doc, f"상위 10위 안 글의 게시 시점. 최근 = {F.get('days', 30)}일 이내.")
    if F.get("known"):
        bullet(doc, f"게시 시점이 보이는 상위 글 {F['known']}건 중 최근 글 {F['fresh']}건({round(F['fresh'] / F['known'] * 100)}%)")
    if F.get("act"):
        table(doc, ["업체", "상위 10위 안 글", "그중 최근 글"], [[k, n, f] for k, n, f in F["act"]], [3212, 3213, 3213],
              ["l", "c", "c"], {i for i, r in enumerate(F["act"]) if r[0] == R.get("us")})

    # 11. 비교군 후보
    heading(doc, "11. 비교군 후보")
    note(doc, "우리·등록 업체·네트워크펌 제외, 상위 노출 가중 점수 순")
    if R["candidates"]:
        table(doc, ["업체명", "플레이스 ID", "점수"], [[n, pid, s] for n, pid, s in R["candidates"]],
              [6038, 2000, 1600], ["l", "c", "c"])
    else:
        bullet(doc, "후보 없음")
    if R["blog_candidates"]:
        subhead(doc, "상위 노출 블로그 중 등록 업체와 연결되지 않은 주인")
        note(doc, "비교군이면 marketing/config/entities.json의 blog_ids에 넣습니다.")
        table(doc, ["블로그 아이디", "블로그 이름", "점수"], [[o, n or "-", s] for o, n, s in R["blog_candidates"]],
              [3000, 5038, 1600], ["l", "l", "c"])

    # 12. 상담
    heading(doc, "12. 상담·수임 실적")
    note(doc, "상담 수치는 저장소에 올라가지 않도록 이 문서에 넣지 않습니다.")
    for c in R["consults"]:
        bullet(doc, dot(c))

    # 13. 과제
    heading(doc, "13. 다음 과제 후보")
    note(doc, "위 관측 결과에서 기계적으로 도출, 최종 선택은 사무장님")
    for head, items in R["todo"]:
        bullet(doc, head)
        if items:
            bullet(doc, ", ".join(items), 1)

    doc.save(path)
