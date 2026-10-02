/* 순수 함수 단위 테스트(node). 사용: node tests/unit.test.js
 * 가상 값(홍길동, 김영희, 2026드단12345)만 쓴다. DOM이 없어도 app.js가 로드되는지도 함께 본다. */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const F = require("../src/app.js");
let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(name + "\n    " + String(e && e.message ? e.message : e).split("\n").join("\n    ")); }
}
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);

/* 시험용 기관 */
const KOOKMIN = { id: "kookmin", short: "국민은행", name: "주식회사 국민은행", wording: "은행", zip: "07331", addr: "서울특별시 영등포구 국제금융로8길 26", note: "여의도동" };
const KAKAO = { id: "kakao", short: "카카오뱅크", name: "주식회사 카카오뱅크", wording: "은행", zip: "13529", addr: "경기도 성남시 분당구 분당내곡로 131, 11층", note: "백현동, 판교테크원" };
const SECURITIES = { id: "sec", short: "가상증권", name: "가상증권 주식회사", wording: "기관", zip: "12345", addr: "서울특별시 중구 가상로 1", note: "" };

function baseState(over) {
  return Object.assign(
    {
      caseNo: "2026드단12345", caseName: "이혼 등", plaintiff: "홍길동", defendant: "김영희", ours: "plaintiff",
      selected: [KOOKMIN, KAKAO],
      holders: [{ role: "defendant", name: "김영희", no: "9001012345678" }],
      period: { start: "2023-09-01", end: "2026-09-01" },
      purpose: { type: "divorce", text: "" },
      wording: "auto",
    },
    over || {}
  );
}
const textOf = (state) => F.blocksToText(F.composeDoc(state));

/* ---------------- 번호 서식 ---------------- */
test("formatNo: 13자리는 ######-#######", () => {
  eq(F.formatNo("9001012345678"), "900101-2345678");
  eq(F.formatNo("900101-2345678"), "900101-2345678");
  eq(F.formatNo(" 900101 2345678 "), "900101-2345678");
});
test("formatNo: 10자리는 ###-##-#####", () => {
  eq(F.formatNo("1234567890"), "123-45-67890");
  eq(F.formatNo("123-45-67890"), "123-45-67890");
});
test("formatNo: 그 외는 입력 그대로", () => {
  eq(F.formatNo("12345"), "12345");
  eq(F.formatNo("12345678901"), "12345678901");
  eq(F.formatNo("AB-1234567890123"), "AB-1234567890123");
  eq(F.formatNo(""), "");
  eq(F.formatNo(null), "");
});
test("formatNoLive: 입력 중 자동 하이픈", () => {
  eq(F.formatNoLive("123456"), "123456");
  eq(F.formatNoLive("1234567"), "123456-7");
  eq(F.formatNoLive("1234567890123"), "123456-1234567".replace("123456-1234567", "123456-7890123"));
  eq(F.formatNoLive("1234567890"), "123456-7890"); // 10자리는 주민번호 입력 중일 수 있어 6-4 유지
  eq(F.formatNoLive("123-4"), "123-4");
  eq(F.formatNoLive("123-45-67890"), "123-45-67890");
  eq(F.formatNoLive("1234567890123999"), "123456-7890123"); // 13자리까지만
  eq(F.formatNoLive("ABC123"), "ABC123"); // 글자가 섞이면 그대로
});
test("noLengthOk: 13 또는 10자리만 통과", () => {
  assert(F.noLengthOk("900101-2345678"));
  assert(F.noLengthOk("123-45-67890"));
  assert(!F.noLengthOk("12345"));
  assert(!F.noLengthOk("12345678901"));
});

/* ---------------- 조사 ---------------- */
test("josaEulReul: 받침 있으면 을, 없으면 를, 한글 아니면 을", () => {
  eq(F.josaEulReul("홍길동"), "을");
  eq(F.josaEulReul("김영희"), "를");
  eq(F.josaEulReul("이수"), "를");
  eq(F.josaEulReul("박철"), "을");
  eq(F.josaEulReul("John"), "을");
  eq(F.josaEulReul(""), "을");
  eq(F.josaEulReul(null), "을");
  eq(F.josaEulReul(" 김영희 "), "를");
});

