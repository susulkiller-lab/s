// 사용설명서.docx 생성 스크립트
// 실행: NODE_PATH=<docx가 설치된 node_modules> node make_manual.js <출력 경로>
// 서체 바탕체. keepNext·keepLines·pageBreakBefore는 쓰지 않는다(Word가 줄 옆에 검은 네모 표시를 띄운다).
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  AlignmentType, LevelFormat, HeadingLevel, Footer, PageNumber, VerticalAlign,
} = require("docx");

const OUT = process.argv[2] || "사용설명서.docx";
const FONT = "바탕체";
const W = 9072; // A4 본문 폭(여백 25mm)
const VERSION = "2026. 11. 20.";
const ADDR_ASOF = "2026. 10. 2.";

const run = (t, o = {}) => new TextRun({ text: t, font: FONT, ...o });
const P = (t, o = {}) => new Paragraph({ spacing: { before: 0, after: 120, line: 340 }, ...o, children: Array.isArray(t) ? t : [run(t)] });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [run(t, { bold: true, size: 28 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 100 }, children: [run(t, { bold: true, size: 24 })] });
const steps = (ref, items, inst = 1) =>
  items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0, instance: inst }, spacing: { before: 0, after: 80, line: 340 }, children: [run(t)] }));
const note = (t) => new Paragraph({ spacing: { before: 60, after: 140, line: 320 }, indent: { left: 240 }, children: [run(t, { size: 20, color: "444444" })] });

const border = { style: BorderStyle.SINGLE, size: 4, color: "9AA5A0" };
const borders = { top: border, bottom: border, left: border, right: border };
function table(widths, head, rows) {
  const sum = widths.reduce((a, b) => a + b, 0);
  const cell = (t, w, isHead) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders,
      verticalAlign: VerticalAlign.TOP,
      shading: isHead ? { type: ShadingType.CLEAR, fill: "E4ECE8", color: "auto" } : undefined,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      children: String(t).split("\n").map((line) => new Paragraph({ spacing: { before: 0, after: 40, line: 300 }, children: [run(line, { size: 20, bold: !!isHead })] })),
    });
  return new Table({
    width: { size: sum, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], false)) })),
    ],
  });
}
const gap = () => new Paragraph({ spacing: { before: 0, after: 60 }, children: [run("")] });

const num = (ref) => ({
  reference: ref,
  levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1)", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 380 } }, run: { font: FONT } } }],
});

const body = [];
const add = (...xs) => xs.forEach((x) => (Array.isArray(x) ? body.push(...x) : body.push(x)));

