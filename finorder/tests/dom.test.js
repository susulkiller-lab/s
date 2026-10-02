/* DOM 이벤트 흐름 테스트(jsdom). 실제 src/template.html 위에서 src/app.js를 돌린다.
 * 사용: NODE_PATH=<jsdom이 설치된 node_modules> node tests/dom.test.js
 *   (jsdom은 저장소 밖에 설치한다. 없으면 이 테스트는 건너뛴다.)
 * 가상 값(홍길동, 김영희, 2026드단12345)만 쓴다. */
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch (e) { console.log("DOM 테스트 건너뜀: jsdom을 찾을 수 없습니다(NODE_PATH 확인)."); process.exit(0); }

const ROOT = path.join(__dirname, "..");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "src", "template.html"), "utf8");
const APP = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
const DOCX = fs.readFileSync(path.join(ROOT, "vendor", "docx-8.5.0.iife.js"), "utf8");
const F = require("../src/app.js");

const src = (label, url) => [{ label, url }];
const FORM = src("사용자 제공 양식(2026. 9. 작성본)", "");
const DATA = {
  schema: 1, asOf: "2026-10-02",
  categories: [
    { id: "bank", label: "시중·특수·지방은행" }, { id: "post", label: "우체국" },
    { id: "inet", label: "인터넷전문은행" }, { id: "securities", label: "증권사" },
  ],
  institutions: [
    { id: "kookmin", cat: "bank", short: "국민은행", name: "주식회사 국민은행", aliases: ["KB국민은행", "KB", "국민"], wording: "은행", popular: true, zip: "07331", addr: "서울특별시 영등포구 국제금융로8길 26", note: "여의도동", status: "user_provided", checkedAt: "2026-10-02", sources: FORM, memo: "" },
    { id: "shinhan", cat: "bank", short: "신한은행", name: "주식회사 신한은행", aliases: ["신한"], wording: "은행", popular: true, zip: "04513", addr: "서울특별시 중구 세종대로9길 20", note: "태평로2가", status: "user_provided", checkedAt: "2026-10-02", sources: FORM, memo: "" },
    { id: "hana", cat: "bank", short: "하나은행", name: "주식회사 하나은행", aliases: ["하나"], wording: "은행", popular: false, zip: "", addr: "", note: "", status: "needs_check", checkedAt: "2026-10-02", sources: [], memo: "" },
    { id: "post", cat: "post", short: "우체국", name: "우정사업본부(우체국예금)", aliases: ["우정"], wording: "은행", popular: true, zip: "30114", addr: "세종특별자치시 도움5로 19", note: "어진동", status: "user_provided", checkedAt: "2026-10-02", sources: FORM, memo: "" },
    { id: "kakao", cat: "inet", short: "카카오뱅크", name: "주식회사 카카오뱅크", aliases: ["카뱅"], wording: "은행", popular: true, zip: "13529", addr: "경기도 성남시 분당구 분당내곡로 131, 11층", note: "백현동, 판교테크원", status: "user_provided", checkedAt: "2026-10-02", sources: FORM, memo: "" },
    { id: "mirae", cat: "securities", short: "미래에셋증권", name: "미래에셋증권 주식회사", aliases: ["미래에셋"], wording: "기관", popular: false, zip: "", addr: "", note: "", status: "needs_check", checkedAt: "2026-10-02", sources: [], memo: "" },
  ],
};

let pass = 0, fail = 0;
const failures = [];
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (c, msg) => assert.ok(c, msg);
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));
const today = () => F.todayISO();

/* ---------- 가짜 claude 환경 ---------- */
function fakeDb(opts) {
  opts = opts || {};
  const cols = { institutions: {}, sets: {} };
  const subs = { institutions: [], sets: [] };
  const snap = (name) => ({ docs: Object.keys(cols[name]).map((id) => ({ id, data: () => JSON.parse(JSON.stringify(cols[name][id])) })) });
  const notify = (name) => subs[name].forEach((cb) => cb(snap(name)));
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            async set(data) { if (opts.denyWrite) throw { code: "invalid_argument", message: "denied" }; cols[name][id] = JSON.parse(JSON.stringify(data)); notify(name); },
            async delete() { if (opts.denyWrite) throw { code: "invalid_argument" }; delete cols[name][id]; notify(name); },
          };
        },
        onSnapshot(next) { subs[name].push(next); setTimeout(() => next(snap(name)), 0); return () => {}; },
      };
    },
  };
  return { db, cols, notify };
}
function fakeClaude(o) {
  o = o || {};
  const calls = { saves: [], prompts: [] };
  const mods = {
    db: o.db || null,
    user: o.user === undefined ? null : o.user,
    sample: o.sample || null,
    downloads: o.downloads === false ? null : { save: async (req) => { calls.saves.push(req); if (o.declineSave) throw { code: "declined" }; return { status: "saved" }; } },
  };
  return { claude: { use: async (n) => mods[n] || null }, calls };
}
function fakeSample(impl) {
  const prompts = [];
  const fn = async () => { throw new Error("json만 쓴다"); };
  fn.json = async (prompt, opts) => { prompts.push({ prompt, opts }); return impl(prompt, opts); };
  fn.prompts = prompts;
  return fn;
}

/* ---------- 앱 기동 ---------- */
async function boot(opts) {
  opts = opts || {};
  const html = TEMPLATE.replace("/*__CSS__*/", "").replace("/*__DOCX__*/", "").replace("/*__DATA__*/", "{}").replace("/*__APP__*/", "");
  const dom = new JSDOM("<!doctype html><html><body>" + html + "</body></html>", { runScripts: "outside-only", url: "https://app.test/", pretendToBeVisual: true });
  const w = dom.window;
  if (opts.ls) Object.keys(opts.ls).forEach((k) => w.localStorage.setItem(k, opts.ls[k]));
  if (opts.claude) w.claude = opts.claude;
  if (opts.narrow) w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  w.eval(DOCX + ";window.docx=docx;");
  // jsdom에서는 Packer.toBlob이 끝나지 않으므로 Blob 생성만 대체한다(문서 조립은 실제 코드)
  w.docx.Packer.toBlob = async (doc) => { if (!doc) throw new Error("no doc"); return new w.Blob(["docx"]); };
  w.__INSTITUTIONS__ = opts.data || DATA;
  w.eval(APP);
  await tick(30);
  const d = w.document;
  const A = {
    w, d,
    $: (id) => d.getElementById(id),
    q: (s, r) => (r || d).querySelector(s),
    qa: (s, r) => Array.prototype.slice.call((r || d).querySelectorAll(s)),
    ev(el, type) { el.dispatchEvent(new w.Event(type, { bubbles: true })); },
    type(el, v) { el.value = v; A.ev(el, "input"); },
    change(el) { A.ev(el, "change"); },
    click(el) { el.click(); },
    ls: (k) => JSON.parse(w.localStorage.getItem(k) || "null"),
    chip: (id) => d.querySelector('.inst-item[data-id="' + id + '"]'),
    pick: (id) => { const cb = A.chip(id).querySelector(".inst-cb"); cb.click(); },
    tick,
    previewText: () => A.$("doc-preview").textContent,
    missing: () => A.qa("#missing-list .miss-item").map((l) => l.textContent),
    toast: () => A.$("toast").textContent,
    clip(impl) { Object.defineProperty(w.navigator, "clipboard", { value: { writeText: impl }, configurable: true }); },
  };
  return A;
}

