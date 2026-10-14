/* 변천 지도 Playwright 시험 + 스크린샷(test/shots/map_*.png).
   실행: cd $R && NODE_PATH=$(npm root -g) node test/shot_map.js
   파일은 page.route 로 http://localhost/ 아래에 내준다(localhost 는 보안 컨텍스트라 클립보드 API 시험 가능).
   확인: 콘솔 오류, 페이지 가로 스크롤(격자 컨테이너 밖), 배지·서랍·담기·복사(성공/폴백)·저장·걸러 보기·키보드·빈 상태·성능. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const R = path.resolve(__dirname, '..');
const BASE = 'http://localhost/';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info != null ? '  [' + info + ']' : '')); }

async function open(browser, { data = 'sample', width = 1280, height = 900, theme = 'light', perms = [], init = null }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, deviceScaleFactor: 1, permissions: perms });
  await ctx.route(BASE + '**', route => {
    const u = new URL(route.request().url());
    const p = path.normalize(path.join(R, decodeURIComponent(u.pathname)));
    if (!p.startsWith(R) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ path: p, contentType: MIME[path.extname(p)] || 'application/octet-stream' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (init) await page.addInitScript(init);
  await page.goto(BASE + 'test/harness_map.html?bare=1&data=' + data);
  await page.waitForFunction(() => window.__ready === true);
  return { ctx, page, errors };
}
const noPageHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
async function shot(page, name, full = true) { await page.screenshot({ path: path.join(OUT, 'map_' + name + '.png'), fullPage: full }); }

(async () => {
  const browser = await chromium.launch();
  try {
    /* 1. 기본 화면: sample(sample_min + 미반복 1건), 1280/400, 라이트/다크 */
    for (const [w, theme] of [[1280, 'light'], [1280, 'dark'], [400, 'light'], [400, 'dark']]) {
      const { ctx, page, errors } = await open(browser, { width: w, theme });
      const info = await page.evaluate(() => ({
        badges: document.querySelectorAll('.mp-scroll .mp-badge').length,
        takes: document.querySelectorAll('.mp-scroll input[data-take]').length,
        cols: document.querySelectorAll('.mp-grid thead th.mp-colh').length,
        rows: document.querySelectorAll('.mp-grid tbody tr').length,
        dim: document.querySelectorAll('td.mp-dim').length,
        omit: document.querySelectorAll('.mp-st-omit').length,
        bg: getComputedStyle(document.querySelector('.mp-grid td')).backgroundColor
      }));
      check(`sample ${w} ${theme}: 배지 5(C1~C5), 담기 4(보충 제외), 열 4, 행 4, 미반복 자리 1`,
        info.badges === 5 && info.takes === 4 && info.cols === 4 && info.rows === 4 && info.omit === 1, JSON.stringify(info));
      check(`sample ${w} ${theme}: 페이지 가로 스크롤 없음`, await noPageHScroll(page));
      if (w === 400) {
        const sc = await page.evaluate(() => { const s = document.querySelector('.mp-scroll'); return s.scrollWidth > s.clientWidth; });
        check('sample 400: 격자 컨테이너 안에서만 가로 스크롤', sc);
      }
      await shot(page, `sample_${w}_${theme}`);
      check(`sample ${w} ${theme}: 콘솔 오류 없음`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 2. 비교 서랍 */
    {
      const { ctx, page, errors } = await open(browser, { width: 1280, theme: 'light' });
      await page.click('.mp-scroll [data-chg="C1"]');
      const d = await page.evaluate(() => {
        const dw = document.querySelector('.mp-dw');
        const cols = getComputedStyle(dw.querySelector('.mp-cmp')).gridTemplateColumns.split(' ').length;
        return { open: !dw.hidden, text: dw.innerText, cols, focus: document.activeElement && document.activeElement.className,
          cur: !!document.querySelector('td.mp-cur') };
      });
      check('서랍(C1 변경) 열림, 앞/뒤 진술·원문 인용·판정 근거, 데스크톱 3단', d.open && d.cols === 3 && /앞 진술/.test(d.text) && /뒤 진술/.test(d.text)
        && d.text.includes('상수도 문제는 없습니다') && d.text.includes('토지는 상수도 미급수지역이고 인입경비는 약 3천만 원이 소요됩니다') && /판정 근거/.test(d.text) && d.cur,
        'cols=' + d.cols + ' focus=' + d.focus);
      check('서랍 열 때 제목으로 초점 이동', /mp-dw-title/.test(d.focus || ''));
      const vis = await page.evaluate(() => {
        const b = document.querySelector('.mp-scroll').getBoundingClientRect(), t = document.querySelector('td.mp-cur').getBoundingClientRect();
        const sw = document.querySelector('th.mp-rowh').offsetWidth;
        return { ok: t.left >= b.left + sw - 1 && t.right <= b.right + 1, tl: Math.round(t.left), tr: Math.round(t.right), bl: Math.round(b.left + sw), br: Math.round(b.right) };
      });
      check('서랍으로 격자가 좁아져도 선택한 칸이 격자 안에 보임', vis.ok, JSON.stringify(vis));
      await shot(page, 'drawer_1280_light', false);
      await page.keyboard.press('Escape');
      const back = await page.evaluate(() => ({ hidden: document.querySelector('.mp-dw').hidden, f: document.activeElement.getAttribute('data-chg') }));
      check('Esc 로 닫히고 초점이 배지로 돌아옴', back.hidden && back.f === 'C1', JSON.stringify(back));
      check('서랍(데스크톱) 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, { width: 1280, theme: 'dark' });
      await page.click('.mp-scroll [data-chg="C2"]');
      const t = await page.evaluate(() => document.querySelector('.mp-dw').innerText);
      check('자백후보 서랍: "상대방 주장"/"인정 취지의 기재" 라벨, 후보 고정 문구, 단정 표현 없음',
        t.includes('상대방 주장') && t.includes('인정 취지의 기재') && t.includes('후보이며 변론조서로 진술 여부 확인 필요') && !/자백 성립|자백이 성립|확정/.test(t));
      check('같은 칸의 다른 판정 탭(C1, C2) 표시', await page.locator('.mp-dw .mp-tab').count() === 2);
      await shot(page, 'drawer_adm_1280_dark', false);
      check('자백후보 서랍 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    for (const theme of ['light', 'dark']) {
      const { ctx, page, errors } = await open(browser, { width: 400, height: 860, theme });
      await page.click('.mp-scroll [data-chg="C5"]');
      // 올라오는 동작(약 0.18초)이 끝난 뒤 위치를 잰다
      await page.evaluate(() => Promise.all(document.querySelector('.mp-dw').getAnimations().map(a => a.finished)));
      const s = await page.evaluate(() => {
        const dw = document.querySelector('.mp-dw'), r = dw.getBoundingClientRect(), cs = getComputedStyle(dw);
        return { pos: cs.position, bottom: Math.round(r.bottom), vh: innerHeight, left: r.left, width: r.width, text: dw.innerText,
          scrim: !document.querySelector('.mp-scrim').hidden };
      });
      check(`폰 ${theme}: 서랍이 아래 시트(fixed, 화면 아래 붙음, 폭 전체)`, s.pos === 'fixed' && s.bottom === s.vh && s.left === 0 && s.width === 400 && s.scrim, JSON.stringify({ pos: s.pos, bottom: s.bottom, vh: s.vh, w: s.width }));
      check(`폰 ${theme}: 미반복 서랍 오른쪽(뒤 서면) 빈 칸 안내`, s.text.includes('뒤 서면') && s.text.includes('이 서면에서는 해당 쟁점의 이 주장을 다루지 않음') && s.text.includes('잔금 기한은 2098. 10. 31.에서 2098. 12. 29.로 연장하였습니다'));
      check(`폰 ${theme}: 페이지 가로 스크롤 없음(시트 열림)`, await noPageHScroll(page));
      await shot(page, `drawer_400_${theme}`, false);
      await page.click('.mp-scrim', { position: { x: 200, y: 20 } });
      check(`폰 ${theme}: 바깥(덮개) 누르면 닫힘`, await page.evaluate(() => document.querySelector('.mp-dw').hidden));
      check(`폰 서랍 ${theme} 콘솔 오류 없음`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 3. 담기 + 하단 막대 + 복사(폴백) + 저장 */
    const expectText = async page => page.evaluate(() => SY.Viz.rebuttalText(window.__C__, ['C1', 'C2', 'C5']));
    {
      const stub = () => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } });
        document.execCommand = () => false;
      };
      const { ctx, page, errors } = await open(browser, { width: 1280, theme: 'light', init: stub });
      for (const id of ['C1', 'C2', 'C5']) await page.check(`.mp-scroll input[data-take="${id}"]`);
      const bar = await page.evaluate(() => ({ t: document.querySelector('.mp-bar').innerText, sel: window.__sel }));
      check('담기 3건 → 막대 "3건 담김", onSelectionChange 호출', bar.t.includes('반박 재료 3건 담김') && bar.sel && bar.sel.length === 3, bar.t.split('\n')[0]);
      await page.click('.mp-bar [data-act="copy"]');
      await page.waitForFunction(() => document.querySelector('.mp-msg') && document.querySelector('.mp-msg').textContent.length > 0);
      const fb = await page.evaluate(() => {
        const ta = document.querySelector('.mp-prev textarea');
        return { active: document.activeElement === ta, s: ta.selectionStart, e: ta.selectionEnd, len: ta.value.length, v: ta.value, msg: document.querySelector('.mp-msg').textContent };
      });
      check('복사 실패 시 미리보기 글 전체 선택 상태로 폴백 + 안내', fb.active && fb.s === 0 && fb.e === fb.len && fb.len > 0 && /클립보드 접근이 막혀/.test(fb.msg), fb.msg);
      check('미리보기 글 = rebuttalText(C, [C1,C2,C5])', fb.v === await expectText(page));
      check('담기 후 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'bar_1280_light');
      await page.click('.mp-bar [data-act="save"]');
      const ex = await page.evaluate(() => window.__exported);
      check('파일로 저장 → onExport(text, "반박재료.txt")', ex && ex.filename === '반박재료.txt' && ex.text === await expectText(page));
      // 서랍 안 체크와 칸 체크 동기화
      await page.click('.mp-scroll [data-chg="C1"]');
      const synced = await page.evaluate(() => document.querySelector('.mp-dw input[data-take="C1"]').checked);
      await page.uncheck('.mp-dw input[data-take="C1"]');
      const after = await page.evaluate(() => ({ grid: document.querySelector('.mp-scroll input[data-take="C1"]').checked, n: window.__sel.length }));
      check('서랍의 "반박 재료에 담기"와 칸의 담기 동기화', synced && !after.grid && after.n === 2, JSON.stringify(after));
      check('보충(C4) 배지에는 담기 없음', await page.locator('.mp-scroll input[data-take="C4"]').count() === 0);
      check('담기·복사·저장 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, { width: 1280, theme: 'light', perms: ['clipboard-read', 'clipboard-write'] });
      for (const id of ['C1', 'C2', 'C5']) await page.check(`.mp-scroll input[data-take="${id}"]`);
      await page.click('.mp-bar [data-act="copy"]');
      await page.waitForFunction(() => document.querySelector('.mp-msg') && document.querySelector('.mp-msg').textContent.length > 0);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      const msg = await page.evaluate(() => document.querySelector('.mp-msg').textContent);
      check('클립보드 허용 시 복사 내용 = rebuttalText', clip === await expectText(page), msg);
      check('클립보드 복사 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, { width: 400, height: 860, theme: 'dark' });
      for (const id of ['C1', 'C2']) await page.check(`.mp-scroll input[data-take="${id}"]`);
      await page.click('.mp-bar [data-act="preview"]');
      check('폰: 담기 후 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'bar_400_dark');
      check('폰 막대 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 4. 걸러 보기 + 키보드 (합성 9 x 6) */
    {
      const { ctx, page, errors } = await open(browser, { data: 'synth', width: 1280, theme: 'light' });
      const cnt = () => page.evaluate(() => document.querySelectorAll('.mp-scroll .mp-badge').length);
      const all = await cnt();
      check('합성 9x6: 배지 40, 열 6, 행 10(미분류 포함)', all === 40 && await page.locator('.mp-grid thead th.mp-colh').count() === 6 && await page.locator('.mp-grid tbody tr').count() === 10, 'badges=' + all);
      await shot(page, 'synth_1280_light');
      const exp = await page.evaluate(() => {
        const C = window.__C__, d = {}; C.docs.forEach(x => { d[x.id] = x; });
        const st = {}; C.statements.forEach(s => { st[s.id] = s; });
        const docOf = c => c.toId ? st[c.toId].docId : c.toDocId;
        return {
          review: C.changes.filter(c => c.review === true).length,
          defendant: C.changes.filter(c => d[docOf(c)].side === '피고').length,
          noKeep: C.changes.filter(c => c.type !== '유지').length
        };
      });
      await page.check('.mp-revonly');
      const rv = await cnt();
      await page.uncheck('.mp-revonly');
      await page.click('.mp-chip[data-type="유지"]');
      const nk = await cnt();
      await page.click('[data-act="types-all"]');
      await page.check('.mp-seg input[value="피고"]');
      const df = await cnt();
      const cols = await page.locator('.mp-grid thead th.mp-colh').count();
      check('걸러 보기: 검토 필요만/유형 칩/측(피고) 결과 수', rv === exp.review && nk === exp.noKeep && df === exp.defendant && cols === 3, JSON.stringify({ rv, nk, df, cols, exp }));
      await page.check('.mp-seg input[value="전체"]');
      await page.fill('.mp-q', '상수도');
      await page.waitForTimeout(250);
      const rows = await page.locator('.mp-grid tbody tr').count();
      check('쟁점 검색 "상수도" → 1행', rows === 1, 'rows=' + rows);
      await page.fill('.mp-q', '없는쟁점');
      await page.waitForTimeout(250);
      check('검색 결과 없음 안내 + 초기화 버튼', await page.locator('.mp-nomatch [data-act="reset"]').count() === 1);
      await page.click('.mp-nomatch [data-act="reset"]');
      await page.click('.mp-chip[data-type="유지"]');
      await page.click('.mp-chip[data-type="보충"]');
      await shot(page, 'synth_filtered_1280_light');
      // 키보드: 첫 칸에 초점 → Enter 로 서랍, Esc 로 복귀
      await page.focus('td.mp-cell[tabindex="0"]');
      const k = await page.evaluate(() => document.activeElement.getAttribute('data-key'));
      await page.keyboard.press('Enter');
      const opened = await page.evaluate(() => !document.querySelector('.mp-dw').hidden);
      await page.keyboard.press('Escape');
      const back = await page.evaluate(() => document.activeElement.getAttribute('data-key'));
      check('키보드: 칸 Enter → 서랍, Esc → 같은 칸으로 초점 복귀', opened && back === k, k + ' -> ' + back);
      const th = await page.evaluate(() => ({ col: document.querySelectorAll('th[scope="col"]').length, row: document.querySelectorAll('th[scope="row"]').length, cap: !!document.querySelector('.mp-grid caption') }));
      check('표 구조: th scope=col/row, caption', th.col === 7 && th.row === 10 && th.cap, JSON.stringify(th));
      check('합성 1280 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, { data: 'synth', width: 400, height: 860, theme: 'dark' });
      await page.evaluate(() => { const s = document.querySelector('.mp-scroll'); s.scrollLeft = 300; s.scrollTop = 200; });
      const st = await page.evaluate(() => {
        const s = document.querySelector('.mp-scroll').getBoundingClientRect();
        const rh = document.querySelector('th.mp-rowh').getBoundingClientRect();
        const ch = document.querySelector('th.mp-colh').getBoundingClientRect();
        return { rowLeft: Math.round(rh.left - s.left), colTop: Math.round(ch.top - s.top) };
      });
      check('폰: 가로·세로로 굴려도 쟁점 열·머리 행 고정(sticky)', Math.abs(st.rowLeft - 1) <= 1 && Math.abs(st.colTop - 1) <= 1, JSON.stringify(st));
      check('폰 합성: 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'synth_400_dark_scrolled');
      check('합성 400 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 5. 빈 상태 */
    {
      const { ctx, page, errors } = await open(browser, { data: 'empty', width: 1280, theme: 'light' });
      const t = await page.evaluate(() => document.querySelector('.sy-map').innerText);
      check('진술 없음: 무엇이 나타날지 설명하는 빈 상태', /아직 비어 있습니다/.test(t) && /세로는 쟁점/.test(t) && /배지 읽는 법/.test(t));
      await shot(page, 'empty_1280_light');
      check('빈 상태 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    {
      const { ctx, page, errors } = await open(browser, { data: 'nochg', width: 400, theme: 'dark' });
      const t = await page.evaluate(() => ({ note: document.querySelector('.mp-notes').innerText, dim: document.querySelectorAll('td.mp-dim').length }));
      check('판정 없음: 안내 문구, 흐림 처리 안 함', /아직 변화 판정이 없습니다/.test(t.note) && t.dim === 0, JSON.stringify(t));
      check('판정 없음 폰: 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'nochg_400_dark');
      check('판정 없음 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 6. 성능: 15 x 12 (진술 360, 판정 180) */
    {
      const { ctx, page, errors } = await open(browser, { data: 'perf', width: 1280, theme: 'light' });
      const mount = await page.evaluate(() => window.__mountMs);
      const t = await page.evaluate(async () => {
        const out = [];
        for (let i = 0; i < 3; i++) for (const ty of ['유지', '유지', '변경', '변경', '자백후보', '자백후보']) {
          const t0 = performance.now(); document.querySelector('.mp-chip[data-type="' + ty + '"]').click(); document.body.offsetHeight; out.push(performance.now() - t0);
        }
        const t1 = performance.now(); document.querySelector('.mp-scroll [data-chg]').click(); document.body.offsetHeight;
        return { chips: out, drawer: performance.now() - t1 };
      });
      const sorted = t.chips.slice().sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
      // 샌드박스 CPU 기준(같은 동작도 실행마다 2배 가까이 흔들린다). 처음 그리기 300ms, 칩 클릭 중앙값·서랍 열기 100ms 를 한도로 둔다.
      check('15x12: 처음 그리기 300ms 미만, 유형 칩 클릭 중앙값·서랍 열기 100ms 미만', mount < 300 && med < 100 && t.drawer < 100,
        'mount ' + mount.toFixed(0) + 'ms, 칩 첫 클릭 ' + t.chips[0].toFixed(0) + 'ms·중앙값 ' + med.toFixed(0) + 'ms·최대 ' + sorted[sorted.length - 1].toFixed(0) + 'ms (18회), 서랍 ' + t.drawer.toFixed(0) + 'ms');
      await page.keyboard.press('Escape');
      check('15x12: 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'perf_15x12_1280_light', false);
      check('15x12 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    /* 7. (참고) 실제 사건 진술만 있는 자료: 칸당 진술이 많을 때의 더보기 */
    if (fs.existsSync(path.join(R, 'data/case_song.json'))) {
      const { ctx, page, errors } = await open(browser, { data: 'real', width: 1280, theme: 'light' });
      const more = await page.locator('.mp-more').count();
      await page.click('.mp-more');
      const opened = await page.evaluate(() => !!document.querySelector('td.mp-open'));
      check('실자료: 3건 넘는 칸에 더보기, 누르면 펼침', more > 0 && opened, 'more=' + more);
      check('실자료: 페이지 가로 스크롤 없음', await noPageHScroll(page));
      await shot(page, 'real_1280_light', false);
      check('실자료 콘솔 오류 없음', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  const f = results.filter(r => !r.ok);
  console.log('\n' + (results.length - f.length) + ' passed, ' + f.length + ' failed');
  process.exit(f.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