// ── 표지 ──
add(
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 160 }, children: [run("금융거래정보 제출명령 작성기", { bold: true, size: 40 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 }, children: [run("사용설명서", { bold: true, size: 32 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 360 }, children: [run(`설치 키트 포함 · 버전 ${VERSION} · 기관 주소 기준일 ${ADDR_ASOF}`, { size: 20, color: "444444" })] }),
);

// ── 1 ──
add(
  H1("1. 이 도구로 할 수 있는 일"),
  P("사건 정보, 대상기관, 명의인, 거래기간, 사용목적을 입력하면 금융거래정보 제출명령 신청서의 문안을 만들어 보여 줍니다. 완성된 문안은 항목별로 복사해 전자소송에 옮겨 적거나, DOCX 파일로 저장할 수 있습니다."),
  P("문서에는 아래 날짜, 대리인, 변호사 이름, 법률사무소 이름, 법원 이름(귀중)이 나오지 않습니다. 다른 직원이 문안을 보고 전자소송에 입력하는 용도입니다."),
  P("신청서는 두 종류입니다. 은행·금융기관용과 보험사용이며, 5. 요구하는 거래정보 등의 내용만 다릅니다."),
);

// ── 2 ──
add(
  H1("2. 키트 구성"),
  table([2600, 6472], ["파일·폴더", "내용"], [
    ["CLAUDE.md", "Claude Code가 읽는 설치 절차입니다. 직접 열어 고치지 않습니다."],
    ["설치안내.txt", "직원용 한 쪽 안내입니다."],
    ["사용설명서.docx", "이 문서입니다."],
    ["finorder.html", "게시되는 작성기 본체입니다(약 220KB). 수정하지 않습니다."],
    ["source 폴더", "관리자용 원본입니다(명세, 코드, 기관 데이터, 시험). 설치에는 쓰지 않습니다."],
  ]),
  gap(),
);

// ── 3 ──
add(
  H1("3. 설치 (직원, 1회)"),
  H2("3-1. 준비물"),
  P("Claude 유료 요금제(Pro 이상) 계정, Claude 데스크톱 앱(Code 탭) 또는 Claude Code, 키트 폴더 전체입니다. 별도 커넥터는 필요 없습니다."),
  H2("3-2. 설치 순서"),
  steps("inst", [
    "받은 압축 파일(finorder-kit.zip)을 풀어 finorder-kit 폴더를 만듭니다.",
    "Claude 데스크톱 앱의 Code 탭(또는 Claude Code)을 열고 작업 폴더로 finorder-kit 폴더를 선택합니다.",
    "입력창에 다음 한 줄을 입력합니다.   신청서 작성기 설치해줘",
    "게시 허용을 묻는 창이 뜨면 허용합니다.",
    "마지막에 나오는 작성기 주소를 즐겨찾기에 추가합니다. 이후에는 Claude Code 없이 웹에서 이 주소로 씁니다.",
  ]),
  H2("3-3. 설치 확인"),
  P("작성기 주소를 열어 가상 이름(예: 홍길동)으로 사건 정보, 대상기관 1곳, 명의인, 거래기간을 채우고 DOCX로 저장을 눌러 파일이 저장되는지 확인합니다. 허용 창이 뜨면 허용합니다. 확인용 입력에는 실제 의뢰인 정보를 쓰지 않습니다."),
  H2("3-4. 새 버전으로 바꾸기"),
  P("새 키트를 받으면 같은 방법으로 \"신청서 작성기 업데이트해줘\"(또는 \"설치해줘\")라고 입력합니다. 이미 설치되어 있으면 Claude가 먼저 새 버전으로 바꿀지 묻고, 동의하면 같은 주소로 올라갑니다. 주소를 다시 즐겨찾기할 필요가 없습니다."),
  note("작성기는 본인 계정의 비공개 도구입니다. 공개 링크로 공유하지 않습니다. 기관 추가·수정과 선택 세트는 본인 작성기에만 저장됩니다."),
);

// ── 4 ──
add(
  H1("4. 화면 사용법"),
  P("화면 왼쪽은 작성 영역(사건 정보, 1~4 카드), 오른쪽은 신청서 미리보기, 제출 전 점검, 복사와 저장 버튼입니다. 좁은 화면(휴대폰)에서는 위쪽의 작성/미리보기 탭으로 전환합니다."),
  table([1500, 4172, 3400], ["단계", "입력 방법", "문서에 들어가는 곳"], [
    ["사건 정보", "사건번호(예: 2026드단12345), 사건명(예: 이혼 등), 원고 이름, 피고 이름을 입력하고 우리 측(원고 또는 피고)을 고릅니다.", "맨 위 사건·원고·피고 줄, 도입 문장의 \"피고 ○○○의 소송대리인은\""],
    ["1. 대상기관", "목록에서 체크합니다. 분류 탭, 기관명 검색(초성 가능, 예: ㄱㅁ), 전체 선택·해제가 있습니다. 선택한 순서대로 가, 나, 다 순번이 붙고 위/아래 이동과 제거(✕)가 됩니다.", "1. 대상기관의 명칭 및 주소(명칭 줄과 주소 줄)"],
    ["2. 명의인", "지위(원고·피고·제3자), 이름, 번호를 입력합니다. 번호는 숫자만 쳐도 하이픈이 들어갑니다. 13자리는 주민등록번호 또는 법인등록번호, 10자리는 사업자등록번호입니다. 명의인 추가로 여러 명을 넣습니다. 우리 측을 고르면 첫 명의인은 상대방으로 설정됩니다.", "2. 명의인의 인적사항, 5.의 조회 대상, 4.의 \"○고 명의의 재산\" 표기"],
    ["3. 거래기간", "달력 선택 또는 직접 입력을 고릅니다. 빠른 입력은 최근 3년, 5년, 10년, 종료일 오늘입니다. 종료일 기본값은 오늘입니다. 직접 입력은 2023.9.1, 2023-9-1처럼 점·하이픈·슬래시·공백으로 구분해도 됩니다.", "\"2023. 9. 1.부터 2026. 9. 1.까지\""],
    ["4. 사용목적", "이혼 재산분할은 고정 문구가 자동으로 들어갑니다. 그 밖의 사건은 직접 쓰고 다듬기를 쓸 수 있습니다.", "4. 사용목적"],
    ["5.가 호칭", "은행·금융기관용에만 적용됩니다. 자동, 귀 은행, 귀 기관, 귀 사 중에서 고릅니다. 자동은 선택한 기관이 모두 은행류이면 귀 은행, 하나라도 아니면 귀 기관입니다.", "5.가 첫 문장의 \"귀 ○○에\""],
    ["보험 기준일", "보험사용일 때만 나타납니다. 날짜를 고릅니다.", "보험사용 5.의 \"○○ 기준\", \"○○ 이후\", \"○○ 이전\""],
  ]),
  gap(),
  H2("4-1. 사용목적 다듬기"),
  P("그 밖의 사건을 고르고 초안을 쓴 뒤 다듬기를 누르면 다듬은 문장과 바꾼 점이 원문과 나란히 나옵니다. 적용을 눌러야 반영되고 취소하면 원문이 유지됩니다. Claude에는 초안과 사건명만 보내며, 이름·번호·사건번호는 보내지 않습니다(초안 안의 이름과 번호는 원고, 피고, (번호)로 바꿔 보냅니다). 초안에 없는 사실, 조문, 금액을 넣지 않도록 요청하지만 적용 전에 반드시 읽고 확인합니다."),
  H2("4-2. 미리보기, 복사, 저장"),
  P("미리보기는 실제 문서와 같은 모양입니다. 값을 아직 넣지 않은 곳은 「이름」처럼 자리표시로 보입니다. 소제목 옆의 복사 버튼은 그 항목의 본문만 복사하므로 전자소송 입력칸에 붙여 넣기 좋습니다. 전체 복사는 문서 전체를 복사합니다. DOCX로 저장은 파일로 저장합니다."),
  H2("4-3. 제출 전 점검과 저장 확인"),
  P("오른쪽 아래의 제출 전 점검에 비어 있는 필수 항목이 나옵니다. 항목을 누르면 해당 입력칸으로 이동합니다. 필수 항목이 비어 있는 채로 DOCX로 저장을 누르면 버튼이 \"미입력 N건 — 한 번 더 누르면 그대로 저장합니다\"로 바뀌고, 5초 안에 다시 누르면 저장됩니다. 초기화도 한 번 더 눌러야 실행되며, 사건·명의인·기간·사용목적 입력만 지우고 기관 목록과 선택 세트는 그대로 둡니다."),
);

// ── 5 ──
add(
  H1("5. 보험사용 신청서"),
  steps("ins", [
    "선택한 기관이 모두 보험사이면 자동으로 보험사용 문안이 됩니다.",
    "은행류와 보험사를 함께 선택하면 미리보기 위에 만들 신청서 전환(은행·금융기관용 N곳, 보험사용 N곳)이 나타납니다. 고른 종류의 기관만 1.에 들어가고, 복사와 DOCX 저장도 그 종류의 문서만 대상으로 합니다. 두 종류는 각각 따로 저장합니다(보험사용 파일명에는 _보험사가 붙습니다).",
    "보험 기준일을 입력합니다(예: 2026. 3. 20.). 5.의 \"…기준\", \"…이후\", \"…이전\"에 들어가며, 비어 있으면 필수 점검에 걸립니다.",
    "보험사용 5.는 \"귀 회사에 ○○○(주민등록번호: …) 명의로 가입된 보험계약 중…\"으로 시작해 1)~5), 3)의 가.~사. 항목으로 이어집니다. 명의인이 여럿이면 \"각 명의로\"로 씁니다. 전문은 부록 A에 있습니다.",
    "증권사, 카드사, 상호금융, 저축은행, 우체국은 은행·금융기관용 문안을 씁니다. 별도 문안이 필요하면 관리자에게 알려 주십시오.",
  ], 1),
);

// ── 6 ──
add(
  H1("6. 기관과 주소 관리"),
  P("기본 목록은 70곳입니다(시중·특수·지방은행 16, 우체국 1, 인터넷전문은행 3, 상호금융 5, 저축은행 11, 증권사 13, 보험사 13, 카드사 8). 주소는 " + ADDR_ASOF + " 기준 제공 목록이며 우편번호는 쓰지 않습니다. 자주 쓰는 곳이 분류 안에서 먼저 보입니다."),
  table([1900, 7172], ["기능", "사용 방법"], [
    ["주소 수정", "선택 목록의 주소 수정을 눌러 명칭, 도로명주소, 참고를 고치고 저장합니다. 고친 값은 목록에 남아 다음에도 쓰입니다."],
    ["기관 추가", "목록에 없는 기관은 기관 추가를 눌러 명칭, 도로명주소(번지·층까지, 괄호 제외), 참고(법정동·건물명, 선택), 분류를 입력하고 저장합니다. 추가 표시와 함께 목록에 남고 자동으로 선택됩니다. 검색 결과가 없을 때 나오는 추가 버튼으로도 열 수 있습니다. 보험사로 분류하면 보험사용 문안에 들어갑니다. 삭제는 ✕를 두 번 누릅니다."],
    ["선택 세트", "자주 쓰는 기관 조합입니다. 세트 이름을 입력하고 현재 선택 저장을 누르면 저장되고, 이름을 누르면 불러옵니다."],
    ["최신화", "작성기는 인터넷 검색을 할 수 없어 스스로 주소를 갱신하지 못합니다. 최신화 패널에서 요청문을 복사해 웹 검색이 되는 Claude에 붙여 넣고, 돌려받은 JSON을 붙여 넣어 변경 확인을 누르면 기존 값과 비교됩니다. 출처 URL이 없는 항목은 적용되지 않습니다. 급하지 않으면 관리자에게 요청하는 편이 안전합니다."],
    ["저장 위치", "상단 표시로 확인합니다. 공용 저장 연결은 본인 작성기의 저장소에 저장, 공용 저장 읽기 전용은 쓰기 권한이 없어 이 브라우저에만 저장, 이 브라우저에만 저장은 저장소를 쓸 수 없는 상태입니다."],
  ]),
  gap(),
);

// ── 7 ──
add(
  H1("7. 알아둘 점"),
  table([2000, 7072], ["항목", "내용"], [
    ["개인정보", "이름, 주민등록번호, 사건번호, 사건명은 어디에도 저장되지 않으며 새로고침하거나 탭을 닫으면 지워집니다. 작업 중에는 새로고침하지 않습니다. DOCX 파일에는 이름과 번호가 들어가므로 보관에 유의합니다."],
    ["주소", "제공 목록 기준이며 우편번호는 표기하지 않습니다. 제출 전에 확인이 필요한 곳은 주소 수정으로 고칩니다."],
    ["DOCX 서식", "A4, 바탕체 12pt, 줄간격 200%, 여백 위 30mm·아래 25mm·좌우 30mm입니다. 쪽 나눔을 따로 지정하지 않으므로 쪽 끝에서 소제목이나 주소 줄이 갈라지면 Word에서 직접 조정합니다."],
    ["문안", "은행·금융기관용은 제출해 오던 양식을, 보험사용은 지정된 문안을 그대로 쓴 것입니다. 법적 판단을 대신하지 않으며 제출 전에 담당 변호사의 검토를 받습니다."],
  ]),
  gap(),
);

// ── 8 ──
add(
  H1("8. 문제 해결"),
  table([2500, 2900, 3672], ["증상", "원인", "조치"], [
    ["설치할 때 게시가 되지 않습니다", "Code 탭이나 Claude Code가 아니거나, 게시 기능을 지원하지 않는 버전입니다.", "데스크톱 앱 최신 버전의 Code 탭에서 finorder-kit 폴더를 열고 다시 시도합니다. 거절 사유가 나오면 관리자에게 전달합니다."],
    ["DOCX로 저장을 눌러도 파일이 생기지 않습니다", "저장 허용 창을 거절했거나, DOCX 라이브러리를 인터넷에서 불러오지 못했습니다.", "허용 창에서 허용합니다. \"DOCX 라이브러리를 불러오지 못했습니다\" 문구가 보이면 인터넷 연결을 확인하고 새로고침합니다. 급하면 항목별 복사를 씁니다."],
    ["다듬기가 보이지 않거나 되지 않습니다", "다른 사람이 공유한 링크로 열었거나 Claude 사용을 허용하지 않았습니다.", "본인 계정에 설치한 주소로 열고 허용합니다."],
    ["입력한 내용이 사라졌습니다", "새로고침이나 탭 닫기입니다. 개인정보 보호를 위해 저장하지 않습니다.", "다시 입력합니다."],
    ["미리보기에 「이름」 같은 표시가 있습니다", "아직 입력하지 않은 항목의 자리표시입니다.", "제출 전 점검의 항목을 눌러 입력합니다."],
    ["기관 주소가 실제와 다릅니다", "기관 이전이나 제공 목록의 오류입니다.", "주소 수정으로 고치고 관리자에게 알립니다."],
  ]),
  gap(),
);

// ── 9 ──
add(
  H1("9. 관리자용"),
  H2("9-1. 키트 만들기와 주소 갱신"),
  steps("adm", [
    "원본 저장소의 finorder 폴더에서 새 주소 목록을 data/raw/user_list.json에 반영합니다.",
    "python3 finorder/merge_data.py 와 python3 finorder/build.py 를 실행합니다.",
    "시험(finorder/tests/run-all.sh, e2e.js, kit_e2e.js)을 모두 통과시킵니다.",
    "python3 finorder/make_kit.py 를 실행하면 kit/finorder-kit 폴더와 kit/finorder-kit.zip이 다시 만들어집니다.",
    "새 zip을 직원에게 배포하고, 직원은 \"신청서 작성기 업데이트해줘\"를 입력합니다.",
  ], 1),
  H2("9-2. 설치 방식에 대하여"),
  P("키트의 finorder.html은 DOCX 생성 라이브러리(docx 8.5.0)를 jsDelivr에서, 실패하면 unpkg에서 불러옵니다. 라이브러리를 내장하면 파일이 약 960KB가 되어 직원의 Claude Code가 게시 전에 읽어야 하는 양이 너무 커지기 때문입니다. 외부 CDN이 막힌 망에서는 source 폴더에서 python3 build.py 를 실행해 만들어지는 dist/finorder.html(라이브러리 내장본)을 게시합니다."),
  P("한 계정에 설치한 작성기를 공유 링크로 다른 직원에게 열어 줄 수도 있습니다. 다만 공유받은 직원은 다듬기를 쓸 수 없고, 기관 추가·수정은 편집 권한이 있어야 공용으로 저장됩니다. 직원마다 키트를 설치하는 방식을 권장합니다."),
);

// ── 부록 ──
add(
  H1("부록 A. 5. 요구하는 거래정보 등의 내용 문안"),
  P("○○○, 000000-0000000, 20○○. ○. ○.은 입력값이 들어가는 자리입니다."),
  H2("A-1. 은행·금융기관용"),
  new Paragraph({ spacing: { before: 0, after: 80, line: 320 }, indent: { left: 440, hanging: 440 }, children: [run("가.  귀 은행에 ○○○ (000000-0000000)을 명의자로 하는 계좌(예금, 적금, 보험, 연금, 신탁, 펀드, 외환거래, 대출 등 일체의 상품)가 개설되어 있는지(해지계좌 포함)", { size: 20 })] }),
  new Paragraph({ spacing: { before: 0, after: 80, line: 320 }, indent: { left: 440, hanging: 440 }, children: [run("나.  (있다면)", { size: 20 })] }),
  new Paragraph({ spacing: { before: 0, after: 80, line: 320 }, indent: { left: 880, hanging: 440 }, children: [run("1)  전 계좌목록, 계좌번호 전체, 상품명, 개설일 및 해지일", { size: 20 })] }),
  new Paragraph({ spacing: { before: 0, after: 80, line: 320 }, indent: { left: 880, hanging: 440 }, children: [run("2)  각 상품의 요구대상거래기간의 거래내역(송금 상대방, 상대방 계좌번호 및 은행 등 일체의 정보)을 회신하여 주시기 바랍니다(복수인 경우 각 계좌 모두).", { size: 20 })] }),
  new Paragraph({ spacing: { before: 0, after: 80, line: 320 }, indent: { left: 880, hanging: 440 }, children: [run("3)  위 각 항목은 PDF와 함께 XLSX 또는 CSV 형식의 전산자료로 제출하여 주시고, 거래코드의 설명과 통화·금액단위를 표시하여 주시기 바랍니다.", { size: 20 })] }),
  H2("A-2. 보험사용"),
  P([run("귀 회사에 ○○○(주민등록번호: 000000-0000000) 명의로 가입된 보험계약 중, 요구대상 거래기간 동안 유효하게 존속하였던 보험계약(해지·실효되었거나 만기가 도래한 계약을 포함합니다)에 관하여 아래 각 항목의 자료를 제출하여 주시기 바랍니다.", { size: 20 })], { spacing: { before: 0, after: 80, line: 320 } }),
  ...[
    ["1)", "보험·펀드·연금 등 가입내역 일체", 880, 440],
    ["", "(다만, 20○○. ○. ○. 이후 신규로 체결되거나 변경된 계약이 있는 경우에는 해당 계약의 체결일 또는 변경일을 함께 기재하여 주시기 바랍니다.)", 880, 0],
    ["2)", "20○○. ○. ○. 이전에 해지된 계약이 있는 경우, 해당 계약별 해지환급금의 지급내역 일체", 880, 440],
    ["3)", "20○○. ○. ○. 기준 계약별 다음 사항", 880, 440],
    ["가.", "보험의 종류", 1320, 440],
    ["나.", "증권번호", 1320, 440],
    ["다.", "계약자·피보험자·수익자", 1320, 440],
    ["라.", "계약일", 1320, 440],
    ["마.", "월 보험료", 1320, 440],
    ["바.", "계약상태", 1320, 440],
    ["사.", "해약환급금 및 그 산출근거", 1320, 440],
    ["4)", "보험계약대출의 실행 및 상환 내역, 20○○. ○. ○. 기준 대출잔액 및 위 3)항 기재 해약환급금에서 보험계약대출금이 이미 공제되어 있는지 여부", 880, 440],
    ["5)", "현재 시점의 해약환급금만을 제출하지 마시고, 20○○. ○. ○. 기준 해약환급금과 그 이후 현재까지의 변동내역을 구분하여 제출하여 주시기 바랍니다. 또한 각 항목별로 해당 사항이 없는 경우에는 “해당 없음”, 자료를 보유하고 있지 않은 경우에는 “자료 미보유”, 조회가 불가능한 경우에는 “조회 불가”라고 구분하여 회신하여 주시기 바랍니다.", 880, 440],
  ].map(([mk, t, left, hang]) => new Paragraph({ spacing: { before: 0, after: 60, line: 320 }, indent: { left, hanging: hang }, children: [run(mk ? mk + "  " + t : t, { size: 20 })] })),
);

const doc = new Document({
  creator: "금융거래정보 제출명령 작성기",
  title: "금융거래정보 제출명령 작성기 사용설명서",
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 28, bold: true }, paragraph: { spacing: { before: 360, after: 160 }, outlineLevel: 0 } },
      { id: "Heading2", name: "heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 100 }, outlineLevel: 1 } },
    ],
  },
  numbering: { config: [num("inst"), num("ins"), num("adm")] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1417, bottom: 1417, left: 1417, right: 1417 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("- ", { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 }), run(" -", { size: 18 })] })] }) },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log("저장:", OUT, buf.length, "bytes");
});
