#!/usr/bin/env python3
"""Build fictional 등기사항전부증명서 test fixtures (PDF + ground-truth JSON).

Usage: python3 build.py            (writes into the parent directory: ../*.pdf, ../*.truth.json)
All names, addresses, numbers are fictional. Resident numbers are masked (YYMMDD-*******).
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import regpdf as R  # noqa: E402
from regpdf import wrap, PAD_X  # noqa: E402

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWED = '2026년11월10일 10시30분15초'
NOTES = ["* 실선으로 그어진 부분은 말소사항을 표시함. * 기록사항 없는 갑구, 을구는 '기록사항 없음'으로 표시함.",
         '* 본 등기사항증명서는 열람용이므로 출력하신 등기사항증명서는 법적인 효력이 없습니다.']

# ----------------------------------------------------------------------------- column sets
GAP_TITLE = '【 갑 구 】 ( 소유권에 관한 사항 )'
EUL_TITLE = '【 을 구 】 ( 소유권 이외의 권리에 관한 사항 )'
RIGHT_COLS = [('순위번호', 46, 'c'), ('등 기 목 적', 102, 'l'), ('접 수', 80, 'l'),
              ('등 기 원 인', 112, 'l'), ('권리자 및 기타사항', 195.28, 'l')]
DONG_TITLE = '【 표 제 부 】 ( 1동의 건물의 표시 )'
DONG_COLS = [('표시번호', 46, 'c'), ('접 수', 80, 'l'), ('소재지번,건물명칭 및 번호', 140, 'l'),
             ('건 물 내 역', 140, 'l'), ('등기원인 및 기타사항', 129.28, 'l')]
LANDRIGHT_TITLE = '( 대지권의 목적인 토지의 표시 )'
LANDRIGHT_COLS = [('표시번호', 46, 'c'), ('소 재 지 번', 220, 'l'), ('지 목', 50, 'c'),
                  ('면 적', 90, 'l'), ('등기원인 및 기타사항', 129.28, 'l')]
UNIT_TITLE = '【 표 제 부 】 ( 전유부분의 건물의 표시 )'
UNIT_COLS = [('표시번호', 46, 'c'), ('접 수', 80, 'l'), ('건 물 번 호', 140, 'l'),
             ('건 물 내 역', 140, 'l'), ('등기원인 및 기타사항', 129.28, 'l')]
DAEJI_TITLE = '( 대지권의 표시 )'
DAEJI_COLS = [('표시번호', 46, 'c'), ('대지권종류', 160, 'l'), ('대지권비율', 160, 'l'),
              ('등기원인 및 기타사항', 169.28, 'l')]
BLDG_TITLE = '【 표 제 부 】 ( 건물의 표시 )'
BLDG_COLS = [('표시번호', 46, 'c'), ('접 수', 80, 'l'), ('소재지번 및 건물번호', 140, 'l'),
             ('건 물 내 역', 140, 'l'), ('등기원인 및 기타사항', 129.28, 'l')]
LAND_TITLE = '【 표 제 부 】 ( 토지의 표시 )'
LAND_COLS = [('표시번호', 46, 'c'), ('접 수', 80, 'l'), ('소 재 지 번', 160, 'l'), ('지 목', 45, 'c'),
             ('면 적', 75, 'l'), ('등기원인 및 기타사항', 129.28, 'l')]

S1_COLS = [('등기명의인', 110, 'l'), ('(주민)등록번호', 88, 'l'), ('최종지분', 62, 'l'),
           ('주 소', 225.28, 'l'), ('순위번호', 50, 'c')]
S23_COLS = [('순위번호', 50, 'c'), ('등기목적', 92, 'l'), ('접수정보', 95, 'l'),
            ('주요등기사항', 208.28, 'l'), ('대상소유자', 90, 'l')]


# ----------------------------------------------------------------------------- helpers
DATE_RE = re.compile(r'^(\d{4})년(\d{1,2})월(\d{1,2})일')


def iso(d):
    m = DATE_RE.match(d or '')
    return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3))) if m else None


def E(rank, purpose, receipt, cause, holder, cancelled_by=None, struck=None, subs=None, rank_display=None):
    """One 갑구/을구 entry.
    receipt: (date, no) ; cause: 'YYYY년M월D일 원인...' or '' ; holder: list of logical lines
    struck: {holder_line_index: by_rank} partial strikes (변경 전 사항 말소 표시)
    subs: list of {'purpose':..., 'holder': [...]} extra sub-rows sharing the rank (e.g. 신탁)"""
    return dict(rank=rank, purpose=purpose, receipt=receipt, cause=cause, holder=holder,
                cancelled_by=cancelled_by, struck=struck or {}, subs=subs or [],
                rank_display=rank_display or [rank])


def T(no, cells, cancelled_by=None, no_display=None):
    """One 표제부 row. cells: list (per column after 표시번호) of logical-line lists."""
    return dict(no=no, cells=cells, cancelled_by=cancelled_by, no_display=no_display or [no])


def wrap_cell(lines, width, struck_flags=None):
    out = []
    for i, ln in enumerate(lines):
        st = struck_flags[i] if struck_flags else False
        out += [(t, st) for t in wrap(ln, width - 2 * PAD_X)]
    return out or [('', False)]


def right_rows(entries):
    cols = RIGHT_COLS
    rows = []
    for e in entries:
        c = e['cancelled_by'] is not None
        rank = [(r, c) for r in e['rank_display']]
        purpose = wrap_cell([e['purpose']], cols[1][1], [c])
        receipt = wrap_cell(list(e['receipt']) if e['receipt'] else [''], cols[2][1], [c, c])
        m = DATE_RE.match(e['cause'])
        if m:
            cl = [e['cause'][:m.end()], e['cause'][m.end():].strip()]
        else:
            cl = [e['cause']] if e['cause'] else ['']
        cause = wrap_cell([x for x in cl if x != ''] or [''], cols[3][1], [c] * 2)
        flags = [c or (i in e['struck']) for i in range(len(e['holder']))]
        holder = wrap_cell(e['holder'] or [''], cols[4][1], flags if e['holder'] else [c])
        rows.append({'cells': [rank, purpose, receipt, cause, holder], 'rank': e['rank']})
        for s in e['subs']:
            rows.append({'cells': [[('', False)], wrap_cell([s['purpose']], cols[1][1], [c]), [('', False)],
                                   [('', False)], wrap_cell(s['holder'], cols[4][1], [c] * len(s['holder']))],
                         'partial_top': True, 'rank': e['rank'] + '(sub)'})
    return rows


def title_rows(entries, cols):
    rows = []
    for t in entries:
        c = t['cancelled_by'] is not None
        cells = [[(x, c) for x in t['no_display']]]
        for (name, w, a), lines in zip(cols[1:], t['cells']):
            cells.append(wrap_cell(lines or [''], w, [c] * max(1, len(lines))))
        rows.append({'cells': cells, 'rank': t['no']})
    return rows


def truth_entry(section, e):
    d = {
        'section': section,
        'rank': e['rank'],
        'purpose': e['purpose'],
        'receipt_date': e['receipt'][0] if e['receipt'] else None,
        'receipt_date_iso': iso(e['receipt'][0]) if e['receipt'] else None,
        'receipt_no': e['receipt'][1] if e['receipt'] else None,
        'cause': e['cause'] or None,
        'holder_text': '\n'.join(e['holder']),
        'cancelled': e['cancelled_by'] is not None,
        'cancelled_by_rank': e['cancelled_by'],
    }
    if e['rank_display'] != [e['rank']]:
        d['rank_display'] = '\n'.join(e['rank_display'])
    if e['struck']:
        d['partially_struck_lines'] = [{'text': e['holder'][i], 'by_rank': r} for i, r in sorted(e['struck'].items())]
    if e['subs']:
        d['sub_rows'] = [{'purpose': s['purpose'], 'holder_text': '\n'.join(s['holder'])} for s in e['subs']]
    return d


def build(name, fx):
    meta = {'kind': fx['kind'], 'address': fx['address'], 'unique_no': fx['unique_no'], 'viewed_at': VIEWED}
    doc = R.Doc(meta)
    for sec in fx['title_sections']:
        doc.section(sec['title'], sec['cols'], title_rows(sec['rows'], sec['cols']), sec['key'])
    for key, title in (('갑구', GAP_TITLE), ('을구', EUL_TITLE)):
        ents = fx[key]
        if ents:
            doc.section(title, RIGHT_COLS, right_rows(ents), key)
        else:
            doc.no_record_section(title, RIGHT_COLS)
    doc.end_block(fx['office'], NOTES)

    # summary page
    doc.start_summary()
    doc.s_text('주요 등기사항 요약 (참고용)', 14, gap=14, center=True)
    doc.y -= 6
    doc.notice_box('[ 주 의 사 항 ]', [
        '본 주요 등기사항 요약은 증명서상에 말소되지 않은 사항을 간략히 요약한 것으로 증명서로서의 기능을 제공하지 않습니다. '
        '실제 권리사항 파악을 위해서는 발급된 증명서를 필수적으로 확인하시기 바랍니다.'])
    doc.s_text('[%s] %s' % (fx['kind'], fx['address']), 9.5, gap=20)
    doc.s_text('고유번호 ' + fx['unique_no'], 9.5, gap=14)
    sm = fx['summary']
    for label, cols, rows in (('1. 소유지분현황 ( 갑구 )', S1_COLS, sm['owners']),
                              ('2. 소유지분을 제외한 소유권에 관한 사항 ( 갑구 )', S23_COLS, sm['gap']),
                              ('3. (근)저당권 및 전세권 등 ( 을구 )', S23_COLS, sm['eul'])):
        doc.s_text(label, 9.5, gap=24)
        if rows:
            doc.simple_table(cols, rows)
        else:
            doc.s_text('- 기록사항 없음', 9, x=R.ML + 8, gap=16)
    doc.y -= 6
    doc.s_text('[ 참 고 사 항 ]', 8.5, gap=20)
    for ln in ['가. 등기기록에서 유효한 지분을 가진 소유자 혹은 공유자 현황을 가나다 순으로 표시합니다.',
               '나. 최종지분은 등기명의인이 가진 최종지분이며, 2개 이상의 순위번호에 지분을 가진 경우 그 지분을 합산하였습니다.',
               '다. 지분이 통분되어 공시된 경우는 전체의 지분을 통분하여 공시한 것입니다.',
               '라. 대상소유자가 명확하지 않은 경우 \'확인불가\'로 표시될 수 있습니다. 정확한 권리사항은 등기사항증명서를 확인하시기 바랍니다.']:
        for w in wrap(ln, R.TW - 10, 8):
            doc.s_text(w, 8, gap=12)

    pdf_path = os.path.join(OUT, name + '.pdf')
    info = doc.finalize(pdf_path, '등기사항전부증명서(말소사항 포함) - ' + fx['kind'], seed=name)

    truth = {
        'file': name + '.pdf',
        'fictional': True,
        'document_type': '등기사항전부증명서(말소사항 포함) - ' + fx['kind'],
        'property_kind': fx['kind'],
        'address': fx['address'],
        'address_line': '[%s] %s' % (fx['kind'], fx['address']),
        'unique_no': fx['unique_no'],
        'viewed_at': VIEWED,
        'registry_office': fx['office'],
        'has_text_layer': True,
        'pages': info,
        'title_sections': [
            {'key': s['key'], 'heading': s['title'], 'columns': [c[0] for c in s['cols']],
             'rows': [{'no': t['no'], **({'no_display': '\n'.join(t['no_display'])} if t['no_display'] != [t['no']] else {}),
                       'cells': ['\n'.join(x) for x in t['cells']],
                       'cancelled': t['cancelled_by'] is not None, 'cancelled_by': t['cancelled_by']}
                      for t in s['rows']]}
            for s in fx['title_sections']],
        'has_daejigwon': any(s['key'] == '대지권의 표시' for s in fx['title_sections']),
        'current_owners': fx['owners'],
        'entries': [truth_entry('갑구', e) for e in fx['갑구']] + [truth_entry('을구', e) for e in fx['을구']],
        'gap_empty': not fx['갑구'],
        'eul_empty': not fx['을구'],
        'summary_page': {
            'owners': [dict(zip(['등기명의인', '(주민)등록번호', '최종지분', '주소', '순위번호'], r)) for r in sm['owners']],
            'gap_non_ownership': [dict(zip(['순위번호', '등기목적', '접수정보', '주요등기사항', '대상소유자'], r)) for r in sm['gap']],
            'eul': [dict(zip(['순위번호', '등기목적', '접수정보', '주요등기사항', '대상소유자'], r)) for r in sm['eul']],
        },
        'entries_split_across_pages': doc.split_log,
        'expected_flags': fx['flags'],
        'notes': fx.get('notes', []),
    }
    if fx.get('cross'):
        truth['cross_document'] = fx['cross']
    with open(os.path.join(OUT, name + '.truth.json'), 'w', encoding='utf-8') as f:
        json.dump(truth, f, ensure_ascii=False, indent=2)
    print('%-16s body pages %d, total %d, split entries %s' % (name, info['body_pages'], info['total_pages'],
                                                                 [s['section'] + ' ' + str(s['rank']) for s in doc.split_log]))
    return truth


# ============================================================================ fixtures
APT_ADDR_HOME = '경기도 가상시 행복구 희망로 45, 101동 502호(미래동, 미래아파트)'
FLOORS = ['1층 512.34㎡'] + ['%d층 498.21㎡' % i for i in range(2, 16)] + \
         ['옥탑1층 38.40㎡(연면적제외)', '지하1층 1,203.45㎡(연면적제외)']
APT_BLDG = ['철근콘크리트구조', '(철근)콘크리트지붕 15층', '공동주택(아파트)'] + FLOORS
CHOI_ADDR = '인천광역시 가상구 바다로 9, 2동 803호(바다동, 바다맨션)'
MIRAE_ADDR = '서울특별시 가상구 소망로 77, 3동 1204호(소망동, 소망빌)'
BANK = ['근저당권자 주식회사가상은행 110111-0012345', '서울특별시 가상구 금융로 10(가상동)']

APT = dict(
    kind='집합건물',
    address='경기도 가상시 행복구 미래동 123 미래아파트 제101동 제5층 제502호',
    unique_no='1234-2011-005678',
    office='수원가상지방법원 가상등기소',
    title_sections=[
        dict(key='1동의 건물의 표시', title=DONG_TITLE, cols=DONG_COLS, rows=[
            T('1', [['2011년8월10일'], ['경기도 가상시 행복구 미래동 123', '미래아파트 제101동'], APT_BLDG,
                    ['도면편철장 제3책 제45장']], cancelled_by='2'),
            T('2', [[], ['경기도 가상시 행복구 미래동 123', '미래아파트 제101동', '[도로명주소]', '경기도 가상시 행복구 희망로 45'],
                    APT_BLDG, ['도로명주소', '2014년3월5일 등기']]),
        ]),
        dict(key='대지권의 목적인 토지의 표시', title=LANDRIGHT_TITLE, cols=LANDRIGHT_COLS, rows=[
            T('1', [['1. 경기도 가상시 행복구 미래동 123'], ['대'], ['15234.5㎡'], ['2011년8월10일 등기']]),
        ]),
        dict(key='전유부분의 건물의 표시', title=UNIT_TITLE, cols=UNIT_COLS, rows=[
            T('1', [['2011년8월10일'], ['제5층 제502호'], ['철근콘크리트구조', '84.9512㎡'], ['도면편철장 제3책 제45장']]),
        ]),
        dict(key='대지권의 표시', title=DAEJI_TITLE, cols=DAEJI_COLS, rows=[
            T('1', [['1 소유권대지권'], ['15234.5분의 45.123'], ['2011년7월20일 대지권', '2011년8월10일 등기']]),
        ]),
    ],
    갑구=[
        E('1', '소유권보존', ('2011년8월10일', '제56789호'), '',
          ['소유자 미래건설주식회사 134511-0123456', '경기도 가상시 행복구 미래로 1(미래동)']),
        E('2', '소유권이전', ('2015년6월1일', '제45678호'), '2015년4월20일 매매',
          ['소유자 김가상 700101-*******', APT_ADDR_HOME, '거래가액 금380,000,000원']),
        E('3', '소유권이전', ('2020년3월10일', '제23456호'), '2020년3월1일 증여',
          ['소유자 이미래 750505-*******', MIRAE_ADDR]),
        E('4', '압류', ('2021년11월8일', '제34012호'), '2021년11월2일 압류(세무과-5678)',
          ['권리자 가상시', '처분청 가상시 행복구'], cancelled_by='5'),
        E('5', '4번압류등기말소', ('2022년2월14일', '제5012호'), '2022년2월10일 해제', []),
        E('6', '가압류', ('2023년1월12일', '제3456호'), '2023년1월9일 서울가상지방법원의 가압류결정(2023카단12345)',
          ['청구금액 금30,000,000원', '채권자 박소망 800808-*******', '서울특별시 가상구 나눔로 21(나눔동)'],
          cancelled_by='7'),
        E('7', '6번가압류등기말소', ('2023년5월3일', '제12345호'), '2023년4월28일 해제', []),
        E('8', '소유권이전', ('2024년9월23일', '제67890호'), '2024년8월10일 매매',
          ['소유자 최한빛 880303-*******', CHOI_ADDR, '거래가액 금520,000,000원']),
        E('9', '압류', ('2025년7월14일', '제34567호'), '2025년7월10일 압류(징수부-2025-1234)',
          ['권리자 국민건강보험공단 111471-0008863', '처분청 국민건강보험공단 인천가상지사']),
        E('10', '가처분', ('2025년11월3일', '제51234호'), '2025년10월30일 수원가상지방법원의 가처분결정(2025카합1234)',
          ['피보전권리 사해행위취소를 원인으로 한 소유권이전등기말소청구권', '채권자 주식회사가상캐피탈 110111-0098765',
           '서울특별시 가상구 금융로 20(가상동)', '금지사항 매매, 증여, 전세권, 저당권, 임차권의 설정 기타일체의 처분행위 금지']),
        E('11', '임의경매개시결정', ('2026년2월5일', '제5678호'),
          '2026년2월3일 수원가상지방법원의 임의경매개시결정(2026타경1234)',
          ['채권자 정다온 820202-*******', '서울특별시 가상구 별빛로 3, 101호(별빛동)']),
    ],
    을구=[
        E('1', '근저당권설정', ('2015년6월1일', '제45679호'), '2015년6월1일 설정계약',
          ['채권최고액 금228,000,000원', '채무자 김가상', APT_ADDR_HOME] + BANK + ['(행복동지점)'], cancelled_by='2'),
        E('2', '1번근저당권설정등기말소', ('2020년3월10일', '제23455호'), '2020년3월9일 해지', []),
        E('3', '근저당권설정', ('2021년4월2일', '제13579호'), '2021년4월2일 설정계약',
          ['채권최고액 금96,000,000원', '채무자 이미래', MIRAE_ADDR, '근저당권자 주식회사가상저축은행 110111-0076543',
           '서울특별시 가상구 저축로 8(가상동)'], cancelled_by='6'),
        E('3-1', '3번근저당권변경', ('2022년8월1일', '제31234호'), '2022년7월29일 변경계약',
          ['채권최고액 금120,000,000원'], cancelled_by='6'),
        E('4', '전세권설정', ('2022년1월3일', '제1234호'), '2021년12월20일 설정계약',
          ['전세금 금150,000,000원', '범위 주거용 건물 전부', '존속기간 2022년1월1일부터 2024년12월31일까지',
           '전세권자 한가람 900909-*******', APT_ADDR_HOME], cancelled_by='5'),
        E('5', '4번전세권설정등기말소', ('2024년9월23일', '제67888호'), '2024년9월20일 해지', []),
        E('6', '3번근저당권설정등기말소', ('2024년9월23일', '제67889호'), '2024년9월23일 해지', []),
        E('7', '근저당권설정', ('2024년9월23일', '제67891호'), '2024년9월23일 설정계약',
          ['채권최고액 금360,000,000원', '채무자 최한빛', CHOI_ADDR] + BANK + ['(여신관리센터)'],
          struck={0: '7-1', 3: '7-2', 4: '7-2', 5: '7-2'}),
        E('7-1', '7번근저당권변경', ('2025년1월15일', '제2345호'), '2025년1월14일 변경계약',
          ['채권최고액 금420,000,000원']),
        E('7-2', '7번근저당권이전', ('2025년12월1일', '제58901호'), '2025년11월28일 확정채권양도',
          ['근저당권자 정다온 820202-*******', '서울특별시 가상구 별빛로 3, 101호(별빛동)']),
        E('8', '근저당권설정', ('2025년3월10일', '제12346호'), '2025년3월10일 설정계약',
          ['채권최고액 금78,000,000원', '채무자 최한빛', CHOI_ADDR, '근저당권자 가상대부주식회사 110111-0234567',
           '서울특별시 가상구 대부로 7, 5층(가상동)']),
        E('9', '주택임차권', ('2026년10월15일', '제45012호'),
          '2026년10월8일 수원가상지방법원의 임차권등기명령(2026카임345)',
          ['임차보증금 금200,000,000원', '범위 주거용 건물 전부', '임대차계약일자 2024년9월10일',
           '주민등록일자 2024년9월23일', '점유개시일자 2024년9월23일', '확정일자 2024년9월23일',
           '임차권자 윤가람 950505-*******', '경기도 가상시 평화구 고요로 5(고요동)']),
    ],
    owners=[{'name': '최한빛', 'role': '소유자', 'id_no': '880303-*******', 'share': '단독소유',
             'share_fraction': '1/1', 'address': CHOI_ADDR, 'rank': '8'}],
    summary=dict(
        owners=[['최한빛 (소유자)', '880303-*******', '단독소유', CHOI_ADDR, '8']],
        gap=[['9', '압류', '2025년7월14일\n제34567호', '권리자 국민건강보험공단', '최한빛'],
             ['10', '가처분', '2025년11월3일\n제51234호',
              '피보전권리 사해행위취소를 원인으로 한 소유권이전등기말소청구권\n채권자 주식회사가상캐피탈\n'
              '금지사항 매매, 증여, 전세권, 저당권, 임차권의 설정 기타일체의 처분행위 금지', '최한빛'],
             ['11', '임의경매개시결정', '2026년2월5일\n제5678호', '채권자 정다온', '최한빛']],
        eul=[['7', '근저당권설정', '2024년9월23일\n제67891호', '채권최고액 금360,000,000원\n근저당권자 주식회사가상은행', '최한빛'],
             ['7-1', '7번근저당권변경', '2025년1월15일\n제2345호', '채권최고액 금420,000,000원', '최한빛'],
             ['7-2', '7번근저당권이전', '2025년12월1일\n제58901호', '근저당권자 정다온', '최한빛'],
             ['8', '근저당권설정', '2025년3월10일\n제12346호', '채권최고액 금78,000,000원\n근저당권자 가상대부주식회사', '최한빛'],
             ['9', '주택임차권', '2026년10월15일\n제45012호', '임차보증금 금200,000,000원\n임차권자 윤가람', '최한빛']],
    ),
    flags=['압류(유효)', '가처분(유효)', '임의경매개시결정', '근저당 다수', '근저당권 이전(개인)', '대부업체 근저당',
           '임차권등기', '최근 소유권 이전(2년 이내)', '매매 당일 근저당 설정'],
    notes=['말소된 엔트리(빨간 줄 전체): 갑구 4 압류(5로 말소), 갑구 6 가압류(7로 말소), 을구 1 근저당(2로 말소), '
           '을구 3 근저당과 그 부기 3-1(둘 다 6으로 말소), 을구 4 전세권(5로 말소).',
           '을구 7 근저당은 유효하지만 일부 줄에 빨간 줄이 있음: 채권최고액 줄은 7-1 변경으로, 근저당권자 줄(주소·지점 포함)은 '
           '7-2 이전으로 변경 전 사항 말소 표시. 엔트리 전체 말소로 판정하면 안 됨.',
           '부기등기(3-1, 7-1, 7-2)는 주등기 바로 아래에 표시되므로 접수일 순서와 출력 순서가 다름(7-2가 8보다 늦게 접수됐지만 먼저 나옴).',
           '현재 유효 채권최고액: 7번(변경 후) 420,000,000원 + 8번 78,000,000원 = 498,000,000원. 임차보증금 200,000,000원.',
           '표제부 1동 표시번호 1은 표시번호 2(도로명주소)로 말소 표시됨.'],
)

VILLA_ADDR_TRUSTEE = '서울특별시 가상구 금융로 50(가상동)'
VILLA = dict(
    kind='집합건물',
    address='서울특별시 가상구 소망동 456-7 소망하이츠 제3층 제301호',
    unique_no='1146-2026-001234',
    office='서울가상지방법원 가상등기국',
    title_sections=[
        dict(key='1동의 건물의 표시', title=DONG_TITLE, cols=DONG_COLS, rows=[
            T('1', [['2026년1월15일'], ['서울특별시 가상구 소망동 456-7', '소망하이츠', '[도로명주소]', '서울특별시 가상구 소망로12길 34'],
                    ['철근콘크리트구조', '(철근)콘크리트지붕 5층', '다세대주택 및 제2종근린생활시설',
                     '1층 제2종근린생활시설(사무소) 98.50㎡', '2층 다세대주택 120.30㎡', '3층 제2종근린생활시설(사무소) 120.30㎡',
                     '4층 다세대주택 120.30㎡', '5층 다세대주택 98.10㎡'],
                    ['도면번호 제2026-123호']]),
        ]),
        dict(key='전유부분의 건물의 표시', title=UNIT_TITLE, cols=UNIT_COLS, rows=[
            T('1', [['2026년1월15일'], ['제3층 제301호'], ['철근콘크리트구조', '제2종근린생활시설(사무소)', '42.15㎡'],
                    ['도면번호 제2026-123호']]),
        ]),
    ],
    갑구=[
        E('1', '소유권보존', ('2026년1월15일', '제8765호'), '',
          ['소유자 주식회사소망건설 110111-0345678', '서울특별시 가상구 소망로 100(소망동)']),
        E('2', '소유권이전', ('2026년1월15일', '제8766호'), '2026년1월15일 신탁',
          ['수탁자 가상자산신탁주식회사 110111-0456789', VILLA_ADDR_TRUSTEE],
          subs=[{'purpose': '신탁', 'holder': ['신탁원부 제2026-45호']}]),
    ],
    을구=[],
    owners=[{'name': '가상자산신탁주식회사', 'role': '수탁자', 'id_no': '110111-0456789', 'share': '단독소유',
             'share_fraction': '1/1', 'address': VILLA_ADDR_TRUSTEE, 'rank': '2'}],
    summary=dict(
        owners=[['가상자산신탁주식회사 (수탁자)', '110111-0456789', '단독소유', VILLA_ADDR_TRUSTEE, '2']],
        gap=[['2', '신탁', '2026년1월15일\n제8766호', '신탁원부 제2026-45호', '가상자산신탁주식회사']],
        eul=[],
    ),
    flags=['신탁', '신탁원부 확인 필요', '신축 보존등기(1년 이내)', '대지권 표시 없음', '근린생활시설(주거용 아님)'],
    notes=['대지권의 목적인 토지의 표시·대지권의 표시 절이 아예 없음(대지권 미등기 상황을 별도 문구 없이 표현).',
           '갑구 2는 같은 순위번호 안에 하위 행 두 개: "소유권이전"(수탁자) + "신탁"(신탁원부). 하위 행 사이 가로줄은 순위번호 칸을 건너뜀.',
           '을구는 제목·열 머리 아래 "기록사항 없음" 한 줄만 있음. 요약 3번은 "- 기록사항 없음".',
           '1동 건물내역의 3층과 전유부분 용도가 제2종근린생활시설(사무소)인 근생빌라 상황.'],
)

HOUSE_ADDR = '경기도 가상시 평화구 고요동 78-9'
HOUSE_BLDG = ['철근콘크리트구조 슬래브지붕', '2층 단독주택', '1층 85.20㎡', '2층 72.40㎡']
HOUSE_OWNER_ADDR = '경기도 가상시 평화구 고요로 12(고요동)'
CONV = '부동산등기법 제177조의 6 제1항의 규정에 의하여 2001년 06월 20일 전산이기'
HOUSE = dict(
    kind='건물',
    address=HOUSE_ADDR,
    unique_no='1234-1998-012345',
    office='수원가상지방법원 가상등기소',
    title_sections=[
        dict(key='건물의 표시', title=BLDG_TITLE, cols=BLDG_COLS, rows=[
            T('1', [['1998년5월20일'], [HOUSE_ADDR], HOUSE_BLDG, ['도면편철장 제2책 제118장', CONV]], cancelled_by='2'),
            T('2', [[], [HOUSE_ADDR, '[도로명주소]', '경기도 가상시 평화구 고요로 12'], HOUSE_BLDG,
                    ['도로명주소', '2013년11월25일 등기']]),
        ]),
    ],
    갑구=[
        E('1', '소유권보존', ('1998년5월20일', '제12345호'), '',
          ['소유자 오세움 550101-*******', HOUSE_ADDR, CONV]),
        E('2', '소유권이전청구권가등기', ('2019년3월4일', '제9876호'), '2019년3월2일 매매예약',
          ['가등기권자 서나래 680606-*******', '경기도 가상시 평화구 조용로 8(조용동)'], cancelled_by='3'),
        E('3', '2번가등기말소', ('2019년9월10일', '제23456호'), '2019년9월9일 해제', []),
        E('4', '소유권이전', ('2021년6월15일', '제34567호'), '2021년5월10일 매매',
          ['소유자 문가온 790707-*******', HOUSE_OWNER_ADDR, '거래가액 금410,000,000원']),
    ],
    을구=[
        E('1', '근저당권설정', ('2021년6월15일', '제34568호'), '2021년6월15일 설정계약',
          ['채권최고액 금240,000,000원', '채무자 문가온', HOUSE_OWNER_ADDR,
           '근저당권자 가상농업협동조합 124136-0001234', '경기도 가상시 평화구 들판로 3(들판동)',
           '공동담보 토지 경기도 가상시 평화구 고요동 78-9'], cancelled_by='2'),
        E('2', '1번근저당권설정등기말소', ('2025년8월20일', '제45678호'), '2025년8월19일 해지', []),
    ],
    owners=[{'name': '문가온', 'role': '소유자', 'id_no': '790707-*******', 'share': '단독소유',
             'share_fraction': '1/1', 'address': HOUSE_OWNER_ADDR, 'rank': '4'}],
    summary=dict(owners=[['문가온 (소유자)', '790707-*******', '단독소유', HOUSE_OWNER_ADDR, '4']], gap=[], eul=[]),
    flags=[],
    notes=['유효한 제한물권·처분제한 없음(깨끗한 등기). 말소 이력만 있음: 갑구 2 가등기(3으로 말소), 을구 1 근저당(2로 말소).',
           '표제부 표시번호 1은 표시번호 2(도로명주소)로 말소 표시됨.'],
)

LAND_ADDR = '충청남도 가상군 들녘면 너른리 345'
CONV_L = '부동산등기법 제177조의 6 제1항의 규정에 의하여 2001년 06월 15일 전산이기'
KIM_ADDR = '충청남도 가상군 들녘면 너른리 351'
NARAE_OLD = '대전광역시 가상구 한밭로 15, 102동 304호(한밭동, 한밭아파트)'
NARAE_NEW = '대전광역시 가상구 둔지로 40, 201동 1502호(둔지동, 둔지마을)'
PARK_ADDR = '충청남도 가상군 들녘면 너른리 360'
NH = ['가상농업협동조합 164936-0001234', '충청남도 가상군 들녘면 들녘로 10']
LAND = dict(
    kind='토지',
    address=LAND_ADDR,
    unique_no='1645-1996-123456',
    office='대전가상지방법원 가상지원 들녘등기소',
    title_sections=[
        dict(key='토지의 표시', title=LAND_TITLE, cols=LAND_COLS, rows=[
            T('1', [['1996년3월2일'], [LAND_ADDR], ['전'], ['2314㎡'], [CONV_L]], no_display=['1', '(전 2)']),
        ]),
    ],
    갑구=[
        E('1', '소유권이전', ('1985년4월2일', '제2345호'), '1985년3월15일 매매',
          ['소유자 김한결 350303-*******', KIM_ADDR, CONV_L], rank_display=['1', '(전 3)']),
        E('2', '소유권이전', ('2019년8월20일', '제12345호'), '2019년2월10일 협의분할에 의한 상속',
          ['공유자', '지분 2분의 1', '김가상 700101-*******', KIM_ADDR,
           '지분 4분의 1', '김나래 730303-*******', NARAE_OLD,
           '지분 4분의 1', '김다솜 760606-*******', '세종특별자치시 가상로 88, 503동 1101호(가상동, 가상마을5단지)'],
          struck={6: '2-1'}),
        E('2-1', '2번등기명의인표시변경', ('2022년4월11일', '제5678호'), '2021년11월30일 전거',
          ['김나래의 주소 ' + NARAE_NEW]),
        E('3', '2번김가상지분가압류', ('2024년5월7일', '제9876호'),
          '2024년5월3일 대전가상지방법원 가상지원의 가압류결정(2024카단5678)',
          ['청구금액 금45,000,000원', '채권자 주식회사가상카드 110111-0567890', '서울특별시 가상구 카드로 1(가상동)']),
        E('4', '2번김다솜지분전부이전', ('2025년3월3일', '제4567호'), '2025년2월27일 매매',
          ['공유자 지분 4분의 1', '박들녘 810101-*******', PARK_ADDR, '거래가액 금60,000,000원']),
        E('5', '2번김나래지분압류', ('2025년6월2일', '제7890호'), '2025년5월28일 압류(세무과-1234)',
          ['권리자 가상군', '처분청 가상군'], cancelled_by='6'),
        E('6', '5번압류등기말소', ('2025년9월1일', '제11223호'), '2025년8월29일 해제', []),
    ],
    을구=[
        E('1', '근저당권설정', ('2020년5월11일', '제6788호'), '2020년5월11일 설정계약',
          ['채권최고액 금130,000,000원', '채무자 김가상', KIM_ADDR, '근저당권자 ' + NH[0], NH[1], '공동담보목록 제2020-321호']),
        E('2', '지상권설정', ('2020년5월11일', '제6789호'), '2020년5월11일 설정계약',
          ['목적 건물 기타 공작물이나 수목의 소유', '범위 토지의 전부', '존속기간 2020년5월11일부터 만30년', '지료 없음',
           '지상권자 ' + NH[0], NH[1]]),
    ],
    owners=[
        {'name': '김가상', 'role': '공유자', 'id_no': '700101-*******', 'share': '2분의 1', 'share_fraction': '1/2',
         'address': KIM_ADDR, 'rank': '2'},
        {'name': '김나래', 'role': '공유자', 'id_no': '730303-*******', 'share': '4분의 1', 'share_fraction': '1/4',
         'address': NARAE_NEW, 'rank': '2', 'address_changed_by': '2-1'},
        {'name': '박들녘', 'role': '공유자', 'id_no': '810101-*******', 'share': '4분의 1', 'share_fraction': '1/4',
         'address': PARK_ADDR, 'rank': '4'},
    ],
    summary=dict(
        owners=[['김가상 (공유자)', '700101-*******', '2분의 1', KIM_ADDR, '2'],
                ['김나래 (공유자)', '730303-*******', '4분의 1', NARAE_NEW, '2'],
                ['박들녘 (공유자)', '810101-*******', '4분의 1', PARK_ADDR, '4']],
        gap=[['3', '가압류', '2024년5월7일\n제9876호', '청구금액 금45,000,000원\n채권자 주식회사가상카드', '김가상']],
        eul=[['1', '근저당권설정', '2020년5월11일\n제6788호', '채권최고액 금130,000,000원\n근저당권자 가상농업협동조합', '김가상 등'],
             ['2', '지상권설정', '2020년5월11일\n제6789호', '존속기간 2020년5월11일부터 만30년\n지상권자 가상농업협동조합', '김가상 등']],
    ),
    flags=['공유(지분) 소유', '지분 가압류(유효)', '근저당', '지상권(유효)', '상속 이력', '공유지분 일부 매매'],
    notes=['갑구 2(상속) 김나래 주소 줄은 2-1 등기명의인표시변경으로 빨간 줄(변경 전 사항 말소 표시). 엔트리 자체는 유효.',
           '갑구 1과 표제부 1의 순위/표시번호 칸은 두 줄: "1" / "(전 3)" 또는 "(전 2)" (전산이기 전 번호).',
           '갑구 5 김나래지분 압류는 6으로 말소. 갑구 3 김가상지분 가압류는 유효.',
           '을구 1 근저당과 2 지상권은 같은 날 같은 권리자(담보지상권 패턴).'],
)


# ---------------------------------------------------------------- cross-document set 1: land + building, same lot
LOT = '경기도 가상시 행복구 미래동 45'
CONV_S = '부동산등기법 제177조의 6 제1항의 규정에 의하여 2001년 06월 25일 전산이기'
PARK_A = '경기도 가상시 행복구 희망로 120(희망동)'
PARK_B = '서울특별시 가상구 새싹로 15, 2동 701호(새싹동, 새싹아파트)'
CHOI_C = ['채권자 최가상 720202-*******', '서울특별시 가상구 누리로 33(누리동)']
BANK_M = ['근저당권자 주식회사가상은행 110111-0012345', '서울특별시 가상구 금융로 10(가상동)', '(미래동지점)']
SET_LAND = dict(
    kind='토지', address=LOT, unique_no='1234-1996-004545', office='수원가상지방법원 가상등기소',
    title_sections=[dict(key='토지의 표시', title=LAND_TITLE, cols=LAND_COLS, rows=[
        T('1', [['1995년2월10일'], [LOT], ['대'], ['330㎡'], [CONV_S]], no_display=['1', '(전 2)'])])],
    갑구=[
        E('1', '소유권이전', ('1995년2월10일', '제3012호'), '1995년1월25일 매매',
          ['소유자 윤옛터 401010-*******', '경기도 가상시 행복구 미래동 47', CONV_S], rank_display=['1', '(전 3)']),
        E('2', '소유권이전', ('2010년4월12일', '제12011호'), '2010년3월20일 매매',
          ['소유자 박가상 600606-*******', PARK_A, '거래가액 금310,000,000원']),
        E('3', '가압류', ('2025년1월20일', '제5123호'), '2025년1월16일 수원가상지방법원의 가압류결정(2025카단1001)',
          ['청구금액 금80,000,000원'] + CHOI_C),
    ],
    을구=[
        E('1', '근저당권설정', ('2012년7월3일', '제40123호'), '2012년7월3일 설정계약',
          ['채권최고액 금240,000,000원', '채무자 박가상', PARK_A] + BANK_M + ['공동담보목록 제2012-77호']),
    ],
    owners=[{'name': '박가상', 'role': '소유자', 'id_no': '600606-*******', 'share': '단독소유', 'share_fraction': '1/1',
             'address': PARK_A, 'rank': '2'}],
    summary=dict(
        owners=[['박가상 (소유자)', '600606-*******', '단독소유', PARK_A, '2']],
        gap=[['3', '가압류', '2025년1월20일\n제5123호', '청구금액 금80,000,000원\n채권자 최가상', '박가상']],
        eul=[['1', '근저당권설정', '2012년7월3일\n제40123호', '채권최고액 금240,000,000원\n근저당권자 주식회사가상은행', '박가상']]),
    flags=['가압류(유효)', '근저당', '공동담보', '토지·건물 소유자 상이'],
    notes=['set_bldg.pdf와 같은 지번(경기도 가상시 행복구 미래동 45)의 토지 등기. 토지는 계속 박가상 소유.',
           '갑구 3 가압류(채권자 최가상, 2025-01-20 접수)는 건물 증여(2025-03-14 접수)보다 앞섬.',
           '을구 1 근저당의 공동담보목록 제2012-77호가 건물 을구 1과 같음.'],
    cross=dict(group='set_lot_45', related=['set_bldg.pdf'], same_lot=LOT,
               expected_cross_flags=['토지·건물 소유자 상이', '토지 가압류 후 건물만 증여', '동일 채권자(최가상) 토지 가압류 + 건물 사해행위 가처분',
                                     '공동담보목록 동일(제2012-77호)', '수증자 동일 성씨(특수관계 의심)', '사해행위 의심']),
)
SET_BLDG = dict(
    kind='건물', address=LOT, unique_no='1234-2016-007777', office='수원가상지방법원 가상등기소',
    title_sections=[dict(key='건물의 표시', title=BLDG_TITLE, cols=BLDG_COLS, rows=[
        T('1', [['2016년5월2일'], [LOT, '[도로명주소]', '경기도 가상시 행복구 미래로45번길 7'],
                ['철근콘크리트구조', '(철근)콘크리트지붕 3층', '제1종근린생활시설 및 단독주택', '1층 제1종근린생활시설(소매점) 120.50㎡',
                 '2층 단독주택 110.20㎡', '3층 단독주택 95.40㎡'], ['도면번호 제2016-321호']])])],
    갑구=[
        E('1', '소유권보존', ('2016년5월2일', '제31001호'), '', ['소유자 박가상 600606-*******', PARK_A]),
        E('2', '소유권이전', ('2025년3월14일', '제17001호'), '2025년3월12일 증여', ['소유자 박가상둘 880808-*******', PARK_B]),
        E('3', '가처분', ('2025년8월11일', '제50111호'), '2025년8월7일 수원가상지방법원의 가처분결정(2025카단2002)',
          ['피보전권리 사해행위취소를 원인으로 한 소유권이전등기말소등기청구권'] + CHOI_C +
          ['금지사항 양도, 담보권설정 기타 일체의 처분행위 금지']),
    ],
    을구=[
        E('1', '근저당권설정', ('2016년5월2일', '제31002호'), '2016년5월2일 추가설정계약',
          ['채권최고액 금240,000,000원', '채무자 박가상', PARK_A] + BANK_M + ['공동담보목록 제2012-77호']),
    ],
    owners=[{'name': '박가상둘', 'role': '소유자', 'id_no': '880808-*******', 'share': '단독소유', 'share_fraction': '1/1',
             'address': PARK_B, 'rank': '2'}],
    summary=dict(
        owners=[['박가상둘 (소유자)', '880808-*******', '단독소유', PARK_B, '2']],
        gap=[['3', '가처분', '2025년8월11일\n제50111호',
              '피보전권리 사해행위취소를 원인으로 한 소유권이전등기말소등기청구권\n채권자 최가상\n금지사항 양도, 담보권설정 기타 일체의 처분행위 금지',
              '박가상둘']],
        eul=[['1', '근저당권설정', '2016년5월2일\n제31002호', '채권최고액 금240,000,000원\n근저당권자 주식회사가상은행', '박가상둘']]),
    flags=['가처분(유효)', '사해행위취소 가처분', '최근 소유권 이전(증여)', '근저당', '공동담보', '토지·건물 소유자 상이'],
    notes=['set_land.pdf와 같은 지번의 건물(근린생활시설+단독주택). 2025-03 건물만 박가상 -> 박가상둘 증여.',
           '갑구 3 가처분 채권자 최가상 = 토지 갑구 3 가압류 채권자. 피보전권리 사해행위취소.',
           '을구 1 근저당은 2016년 추가설정계약으로 토지와 같은 공동담보목록 제2012-77호에 편입. 채무자는 여전히 박가상.'],
    cross=SET_LAND['cross'] | dict(related=['set_land.pdf']),
)

# ---------------------------------------------------------------- cross-document set 2: same owner, two units, same-day transfers
JUNG = '정가상 650505-*******'
JUNGA_ID = '920303-*******'
JUNG_ADDR = '서울특별시 가상구 하늘로 77, 103동 1201호(하늘동, 하늘아파트)'
JUNGA_ADDR = '경기도 가상시 행복구 새봄로 5, 1동 202호(새봄동, 새봄빌)'
A1_BLDG = ['철근콘크리트구조', '(철근)콘크리트지붕 20층', '공동주택(아파트)', '1층 402.10㎡'] + \
          ['%d층 398.75㎡' % i for i in range(2, 21)]
OWNER_A1 = dict(
    kind='집합건물', address='서울특별시 가상구 하늘동 77 하늘아파트 제103동 제12층 제1201호',
    unique_no='1101-2008-012012', office='서울가상지방법원 가상등기국',
    title_sections=[
        dict(key='1동의 건물의 표시', title=DONG_TITLE, cols=DONG_COLS, rows=[
            T('1', [['2008년3월2일'], ['서울특별시 가상구 하늘동 77', '하늘아파트 제103동', '[도로명주소]', '서울특별시 가상구 하늘로 77'],
                    A1_BLDG, ['도면편철장 제5책 제12장']])]),
        dict(key='대지권의 목적인 토지의 표시', title=LANDRIGHT_TITLE, cols=LANDRIGHT_COLS, rows=[
            T('1', [['1. 서울특별시 가상구 하늘동 77'], ['대'], ['21045.3㎡'], ['2008년3월2일 등기']])]),
        dict(key='전유부분의 건물의 표시', title=UNIT_TITLE, cols=UNIT_COLS, rows=[
            T('1', [['2008년3월2일'], ['제12층 제1201호'], ['철근콘크리트구조', '114.8721㎡'], ['도면편철장 제5책 제12장']])]),
        dict(key='대지권의 표시', title=DAEJI_TITLE, cols=DAEJI_COLS, rows=[
            T('1', [['1 소유권대지권'], ['21045.3분의 52.871'], ['2008년2월15일 대지권', '2008년3월2일 등기']])]),
    ],
    갑구=[
        E('1', '소유권보존', ('2008년3월2일', '제9001호'), '', ['소유자 하늘건설주식회사 110111-0111111', '서울특별시 가상구 하늘로 1(하늘동)']),
        E('2', '소유권이전', ('2012년9월5일', '제50112호'), '2012년8월1일 매매', ['소유자 ' + JUNG, JUNG_ADDR, '거래가액 금610,000,000원']),
        E('3', '압류', ('2025년5월14일', '제30115호'), '2025년5월12일 압류(체납징세과-5151)', ['권리자 국', '처분청 가상세무서']),
        E('4', '소유권이전', ('2025년6월10일', '제35210호'), '2025년6월9일 증여', ['소유자 정가상아 ' + JUNGA_ID, JUNGA_ADDR]),
    ],
    을구=[
        E('1', '근저당권설정', ('2012년9월5일', '제50113호'), '2012년9월5일 설정계약',
          ['채권최고액 금300,000,000원', '채무자 정가상', JUNG_ADDR, '근저당권자 주식회사가상은행 110111-0012345',
           '서울특별시 가상구 금융로 10(가상동)'], cancelled_by='2'),
        E('2', '1번근저당권설정등기말소', ('2020년11월2일', '제61234호'), '2020년10월30일 해지', []),
    ],
    owners=[{'name': '정가상아', 'role': '소유자', 'id_no': JUNGA_ID, 'share': '단독소유', 'share_fraction': '1/1',
             'address': JUNGA_ADDR, 'rank': '4'}],
    summary=dict(
        owners=[['정가상아 (소유자)', JUNGA_ID, '단독소유', JUNGA_ADDR, '4']],
        gap=[['3', '압류', '2025년5월14일\n제30115호', '권리자 국', '정가상아']],
        eul=[]),
    flags=['압류(유효, 국세)', '최근 소유권 이전(증여)', '압류 후 증여'],
    notes=['owner_a2.pdf와 같은 전 소유자 정가상(650505-*******). 두 물건 모두 2025-06-10 접수로 정가상아(920303-*******)에게 이전.',
           '갑구 3 국세 압류(2025-05-14)는 이전 전 등기로 유효하게 남아 있음.', '을구 1 근저당은 2로 말소.'],
    cross=dict(group='owner_jung', related=['owner_a2.pdf'], same_previous_owner='정가상 650505-*******',
               transferee='정가상아 920303-*******', transfer_receipt_date='2025년6월10일',
               expected_cross_flags=['동일인 소유 복수 부동산 동일자 이전', '동일 양수인(동일 성씨, 특수관계 의심)', '국세 압류 직후 증여',
                                     '저가 매매(거래가액 금10,000,000원)', '이전 직전 양수인 명의 근저당 설정', '사해행위 의심']),
)
OWNER_A2 = dict(
    kind='집합건물', address='경기도 가상시 평화구 고요동 12-3 고요빌라 제2층 제201호',
    unique_no='1234-2014-003003', office='수원가상지방법원 가상등기소',
    title_sections=[
        dict(key='1동의 건물의 표시', title=DONG_TITLE, cols=DONG_COLS, rows=[
            T('1', [['2014년2월3일'], ['경기도 가상시 평화구 고요동 12-3', '고요빌라', '[도로명주소]', '경기도 가상시 평화구 고요로 33'],
                    ['철근콘크리트구조', '(철근)콘크리트지붕 4층', '다세대주택', '1층 주차장 18.40㎡', '2층 182.30㎡', '3층 182.30㎡', '4층 160.25㎡'],
                    ['도면번호 제2014-55호']])]),
        dict(key='대지권의 목적인 토지의 표시', title=LANDRIGHT_TITLE, cols=LANDRIGHT_COLS, rows=[
            T('1', [['1. 경기도 가상시 평화구 고요동 12-3'], ['대'], ['264.5㎡'], ['2014년2월3일 등기']])]),
        dict(key='전유부분의 건물의 표시', title=UNIT_TITLE, cols=UNIT_COLS, rows=[
            T('1', [['2014년2월3일'], ['제2층 제201호'], ['철근콘크리트구조', '59.82㎡'], ['도면번호 제2014-55호']])]),
        dict(key='대지권의 표시', title=DAEJI_TITLE, cols=DAEJI_COLS, rows=[
            T('1', [['1 소유권대지권'], ['264.5분의 33.06'], ['2014년1월20일 대지권', '2014년2월3일 등기']])]),
    ],
    갑구=[
        E('1', '소유권보존', ('2014년2월3일', '제5001호'), '', ['소유자 고요주택건설주식회사 134511-0222222', '경기도 가상시 평화구 고요로 1(고요동)']),
        E('2', '소유권이전', ('2014년3월20일', '제12001호'), '2014년2월25일 매매', ['소유자 ' + JUNG, JUNG_ADDR, '거래가액 금185,000,000원']),
        E('3', '소유권이전', ('2025년6월10일', '제35211호'), '2025년6월9일 매매',
          ['소유자 정가상아 ' + JUNGA_ID, JUNGA_ADDR, '거래가액 금10,000,000원']),
    ],
    을구=[
        E('1', '근저당권설정', ('2025년5월20일', '제31888호'), '2025년5월20일 설정계약',
          ['채권최고액 금300,000,000원', '채무자 정가상', JUNG_ADDR, '근저당권자 정가상아 ' + JUNGA_ID, JUNGA_ADDR]),
    ],
    owners=[{'name': '정가상아', 'role': '소유자', 'id_no': JUNGA_ID, 'share': '단독소유', 'share_fraction': '1/1',
             'address': JUNGA_ADDR, 'rank': '3'}],
    summary=dict(
        owners=[['정가상아 (소유자)', JUNGA_ID, '단독소유', JUNGA_ADDR, '3']],
        gap=[],
        eul=[['1', '근저당권설정', '2025년5월20일\n제31888호', '채권최고액 금300,000,000원\n근저당권자 정가상아', '정가상아']]),
    flags=['저가 매매(거래가액 금10,000,000원)', '개인 근저당', '이전 직전 근저당 설정', '근저당권자와 현 소유자 동일'],
    notes=['owner_a1.pdf와 같은 전 소유자 정가상. 갑구 3 매매 거래가액 금10,000,000원(직전 취득가 금185,000,000원).',
           '을구 1 근저당(2025-05-20, 채권최고액 금300,000,000원)의 근저당권자 정가상아가 2025-06-10 소유자가 됨. 말소 표시 없이 유효로 남아 있음.'],
    cross=OWNER_A1['cross'] | dict(related=['owner_a1.pdf']),
)


def make_scan(src, dst, dpi=150):
    tmp = tempfile.mkdtemp(prefix='scan_', dir=os.path.dirname(os.path.abspath(__file__)))
    subprocess.run(['pdftoppm', '-r', str(dpi), '-jpeg', '-jpegopt', 'quality=82', src, os.path.join(tmp, 'p')], check=True)
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    imgs = sorted(f for f in os.listdir(tmp) if f.endswith('.jpg'))
    c = canvas.Canvas(dst, pagesize=A4)
    c.setTitle('scan')
    c.setProducer('registry-fixture-gen (image-only)')
    for f in imgs:
        c.drawImage(os.path.join(tmp, f), 0, 0, width=A4[0], height=A4[1])
        c.showPage()
    c.save()
    for f in imgs:
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    return len(imgs)


if __name__ == '__main__':
    t = build('apt_risky', APT)
    build('villa_trust', VILLA)
    build('house_clean', HOUSE)
    build('land_share', LAND)
    build('set_land', SET_LAND)
    build('set_bldg', SET_BLDG)
    build('owner_a1', OWNER_A1)
    build('owner_a2', OWNER_A2)
    n = make_scan(os.path.join(OUT, 'apt_risky.pdf'), os.path.join(OUT, 'apt_risky_scan.pdf'))
    t2 = dict(t)
    t2['file'] = 'apt_risky_scan.pdf'
    t2['has_text_layer'] = False
    t2['scan'] = {'source': 'apt_risky.pdf', 'dpi': 150, 'format': 'JPEG q82, one image XObject per page, no text layer',
                  'pages': n}
    t2['notes'] = ['apt_risky.pdf를 150dpi로 래스터화한 이미지 전용 PDF. getTextContent 결과는 빈 배열이어야 함. 내용 정답은 apt_risky와 동일.'] + t['notes']
    with open(os.path.join(OUT, 'apt_risky_scan.truth.json'), 'w', encoding='utf-8') as f:
        json.dump(t2, f, ensure_ascii=False, indent=2)
    print('apt_risky_scan   pages %d (image only)' % n)
