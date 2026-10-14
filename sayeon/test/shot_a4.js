/* A4 별지 브라우저 시험 (Playwright).
   실행: cd $R && NODE_PATH=$(npm root -g) node test/shot_a4.js
   - sample_min, 합성 60건 x S/Z x 제출용/내부용 x 기본 여백/사용자 여백 의 모든 쪽 figure 를 실제 렌더링해
     (a) 글자-도형, 글자-글자(다른 묶음) 사각형 겹침 (b) 본문 영역 밖 요소 (c) 글상자 폭 넘침 을 getBBox 로 검사
   - 각 조합 1쪽을 toPngBlob 으로 300dpi PNG 로 만들어 페이지 안에서 디코드(크기·서명·pHYs·검은 화소·유채색 화소) 확인
   - 핵심 장면 스크린샷: test/shots/a4_*.png */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const R = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const BASE = 'http://a4.local/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await ctx.route(BASE + '**', route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    const file = path.join(R, rel);
    if (!file.startsWith(R) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, body: fs.readFileSync(file), headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(String(e)));
  await page.goto(BASE + 'test/harness_a4.html');
  await page.waitForFunction(() => window.A4H && window.A4H.ready);

  const datasets = ['sample', 'synthP'];
  const margins = { def: null, user: { top: 25, bottom: 15, left: 20, right: 15 } };
  const rows = [];
  let totalPages = 0, bad = 0;
  for (const ds of datasets) for (const layout of ['S', 'Z']) for (const mode of ['submit', 'internal']) for (const mk of Object.keys(margins)) {
    const res = await page.evaluate(async ({ ds, layout, mode, mg }) => {
      let C = JSON.parse(JSON.stringify(window.A4H.data[ds]));
      if (!mg) delete C.margins;                       // 기본 여백: 사건에 여백 지정이 없을 때
      const out = SY.Viz.a4(C, { layout, mode, margins: mg || undefined });
      const pages = out.pages.map(p => window.A4H.checkFigure(p.figure, out.widthMm, p.heightMm));
      const png = out.pages.length ? await window.A4H.checkPng(out.pages[0].figure, out.widthMm, out.heightMm) : null;
      return { W: out.widthMm, H: out.heightMm, n: out.pages.length, warnings: out.warnings.length, pages, png };
    }, { ds, layout, mode, mg: margins[mk] });
    totalPages += res.n;
    const agg = { textShape: 0, textText: 0, outside: 0, overWidth: 0, parseError: 0, samples: [] };
    res.pages.forEach((r, i) => {
      ['textShape', 'textText', 'outside', 'overWidth'].forEach(k => {
        agg[k] += r[k].length;
        if (r[k].length && agg.samples.length < 6) agg.samples.push((i + 1) + '쪽 ' + k + ': ' + r[k].slice(0, 2).join(' | '));
      });
      if (r.parseError) agg.parseError++;
    });
    const p = res.png;
    const pngOk = p && p.type === 'image/png' && p.sig && p.phys && p.w === p.expectW && p.h === p.expectH && p.dark > 0 && p.colored === 0;
    const okAll = !agg.textShape && !agg.textText && !agg.outside && !agg.overWidth && !agg.parseError && pngOk;
    if (!okAll) bad++;
    const name = `${ds}/${layout}/${mode}/${mk}`;
    rows.push(name);
    console.log(`${okAll ? '통과' : '실패'}  ${name.padEnd(28)} 본문 ${res.W}x${res.H}mm ${res.n}쪽  겹침(글자-도형 ${agg.textShape}, 글자-글자 ${agg.textText})  영역 밖 ${agg.outside}  폭 넘침 ${agg.overWidth}  ` +
      `PNG ${p ? `${p.w}x${p.h}px ${Math.round(p.bytes / 1024)}KB pHYs=${p.phys} 검은화소 ${p.dark} 유채색 ${p.colored}` : '없음'}`);
    agg.samples.forEach(s => console.log('      ' + s));
  }

  // 핵심 장면 스크린샷 (A4 미리보기 sheet, 2배 해상도)
  const shotPage = await ctx.newPage();
  await shotPage.setViewportSize({ width: 820, height: 1160 });
  await shotPage.goto(BASE + 'test/harness_a4.html');
  await shotPage.waitForFunction(() => window.A4H && window.A4H.ready);
  const scenes = [
    ['sample', 'S', 'submit', null, 0], ['sample', 'Z', 'submit', null, 0],
    ['sample', 'S', 'internal', null, 0], ['sample', 'Z', 'internal', null, 0],
    ['synthP', 'S', 'internal', null, 0], ['synthP', 'Z', 'internal', null, 0], ['synthP', 'S', 'internal', null, 1],
    ['synthP', 'Z', 'internal', null, 1], ['synthP', 'S', 'internal', null, 5],
    ['synthP', 'S', 'submit', null, 0], ['synthP', 'Z', 'submit', margins.user, 0]
  ];
  const big = await browser.newContext({ viewport: { width: 800, height: 1130 }, deviceScaleFactor: 2 });
  const bp = await big.newPage();
  for (const [ds, layout, mode, mg, pi] of scenes) {
    const svg = await shotPage.evaluate(({ ds, layout, mode, mg, pi }) => {
      const C = JSON.parse(JSON.stringify(window.A4H.data[ds]));
      const out = SY.Viz.a4(C, { layout, mode, margins: mg || undefined });
      return out.pages[pi] ? out.pages[pi].sheet : null;
    }, { ds, layout, mode, mg, pi });
    if (!svg) continue;
    await bp.setContent('<body style="margin:0;background:#888">' + svg.replace('width="210mm" height="297mm"', 'width="794" height="1123"') + '</body>');
    const file = `a4_${ds}_${layout}_${mode}${mg ? '_usermargin' : ''}_p${pi + 1}.png`;
    await bp.locator('svg').first().screenshot({ path: path.join(SHOTS, file) });
    console.log('스크린샷 ' + file);
  }
  // 시험 화면(harness) 데스크톱·휴대폰 폭
  for (const [w, h, tag] of [[1280, 900, 'desktop'], [400, 860, 'phone']]) {
    const hp = await ctx.newPage();
    await hp.setViewportSize({ width: w, height: h });
    await hp.goto(BASE + 'test/harness_a4.html');
    await hp.waitForFunction(() => window.A4H && window.A4H.ready);
    const scrollX = await hp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await hp.screenshot({ path: path.join(SHOTS, `a4_harness_${tag}.png`) });
    console.log(`스크린샷 a4_harness_${tag}.png (가로 넘침 ${scrollX}px)`);
    if (scrollX > 0) bad++;
    await hp.close();
  }
  console.log(`\n조합 ${rows.length}개, 검사한 쪽 ${totalPages}개, 실패 조합 ${bad}개, 콘솔 오류 ${consoleErrors.length}개`);
  consoleErrors.slice(0, 5).forEach(e => console.log('  콘솔: ' + e));
  await browser.close();
  process.exit(bad || consoleErrors.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
