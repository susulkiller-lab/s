// 키트용 빌드(dist/finorder.kit.html) 브라우저 시험.
// 키트 빌드는 DOCX 라이브러리를 CDN에서 불러온다. 시험 환경은 외부 CDN에 접속할 수 없으므로 CDN 요청을 가로채 로컬 vendor 파일로 응답한다.
// 사전 준비: npm i playwright-core (저장소 밖), python3 finorder/build.py
// 실행: LC_ALL=C.UTF-8 NODE_PATH=<node_modules> node finorder/tests/kit_e2e.js
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const ROOT = process.env.FINORDER_ROOT || path.resolve(__dirname, "..");
const OUT = process.env.KIT_E2E_OUT || path.join(__dirname, "e2e-out");
fs.mkdirSync(OUT, { recursive: true });

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = "/opt/pw-browsers";
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const sub of ["chrome-linux64", "chrome-linux"]) {
    const p = path.join(base, d, sub, "chrome");
    if (fs.existsSync(p)) return p;
  }
  return undefined; // playwright 기본 경로에 맡긴다
}

const kit = fs.readFileSync(path.join(ROOT, "dist", "finorder.kit.html"), "utf8");
const PAGE = path.join(OUT, "kit-wrapped.html");
fs.writeFileSync(PAGE, '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + kit + "</body></html>");
const LIB = path.join(ROOT, "vendor", "docx-8.5.0.iife.js");
const JSD = "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.iife.js";
const UNP = "https://unpkg.com/docx@8.5.0/build/index.iife.js";
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m, x !== undefined ? JSON.stringify(x) : ""); } };

async function fillAndSave(page, label) {
  await page.fill("#case-no", "2026드단12345");
  await page.fill("#case-name", "이혼 등");
  await page.fill("#plaintiff", "홍길동");
  await page.fill("#defendant", "김영희");
  await page.check("#ours-defendant");
  await page.fill("#inst-search", "국민");
  await page.locator('.inst-item[data-id="kookmin"]').first().click();
  await page.fill("#inst-search", "");
  await page.fill("#holders .holder:first-child .h-no", "8001011234567");
  await page.click('[data-preset="3y"]');
  await page.waitForTimeout(200);
  const miss = await page.locator("#missing-list .miss-item").count();
  ok(miss === 0, label + ": 필수 항목을 모두 채우면 점검 항목이 0건", miss);
  const dlp = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.click("#btn-docx");
  return dlp;
}

(async () => {
  const browser = await chromium.launch({ executablePath: chromePath(), args: ["--no-sandbox"] });
  const mk = async (routes) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: "ko-KR" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const [url, mode] of routes) {
      await page.route(url, (r) => (mode === "local" ? r.fulfill({ path: LIB, contentType: "application/javascript" }) : r.abort()));
    }
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto("file://" + PAGE);
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  };

  { // A. jsDelivr 정상
    const { ctx, page, errors } = await mk([[JSD, "local"], [UNP, "abort"]]);
    ok((await page.evaluate(() => typeof window.docx)) === "object", "A: jsDelivr에서 docx 전역이 생김");
    const dl = await fillAndSave(page, "A");
    ok(!!dl, "A: DOCX 다운로드 발생");
    if (dl) { const f = path.join(OUT, "kit-a.docx"); await dl.saveAs(f); ok(fs.statSync(f).size > 5000, "A: DOCX 파일 크기", fs.statSync(f).size); }
    ok(errors.length === 0, "A: 페이지 오류 없음", errors);
    await ctx.close();
  }
  { // B. jsDelivr 차단 -> unpkg 대체
    const { ctx, page, errors } = await mk([[JSD, "abort"], [UNP, "local"]]);
    ok((await page.evaluate(() => typeof window.docx)) === "object", "B: jsDelivr가 막히면 unpkg에서 docx 전역이 생김");
    const dl = await fillAndSave(page, "B");
    ok(!!dl, "B: DOCX 다운로드 발생");
    ok(errors.length === 0, "B: 페이지 오류 없음", errors);
    await ctx.close();
  }
  { // C. 둘 다 차단 -> 화면은 정상, DOCX만 안내 문구
    const { ctx, page, errors } = await mk([[JSD, "abort"], [UNP, "abort"]]);
    ok((await page.evaluate(() => typeof window.docx)) === "undefined", "C: 둘 다 막히면 docx 전역이 없음");
    ok((await page.locator(".inst-item").count()) > 0, "C: 화면은 정상 동작(기관 목록 표시)");
    await page.fill("#case-no", "2026드단12345");
    const dlp = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
    await page.click("#btn-docx"); await page.waitForTimeout(300); await page.click("#btn-docx");
    const dl = await dlp;
    ok(!dl, "C: 다운로드는 일어나지 않음");
    const toast = await page.locator("#toast").innerText().catch(() => "");
    ok(/라이브러리|복사/.test(toast), "C: 안내 문구가 뜸", toast);
    ok(errors.length === 0, "C: 페이지 오류 없음", errors);
    await ctx.close();
  }
  console.log(`\n결과: 통과 ${pass}, 실패 ${fail}`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("스크립트 오류", e); process.exit(2); });
