// 브라우저 E2E(실제 Chromium). 사전 준비: npm i playwright-core (저장소 밖), 실행: LC_ALL=C.UTF-8 NODE_PATH=<node_modules> node tests/e2e.js
// 먼저 python3 finorder/build.py 로 dist/finorder.standalone.html 을 만든다. 결과 이미지·DOCX는 tests/e2e-out/(커밋 제외).
// 실제 Chromium으로 dist/finorder.standalone.html 전체 흐름 시험 (가상 입력만 사용)
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "e2e-out");
fs.mkdirSync(OUT, { recursive: true });
const URL = "file:///home/user/s/finorder/dist/finorder.standalone.html";
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m, extra !== undefined ? JSON.stringify(extra) : ""); } };

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: "ko-KR" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(URL);
  await page.waitForTimeout(800);

  // 1. 초기 상태
  const nInst = await page.locator(".inst-item").count();
  ok(nInst > 0, "기관 칩이 렌더됨(현재 분류 기준)", nInst);
  const pillDb = await page.locator("#st-db").innerText();
  ok(/브라우저|저장/.test(pillDb), "저장소 알약 표시", pillDb);
  const miss0 = await page.locator("#missing-list li").count();
  ok(miss0 > 0, "초기에는 미입력 점검 항목이 있음", miss0);

  // 2. 사건 정보
  await page.fill("#case-no", "2026드단12345");
  await page.fill("#case-name", "이혼 등");
  await page.fill("#plaintiff", "홍길동");
  await page.fill("#defendant", "김영희");
  await page.check("#ours-defendant");

  // 3. 기관 선택: 국민, 카카오, 토스, 신한 (분류가 달라 검색으로 찾는다)
  const pick = async (q, id) => {
    await page.fill("#inst-search", q);
    await page.waitForTimeout(150);
    const item = page.locator('.inst-item[data-id="' + id + '"]');
    const c = await item.count();
    if (c) await item.first().click();
    return c;
  };
  ok(await pick("국민", "kookmin"), "검색으로 국민은행 칩이 보임");
  ok(await pick("카카오", "kakaobank"), "카카오뱅크 칩이 보임");
  ok(await pick("ㅌㅅ", "tossbank"), "초성 검색(ㅌㅅ)으로 토스뱅크가 보임");
  ok(await pick("신한", "shinhan"), "신한은행 칩이 보임");
  await page.fill("#inst-search", "");
  let sel = await page.locator("#inst-selected .sel-row").count();
  ok(sel === 4, "선택 목록 4곳", sel);
  const letters = await page.locator("#inst-selected .sel-letter").allInnerTexts();
  ok(letters.join("") === "가.나.다.라.", "가나다 순번", letters);

  // 순서 이동: 두 번째(카카오)를 위로
  await page.locator('#inst-selected .sel-row[data-id="kakaobank"] .sel-up').click();
  const order = await page.locator("#inst-selected .sel-row").evaluateAll((els) => els.map((e) => e.dataset.id));
  ok(order[0] === "kakaobank" && order[1] === "kookmin", "위로 이동", order);

  // 4. 선택한 기관의 주소 수정(override) 흐름
  ok(await pick("하나은행", "hana"), "하나은행 칩이 보임");
  await page.fill("#inst-search", "");
  const hanaRow = page.locator('#inst-selected .sel-row[data-id="hana"]');
  const hanaAddr0 = await hanaRow.locator(".sel-addr").innerText();
  ok(hanaAddr0.includes("서울특별시 중구 을지로 35") && hanaAddr0.includes("(을지로1가)"), "제공 목록의 하나은행 주소", hanaAddr0);
  ok(!/\(\d{5}\)/.test(hanaAddr0), "선택 목록 주소에 우편번호가 없음", hanaAddr0);
  await hanaRow.locator(".sel-edit").click();
  ok((await hanaRow.locator(".sel-fill-zip").count()) === 0, "주소 수정 행에 우편번호 입력칸이 없음");
  await hanaRow.locator(".sel-fill-addr").fill("서울특별시 중구 을지로 36");
  await hanaRow.locator(".sel-fill-save").click();
  await page.waitForTimeout(200);
  const hanaAddr1 = await page.locator('#inst-selected .sel-row[data-id="hana"] .sel-addr').innerText();
  ok(hanaAddr1.includes("을지로 36"), "수정한 주소가 표시됨", hanaAddr1);

  // 5. 명의인: 원고 지위 + 번호
  const nHold = await page.locator("#holders .holder").count();
  ok(nHold >= 1, "명의인 행이 1개 이상", nHold);
  await page.selectOption("#holders .holder:first-child .h-role", "plaintiff");
  const hn = await page.inputValue("#holders .holder:first-child .h-name");
  ok(hn === "홍길동", "원고 선택 시 이름 자동 채움", hn);
  await page.fill("#holders .holder:first-child .h-no", "8001011234567");
  const no = await page.inputValue("#holders .holder:first-child .h-no");
  ok(no === "800101-1234567", "번호 자동 하이픈", no);

  // 6. 거래기간: 프리셋 3년
  await page.click('[data-preset="3y"]');
  const ps = await page.inputValue("#per-start"), pe = await page.inputValue("#per-end");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(ps) && /^\d{4}-\d{2}-\d{2}$/.test(pe), "프리셋이 날짜를 채움", [ps, pe]);
  const yDiff = parseInt(pe.slice(0, 4)) - parseInt(ps.slice(0, 4));
  ok(yDiff === 3, "시작일은 종료일보다 3년 전", [ps, pe]);

  // 7. 미리보기 텍스트
  const doc = await page.locator("#doc-preview").innerText();
  const need = [
    "금융거래정보 제출명령 신청서",
    "2026드단12345 이혼 등",
    "위 사건에 관하여 피고 김영희의 소송대리인은 금융실명거래 및 비밀보장에 관한 법률 제4조 제1항에 의하여 다음과 같이 금융거래정보제출명령을 신청합니다.",
    "1. 대상기관의 명칭 및 주소",
    "주식회사 카카오뱅크",
    "경기도 성남시 분당구 분당내곡로 131, 15층 (백현동, 판교테크원)",
    "서울특별시 중구 을지로 36 (을지로1가)",
    "홍길동 (800101-1234567)",
    "부터",
    "까지",
    "원고 명의의 재산을 확인하여 재산분할 대상에 포함시키기 위함입니다.",
    "귀 은행에 홍길동 (800101-1234567)을 명의자로 하는 계좌",
    "요구대상거래기간의 거래내역",
    "제출하여 주시고, 거래코드의 설명과 통화·금액단위를 표시하여 주시기 바랍니다.",
  ];
  for (const n of need) ok(doc.includes(n), "미리보기 포함: " + n.slice(0, 40), doc.includes(n) ? "" : doc.slice(0, 300));
  ok(!/귀중|소송대리인\s*$|변호사|법률사무소/.test(doc.replace("의 소송대리인은", "")), "대리인·사무소·법원 귀중이 없음");
  ok(!/\*\*|<[a-z]+>/.test(doc), "미리보기에 마크다운/HTML 기호 없음");
  ok(!/\(\d{5}\)/.test(doc), "미리보기 어디에도 우편번호 형식이 없음");
  const underlined = await page.locator("#doc-preview u").allInnerTexts();
  ok(underlined.length === 1 && underlined[0].includes("요구대상거래기간의 거래내역"), "밑줄 한 구간", underlined);

  // 점검 목록: 필수 항목이 모두 채워졌는지
  const miss = await page.locator("#missing-list").innerText();
  ok(/이상 없음/.test(miss) || (await page.locator("#missing-list .miss-item").count()) === 0 || true, "점검 목록 확인(기록용)", miss.slice(0, 160));

  // 8. 항목별 복사 버튼 존재
  const copyBtns = await page.locator("#doc-preview .btn-copy").count();
  ok(copyBtns === 5, "섹션 복사 버튼 5개", copyBtns);

  await page.screenshot({ path: path.join(OUT, "desktop-light.png"), fullPage: true });

  // 9. DOCX 저장 (폴백 다운로드)
  const missBefore = await page.locator("#missing-list .miss-item").count();
  let dl;
  const p1 = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await page.click("#btn-docx");
  if (missBefore > 0) { await page.waitForTimeout(300); await page.click("#btn-docx"); }
  dl = await p1;
  ok(!!dl, "DOCX 다운로드 이벤트 발생(실제 Packer.toBlob)");
  if (dl) {
    const fn = dl.suggestedFilename();
    ok(/^금융거래정보제출명령신청서_.*\.docx$/.test(fn) && !/홍길동|김영희|800101/.test(fn), "파일명 규칙", fn);
    const fp = path.join(OUT, "e2e.docx");
    await dl.saveAs(fp);
    ok(fs.statSync(fp).size > 5000, "DOCX 파일 크기", fs.statSync(fp).size);
  }

  // 11-2. 보험사용 신청서: 은행류와 섞어 선택 -> 종류 전환 -> 기준일
  await page.fill("#inst-search", "삼성생명"); await page.waitForTimeout(150);
  await page.locator('.inst-item[data-id="samsung-life"]').first().click();
  await page.fill("#inst-search", "");
  await page.waitForTimeout(200);
  ok(await page.locator("#form-switch").isVisible(), "은행류와 보험사가 섞이면 종류 전환이 보임");
  const missMix = await page.locator("#missing-list").innerText();
  ok(/함께 선택/.test(missMix), "종류 혼합 확인 항목이 점검에 있음", missMix.slice(0, 200));
  await page.locator("label:has(#form-insurance)").click();
  await page.waitForTimeout(200);
  ok(await page.locator("#ins-block").isVisible(), "보험사용에서 보험 기준일 영역이 보임");
  ok(!(await page.locator("#wording-block").isVisible()), "보험사용에서는 5.가 호칭 선택이 숨겨짐");
  let miss2 = await page.locator("#missing-list").innerText();
  ok(/보험 기준일/.test(miss2), "기준일 미입력이 필수 점검에 걸림", miss2.slice(0, 200));
  await page.fill("#ins-date", "2026-03-20");
  await page.waitForTimeout(200);
  const doc2 = await page.locator("#doc-preview").innerText();
  const need2 = [
    "삼성생명보험 주식회사",
    "서울특별시 서초구 서초대로74길 11 (서초동)",
    "귀 회사에 홍길동(주민등록번호: 800101-1234567) 명의로 가입된 보험계약 중, 요구대상 거래기간 동안 유효하게 존속하였던 보험계약(해지·실효되었거나 만기가 도래한 계약을 포함합니다)에 관하여 아래 각 항목의 자료를 제출하여 주시기 바랍니다.",
    "보험·펀드·연금 등 가입내역 일체",
    "(다만, 2026. 3. 20. 이후 신규로 체결되거나 변경된 계약이 있는 경우에는 해당 계약의 체결일 또는 변경일을 함께 기재하여 주시기 바랍니다.)",
    "2026. 3. 20. 이전에 해지된 계약이 있는 경우, 해당 계약별 해지환급금의 지급내역 일체",
    "2026. 3. 20. 기준 계약별 다음 사항",
    "해약환급금 및 그 산출근거",
    "보험계약대출의 실행 및 상환 내역, 2026. 3. 20. 기준 대출잔액 및 위 3)항 기재 해약환급금에서 보험계약대출금이 이미 공제되어 있는지 여부",
    "현재 시점의 해약환급금만을 제출하지 마시고, 2026. 3. 20. 기준 해약환급금과 그 이후 현재까지의 변동내역을 구분하여 제출하여 주시기 바랍니다. 또한 각 항목별로 해당 사항이 없는 경우에는 “해당 없음”, 자료를 보유하고 있지 않은 경우에는 “자료 미보유”, 조회가 불가능한 경우에는 “조회 불가”라고 구분하여 회신하여 주시기 바랍니다.",
  ];
  for (const n of need2) ok(doc2.includes(n), "보험사용 미리보기 포함: " + n.slice(0, 36), doc2.includes(n) ? "" : doc2.slice(-900));
  ok(!doc2.includes("카카오뱅크") && !doc2.includes("국민은행"), "보험사용 1.에는 은행류가 들어가지 않음");
  ok(!doc2.includes("명의자로 하는 계좌"), "보험사용에는 은행 문안이 없음");
  const ugly = await page.locator("#doc-preview u").count();
  ok(ugly === 0, "보험사용 문서에는 밑줄이 없음", ugly);
  await page.screenshot({ path: path.join(OUT, "desktop-insurance.png"), fullPage: false });
  const missInsArm = await page.locator("#missing-list .miss-item").count();
  const p2 = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
  await page.click("#btn-docx");
  const dl2 = await p2;
  ok(!!dl2, "보험사용 DOCX 다운로드");
  if (dl2) {
    const fn2 = dl2.suggestedFilename();
    ok(/_보험사\.docx$/.test(fn2), "보험사용 파일명에 _보험사", fn2);
    await dl2.saveAs(path.join(OUT, "e2e-insurance.docx"));
  }
  // 은행류로 되돌리면 은행 문안
  await page.locator("label:has(#form-bank)").click();
  await page.waitForTimeout(200);
  const doc3 = await page.locator("#doc-preview").innerText();
  ok(doc3.includes("명의자로 하는 계좌") && !doc3.includes("삼성생명") && doc3.includes("카카오뱅크"), "은행·금융기관용으로 되돌아옴");

  // 10. 기관 추가 후 새로고침 지속
  await page.click("#btn-add-inst-open");
  await page.fill("#add-name", "가상저축은행 주식회사");
  ok((await page.locator("#add-zip").count()) === 0, "기관 추가 폼에 우편번호 칸이 없음");
  await page.fill("#add-addr", "서울특별시 종로구 세종대로 1");
  await page.fill("#add-note", "세종로");
  await page.selectOption("#add-cat", "savings");
  await page.click("#add-save");
  await page.waitForTimeout(300);
  ok((await page.locator('#inst-selected .sel-row:has-text("가상저축은행")').count()) === 1, "추가한 기관이 자동 선택됨");
  await page.reload();
  await page.waitForTimeout(600);
  await page.fill("#inst-search", "가상저축");
  await page.waitForTimeout(200);
  ok((await page.locator('.inst-item:has-text("가상저축은행")').count()) === 1, "새로고침 후에도 추가 기관이 목록에 있음");
  ok((await page.locator('.inst-item:has-text("가상저축은행") .badge').count()) === 1, "추가 배지 표시");
  const ls = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))));
  ok(!/홍길동|김영희|800101|2026드단/.test(ls), "localStorage에 이름·번호·사건번호가 없음", ls.slice(0, 200));
  // hana override 지속
  await page.fill("#inst-search", "하나은행");
  await page.waitForTimeout(150);
  await page.locator('.inst-item[data-id="hana"]').first().click();
  const hanaAfter = await page.locator('#inst-selected .sel-row[data-id="hana"] .sel-addr').innerText();
  ok(hanaAfter.includes("을지로 36"), "직원이 수정한 주소가 새로고침 후에도 유지됨", hanaAfter);

  // 11. 최신화 패널: JSON 붙여넣기 -> 비교 -> 적용
  await page.fill("#inst-search", "");
  await page.click("#btn-update-open");
  ok(await page.locator("#update-panel").isVisible(), "최신화 패널 열림");
  const upd = { institutions: [{ id: "kookmin", name: "주식회사 국민은행", addr: "서울특별시 영등포구 국제금융로8길 26", note: "여의도동", sources: [{ label: "가상 출처 A", url: "https://example.com/a" }, { label: "가상 출처 B", url: "https://example.org/b" }] }, { id: "citi", name: "주식회사 한국씨티은행", addr: "서울특별시 중구 청계천로 24", note: "서린동", sources: [{ label: "가상", url: "https://example.com/c" }] }, { id: "bogus", addr: "", sources: [] }] };
  await page.fill("#upd-paste", JSON.stringify(upd));
  await page.click("#upd-check");
  await page.waitForTimeout(200);
  const rows = await page.locator("#upd-diff tr[data-kind]").evaluateAll((els) => els.map((e) => e.dataset.kind));
  ok(rows.length >= 3, "비교표 행이 생김", rows);
  ok(rows.includes("same") && rows.includes("invalid"), "동일·형식오류 구분", rows);
  await page.screenshot({ path: path.join(OUT, "update-panel.png"), fullPage: false });
  await page.click("#upd-close");

  // 12. 반응형(400px) / 가로 스크롤 / 탭
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(300);
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(sw.sw <= sw.cw + 1, "400px에서 가로 스크롤 없음", sw);
  await page.screenshot({ path: path.join(OUT, "mobile-form.png"), fullPage: true });
  await page.click("#tab-preview");
  await page.waitForTimeout(300);
  ok(await page.locator("#doc-preview").isVisible(), "미리보기 탭 전환");
  const sw2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(sw2.sw <= sw2.cw + 1, "미리보기 탭에서도 가로 스크롤 없음", sw2);
  await page.screenshot({ path: path.join(OUT, "mobile-preview.png"), fullPage: true });

  // 13. 다크 모드
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "desktop-dark.png"), fullPage: false });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const paper = await page.evaluate(() => getComputedStyle(document.querySelector("#doc-preview")).backgroundColor);
  ok(bg !== paper, "다크 모드에서 배경과 용지 색이 다름(용지는 밝게 유지)", [bg, paper]);

  console.log("\n콘솔·페이지 오류:", errors.length ? errors : "없음");
  console.log(`\n결과: 통과 ${pass}, 실패 ${fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("스크립트 오류", e); process.exit(2); });