/* ---------------- 가나다 순번 ---------------- */
test("hangulLetter: 28개 순번과 29번째 이후", () => {
  const exp = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하", "거", "너", "더", "러", "머", "버", "서", "어", "저", "처", "커", "터", "퍼", "허"];
  eq(exp.length, 28);
  exp.forEach((l, i) => eq(F.hangulLetter(i + 1), l));
  eq(F.hangulLetter(29), "(29)");
  eq(F.hangulLetter(30), "(30)");
  eq(F.hangulLetter(100), "(100)");
  eq(F.hangulLetter(0), "");
  eq(F.instMarker(1), "가.");
  eq(F.instMarker(28), "허.");
  eq(F.instMarker(29), "(29)");
});
test("composeDoc: 기관 29곳이면 29번째는 (29) 표기", () => {
  const many = [];
  for (let i = 1; i <= 30; i++) many.push({ id: "x" + i, name: "가상기관 " + i, zip: "12345", addr: "가상시 가상로 " + i, note: "", wording: "은행" });
  const doc = F.composeDoc(baseState({ selected: many }));
  const insts = doc.filter((b) => b.k === "inst");
  eq(insts.length, 30);
  eq(insts[0].letter, "가");
  eq(insts[27].letter, "허");
  eq(insts[28].letter, "(29)");
  eq(insts[28].marker, "(29)");
  assert(F.blocksToText(doc).includes("\n(29) 가상기관 29\n"));
});

/* ---------------- 날짜 ---------------- */
test("formatDateKR: 월·일 앞자리 0 없음", () => {
  eq(F.formatDateKR("2023-09-01"), "2023. 9. 1.");
  eq(F.formatDateKR("2026-12-31"), "2026. 12. 31.");
  eq(F.formatDateKR(""), "");
  eq(F.formatDateKR("2023-02-30"), "");
  eq(F.formatDateKR("2023-9-1"), "");
});
test("parsePeriodText: 구분자 . - / 공백 허용", () => {
  eq(F.parsePeriodText("2023.9.1"), "2023-09-01");
  eq(F.parsePeriodText("2023. 9. 1."), "2023-09-01");
  eq(F.parsePeriodText("2023-09-01"), "2023-09-01");
  eq(F.parsePeriodText("2023/9/1"), "2023-09-01");
  eq(F.parsePeriodText(" 2023 . 09 . 01 "), "2023-09-01");
  eq(F.parsePeriodText("2023.9.1."), "2023-09-01");
  eq(F.parsePeriodText("20230901"), "2023-09-01");
  eq(F.parsePeriodText("2023년 9월 1일"), "2023-09-01");
  eq(F.parsePeriodText("2024.2.29"), "2024-02-29");
});
test("parsePeriodText: 실패는 null", () => {
  eq(F.parsePeriodText(""), null);
  eq(F.parsePeriodText("23.9.1"), null);
  eq(F.parsePeriodText("2023.13.1"), null);
  eq(F.parsePeriodText("2023.2.30"), null);
  eq(F.parsePeriodText("2023.9"), null);
  eq(F.parsePeriodText("abc"), null);
  eq(F.parsePeriodText("2023.9.1부터"), null);
});
test("addYearsISO·todayISO", () => {
  eq(F.addYearsISO("2026-10-02", -3), "2023-10-02");
  eq(F.addYearsISO("2026-10-02", -10), "2016-10-02");
  eq(F.addYearsISO("2024-02-29", -1), "2023-02-28");
  eq(F.todayISO(new Date(2026, 9, 2)), "2026-10-02");
  eq(F.todayISO(new Date(2026, 0, 5)), "2026-01-05");
});
test("makeFilename: 금지 문자는 _, 이름·번호 없음, 비면 날짜", () => {
  eq(F.makeFilename({ caseNo: "2026드단12345" }), "금융거래정보제출명령신청서_2026드단12345.docx");
  eq(F.makeFilename({ caseNo: "2026/드단:12345?" }), "금융거래정보제출명령신청서_2026_드단_12345_.docx");
  eq(F.makeFilename({ caseNo: "" }, new Date(2026, 9, 2)), "금융거래정보제출명령신청서_20261002.docx");
  eq(F.makeFilename({ caseNo: "  " }, new Date(2026, 9, 2)), "금융거래정보제출명령신청서_20261002.docx");
});

/* ---------------- 검색 ---------------- */
test("searchMatch: 부분 일치·별칭·초성", () => {
  const k = Object.assign({ aliases: ["KB국민은행", "KB", "국민"] }, KOOKMIN);
  assert(F.searchMatch(k, "국민"));
  assert(F.searchMatch(k, "kb"));
  assert(F.searchMatch(k, "KB"));
  assert(F.searchMatch(k, "ㄱㅁ"));
  assert(F.searchMatch(k, "ㄱㅁㅇㅎ"));
  assert(F.searchMatch(k, "국ㅁ"));
  assert(F.searchMatch(k, "주식회사 국민"));
  assert(F.searchMatch(k, ""));
  assert(!F.searchMatch(k, "신한"));
  assert(!F.searchMatch(k, "ㅍㅌ"));
  assert(F.searchMatch(k, "ㅅㅎ")); // 정식명 '주식회사'의 초성에도 걸린다
  eq(F.toChosung("국민은행 KB"), "ㄱㅁㅇㅎ KB");
});

