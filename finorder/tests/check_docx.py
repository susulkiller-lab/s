"""DOCX 실물 검증. 사용: python3 tests/check_docx.py <파일.docx> [--full]

가상 입력(홍길동, 김영희, 2026드단12345)으로 만든 문서를 열어 다음을 본다.
 - word/document.xml이 유효한 XML인지
 - 문단별 문자열이 SPEC 2장 문안과 일치하는지(여기에 사람이 SPEC에서 옮겨 적은 기대값을 둔다)
 - 날짜, 소송대리인, 사무소·변호사 이름, 법원 귀중이 없는지
 - 서체(바탕체 4속성), 12pt, 줄간격 200%, A4와 여백, 들여쓰기, 정렬, 밑줄 위치
"""
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# SPEC 2장에서 옮겨 적은 기대 문단(탭은 \t). 밑줄 표기 대괄호는 원본 PDF에 맞춰 뺀다.
EXPECT = [
    "금융거래정보 제출명령 신청서",
    "사    건\t2026드단12345 이혼 등",
    "원    고\t홍길동",
    "피    고\t김영희",
    "위 사건에 관하여 피고 김영희의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다.",
    "다      음",
    "1. 대상기관의 명칭 및 주소",
    "가. 주식회사 국민은행",
    "(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)",
    "나. 주식회사 카카오뱅크",
    "(13529) 경기도 성남시 분당구 분당내곡로 131, 11층 (백현동, 판교테크원)",
    "2. 명의인의 인적사항",
    "홍길동 (900101-2345678)",
    "3. 요구대상 거래기간",
    "2023. 9. 1.부터 2026. 9. 1.까지",
    "4. 사용목적",
    "원고 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.",
    "5. 요구하는 거래정보 등의 내용",
    "가.\t귀 은행에 홍길동 (900101-2345678)을 명의자로 하는 계좌(예금, 적금, 보험, 연금, 신탁, 펀드, 외환거래, 대출 등 일체의 상품)가 개설되어 있는지(해지계좌 포함)",
    "나.\t(있다면)",
    "1)\t전 계좌목록, 계좌번호 전체, 상품명, 개설일 및 해지일",
    "2)\t각 상품의 요구대상거래기간의 거래내역(송금 상대방, 상대방 계좌번호 및 은행 등 일체의 정보)을 회신하여 주시기 바랍니다(복수인 경우 각 계좌 모두).",
    "3)\t위 각 항목은 PDF와 함께 XLSX 또는 CSV 형식의 전산자료로 제출하여 주시고, 거래코드의 설명과 통화·금액단위를 표시하여 주시기 바랍니다.",
]
FORBIDDEN = ["법원", "귀중", "변호사", "법률사무소", "소송대리인\n", "담당자", "2026. 9.\n"]

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