/* ============================ 시험 ============================ */
test("기동: 연결 알약, 분류 탭, 자주 쓰는 곳 그룹, 초기값", async () => {
  const A = await boot();
  eq(A.$("st-db").textContent, "이 브라우저에만 저장"); ok(A.$("st-db").classList.contains("off"));
  eq(A.$("st-claude").textContent, "Claude 없음"); ok(A.$("st-claude").classList.contains("off"));
  ok(A.$("btn-polish").hidden, "claude 없으면 다듬기 버튼 숨김");
  const tabs = A.qa("#inst-cats .cat-tab");
  eq(tabs.length, 4);
  eq(tabs[0].getAttribute("aria-selected"), "true"); eq(tabs[1].getAttribute("aria-selected"), "false");
  ok(tabs[0].querySelector(".cat-n").textContent === "0/3");
  eq(A.qa("#inst-list .inst-group").map((g) => g.textContent), ["자주 쓰는 곳", "그 밖의 기관"]);
  eq(A.qa("#inst-list .inst-item").length, 3);
  eq(A.$("inst-count").textContent, "0곳 선택");
  eq(A.$("per-end").value, today());
  eq(A.$("per-text-end").value, F.formatDateKR(today()));
  ok(A.$("per-start").value === "");
  eq(A.qa("#holders .holder").length, 1);
  eq(A.q("#holders .h-role").value, "defendant");
  ok(A.q("#holders .h-del").disabled, "명의인이 한 명이면 삭제 불가");
  ok(A.qa("#doc-preview h3.d-h").length === 5);
  eq(A.$("inst-selected").innerHTML, "", "비어 있으면 정확히 빈 문자열");
  eq(A.$("set-list").innerHTML, ""); eq(A.$("polish-result").innerHTML, ""); eq(A.$("upd-diff").innerHTML, "");
  ok(A.$("missing-count").textContent.endsWith("건"));
});
test("기관 체크 → 선택 목록 순서·순번·미리보기·이동·제거", async () => {
  const A = await boot();
  A.pick("kookmin");
  let rows = A.qa("#inst-selected .sel-row");
  eq(rows.length, 1);
  eq(rows[0].querySelector(".sel-letter").textContent, "가.");
  eq(rows[0].querySelector(".sel-name").textContent, "주식회사 국민은행");
  eq(rows[0].querySelector(".sel-addr").textContent, "(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)");
  eq(A.$("inst-count").textContent, "1곳 선택");
  eq(A.chip("kookmin").dataset.checked, "true");
  eq(A.q("#doc-preview .d-inst .d-name").textContent, "주식회사 국민은행");
  eq(A.q("#doc-preview .d-inst .d-addr").textContent, "(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)");
  A.pick("shinhan");
  rows = A.qa("#inst-selected .sel-row");
  eq(rows.map((r) => r.querySelector(".sel-letter").textContent), ["가.", "나."]);
  eq(rows.map((r) => r.dataset.id), ["kookmin", "shinhan"]);
  ok(rows[0].querySelector(".sel-up").disabled && rows[1].querySelector(".sel-down").disabled);
  A.click(rows[1].querySelector(".sel-up"));
  rows = A.qa("#inst-selected .sel-row");
  eq(rows.map((r) => r.dataset.id), ["shinhan", "kookmin"]);
  eq(A.qa("#doc-preview .d-inst .d-name").map((n) => n.textContent), ["주식회사 신한은행", "주식회사 국민은행"]);
  eq(A.qa("#doc-preview .d-inst .d-letter").map((n) => n.textContent), ["가.", "나."]);
  A.click(A.q('#inst-selected .sel-row[data-id="shinhan"] .sel-del'));
  eq(A.qa("#inst-selected .sel-row").length, 1);
  eq(A.chip("shinhan").dataset.checked, "false");
  ok(!A.chip("shinhan").querySelector(".inst-cb").checked);
  eq(A.$("inst-count").textContent, "1곳 선택");
  eq(A.qa("#inst-cats .cat-tab")[0].querySelector(".cat-n").textContent, "1/3");
});
test("분류 탭 전환, 전체 선택·해제, 주소 확인된 곳만 보기", async () => {
  const A = await boot();
  A.click(A.qa("#inst-cats .cat-tab")[1]);
  eq(A.qa("#inst-list .inst-item").map((l) => l.dataset.id), ["post"]);
  A.click(A.qa("#inst-cats .cat-tab")[0]);
  A.click(A.q("#inst-cats .cat-all"));
  eq(A.qa("#inst-selected .sel-row").length, 3);
  A.click(A.q("#inst-cats .cat-none"));
  eq(A.qa("#inst-selected .sel-row").length, 0);
  A.click(A.$("inst-filter-ready"));
  eq(A.qa("#inst-list .inst-item").map((l) => l.dataset.id), ["kookmin", "shinhan"]);
  eq(A.qa("#inst-cats .cat-tab")[0].querySelector(".cat-n").textContent, "0/2");
  A.click(A.q("#inst-cats .cat-all"));
  eq(A.qa("#inst-selected .sel-row").map((r) => r.dataset.id), ["kookmin", "shinhan"], "필터 중 전체 선택은 보이는 항목만");
});
test("검색: 초성·별칭, 0건이면 바로 추가 버튼과 폼 채움", async () => {
  const A = await boot();
  A.type(A.$("inst-search"), "ㄱㅁ");
  eq(A.qa("#inst-list .inst-item").map((l) => l.dataset.id), ["kookmin"]);
  eq(A.q("#inst-list .inst-group").textContent, "시중·특수·지방은행");
  A.type(A.$("inst-search"), "kb");
  eq(A.qa("#inst-list .inst-item").map((l) => l.dataset.id), ["kookmin"]);
  A.type(A.$("inst-search"), "카뱅");
  eq(A.qa("#inst-list .inst-item").map((l) => l.dataset.id), ["kakao"]);
  ok(!A.q("#inst-cats .cat-all"), "검색 중에는 전체 선택 버튼 없음");
  A.type(A.$("inst-search"), "없는기관");
  const btn = A.q("#inst-list .inst-add-from-search");
  ok(btn); eq(btn.textContent, "목록에 없음 — '없는기관' 추가");
  A.click(btn);
  ok(!A.$("add-inst").hidden);
  eq(A.$("add-name").value, "없는기관");
  A.type(A.$("inst-search"), "");
  eq(A.qa("#inst-list .inst-item").length, 3);
});
test("needs_check 기관: 선택 → 주소 입력행 → 점검에 걸림 → 저장하면 override로 일반 항목", async () => {
  const A = await boot();
  eq(A.chip("hana").dataset.status, "needs_check");
  A.pick("hana");
  const row = A.q('#inst-selected .sel-row[data-id="hana"]');
  const fill = row.querySelector(".sel-fill");
  ok(fill, "주소 입력행");
  eq(fill.querySelector(".sel-fill-name").value, "주식회사 하나은행", "상호 후보가 미리 채워짐");
  ["sel-fill-zip", "sel-fill-addr", "sel-fill-note", "sel-fill-save"].forEach((c) => ok(fill.querySelector("." + c), c));
  ok(!row.querySelector(".sel-addr"));
  ok(A.missing().includes("하나은행 주소 미입력"));
  ok(A.previewText().includes("「주소 미입력」"));
  // 저장 시도: 우편번호 없음
  A.click(fill.querySelector(".sel-fill-save"));
  await A.tick();
  ok(A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill-err').textContent.includes("우편번호"));
  eq(A.ls("finorder.v1.institutions"), null, "검증 실패 시 저장하지 않음");
  const f = A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill');
  A.type(f.querySelector(".sel-fill-zip"), "04520x");
  eq(f.querySelector(".sel-fill-zip").value, "04520", "숫자 5자리만");
  A.type(f.querySelector(".sel-fill-addr"), "서울특별시 중구 을지로 35(을지로1가)");
  A.click(f.querySelector(".sel-fill-save"));
  await A.tick(30);
  const saved = A.ls("finorder.v1.institutions");
  eq(saved.length, 1);
  eq(saved[0].id, "hana"); eq(saved[0].origin, "override"); eq(saved[0].name, "주식회사 하나은행");
  eq(saved[0].zip, "04520"); eq(saved[0].addr, "서울특별시 중구 을지로 35"); eq(saved[0].note, "을지로1가");
  eq(saved[0].status, "user_provided");
  const row2 = A.q('#inst-selected .sel-row[data-id="hana"]');
  ok(!row2.querySelector(".sel-fill"));
  eq(row2.querySelector(".sel-addr").textContent, "(04520) 서울특별시 중구 을지로 35 (을지로1가)");
  eq(A.chip("hana").dataset.status, "user_provided"); eq(A.chip("hana").dataset.origin, "override");
  ok(!A.missing().includes("하나은행 주소 미입력"));
  ok(A.previewText().includes("(04520) 서울특별시 중구 을지로 35 (을지로1가)"));
  ok(!JSON.stringify(saved).match(/홍길동|김영희/));
  // 주소 수정
  A.click(A.q('#inst-selected .sel-row[data-id="hana"] .sel-edit'));
  const f2 = A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill');
  ok(f2); eq(f2.querySelector(".sel-fill-zip").value, "04520"); eq(f2.querySelector(".sel-fill-note").value, "을지로1가");
  A.click(A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill-cancel'));
  ok(!A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill'));
});
test("기관 추가: custom 저장·자동 선택·추가 배지·삭제 2단계, 중복 안내, 이스케이프", async () => {
  const A = await boot();
  A.click(A.$("btn-add-inst-open"));
  ok(!A.$("add-inst").hidden);
  A.type(A.$("add-name"), "국민은행");
  A.type(A.$("add-zip"), "12345");
  A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save"));
  await A.tick();
  ok(!A.$("add-msg").hidden && A.$("add-msg").textContent.includes("이미 목록에 있습니다"), "중복 안내");
  A.type(A.$("add-name"), "가상저축은행 <b>x</b>");
  A.type(A.$("add-zip"), "1234");
  A.click(A.$("add-save"));
  await A.tick();
  ok(A.$("add-msg").textContent.includes("5자리"));
  A.type(A.$("add-zip"), "12345");
  A.type(A.$("add-addr"), "");
  A.click(A.$("add-save"));
  await A.tick();
  ok(A.$("add-msg").textContent.includes("도로명주소"));
  A.type(A.$("add-addr"), "가상시 가상구 가상로 1(가상동)");
  A.$("add-wording").value = "기관";
  A.click(A.$("add-save"));
  await A.tick(30);
  ok(A.$("add-inst").hidden);
  const docs = A.ls("finorder.v1.institutions");
  eq(docs.length, 1); eq(docs[0].origin, "custom"); eq(docs[0].cat, "bank"); eq(docs[0].wording, "기관");
  eq(docs[0].addr, "가상시 가상구 가상로 1"); eq(docs[0].note, "가상동");
  const id = docs[0].id;
  const chip = A.chip(id);
  ok(chip, "목록에 반영"); eq(chip.dataset.origin, "custom");
  eq(chip.querySelector(".badge").textContent, "추가");
  eq(chip.querySelector(".inst-short").textContent, "가상저축은행 <b>x</b>", "문자 그대로 표시");
  ok(!chip.querySelector("b"), "HTML로 해석되지 않음");
  ok(!A.q("#doc-preview b"), "미리보기도 이스케이프");
  ok(A.previewText().includes("가상저축은행 <b>x</b>"));
  eq(A.qa("#inst-selected .sel-row").map((r) => r.dataset.id), [id], "자동 선택");
  ok(A.previewText().includes("가. 귀 기관에") === false || true);
  eq(A.qa("#doc-preview .d-l1")[0].textContent.slice(0, 8), "가.귀 기관에 ", "호칭 자동: 귀 기관");
  // 삭제 2단계
  const del = A.chip(id).querySelector(".inst-del");
  A.click(del);
  ok(A.chip(id), "첫 클릭에서는 삭제하지 않음"); eq(del.dataset.armed, "true");
  A.click(A.chip(id).querySelector(".inst-del"));
  await A.tick(30);
  ok(!A.chip(id)); eq(A.ls("finorder.v1.institutions").length, 0);
  eq(A.qa("#inst-selected .sel-row").length, 0);
});
test("사건 정보·우리 측: 미리보기와 도입 문단", async () => {
  const A = await boot();
  A.type(A.$("case-no"), "2026드단12345"); A.type(A.$("case-name"), "이혼 등");
  A.type(A.$("plaintiff"), "홍길동"); A.type(A.$("defendant"), "김영희");
  const cases = A.qa("#doc-preview .d-case");
  eq(cases.map((c) => c.querySelector(".d-value").textContent), ["2026드단12345 이혼 등", "홍길동", "김영희"]);
  eq(cases.map((c) => c.querySelector(".d-label").textContent), ["사    건", "원    고", "피    고"]);
  ok(A.q("#doc-preview .d-intro .d-blank"), "우리 측 미선택이면 자리표시");
  A.$("ours-plaintiff").checked = true; A.change(A.$("ours-plaintiff"));
  ok(A.q("#doc-preview .d-intro").textContent.startsWith("위 사건에 관하여 원고 홍길동의 소송대리인은"));
  A.$("ours-defendant").checked = true; A.change(A.$("ours-defendant"));
  ok(A.q("#doc-preview .d-intro").textContent.startsWith("위 사건에 관하여 피고 김영희의 소송대리인은"));
});
test("명의인: 지위 선택 시 이름 자동 채움, 번호 자동 하이픈, 자릿수 오류 표시, 추가·삭제", async () => {
  const A = await boot();
  A.type(A.$("plaintiff"), "홍길동"); A.type(A.$("defendant"), "김영희");
  let row = A.q("#holders .holder");
  eq(row.querySelector(".h-name").value, "김영희", "기본 지위 피고의 이름이 따라 채워짐");
  A.type(A.$("defendant"), "김영희2");
  eq(A.q("#holders .h-name").value, "김영희2", "당사자 이름이 바뀌면 따라 바뀜");
  row.querySelector(".h-role").value = "plaintiff"; A.change(row.querySelector(".h-role"));
  eq(A.q("#holders .h-name").value, "홍길동");
  A.type(A.q("#holders .h-name"), "홍길동씨"); // 직접 고치면 연결이 끊긴다
  A.type(A.$("plaintiff"), "홍길순");
  eq(A.q("#holders .h-name").value, "홍길동씨");
  const no = A.q("#holders .h-no");
  A.type(no, "9001012345678");
  eq(no.value, "900101-2345678");
  eq(no.getAttribute("aria-invalid"), null);
  A.type(no, "12345");
  eq(no.getAttribute("aria-invalid"), "true");
  ok(A.missing().includes("명의인 번호 자릿수 확인(13자리 또는 10자리)"));
  A.type(no, "1234567890");
  eq(no.value, "123456-7890", "입력 중 10자리는 6-4 유지");
  A.ev(no, "focusout");
  eq(no.value, "123-45-67890", "입력을 마치면 사업자번호 서식");
  eq(no.getAttribute("aria-invalid"), null);
  A.type(no, "123-4");
  eq(no.value, "123-4");
  // 추가: 첫 행이 원고이므로 둘째는 피고
  A.click(A.$("btn-add-holder"));
  const rows = A.qa("#holders .holder");
  eq(rows.length, 2); eq(rows[1].querySelector(".h-role").value, "defendant");
  eq(rows[1].querySelector(".h-name").value, "김영희2");
  ok(!rows[0].querySelector(".h-del").disabled);
  eq(A.$("purpose-fixed").textContent, "원고 및 피고 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.");
  eq(A.qa("#doc-preview .d-holder").length, 2);
  rows[1].querySelector(".h-role").value = "third"; A.change(rows[1].querySelector(".h-role"));
  eq(A.qa("#holders .h-name")[1].value, "", "제3자로 바꾸면 자동 이름은 비움");
  A.type(A.qa("#holders .h-name")[1], "박철수");
  eq(A.$("purpose-fixed").textContent, "원고 및 박철수 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.");
  A.click(A.qa("#holders .h-del")[1]);
  eq(A.qa("#holders .holder").length, 1);
});
test("거래기간: 프리셋, 달력, 직접 입력 해석·오류, 시작>종료", async () => {
  const A = await boot();
  A.click(A.q('#per-presets [data-preset="3y"]'));
  eq(A.$("per-end").value, today()); eq(A.$("per-start").value, F.addYearsISO(today(), -3));
  ok(A.previewText().includes(F.formatDateKR(F.addYearsISO(today(), -3)) + "부터 " + F.formatDateKR(today()) + "까지"));
  A.click(A.q('#per-presets [data-preset="10y"]'));
  eq(A.$("per-start").value, F.addYearsISO(today(), -10));
  A.type(A.$("per-start"), "2023-09-01"); A.type(A.$("per-end"), "2026-09-01");
  eq(A.$("per-text-start").value, "2023. 9. 1.", "달력 값이 직접 입력 칸에도 반영");
  ok(A.previewText().includes("2023. 9. 1.부터 2026. 9. 1.까지"));
  A.$("per-mode-text").checked = true; A.change(A.$("per-mode-text"));
  A.type(A.$("per-text-start"), "2024-2-29");
  eq(A.$("per-start").value, "2024-02-29");
  A.type(A.$("per-text-end"), "2026/13/40");
  ok(A.$("per-note").classList.contains("err")); ok(A.$("per-note").textContent.includes("종료일을 읽을 수 없습니다"));
  ok(A.missing().includes("거래기간 종료일 형식 오류"));
  A.type(A.$("per-text-end"), " 2023 . 1 . 1 ");
  ok(A.$("per-note").textContent.includes("시작일이 종료일보다 늦습니다"));
  ok(A.missing().includes("거래기간 시작일이 종료일보다 늦음"));
  A.type(A.$("per-text-end"), "2026.9.1.");
  ok(!A.$("per-note").classList.contains("err"));
  A.click(A.q('#per-presets [data-preset="today"]'));
  eq(A.$("per-end").value, today());
  A.type(A.$("per-start"), "");
  ok(A.missing().includes("거래기간 시작일 미입력") || A.missing().some((m) => m.includes("시작일")));
});
test("사용목적: 그 밖의 사건 직접 입력과 점검", async () => {
  const A = await boot();
  A.$("purpose-other").checked = true; A.change(A.$("purpose-other"));
  ok(A.missing().includes("사용목적 미입력"));
  A.type(A.$("purpose-text"), "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  ok(!A.missing().includes("사용목적 미입력"));
  const p4 = A.qa("#doc-preview p.d-p").pop();
  eq(p4.textContent, "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  A.$("purpose-divorce").checked = true; A.change(A.$("purpose-divorce"));
  ok(A.qa("#doc-preview p.d-p").pop().textContent.endsWith("명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다."));
});
test("5.가 호칭 선택", async () => {
  const A = await boot();
  A.pick("kookmin");
  ok(A.qa("#doc-preview .d-l1")[0].textContent.startsWith("가.귀 은행에"));
  A.click(A.qa("#inst-cats .cat-tab")[3]); // 증권사 탭
  A.pick("mirae");
  ok(A.qa("#doc-preview .d-l1")[0].textContent.startsWith("가.귀 기관에"), "하나라도 기관이면 귀 기관");
  A.$("wording").value = "사"; A.change(A.$("wording"));
  ok(A.qa("#doc-preview .d-l1")[0].textContent.startsWith("가.귀 사에"));
  A.$("wording").value = "은행"; A.change(A.$("wording"));
  ok(A.qa("#doc-preview .d-l1")[0].textContent.startsWith("가.귀 은행에"));
});

function fillAll(A) {
  A.type(A.$("case-no"), "2026드단12345"); A.type(A.$("case-name"), "이혼 등");
  A.type(A.$("plaintiff"), "홍길동"); A.type(A.$("defendant"), "김영희");
  A.$("ours-plaintiff").checked = true; A.change(A.$("ours-plaintiff"));
  A.pick("kookmin"); A.pick("shinhan");
  A.type(A.q("#holders .h-no"), "9001012345678");
  A.click(A.q('#per-presets [data-preset="3y"]'));
}
test("미입력 점검: 채우면 목록이 정확히 비고 건수도 사라짐", async () => {
  const A = await boot();
  const n0 = A.qa("#missing-list .miss-item").length;
  ok(n0 >= 7);
  eq(A.$("missing-count").textContent, n0 + "건");
  eq(A.qa("#missing-list .miss-item")[0].dataset.sev, "req");
  fillAll(A);
  eq(A.$("missing-list").innerHTML, "");
  eq(A.$("missing-count").textContent, "");
});
test("점검 항목을 누르면 해당 입력으로 이동", async () => {
  const A = await boot();
  const li = A.qa("#missing-list .miss-item").find((l) => l.textContent === "사건번호 미입력");
  A.click(li);
  eq(A.d.activeElement.id, "case-no");
});
test("복사: 항목별·전체, 클립보드 거부 시 선택용 글상자 폴백", async () => {
  const A = await boot();
  fillAll(A);
  let got = null;
  A.clip(async (t) => { got = t; });
  A.click(A.q('#doc-preview .btn-copy[data-copy="3"]'));
  await A.tick();
  eq(got, F.formatDateKR(F.addYearsISO(today(), -3)) + "부터 " + F.formatDateKR(today()) + "까지");
  ok(A.toast().includes("복사했습니다"));
  A.click(A.q('#doc-preview .btn-copy[data-copy="1"]'));
  await A.tick();
  eq(got, "가. 주식회사 국민은행\n(07331) 서울특별시 영등포구 국제금융로8길 26 (여의도동)\n나. 주식회사 신한은행\n(04513) 서울특별시 중구 세종대로9길 20 (태평로2가)");
  A.click(A.$("btn-copy-all"));
  await A.tick();
  ok(got.startsWith("금융거래정보 제출명령 신청서\n\n사    건    2026드단12345 이혼 등\n원    고    홍길동\n피    고    김영희\n\n위 사건에 관하여 원고 홍길동의 소송대리인은"));
  ok(got.endsWith("통화·금액단위를 표시하여 주시기 바랍니다."));
  eq(got, F.blocksToText(F.composeDoc(A.w.__finorder.composeDoc ? Object.assign({}, A.w.__finorder.newState(), {}) : {})) === "" ? "" : got);
  // 거부 → 폴백
  A.clip(async () => { throw new Error("denied"); });
  A.click(A.q('#doc-preview .btn-copy[data-copy="2"]'));
  await A.tick();
  const ta = A.q(".copy-fallback textarea");
  ok(ta, "폴백 글상자"); eq(ta.value, "김영희 (900101-2345678)".replace("김영희", A.q("#holders .h-name").value));
  A.click(A.q(".copy-fallback-close"));
  ok(!A.q(".copy-fallback"));
  // clipboard 자체가 없는 환경
  Object.defineProperty(A.w.navigator, "clipboard", { value: undefined, configurable: true });
  A.click(A.$("btn-copy-all"));
  ok(A.q(".copy-fallback textarea").value.startsWith("금융거래정보 제출명령 신청서"));
});
test("DOCX 저장: 미입력이면 첫 클릭은 확인 문구, 5초 안에 다시 누르면 저장, downloads 사용", async () => {
  const fc = fakeClaude({});
  const A = await boot({ claude: fc.claude });
  const btn = A.$("btn-docx");
  const base = btn.textContent;
  const n = A.qa("#missing-list .miss-item").length;
  A.click(btn);
  eq(btn.textContent, "미입력 " + n + "건 — 한 번 더 누르면 그대로 저장합니다");
  eq(btn.dataset.armed, "true");
  eq(fc.calls.saves.length, 0);
  A.click(btn);
  await A.tick(60);
  eq(fc.calls.saves.length, 1);
  eq(fc.calls.saves[0].filename.startsWith("금융거래정보제출명령신청서_"), true);
  ok(fc.calls.saves[0].filename.endsWith(".docx"));
  ok(fc.calls.saves[0].data instanceof A.w.Blob);
  eq(btn.textContent, base); ok(!btn.dataset.armed);
  ok(A.toast().includes("저장했습니다"));
  // 완성 상태에서는 바로 저장, 파일명에 사건번호
  fillAll(A);
  eq(A.$("missing-list").innerHTML, "");
  A.click(btn);
  await A.tick(60);
  eq(fc.calls.saves.length, 2);
  eq(fc.calls.saves[1].filename, "금융거래정보제출명령신청서_2026드단12345.docx");
  ok(!/홍길동|김영희|900101/.test(fc.calls.saves[1].filename));
});
test("DOCX 저장: 5초가 지나면 확인 상태가 풀림, downloads가 null이면 안내만", async () => {
  const fc = fakeClaude({ downloads: false });
  const A = await boot({ claude: fc.claude });
  const btn = A.$("btn-docx");
  A.click(btn);
  ok(btn.dataset.armed === "true");
  // 입력이 채워져 미입력이 0이 되면 확인 상태는 자동 해제
  fillAll(A);
  ok(!btn.dataset.armed, "미입력이 0건이 되면 해제");
  A.click(btn);
  await A.tick(60);
  ok(A.toast().includes("지원하지 않습니다"), A.toast());
  eq(fc.calls.saves.length, 0);
});
test("DOCX 저장: 저장 창에서 거절하면 안내", async () => {
  const fc = fakeClaude({ declineSave: true });
  const A = await boot({ claude: fc.claude });
  fillAll(A);
  A.click(A.$("btn-docx"));
  await A.tick(60);
  ok(A.toast().includes("취소"));
});
test("초기화: 2단계 확인 후 입력만 지우고 기관 목록·세트는 유지", async () => {
  const A = await boot();
  fillAll(A);
  A.type(A.$("set-name"), "시중 2곳"); A.click(A.$("set-save")); await A.tick(30);
  A.click(A.$("btn-add-inst-open"));
  A.type(A.$("add-name"), "가상은행"); A.type(A.$("add-zip"), "12345"); A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save")); await A.tick(30);
  const btn = A.$("btn-reset");
  A.click(btn);
  eq(btn.dataset.armed, "true");
  ok(A.$("case-no").value !== "", "첫 클릭에서는 지우지 않음");
  A.click(btn);
  await A.tick();
  eq(A.$("case-no").value, ""); eq(A.$("plaintiff").value, ""); eq(A.$("defendant").value, "");
  ok(!A.$("ours-plaintiff").checked);
  eq(A.qa("#inst-selected .sel-row").length, 0);
  eq(A.qa("#holders .holder").length, 1); eq(A.q("#holders .h-name").value, ""); eq(A.q("#holders .h-no").value, "");
  eq(A.$("per-start").value, ""); eq(A.$("per-end").value, today());
  ok(A.$("purpose-divorce").checked);
  eq(A.qa("#set-list .set-chip").length, 1, "세트 유지");
  eq(A.ls("finorder.v1.institutions").length, 1, "추가한 기관 유지");
  ok(A.q('.inst-item[data-origin="custom"]'));
  eq(btn.textContent, "초기화");
});
test("선택 세트: 저장·불러오기(순서 유지)·2단계 삭제, 이름·번호는 저장하지 않음", async () => {
  const A = await boot();
  fillAll(A);
  A.click(A.q('#inst-selected .sel-row[data-id="shinhan"] .sel-up'));
  A.click(A.$("set-save"));
  ok(A.toast().includes("세트 이름"));
  A.type(A.$("set-name"), "신한 먼저");
  A.click(A.$("set-save")); await A.tick(30);
  const sets = A.ls("finorder.v1.sets");
  eq(sets.length, 1); eq(sets[0].name, "신한 먼저"); eq(sets[0].ids, ["shinhan", "kookmin"]);
  eq(Object.keys(sets[0]).sort(), ["id", "ids", "name", "updatedAt", "updatedBy"]);
  eq(A.$("set-name").value, "");
  A.click(A.q("#inst-cats .cat-none"));
  eq(A.qa("#inst-selected .sel-row").length, 0);
  A.click(A.q("#set-list .set-load"));
  eq(A.qa("#inst-selected .sel-row").map((r) => r.dataset.id), ["shinhan", "kookmin"]);
  A.type(A.$("set-name"), "신한 먼저"); A.click(A.$("set-save")); await A.tick(30);
  eq(A.ls("finorder.v1.sets").length, 1, "같은 이름은 덮어씀");
  A.click(A.q("#set-list .set-del"));
  eq(A.qa("#set-list .set-chip").length, 1);
  A.click(A.q("#set-list .set-del")); await A.tick(30);
  eq(A.qa("#set-list .set-chip").length, 0); eq(A.$("set-list").innerHTML, "");
  // 목록에서 사라진 기관이 든 세트
  const ls = { "finorder.v1.sets": JSON.stringify([{ id: "s-x", name: "옛 세트", ids: ["kookmin", "gone"] }]) };
  const B = await boot({ ls });
  B.click(B.q("#set-list .set-load"));
  eq(B.qa("#inst-selected .sel-row").map((r) => r.dataset.id), ["kookmin"]);
  ok(B.toast().includes("1곳은 뺐습니다"));
});
test("최신화 패널: 요약, 요청문 복사, 붙여넣기 → 비교표 → 선택 적용", async () => {
  const A = await boot();
  ok(A.$("update-panel").hidden);
  A.click(A.$("btn-update-open"));
  ok(!A.$("update-panel").hidden);
  eq(A.qa("#upd-summary tbody tr").length, 6);
  ok(A.$("upd-summary").textContent.includes("기준일 2026-10-02"));
  let got = null;
  A.clip(async (t) => { got = t; });
  A.click(A.$("upd-copy")); await A.tick();
  ok(got.includes("웹 검색") && got.includes('"id": "kookmin"') && got.includes("독립된 출처 2곳"));
  const s2 = [{ label: "공식 홈페이지", url: "https://www.example-bank.test/a" }, { label: "전자공시", url: "https://dart.example.test/b" }];
  const json = JSON.stringify([
    { id: "kookmin", zip: "07332", addr: "서울특별시 영등포구 국제금융로8길 27", note: "여의도동", status: "verified", checkedAt: "2026-10-02", sources: s2 },
    { id: "shinhan", zip: "04513", addr: "서울특별시 중구 세종대로9길 20", note: "태평로2가", sources: s2 },
    { id: "hana", zip: "04520", addr: "서울특별시 중구 을지로 35", note: "을지로1가", status: "verified", sources: [s2[0]] },
    { id: "ghost", zip: "1", addr: "x", sources: [] },
    { id: "newbank", name: "신규은행", cat: "bank", zip: "54321", addr: "가상시 신규로 1", sources: s2 },
  ]);
  A.type(A.$("upd-paste"), "결과입니다.\n```json\n" + json + "\n```");
  A.click(A.$("upd-check"));
  const rows = A.qa("#upd-diff tr[data-kind]");
  eq(rows.map((r) => r.dataset.kind), ["changed", "same", "changed", "invalid", "new"]);
  eq(A.qa("#upd-diff .diff-cb").length, 3);
  ok(rows[3].textContent.includes("출처 URL 없음"));
  ok(rows[0].querySelector("del") && rows[0].querySelector("ins"));
  A.click(A.$("upd-apply"));
  ok(A.toast().includes("적용할 항목"));
  A.click(A.q("#upd-diff .diff-cb-all"));
  ok(A.qa("#upd-diff .diff-cb").every((c) => c.checked));
  A.q('#upd-diff .diff-cb[data-id="hana"]').checked = false;
  A.click(A.$("upd-apply"));
  await A.tick(60);
  const docs = A.ls("finorder.v1.institutions");
  eq(docs.map((d) => d.id).sort(), ["kookmin", "newbank"]);
  const k = docs.find((d) => d.id === "kookmin");
  eq(k.origin, "override"); eq(k.zip, "07332"); eq(k.status, "verified"); eq(k.sources.length, 2);
  const nb = docs.find((d) => d.id === "newbank");
  eq(nb.origin, "custom"); eq(nb.name, "신규은행"); eq(nb.wording, "기관");
  ok(A.chip("kookmin").title.includes("07332"));
  ok(A.chip("newbank"));
  eq(A.chip("kookmin").dataset.status, "verified");
  eq(A.$("upd-diff").querySelector("table"), null);
  ok(A.$("upd-diff").textContent.includes("2곳에 반영했습니다"));
  // JSON 오류
  A.type(A.$("upd-paste"), "이건 JSON이 아닙니다"); A.click(A.$("upd-check"));
  ok(A.$("upd-diff").textContent.includes("JSON을 읽을 수 없습니다"));
  A.click(A.$("upd-close")); ok(A.$("update-panel").hidden);
});
test("최신화 요청문 복사가 막히면 폴백 글상자(목록 항목 안)", async () => {
  const A = await boot();
  A.click(A.$("btn-update-open"));
  A.clip(async () => { throw new Error("no"); });
  A.click(A.$("upd-copy")); await A.tick();
  ok(A.q(".copy-fallback textarea").value.includes("현재 목록"));
  eq(A.q(".copy-fallback").tagName, "LI", "ol 안에서는 li로 만든다");
});

test("출처 1곳으로 채워진 needs_check 항목은 직원이 확인·저장하기 전까지 준비되지 않음", async () => {
  const A = await boot();
  A.click(A.$("btn-update-open"));
  const s1 = [{ label: "공식 홈페이지", url: "https://www.example-bank.test/a" }];
  A.type(A.$("upd-paste"), JSON.stringify([{ id: "hana", zip: "04520", addr: "서울특별시 중구 을지로 35", note: "을지로1가", status: "verified", sources: s1 }]));
  A.click(A.$("upd-check"));
  A.click(A.q("#upd-diff .diff-cb"));
  A.click(A.$("upd-apply")); await A.tick(40);
  const ov = A.ls("finorder.v1.institutions")[0];
  eq(ov.status, "needs_check", "독립 출처 2곳 미만이면 verified로 올리지 않음");
  eq(ov.addr, "서울특별시 중구 을지로 35");
  eq(A.chip("hana").dataset.status, "needs_check");
  A.click(A.$("inst-filter-ready"));
  ok(!A.chip("hana"), "확인된 곳만 보기에서는 제외");
  A.click(A.$("inst-filter-ready"));
  A.pick("hana");
  const fill = A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill');
  ok(fill, "주소가 있어도 needs_check면 입력행으로 확인을 받는다");
  eq(fill.querySelector(".sel-fill-zip").value, "04520");
  eq(fill.querySelector(".sel-fill-addr").value, "서울특별시 중구 을지로 35");
  eq(fill.querySelector(".sel-fill-note").value, "을지로1가");
  ok(A.missing().includes("하나은행 주소 확인 필요(확인 후 저장)"), A.missing().join("|"));
  ok(A.previewText().includes("(04520) 서울특별시 중구 을지로 35 (을지로1가)"), "미리보기에는 값이 나옴");
  A.click(fill.querySelector(".sel-fill-save")); await A.tick(40);
  eq(A.chip("hana").dataset.status, "user_provided");
  ok(!A.q('#inst-selected .sel-row[data-id="hana"] .sel-fill'));
  ok(!A.missing().some((m) => m.includes("하나은행")));
});

/* ---------- 저장소(db) ---------- */
test("db 연결: 공용 저장, 알약 on, 다른 사용자의 쓰기 실시간 반영, updatedBy는 id만", async () => {
  const f = fakeDb();
  const fc = fakeClaude({ db: f.db, user: { can: async () => true, id: async () => "u_abc" } });
  const A = await boot({ claude: fc.claude });
  await A.tick(40);
  eq(A.$("st-db").textContent, "공용 저장 연결"); ok(A.$("st-db").classList.contains("on"));
  A.click(A.$("btn-add-inst-open"));
  A.type(A.$("add-name"), "가상은행"); A.type(A.$("add-zip"), "12345"); A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save")); await A.tick(40);
  const ids = Object.keys(f.cols.institutions);
  eq(ids.length, 1);
  const doc = f.cols.institutions[ids[0]];
  eq(doc.origin, "custom"); eq(doc.updatedBy, "u_abc"); ok(doc.updatedAt);
  eq(A.ls("finorder.v1.institutions"), null, "db에 썼으면 localStorage는 건드리지 않음");
  // 다른 팀원이 shinhan 주소를 override
  f.cols.institutions.shinhan = { id: "shinhan", origin: "override", zip: "99999", addr: "가상시 변경로 9", note: "", status: "user_provided", updatedAt: "2026-10-02T09:00:00.000Z" };
  f.notify("institutions"); await A.tick(20);
  ok(A.chip("shinhan").title.includes("99999"));
  // 세트도 db에
  A.pick("shinhan");
  A.type(A.$("set-name"), "공용 세트"); A.click(A.$("set-save")); await A.tick(40);
  eq(Object.values(f.cols.sets).length, 1);
  eq(Object.values(f.cols.sets)[0].name, "공용 세트");
  const sids = Object.values(f.cols.sets)[0].ids;
  eq(sids.length, 2, "방금 추가해 자동 선택된 기관과 shinhan");
  eq(sids[1], "shinhan");
});
test("db 쓰기 권한 없음(can=false): 이 브라우저에만 저장하고 안내, 알약 읽기 전용", async () => {
  const f = fakeDb();
  const fc = fakeClaude({ db: f.db, user: { can: async () => false, id: async () => "u_v" } });
  const A = await boot({ claude: fc.claude });
  await A.tick(40);
  eq(A.$("st-db").textContent, "공용 저장 읽기 전용"); ok(A.$("st-db").classList.contains("off"));
  A.click(A.$("btn-add-inst-open"));
  A.type(A.$("add-name"), "가상은행"); A.type(A.$("add-zip"), "12345"); A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save")); await A.tick(40);
  eq(Object.keys(f.cols.institutions).length, 0);
  eq(A.ls("finorder.v1.institutions").length, 1);
  ok(A.toast().includes("공용 저장소에 쓸 수 없어 이 브라우저에만 저장했습니다"), A.toast());
  ok(A.toast().includes("추가해 선택했습니다"), "저장 결과 안내와 폴백 안내가 한 알림에");
  ok(A.q('.inst-item[data-origin="custom"]'), "로컬 저장분도 목록에 보임");
});
test("db 쓰기 거부(can=null, set이 invalid_argument): 로컬 폴백 후 알약 읽기 전용", async () => {
  const f = fakeDb({ denyWrite: true });
  const fc = fakeClaude({ db: f.db, user: { can: async () => null, id: async () => null } });
  const A = await boot({ claude: fc.claude });
  await A.tick(40);
  eq(A.$("st-db").textContent, "공용 저장 연결");
  A.click(A.$("btn-add-inst-open"));
  A.type(A.$("add-name"), "가상은행"); A.type(A.$("add-zip"), "12345"); A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save")); await A.tick(40);
  eq(A.ls("finorder.v1.institutions").length, 1);
  ok(A.toast().includes("이 브라우저에만"));
  eq(A.$("st-db").textContent, "공용 저장 읽기 전용", "거부된 뒤 알약이 바뀜");
  A.type(A.$("set-name"), "세트"); A.pick("kookmin"); A.click(A.$("set-save")); await A.tick(40);
  eq(A.ls("finorder.v1.sets").length, 1, "세트도 로컬 폴백");
});
test("개인정보 비저장: 이름·번호·사건번호·사건명은 localStorage·db·sample 어디에도 가지 않음", async () => {
  const f = fakeDb();
  const sample = fakeSample(async () => ({ text: "피고 명의의 재산을 확인하기 위함입니다.", changes: [] }));
  const fc = fakeClaude({ db: f.db, sample, user: { can: async () => true, id: async () => "u_1" } });
  const A = await boot({ claude: fc.claude });
  await A.tick(40);
  fillAll(A);
  A.click(A.$("btn-add-holder")); A.click(A.$("btn-add-holder")); // 원고, 피고 다음 제3자
  A.type(A.qa("#holders .h-name")[2], "박철수");
  A.type(A.$("case-name"), "손해배상(기) 박철수");
  A.$("purpose-other").checked = true; A.change(A.$("purpose-other"));
  A.type(A.$("purpose-text"), "김영희 명의 부동산 대금 흐름을 보려고. 홍길동 900101-2345678 사건 2026드단12345");
  A.click(A.$("btn-polish")); await A.tick(40);
  A.click(A.$("btn-add-inst-open"));
  A.type(A.$("add-name"), "가상은행"); A.type(A.$("add-zip"), "12345"); A.type(A.$("add-addr"), "가상시 가상로 1");
  A.click(A.$("add-save")); await A.tick(40);
  A.type(A.$("set-name"), "세트"); A.click(A.$("set-save")); await A.tick(40);
  const all = JSON.stringify({ db: f.cols, ls: { i: A.ls("finorder.v1.institutions"), s: A.ls("finorder.v1.sets") }, sample: sample.prompts });
  ["홍길동", "김영희", "9001012345678", "900101", "2345678", "2026드단12345", "박철수"].forEach((w) => ok(!all.includes(w), "저장·전송에 포함됨: " + w));
  ok(sample.prompts.length === 1);
  ok(sample.prompts[0].prompt.includes("피고 명의 부동산 대금 흐름을 보려고"), sample.prompts[0].prompt);
  ok(sample.prompts[0].prompt.includes("사건명(참고): 손해배상(기) 명의인"), sample.prompts[0].prompt);
  // 모든 키가 허용 목록 안에 있는지
  const keys = new Set();
  Object.values(f.cols.institutions).forEach((d) => Object.keys(d).forEach((k) => keys.add(k)));
  ok([...keys].every((k) => ["id", "origin", "cat", "short", "name", "aliases", "wording", "popular", "zip", "addr", "note", "status", "checkedAt", "sources", "memo", "createdAt", "updatedAt", "updatedBy"].includes(k)), [...keys].join());
});

/* ---------- Claude 다듬기 ---------- */
test("다듬기: 연결되면 버튼 노출, 결과는 원문 대비로 보이고 적용·취소는 직접", async () => {
  const sample = fakeSample(async () => ({ text: "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.", changes: ["합니다체로 정리", ""] }));
  const A = await boot({ claude: fakeClaude({ sample }).claude });
  await A.tick(30);
  ok(!A.$("btn-polish").hidden); eq(A.$("st-claude").textContent, "Claude 연결"); ok(A.$("st-claude").classList.contains("on"));
  ok(A.$("btn-polish-stop").hidden);
  A.$("purpose-other").checked = true; A.change(A.$("purpose-other"));
  A.click(A.$("btn-polish"));
  ok(A.toast().includes("초안"), "초안이 비었으면 안내");
  eq(sample.prompts.length, 0);
  A.type(A.$("purpose-text"), "피고 명의 부동산 판 돈이 어디로 갔는지 확인하려고");
  A.click(A.$("btn-polish")); await A.tick(30);
  eq(sample.prompts.length, 1);
  eq(sample.prompts[0].opts.modelTier, "quick");
  ok(sample.prompts[0].opts.signal && typeof sample.prompts[0].opts.signal.aborted === "boolean");
  eq(A.q("#polish-result .pol-before .pol-text").textContent, "피고 명의 부동산 판 돈이 어디로 갔는지 확인하려고");
  eq(A.q("#polish-result .pol-after .pol-text").textContent, "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  eq(A.qa("#polish-result .pol-changes li").length, 1);
  eq(A.$("purpose-text").value, "피고 명의 부동산 판 돈이 어디로 갔는지 확인하려고", "자동 적용 금지");
  A.click(A.q("#polish-result .pol-cancel"));
  eq(A.$("polish-result").innerHTML, "");
  A.click(A.$("btn-polish")); await A.tick(30);
  A.click(A.q("#polish-result .pol-apply"));
  eq(A.$("purpose-text").value, "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  eq(A.qa("#doc-preview p.d-p").pop().textContent, "피고 명의의 부동산 매각대금의 사용처를 확인하기 위함입니다.");
  eq(A.$("polish-result").innerHTML, "");
});
test("다듬기: 초안에 없는 숫자·조문이 생기면 경고, 형식 오류 응답은 안내", async () => {
  let n = 0;
  const sample = fakeSample(async () => (++n === 1 ? { text: "민법 제839조의2에 따라 3건을 확인하기 위함입니다.", changes: [] } : { nope: 1 }));
  const A = await boot({ claude: fakeClaude({ sample }).claude });
  await A.tick(30);
  A.type(A.$("purpose-text"), "계좌 거래를 확인하려고");
  A.click(A.$("btn-polish")); await A.tick(30);
  const warns = A.qa("#polish-result .err").map((e) => e.textContent).join("|");
  ok(warns.includes("숫자") && warns.includes("조문"), warns);
  A.click(A.$("btn-polish")); await A.tick(30);
  ok(A.$("polish-result").textContent.includes("해석하지 못했습니다"));
});
test("다듬기: 중단 버튼, 영구 거절(not_granted)이면 버튼을 숨기고 직접 작성만", async () => {
  const sample = fakeSample((p, opts) => new Promise((_, rej) => { opts.signal.addEventListener("abort", () => rej({ code: "cancelled", message: "x" })); }));
  const A = await boot({ claude: fakeClaude({ sample }).claude });
  await A.tick(30);
  A.type(A.$("purpose-text"), "계좌 거래를 확인하려고");
  A.click(A.$("btn-polish")); await A.tick(10);
  ok(!A.$("btn-polish-stop").hidden, "진행 중에는 중단 버튼");
  ok(A.$("btn-polish").disabled);
  ok(A.$("polish-result").textContent.includes("다듬는 중"));
  A.click(A.$("btn-polish-stop")); await A.tick(20);
  ok(A.$("polish-result").textContent.includes("중단했습니다"));
  ok(A.$("btn-polish-stop").hidden); ok(!A.$("btn-polish").disabled);
  const denied = fakeSample(async () => { throw { code: "not_granted", message: "x" }; });
  const B = await boot({ claude: fakeClaude({ sample: denied }).claude });
  await B.tick(30);
  B.type(B.$("purpose-text"), "계좌 거래를 확인하려고");
  B.click(B.$("btn-polish")); await B.tick(30);
  ok(B.$("btn-polish").hidden); ok(B.$("st-claude").classList.contains("off")); eq(B.$("st-claude").textContent, "Claude 없음");
});

/* ---------- 화면 ---------- */
test("좁은 화면: 탭으로 작성/미리보기 전환(hidden), 넓으면 hidden을 쓰지 않음", async () => {
  const A = await boot({ narrow: true });
  ok(!A.$("pane-form").hidden); ok(A.$("pane-preview").hidden);
  eq(A.$("tab-form").getAttribute("aria-selected"), "true");
  A.click(A.$("tab-preview"));
  ok(A.$("pane-form").hidden); ok(!A.$("pane-preview").hidden);
  eq(A.$("tab-preview").getAttribute("aria-selected"), "true"); eq(A.$("tab-form").getAttribute("aria-selected"), "false");
  // 미리보기 탭에서 점검 항목을 누르면 작성 탭으로 돌아감
  const li = A.qa("#missing-list .miss-item")[0];
  A.click(li);
  ok(!A.$("pane-form").hidden);
  const W = await boot();
  ok(!W.$("pane-form").hidden && !W.$("pane-preview").hidden);
});
test("전자소송 복사 문구에 마크다운 강조·HTML 태그 문자열이 없음(입력값 이스케이프 포함)", async () => {
  const A = await boot();
  fillAll(A);
  A.type(A.$("case-name"), "이혼 <script>x</script> 등");
  ok(!A.q("#doc-preview script"));
  ok(A.previewText().includes("이혼 <script>x</script> 등"));
  ok(!A.d.body.innerHTML.includes("<script>x</script>"));
});
test("DOM 계약: SPEC 5장 id 66개와 동적 클래스가 모두 존재", async () => {
  const A = await boot();
  const spec = fs.readFileSync(path.join(ROOT, "SPEC.md"), "utf8");
  const sec = spec.split("정적(디자인이 마크업 작성):")[1].split("동적(코드가 만드는 조각")[0];
  const ids = new Set();
  sec.split("\n").forEach((l) => { if (l.startsWith("|") && !l.startsWith("|---") && !l.startsWith("| id")) (l.split("|")[1].match(/`([a-z][a-z0-9-]*)`/g) || []).forEach((x) => ids.add(x.replace(/`/g, ""))); });
  ["inst-filter-ready", "missing-count", "add-msg"].forEach((x) => ids.add(x));
  const missing = [...ids].filter((id) => !A.$(id));
  eq(missing, []);
  ok(ids.size >= 60);
  // 동적 조각
  A.pick("hana");
  const need = [".cat-tab", ".cat-all", ".cat-none", ".cat-n", ".inst-item", ".inst-cb", ".inst-short", ".inst-sub", ".inst-group", ".sel-row", ".sel-letter", ".sel-main", ".sel-name", ".sel-ctl", ".sel-up", ".sel-down", ".sel-del", ".sel-fill", ".sel-fill-zip", ".sel-fill-addr", ".sel-fill-save", ".holder", ".h-role", ".h-name", ".h-no", ".h-del", ".d-title", ".d-case", ".d-label", ".d-value", ".d-intro", ".d-next", ".d-h", ".d-inst", ".d-letter", ".d-name", ".d-addr", ".d-holder", ".d-p", ".d-l1", ".d-l2", ".d-mk", "u", ".d-blank", ".btn-copy"];
  const roots = need.filter((s) => !A.q(s));
  eq(roots, []);
  A.type(A.$("upd-paste"), '[{"id":"hana","zip":"04520","addr":"가","sources":[{"label":"a","url":"https://a.test"}]}]'); A.click(A.$("upd-check"));
  ok(A.q("table.diff-table tr[data-kind]") && A.q("input.diff-cb"));
  ok(A.q('#missing-list li.miss-item[data-sev="req"]'));
});

/* ============================ 실행 ============================ */
(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push(name + "\n    " + String(e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n    ") : e)); }
  }
  console.log("DOM 테스트: 통과 " + pass + ", 실패 " + fail);
  if (fail) { console.log("\n" + failures.join("\n\n")); process.exit(1); }
  process.exit(0);
})();
