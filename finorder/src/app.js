/* ==========================================================================
 * 금융거래정보 제출명령 작성기 — app.js (순수 JS, 빌드 도구 없음)
 *
 * 전제: 이 파일보다 먼저 전역 `docx`(docx@8.5.0 IIFE)와
 *       `window.__INSTITUTIONS__`(SPEC 3장 스키마)가 로드된다.
 *       node에서는 DOM이 없어도 순수 함수만 로드된다(module.exports).
 *
 * 구성
 *   1. 문안 상수와 기본 도구
 *   2. 순수 함수: 번호·날짜·조사·검색·기관 병합·점검·최신화 JSON 검증
 *   3. 문서 모델: composeDoc → 블록 배열, 텍스트 변환, DOCX 변환
 *   4. 저장소(Store): db 우선, localStorage 폴백
 *   5. 화면: 상태, 렌더러, 이벤트
 *   6. 내보내기(window.__finorder, module.exports)
 *
 * state 형태(composeDoc 입력)
 *   { caseNo, caseName, plaintiff, defendant, ours: "plaintiff"|"defendant"|"",
 *     selected: [기관 id 또는 기관 객체...],   // 문서의 가나다 순서
 *     catalog: { id: 기관 }                     // selected가 id일 때 조회
 *     holders: [{ role: "plaintiff"|"defendant"|"third", name, no }],
 *     period: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" },
 *     purpose: { type: "divorce"|"other", text },
 *     wording: "auto"|"은행"|"기관"|"사" }
 * ========================================================================== */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const HAS_DOM = typeof document !== "undefined" && typeof document.getElementById === "function";

  /* ======================================================================
   * 1. 문안 상수와 기본 도구
   * ====================================================================== */

  // 원본 PDF(HWP 출력본)에는 밑줄 구간에 대괄호가 없다. SPEC 2장은 밑줄 표기로 대괄호를 썼다.
  // 원본을 따라 대괄호를 넣지 않는다. 대괄호까지 문서에 넣으려면 true로 바꾼다.
  const UNDERLINE_BRACKETS = false;
  // 항목별 복사에 소제목 줄을 포함할지(전자소송 입력칸에는 본문만 붙이는 것이 보통이라 false)
  const COPY_SECTION_HEADING = false;

  const TITLE = "금융거래정보 제출명령 신청서";
  const LABEL_CASE = "사    건";
  const LABEL_PLAINTIFF = "원    고";
  const LABEL_DEFENDANT = "피    고";
  const NEXT_TEXT = "다      음";
  const HEADS = [
    "1. 대상기관의 명칭 및 주소",
    "2. 명의인의 인적사항",
    "3. 요구대상 거래기간",
    "4. 사용목적",
    "5. 요구하는 거래정보 등의 내용",
  ];
  const INTRO_HEAD = "위 사건에 관하여 ";
  const INTRO_TAIL = "의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다.";
  const DIVORCE_TAIL = " 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.";
  const L1A_TAIL = "하는 계좌(예금, 적금, 보험, 연금, 신탁, 펀드, 외환거래, 대출 등 일체의 상품)가 개설되어 있는지(해지계좌 포함)";
  const L1B_TEXT = "(있다면)";
  const L2_1 = "전 계좌목록, 계좌번호 전체, 상품명, 개설일 및 해지일";
  const L2_2_HEAD = "각 상품의 ";
  const L2_2_UL = "요구대상거래기간의 거래내역";
  const L2_2_TAIL = "(송금 상대방, 상대방 계좌번호 및 은행 등 일체의 정보)을 회신하여 주시기 바랍니다(복수인 경우 각 계좌 모두).";
  const L2_3 = "위 각 항목은 PDF와 함께 XLSX 또는 CSV 형식의 전산자료로 제출하여 주시고, 거래코드의 설명과 통화·금액단위를 표시하여 주시기 바랍니다.";

  // 기관 순번: 가~허 28개. 29번째부터 "(29)" 표기.
  const LETTERS = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허";

  // 미입력 자리표시(미리보기에서 노란 표시, 복사·DOCX에서는 이 글자 그대로 나간다)
  const PH = {
    caseNo: "「사건번호」", caseName: "「사건명」",
    plaintiff: "「원고 이름」", defendant: "「피고 이름」",
    ours: "「우리 측 지위」", oursName: "「우리 측 이름」",
    inst: "「대상기관」", zip: "「우편번호」", addr: "「주소」",
    hName: "「이름」", hNo: "「주민등록번호」",
    start: "「시작일」", end: "「종료일」", purpose: "「사용목적」",
  };

  // docx 속성 요소의 스키마(CT_PPr, CT_RPr) 순서
  const PPR_ORDER = ["w:pStyle", "w:keepNext", "w:keepLines", "w:pageBreakBefore", "w:framePr", "w:widowControl", "w:numPr", "w:suppressLineNumbers", "w:pBdr", "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap", "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN", "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind", "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc", "w:textDirection", "w:textAlignment", "w:textboxTightWrap", "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange"];
  const RPR_ORDER = ["w:rStyle", "w:rFonts", "w:b", "w:bCs", "w:i", "w:iCs", "w:caps", "w:smallCaps", "w:strike", "w:dstrike", "w:outline", "w:shadow", "w:emboss", "w:imprint", "w:noProof", "w:snapToGrid", "w:vanish", "w:webHidden", "w:color", "w:spacing", "w:w", "w:kern", "w:position", "w:sz", "w:szCs", "w:highlight", "w:u", "w:effect", "w:bdr", "w:shd", "w:fitText", "w:vertAlign", "w:rtl", "w:cs", "w:em", "w:lang", "w:eastAsianLayout", "w:specVanish", "w:oMath"];

  const LS_INST = "finorder.v1.institutions";
  const LS_SETS = "finorder.v1.sets";

  const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const digitsOnly = (s) => String(s == null ? "" : s).replace(/\D/g, "");
  const esc = (s) =>
    String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ======================================================================
   * 2. 순수 함수
   * ====================================================================== */

  /** 기관 순번. n은 1부터. 1~28은 가~허, 29부터는 "(29)". */
  function hangulLetter(n) {
    n = Math.floor(Number(n));
    if (!(n >= 1)) return "";
    return n <= LETTERS.length ? LETTERS[n - 1] : "(" + n + ")";
  }
  /** 문서에 찍는 순번 표기: "가." 또는 "(29)" */
  function instMarker(n) {
    const l = hangulLetter(n);
    return n <= LETTERS.length ? l + "." : l;
  }

  /** 마지막 글자의 받침으로 "을"/"를". 한글이 아니거나 비어 있으면 "을". */
  function josaEulReul(name) {
    const s = String(name == null ? "" : name).trim();
    if (!s) return "을";
    const c = s.charCodeAt(s.length - 1);
    if (c < 0xac00 || c > 0xd7a3) return "을";
    return (c - 0xac00) % 28 === 0 ? "를" : "을";
  }

  /** 번호 확정 서식: 13자리 ######-#######, 10자리 ###-##-#####, 그 외는 입력 그대로 */
  function formatNo(raw) {
    const s = String(raw == null ? "" : raw).trim();
    const d = digitsOnly(s);
    if (/^[\d\s-]*$/.test(s)) {
      if (d.length === 13) return d.slice(0, 6) + "-" + d.slice(6);
      if (d.length === 10) return d.slice(0, 3) + "-" + d.slice(3, 5) + "-" + d.slice(5);
    }
    return s;
  }
  /**
   * 입력 중 자동 하이픈. 숫자 외 글자가 섞이면 손대지 않는다.
   * 10자리는 주민번호를 치는 중일 수 있어 하이픈 위치를 사용자가 3-2로 먼저 치지 않았다면 6-4로 둔다.
   * (입력을 마치면 formatNo가 10자리를 3-2-5로 확정한다)
   */
  function formatNoLive(raw) {
    const s = String(raw == null ? "" : raw);
    if (/[^\d\s-]/.test(s)) return s;
    const d = digitsOnly(s).slice(0, 13);
    const compact = s.replace(/\s+/g, "");
    if (d.length === 13) return d.slice(0, 6) + "-" + d.slice(6);
    if (d.length <= 10 && /^\d{3}-/.test(compact)) {
      let out = d.slice(0, 3);
      if (d.length > 3) out += "-" + d.slice(3, 5);
      if (d.length > 5) out += "-" + d.slice(5, 10);
      if (d.length === 3 && /^\d{3}-$/.test(compact)) out += "-";
      return out;
    }
    if (d.length > 6) return d.slice(0, 6) + "-" + d.slice(6);
    return d;
  }
  /** 번호의 숫자 개수 */
  function noDigitCount(raw) {
    return digitsOnly(raw).length;
  }
  function noLengthOk(raw) {
    const n = noDigitCount(raw);
    return n === 13 || n === 10;
  }

  /* ---- 날짜 ---- */
  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  /** 실제 존재하는 날짜면 ISO 문자열, 아니면 null */
  function toISO(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!(y >= 1900 && y <= 2100)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  function isISO(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return !!m && toISO(m[1], m[2], m[3]) === s;
  }
  /** "2023. 9. 1." (월·일 0 채움 없음). 형식이 틀리면 "" */
  function formatDateKR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m || !isISO(iso)) return "";
    return Number(m[1]) + ". " + Number(m[2]) + ". " + Number(m[3]) + ".";
  }
  /** 직접 입력 해석. 공백을 지운 뒤 YYYY.M.D 계열(구분자 . - /), 8자리 숫자, 'YYYY년 M월 D일'을 받는다. 실패 시 null */
  function parsePeriodText(text) {
    const s = String(text == null ? "" : text).replace(/\s+/g, "");
    if (!s) return null;
    const m =
      /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[.\-/]?$/.exec(s) ||
      /^(\d{4})년(\d{1,2})월(\d{1,2})일?$/.exec(s) ||
      /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    return m ? toISO(m[1], m[2], m[3]) : null;
  }
  function todayISO(now) {
    const d = now || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  /** iso에서 n년 더함(2월 29일은 말일로 맞춤) */
  function addYearsISO(iso, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    const y = Number(m[1]) + n, mo = Number(m[2]);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return toISO(y, mo, Math.min(Number(m[3]), last)) || "";
  }

  /* ---- 파일명 ---- */
  /** 금융거래정보제출명령신청서_{사건번호 또는 날짜}.docx. 이름·번호는 쓰지 않는다. */
  function makeFilename(state, now) {
    let base = clean(state && state.caseNo)
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/[. ]+$/, "")
      .slice(0, 60);
    if (!base) base = todayISO(now).replace(/-/g, "");
    return "금융거래정보제출명령신청서_" + base + ".docx";
  }

  /* ---- 초성 검색 ---- */
  const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
  function choOf(ch) {
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }
  function toChosung(s) {
    return Array.from(String(s == null ? "" : s)).map(choOf).join("");
  }
  const isCho = (c) => c >= "ㄱ" && c <= "ㅎ";
  function normSearch(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
  }
  function textMatches(target, q) {
    if (!q) return true;
    if (target.includes(q)) return true;
    const qs = Array.from(q);
    if (!qs.some(isCho)) return false;
    const t = Array.from(target);
    for (let s = 0; s + qs.length <= t.length; s++) {
      let ok = true;
      for (let k = 0; k < qs.length; k++) {
        const qc = qs[k], tc = t[s + k];
        if (isCho(qc) ? choOf(tc) !== qc : tc !== qc) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }
  /** 기관 검색: 통용명·정식명·별칭에 부분 일치. 초성(또는 초성+글자 혼합) 가능 */
  function searchMatch(inst, q) {
    const nq = normSearch(q);
    if (!nq) return true;
    const cands = [inst.short, inst.name].concat(Array.isArray(inst.aliases) ? inst.aliases : []);
    return cands.some((c) => textMatches(normSearch(c), nq));
  }

  /* ---- 기관 데이터 ---- */
  const STATUSES = ["verified", "user_provided", "needs_check"];
  /** 주소가 있는가(우편번호는 없어도 된다. 제공 목록에 우편번호 열이 없기 때문) */
  const hasAddr = (i) => !!String((i && i.addr) || "").trim();
  const hasZip = (i) => /^\d{5}$/.test(String((i && i.zip) || ""));
  /** 일반 항목으로 쓸 수 있는가: needs_check가 아니고 주소가 있어야 한다(needs_check는 직원이 확인·저장해야 풀린다) */
  const isReady = (i) => !!i && i.status !== "needs_check" && hasAddr(i);

  /** "서울 중구 통일로 120(충정로1가)" → { addr: "서울 중구 통일로 120", note: "충정로1가" } */
  function splitAddrNote(s) {
    s = clean(s);
    const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(s);
    if (m && m[1]) return { addr: m[1].trim(), note: m[2].trim() };
    return { addr: s, note: "" };
  }
  /** (우편번호) 주소 (참고). 우편번호가 없으면 앞 괄호를 뺀다. 값이 없으면 빈 문자열 */
  function addrLine(i) {
    if (!i || (!i.zip && !i.addr)) return "";
    return (i.zip ? "(" + i.zip + ") " : "") + (i.addr || "") + (i.note ? " (" + i.note + ")" : "");
  }
  function normInst(raw, origin) {
    const o = Object.assign({}, raw);
    o.id = String(o.id || "");
    o.short = clean(o.short) || clean(o.name);
    o.name = clean(o.name) || o.short;
    o.aliases = Array.isArray(o.aliases) ? o.aliases.map(String) : [];
    o.wording = o.wording === "은행" ? "은행" : "기관";
    o.popular = !!o.popular;
    o.zip = clean(o.zip);
    o.addr = clean(o.addr);
    o.note = clean(o.note);
    o.sources = Array.isArray(o.sources) ? o.sources : [];
    o.memo = o.memo ? String(o.memo) : "";
    o.checkedAt = o.checkedAt ? String(o.checkedAt) : "";
    if (STATUSES.indexOf(o.status) < 0) o.status = hasAddr(o) ? "user_provided" : "needs_check";
    o.origin = origin;
    return o;
  }
  /**
   * 내장 목록 위에 override를 덮고 custom을 뒤에 붙인다.
   * docs: 저장소 문서 배열 [{id, origin:"custom"|"override", ...}]
   */
  function mergeInstitutions(builtinList, docs, categories) {
    const out = [];
    const byId = {};
    (builtinList || []).forEach((b) => {
      const o = normInst(b, "builtin");
      if (!o.id || byId[o.id]) return;
      byId[o.id] = o;
      out.push(o);
    });
    const customs = [];
    (docs || []).forEach((d) => {
      if (!d || !d.id) return;
      if (d.origin === "override") {
        const cur = byId[d.id];
        if (!cur) return;
        ["name", "zip", "addr", "note", "status", "checkedAt", "sources", "memo"].forEach((k) => {
          if (d[k] !== undefined) cur[k] = d[k];
        });
        cur.origin = "override";
        cur.updatedAt = d.updatedAt || "";
        const n = normInst(cur, "override");
        Object.assign(cur, n);
      } else if (d.origin === "custom" && !byId[d.id]) {
        customs.push(d);
      }
    });
    customs.sort((a, b) => String(a.createdAt || a.updatedAt || "").localeCompare(String(b.createdAt || b.updatedAt || "")) || (a.id < b.id ? -1 : 1));
    const catIds = (categories || []).map((c) => c.id);
    customs.forEach((d) => {
      const o = normInst(d, "custom");
      if (byId[o.id]) return;
      byId[o.id] = o;
      out.push(o);
    });
    if (catIds.length) out.forEach((i) => { if (catIds.indexOf(i.cat) < 0) i.cat = catIds[0]; });
    return out;
  }

  /* ---- 5.가 호칭 ---- */
  function normWording(v) {
    const s = String(v == null ? "" : v);
    if (!s || s === "auto" || s === "자동") return "auto";
    if (s.indexOf("기관") >= 0) return "기관";
    if (s.indexOf("은행") >= 0) return "은행";
    if (/^(귀 ?)?사$/.test(s)) return "사";
    return "auto";
  }
  /** 수동 선택이 있으면 그대로, 자동이면 모두 "은행"일 때만 "은행"(선택이 없으면 "은행"), 아니면 "기관" */
  function resolveWording(mode, insts) {
    const m = normWording(mode);
    if (m !== "auto") return m;
    if (!insts || !insts.length) return "은행";
    return insts.every((i) => i && i.wording === "은행") ? "은행" : "기관";
  }

  /* ---- 사용목적 대상 표기 ---- */
  /** 명의인 지위로 "원고 및 피고"를 만든다(동일 지위 중복 제거, 입력 순서). 반환: 문서 run 배열 */
  function purposeSubjectRuns(holders) {
    const seen = {};
    const out = [];
    (holders || []).forEach((h) => {
      let key, run;
      if (h.role === "plaintiff") { key = "p"; run = { t: "원고" }; }
      else if (h.role === "defendant") { key = "d"; run = { t: "피고" }; }
      else {
        const n = clean(h.name);
        key = "t:" + n;
        run = n ? { t: n } : { t: PH.hName, blank: true };
      }
      if (seen[key]) return;
      seen[key] = true;
      if (out.length) out.push({ t: " 및 " });
      out.push(run);
    });
    return out;
  }

  /* ======================================================================
   * 3. 문서 모델
   * ====================================================================== */

  const seg = (t, extra) => Object.assign({ t: String(t) }, extra || {});
  const val = (v, ph) => { const s = clean(v); return s ? seg(s) : seg(ph, { blank: true }); };
  const runsText = (runs) => runs.map((r) => r.t).join("");

  function resolveInsts(state) {
    let cat = state.catalog || {};
    if (Array.isArray(cat)) { const m = {}; cat.forEach((i) => (m[i.id] = i)); cat = m; }
    return (state.selected || [])
      .map((x) => (typeof x === "string" ? cat[x] : x))
      .filter(Boolean);
  }

  function instAddrRuns(inst) {
    const zip = clean(inst.zip), addr = clean(inst.addr), note = clean(inst.note);
    if (!zip && !addr) return [seg("「주소 미입력」", { blank: true })];
    const runs = [
      zip ? seg("(" + zip + ")") : seg("(" + PH.zip + ")", { blank: true }),
      seg(" "),
      addr ? seg(addr) : seg(PH.addr, { blank: true }),
    ];
    if (note) runs.push(seg(" (" + note + ")"));
    return runs;
  }

  /** SPEC 2장 문안을 블록 배열로 만든다. 미리보기·복사·DOCX가 모두 이 결과를 쓴다. */
  function composeDoc(state) {
    state = state || {};
    const insts = resolveInsts(state);
    const holders = Array.isArray(state.holders) && state.holders.length ? state.holders : [{ role: "third", name: "", no: "" }];
    const period = state.period || {};
    const purpose = state.purpose || {};
    const blocks = [];
    const push = (b) => {
      if (b.runs && b.text === undefined) b.text = runsText(b.runs);
      blocks.push(b);
    };

    push({ k: "title", text: TITLE });

    const caseRuns = [val(state.caseNo, PH.caseNo), seg(" "), val(state.caseName, PH.caseName)];
    push({ k: "case", label: LABEL_CASE, runs: caseRuns, value: runsText(caseRuns) });
    const pRuns = [val(state.plaintiff, PH.plaintiff)];
    push({ k: "case", label: LABEL_PLAINTIFF, runs: pRuns, value: runsText(pRuns) });
    const dRuns = [val(state.defendant, PH.defendant)];
    push({ k: "case", label: LABEL_DEFENDANT, runs: dRuns, value: runsText(dRuns) });

    // 도입 문단
    let oursLabel, oursName;
    if (state.ours === "plaintiff") { oursLabel = seg("원고"); oursName = val(state.plaintiff, PH.plaintiff); }
    else if (state.ours === "defendant") { oursLabel = seg("피고"); oursName = val(state.defendant, PH.defendant); }
    else { oursLabel = seg(PH.ours, { blank: true }); oursName = seg(PH.oursName, { blank: true }); }
    push({ k: "intro", runs: [seg(INTRO_HEAD), oursLabel, seg(" "), oursName, seg(INTRO_TAIL)] });

    push({ k: "next", text: NEXT_TEXT });

    // 1. 대상기관
    push({ k: "h", sec: 1, text: HEADS[0] });
    if (!insts.length) {
      push({ k: "inst", sec: 1, letter: "가", marker: "가.", name: PH.inst, nameRuns: [seg(PH.inst, { blank: true })], addr: "", addrRuns: [], blank: true });
    }
    insts.forEach((inst, idx) => {
      const n = idx + 1;
      const name = clean(inst.name) || clean(inst.short);
      const nameRuns = [name ? seg(name) : seg(PH.inst, { blank: true })];
      const addrRuns = instAddrRuns(inst);
      push({
        k: "inst", sec: 1, letter: hangulLetter(n), marker: instMarker(n),
        name: runsText(nameRuns), nameRuns, addr: runsText(addrRuns), addrRuns,
      });
    });

    // 2. 명의인
    push({ k: "h", sec: 2, text: HEADS[1] });
    holders.forEach((h) => {
      const no = formatNo(h.no);
      push({ k: "holder", sec: 2, runs: [val(h.name, PH.hName), seg(" ("), no ? seg(no) : seg(PH.hNo, { blank: true }), seg(")")] });
    });

    // 3. 거래기간
    push({ k: "h", sec: 3, text: HEADS[2] });
    const s = formatDateKR(period.start), e = formatDateKR(period.end);
    push({
      k: "p", sec: 3,
      runs: [s ? seg(s) : seg(PH.start, { blank: true }), seg("부터 "), e ? seg(e) : seg(PH.end, { blank: true }), seg("까지")],
    });

    // 4. 사용목적
    push({ k: "h", sec: 4, text: HEADS[3] });
    if (purpose.type === "other") {
      const t = clean(purpose.text);
      push({ k: "p", sec: 4, runs: [t ? seg(t) : seg(PH.purpose, { blank: true })] });
    } else {
      push({ k: "p", sec: 4, runs: purposeSubjectRuns(holders).concat([seg(DIVORCE_TAIL)]) });
    }

    // 5. 요구하는 거래정보 등의 내용
    push({ k: "h", sec: 5, text: HEADS[4] });
    const w = resolveWording(state.wording, insts);
    const hRuns = [];
    holders.forEach((h, i) => {
      if (i) hRuns.push(seg(", "));
      const no = formatNo(h.no);
      hRuns.push(val(h.name, PH.hName), seg(" ("), no ? seg(no) : seg(PH.hNo, { blank: true }), seg(")"));
    });
    const lastName = clean(holders[holders.length - 1].name);
    const josa = josaEulReul(lastName);
    push({
      k: "l1", sec: 5, marker: "가.",
      runs: [seg("귀 " + w + "에 ")].concat(hRuns, [seg(josa + (holders.length > 1 ? " 각 " : " ") + "명의자로 " + L1A_TAIL)]),
    });
    push({ k: "l1", sec: 5, marker: "나.", runs: [seg(L1B_TEXT)] });
    push({ k: "l2", sec: 5, marker: "1)", runs: [seg(L2_1)] });
    push({
      k: "l2", sec: 5, marker: "2)",
      runs: [
        seg(L2_2_HEAD),
        seg((UNDERLINE_BRACKETS ? "[" : "") + L2_2_UL + (UNDERLINE_BRACKETS ? "]" : ""), { u: true }),
        seg(L2_2_TAIL),
      ],
    });
    push({ k: "l2", sec: 5, marker: "3)", runs: [seg(L2_3)] });
    return blocks;
  }

  /** 블록 → 순수 텍스트. SPEC 2장 코드 블록과 같은 줄 구조 */
  function blocksToText(blocks, opts) {
    opts = opts || {};
    const lines = [];
    blocks.forEach((b, i) => {
      switch (b.k) {
        case "title": lines.push(b.text, ""); break;
        case "case":
          lines.push(b.label + "    " + b.value);
          if (!blocks[i + 1] || blocks[i + 1].k !== "case") lines.push("");
          break;
        case "intro": lines.push(b.text, ""); break;
        case "next": lines.push(b.text, ""); break;
        case "h": lines.push(b.text); break;
        case "inst":
          lines.push(b.marker + " " + b.name);
          if (b.addr) lines.push(b.addr);
          break;
        case "holder": case "p": lines.push(b.text); break;
        case "l1": case "l2": lines.push(b.marker + " " + b.text); break;
        default: break;
      }
    });
    return lines.join("\n");
  }
  /** 항목(1~5) 복사 텍스트. 기본은 소제목 줄을 뺀 본문 */
  function sectionText(blocks, sec, opts) {
    const withHead = opts && opts.heading !== undefined ? opts.heading : COPY_SECTION_HEADING;
    return blocksToText(blocks.filter((b) => b.sec === sec && (withHead || b.k !== "h")));
  }

  /**
   * 블록 → docx Document. lib는 전역 docx(8.5.0) 또는 같은 모양의 객체.
   * 서체 바탕체, 12pt, 줄간격 200%, A4, 여백 위 30mm·아래 25mm·좌우 30mm.
   */
  function buildDocument(blocks, lib) {
    const L = lib || root.docx;
    const { Document, Paragraph, TextRun, AlignmentType, TabStopType, UnderlineType, Tab } = L;
    const FONT = { ascii: "바탕체", eastAsia: "바탕체", hAnsi: "바탕체", cs: "바탕체" };
    const spacing = (before, after) => ({ line: 480, lineRule: "auto", before: before || 0, after: after || 0 });
    // docx 8.5.0은 속성 요소를 스키마 순서와 다르게 내보내므로(rFonts가 sz 뒤, autoSpace가 jc 뒤 등)
    // 만든 뒤에 CT_PPr / CT_RPr 순서로 다시 정렬한다. Word의 엄격한 검사에 대비한 조치다.
    const sortKids = (holder, order) => {
      const kids = holder && holder.properties && holder.properties.root;
      if (!Array.isArray(kids)) return holder;
      const rank = (c) => { const i = order.indexOf(c && c.rootKey); return i < 0 ? order.length : i; };
      const sorted = kids.map((c, i) => [c, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]);
      sorted.forEach((e, i) => { kids[i] = e[0]; });
      return holder;
    };
    const run = (t, o) => sortKids(new TextRun(Object.assign({ text: t, font: FONT, size: 24 }, o || {})), RPR_ORDER);
    const runsOf = (runs, o) =>
      runs.map((r) => run(r.t, Object.assign({}, o || {}, r.u ? { underline: { type: UnderlineType.SINGLE } } : {})));
    const tabRun = (o) => sortKids(new TextRun(Object.assign({ children: [new Tab()], font: FONT, size: 24 }, o || {})), RPR_ORDER);
    // 한글과 숫자·영문 사이 자동 간격을 끈다(원본 HWP 출력에는 없다). wordWrap은 docx 8.5.0에서
    // 라틴 단어 중간 줄바꿈(w:wordWrap=0)으로 나가므로 쓰지 않고, 한글 줄바꿈과 금칙은 Word 기본값을 따른다.
    const para = (opt, children) => {
      const p = new Paragraph(Object.assign({}, opt, { children }));
      if (L.OnOffElement && p.properties && typeof p.properties.push === "function") {
        p.properties.push(new L.OnOffElement("w:autoSpaceDE", false));
        p.properties.push(new L.OnOffElement("w:autoSpaceDN", false));
      }
      return sortKids(p, PPR_ORDER);
    };

    const out = [];
    blocks.forEach((b) => {
      switch (b.k) {
        case "title":
          out.push(para({ alignment: AlignmentType.CENTER, spacing: spacing(0, 720), keepNext: true }, [run(b.text, { bold: true, size: 36 })]));
          break;
        case "case":
          out.push(
            para(
              { indent: { left: 1600, hanging: 1600 }, tabStops: [{ type: TabStopType.LEFT, position: 1600 }], spacing: spacing(0, 0), keepLines: true },
              [run(b.label), tabRun()].concat(runsOf(b.runs))
            )
          );
          break;
        case "intro":
          out.push(para({ alignment: AlignmentType.BOTH, indent: { firstLine: 240 }, spacing: spacing(720, 0) }, runsOf(b.runs)));
          break;
        case "next":
          out.push(para({ alignment: AlignmentType.CENTER, spacing: spacing(600, 0), keepNext: true }, [run(b.text, { bold: true })]));
          break;
        case "h":
          // 원본처럼 소제목 앞뒤는 빈 줄 하나 정도, 1.은 "다 음" 바로 아래에 붙는다
          out.push(para({ spacing: spacing(b.sec === 1 ? 0 : 480, 480), keepNext: true }, [run(b.text, { bold: true })]));
          break;
        case "inst": {
          out.push(para({ spacing: spacing(0, 0), keepNext: !!b.addrRuns.length, keepLines: true }, [run(b.marker + " ")].concat(runsOf(b.nameRuns))));
          if (b.addrRuns.length) out.push(para({ spacing: spacing(0, 0), keepLines: true }, runsOf(b.addrRuns)));
          break;
        }
        case "holder": case "p":
          out.push(para({ spacing: spacing(0, 0), keepLines: true }, runsOf(b.runs)));
          break;
        case "l1":
          out.push(
            para(
              { alignment: AlignmentType.BOTH, indent: { left: 440, hanging: 440 }, spacing: spacing(0, b.marker === "가." ? 480 : 0) },
              [run(b.marker), tabRun()].concat(runsOf(b.runs))
            )
          );
          break;
        case "l2":
          out.push(
            para(
              { alignment: AlignmentType.BOTH, indent: { left: 880, hanging: 440 }, tabStops: [{ type: TabStopType.LEFT, position: 880 }], spacing: spacing(0, 0) },
              [run(b.marker), tabRun()].concat(runsOf(b.runs))
            )
          );
          break;
        default: break;
      }
    });

    return new Document({
      creator: "금융거래정보 제출명령 작성기",
      lastModifiedBy: "금융거래정보 제출명령 작성기",
      title: TITLE,
      styles: {
        default: {
          document: {
            run: { font: FONT, size: 24, language: { value: "ko-KR", eastAsia: "ko-KR" } },
            paragraph: { spacing: spacing(0, 0) },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: { width: 11906, height: 16838 },
              margin: { top: 1701, bottom: 1417, left: 1701, right: 1701, header: 851, footer: 851 },
            },
          },
          children: out,
        },
      ],
    });
  }

  /* ---- 미입력 점검(순수) ---- */
  /**
   * 반환: [{ sev: "req"|"warn", msg, go }] go는 포커스할 요소 선택자
   * state.perErr = { start, end } 는 직접 입력 해석 실패 표시
   */
  function computeMissing(state) {
    const items = [];
    const need = (sev, msg, go, soft) => items.push({ sev, msg, go: go || "", soft: !!soft });
    const insts = resolveInsts(state);
    if (!clean(state.caseNo)) need("req", "사건번호 미입력", "#case-no");
    if (!clean(state.caseName)) need("req", "사건명 미입력", "#case-name");
    if (!clean(state.plaintiff)) need("req", "원고 이름 미입력", "#plaintiff");
    if (!clean(state.defendant)) need("req", "피고 이름 미입력", "#defendant");
    if (state.ours !== "plaintiff" && state.ours !== "defendant") need("req", "우리 측(원고 또는 피고) 선택 필요", "#ours-plaintiff");
    if (!insts.length) need("req", "대상기관 1곳 이상 선택 필요", "#inst-search");
    insts.forEach((i) => {
      if (isReady(i)) return;
      const go = '.sel-row[data-id="' + i.id + '"] .sel-fill-zip';
      need("req", (i.short || i.name) + (hasAddr(i) ? " 주소 확인 필요(확인 후 저장)" : " 주소 미입력"), go);
    });
    // 우편번호가 없는 기관은 문서에 주소만 표기된다. 흔한 경우라 저장 확인 단계는 걸지 않는다(soft)
    const noZip = insts.filter((i) => isReady(i) && !hasZip(i));
    if (noZip.length) {
      const names = noZip.slice(0, 3).map((i) => i.short || i.name).join(", ") + (noZip.length > 3 ? " 외 " + (noZip.length - 3) + "곳" : "");
      need("warn", "우편번호 없는 기관 " + noZip.length + "곳(" + names + "): 문서에는 우편번호 없이 주소만 표기됩니다", ".sel-row[data-id=\"" + noZip[0].id + "\"] .sel-edit", true);
    }
    const holders = state.holders || [];
    holders.forEach((h, idx) => {
      const k = holders.length > 1 ? "명의인 " + (idx + 1) + " " : "명의인 ";
      const base = '.holder[data-i="' + idx + '"] ';
      if (!clean(h.name)) need("req", k + "이름 미입력", base + ".h-name");
      if (!clean(h.no)) need("req", k + "주민등록번호 미입력", base + ".h-no");
      else if (!noLengthOk(h.no)) need("warn", k + "번호 자릿수 확인(13자리 또는 10자리)", base + ".h-no");
    });
    const p = state.period || {};
    const perErr = state.perErr || {};
    if (perErr.start) need("req", "거래기간 시작일 형식 오류", "#per-text-start");
    else if (!p.start) need("req", "거래기간 시작일 미입력", state.perMode === "text" ? "#per-text-start" : "#per-start");
    if (perErr.end) need("req", "거래기간 종료일 형식 오류", "#per-text-end");
    else if (!p.end) need("req", "거래기간 종료일 미입력", state.perMode === "text" ? "#per-text-end" : "#per-end");
    if (p.start && p.end && p.start > p.end) need("req", "거래기간 시작일이 종료일보다 늦음", state.perMode === "text" ? "#per-text-start" : "#per-start");
    if (state.purpose && state.purpose.type === "other" && !clean(state.purpose.text)) need("req", "사용목적 미입력", "#purpose-text");
    return items;
  }

  /* ---- 다듬기 보조(순수) ---- */
  /** Claude에 보내기 전에 이름·번호·사건번호를 일반 표현으로 바꾼다 */
  function scrubText(text, state) {
    let s = String(text == null ? "" : text);
    const pairs = [];
    const add = (n, r) => { n = clean(n); if (n.length >= 2) pairs.push([n, r]); };
    add(state.plaintiff, "원고");
    add(state.defendant, "피고");
    (state.holders || []).forEach((h) => add(h.name, h.role === "plaintiff" ? "원고" : h.role === "defendant" ? "피고" : "명의인"));
    pairs.sort((a, b) => b[0].length - a[0].length);
    pairs.forEach(([n, r]) => { s = s.split(n).join(r); });
    const cn = clean(state.caseNo);
    if (cn) s = s.split(cn).join("(사건번호)");
    s = s.replace(/\d{6}\s*-?\s*\d{7}/g, "(번호)").replace(/\d{3}\s*-\s*\d{2}\s*-\s*\d{5}/g, "(번호)");
    s = s.replace(/\d{4}([가-힣]{1,3})\d{1,7}/g, (m, h) => (h === "년" ? m : "(사건번호)"));
    return s;
  }
  function buildPolishPrompt(draft, caseName) {
    return [
      "법원에 제출하는 금융거래정보 제출명령 신청서의 '사용목적' 문장을 다듬어 주십시오.",
      "",
      "규칙",
      "- 합니다체 단정문으로 1~2문장만 씁니다. 마지막은 \"~하기 위함입니다.\"로 끝맺습니다.",
      "- 초안에 없는 사실, 법조문, 판례, 금액, 날짜를 추가하지 않습니다.",
      "- 명의인을 가리키는 표현(원고, 피고, 명의인 등)은 초안의 표현을 그대로 둡니다.",
      "- 군더더기와 번역투를 없애고, 의미는 바꾸지 않습니다.",
      "- 설명이나 인사말 없이 아래 JSON 하나만 답합니다.",
      "",
      "응답 형식: {\"text\":\"다듬은 문장\",\"changes\":[\"바꾼 점 한 줄\"]}",
      "",
      caseName ? "사건명(참고): " + caseName : "사건명(참고): 없음",
      "초안:",
      draft,
    ].join("\n");
  }
  /** 응답 검증. 올바르면 {text, changes}, 아니면 null */
  function validatePolish(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const text = typeof data.text === "string" ? data.text.replace(/\s+/g, " ").trim() : "";
    if (!text) return null;
    const changes = Array.isArray(data.changes) ? data.changes.map((c) => clean(c)).filter(Boolean).slice(0, 8) : [];
    return { text, changes };
  }
  /** 초안에 없던 숫자·조문·판례 표기가 생겼는지 점검 */
  function polishWarnings(draft, text) {
    const warns = [];
    const d = String(draft || ""), t = String(text || "");
    const nums = (t.match(/\d+/g) || []).filter((n) => d.indexOf(n) < 0);
    if (nums.length) warns.push("초안에 없는 숫자가 들어갔습니다(" + Array.from(new Set(nums)).join(", ") + "). 확인 후 적용하십시오.");
    if (/제\s*\d+\s*조|법원|판결|판례|대법원/.test(t) && !/제\s*\d+\s*조|법원|판결|판례|대법원/.test(d)) warns.push("초안에 없는 조문·판결 표현이 있습니다. 확인 후 적용하십시오.");
    if (!/하기 위함입니다\.$/.test(t)) warns.push("'~하기 위함입니다.'로 끝나지 않습니다.");
    return warns;
  }

  /* ---- 최신화 JSON(순수) ---- */
  function extractJson(text) {
    let s = String(text == null ? "" : text).replace(/^﻿/, "").trim();
    if (!s) throw new Error("empty");
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
    if (fence) s = fence[1].trim();
    try { return JSON.parse(s); } catch (e) { /* 아래에서 다시 시도 */ }
    const a = s.search(/[[{]/);
    const b = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("parse");
  }
  function parseUpdateJson(text) {
    let v;
    try { v = extractJson(text); }
    catch (e) { return { ok: false, error: "JSON을 읽을 수 없습니다. Claude가 돌려준 JSON 전체를 그대로 붙여 넣었는지 확인해 주십시오." }; }
    let items = null;
    if (Array.isArray(v)) items = v;
    else if (v && Array.isArray(v.institutions)) items = v.institutions;
    else if (v && Array.isArray(v.items)) items = v.items;
    else if (v && typeof v === "object" && v.id) items = [v];
    if (!items || !items.length) return { ok: false, error: "기관 목록(배열)이 보이지 않습니다." };
    return { ok: true, items };
  }
  const hostOf = (u) => { const m = /^https?:\/\/([^/?#]+)/i.exec(u); return m ? m[1].toLowerCase().replace(/^www\./, "") : ""; };
  function normSources(arr) {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => ({ label: clean(s && s.label) || hostOf(String((s && s.url) || "")) || "출처", url: clean(s && s.url) }))
      .filter((s) => /^https?:\/\//i.test(s.url));
  }
  const normName = (s) => String(s || "").replace(/\s+/g, "").replace(/^(주식회사|\(주\)|㈜)/, "").replace(/(주식회사|\(주\)|㈜)$/, "");
  /**
   * 최신화 항목 한 건을 현재 목록과 비교한다.
   * ctx: { byId: {id: 기관}, catIds: [], today }
   * 반환: { id, kind: "changed"|"new"|"same"|"invalid", reasons: [], cur, next }
   * 적용 가능 조건: 우편번호는 비어 있거나 5자리 문자열, 주소 비어 있지 않음, 출처 URL 1개 이상
   */
  function classifyUpdate(item, ctx) {
    const reasons = [];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { id: "", kind: "invalid", reasons: ["항목이 객체가 아닙니다"], cur: null, next: null };
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) reasons.push("id 형식 오류");
    const cur = (ctx.byId && ctx.byId[id]) || null;

    let zip = "";
    if (typeof item.zip === "string") zip = item.zip.trim();
    else if (item.zip != null) reasons.push("우편번호는 문자열이어야 함");
    if (zip && !/^\d{5}$/.test(zip)) reasons.push("우편번호 5자리 아님");

    let addr = typeof item.addr === "string" ? clean(item.addr) : "";
    let note = typeof item.note === "string" ? clean(item.note) : "";
    if (!addr) reasons.push("주소 비어 있음");
    if (/[()]/.test(addr)) reasons.push("주소에 괄호가 있음(참고는 note에)");
    const nm = /^\((.*)\)$/.exec(note);
    if (nm) note = nm[1].trim();

    const sources = normSources(item.sources);
    if (!sources.length) reasons.push("출처 URL 없음");
    const hosts = Array.from(new Set(sources.map((s) => hostOf(s.url))));
    const status = item.status === "verified" && hosts.length >= 2 ? "verified" : "needs_check";
    const checkedAt = isISO(item.checkedAt) ? item.checkedAt : ctx.today || todayISO();
    const memo = typeof item.memo === "string" ? item.memo.trim() : "";
    const next = { zip, addr, note, status, checkedAt, sources, memo };

    if (!cur) {
      const name = typeof item.name === "string" ? clean(item.name) : "";
      if (!name) reasons.push("목록에 없는 id이며 name도 없음");
      const catOk = (ctx.catIds || []).indexOf(item.cat) >= 0;
      if (!catOk) reasons.push("목록에 없는 id이며 분류(cat)가 올바르지 않음");
      if (ctx.byNorm && name && ctx.byNorm[normName(name)]) reasons.push("같은 명칭의 기관이 이미 있음");
      next.name = name;
      next.cat = item.cat;
      next.wording = item.wording === "은행" ? "은행" : "기관";
      return { id, kind: reasons.length ? "invalid" : "new", reasons, cur: null, next };
    }
    if (reasons.length) return { id, kind: "invalid", reasons, cur, next };
    const same = cur.zip === zip && cur.addr === addr && (cur.note || "") === note;
    return { id, kind: same ? "same" : "changed", reasons, cur, next };
  }
  function buildUpdateRequest(list, today) {
    const rows = list.map((i) => ({ id: i.id, name: i.name, zip: i.zip, addr: i.addr, note: i.note }));
    return [
      "아래 금융기관 목록의 본점 소재지(도로명주소)와 우편번호를 웹 검색으로 확인하여, 지정한 JSON 형식으로만 답해 주십시오. 오늘 날짜는 " + (today || todayISO()) + "입니다.",
      "",
      "규칙",
      "1. 기억에 의존하지 말고 반드시 웹 검색으로 확인합니다. 추정하거나 지어내지 않습니다.",
      "2. 주소는 법인 등기부상 본점 소재지(공시·약관의 '본점 소재지' 표기)를 씁니다. 대표 사무소, 영업점, 별관 주소가 다르면 memo에만 적습니다.",
      "3. addr는 도로명주소(번지·층 포함, 참고 괄호 제외), note는 괄호 안에 들어갈 참고(법정동, 건물명), zip은 5자리 새우편번호(문자열)이며 확인하지 못하면 빈 문자열입니다.",
      "4. 서로 독립된 출처 2곳 이상(공식 홈페이지, 약관, 전자공시, 금융감독원 등)에서 도로명주소가 일치하고, 우편번호가 공식 페이지 또는 정부 도로명주소 DB에서 확인될 때만 status를 \"verified\"로 합니다. 그 밖에는 \"needs_check\"입니다.",
      "5. 확인하지 못한 항목은 addr와 zip을 \"\"(빈 문자열)로 비웁니다.",
      "6. 항목마다 sources에 출처 {label, url}을 1개 이상 적습니다. url이 없으면 적용되지 않습니다. 검색 요약문, 위키, 채용·사업자정보 사이트는 출처로 쓰지 않습니다.",
      "7. 아래 목록에 없는 id를 새로 만들지 않습니다. 바뀐 것이 없으면 현재 값을 그대로 돌려줍니다.",
      "",
      "응답 형식(JSON 배열만, 설명 없이)",
      '[{"id":"","zip":"","addr":"","note":"","status":"verified","checkedAt":"YYYY-MM-DD","sources":[{"label":"","url":"https://"}],"memo":""}]',
      "",
      "현재 목록",
      JSON.stringify(rows, null, 1),
    ].join("\n");
  }

  /* ======================================================================
   * 4. 저장소: db 우선, localStorage 폴백. 이름·번호·사건번호·사건명은 저장하지 않는다.
   * ====================================================================== */
  const Store = {
    db: null, user: null, uid: "", dbChecked: false,
    writeBlocked: false, // 쓰기가 거부되어 이번 방문에서는 localStorage만 쓴다
    dbInst: {}, dbSets: {}, localInst: {}, localSets: {},
    onChange: null,

    lsGet(key) {
      try {
        const v = JSON.parse(root.localStorage.getItem(key) || "[]");
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    },
    lsSet(key, arr) {
      try { root.localStorage.setItem(key, JSON.stringify(arr)); return true; } catch (e) { return false; }
    },
    loadLocal() {
      this.localInst = {}; this.localSets = {};
      this.lsGet(LS_INST).forEach((d) => { if (d && d.id) this.localInst[d.id] = d; });
      this.lsGet(LS_SETS).forEach((d) => { if (d && d.id) this.localSets[d.id] = d; });
    },
    persistLocal() {
      const ok1 = this.lsSet(LS_INST, Object.keys(this.localInst).map((k) => this.localInst[k]));
      const ok2 = this.lsSet(LS_SETS, Object.keys(this.localSets).map((k) => this.localSets[k]));
      return ok1 && ok2;
    },
    changed() { if (this.onChange) this.onChange(); },
    latest(a, b) {
      if (!a) return b;
      if (!b) return a;
      return String(b.updatedAt || "") > String(a.updatedAt || "") ? b : a;
    },
    instDocs() {
      const ids = Object.keys(this.dbInst).concat(Object.keys(this.localInst).filter((k) => !(k in this.dbInst)));
      return ids.map((id) => this.latest(this.dbInst[id], this.localInst[id]));
    },
    rawInst(id) { return this.latest(this.dbInst[id], this.localInst[id]) || null; },
    setList() {
      const ids = Object.keys(this.dbSets).concat(Object.keys(this.localSets).filter((k) => !(k in this.dbSets)));
      return ids
        .map((id) => this.latest(this.dbSets[id], this.localSets[id]))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "ko"));
    },
    stamp(doc) {
      return JSON.parse(JSON.stringify(Object.assign({}, doc, { updatedAt: new Date().toISOString(), updatedBy: this.uid || "" })));
    },

    /** db 쓰기 시도. 성공하면 true. 권한 거부 계열이면 이번 방문에서는 더 시도하지 않는다 */
    async dbWrite(fn) {
      if (!this.db || this.writeBlocked) return false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await fn(this.db); return true; }
        catch (e) {
          const code = e && e.code;
          if (code === "unavailable" && attempt === 0) { await sleep(300 + Math.random() * 500); continue; }
          if (code === "invalid_argument" || code === "not_granted" || code === "capability_disabled" || code === "capability_removed" || code === "revoked") {
            this.writeBlocked = true;
          }
          return false;
        }
      }
      return false;
    },

    /** 기관 문서(custom/override) 저장. 반환 "db"(공용) | "local"(db 없음) | "fallback"(db가 있으나 쓰기 거부) */
    async putInst(doc) {
      const d = this.stamp(doc);
      if (await this.dbWrite((db) => db.collection("institutions").doc(d.id).set(d))) {
        this.dbInst[d.id] = d;
        if (d.id in this.localInst) { delete this.localInst[d.id]; this.persistLocal(); }
        this.changed();
        return "db";
      }
      this.localInst[d.id] = d;
      this.persistLocal();
      this.changed();
      return this.db ? "fallback" : "local";
    },
    async delInst(id) {
      let ok = true;
      if (id in this.dbInst) {
        ok = await this.dbWrite((db) => db.collection("institutions").doc(id).delete());
        if (ok) delete this.dbInst[id];
      }
      delete this.localInst[id];
      this.persistLocal();
      this.changed();
      return ok;
    },
    async putSet(set) {
      const d = this.stamp(set);
      if (await this.dbWrite((db) => db.collection("sets").doc(d.id).set(d))) {
        this.dbSets[d.id] = d;
        if (d.id in this.localSets) { delete this.localSets[d.id]; this.persistLocal(); }
        this.changed();
        return "db";
      }
      this.localSets[d.id] = d;
      this.persistLocal();
      this.changed();
      return this.db ? "fallback" : "local";
    },
    async delSet(id) {
      let ok = true;
      if (id in this.dbSets) {
        ok = await this.dbWrite((db) => db.collection("sets").doc(id).delete());
        if (ok) delete this.dbSets[id];
      }
      delete this.localSets[id];
      this.persistLocal();
      this.changed();
      return ok;
    },

    /** db 연결: 두 컬렉션을 한 번만 구독한다 */
    attach(db, user, canWrite) {
      this.dbChecked = true;
      this.user = user || null;
      if (canWrite === false) this.writeBlocked = true;
      if (!db) { this.changed(); return; }
      this.db = db;
      const take = (target) => (snap) => {
        const next = {};
        snap.docs.forEach((d) => {
          const data = d.data();
          if (data) next[d.id] = Object.assign({}, data, { id: d.id });
        });
        this[target] = next;
        this.changed();
      };
      const fail = () => { this.db = null; this.changed(); };
      try {
        db.collection("institutions").onSnapshot(take("dbInst"), fail);
        db.collection("sets").onSnapshot(take("dbSets"), fail);
      } catch (e) { fail(); }
      this.changed();
    },
  };

  /* ======================================================================
   * 5. 화면
   * ====================================================================== */
  function newState(today) {
    return {
      caseNo: "", caseName: "", plaintiff: "", defendant: "", ours: "",
      selected: [], catalog: {},
      holders: [{ role: "defendant", name: "", no: "", auto: true, roleAuto: true }],
      period: { start: "", end: today || todayISO() },
      perMode: "cal", perErr: { start: false, end: false },
      purpose: { type: "divorce", text: "" },
      wording: "auto",
    };
  }

  function boot() {
    /* ---- 5.1 상태와 도구 ---- */
    const BUILTIN = (function () {
      const d = root.__INSTITUTIONS__ || {};
      let cats = Array.isArray(d.categories) ? d.categories.slice() : [];
      const list = Array.isArray(d.institutions) ? d.institutions : [];
      if (!cats.length) cats = [{ id: "etc", label: "기관" }];
      return { asOf: d.asOf || "", categories: cats, institutions: list.map((i) => (i.cat ? i : Object.assign({ cat: cats[0].id }, i))) };
    })();

    const state = newState();
    const ui = {
      cat: BUILTIN.categories[0].id, search: "", ready: false, pane: "form",
      editing: {}, polish: null, polishing: false, ctl: null, diff: [], docxArmed: false, docxTimer: 0,
      pvHTML: "", missHTML: "",
    };
    const Cap = { sample: null, sampleChecked: false, downloads: undefined };
    let catalogList = [];
    let toastTimer = 0;
    let noteDefault = "";
    let mq = null;

    const $ = (id) => document.getElementById(id);
    const $$ = (sel, scope) => Array.prototype.slice.call((scope || document).querySelectorAll(sel));
    const on = (id, type, fn) => { const el = $(id); if (el) el.addEventListener(type, fn); };
    const setText = (id, t) => { const el = $(id); if (el && el.textContent !== t) el.textContent = t; };
    const categories = () => BUILTIN.categories;
    const catLabel = (id) => { const c = categories().find((x) => x.id === id); return c ? c.label : ""; };

    // 저장 결과 안내: 공용 저장이면 덧붙일 말이 없고, 로컬 저장이면 그 사실을 알린다
    const WHERE = {
      db: "",
      local: " (이 브라우저에만 저장)",
      fallback: " 공용 저장소에 쓸 수 없어 이 브라우저에만 저장했습니다. 다른 팀원에게는 보이지 않습니다.",
    };

    function toast(msg, ms) {
      const el = $("toast");
      if (!el) return;
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3400);
    }

    /** 두 번 눌러야 실행되는 버튼. 첫 클릭에서 문구를 바꾸고 ms 안에 다시 누르면 run */
    function armTwice(btn, armedText, run, ms) {
      if (btn.dataset.armed === "true") {
        clearTimeout(btn._armTimer);
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label || btn.textContent;
        run();
        return;
      }
      btn.dataset.label = btn.textContent;
      btn.dataset.armed = "true";
      btn.textContent = armedText;
      btn._armTimer = setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
      }, ms || 4000);
    }

    function syncCatalog() {
      catalogList = mergeInstitutions(BUILTIN.institutions, Store.instDocs(), BUILTIN.categories);
      const map = {};
      catalogList.forEach((i) => { map[i.id] = i; });
      state.catalog = map;
      state.selected = state.selected.filter((id) => map[id]);
      if (!categories().some((c) => c.id === ui.cat)) ui.cat = categories()[0].id;
    }
    const inst = (id) => state.catalog[id];

    /* ---- 5.2 복사 ---- */
    function legacyCopy(text) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = typeof document.execCommand === "function" && document.execCommand("copy");
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) { return false; }
    }
    function showCopyFallback(text, anchor, label) {
      $$(".copy-fallback").forEach((n) => n.remove());
      if (!anchor) return;
      const parentTag = anchor.parentElement ? anchor.parentElement.tagName : "";
      const box = document.createElement(parentTag === "OL" || parentTag === "UL" ? "li" : "div");
      box.className = "copy-fallback note";
      box.innerHTML =
        '<p class="hint">복사가 막혀 있어 ' + esc(label) + ' 글을 선택해 두었습니다. 직접 복사해 주십시오(Ctrl+C).</p>' +
        '<textarea readonly rows="8" spellcheck="false" aria-label="' + esc(label) + ' 복사용 글"></textarea>' +
        '<div class="btns"><button type="button" class="btn ghost sm copy-fallback-close">닫기</button></div>';
      const ta = box.querySelector("textarea");
      ta.value = text;
      ta.style.cssText = "width:100%;min-height:8rem;margin-top:6px";
      box.querySelector(".copy-fallback-close").addEventListener("click", () => box.remove());
      anchor.insertAdjacentElement("afterend", box);
      try { ta.focus(); ta.select(); } catch (e) { /* 선택 실패는 무시 */ }
      toast("복사가 막혀 있습니다. 선택된 글을 직접 복사해 주십시오.");
    }
    /** 클릭 핸들러 안에서 호출해야 한다 */
    function copyText(text, label, anchor) {
      const fail = () => {
        if (legacyCopy(text)) toast(label + " 복사했습니다.");
        else showCopyFallback(text, anchor, label);
      };
      let p = null;
      try { if (root.navigator && navigator.clipboard && navigator.clipboard.writeText) p = navigator.clipboard.writeText(text); } catch (e) { p = null; }
      if (p && typeof p.then === "function") p.then(() => toast(label + " 복사했습니다."), fail);
      else fail();
    }

    /* ---- 5.3 미리보기 ---- */
    function runsHTML(runs) {
      return runs
        .map((r) => {
          let h = esc(r.t);
          if (r.blank) h = '<span class="d-blank">' + h + "</span>";
          if (r.u) h = "<u>" + h + "</u>";
          return h;
        })
        .join("");
    }
    function blockHTML(b) {
      switch (b.k) {
        case "title": return '<div class="d-title">' + esc(b.text) + "</div>";
        case "case": return '<div class="d-case"><span class="d-label">' + esc(b.label) + '</span><span class="d-value">' + runsHTML(b.runs) + "</span></div>";
        case "intro": return '<p class="d-intro">' + runsHTML(b.runs) + "</p>";
        case "next": return '<div class="d-next">' + esc(b.text) + "</div>";
        case "h":
          return '<h3 class="d-h" data-sec="' + b.sec + '"><span class="d-h-t">' + esc(b.text) + '</span><button type="button" class="btn-copy" data-copy="' + b.sec + '" aria-label="' + esc(b.text) + ' 복사">복사</button></h3>';
        case "inst":
          return '<div class="d-inst"><span class="d-letter">' + esc(b.marker) + '</span><span class="d-name">' + runsHTML(b.nameRuns) + "</span>" +
            (b.addrRuns.length ? '<span class="d-addr">' + runsHTML(b.addrRuns) + "</span>" : "") + "</div>";
        case "holder": return '<p class="d-holder">' + runsHTML(b.runs) + "</p>";
        case "p": return '<p class="d-p">' + runsHTML(b.runs) + "</p>";
        case "l1": return '<p class="d-l1"><span class="d-mk">' + esc(b.marker) + "</span>" + runsHTML(b.runs) + "</p>";
        case "l2": return '<p class="d-l2"><span class="d-mk">' + esc(b.marker) + "</span>" + runsHTML(b.runs) + "</p>";
        default: return "";
      }
    }
    function renderPreview() {
      const el = $("doc-preview");
      if (!el) return;
      const html = composeDoc(state).map(blockHTML).join("");
      if (html === ui.pvHTML) return; // 같으면 다시 그리지 않는다(글 선택·초점 유지)
      ui.pvHTML = html;
      el.innerHTML = html;
      $$(".btn-copy", el).forEach((b) => { b.style.userSelect = "none"; });
    }

    /* ---- 5.4 점검 목록·버튼 상태 ---- */
    function renderMissing() {
      const items = computeMissing(state);
      const ul = $("missing-list");
      if (ul) {
        // 내용이 같으면 다시 쓰지 않는다(aria-live 목록이 키 입력마다 반복 낭독되지 않게)
        const html = items
          .map((m) => '<li class="miss-item" data-sev="' + m.sev + '" data-go="' + esc(m.go) + '" tabindex="0">' + esc(m.msg) + "</li>")
          .join("");
        if (html !== ui.missHTML) {
          ui.missHTML = html;
          ul.innerHTML = html;
          $$(".miss-item", ul).forEach((li) => { li.style.cursor = "pointer"; });
        }
      }
      setText("missing-count", items.length ? items.length + "건" : "");
      const btn = $("btn-docx");
      if (btn) {
        if (!btn.dataset.label) btn.dataset.label = btn.textContent;
        if (ui.docxArmed && items.length) btn.textContent = "미입력 " + items.length + "건 — 한 번 더 누르면 그대로 저장합니다";
        else {
          if (ui.docxArmed) disarmDocx();
          btn.textContent = btn.dataset.label;
        }
      }
      return items;
    }
    function disarmDocx() {
      ui.docxArmed = false;
      clearTimeout(ui.docxTimer);
      const btn = $("btn-docx");
      if (btn) { delete btn.dataset.armed; btn.textContent = btn.dataset.label || btn.textContent; }
    }
    function markHolderErrors() {
      $$("#holders .holder").forEach((row) => {
        const i = Number(row.dataset.i);
        const h = state.holders[i];
        const no = row.querySelector(".h-no");
        if (!h || !no) return;
        const bad = !!clean(h.no) && !noLengthOk(h.no);
        if (bad) no.setAttribute("aria-invalid", "true"); else no.removeAttribute("aria-invalid");
      });
    }
    function renderPurposeUI() {
      const fixed = $("purpose-fixed");
      if (fixed) {
        const doc = composeDoc(Object.assign({}, state, { purpose: { type: "divorce", text: "" } }));
        const blk = doc.find((b) => b.k === "p" && b.sec === 4);
        fixed.textContent = blk ? blk.text : "";
      }
      const btn = $("btn-polish");
      if (btn) btn.hidden = !Cap.sample;
      const stop = $("btn-polish-stop");
      if (stop) stop.hidden = !ui.polishing;
      if (btn) btn.disabled = ui.polishing;
    }
    function renderPeriodNote() {
      const el = $("per-note");
      if (!el) return;
      if (!noteDefault) noteDefault = el.textContent;
      const msgs = [];
      if (state.perErr.start) msgs.push("시작일을 읽을 수 없습니다. 예: 2023.9.1");
      if (state.perErr.end) msgs.push("종료일을 읽을 수 없습니다. 예: 2026.9.1");
      if (state.period.start && state.period.end && state.period.start > state.period.end) msgs.push("시작일이 종료일보다 늦습니다.");
      el.textContent = msgs.length ? msgs.join(" ") : noteDefault;
      el.classList.toggle("err", msgs.length > 0);
    }
    function render() {
      renderPreview();
      renderMissing();
      markHolderErrors();
      renderPurposeUI();
      renderPeriodNote();
    }

    /* ---- 5.5 기관 목록 ---- */
    function visibleInsts() {
      const q = ui.search.trim();
      let list = catalogList;
      if (ui.ready) list = list.filter(isReady);
      return q ? list.filter((i) => searchMatch(i, q)) : list.filter((i) => i.cat === ui.cat);
    }
    // 상태 배지(주소 미확인·양식 기준)는 data-status로 CSS가 그린다. JS는 직원이 추가한 기관의 '추가'만 만든다.
    function badgeHTML(i) {
      return i.origin === "custom" ? '<span class="badge">추가</span>' : "";
    }
    function instItemHTML(i) {
      const on = state.selected.indexOf(i.id) >= 0;
      const sub = i.name && i.name !== i.short ? i.name : "";
      return (
        '<label class="inst-item" data-id="' + esc(i.id) + '" data-checked="' + on + '" data-status="' + esc(i.status) + '" data-origin="' + esc(i.origin) +
        '" title="' + esc(addrLine(i) || "주소 미확인") + '"><input type="checkbox" class="inst-cb"' + (on ? " checked" : "") + ">" +
        '<span class="inst-short">' + esc(i.short) + '</span><span class="inst-sub">' + esc(sub) + "</span>" + badgeHTML(i) +
        (i.origin === "custom"
          ? '<button type="button" class="inst-del" aria-label="' + esc(i.short) + ' 삭제" title="추가한 기관을 목록에서 삭제" style="position:absolute;top:2px;right:2px;min-width:24px;height:24px;padding:0 4px;border:0;background:transparent;color:inherit;font-size:12px;opacity:.7">✕</button>'
          : "") +
        "</label>"
      );
    }
    function renderInstList() {
      const box = $("inst-list");
      if (!box) return;
      const q = ui.search.trim();
      const items = visibleInsts();
      let html = "";
      if (!items.length) {
        if (q) {
          html =
            '<p class="inst-empty">\'' + esc(q) + "\'에 맞는 기관이 없습니다." + (ui.ready ? " (주소 확인된 곳만 보는 중)" : "") + "</p>" +
            '<button type="button" class="btn inst-add-from-search" data-q="' + esc(q) + '">목록에 없음 — \'' + esc(q) + "' 추가</button>";
        } else {
          html = '<p class="inst-empty">' + (ui.ready ? "이 분류에는 주소가 확인된 기관이 없습니다." : "이 분류에 등록된 기관이 없습니다.") + "</p>";
        }
      } else if (q) {
        categories().forEach((c) => {
          const g = items.filter((i) => i.cat === c.id);
          if (g.length) html += '<div class="inst-group">' + esc(c.label) + "</div>" + g.map(instItemHTML).join("");
        });
      } else {
        const pop = items.filter((i) => i.popular), rest = items.filter((i) => !i.popular);
        if (pop.length && rest.length) {
          html = '<div class="inst-group">자주 쓰는 곳</div>' + pop.map(instItemHTML).join("") + '<div class="inst-group">그 밖의 기관</div>' + rest.map(instItemHTML).join("");
        } else html = items.map(instItemHTML).join("");
      }
      const active = document.activeElement;
      const keepId = active && box.contains(active) && active.closest(".inst-item") ? active.closest(".inst-item").dataset.id : "";
      box.innerHTML = html;
      if (keepId) {
        const cb = box.querySelector('.inst-item[data-id="' + keepId + '"] .inst-cb');
        if (cb) cb.focus();
      }
    }
    function renderCats() {
      const box = $("inst-cats");
      if (!box) return;
      const q = ui.search.trim();
      let html = categories()
        .map((c) => {
          const all = catalogList.filter((i) => i.cat === c.id && (!ui.ready || isReady(i)));
          const sel = all.filter((i) => state.selected.indexOf(i.id) >= 0).length;
          return '<button type="button" class="cat-tab" role="tab" aria-controls="inst-list" aria-selected="' + (!q && c.id === ui.cat) + '" data-cat="' + esc(c.id) + '">' +
            esc(c.label) + ' <span class="cat-n">' + sel + "/" + all.length + "</span></button>";
        })
        .join("");
      if (!q) html += '<button type="button" class="cat-all" data-cat="' + esc(ui.cat) + '">전체 선택</button><button type="button" class="cat-none" data-cat="' + esc(ui.cat) + '">해제</button>';
      box.innerHTML = html;
    }
    /** 체크 상태만 갱신(포커스를 유지하려고 목록을 다시 그리지 않는다) */
    function syncInstChecks() {
      $$("#inst-list .inst-item").forEach((l) => {
        const on = state.selected.indexOf(l.dataset.id) >= 0;
        l.dataset.checked = String(on);
        const cb = l.querySelector(".inst-cb");
        if (cb) cb.checked = on;
      });
      $$("#inst-cats .cat-tab").forEach((t) => {
        const all = catalogList.filter((i) => i.cat === t.dataset.cat && (!ui.ready || isReady(i)));
        const sel = all.filter((i) => state.selected.indexOf(i.id) >= 0).length;
        const n = t.querySelector(".cat-n");
        if (n) n.textContent = sel + "/" + all.length;
      });
      setText("inst-count", state.selected.length + "곳 선택");
    }

    function renderSelected() {
      const ol = $("inst-selected");
      if (!ol) return;
      // 입력 중이던 주소 입력칸의 값과 포커스를 보존한다
      const FILL = ["name", "zip", "addr", "note"];
      const saved = {};
      let focusKey = "";
      $$(".sel-row", ol).forEach((r) => {
        if (r.querySelector(".sel-fill")) {
          saved[r.dataset.id] = {};
          FILL.forEach((k) => { const el = r.querySelector(".sel-fill-" + k); saved[r.dataset.id][k] = el ? el.value : ""; });
        }
        if (r.contains(document.activeElement)) focusKey = r.dataset.id + "|" + String(document.activeElement.className || "").split(" ")[0];
      });
      ol.innerHTML = state.selected
        .map((id, idx) => {
          const i = inst(id);
          if (!i) return "";
          const fill = !isReady(i) || ui.editing[id];
          const last = idx === state.selected.length - 1;
          let main = '<b class="sel-name">' + esc(i.name || i.short) + "</b>";
          if (fill) {
            // 명칭은 미확인 상호 후보를 미리 채워 직원이 확인·수정한다
            main +=
              '<div class="sel-fill"><input class="sel-fill-name" placeholder="기관 명칭(신청서에 쓰는 정식 상호)" aria-label="' + esc(i.short) + ' 기관 명칭" autocomplete="off" value="' + esc(i.name) + '">' +
              '<input class="sel-fill-zip" inputmode="numeric" maxlength="5" placeholder="우편번호" aria-label="' + esc(i.short) + ' 우편번호" autocomplete="off" value="' + esc(hasAddr(i) ? i.zip : "") + '">' +
              '<input class="sel-fill-addr" placeholder="도로명주소(번지, 층까지)" aria-label="' + esc(i.short) + ' 도로명주소" autocomplete="off" value="' + esc(hasAddr(i) ? i.addr : "") + '">' +
              '<input class="sel-fill-note" placeholder="참고(선택): 법정동, 건물명" aria-label="' + esc(i.short) + ' 참고" autocomplete="off" value="' + esc(hasAddr(i) ? i.note : "") + '">' +
              '<button type="button" class="sel-fill-save">저장</button>' +
              (ui.editing[id] ? '<button type="button" class="btn ghost sm sel-fill-cancel">취소</button>' : "") +
              '<p class="err sel-fill-err" role="alert"></p></div>';
          } else {
            main += '<span class="sel-addr">' + esc(addrLine(i)) + "</span>" + '<button type="button" class="btn ghost sm sel-edit" aria-label="' + esc(i.short) + ' 주소 수정">주소 수정</button>';
          }
          return (
            '<li class="sel-row" data-id="' + esc(id) + '"><span class="sel-letter">' + esc(instMarker(idx + 1)) + '</span><div class="sel-main">' + main + "</div>" +
            '<div class="sel-ctl"><button type="button" class="sel-up" aria-label="위로"' + (idx === 0 ? " disabled" : "") + '>↑</button>' +
            '<button type="button" class="sel-down" aria-label="아래로"' + (last ? " disabled" : "") + '>↓</button>' +
            '<button type="button" class="sel-del" aria-label="제거">✕</button></div></li>'
          );
        })
        .join("");
      $$(".sel-row", ol).forEach((r) => {
        const s = saved[r.dataset.id];
        if (!s) return;
        FILL.forEach((k) => { const el = r.querySelector(".sel-fill-" + k); if (el) el.value = s[k]; });
      });
      if (focusKey) {
        const [id, cls] = focusKey.split("|");
        const row = ol.querySelector('.sel-row[data-id="' + id + '"]');
        const target = row && (row.querySelector("." + cls + ":not(:disabled)") || row.querySelector(".sel-del"));
        if (target) target.focus();
      }
      setText("inst-count", state.selected.length + "곳 선택");
    }

    function selectionChanged() {
      syncInstChecks();
      renderSelected();
      render();
    }
    function toggleInst(id, on) {
      const at = state.selected.indexOf(id);
      if (on && at < 0) state.selected.push(id);
      if (!on && at >= 0) state.selected.splice(at, 1);
      selectionChanged();
    }
    function moveInst(id, d) {
      const i = state.selected.indexOf(id), j = i + d;
      if (i < 0 || j < 0 || j >= state.selected.length) return;
      const t = state.selected[i]; state.selected[i] = state.selected[j]; state.selected[j] = t;
      renderSelected();
      render();
    }

    /** 기관 주소를 override(내장·override) 또는 custom 문서 갱신으로 저장 */
    async function saveAddress(id, f) {
      const cur = inst(id);
      if (!cur) return;
      // 참고 칸이 비어 있고 주소 끝에 괄호가 붙어 있으면 참고로 나눈다
      const sp = f.note ? { addr: clean(f.addr), note: clean(f.note).replace(/^\((.*)\)$/, "$1") } : splitAddrNote(f.addr);
      const fields = {
        name: f.name, zip: f.zip, addr: sp.addr, note: sp.note, status: "user_provided", checkedAt: todayISO(),
        sources: [{ label: "직원 직접 입력", url: "" }],
      };
      let doc;
      if (cur.origin === "custom") {
        const raw = Store.rawInst(id) || {};
        doc = Object.assign({}, raw, fields, { id, origin: "custom" });
      } else {
        const raw = Store.rawInst(id);
        doc = Object.assign({}, raw && raw.origin === "override" ? raw : {}, fields, { id, origin: "override" });
      }
      return Store.putInst(doc);
    }
    async function onFillSave(row) {
      const id = row.dataset.id;
      const n = row.querySelector(".sel-fill-name"), z = row.querySelector(".sel-fill-zip"), a = row.querySelector(".sel-fill-addr"), t = row.querySelector(".sel-fill-note"), err = row.querySelector(".sel-fill-err");
      const name = clean(n && n.value), zip = digitsOnly(z.value);
      const bad = (el, m) => { if (err) err.textContent = m; el.setAttribute("aria-invalid", "true"); el.focus(); };
      if (n && !name) return bad(n, "기관 명칭을 입력해 주십시오.");
      if (!clean(a.value)) return bad(a, "도로명주소를 입력해 주십시오.");
      if (zip && !/^\d{5}$/.test(zip)) return bad(z, "우편번호는 5자리이거나 비워 두십시오.");
      delete ui.editing[id];
      const where = await saveAddress(id, { name: name || (inst(id) || {}).name, zip, addr: a.value, note: t ? t.value : "" });
      toast("기관 정보를 저장했습니다." + WHERE[where], where === "fallback" ? 6000 : 0);
    }

    /* ---- 5.6 선택 세트 ---- */
    function renderSets() {
      const box = $("set-list");
      if (!box) return;
      box.innerHTML = Store.setList()
        .map((s) =>
          '<span class="set-chip"><button type="button" class="set-load" data-id="' + esc(s.id) + '">' + esc(s.name) + "</button>" +
          '<button type="button" class="set-del" data-id="' + esc(s.id) + '" aria-label="' + esc(s.name) + ' 삭제">✕</button></span>'
        )
        .join("");
    }
    async function saveSet() {
      const input = $("set-name");
      const name = clean(input ? input.value : "");
      if (!state.selected.length) { toast("저장할 기관을 먼저 선택해 주십시오."); return; }
      if (!name) { toast("세트 이름을 입력해 주십시오."); if (input) input.focus(); return; }
      const dup = Store.setList().find((s) => s.name === name);
      const id = dup ? dup.id : "s-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const where = await Store.putSet({ id, name, ids: state.selected.slice() });
      if (input) input.value = "";
      toast((dup ? "'" + name + "' 세트를 덮어썼습니다." : "'" + name + "' 세트를 저장했습니다.") + WHERE[where], where === "fallback" ? 6000 : 0);
    }
    function loadSet(id) {
      const s = Store.setList().find((x) => x.id === id);
      if (!s) return;
      const ids = (s.ids || []).filter((x) => state.catalog[x]);
      const miss = (s.ids || []).length - ids.length;
      state.selected = ids;
      selectionChanged();
      toast("'" + s.name + "' 세트를 불러왔습니다(" + ids.length + "곳)." + (miss ? " 목록에 없는 " + miss + "곳은 뺐습니다." : ""));
    }

    /* ---- 5.7 기관 추가 ---- */
    function addMsg(m) {
      const el = $("add-msg");
      if (!el) return;
      el.textContent = m || "";
      el.hidden = !m;
    }
    function openAdd(name) {
      const f = $("add-inst");
      if (!f) return;
      f.hidden = false;
      addMsg("");
      if (name !== undefined && $("add-name")) $("add-name").value = name;
      const cs = $("add-cat");
      if (cs && Array.prototype.some.call(cs.options, (o) => o.value === ui.cat)) cs.value = ui.cat;
      const focusEl = name ? $("add-zip") : $("add-name");
      if (focusEl) focusEl.focus();
    }
    function closeAdd() {
      const f = $("add-inst");
      if (f) f.hidden = true;
      ["add-name", "add-zip", "add-addr", "add-note"].forEach((id) => { const e = $(id); if (e) e.value = ""; });
      addMsg("");
    }
    async function saveAdd() {
      const name = clean($("add-name") && $("add-name").value);
      const zip = digitsOnly($("add-zip") && $("add-zip").value);
      const addrRaw = clean($("add-addr") && $("add-addr").value);
      const noteIn = clean($("add-note") && $("add-note").value).replace(/^\((.*)\)$/, "$1");
      if (!name) return addMsg("기관 명칭을 입력해 주십시오.");
      if (!addrRaw) return addMsg("도로명주소를 입력해 주십시오.");
      if (zip && !/^\d{5}$/.test(zip)) return addMsg("우편번호는 5자리이거나 비워 두십시오.");
      const nn = normName(name);
      const dup = catalogList.find((i) => normName(i.name) === nn || normName(i.short) === nn);
      if (dup) {
        ui.cat = dup.cat;
        return addMsg("'" + dup.short + "'이(가) 이미 목록에 있습니다. 목록에서 선택하고, 주소가 비어 있으면 선택 목록에서 입력해 주십시오.");
      }
      const sp = noteIn ? { addr: addrRaw, note: noteIn } : splitAddrNote(addrRaw);
      const id = "c-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const catSel = $("add-cat") ? $("add-cat").value : categories()[0].id;
      const wording = $("add-wording") && $("add-wording").value === "은행" ? "은행" : "기관";
      const doc = {
        id, origin: "custom", cat: categories().some((c) => c.id === catSel) ? catSel : categories()[0].id,
        short: name, name, aliases: [], wording, popular: false,
        zip, addr: sp.addr, note: sp.note, status: "user_provided", checkedAt: todayISO(),
        sources: [{ label: "직원 직접 입력", url: "" }], memo: "", createdAt: new Date().toISOString(),
      };
      const where = await Store.putInst(doc);
      syncCatalog();
      if (state.selected.indexOf(id) < 0 && state.catalog[id]) state.selected.push(id);
      ui.cat = state.catalog[id] ? state.catalog[id].cat : ui.cat;
      ui.search = "";
      if ($("inst-search")) $("inst-search").value = "";
      closeAdd();
      renderAllLists();
      render();
      toast("'" + name + "'을(를) 추가해 선택했습니다." + WHERE[where], where === "fallback" ? 6000 : 0);
    }
    async function deleteCustom(id, short) {
      const ok = await Store.delInst(id);
      toast(ok ? "'" + short + "'을(를) 삭제했습니다." : "공용 저장소에서 삭제하지 못했습니다(권한 확인).");
    }

    /* ---- 5.8 최신화 패널 ---- */
    function statusLabel(i) {
      if (i.status === "needs_check") return "주소 미확인";
      if (i.status === "user_provided") return i.origin === "builtin" ? "제공 목록 기준" : "직접 입력";
      return "확인됨";
    }
    function sourcesHTML(i) {
      const s = Array.isArray(i.sources) ? i.sources : [];
      if (!s.length) return "-";
      return s
        .map((x) => {
          const label = esc(x.label || "출처");
          return /^https?:\/\//i.test(x.url || "")
            ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>"
            : "<span>" + label + "</span>";
        })
        .join("<br>");
    }
    function renderUpdSummary() {
      const box = $("upd-summary");
      if (!box) return;
      if (!catalogList.length) { box.innerHTML = ""; return; }
      const ready = catalogList.filter(isReady).length;
      box.innerHTML =
        '<p class="hint" style="padding:6px 10px">데이터 기준일 ' + esc(BUILTIN.asOf || "-") + " · 전체 " + catalogList.length + "곳 중 주소 입력됨 " + ready + "곳, 미확인 " + (catalogList.length - ready) + "곳</p>" +
        "<table><thead><tr><th>기관</th><th>조사일</th><th>출처</th><th>상태</th></tr></thead><tbody>" +
        catalogList
          .map((i) => "<tr><td>" + esc(i.short) + "</td><td>" + esc(i.checkedAt || "-") + "</td><td>" + sourcesHTML(i) + "</td><td>" + esc(statusLabel(i)) + "</td></tr>")
          .join("") +
        "</tbody></table>";
    }
    const KIND_LABEL = { changed: "변경", new: "신규", same: "동일", invalid: "형식 오류" };
    function nextLine(n) { return n ? "(" + n.zip + ") " + n.addr + (n.note ? " (" + n.note + ")" : "") : ""; }
    function checkUpdate() {
      const out = $("upd-diff");
      if (!out) return;
      const parsed = parseUpdateJson($("upd-paste") ? $("upd-paste").value : "");
      ui.diff = [];
      if (!parsed.ok) { out.innerHTML = '<p class="err">' + esc(parsed.error) + "</p>"; return; }
      const byId = {}, byNorm = {};
      catalogList.forEach((i) => { byId[i.id] = i; byNorm[normName(i.name)] = i; byNorm[normName(i.short)] = i; });
      const ctx = { byId, byNorm, catIds: categories().map((c) => c.id), today: todayISO() };
      const seen = {};
      ui.diff = parsed.items.map((it) => {
        const r = classifyUpdate(it, ctx);
        if (r.id && seen[r.id] && r.kind !== "invalid") { r.kind = "invalid"; r.reasons.push("같은 id가 두 번 나옴"); }
        seen[r.id] = true;
        return r;
      });
      const rows = ui.diff
        .map((r) => {
          const can = r.kind === "changed" || r.kind === "new";
          const name = r.cur ? r.cur.short : r.next && r.next.name ? r.next.name : r.id || "(id 없음)";
          const oldTxt = r.cur ? addrLine(r.cur) || "(비어 있음)" : "-";
          const newTxt = r.kind === "invalid" ? esc(r.reasons.join(", ")) : "<ins>" + esc(nextLine(r.next)) + "</ins><br>" + sourcesHTML(r.next);
          return (
            '<tr data-kind="' + r.kind + '"><td>' + (can ? '<input type="checkbox" class="diff-cb" data-id="' + esc(r.id) + '" aria-label="' + esc(name) + ' 적용">' : "") + "</td><td>" + esc(name) + "</td><td>" +
            (r.kind === "changed" ? "<del>" + esc(oldTxt) + "</del>" : esc(oldTxt)) + "</td><td>" + newTxt + "</td><td>" + KIND_LABEL[r.kind] + "</td></tr>"
          );
        })
        .join("");
      const n = ui.diff.filter((r) => r.kind === "changed" || r.kind === "new").length;
      out.innerHTML =
        '<table class="diff-table"><thead><tr><th><input type="checkbox" class="diff-cb-all" aria-label="변경·신규 항목 모두 선택"></th><th>기관</th><th>기존</th><th>새 값</th><th>구분</th></tr></thead><tbody>' + rows + "</tbody></table>" +
        '<p class="hint">변경·신규 ' + n + "건은 고른 뒤 '선택 적용'을 누르십시오. 적용하면 공용 목록(override)에 저장됩니다.</p>";
    }
    async function applyUpdate() {
      const out = $("upd-diff");
      const ids = $$(".diff-cb:checked", out || document).map((c) => c.dataset.id);
      if (!ids.length) { toast("적용할 항목을 먼저 선택해 주십시오."); return; }
      let n = 0, local = 0, fell = 0;
      for (const id of ids) {
        const r = ui.diff.find((x) => x.id === id && (x.kind === "changed" || x.kind === "new"));
        if (!r) continue;
        let doc;
        if (r.kind === "new") {
          doc = {
            id, origin: "custom", cat: r.next.cat, short: r.next.name, name: r.next.name, aliases: [], wording: r.next.wording, popular: false,
            zip: r.next.zip, addr: r.next.addr, note: r.next.note, status: r.next.status, checkedAt: r.next.checkedAt, sources: r.next.sources, memo: r.next.memo, createdAt: new Date().toISOString(),
          };
        } else {
          const raw = Store.rawInst(id);
          const fields = { zip: r.next.zip, addr: r.next.addr, note: r.next.note, status: r.next.status, checkedAt: r.next.checkedAt, sources: r.next.sources };
          if (r.next.memo) fields.memo = r.next.memo;
          doc = r.cur.origin === "custom" ? Object.assign({}, raw, fields, { id, origin: "custom" }) : Object.assign({}, raw && raw.origin === "override" ? raw : {}, fields, { id, origin: "override" });
        }
        const where = await Store.putInst(doc);
        n++;
        if (where === "local") local++;
        if (where === "fallback") fell++;
      }
      ui.diff = [];
      const tail = (local ? " (이 브라우저에만 저장된 " + local + "곳 포함)" : "") + (fell ? " 공용 저장소에 쓸 수 없어 " + fell + "곳은 이 브라우저에만 저장했습니다. 다른 팀원에게는 보이지 않습니다." : "");
      if (out) out.innerHTML = '<p class="hint">' + n + "곳에 반영했습니다." + esc(tail) + "</p>";
      if ($("upd-paste")) $("upd-paste").value = "";
      toast(n + "곳에 반영했습니다." + tail, fell ? 6000 : 0);
    }

    /* ---- 5.9 명의인 ---- */
    function holderRowHTML(h, i) {
      const sel = (v) => (h.role === v ? " selected" : "");
      return (
        '<div class="holder" data-i="' + i + '"><select class="h-role" aria-label="명의인 ' + (i + 1) + ' 지위">' +
        '<option value="plaintiff"' + sel("plaintiff") + '>원고</option><option value="defendant"' + sel("defendant") + '>피고</option><option value="third"' + sel("third") + ">제3자</option></select>" +
        '<input type="text" class="h-name" aria-label="명의인 ' + (i + 1) + ' 이름" placeholder="이름" autocomplete="off" spellcheck="false" value="' + esc(h.name) + '">' +
        '<input type="text" class="h-no" inputmode="numeric" aria-label="명의인 ' + (i + 1) + ' 주민등록번호" placeholder="주민등록번호(법인·사업자번호 가능)" autocomplete="off" spellcheck="false" value="' + esc(h.no) + '">' +
        '<button type="button" class="h-del"' + (state.holders.length < 2 ? " disabled" : "") + ' aria-label="명의인 ' + (i + 1) + ' 삭제">삭제</button></div>'
      );
    }
    function renderHolders() {
      const box = $("holders");
      if (!box) return;
      box.innerHTML = state.holders.map(holderRowHTML).join("");
      markHolderErrors();
    }
    function partyName(role) { return role === "plaintiff" ? state.plaintiff : role === "defendant" ? state.defendant : ""; }
    /** 원고·피고 이름이 바뀌면 그 지위에 묶인 명의인 행의 이름을 따라 바꾼다 */
    function syncHolderNames() {
      state.holders.forEach((h, i) => {
        if (!h.auto || h.role === "third") return;
        h.name = partyName(h.role);
        const el = document.querySelector('#holders .holder[data-i="' + i + '"] .h-name');
        if (el && el.value !== h.name) el.value = h.name;
      });
    }
    function setCaretByDigits(input, nDigits) {
      try {
        let pos = 0, seen = 0;
        const v = input.value;
        while (pos < v.length && seen < nDigits) { if (/\d/.test(v[pos])) seen++; pos++; }
        input.setSelectionRange(pos, pos);
      } catch (e) { /* 일부 환경은 선택 범위를 지원하지 않는다 */ }
    }
    function onHolderInput(e) {
      const row = e.target.closest(".holder");
      if (!row) return;
      const h = state.holders[Number(row.dataset.i)];
      if (!h) return;
      if (e.target.classList.contains("h-name")) { h.name = e.target.value; h.auto = false; }
      else if (e.target.classList.contains("h-no")) {
        const input = e.target, before = input.value;
        const caret = typeof input.selectionStart === "number" ? input.selectionStart : before.length;
        const atEnd = caret >= before.length;
        const fmt = formatNoLive(before);
        if (fmt !== before) {
          const dBefore = digitsOnly(before.slice(0, caret)).length;
          input.value = fmt;
          if (atEnd) { try { input.setSelectionRange(fmt.length, fmt.length); } catch (err) { /* 무시 */ } }
          else setCaretByDigits(input, dBefore);
        }
        h.no = fmt;
      }
      render();
    }
    function onHolderChange(e) {
      const row = e.target.closest(".holder");
      if (!row) return;
      const h = state.holders[Number(row.dataset.i)];
      if (!h) return;
      if (e.target.classList.contains("h-role")) {
        const role = e.target.value;
        const nameEl = row.querySelector(".h-name");
        if (role === "third") {
          if (h.auto) { h.name = ""; if (nameEl) nameEl.value = ""; }
          h.auto = false;
        } else {
          const pn = partyName(role);
          if (pn || !clean(h.name)) { h.name = pn; h.auto = true; if (nameEl) nameEl.value = pn; }
          else h.auto = false;
        }
        h.role = role;
        h.roleAuto = false; // 직원이 직접 고른 지위는 우리 측 선택이 바뀌어도 유지한다
      }
      render();
    }
    /** 우리 측을 고르면 아직 지위를 직접 고르지 않은 명의인은 상대방 쪽으로 맞춘다 */
    function followOpponent() {
      if (state.ours !== "plaintiff" && state.ours !== "defendant") return;
      const role = state.ours === "plaintiff" ? "defendant" : "plaintiff";
      let moved = false;
      state.holders.forEach((h) => {
        if (!h.roleAuto || h.role === role) return;
        h.role = role;
        if (h.auto) h.name = partyName(role);
        moved = true;
      });
      if (moved) renderHolders();
    }
    function onHolderFocusOut(e) {
      if (!e.target.classList || !e.target.classList.contains("h-no")) return;
      const row = e.target.closest(".holder");
      const h = row && state.holders[Number(row.dataset.i)];
      if (!h) return;
      h.no = formatNo(e.target.value);
      e.target.value = h.no;
      render();
    }
    function addHolder() {
      const roles = state.holders.map((h) => h.role);
      const role = roles.indexOf("plaintiff") < 0 ? "plaintiff" : roles.indexOf("defendant") < 0 ? "defendant" : "third";
      state.holders.push({ role, name: role === "third" ? "" : partyName(role), no: "", auto: role !== "third" });
      renderHolders();
      render();
      const last = $$("#holders .holder").pop();
      const f = last && (last.querySelector(role === "third" ? ".h-name" : ".h-no"));
      if (f) f.focus();
    }
    function delHolder(i) {
      if (state.holders.length < 2) return;
      state.holders.splice(i, 1);
      renderHolders();
      render();
    }

    /* ---- 5.10 거래기간 ---- */
    function setPeriodInputs() {
      const set = (id, v) => { const el = $(id); if (el && el.value !== v) el.value = v; };
      set("per-start", state.period.start);
      set("per-end", state.period.end);
      const textOf = (iso) => formatDateKR(iso);
      const a = $("per-text-start"), b = $("per-text-end");
      if (a && document.activeElement !== a && !state.perErr.start) a.value = textOf(state.period.start);
      if (b && document.activeElement !== b && !state.perErr.end) b.value = textOf(state.period.end);
    }
    function onPeriodCal(which, value) {
      state.period[which] = isISO(value) ? value : "";
      state.perErr[which] = false;
      setPeriodInputs();
      render();
    }
    function onPeriodText(which, el) {
      const raw = el.value;
      if (!clean(raw)) { state.period[which] = ""; state.perErr[which] = false; }
      else {
        const iso = parsePeriodText(raw);
        state.period[which] = iso || "";
        state.perErr[which] = !iso;
      }
      const cal = $(which === "start" ? "per-start" : "per-end");
      if (cal) cal.value = state.period[which];
      render();
    }
    function applyPreset(kind) {
      const today = todayISO();
      if (kind === "today") state.period.end = today;
      else {
        const n = { "3y": 3, "5y": 5, "10y": 10 }[kind];
        if (!n) return;
        state.period.end = today;
        state.period.start = addYearsISO(today, -n);
      }
      state.perErr = { start: false, end: false };
      setPeriodInputs();
      ["per-text-start", "per-text-end"].forEach((id) => { const el = $(id); if (el) el.value = formatDateKR(id === "per-text-start" ? state.period.start : state.period.end); });
      render();
    }

    /* ---- 5.11 사용목적: Claude 다듬기 ---- */
    const PERMANENT = { not_granted: 1, sampling_disabled: 1, not_declared: 1, capability_disabled: 1, capability_removed: 1 };
    const POLISH_MSG = {
      rate_limited: "호출이 몰렸거나 사용 한도에 도달했습니다. 잠시 뒤 다시 눌러 주십시오.",
      session_expired: "로그인이 만료되었습니다. 다시 로그인한 뒤 눌러 주십시오.",
      refused: "Claude가 이 문장을 다듬지 못했습니다. 초안을 바꿔 다시 시도해 주십시오.",
      empty_completion: "응답이 비어 있었습니다. 초안을 보태 다시 눌러 주십시오.",
      invalid_json: "응답을 해석하지 못했습니다. 다시 눌러 주십시오.",
      prompt_too_large: "초안이 너무 깁니다. 줄여 주십시오.",
      upstream_error: "연결에 문제가 있었습니다. 다시 눌러 주십시오.",
    };
    function polishBox(html) {
      const el = $("polish-result");
      if (el) el.innerHTML = html;
    }
    function renderPolishResult() {
      const p = ui.polish;
      if (!p) return polishBox("");
      polishBox(
        '<div class="pol-row pol-before"><span class="pol-label">원문</span><p class="pol-text">' + esc(p.before) + "</p></div>" +
        '<div class="pol-row pol-after"><span class="pol-label">다듬은 문장</span><p class="pol-text">' + esc(p.text) + "</p></div>" +
        (p.changes.length ? '<ul class="pol-changes">' + p.changes.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul>" : "") +
        p.warnings.map((w) => '<p class="err">' + esc(w) + "</p>").join("") +
        '<div class="pol-actions"><button type="button" class="btn primary sm pol-apply">적용</button><button type="button" class="btn ghost sm pol-cancel">취소</button></div>'
      );
    }
    async function polish() {
      if (!Cap.sample || ui.polishing) return;
      const draft = clean($("purpose-text") ? $("purpose-text").value : "");
      if (!draft) { toast("다듬을 초안을 먼저 입력해 주십시오."); return; }
      const sentDraft = scrubText(draft, state);
      const prompt = buildPolishPrompt(sentDraft, scrubText(clean(state.caseName), state));
      ui.polish = null;
      ui.polishing = true;
      ui.ctl = typeof AbortController === "function" ? new AbortController() : null;
      polishBox('<p class="hint">Claude가 다듬는 중입니다…</p>');
      renderPurposeUI();
      const opts = { modelTier: "quick", cache: false };
      if (ui.ctl) opts.signal = ui.ctl.signal;
      try {
        const data = typeof Cap.sample.json === "function"
          ? await Cap.sample.json(prompt, opts)
          : extractJson((await Cap.sample(prompt, opts)).text);
        const res = validatePolish(data);
        if (!res) throw { code: "invalid_json" };
        const warnings = polishWarnings(sentDraft, res.text);
        if (sentDraft !== draft) warnings.push("초안의 이름·번호는 보내기 전에 '원고', '피고', '명의인' 등으로 바꿨습니다.");
        ui.polish = { before: draft, text: res.text, changes: res.changes, warnings };
        renderPolishResult();
      } catch (e) {
        const code = e && e.code;
        if (code === "cancelled") polishBox('<p class="hint">중단했습니다.</p>');
        else if (PERMANENT[code]) {
          Cap.sample = null;
          polishBox('<p class="hint">이 환경에서는 Claude 다듬기를 쓸 수 없어 직접 작성만 사용합니다.</p>');
          renderPills();
        } else polishBox('<p class="err">' + esc(POLISH_MSG[code] || POLISH_MSG.upstream_error) + "</p>");
      } finally {
        ui.polishing = false;
        ui.ctl = null;
        renderPurposeUI();
      }
    }

    /* ---- 5.12 DOCX ---- */
    async function getDownloads() {
      if (Cap.downloads !== undefined) return Cap.downloads;
      Cap.downloads = await getCap("downloads");
      return Cap.downloads;
    }
    async function saveDocx() {
      const btn = $("btn-docx");
      if (btn) btn.disabled = true;
      try {
        if (!root.docx) { toast("DOCX 라이브러리를 불러오지 못했습니다. 화면의 복사 기능을 이용해 주십시오."); return; }
        const doc = buildDocument(composeDoc(state), root.docx);
        const blob = await root.docx.Packer.toBlob(doc);
        const filename = makeFilename(state);
        const dl = await getDownloads();
        if (dl && typeof dl.save === "function") {
          try {
            await dl.save({ filename, data: blob });
            toast("저장했습니다: " + filename);
          } catch (e) {
            const code = e && e.code;
            if (code === "declined") toast("저장을 취소했습니다.");
            else if (code === "rate_limited") toast("저장 창이 이미 열려 있습니다. 잠시 뒤 다시 눌러 주십시오.");
            else toast("이 환경에서는 파일 저장을 쓸 수 없습니다. 화면의 복사 기능을 이용해 주십시오.");
          }
        } else if (!root.claude) {
          // 로컬 시험용: 아티팩트 밖에서만 링크 다운로드를 쓴다
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast("저장했습니다: " + filename);
        } else {
          toast("이 환경에서는 DOCX 저장을 지원하지 않습니다. 화면의 복사 기능을 이용해 주십시오.");
        }
      } catch (e) {
        toast("DOCX를 만들지 못했습니다. 입력을 확인한 뒤 다시 눌러 주십시오.");
      } finally {
        if (btn) btn.disabled = false;
      }
    }
    function onDocxClick() {
      const n = computeMissing(state).length;
      if (n && !ui.docxArmed) {
        ui.docxArmed = true;
        const btn = $("btn-docx");
        if (btn) btn.dataset.armed = "true";
        renderMissing();
        clearTimeout(ui.docxTimer);
        ui.docxTimer = setTimeout(disarmDocx, 5000);
        return;
      }
      disarmDocx();
      saveDocx();
    }

    /* ---- 5.13 초기화 ---- */
    function resetAll() {
      const fresh = newState();
      state.caseNo = ""; state.caseName = ""; state.plaintiff = ""; state.defendant = ""; state.ours = "";
      state.selected = [];
      state.holders = fresh.holders;
      state.period = fresh.period;
      state.perErr = fresh.perErr;
      state.purpose = fresh.purpose;
      state.wording = "auto";
      ui.search = ""; ui.polish = null; ui.editing = {}; ui.diff = [];
      ["case-no", "case-name", "plaintiff", "defendant", "inst-search", "purpose-text", "set-name", "upd-paste"].forEach((id) => { const e = $(id); if (e) e.value = ""; });
      ["ours-plaintiff", "ours-defendant"].forEach((id) => { const e = $(id); if (e) e.checked = false; });
      if ($("purpose-divorce")) $("purpose-divorce").checked = true;
      if ($("purpose-other")) $("purpose-other").checked = false;
      if ($("wording")) $("wording").value = "auto";
      if ($("upd-diff")) $("upd-diff").innerHTML = "";
      polishBox("");
      disarmDocx();
      setPeriodInputs();
      ["per-text-start", "per-text-end"].forEach((id) => { const el = $(id); if (el) el.value = id === "per-text-end" ? formatDateKR(state.period.end) : ""; });
      renderHolders();
      renderAllLists();
      render();
      toast("입력값을 모두 지웠습니다.");
    }

    /* ---- 5.14 연결 상태와 능력 ---- */
    async function getCap(name) {
      try {
        if (root.claude && typeof root.claude.use === "function") return (await root.claude.use(name)) || null;
      } catch (e) { /* 없는 것으로 처리 */ }
      return null;
    }
    function setPill(id, onState, text, title) {
      const el = $(id);
      if (!el) return;
      el.classList.toggle("on", !!onState);
      el.classList.toggle("off", !onState);
      el.textContent = text;
      if (title) el.title = title;
    }
    function renderPills() {
      if (Store.dbChecked) {
        if (Store.db && !Store.writeBlocked) setPill("st-db", true, "공용 저장 연결", "기관 추가·수정분과 선택 세트가 팀원과 공유됩니다.");
        else if (Store.db) setPill("st-db", false, "공용 저장 읽기 전용", "쓰기 권한이 없어 추가·수정분은 이 브라우저에만 저장됩니다.");
        else setPill("st-db", false, "이 브라우저에만 저장", "공용 저장소를 쓸 수 없어 추가·수정분은 이 브라우저에만 저장됩니다.");
      }
      if (Cap.sampleChecked) {
        if (Cap.sample) setPill("st-claude", true, "Claude 연결", "사용목적 다듬기를 쓸 수 있습니다.");
        else setPill("st-claude", false, "Claude 없음", "사용목적은 직접 작성만 쓸 수 있습니다.");
      }
    }

    /* ---- 5.15 화면 전환(좁은 화면) ---- */
    function applyPane() {
      const narrow = !!(mq && mq.matches);
      const f = $("pane-form"), p = $("pane-preview");
      if (f) f.hidden = narrow && ui.pane !== "form";
      if (p) p.hidden = narrow && ui.pane !== "preview";
      [["tab-form", "form"], ["tab-preview", "preview"]].forEach(([id, key]) => {
        const t = $(id);
        if (t) t.setAttribute("aria-selected", String(ui.pane === key));
      });
    }
    function showPane(key) {
      ui.pane = key;
      applyPane();
    }

    /* ---- 5.16 전체 다시 그리기 ---- */
    function renderAllLists() {
      renderCats();
      renderInstList();
      renderSelected();
      renderSets();
      renderUpdSummary();
    }

    /* ---- 5.17 이벤트 연결 ---- */
    function bind() {
      // 사건 정보
      on("case-no", "input", (e) => { state.caseNo = e.target.value; render(); });
      on("case-name", "input", (e) => { state.caseName = e.target.value; render(); });
      on("plaintiff", "input", (e) => { state.plaintiff = e.target.value; syncHolderNames(); render(); });
      on("defendant", "input", (e) => { state.defendant = e.target.value; syncHolderNames(); render(); });
      ["ours-plaintiff", "ours-defendant"].forEach((id) => on(id, "change", (e) => { if (e.target.checked) { state.ours = e.target.value; followOpponent(); render(); } }));
      on("wording", "change", (e) => { state.wording = e.target.value; render(); });

      // 기관 검색·분류·목록
      const onSearch = (e) => { ui.search = e.target.value; renderCats(); renderInstList(); };
      on("inst-search", "input", onSearch);
      on("inst-search", "search", onSearch);
      on("inst-filter-ready", "change", (e) => { ui.ready = !!e.target.checked; renderCats(); renderInstList(); });
      on("inst-cats", "click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        const cat = b.dataset.cat;
        if (b.classList.contains("cat-tab")) {
          ui.cat = cat;
          if (ui.search) { ui.search = ""; const s = $("inst-search"); if (s) s.value = ""; }
          renderCats();
          renderInstList();
        } else if (b.classList.contains("cat-all")) {
          visibleInsts().forEach((i) => { if (state.selected.indexOf(i.id) < 0) state.selected.push(i.id); });
          selectionChanged();
        } else if (b.classList.contains("cat-none")) {
          const ids = visibleInsts().map((i) => i.id);
          state.selected = state.selected.filter((id) => ids.indexOf(id) < 0);
          selectionChanged();
        }
      });
      on("inst-list", "change", (e) => {
        if (!e.target.classList.contains("inst-cb")) return;
        const l = e.target.closest(".inst-item");
        if (l) toggleInst(l.dataset.id, e.target.checked);
      });
      on("inst-list", "click", (e) => {
        const add = e.target.closest(".inst-add-from-search");
        if (add) { openAdd(add.dataset.q); return; }
        const del = e.target.closest(".inst-del");
        if (del) {
          e.preventDefault();
          const l = del.closest(".inst-item");
          armTwice(del, "삭제?", () => deleteCustom(l.dataset.id, (inst(l.dataset.id) || {}).short || ""), 4000);
        }
      });

      // 선택 목록
      on("inst-selected", "click", (e) => {
        const row = e.target.closest(".sel-row");
        const b = e.target.closest("button");
        if (!row || !b) return;
        const id = row.dataset.id;
        if (b.classList.contains("sel-up")) moveInst(id, -1);
        else if (b.classList.contains("sel-down")) moveInst(id, 1);
        else if (b.classList.contains("sel-del")) toggleInst(id, false);
        else if (b.classList.contains("sel-fill-save")) onFillSave(row);
        else if (b.classList.contains("sel-edit")) { ui.editing[id] = true; renderSelected(); const z = $$('.sel-row[data-id="' + id + '"] .sel-fill-zip')[0]; if (z) z.focus(); }
        else if (b.classList.contains("sel-fill-cancel")) { delete ui.editing[id]; renderSelected(); }
      });
      on("inst-selected", "input", (e) => {
        if (e.target.classList.contains("sel-fill-zip")) e.target.value = digitsOnly(e.target.value).slice(0, 5);
        if (e.target.hasAttribute("aria-invalid")) e.target.removeAttribute("aria-invalid");
      });
      on("inst-selected", "keydown", (e) => {
        if (e.key === "Enter" && e.target.closest(".sel-fill") && e.target.tagName === "INPUT") {
          e.preventDefault();
          onFillSave(e.target.closest(".sel-row"));
        }
      });

      // 기관 추가
      on("btn-add-inst-open", "click", () => { const f = $("add-inst"); if (f && !f.hidden) closeAdd(); else openAdd(); });
      on("add-save", "click", saveAdd);
      on("add-cancel", "click", closeAdd);
      on("add-zip", "input", (e) => { e.target.value = digitsOnly(e.target.value).slice(0, 5); });
      ["add-name", "add-zip", "add-addr", "add-note"].forEach((id) => on(id, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveAdd(); } }));

      // 최신화
      on("btn-update-open", "click", () => {
        const p = $("update-panel");
        if (!p) return;
        p.hidden = !p.hidden;
        if (!p.hidden) renderUpdSummary();
      });
      on("upd-close", "click", () => { const p = $("update-panel"); if (p) p.hidden = true; });
      on("upd-copy", "click", (e) => copyText(buildUpdateRequest(catalogList, todayISO()), "요청문을", e.currentTarget.closest("li") || e.currentTarget));
      on("upd-check", "click", checkUpdate);
      on("upd-apply", "click", applyUpdate);
      on("upd-diff", "change", (e) => {
        if (e.target.classList.contains("diff-cb-all")) $$(".diff-cb", $("upd-diff")).forEach((c) => { c.checked = e.target.checked; });
      });

      // 선택 세트
      on("set-save", "click", saveSet);
      on("set-name", "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveSet(); } });
      on("set-list", "click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.classList.contains("set-load")) loadSet(b.dataset.id);
        else if (b.classList.contains("set-del")) {
          armTwice(b, "삭제?", async () => { await Store.delSet(b.dataset.id); toast("세트를 삭제했습니다."); }, 4000);
        }
      });

      // 명의인
      on("holders", "input", onHolderInput);
      on("holders", "change", onHolderChange);
      on("holders", "focusout", onHolderFocusOut);
      on("holders", "click", (e) => {
        const b = e.target.closest(".h-del");
        if (b) delHolder(Number(b.closest(".holder").dataset.i));
      });
      on("btn-add-holder", "click", addHolder);

      // 거래기간
      ["per-mode-cal", "per-mode-text"].forEach((id) => on(id, "change", (e) => {
        if (!e.target.checked) return;
        state.perMode = e.target.value === "text" ? "text" : "cal";
        setPeriodInputs();
        render();
      }));
      on("per-presets", "click", (e) => { const b = e.target.closest("[data-preset]"); if (b) applyPreset(b.dataset.preset); });
      on("per-start", "input", (e) => onPeriodCal("start", e.target.value));
      on("per-start", "change", (e) => onPeriodCal("start", e.target.value));
      on("per-end", "input", (e) => onPeriodCal("end", e.target.value));
      on("per-end", "change", (e) => onPeriodCal("end", e.target.value));
      on("per-text-start", "input", (e) => onPeriodText("start", e.target));
      on("per-text-end", "input", (e) => onPeriodText("end", e.target));
      ["per-text-start", "per-text-end"].forEach((id) => on(id, "blur", () => { setPeriodInputs(); }));

      // 사용목적
      ["purpose-divorce", "purpose-other"].forEach((id) => on(id, "change", (e) => {
        if (!e.target.checked) return;
        state.purpose.type = e.target.value === "other" ? "other" : "divorce";
        render();
      }));
      on("purpose-text", "input", (e) => { state.purpose.text = e.target.value; render(); });
      on("btn-polish", "click", polish);
      on("btn-polish-stop", "click", () => { if (ui.ctl) ui.ctl.abort(); });
      on("polish-result", "click", (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.classList.contains("pol-apply") && ui.polish) {
          state.purpose.text = ui.polish.text;
          const t = $("purpose-text");
          if (t) t.value = ui.polish.text;
          ui.polish = null;
          polishBox("");
          render();
          toast("다듬은 문장을 적용했습니다.");
        } else if (b.classList.contains("pol-cancel")) { ui.polish = null; polishBox(""); }
      });

      // 미리보기·복사·저장·초기화
      on("doc-preview", "click", (e) => {
        const b = e.target.closest(".btn-copy");
        if (!b) return;
        const sec = Number(b.dataset.copy);
        copyText(sectionText(composeDoc(state), sec), HEADS[sec - 1].replace(/^\d\.\s*/, "") + " 항목을", b.closest("h3") || b);
      });
      on("btn-copy-all", "click", (e) => copyText(blocksToText(composeDoc(state)), "신청서 전체를", e.currentTarget));
      on("btn-docx", "click", onDocxClick);
      on("btn-reset", "click", (e) => armTwice(e.currentTarget, "한 번 더 누르면 모두 지웁니다", resetAll, 5000));

      // 미입력 점검 항목 → 해당 입력으로 이동
      const go = (li) => {
        const sel = li && li.dataset.go;
        if (!sel) return;
        if (mq && mq.matches) showPane("form");
        let el = null;
        try { el = document.querySelector(sel); } catch (err) { el = null; }
        if (!el && sel.indexOf(".sel-row") === 0) el = document.querySelector("#inst-selected .sel-row .sel-fill-zip");
        if (el) { if (el.scrollIntoView) el.scrollIntoView({ block: "center" }); el.focus(); }
      };
      on("missing-list", "click", (e) => go(e.target.closest(".miss-item")));
      on("missing-list", "keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e.target.closest(".miss-item")); } });

      // 좁은 화면 탭
      on("tab-form", "click", () => showPane("form"));
      on("tab-preview", "click", () => showPane("preview"));
      if (typeof root.matchMedia === "function") {
        mq = root.matchMedia("(max-width: 900px)");
        const h = () => applyPane();
        if (mq.addEventListener) mq.addEventListener("change", h); else if (mq.addListener) mq.addListener(h);
      }
    }

    /* ---- 5.18 시작 ---- */
    function start() {
      Store.loadLocal();
      Store.onChange = () => { syncCatalog(); renderAllLists(); render(); renderPills(); };
      syncCatalog();

      // 초기 입력값
      const e = $("per-end");
      if (e) e.value = state.period.end;
      const te = $("per-text-end");
      if (te) te.value = formatDateKR(state.period.end);
      const ro = $("ours-plaintiff");
      if (ro) state.ours = ro.checked ? "plaintiff" : $("ours-defendant") && $("ours-defendant").checked ? "defendant" : "";
      followOpponent();
      renderHolders();
      syncHolderNames();
      bind();
      renderAllLists();
      applyPane();
      render();

      if (!root.claude || typeof root.claude.use !== "function") {
        Store.dbChecked = true;
        Cap.sampleChecked = true;
        renderPills();
        return;
      }
      // 능력은 비동기로 확인한다. 없으면 해당 기능만 끈다.
      (async () => {
        const [user, db] = await Promise.all([getCap("user"), getCap("db")]);
        let canWrite = null;
        try {
          if (user) {
            canWrite = await user.can("data.write");
            Store.uid = (await user.id()) || "";
          }
        } catch (err) { canWrite = null; }
        Store.attach(db, user, canWrite);
        renderPills();
      })();
      getCap("sample").then((s) => {
        Cap.sample = s;
        Cap.sampleChecked = true;
        renderPills();
        renderPurposeUI();
      });
    }

    api.getState = () => state;
    start();
  }

  /* ======================================================================
   * 6. 내보내기
   * ====================================================================== */
  const api = {
    // 문서
    composeDoc, blocksToText, sectionText, buildDocument, computeMissing, makeFilename,
    // 서식
    formatNo, formatNoLive, noDigitCount, noLengthOk, formatDateKR, parsePeriodText, josaEulReul,
    hangulLetter, instMarker, todayISO, addYearsISO, isISO, splitAddrNote, addrLine,
    // 기관
    searchMatch, toChosung, mergeInstitutions, resolveWording, purposeSubjectRuns, isReady, hasAddr,
    // 최신화·다듬기
    parseUpdateJson, classifyUpdate, buildUpdateRequest, scrubText, buildPolishPrompt, validatePolish, polishWarnings, extractJson,
    // 기타
    newState, Store,
    consts: { UNDERLINE_BRACKETS, COPY_SECTION_HEADING, TITLE, HEADS, LETTERS },
  };
  root.__finorder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (HAS_DOM) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
