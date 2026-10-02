"""DOCX 실물 검증. 사용: python3 tests/check_docx.py <파일.docx> [--form bank|insurance]

가상 입력(홍길동, 김영희, 2026드단12345)으로 만든 문서를 열어 다음을 본다.
 - word/document.xml 등이 유효한 XML인지, 속성 요소가 스키마 순서인지
 - 문단별 문자열이 SPEC 문안과 일치하는지. 5.는 SPEC.md의 코드 블록을 직접 읽어 대조한다
   (은행·금융기관용은 2장, 보험사용은 2-2장. {이름} {번호} {기준일}은 가상 값으로 치환)
 - 날짜, 소송대리인, 사무소·변호사 이름, 법원 귀중이 없는지
 - 서체(바탕체 4속성), 12pt, 줄간격 200%, A4와 여백, 들여쓰기, 정렬, 밑줄 위치
"""
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "SPEC.md")

HOLDER = ("홍길동", "900101-2345678")
INSURANCE_DATE = "2026. 3. 20."

# 1.~4.(은행용·보험사용 공통). 기관 줄은 docx.test.js의 가상 입력과 맞춘다. 우편번호는 쓰지 않는다.
BANK_INSTS = [
    ("주식회사 국민은행", "서울특별시 영등포구 국제금융로8길 26 (여의도동)"),
    ("주식회사 카카오뱅크", "경기도 성남시 분당구 분당내곡로 131, 11층 (백현동, 판교테크원)"),
]
INS_INSTS = [
    ("가상생명보험 주식회사", "서울특별시 서초구 가상로 7 (서초동)"),
    ("가상화재해상보험 주식회사", "서울특별시 영등포구 가상대로 50"),
]
LETTERS = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허"
FORBIDDEN = ["법원", "귀중", "변호사", "법률사무소", "담당자"]

PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"]
RPR_ORDER = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"]


def para_text(p):
    out = []
    for r in p.findall(W + "r"):
        for c in r:
            if c.tag == W + "t":
                out.append(c.text or "")
            elif c.tag == W + "tab":
                out.append("\t")
    return "".join(out)


def spec_section5(form):
    """SPEC 코드 블록에서 5. 아래 줄을 읽어 (종류, 문단 문자열) 목록으로 만든다."""
    spec = open(SPEC, encoding="utf-8").read()
    if form == "insurance":
        block = spec.split("### 2-2. 보험사용 신청서")[1].split("```")[1]
    else:
        block = spec.split("## 2. 출력 문서")[1].split("```")[1]
    lines = block.strip("\n").split("\n")
    start = [i for i, l in enumerate(lines) if l.startswith("5. 요구하는")][0]
    out = []
    for l in lines[start + 1:]:
        l = l.strip()
        l = l.replace("{이름}", HOLDER[0]).replace("{번호}", HOLDER[1]).replace("{주민등록번호}", HOLDER[1]).replace("{기준일}", INSURANCE_DATE)
        l = l.replace("[요구대상거래기간의 거래내역]", "요구대상거래기간의 거래내역")  # 밑줄 표기 대괄호는 문서에 넣지 않는다
        if form == "insurance":
            if l.startswith("귀 회사에"):
                out.append(("p5", l))
            elif l.startswith("(다만"):
                out.append(("l2c", l))
            elif re.match(r"^\d\) ", l):
                out.append(("l2", l[:2] + "\t" + l[3:]))
            else:
                out.append(("l3", l[:2] + "\t" + l[3:]))
        else:
            if re.match(r"^[가나]\. ", l):
                out.append(("l1", l[:2] + "\t" + l[3:]))
            else:
                out.append(("l2", l[:2] + "\t" + l[3:]))
    return out


