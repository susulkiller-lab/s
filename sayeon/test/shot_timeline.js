/* 타임라인 화면 시험 + 스크린샷. 실행: cd $R && NODE_PATH=$(npm root -g) node test/shot_timeline.js
 * 장면: (sample_min | 합성 60건) x (1280 | 400px) x (라이트 | 다크) x (real | even), 모두 카드 클릭 선택 + 우측 창.
 * 자동 점검: 콘솔 오류, 카드 겹침(getBoundingClientRect + 배치 계산), 캔버스 밖, 카드 내부 넘침, 페이지 가로 스크롤, 컨트롤 넘침.
 * 상호작용: 키보드(←→, Tab, Enter, Esc), Ctrl+휠, 끌기, 미니맵 구간 지정, 기간 입력, 맞춤, 척도 전환, 쟁점 필터, 크기 변경, 200건 성능. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const R = path.resolve(__dirname, '..');
const BASE = 'http://sy.test/';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

let fails = 0;
const log = [];
function ok(cond, msg) { if (!cond) { fails++; log.push('FAIL ' + msg); console.log('FAIL ' + msg); } else console.log('ok   ' + msg); }
function clean(c) { return !c.domOverlaps.length && !c.domOutside.length && !c.innerOverflow.length && !c.layoutOverlaps && !c.layoutOutside && !c.controlsOutside.length && c.pageHScroll <= 0 && c.detailHScroll <= 0; }
function brief(c) { return JSON.stringify({ r: c.renderedCards, l: c.layoutCards, tiers: c.tiers, zoom: c.zoom && +c.zoom.toFixed(2), dO: c.domOverlaps.length, dOut: c.domOutside.length, inner: c.innerOverflow.slice(0, 3), lO: c.layoutOverlaps, lOut: c.layoutOutside, ctl: c.controlsOutside, hs: c.pageHScroll, dhs: c.detailHScroll }); }

async function open(browser, q, w, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme === 'dark' ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(BASE + '**', route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
    const f = path.join(R, rel);
    if (!f.startsWith(R) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await page.goto(BASE + 'test/harness_timeline.html?' + q);
  await page.waitForFunction(() => window.__ready === true);
  await page.waitForTimeout(120);
  return { ctx, page, errors };
}

/* 클릭할 사실: sample 은 F4(변경+자백후보), 합성은 미반복 판정이 있는 첫 사실 */
async function pickFact(page, data) {
  if (data === 'sample') return 'F4';
  return page.evaluate(() => {
    const C = window.__C, st = {};
    C.statements.forEach(s => { st[s.id] = s; });
    const ch = C.changes.find(c => c.type === '미반복' && st[c.fromId]);
    return st[ch.fromId].factIds[0];
  });
}

