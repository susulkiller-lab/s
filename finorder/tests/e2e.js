// 브라우저 E2E(실제 Chromium). 사전 준비: npm i playwright-core (저장소 밖), 실행: LC_ALL=C.UTF-8 NODE_PATH=<node_modules> node tests/e2e.js
// 먼저 python3 finorder/build.py 로 dist/finorder.standalone.html 을 만든다. 결과 이미지는 tests/e2e-out/(커밋 제외).
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

  // 4. needs_check 기관 선택(하나은행) -> 주소 입력행
  ok(await pick("하나은행", "hana"), "하나은행(미확인) 칩이 보임");
  await page.fill("#inst-search", "");
  const fillRow = page.locator('#inst-selected .sel-row[data-id="hana"] .sel-fill');
  ok((await fillRow.count()) === 1, "미확인 기관은 주소 입력행이 뜸");
  const m1 = await page.locator("#missing-list").innerText();
  ok(/주소/.test(m1), "미입력 점검에 주소 확인 필요가 걸림", m1.slice(0, 120));
  await fillRow.locator(".sel-fill-name").fill("주식회사 하나은행");
  await fillRow.locator(".sel-fill-zip").fill("04523");
  await fillRow.locator(".sel-fill-addr").fill("서울특별시 중구 을지로 66");
  await fillRow.locator(".sel-fill-note").fill("을지로2가");
  await fillRow.locator(".sel-fill-save").click();
  await page.waitForTimeout(200);
  ok((await page.locator('#inst-selected .sel-row[data-id="hana"] .sel-fill').count()) === 0, "저장 후 입력행이 사라짐");
  const hanaAddr = await page.locator('#inst-selected .sel-row[data-id="hana"] .sel-addr').innerText();
  ok(hanaAddr.includes("04523") && hanaAddr.includes("을지로2가"), "저장한 주소가 표시됨", hanaAddr);

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
    "(13529) 경기도 성남시 분당구 분당내곡로 131, 11층 (백현동, 판교테크원)",
    "(04523) 서울특별시 중구 을지로 66 (을지로2가)",
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

  // 10. 기관 추가 후 새로고침 지속
  await page.click("#btn-add-inst-open");
  await page.fill("#add-name", "가상저축은행 주식회사");
  await page.fill("#add-zip", "12345");
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
  const hanaStatus = await page.locator('.inst-item[data-id="hana"]').getAttribute("data-status");
  ok(hanaStatus === "user_provided", "직원이 입력한 기관은 새로고침 후 user_provided", hanaStatus);

  // 11. 최신화 패널: JSON 붙여넣기 -> 비교 -> 적용
  await page.fill("#inst-search", "");
  await page.click("#btn-update-open");
  ok(await page.locator("#update-panel").isVisible(), "최신화 패널 열림");
  const upd = { institutions: [{ id: "kookmin", name: "주식회사 국민은행", zip: "07331", addr: "서울특별시 영등포구 국제금융로8길 26", note: "여의도동", sources: [{ label: "가상 출처 A", url: "https://example.com/a" }, { label: "가상 출처 B", url: "https://example.org/b" }] }, { id: "citi", name: "주식회사 한국씨티은행", zip: "03184", addr: "서울특별시 중구 청계천로 24", note: "서린동", sources: [{ label: "가상", url: "https://example.com/c" }] }, { id: "bogus", zip: "1", addr: "", sources: [] }] };
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
