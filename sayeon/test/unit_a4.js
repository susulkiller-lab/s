/* A4 별지 단위 시험 (node). 실행: cd $R && node test/unit_a4.js */
'use strict';
require('../src/common.js');
require('../src/viz_a4.js');
const SY = globalThis.SY;
const sample = require('../data/sample_min.json');
const gen = require('./gen_synth_a4.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  통과  ' + name); }
  else { fail++; console.log('  실패  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
const PT = 0.3528;
const synthP = gen(20240607, '원고');
const synthD = gen(20240607, '피고');
const noMargins = clone(sample); delete noMargins.margins;
const USER_M = { top: 25, bottom: 15, left: 20, right: 15 };

function allSvg(res) { return res.pages.map(p => p.figure + p.sheet).join('\n'); }
function allFn(res) { return res.pages.map(p => p.footnotes.map(f => f.text).join('\n')).join('\n'); }

console.log('1. 배치: 줄 수·쪽 수·줄 방향');
{
  const mS = SY.Viz.a4.layout(sample, { layout: 'S', mode: 'internal' });
  const mZ = SY.Viz.a4.layout(sample, { layout: 'Z', mode: 'internal' });
  // sample_min 내부용: 사실 7건, F3 는 일자 불일치로 두 지점, F4 는 같은 일자 원/피 한 슬롯 -> 8 지점
  ok(mS.points.length === 8, 'sample 내부용 지점 수 8', mS.points.length);
  ok(mS.n === 5, '기본 여백(본문 폭 150mm)에서 한 줄 5지점', mS.n);
  ok(mS.pages.length === 1 && mS.pages[0].rows.length === 2, 'sample 내부용 1쪽 2줄', mS.pages.map(p => p.rows.length));
  ok(mS.pages[0].rows.map(r => r.dir).join() === '1,-1', 'S자: 첫 줄 좌→우, 둘째 줄 우→좌', mS.pages[0].rows.map(r => r.dir));
  ok(mZ.pages[0].rows.every(r => r.dir === 1), 'Z자: 모든 줄 좌→우');
  const r1 = mS.pages[0].rows[1];
  ok(r1.xs.every((x, i) => i === 0 || x < r1.xs[i - 1]), 'S자 둘째 줄 지점 x 가 오른쪽에서 왼쪽으로 감소', r1.xs);
  const big = SY.Viz.a4.layout(synthP, { layout: 'S', mode: 'internal' });
  let dirsOk = true;
  big.pages.forEach(p => p.rows.forEach((r, i) => { if (r.dir !== (i % 2 ? -1 : 1)) dirsOk = false; }));
  ok(dirsOk, '합성 60건 S자: 각 쪽에서 줄 방향이 좌→우, 우→좌로 번갈음');
  const nPts = big.pages.reduce((a, p) => a + p.rows.reduce((b, r) => b + r.pts.length, 0), 0);
  ok(nPts === big.points.length, '쪽 나누기 후 지점 누락·중복 없음', [nPts, big.points.length]);
  ok(big.pages.length > 1, '합성 60건 내부용은 여러 쪽(' + big.pages.length + '쪽)');
  console.log('     (합성 60건 내부용 S: ' + big.pages.length + '쪽, 쪽별 줄 수 ' + big.pages.map(p => p.rows.length).join(',') + ')');
  const sub = SY.Viz.a4.layout(synthP, { layout: 'Z', mode: 'submit' });
  console.log('     (합성 60건 제출용 Z: ' + sub.pages.length + '쪽, 쪽별 줄 수 ' + sub.pages.map(p => p.rows.length).join(',') + ')');
  const m3 = SY.Viz.a4.layout(synthP, { layout: 'S', mode: 'internal', itemsPerRow: 3 });
  ok(m3.n === 3 && m3.pages.every(p => p.rows.every(r => r.pts.length <= 3)), 'itemsPerRow:3 지정이 반영됨');
}

console.log('2. 번호: 시간순, 원/피 같은 번호');
{
  [sample, synthP].forEach((C, ci) => {
    const m = SY.Viz.a4.layout(C, { mode: 'internal' });
    const keys = m.items.map(it => SY.date.span(it.fact.date && it.fact.date.start ? it.fact.date : it.parts[0].date).start);
    ok(keys.every((k, i) => i === 0 || k >= keys[i - 1]) && m.items.every((it, i) => it.no === i + 1),
      (ci ? '합성' : 'sample') + ': 번호 1..N 이 사실 일자 순서');
    // 지점 순서는 일자순(원/피 일자 불일치 사실만 번호가 앞뒤로 갈 수 있음)
    const pk = m.points.map(p => p.span.start);
    ok(pk.every((k, i) => i === 0 || k >= pk[i - 1]), (ci ? '합성' : 'sample') + ': 시간선 위 지점이 일자 순서');
  });
  const m = SY.Viz.a4.layout(sample, { mode: 'internal' });
  const f3 = m.points.filter(p => p.item.fact.id === 'F3');
  ok(f3.length === 2 && f3[0].item.no === f3[1].item.no, 'F3(일자 불일치): 두 지점이 같은 번호', f3.map(p => p.kind));
  const res = SY.Viz.a4(sample, { mode: 'internal', layout: 'S' });
  const no3 = f3[0].item.mark;
  ok(res.pages[0].figure.indexOf(no3 + '원') >= 0 && res.pages[0].figure.indexOf(no3 + '피') >= 0, 'F3 표시에 "' + no3 + '원"/"' + no3 + '피"');
  const f4 = m.points.filter(p => p.item.fact.id === 'F4');
  ok(f4.length === 1 && f4[0].kind === 'pair' && f4[0].labels.length === 2, 'F4(같은 일자 양측): 한 슬롯 위·아래 두 글상자');
  // 기본 5지점/줄에서는 F3 원(12. 29.)·피(10. 31.)가 다른 줄 -> 곡선 없음(번호로만 연결). 6지점/줄이면 같은 줄 -> 곡선
  ok(!/data-curve=/.test(res.pages[0].figure), '다른 줄에 놓인 일자 불일치는 곡선 없이 같은 번호로만 연결');
  const res6 = SY.Viz.a4(sample, { mode: 'internal', layout: 'S', itemsPerRow: 6 });
  ok(/data-curve="3"|data-curve="5"/.test(res6.pages[0].figure) && /<path d="[^"]*"[^>]*stroke-dasharray="0.6 0.6"[^>]*data-curve=/.test(res6.pages[0].figure), '같은 줄 안 일자 불일치는 점선 곡선(data-curve)으로 연결');
  const synthCurves = allSvg(SY.Viz.a4(synthP, { mode: 'internal' })).match(/data-curve=/g) || [];
  ok(synthCurves.length > 0, '합성 60건 내부용: 일자 불일치 곡선 ' + synthCurves.length + '개');
  ok(allSvg(SY.Viz.a4(synthP, { mode: 'submit' })).indexOf('data-curve=') < 0, '제출용에는 일자 불일치 곡선 없음(상대방 지점이 없으므로)');
}

console.log('3. 제출용 필터: 상대방 서술 완전 제외');
{
  function leakCheck(C, label) {
    const our = C.ourSide, oppKey = our === '원고' ? 'defendant' : 'plaintiff', ourKey = our === '원고' ? 'plaintiff' : 'defendant';
    ['S', 'Z'].forEach(layout => {
      const res = SY.Viz.a4(C, { mode: 'submit', layout });
      const svg = allSvg(res), fn = allFn(res), json = JSON.stringify(res.pages.map(p => p.footnotes)) + JSON.stringify(res.warnings);
      const leaks = [];
      (C.facts || []).forEach(f => {
        const opp = f[oppKey]; if (!opp) return;
        const t = String(opp.text || '').trim(); if (t.length < 4) return;
        const ourT = f[ourKey] ? String(f[ourKey].text || '') : '';
        const probe = SY.esc(t.slice(0, Math.min(14, t.length)));
        const raw = t.slice(0, Math.min(14, t.length));
        if (ourT.indexOf(raw) >= 0 || String(f.title || '').indexOf(raw) >= 0) return;
        if (svg.indexOf(probe) >= 0 || svg.indexOf(raw) >= 0 || fn.indexOf(raw) >= 0 || json.indexOf(raw) >= 0) leaks.push(f.id);
        // 상대방 증거번호(우리 측과 겹치지 않는 것)
        (opp.evidence || []).forEach(e => { if ((f[ourKey] && f[ourKey].evidence || []).indexOf(e) < 0 && new RegExp('[ >,]' + e + '[,<) ]').test(svg + ' ' + fn + ' ')) leaks.push(f.id + ':' + e); });
      });
      ok(leaks.length === 0, label + ' ' + layout + ': 그림·각주·경고 어디에도 상대방 서술·증거번호 없음', leaks);
      const oppKind = our === '원고' ? 'd' : 'p', oppName = our === '원고' ? '피고' : '원고';
      ok(svg.indexOf('data-k="' + oppKind + '"') < 0, label + ' ' + layout + ': 상대방 주장 표지(' + (oppKind === 'd' ? '마름모' : '빈 원') + ') 없음');
      ok(svg.indexOf(oppName + ' 주장') < 0 && svg.indexOf(oppName + ':') < 0, label + ' ' + layout + ': "' + oppName + ' 주장" 범례·접두어 없음');
    });
  }
  leakCheck(sample, 'sample(원고측)');
  leakCheck(synthP, '합성(원고측)');
  leakCheck(synthD, '합성(피고측)');
  const resP = SY.Viz.a4(synthP, { mode: 'submit' });
  ok(allSvg(resP).indexOf('피고측서술') < 0 && allFn(resP).indexOf('피고측서술') < 0, '합성(원고측) 제출용: "피고측서술" 문자열 0건');
  const resD = SY.Viz.a4(synthD, { mode: 'submit' });
  ok(allSvg(resD).indexOf('원고측서술') < 0 && allFn(resD).indexOf('원고측서술') < 0, '합성(피고측) 제출용: "원고측서술" 문자열 0건');
  const resI = SY.Viz.a4(synthP, { mode: 'internal' });
  ok(allFn(resI).indexOf('피고측서술') >= 0 && allFn(resI).indexOf('원고측서술') >= 0, '내부용은 양측 서술 모두 포함');
  // 다툼 없는 사실·우리 측 주장만 남았는지(지점 종류)
  const m = SY.Viz.a4.layout(synthP, { mode: 'submit' });
  ok(m.points.every(p => p.kind === 'a' || p.kind === 'p'), '제출용(원고측) 지점은 다툼 없음(a)·원고(p)만');
  const sAgreed = synthP.facts.filter(f => f.dispute === '다툼없음').length;
  const sOurs = synthP.facts.filter(f => f.dispute !== '다툼없음' && f.plaintiff).length;
  ok(m.items.length === sAgreed + sOurs, '제출용 사실 수 = 다툼없음 ' + sAgreed + ' + 원고 주장 ' + sOurs, m.items.length);
}

console.log('4. 폭·높이(mm) 정확성');
{
  [[noMargins, null, 150, 232, '기본 여백(위45·아래20·좌우30)'], [sample, USER_M, 175, 257, '사용자 여백(위25·아래15·좌20·우15)']].forEach(([C, mg, W, H, label]) => {
    ['S', 'Z'].forEach(layout => ['submit', 'internal'].forEach(mode => {
      [C, synthP].forEach((CC, di) => {
        const res = SY.Viz.a4(CC, { layout, mode, margins: mg || undefined });
        const okW = res.widthMm === W && res.pages.every(p => {
          const tag = /<svg\b[^>]*>/.exec(p.figure)[0];
          return tag.indexOf('width="' + W + 'mm"') >= 0 && tag.indexOf('height="' + H + 'mm"') >= 0 && tag.indexOf('viewBox="0 0 ' + W + ' ' + H + '"') >= 0;
        });
        const okH = res.heightMm === H && res.pages.every(p => p.contentHeightMm <= H + 1e-6);
        const okSheet = res.pages.every(p => /<svg\b[^>]*width="210mm" height="297mm"/.test(p.sheet));
        ok(okW && okH && okSheet, label + ' ' + (di ? '합성' : 'sample') + ' ' + layout + '/' + mode + ': figure width=' + W + 'mm, 높이 ' + H + 'mm 이하, sheet 210x297', res.pages.map(p => p.contentHeightMm));
      });
    }));
  });
  const C2 = clone(sample); C2.margins = { top: 45, bottom: 20, left: 35, right: 25 };
  ok(SY.Viz.a4(C2).widthMm === 150, 'C.margins(좌35·우25) 반영: W=150');
  ok(SY.Viz.a4(C2, { margins: { left: 20, right: 20 } }).widthMm === 170, 'opts.margins 가 C.margins 보다 우선: W=170');
}

console.log('5. 흑백 팔레트·글자 크기');
{
  const allowed = /^(none|#000|#000000|#fff|#ffffff|#([0-9a-f]{2})\2\2|#([0-9a-f])\3\3)$/i;
  let bad = new Set(), styleAttr = 0, minFs = 99, minTitle = 99, nTitle = 0;
  const combos = [];
  [sample, synthP, synthD].forEach(C => ['S', 'Z'].forEach(layout => ['submit', 'internal'].forEach(mode => combos.push(SY.Viz.a4(C, { layout, mode })))));
  combos.forEach(res => res.pages.forEach(p => {
    const s = p.figure + p.sheet;
    (s.match(/\s(fill|stroke)="[^"]*"/g) || []).forEach(a => { const v = /"([^"]*)"/.exec(a)[1]; if (!allowed.test(v)) bad.add(v); });
    if (/\sstyle="/.test(s) || /color=|rgb\(|hsl\(/.test(s)) styleAttr++;
    (s.match(/font-size="([\d.]+)"/g) || []).forEach(a => { const v = parseFloat(/"([\d.]+)"/.exec(a)[1]); minFs = Math.min(minFs, v); });
  }));
  // 표제 줄 글자 크기(배치 모델에서)
  const m = SY.Viz.a4.layout(synthP, { mode: 'internal' });
  m.points.forEach(pt => pt.labels.forEach(lb => lb.lines.forEach(l => { if (l.title) { nTitle++; minTitle = Math.min(minTitle, l.fs); } })));
  ok(bad.size === 0, '모든 fill/stroke 값이 #000·#fff·회색조·none', [...bad]);
  ok(styleAttr === 0, 'style 속성·색 함수 없음');
  ok(minFs >= 8 * PT - 0.005, '모든 글자 8pt(' + (8 * PT).toFixed(3) + 'mm) 이상: 최소 ' + minFs);
  ok(nTitle > 0 && minTitle >= 8.5 * PT - 0.005, '표제 8.5pt(' + (8.5 * PT).toFixed(3) + 'mm) 이상: 최소 ' + minTitle.toFixed(3));
  const r = SY.Viz.a4(sample, { fontScale: 0.8 });
  ok(r.warnings.some(w => /글자 크기 배율/.test(w)) && /font-size="2.82"/.test(r.pages[0].figure), 'fontScale<1 은 1로 올리고 경고');
  ok(combos.every(res => res.pages.every(p => p.figure.indexOf('font-family="Batang, 바탕, AppleMyungjo, &#39;Noto Serif KR&#39;, serif"') >= 0)), '글꼴 지정 Batang, 바탕, AppleMyungjo, Noto Serif KR, serif');
  ok(combos.every(res => res.pages.every(p => !/\shref=|xlink:|@import|url\(/.test(p.figure + p.sheet))), '외부 리소스 참조 없음(자기완결)');
}

console.log('6. 글상자 폭 추정·각주·긴 공백·쪽 머리');
{
  const m = SY.Viz.a4.layout(synthP, { mode: 'internal' });
  let over = [];
  m.points.forEach(pt => pt.labels.forEach(lb => lb.lines.forEach(l => { if (l.w > m.colW + 1e-6) over.push([pt.item.mark, l.w]); })));
  ok(over.length === 0, '모든 글상자 줄의 추정 폭 <= 글상자 폭 ' + m.colW.toFixed(2) + 'mm', over.slice(0, 5));
  const res = SY.Viz.a4(synthP, { mode: 'internal', layout: 'S' });
  const N = res.pages.length;
  ok(res.pages.every((p, i) => p.figure.indexOf('별지 사건 연표 (' + (i + 1) + '/' + N + ')') >= 0), '각 쪽 머리 "별지 사건 연표 (n/' + N + ')"');
  ok(res.pages.every((p, i) => (i > 0) === (p.figure.indexOf('> (계속)</tspan>') >= 0)), '뒤 쪽 머리에만 "(계속)"');
  ok(res.pages.every((p, i) => (i < N - 1) === (p.figure.indexOf('>(계속)</tspan>') >= 0)), '앞 쪽 하단(마지막 쪽 제외)에 "(계속)"');
  // 각주 번호는 그 쪽에 나온 번호만
  const mm = SY.Viz.a4.layout(synthP, { mode: 'internal', layout: 'S' });
  ok(mm.pages.every((p, i) => {
    const nos = new Set(p.flat.map(pt => pt.item.no));
    return res.pages[i].footnotes.every(f => nos.has(f.no)) && res.pages[i].footnotes.length === nos.size;
  }), '각 쪽 각주 = 그 쪽에 나온 번호만(빠짐·덤 없음)');
  ok(res.warnings.some(w => /^각주 .*자 중 140자까지만/.test(w)), '140자 초과 각주는 번호와 함께 경고', res.warnings.filter(w => /각주/.test(w)).slice(0, 2));
  ok(res.pages.every(p => p.footnotes.every(f => f.text.split(' / ').every(seg => [...seg.replace(/^(원고|피고)(\([^)]*\))?: /, '').replace(/ \([^)]*\)$/, '')].length <= 141))), '각주 서술 한 건 140자(+…) 이하');
  const svg = allSvg(res);
  ok(/약 \d+개월/.test(svg), '120일 초과 공백에 "약 N개월" 표기', (svg.match(/약 \d+개월/g) || []).slice(0, 5));
  const g = SY.Viz.a4.layout(synthP, { mode: 'internal' }).points.filter(p => p.gapBefore);
  ok(g.length > 0 && g.every(p => p.gapBefore.days > 120), '긴 공백 판정은 120일 초과만(' + g.length + '곳)');
  ok(SY.Viz.a4(sample, { title: '별지 2 사건 경과' }).pages[0].figure.indexOf('별지 2 사건 경과 (1/1)') >= 0, 'opts.title 이 머리글에 쓰임');
  const nc = clone(sample); delete nc.caseNo;
  ok(SY.Viz.a4(nc).pages[0].figure.indexOf('>사건 연표 (1/1)') >= 0, '사건번호 없으면 기본 제목 "사건 연표"');
  ok(svg.indexOf('&lt;갑&gt;') >= 0 && svg.indexOf('&amp; 견적') >= 0 && svg.indexOf('<갑>') < 0 && svg.indexOf('& 견적') < 0, '특수문자(<, &)는 이스케이프');
}

console.log('7. 걸러 보기(issueId/from/to)');
{
  const r = SY.Viz.a4.layout(sample, { mode: 'internal', issueId: 'I2' });
  ok(r.items.length === 1 && r.items[0].fact.id === 'F4' && r.items[0].no === 1, 'issueId I2 -> F4 하나, 번호 ①부터');
  const r2 = SY.Viz.a4.layout(synthP, { mode: 'internal', from: '2021-03-01', to: '2021-04-30' });
  ok(r2.items.length >= 16 && r2.items.every(it => {
    const s = [it.fact.date, it.fact.plaintiff && it.fact.plaintiff.date, it.fact.defendant && it.fact.defendant.date].map(d => d && SY.date.span(d)).filter(Boolean);
    return s.some(x => x.end >= Date.UTC(2021, 2, 1) && x.start <= Date.UTC(2021, 3, 30));
  }), 'from/to 2021. 3.~4. -> 몰린 구간 ' + r2.items.length + '건만');
  const r3 = SY.Viz.a4({ facts: [] }, {});
  ok(r3.pages.length === 0 && r3.warnings.length === 1, '사실이 없으면 쪽 0개 + 경고');
}

console.log('8. PNG 해상도 덩이(pHYs)');
{
  const crc = SY.Viz.a4._crc32;
  const iend = new Uint8Array([73, 69, 78, 68]);
  ok(crc(iend, 0, 4) === 0xAE426082, 'CRC32("IEND") = AE426082');
  // 1x1 흰 PNG (IHDR, IDAT, IEND)
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAG7buVgAAAABJRU5ErkJggg==';
  const src = new Uint8Array(Buffer.from(b64, 'base64'));
  const out = SY.Viz.a4._pngSetDpi(src, 300);
  const i = Buffer.from(out).indexOf('pHYs');
  const dv = new DataView(out.buffer, out.byteOffset);
  ok(i === 37 && dv.getUint32(i + 4) === 11811 && out[i + 12] === 1, 'IHDR 뒤에 pHYs 300dpi(11811 px/m) 삽입');
  ok(dv.getUint32(i + 13) === crc(out, i, i + 13), 'pHYs CRC 일치');
  const again = SY.Viz.a4._pngSetDpi(out, 600);
  ok(again.length === out.length && Buffer.from(again).indexOf('pHYs') === 37, '이미 있는 pHYs 는 바꿔 끼움(중복 없음)');
  let threw = false;
  SY.Viz.toPngBlob('<svg/>', {}).catch(() => { threw = true; }).then(() => {
    ok(threw, 'node(DOM 없음)에서 toPngBlob 은 오류로 거절');
    console.log('\n결과: 통과 ' + pass + ', 실패 ' + fail);
    process.exit(fail ? 1 : 0);
  });
}