/* ---------------- 호칭 ---------------- */
test("resolveWording: 자동은 모두 은행일 때만 귀 은행", () => {
  eq(F.resolveWording("auto", [KOOKMIN, KAKAO]), "은행");
  eq(F.resolveWording("auto", [KOOKMIN, SECURITIES]), "기관");
  eq(F.resolveWording("auto", []), "은행");
  eq(F.resolveWording("기관", [KOOKMIN]), "기관");
  eq(F.resolveWording("사", [KOOKMIN]), "사");
  eq(F.resolveWording("은행", [SECURITIES]), "은행");
  eq(F.resolveWording("", [SECURITIES]), "기관");
});
test("5.가 호칭이 문서에 반영", () => {
  assert(textOf(baseState()).includes("가. 귀 은행에 "));
  assert(textOf(baseState({ selected: [KOOKMIN, SECURITIES] })).includes("가. 귀 기관에 "));
  assert(textOf(baseState({ wording: "사" })).includes("가. 귀 사에 "));
});

/* ---------------- 사용목적 ---------------- */
function purposeLine(state) {
  const doc = F.composeDoc(state);
  return doc.find((b) => b.k === "p" && b.sec === 4).text;
}
test("고정 사용목적: 명의인 지위 조합", () => {
  const tail = " 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.";
  const h = (role, name) => ({ role, name: name || "", no: "9001012345678" });
  eq(purposeLine(baseState({ holders: [h("plaintiff", "홍길동")] })), "원고" + tail);
  eq(purposeLine(baseState({ holders: [h("defendant", "김영희")] })), "피고" + tail);
  eq(purposeLine(baseState({ holders: [h("plaintiff", "홍길동"), h("defendant", "김영희")] })), "원고 및 피고" + tail);
  eq(purposeLine(baseState({ holders: [h("defendant", "김영희"), h("plaintiff", "홍길동")] })), "피고 및 원고" + tail); // 입력 순서
  eq(purposeLine(baseState({ holders: [h("defendant", "김영희"), h("defendant", "김영희")] })), "피고" + tail); // 중복 제거
  eq(purposeLine(baseState({ holders: [h("third", "박철수")] })), "박철수" + tail);
  eq(purposeLine(baseState({ holders: [h("plaintiff", "홍길동"), h("third", "박철수"), h("third", "박철수")] })), "원고 및 박철수" + tail);
  eq(purposeLine(baseState({ holders: [h("third", "")] })), "「이름」" + tail);
});
test("그 밖의 사건 사용목적: 직원 문장, 비면 자리표시", () => {
  eq(purposeLine(baseState({ purpose: { type: "other", text: " 피고 명의의  부동산 매각대금의 사용처를 확인하기 위함입니다. " } })), "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  eq(purposeLine(baseState({ purpose: { type: "other", text: "" } })), "「사용목적」");
});

/* ---------------- 5.가 명의인 문장 ---------------- */
const L1_TAIL = "하는 계좌(예금, 적금, 보험, 연금, 신탁, 펀드, 외환거래, 대출 등 일체의 상품)가 개설되어 있는지(해지계좌 포함)";
function l1a(state) {
  return F.composeDoc(state).find((b) => b.k === "l1" && b.marker === "가.").text;
}
test("5.가: 명의인 1명은 을/를 명의자로 하는", () => {
  eq(l1a(baseState({ holders: [{ role: "defendant", name: "홍길동", no: "9001012345678" }] })), "귀 은행에 홍길동 (900101-2345678)을 명의자로 " + L1_TAIL);
  eq(l1a(baseState({ holders: [{ role: "defendant", name: "김영희", no: "9001012345678" }] })), "귀 은행에 김영희 (900101-2345678)를 명의자로 " + L1_TAIL);
});
test("5.가: 복수 명의인은 A (번호), B (번호)을/를 각 명의자로 하는, 조사는 마지막 이름 기준", () => {
  const hs = [{ role: "plaintiff", name: "홍길동", no: "9001012345678" }, { role: "defendant", name: "김영희", no: "9205052345678" }];
  eq(l1a(baseState({ holders: hs })), "귀 은행에 홍길동 (900101-2345678), 김영희 (920505-2345678)를 각 명의자로 " + L1_TAIL);
  eq(l1a(baseState({ holders: hs.slice().reverse() })), "귀 은행에 김영희 (920505-2345678), 홍길동 (900101-2345678)을 각 명의자로 " + L1_TAIL);
  const three = hs.concat([{ role: "third", name: "박철순", no: "123-45-67890" }]);
  eq(l1a(baseState({ holders: three })), "귀 은행에 홍길동 (900101-2345678), 김영희 (920505-2345678), 박철순 (123-45-67890)을 각 명의자로 " + L1_TAIL);
  eq(l1a(baseState({ holders: hs.concat([{ role: "third", name: "박철수", no: "123-45-67890" }]) })).includes("박철수 (123-45-67890)를 각 명의자로"), true);
});
test("5.가: 이름이 한글이 아니면 을", () => {
  eq(l1a(baseState({ holders: [{ role: "third", name: "John Smith", no: "9001012345678" }] })).includes("(900101-2345678)을 명의자로"), true);
});

/* ---------------- 문서 문안: SPEC 2장 코드 블록과 대조 ---------------- */
test("SPEC 2장 문안과 composeDoc 출력 일치(줄 단위 패턴)", () => {
  const spec = fs.readFileSync(path.join(__dirname, "..", "SPEC.md"), "utf8");
  const sec = spec.split("## 2. 출력 문서")[1];
  const code = sec.split("```")[1].replace(/^\n/, "").split("\n");
  // 주석 제거, 들여쓰기 제거, 기관 반복부 전개
  while (code.length && code[code.length - 1].trim() === "") code.pop();
  const tpl = [];
  code.forEach((raw) => {
    if (raw.trim() === "...") return;
    let l = raw.replace(/\s{3,}\((가운데|굵게|명의인마다|월·일)[^)]*\)\s*$/, "").trim();
    if (!F.consts.UNDERLINE_BRACKETS) l = l.replace("[요구대상거래기간의 거래내역]", "요구대상거래기간의 거래내역");
    tpl.push(l);
    if (l === "나. {기관 명칭}") tpl.push("({우편번호}) {도로명주소} ({참고})");
  });
  const doc = F.blocksToText(F.composeDoc(baseState({ holders: [{ role: "defendant", name: "홍길동", no: "9001012345678" }] }))).split("\n").map((s) => s.replace(/^\s+/, ""));
  // 사건 줄의 라벨과 값 사이 공백은 문서 모델에서 4칸. 패턴에서 공백 연속은 \s+ 로 느슨하게 본다.
  let di = 0;
  const reqs = [];
  tpl.forEach((t, ti) => {
    if (t === "") { assert.strictEqual(doc[di], "", "빈 줄 위치 불일치 (SPEC 줄 " + ti + ") 실제: " + JSON.stringify(doc[di])); di++; return; }
    const re = new RegExp("^" + t.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+").replace(/\{[^}]+\}/g, "(.*)") + "$");
    assert(re.test(doc[di]), "SPEC 줄 " + ti + " 불일치\n  SPEC: " + t + "\n  실제: " + doc[di]);
    di++;
    reqs.push(t);
  });
  eq(di, doc.length, "SPEC에 없는 줄이 문서에 더 있음: " + JSON.stringify(doc.slice(di)));
  assert(reqs.length > 20);
});
test("SPEC의 공백 개수까지 엄격 비교: 다 음(6칸), 사건·원고·피고 라벨(4칸)", () => {
  const spec = fs.readFileSync(path.join(__dirname, "..", "SPEC.md"), "utf8");
  const next = /\{k:"next", text:"([^"]+)"\}/.exec(spec)[1];
  const doc = F.composeDoc(baseState());
  eq(doc.find((b) => b.k === "next").text, next);
  const code = spec.split("## 2. 출력 문서")[1].split("```")[1];
  ["사    건", "원    고", "피    고"].forEach((lab, i) => {
    assert(code.includes(lab + "    {"), "SPEC 라벨 표기 확인 실패: " + lab);
    eq(doc.filter((b) => b.k === "case")[i].label, lab);
  });
});
test("문서 끝은 5.의 3) 줄(날짜·대리인·법원 귀중 없음)", () => {
  const t = textOf(baseState());
  const lines = t.split("\n");
  assert(lines[lines.length - 1].startsWith("3) 위 각 항목은 PDF와 함께"));
  ["소송대리인\n", "법원", "귀중", "변호사", "법률사무소", "2026. 9."].forEach((w) => {
    // 도입 문단의 '소송대리인은'은 허용
    const body = t.replace("소송대리인은", "");
    assert(!body.includes(w.trim()) || w === "2026. 9.", "문서에 금지 문구: " + w);
  });
});
test("밑줄은 [요구대상거래기간의 거래내역] 한 구간만", () => {
  const doc = F.composeDoc(baseState());
  const us = [];
  doc.forEach((b) => (b.runs || []).forEach((r) => { if (r.u) us.push(r.t); }));
  eq(us.length, 1);
  eq(us[0], (F.consts.UNDERLINE_BRACKETS ? "[" : "") + "요구대상거래기간의 거래내역" + (F.consts.UNDERLINE_BRACKETS ? "]" : ""));
});
test("블록 모델 필드: title/case/intro/next/h/inst/holder/p/l1/l2", () => {
  const doc = F.composeDoc(baseState());
  eq(doc[0], { k: "title", text: "금융거래정보 제출명령 신청서" });
  eq(doc[1].k, "case"); eq(doc[1].label, "사    건"); eq(doc[1].value, "2026드단12345 이혼 등");
  eq(doc[2].label, "원    고"); eq(doc[2].value, "홍길동");
  eq(doc[3].label, "피    고"); eq(doc[3].value, "김영희");
  eq(doc[4].k, "intro");
  eq(doc[4].text, "위 사건에 관하여 원고 홍길동의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다.");
  eq(doc[5], { k: "next", text: "다      음" });
  eq(doc[6], { k: "h", sec: 1, text: "1. 대상기관의 명칭 및 주소" });
  eq(doc[7].k, "inst"); eq(doc[7].letter, "가"); eq(doc[7].name, "주식회사 국민은행");
  eq(doc[7].addr, "(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)");
  eq(doc[8].addr, "(13529) 경기도 성남시 분당구 분당내곡로 131, 11층 (백현동, 판교테크원)");
  const l2 = doc.filter((b) => b.k === "l2");
  eq(l2.map((b) => b.marker), ["1)", "2)", "3)"]);
  eq(doc.filter((b) => b.k === "l1").map((b) => b.marker), ["가.", "나."]);
});
test("주소 조립: 참고 없으면 괄호 없음, 끝에 마침표 없음", () => {
  const doc = F.composeDoc(baseState({ selected: [SECURITIES] }));
  eq(doc.find((b) => b.k === "inst").addr, "(12345) 서울특별시 중구 가상로 1");
});
test("미입력은 자리표시로 표시(blank 플래그)", () => {
  const doc = F.composeDoc({ selected: [], holders: [{ role: "third", name: "", no: "" }], period: {}, purpose: { type: "divorce" } });
  const t = F.blocksToText(doc);
  assert(t.includes("「사건번호」 「사건명」"));
  assert(t.includes("위 사건에 관하여 「우리 측 지위」 「우리 측 이름」의 소송대리인은"));
  assert(t.includes("가. 「대상기관」"));
  assert(t.includes("「이름」 (「주민등록번호」)"));
  assert(t.includes("「시작일」부터 「종료일」까지"));
  const caseBlk = doc[1];
  assert(caseBlk.runs.some((r) => r.blank));
});
test("도입 문단은 우리 측 선택에 따라 원고/피고", () => {
  assert(textOf(baseState({ ours: "defendant" })).includes("위 사건에 관하여 피고 김영희의 소송대리인은"));
});
test("composeDoc: catalog + id로도 동작", () => {
  const t = F.blocksToText(F.composeDoc(baseState({ selected: ["kookmin"], catalog: { kookmin: KOOKMIN } })));
  assert(t.includes("가. 주식회사 국민은행\n(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)"));
});