def expected(form):
    insts = INS_INSTS if form == "insurance" else BANK_INSTS
    exp = [
        ("title", "금융거래정보 제출명령 신청서"),
        ("case", "사    건\t2026드단12345 이혼 등"),
        ("case", "원    고\t홍길동"),
        ("case", "피    고\t김영희"),
        ("intro", "위 사건에 관하여 피고 김영희의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다."),
        ("next", "다      음"),
        ("h", "1. 대상기관의 명칭 및 주소"),
    ]
    for i, (n, a) in enumerate(insts):
        exp.append(("inst", LETTERS[i] + ". " + n))
        exp.append(("inst", a))
    exp += [
        ("h", "2. 명의인의 인적사항"),
        ("holder", "홍길동 (900101-2345678)"),
        ("h", "3. 요구대상 거래기간"),
        ("p", "2023. 9. 1.부터 2026. 9. 1.까지"),
        ("h", "4. 사용목적"),
        ("p", "원고 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다."),
        ("h", "5. 요구하는 거래정보 등의 내용"),
    ]
    return exp + spec_section5(form)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    form = "bank"
    if "--form" in sys.argv:
        form = sys.argv[sys.argv.index("--form") + 1]
        args = [a for a in args if a != form]
    path = args[0]
    errors = []

    def check(cond, msg):
        if not cond:
            errors.append(msg)

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        check("word/document.xml" in names, "document.xml 없음")
        for n in names:
            if n.endswith(".xml") or n.endswith(".rels"):
                try:
                    ET.fromstring(z.read(n))
                except ET.ParseError as e:
                    errors.append("XML 오류 %s: %s" % (n, e))
        doc = ET.fromstring(z.read("word/document.xml"))
        styles = ET.fromstring(z.read("word/styles.xml"))

    body = doc.find(W + "body")
    paras = body.findall(W + "p")
    texts = [para_text(p) for p in paras]
    exp = expected(form)
    check(len(texts) == len(exp), "문단 수 %d != 기대 %d" % (len(texts), len(exp)))
    for i, (got, (kind, want)) in enumerate(zip(texts, exp)):
        check(got == want, "문단 %d(%s) 불일치\n  기대: %r\n  실제: %r" % (i, kind, want, got))
    full = "\n".join(texts) + "\n"
    for w in FORBIDDEN:
        check(w not in full, "금지 문구 발견: %r" % w)
    check("소송대리인은" in full and full.count("소송대리인") == 1, "'소송대리인'은 도입 문장에만 있어야 함")
    check(not re.search(r"\*\*|</?[a-z]+>", full), "마크다운 강조 또는 HTML 태그 문자열 발견")
    check(not re.search(r"\(\d{5}\)", full), "우편번호 표기 (12345) 가 문서에 남아 있음")
    check("이혼 등" in full, "사건명")
    if form == "insurance":
        check("귀 은행" not in full and "귀 기관" not in full and "명의자로" not in full, "보험사용에 은행용 문안이 섞임")
        check("국민은행" not in full and "카카오뱅크" not in full, "보험사용 1.에 은행 기관이 들어감")
        want_n = open(SPEC, encoding="utf-8").read().split("### 2-2. 보험사용 신청서")[1].split("```")[1].count("{기준일}")
        check(want_n == 5 and full.count(INSURANCE_DATE) == want_n, "기준일 개수 %d (SPEC %d)" % (full.count(INSURANCE_DATE), want_n))
        check("「" not in full, "자리표시가 남아 있음")
    else:
        check("귀 은행에" in full and "귀 회사" not in full, "은행용 호칭")
        check("가상생명" not in full, "은행용 1.에 보험사가 들어감")

    # 서체·크기: 모든 run에 바탕체 4속성, 12pt(제목 18pt)
    for i, p in enumerate(paras):
        for r in p.findall(W + "r"):
            rpr = r.find(W + "rPr")
            f = rpr.find(W + "rFonts")
            for a in ("ascii", "eastAsia", "hAnsi", "cs"):
                check(f is not None and f.get(W + a) == "바탕체", "문단 %d run 서체 %s 불일치" % (i, a))
            sz = rpr.find(W + "sz").get(W + "val")
            check(sz == ("36" if i == 0 else "24"), "문단 %d 글자 크기 %s" % (i, sz))
    dd = styles.find(W + "docDefaults")
    f = dd.find(W + "rPrDefault/" + W + "rPr/" + W + "rFonts")
    check(f is not None and f.get(W + "eastAsia") == "바탕체", "docDefaults 서체")
    check(dd.find(W + "rPrDefault/" + W + "rPr/" + W + "sz").get(W + "val") == "24", "docDefaults 12pt")
    sp = dd.find(W + "pPrDefault/" + W + "pPr/" + W + "spacing")
    check(sp.get(W + "line") == "480" and sp.get(W + "lineRule") == "auto", "docDefaults 줄간격 200%")

    def ppr(i):
        return paras[i].find(W + "pPr")

    def jc(i):
        j = ppr(i).find(W + "jc")
        return j.get(W + "val") if j is not None else None

    def ind(i):
        e = ppr(i).find(W + "ind")
        return {} if e is None else {k.replace(W, ""): v for k, v in e.attrib.items()}

    def tabpos(i):
        t = ppr(i).find(W + "tabs/" + W + "tab")
        return None if t is None else t.get(W + "pos")

    def bold(i):
        return all(r.find(W + "rPr/" + W + "b") is not None for r in paras[i].findall(W + "r") if r.find(W + "t") is not None)

    for i, p in enumerate(paras):
        s = ppr(i).find(W + "spacing")
        check(s is not None and s.get(W + "line") == "480" and s.get(W + "lineRule") == "auto", "문단 %d 줄간격" % i)
        check(texts[i].strip() != "", "문단 %d 빈 문단" % i)

    # 종류별 문단 속성
    for i, (kind, _) in enumerate(exp):
        if kind == "title":
            check(jc(i) == "center" and bold(i), "제목: 가운데 굵게")
        elif kind == "case":
            check(tabpos(i) == "1600" and ind(i) == {"left": "1600", "hanging": "1600"}, "문단 %d 사건 줄 탭·내어쓰기 %r" % (i, ind(i)))
        elif kind == "intro":
            check(jc(i) == "both" and ind(i).get("firstLine") == "240", "도입 문단: 양쪽 정렬+첫 줄 240")
        elif kind == "next":
            check(jc(i) == "center" and bold(i), "다 음: 가운데 굵게")
        elif kind == "h":
            check(bold(i), "소제목 %d 굵게" % i)
        elif kind in ("inst", "holder", "p"):
            check(jc(i) in (None, "left"), "문단 %d(%s)는 양쪽 정렬이 아니어야 함" % (i, kind))
        elif kind == "p5":
            check(jc(i) == "both" and ind(i) == {}, "보험사용 5. 첫 문단: 양쪽 정렬, 왼쪽 끝 %r" % ind(i))
        elif kind == "l1":
            check(ind(i) == {"left": "440", "hanging": "440"} and jc(i) == "both", "문단 %d 5.가/나 들여쓰기 %r" % (i, ind(i)))
        elif kind == "l2":
            check(ind(i) == {"left": "880", "hanging": "440"} and jc(i) == "both" and tabpos(i) == "880", "문단 %d 1) 들여쓰기 %r" % (i, ind(i)))
        elif kind == "l2c":
            check(ind(i) == {"left": "880"} and jc(i) == "both" and tabpos(i) is None, "문단 %d (다만) 들여쓰기 %r" % (i, ind(i)))
        elif kind == "l3":
            check(ind(i) == {"left": "1320", "hanging": "440"} and jc(i) == "both" and tabpos(i) == "1320", "문단 %d 가.~사. 들여쓰기 %r" % (i, ind(i)))

    # 속성 요소가 스키마 순서인지(Word의 엄격한 검사 대비)
    def in_order(el, order, label):
        names = [c.tag.replace(W, "") for c in el]
        ranks = [order.index(n) if n in order else len(order) for n in names]
        check(ranks == sorted(ranks), "%s 요소 순서 위반: %r" % (label, names))

    for i, p in enumerate(paras):
        in_order(p.find(W + "pPr"), PPR_ORDER, "문단 %d pPr" % i)
        for r in p.findall(W + "r"):
            in_order(r.find(W + "rPr"), RPR_ORDER, "문단 %d rPr" % i)
        pp = p.find(W + "pPr")
        for name in ("autoSpaceDE", "autoSpaceDN"):
            e = pp.find(W + name)
            check(e is not None and e.get(W + "val") in ("0", "false"), "문단 %d %s 꺼짐" % (i, name))

    # 밑줄: 은행용은 2)의 한 run만, 보험사용은 없음
    ul = []
    for i, p in enumerate(paras):
        for r in p.findall(W + "r"):
            if r.find(W + "rPr/" + W + "u") is not None:
                ul.append((i, r.find(W + "t").text))
    if form == "insurance":
        check(ul == [], "보험사용에는 밑줄이 없어야 함 %r" % ul)
    else:
        want = [i for i, (k, t) in enumerate(exp) if k == "l2" and t.startswith("2)")]
        check(ul == [(want[0], "요구대상거래기간의 거래내역")], "밑줄 구간 %r" % ul)

    # Word는 keepNext·keepLines·pageBreakBefore가 걸린 줄 옆에 검은 네모(서식 표시)를 띄운다. 쓰지 않는다.
    for tag in ("keepNext", "keepLines", "pageBreakBefore", "numPr"):
        n = len(doc.findall(".//" + W + tag))
        check(n == 0, "문단 서식 %s가 %d곳에 있음(Word에 검은 네모 표시가 뜬다)" % (tag, n))

    sect = body.find(W + "sectPr")
    pg = sect.find(W + "pgSz")
    check(pg.get(W + "w") == "11906" and pg.get(W + "h") == "16838", "A4 크기")
    m = sect.find(W + "pgMar")
    got = {k: m.get(W + k) for k in ("top", "bottom", "left", "right")}
    check(got == {"top": "1701", "bottom": "1417", "left": "1701", "right": "1701"}, "여백 %r" % got)

    if errors:
        print("DOCX 검증 실패(%s) %d건" % (form, len(errors)))
        for e in errors:
            print(" -", e)
        sys.exit(1)
    label = "보험사용" if form == "insurance" else "은행·금융기관용"
    print("DOCX 검증 통과(%s): 문단 %d개, XML 유효, SPEC 문안·서식·밑줄·용지·여백 일치" % (label, len(paras)))


if __name__ == "__main__":
    main()