async function selectByClick(page, fid) {
  await page.evaluate(id => window.__tl.select(id), fid);
  const key = await page.evaluate(id => { const L = window.__tl._debug().layout; return L.cards.find(c => c.factId === id).key; }, fid);
  await page.click('.sy-tl-card[data-k="' + key + '"]');
  await page.waitForTimeout(80);
  return key;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const ONLY = process.env.ONLY || '';
    /* ---------- 1. 핵심 장면 16개 ---------- */
    if (!ONLY || ONLY === 'scenes') for (const data of ['sample', 'synth']) for (const w of [1280, 400]) for (const theme of ['light', 'dark']) for (const scale of ['real', 'even']) {
      const name = `timeline_${data}_${w}_${theme}_${scale}`;
      const { ctx, page, errors } = await open(browser, `data=${data}&scale=${scale}&theme=${theme}`, w, theme);
      const c0 = await page.evaluate(() => window.__check());
      const fid = await pickFact(page, data);
      await selectByClick(page, fid);
      const c1 = await page.evaluate(() => window.__check());
      const det = await page.evaluate(() => {
        const d = document.getElementById('detail');
        return { title: (d.querySelector('.sy-fd-title') || {}).textContent || '', rel: d.querySelectorAll('.rel').length, text: d.textContent };
      });
      const sel = await page.evaluate(() => window.__sel.slice(-1)[0]);
      await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
      ok(!errors.length, `${name}: 콘솔 오류 0 ${errors.slice(0, 2).join(' | ')}`);
      ok(clean(c0), `${name}: 첫 화면 겹침·넘침 0 ${brief(c0)}`);
      ok(clean(c1), `${name}: 선택 후 겹침·넘침 0 ${brief(c1)}`);
      ok(sel === fid && det.title.length > 0, `${name}: 클릭 선택 onSelect(${sel}) + 우측 창 표제`);
      if (data === 'synth') ok(det.text.includes('앞 주장에 대응하는 진술이 없습니다'), `${name}: 미반복(toId:null) 서면 칸 안내`);
      if (data === 'sample') ok(det.text.includes('후보이며 변론조서로 진술 여부 확인 필요') && det.rel >= 2, `${name}: 자백후보 고정 문구 + 배지`);
      await ctx.close();
    }

    /* ---------- 2. 상호작용 (합성 60건, 1280, 라이트, real) ---------- */
    if (!ONLY || ONLY === 'interact') {
      const { ctx, page, errors } = await open(browser, 'data=synth&scale=real&theme=light', 1280, 'light');
      const fid = await pickFact(page, 'synth');
      const key = await selectByClick(page, fid);
      // 키보드: → 3번, Tab 1번, Enter 로 선택
      await page.focus('.sy-tl-card[data-k="' + key + '"]');
      const order = await page.evaluate(() => window.__tl._debug().layout.cards.map(c => c.key));
      const i0 = order.indexOf(key);
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      let act = await page.evaluate(() => document.activeElement.getAttribute('data-k'));
      ok(act === order[i0 + 3], `키보드 →x3: ${key} -> ${act} (기대 ${order[i0 + 3]})`);
      await page.keyboard.press('Tab');
      act = await page.evaluate(() => document.activeElement.getAttribute('data-k'));
      ok(act === order[i0 + 4], `Tab: 다음 카드 ${act}`);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Enter');
      const s2 = await page.evaluate(() => window.__sel.slice(-1)[0]);
      ok(s2 === order[i0 + 3].split(':')[0], `Enter 선택 onSelect(${s2})`);
      await page.keyboard.press('Escape');
      ok(await page.evaluate(() => window.__sel.slice(-1)[0] === null), 'Esc 선택 해제 onSelect(null)');
      await page.keyboard.press('End');
      act = await page.evaluate(() => document.activeElement.getAttribute('data-k'));
      ok(act === order[order.length - 1], 'End: 마지막 카드');
      await page.keyboard.press('Home');
      act = await page.evaluate(() => document.activeElement.getAttribute('data-k'));
      ok(act === order[0], 'Home: 첫 카드');

      // 맞춤 → 확대 단계별 겹침 점검
      await page.click('[data-act=fit]');
      let c = await page.evaluate(() => window.__check());
      ok(c.zoom === 1 && clean(c), `맞춤: zoom 1, 겹침 0 ${brief(c)}`);
      await page.screenshot({ path: path.join(SHOTS, 'timeline_synth_1280_light_real_fit.png'), fullPage: false });
      for (let k = 0; k < 4; k++) {
        await page.click('[data-act=zoom-in]');
        c = await page.evaluate(() => window.__check());
        ok(clean(c), `확대 버튼 ${k + 1}회: 겹침 0 ${brief(c)}`);
      }
      // 끌기로 가로 이동 (축 근처 빈 곳)
      const geo = await page.evaluate(() => { const vp = document.querySelector('.sy-tl-vp'), r = vp.getBoundingClientRect(), L = window.__tl._debug().layout; return { x: r.left + r.width / 2, y: r.top + L.axisY - vp.scrollTop + 26, sl: vp.scrollLeft }; });
      await page.mouse.move(geo.x, geo.y); await page.mouse.down(); await page.mouse.move(geo.x - 300, geo.y, { steps: 6 }); await page.mouse.up();
      const sl2 = await page.evaluate(() => document.querySelector('.sy-tl-vp').scrollLeft);
      ok(Math.abs(sl2 - geo.sl - 300) < 3, `끌기 이동: scrollLeft ${geo.sl.toFixed(0)} -> ${sl2.toFixed(0)}`);
      // Ctrl+휠 확대
      const z0 = await page.evaluate(() => window.__tl._debug().zoom);
      await page.mouse.move(geo.x, geo.y); await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
      await page.waitForTimeout(100);
      const z1 = await page.evaluate(() => window.__tl._debug().zoom);
      ok(z1 > z0, `Ctrl+휠 확대: ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
      c = await page.evaluate(() => window.__check());
      ok(clean(c), `Ctrl+휠 뒤 겹침 0 ${brief(c)}`);
      await page.screenshot({ path: path.join(SHOTS, 'timeline_synth_1280_light_real_zoomed.png'), fullPage: false });
      // 미니맵 구간 지정: 미니맵 30%~45% 를 끌어 확대
      await page.click('[data-act=fit]');
      await page.$eval('.sy-tl-mini', e => e.scrollIntoView({ block: 'center' }));
      const mm = await page.evaluate(() => { const r = document.querySelector('.sy-tl-mini').getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
      await page.mouse.move(mm.x + mm.w * 0.30, mm.y); await page.mouse.down(); await page.mouse.move(mm.x + mm.w * 0.45, mm.y, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(60);
      const win = await page.evaluate(() => { const r = document.querySelector('.sy-tl-mini .mm-win'); return { x: +r.getAttribute('x'), w: +r.getAttribute('width'), zoom: window.__tl._debug().zoom }; });
      ok(win.zoom > 1 && Math.abs(win.x - mm.w * 0.30) < mm.w * 0.04 && Math.abs(win.w - mm.w * 0.15) < mm.w * 0.05, `미니맵 구간 지정: zoom ${win.zoom.toFixed(2)}, 창 x=${win.x.toFixed(0)} w=${win.w.toFixed(0)} (기대 ${(mm.w * 0.3).toFixed(0)}, ${(mm.w * 0.15).toFixed(0)})`);
      // 기간 입력
      await page.fill('[data-in=from]', '2023-01-01');
      await page.dispatchEvent('[data-in=from]', 'change');
      await page.fill('[data-in=to]', '2023-06-30');
      await page.dispatchEvent('[data-in=to]', 'change');
      const rng = await page.evaluate(() => { const L = window.__tl._debug().layout, ids = new Set(L.cards.map(c => c.factId)); const fs = window.__C.facts.filter(f => ids.has(f.id)); return { n: ids.size, bad: fs.filter(f => f.date.start < '2022-06-01' || f.date.start > '2023-06-30').map(f => f.id), change: window.__change }; });
      ok(rng.n > 0 && rng.n < 60 && !rng.bad.length && rng.change && rng.change.to === '2023-06-30', `기간 지정 2023. 1. 1.~6. 30.: ${rng.n}건, 범위 밖 ${rng.bad.length}`);
      c = await page.evaluate(() => window.__check());
      ok(clean(c), `기간 지정 후 겹침 0 ${brief(c)}`);
      await page.click('.sy-tl-range [data-act=clear-range]');
      ok(await page.evaluate(() => window.__tl._debug().layout.cards.length) > 60, '기간 해제: 전체 복귀');
      // 척도 전환 버튼
      await page.click('[data-act=scale][data-v=even]');
      ok(await page.evaluate(() => window.__tl._debug().layout.mode === 'even' && document.querySelector('[data-v=even]').getAttribute('aria-pressed') === 'true' && window.__change.scale === 'even'), '척도 전환 버튼 → even, onChange');
      // 쟁점 필터 (껍데기 select 흉내)
      await page.selectOption('#issue', 'I2');
      const iss = await page.evaluate(() => { const L = window.__tl._debug().layout; const ids = new Set(L.cards.map(c => c.factId)); return { n: ids.size, all: window.__C.facts.filter(f => f.issueIds.includes('I2')).length, status: document.querySelector('.sy-tl-status').textContent }; });
      ok(iss.n === iss.all && iss.status.includes('쟁점'), `쟁점 필터 I2: ${iss.n}/${iss.all}건, 상태 "${iss.status}"`);
      await page.selectOption('#issue', '');
      // 크기 변경(ResizeObserver)
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(150);
      c = await page.evaluate(() => window.__check());
      ok(clean(c) && c.width >= 600, `크기 변경 1280→700: 다시 배치, 겹침 0 ${brief(c)}`);
      ok(!errors.length, '상호작용 중 콘솔 오류 0 ' + errors.slice(0, 2).join(' | '));
      await ctx.close();
    }

    /* ---------- 3. 빈 상태, 200건 성능 ---------- */
    if (!ONLY || ONLY === 'misc') {
      const { ctx, page, errors } = await open(browser, 'data=empty&theme=light', 1280, 'light');
      const t = await page.evaluate(() => document.querySelector('.sy-tl-empty').textContent);
      ok(t.includes('아직 표시할 사실이 없습니다') && !errors.length, '빈 상태 안내');
      await page.screenshot({ path: path.join(SHOTS, 'timeline_empty_1280_light.png') });
      await ctx.close();
    }
    if (!ONLY || ONLY === 'misc') {
      const { ctx, page, errors } = await open(browser, 'data=synth200&theme=light&scale=real', 1280, 'light');
      const m = await page.evaluate(() => window.__mountMs);
      const c = await page.evaluate(() => window.__check());
      const t = await page.evaluate(async () => {
        const out = [];
        for (const f of [2, 2, 2, 0.5]) { const a = performance.now(); window.__tl.zoomBy(f); out.push(performance.now() - a); }
        const vp = document.querySelector('.sy-tl-vp'); const a = performance.now();
        for (let i = 0; i < 20; i++) { vp.scrollLeft += 400; await new Promise(r => requestAnimationFrame(r)); }
        out.push((performance.now() - a) / 20);
        return out;
      });
      const c2 = await page.evaluate(() => window.__check());
      ok(clean(c) && clean(c2), `200건: 겹침 0 ${brief(c)} / 확대 뒤 ${brief(c2)}`);
      console.log(`     200건 성능: 처음 그리기 ${m.toFixed(0)}ms, 확대 ${t.slice(0, 4).map(x => x.toFixed(0)).join('/')}ms, 스크롤 프레임 평균 ${t[4].toFixed(1)}ms, 카드 ${c2.layoutCards}장 중 DOM ${c2.renderedCards}장, 타임라인 DOM 노드 ${c2.domNodes}`);
      ok(c2.renderedCards < c2.layoutCards, '200건 확대 시 보이는 구간만 DOM 생성');
      ok(!errors.length, '200건 콘솔 오류 0');
      await page.screenshot({ path: path.join(SHOTS, 'timeline_synth200_1280_light_real.png') });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log('\n' + (fails ? fails + '건 실패' : '전부 통과'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