/* ---------------- 텍스트 복사 ---------------- */
test("sectionText: 소제목 줄 없이 본문만(기본), 옵션으로 포함", () => {
  const blocks = F.composeDoc(baseState());
  eq(F.sectionText(blocks, 3), "2023. 9. 1.부터 2026. 9. 1.까지");
  eq(F.sectionText(blocks, 3, { heading: true }), "3. 요구대상 거래기간\n2023. 9. 1.부터 2026. 9. 1.까지");
  eq(F.sectionText(blocks, 1), "가. 주식회사 국민은행\n(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)\n나. 주식회사 카카오뱅크\n(13529) 경기도 성남시 분당구 분당내곡로 131, 11층 (백현동, 판교테크원)");
  eq(F.sectionText(blocks, 2), "김영희 (900101-2345678)");
  assert(F.sectionText(blocks, 5).split("\n").length === 5);
  assert(F.sectionText(blocks, 5).startsWith("가. 귀 은행에 "));
});
test("blocksToText: 제목·사건·도입·다음 뒤에만 빈 줄", () => {
  const lines = textOf(baseState()).split("\n");
  eq(lines[0], "금융거래정보 제출명령 신청서");
  eq(lines[1], "");
  eq(lines[2], "사    건    2026드단12345 이혼 등");
  eq(lines[3], "원    고    홍길동");
  eq(lines[4], "피    고    김영희");
  eq(lines[5], "");
  eq(lines[7], "");
  eq(lines[8], "다      음");
  eq(lines[9], "");
  eq(lines[10], "1. 대상기관의 명칭 및 주소");
});
test("마크다운 강조·HTML 태그 문자열이 문서에 없음", () => {
  const t = textOf(baseState());
  assert(!/\*\*|<\/?[a-z]+[ >]|__/.test(t));
});