def main():
    path = sys.argv[1]
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
    check(len(texts) == len(EXPECT), "문단 수 %d != 기대 %d" % (len(texts), len(EXPECT)))
    for i, (got, exp) in enumerate(zip(texts, EXPECT)):
        check(got == exp, "문단 %d 불일치\n  기대: %r\n  실제: %r" % (i, exp, got))
    full = "\n".join(texts) + "\n"
    for w in FORBIDDEN:
        check(w not in full.replace("소송대리인은", ""), "금지 문구 발견: %r" % w)
    check(not re.search(r"\*\*|</?[a-z]+>", full), "마크다운 강조 또는 HTML 태그 문자열 발견")

    # 서체·크기: 모든 run에 바탕체 4속성, 12pt(제목 18pt)
    for i, p in enumerate(paras):
        for r in p.findall(W + "r"):
            rpr = r.find(W + "rPr")
            f = rpr.find(W + "rFonts")
            for a in ("ascii", "eastAsia", "hAnsi", "cs"):
                check(f is not None and f.get(W + a) == "바탕체", "문단 %d run 서체 %s 불일치" % (i, a))
            sz = rpr.find(W + "sz").get(W + "val")
            check(sz == ("36" if i == 0 else "24"), "문단 %d 글자 크기 %s" % (i, sz))
    # 문서 기본값
    dd = styles.find(W + "docDefaults")
    f = dd.find(W + "rPrDefault/" + W + "rPr/" + W + "rFonts")
    check(f is not None and f.get(W + "eastAsia") == "바탕체", "docDefaults 서체")
    check(dd.find(W + "rPrDefault/" + W + "rPr/" + W + "sz").get(W + "val") == "24", "docDefaults 12pt")
    sp = dd.find(W + "pPrDefault/" + W + "pPr/" + W + "spacing")
    check(sp.get(W + "line") == "480" and sp.get(W + "lineRule") == "auto", "docDefaults 줄간격 200%")

    # 문단 속성
    def ppr(i):
        return paras[i].find(W + "pPr")

    for i, p in enumerate(paras):
        s = ppr(i).find(W + "spacing")
        check(s is not None and s.get(W + "line") == "480" and s.get(W + "lineRule") == "auto", "문단 %d 줄간격" % i)
        # 빈 문단 없음
        check(texts[i].strip() != "", "문단 %d 빈 문단" % i)

    def jc(i):
        j = ppr(i).find(W + "jc")
        return j.get(W + "val") if j is not None else None

    def ind(i):
        e = ppr(i).find(W + "ind")
        return {} if e is None else {k.replace(W, ""): v for k, v in e.attrib.items()}

    def bold(i):
        return all(r.find(W + "rPr/" + W + "b") is not None for r in paras[i].findall(W + "r") if (r.find(W + "t") is not None))

    check(jc(0) == "center" and bold(0), "제목: 가운데 굵게")
    for i in (1, 2, 3):
        t = ppr(i).find(W + "tabs/" + W + "tab")
        check(t is not None and t.get(W + "pos") == "1600", "문단 %d 탭 위치" % i)
        check(ind(i) == {"left": "1600", "hanging": "1600"}, "문단 %d 내어쓰기 %r" % (i, ind(i)))
    check(jc(4) == "both" and ind(4).get("firstLine") == "240", "도입 문단: 양쪽 정렬+첫 줄 240")
    check(jc(5) == "center" and bold(5), "다 음: 가운데 굵게")
    for i in (6, 11, 13, 15, 17):
        check(bold(i), "소제목 %d 굵게" % i)
    for i in (18, 19):
        check(ind(i) == {"left": "440", "hanging": "440"}, "5.가/나 들여쓰기 %r" % ind(i))
        check(jc(i) == "both", "5.가/나 양쪽 정렬")
    for i in (20, 21, 22):
        check(ind(i) == {"left": "880", "hanging": "440"}, "5.의 1)~3) 들여쓰기 %r" % ind(i))
        check(jc(i) == "both", "1)~3) 양쪽 정렬")
    for i in (7, 8, 9, 10, 12, 14, 16):
        check(jc(i) in (None, "left"), "문단 %d 는 양쪽 정렬이 아니어야 함" % i)

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

    # 밑줄은 2)의 한 run만
    ul = []
    for i, p in enumerate(paras):
        for r in p.findall(W + "r"):
            if r.find(W + "rPr/" + W + "u") is not None:
                ul.append((i, r.find(W + "t").text))
    check(ul == [(21, "요구대상거래기간의 거래내역")], "밑줄 구간 %r" % ul)

    # 용지·여백
    sect = body.find(W + "sectPr")
    pg = sect.find(W + "pgSz")
    check(pg.get(W + "w") == "11906" and pg.get(W + "h") == "16838", "A4 크기")
    m = sect.find(W + "pgMar")
    got = {k: m.get(W + k) for k in ("top", "bottom", "left", "right")}
    check(got == {"top": "1701", "bottom": "1417", "left": "1701", "right": "1701"}, "여백 %r" % got)

    if errors:
        print("DOCX 검증 실패 %d건" % len(errors))
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("DOCX 검증 통과: 문단 %d개, XML 유효, 문안·서식·밑줄·용지·여백 일치" % len(paras))


if __name__ == "__main__":
    main()