/* ---------------- 점검 ---------------- */
test("computeMissing: 빈 상태", () => {
  const s = F.newState("2026-10-02");
  const m = F.computeMissing(s).map((x) => x.msg);
  assert(m.includes("사건번호 미입력"));
  assert(m.includes("사건명 미입력"));
  assert(m.includes("원고 이름 미입력"));
  assert(m.includes("피고 이름 미입력"));
  assert(m.includes("우리 측(원고 또는 피고) 선택 필요"));
  assert(m.includes("대상기관 1곳 이상 선택 필요"));
  assert(m.includes("명의인 이름 미입력"));
  assert(m.includes("명의인 주민등록번호 미입력"));
  assert(m.includes("거래기간 시작일 미입력"));
  assert(!m.includes("거래기간 종료일 미입력")); // 종료일 기본값은 오늘
  assert(!m.some((x) => x.includes("사용목적"))); // 이혼 재산분할은 고정 문구
});
test("computeMissing: 완성 상태는 0건", () => {
  eq(F.computeMissing(baseState()), []);
});
test("computeMissing: 자릿수 이상, 시작>종료, 주소 누락, 기타 사용목적", () => {
  const s = baseState({
    holders: [{ role: "defendant", name: "김영희", no: "12345" }, { role: "plaintiff", name: "홍길동", no: "" }],
    period: { start: "2026-09-02", end: "2026-09-01" },
    selected: [{ id: "nc", short: "미확인은행", name: "미확인은행", wording: "은행", zip: "", addr: "" }],
    purpose: { type: "other", text: "  " },
  });
  const m = F.computeMissing(s);
  const msgs = m.map((x) => x.msg);
  assert(msgs.includes("명의인 1 번호 자릿수 확인(13자리 또는 10자리)"));
  assert(msgs.includes("명의인 2 주민등록번호 미입력"));
  assert(msgs.includes("거래기간 시작일이 종료일보다 늦음"));
  assert(msgs.includes("미확인은행 주소 미입력"));
  assert(msgs.includes("사용목적 미입력"));
  eq(m.find((x) => x.msg.includes("자릿수")).sev, "warn");
  eq(m.find((x) => x.msg.includes("시작일이 종료일")).sev, "req");
});
test("computeMissing: 직접 입력 형식 오류", () => {
  const s = baseState({ perErr: { start: true, end: false }, period: { start: "", end: "2026-09-01" }, perMode: "text" });
  const m = F.computeMissing(s).map((x) => x.msg);
  assert(m.includes("거래기간 시작일 형식 오류"));
});

/* ---------------- 기관 병합 ---------------- */
test("mergeInstitutions: override 덮기, custom 뒤에 붙이기, 미지의 override 무시", () => {
  const cats = [{ id: "bank", label: "은행" }, { id: "post", label: "우체국" }];
  const builtin = [
    { id: "a", cat: "bank", short: "가은행", name: "주식회사 가은행", wording: "은행", zip: "", addr: "", note: "", status: "needs_check" },
    { id: "b", cat: "bank", short: "나은행", name: "주식회사 나은행", wording: "은행", zip: "11111", addr: "가상로 1", note: "가동", status: "user_provided" },
  ];
  const docs = [
    { id: "a", origin: "override", name: "주식회사 가상은행", zip: "22222", addr: "가상시 가상로 2", note: "", status: "user_provided", updatedAt: "2026-10-02T00:00:00Z" },
    { id: "zz", origin: "override", zip: "99999", addr: "무시" },
    { id: "c-1", origin: "custom", cat: "post", short: "추가기관", name: "추가기관", wording: "기관", zip: "33333", addr: "추가로 3", note: "", status: "user_provided", createdAt: "2026-10-02T01:00:00Z" },
    { id: "b", origin: "custom", short: "충돌", name: "충돌", zip: "1", addr: "x" }, // 내장 id와 충돌하는 custom은 무시
  ];
  const m = F.mergeInstitutions(builtin, docs, cats);
  eq(m.map((i) => i.id), ["a", "b", "c-1"]);
  eq(m[0].origin, "override"); eq(m[0].name, "주식회사 가상은행"); eq(m[0].zip, "22222"); eq(m[0].status, "user_provided"); eq(m[0].short, "가은행");
  eq(m[1].origin, "builtin");
  eq(m[2].origin, "custom"); eq(m[2].cat, "post");
  assert(F.isReady(m[0]) && F.isReady(m[1]) && F.isReady(m[2]));
});
test("splitAddrNote: 끝 괄호를 참고로 분리", () => {
  eq(F.splitAddrNote("서울특별시 중구 통일로 120(충정로1가)"), { addr: "서울특별시 중구 통일로 120", note: "충정로1가" });
  eq(F.splitAddrNote("경기도 성남시 분당구 분당내곡로 131, 11층(백현동, 판교테크원)"), { addr: "경기도 성남시 분당구 분당내곡로 131, 11층", note: "백현동, 판교테크원" });
  eq(F.splitAddrNote("서울특별시 중구 소공로 51"), { addr: "서울특별시 중구 소공로 51", note: "" });
  eq(F.splitAddrNote("(가) 서울 나로 1 (다)"), { addr: "(가) 서울 나로 1", note: "다" });
});

test("isReady: needs_check는 주소가 있어도 확인 전에는 준비되지 않음", () => {
  const base = { zip: "12345", addr: "가상시 가상로 1" };
  assert(F.isReady(Object.assign({ status: "user_provided" }, base)));
  assert(F.isReady(Object.assign({ status: "verified" }, base)));
  assert(!F.isReady(Object.assign({ status: "needs_check" }, base)));
  assert(!F.isReady({ status: "user_provided", zip: "", addr: "" }));
  assert(!F.isReady({ status: "user_provided", zip: "1234", addr: "가" }));
  assert(F.hasAddr(base) && !F.hasAddr({ zip: "12345", addr: "" }));
  const m = F.computeMissing(baseState({ selected: [Object.assign({ id: "nc", short: "확인은행", name: "확인은행", wording: "은행", status: "needs_check" }, base)] })).map((x) => x.msg);
  assert(m.includes("확인은행 주소 확인 필요(확인 후 저장)"), m.join("|"));
});

/* ---------------- 최신화 JSON ---------------- */
const ctx = {
  byId: { kookmin: Object.assign({ aliases: [], status: "user_provided", origin: "builtin" }, KOOKMIN), nc: { id: "nc", short: "미확인은행", name: "미확인은행", zip: "", addr: "", note: "", status: "needs_check", origin: "builtin" } },
  byNorm: { 국민은행: KOOKMIN },
  catIds: ["bank", "post"],
  today: "2026-10-02",
};
const SRC2 = [{ label: "공식 홈페이지", url: "https://www.example-bank.test/a" }, { label: "전자공시", url: "https://dart.example.test/b" }];
test("parseUpdateJson: 코드 펜스·앞뒤 설명·객체 래핑 허용", () => {
  eq(F.parseUpdateJson('```json\n[{"id":"a"}]\n```').ok, true);
  eq(F.parseUpdateJson('결과입니다.\n[{"id":"a"}]\n끝').items.length, 1);
  eq(F.parseUpdateJson('{"institutions":[{"id":"a"},{"id":"b"}]}').items.length, 2);
  eq(F.parseUpdateJson('{"id":"a"}').items.length, 1);
  eq(F.parseUpdateJson("뭔가 잘못된 글").ok, false);
  eq(F.parseUpdateJson("[]").ok, false);
  eq(F.parseUpdateJson("").ok, false);
});
test("classifyUpdate: 변경·동일·신규·오류", () => {
  const changed = F.classifyUpdate({ id: "kookmin", zip: "07332", addr: "서울특별시 영등포구 국제금융로8길 27", note: "여의도동", status: "verified", sources: SRC2, checkedAt: "2026-10-02" }, ctx);
  eq(changed.kind, "changed"); eq(changed.next.status, "verified");
  const same = F.classifyUpdate({ id: "kookmin", zip: "07331", addr: "서울특별시 영등포구 국제금융로8길 26", note: "(여의도동)", sources: SRC2 }, ctx);
  eq(same.kind, "same"); // 참고 바깥 괄호는 벗긴다
  const fill = F.classifyUpdate({ id: "nc", zip: "12345", addr: "가상시 가상로 9", note: "", status: "verified", sources: [SRC2[0]] }, ctx);
  eq(fill.kind, "changed"); eq(fill.next.status, "needs_check"); // 독립 출처 2곳 미만이면 verified 불가
  const sameHost = F.classifyUpdate({ id: "nc", zip: "12345", addr: "가상시 가상로 9", status: "verified", sources: [SRC2[0], { label: "같은 사이트", url: "https://example-bank.test/z" }] }, ctx);
  eq(sameHost.next.status, "needs_check"); // www 제거 후 같은 호스트면 독립 출처 1곳
  const neo = F.classifyUpdate({ id: "newbank", name: "신규은행", cat: "bank", zip: "54321", addr: "가상시 신규로 1", sources: SRC2 }, ctx);
  eq(neo.kind, "new"); eq(neo.next.wording, "기관");
  const noSrc = F.classifyUpdate({ id: "kookmin", zip: "07331", addr: "x", sources: [] }, ctx);
  eq(noSrc.kind, "invalid"); assert(noSrc.reasons.includes("출처 URL 없음"));
  const noUrl = F.classifyUpdate({ id: "kookmin", zip: "07331", addr: "x", sources: [{ label: "양식", url: "" }] }, ctx);
  eq(noUrl.kind, "invalid");
  const badZip = F.classifyUpdate({ id: "kookmin", zip: "7331", addr: "x", sources: SRC2 }, ctx);
  eq(badZip.kind, "invalid");
  const numZip = F.classifyUpdate({ id: "kookmin", zip: 7331, addr: "x", sources: SRC2 }, ctx);
  eq(numZip.kind, "invalid");
  const blank = F.classifyUpdate({ id: "kookmin", zip: "", addr: "", sources: SRC2 }, ctx);
  eq(blank.kind, "invalid"); // 확인 못 해 비운 항목이 기존 주소를 지우지 못한다
  const paren = F.classifyUpdate({ id: "kookmin", zip: "07331", addr: "서울 로 1(여의도동)", sources: SRC2 }, ctx);
  eq(paren.kind, "invalid");
  const noName = F.classifyUpdate({ id: "newbank", zip: "54321", addr: "가", sources: SRC2 }, ctx);
  eq(noName.kind, "invalid");
  const dupName = F.classifyUpdate({ id: "newbank", name: "주식회사 국민은행", cat: "bank", zip: "54321", addr: "가", sources: SRC2 }, ctx);
  eq(dupName.kind, "invalid");
  const badId = F.classifyUpdate({ id: "Bad Id", zip: "54321", addr: "가", sources: SRC2 }, ctx);
  eq(badId.kind, "invalid");
  eq(F.classifyUpdate(null, ctx).kind, "invalid");
});
test("buildUpdateRequest: 규칙·스키마·현재 목록 포함", () => {
  const t = F.buildUpdateRequest([Object.assign({ id: "kookmin" }, KOOKMIN)], "2026-10-02");
  ["웹 검색", "독립", "2곳", "sources", "출처", "\"id\": \"kookmin\"", "07331", "needs_check", "기억에 의존하지"].forEach((w) => assert(t.includes(w), "요청문에 없음: " + w));
});

/* ---------------- 다듬기 보조 ---------------- */
test("scrubText: 이름·번호·사건번호를 보내지 않는다", () => {
  const st = baseState({ holders: [{ role: "defendant", name: "김영희", no: "9001012345678" }, { role: "third", name: "박철수", no: "" }] });
  const out = F.scrubText("홍길동은 김영희 및 박철수 명의의 계좌를 확인한다. 900101-2345678, 1234567890123, 123-45-67890, 2026드단12345 사건. 2023년 9월", st);
  assert(!/홍길동|김영희|박철수|900101|1234567890123|123-45-67890|2026드단12345/.test(out), out);
  assert(out.includes("원고은") && out.includes("피고 및 명의인"));
  assert(out.includes("2023년 9월")); // 날짜는 사건번호로 오인하지 않는다
});
test("buildPolishPrompt: 초안과 사건명만, 규칙 포함", () => {
  const p = F.buildPolishPrompt("초안 문장", "이혼 등");
  ["초안 문장", "이혼 등", "하기 위함입니다", "추가하지 않습니다", "\"text\""].forEach((w) => assert(p.includes(w), w));
});
test("validatePolish·polishWarnings", () => {
  eq(F.validatePolish({ text: " 다듬은  문장입니다. ", changes: ["a", "", 3] }), { text: "다듬은 문장입니다.", changes: ["a", "3"] });
  eq(F.validatePolish({ text: "" }), null);
  eq(F.validatePolish(null), null);
  eq(F.validatePolish([]), null);
  eq(F.validatePolish({ text: "x" }).changes, []);
  eq(F.polishWarnings("피고 명의 계좌 확인", "피고 명의 계좌를 확인하기 위함입니다."), []);
  assert(F.polishWarnings("피고 명의 계좌 확인", "피고 명의 계좌 3건을 확인하기 위함입니다.").some((w) => w.includes("숫자")));
  assert(F.polishWarnings("피고 명의 계좌 확인", "민법 제839조의2에 따라 확인하기 위함입니다.").some((w) => w.includes("조문")));
  assert(F.polishWarnings("피고 명의 계좌 확인", "피고 명의 계좌를 확인합니다.").some((w) => w.includes("끝나지")));
});

/* ---------------- DOM 없는 환경 ---------------- */
test("node에서 로드해도 오류 없이 순수 함수만 내보냄", () => {
  assert.strictEqual(typeof F.composeDoc, "function");
  assert.strictEqual(typeof globalThis.__finorder, "object");
  assert.strictEqual(typeof document, "undefined");
});

console.log("단위 테스트: 통과 " + pass + ", 실패 " + fail);
if (fail) { console.log("\n" + failures.join("\n\n")); process.exit(1); }
