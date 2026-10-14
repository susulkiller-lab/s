/* SY.Viz._layout 단위 시험 (node). 실행: cd $R && node test/unit_timeline.js */
'use strict';
const path = require('path');
const assert = require('assert');
const R = path.resolve(__dirname, '..');
require(path.join(R, 'src/common.js'));
require(path.join(R, 'src/viz_timeline.js'));
const genSynth = require('./gen_synth.js');
const SY = globalThis.SY;
const lay = SY.Viz._layout;
const DAY = 86400000;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok   - ' + name); }
  catch (e) { fail++; console.log('FAIL - ' + name + '\n       ' + (e && e.message)); }
}
function F(id, start, opt) {
  opt = opt || {};
  return {
    id, title: opt.title || ('사실 ' + id),
    date: { start, end: opt.end || null, precision: opt.precision || 'day', label: '' },
    plaintiff: opt.noP ? null : { text: 'p', stmtIds: [], evidence: opt.ev || [], date: opt.pDate },
    defendant: opt.d ? { text: 'd', stmtIds: [], evidence: [], date: opt.dDate } : null,
    dispute: opt.dispute || (opt.d ? '다툼' : '미확정'), issueIds: [], note: ''
  };
}
function overlaps(cards) {
  const bad = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j];
    if (a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01) bad.push([a.key, b.key]);
  }
  return bad;
}
function outside(L) {
  return L.cards.filter(c => c.x < -0.01 || c.y < -0.01 || c.x + c.w > L.width + 0.01 || c.y + c.h > L.height + 0.01).map(c => c.key);
}
function near(a, b, eps, msg) { assert.ok(Math.abs(a - b) <= (eps || 0.01), (msg || '') + ' ' + a + ' != ' + b); }
const mark = (L, fid) => L.marks.filter(m => m.factId === fid);

test('real 척도: x 간격이 일수에 비례', () => {
  const L = lay([F('A', '2022-01-01'), F('B', '2022-01-11'), F('C', '2022-01-31')], { scale: 'real', width: 1000 });
  const a = mark(L, 'A')[0].x, b = mark(L, 'B')[0].x, c = mark(L, 'C')[0].x;
  near((c - b) / (b - a), 2, 1e-6, '비율');
  near(a, 28, 1e-6, '왼쪽 여백'); near(c, 1000 - 28, 1e-6, '오른쪽 여백');
  assert.strictEqual(L.breaks.length, 0);
});

test('even 척도: 서로 다른 날짜는 등간격, 같은 날짜는 같은 x', () => {
  const L = lay([F('A', '2022-01-01'), F('B', '2022-01-02'), F('C', '2022-09-30'), F('D', '2022-09-30'), F('E', '2025-01-01')], { scale: 'even', width: 1000 });
  const xs = ['A', 'B', 'C', 'E'].map(id => mark(L, id)[0].x);
  const st = xs[1] - xs[0];
  for (let i = 2; i < xs.length; i++) near(xs[i] - xs[i - 1], st, 1e-6, '간격');
  near(mark(L, 'C')[0].x, mark(L, 'D')[0].x, 1e-9, '같은 날짜');
  assert.strictEqual(L.breaks.length, 0, 'even 에는 생략 구간 없음');
});

test('공백 압축: 120일 초과 공백은 물결선 1개 + "약 N개월 생략"', () => {
  const L = lay([F('A', '2020-01-01'), F('B', '2020-01-20'), F('C', '2021-06-01'), F('D', '2021-06-15')], { scale: 'real', width: 1000 });
  assert.strictEqual(L.breaks.length, 1);
  const b = L.breaks[0];
  near(b.x1 - b.x0, 44, 1e-6, '생략 폭');
  // 생략되는 일수 = 공백(2020-01-20 ~ 2021-06-01) - 양옆 여유 15일씩
  const gap = (Date.UTC(2021, 5, 1) - Date.UTC(2020, 0, 20)) / DAY;
  assert.strictEqual(b.days, gap - 30);
  assert.strictEqual(b.label, '약 ' + Math.round((gap - 30) / 30.44) + '개월 생략');
  assert.ok(mark(L, 'B')[0].x < b.x0 && mark(L, 'C')[0].x > b.x1, '생략 구간 양옆에 배치');
  // 생략 구간 밖은 같은 비율(px/일)
  const r1 = (mark(L, 'B')[0].x - mark(L, 'A')[0].x) / 19, r2 = (mark(L, 'D')[0].x - mark(L, 'C')[0].x) / 14;
  near(r1, r2, 1e-6, '구간별 비율');
  near(mark(L, 'D')[0].x, 972, 1e-6, '끝 여백');
});

test('공백 압축 안 함: 100일 공백(기준 120일 미만)', () => {
  const L = lay([F('A', '2020-01-01'), F('B', '2020-04-10')], { scale: 'real', width: 800 });
  assert.strictEqual(L.breaks.length, 0);
});

test('공백 기준은 전체 기간 비율도 고려(10년에 6개월 간격은 압축 안 함)', () => {
  const fs = []; for (let y = 2010; y < 2020; y++) { fs.push(F('a' + y, y + '-01-01')); fs.push(F('b' + y, y + '-07-01')); }
  const L = lay(fs, { scale: 'real', width: 2000 });
  assert.strictEqual(L.breaks.length, 0);
});

test('척도 역변환 t(x(t)) = t, x 단조 증가', () => {
  const C = genSynth(60);
  ['real', 'even'].forEach(scale => {
    const L = lay(C.facts, { scale, width: 1600 });
    const sc = L.scale;
    let prev = -Infinity;
    for (let t = sc.t0; t <= sc.t1; t += 7 * DAY) {
      const x = sc.x(t); assert.ok(x >= prev - 1e-9, scale + ' 단조'); prev = x;
      if (!sc.segs.some(s => s.x1 === s.x0 && t >= s.t0 && t <= s.t1)) near(sc.t(x), t, 1, scale + ' 역변환');
    }
  });
});

test('approx: 기준일 ±7일 흐린 구간, 라벨 "○○경"', () => {
  const L = lay([F('A', '2022-01-01'), F('B', '2022-03-10', { precision: 'approx' }), F('C', '2022-06-01')], { scale: 'real', width: 1000 });
  const m = mark(L, 'B')[0], sc = L.scale;
  assert.ok(m.fuzzy, '흐린 구간');
  near(m.fuzzy.x0, sc.x(Date.UTC(2022, 2, 3)), 1e-6); near(m.fuzzy.x1, sc.x(Date.UTC(2022, 2, 17)), 1e-6);
  near(m.x, sc.x(Date.UTC(2022, 2, 10)), 1e-6);
  assert.strictEqual(L.cards.find(c => c.factId === 'B').dateLabel, '2022. 3. 10.경');
});

test('month/year 정밀도: 해당 월·연 전체가 흐린 구간, 점은 가운데', () => {
  const L = lay([F('A', '2021-01-01'), F('M', '2022-02-01', { precision: 'month' }), F('Y', '2023-01-01', { precision: 'year' })], { scale: 'real', width: 3000, gapDays: 10000 });
  const sc = L.scale, m = mark(L, 'M')[0], y = mark(L, 'Y')[0];
  near(m.fuzzy.x0, sc.x(Date.UTC(2022, 1, 1)), 1e-6); near(m.fuzzy.x1, sc.x(Date.UTC(2022, 2, 1)), 1e-6);
  near(m.x, sc.x(Date.UTC(2022, 1, 15)), 1e-6);
  near(y.fuzzy.x0, sc.x(Date.UTC(2023, 0, 1)), 1e-6); near(y.fuzzy.x1, sc.x(Date.UTC(2024, 0, 1)), 1e-6);
  assert.strictEqual(L.cards.find(c => c.factId === 'M').dateLabel, '2022. 2.');
  assert.strictEqual(L.cards.find(c => c.factId === 'Y').dateLabel, '2023.');
});

test('range: 시작~끝 막대, 끝 라벨, 날짜 라벨', () => {
  const L = lay([F('R', '2098-11-01', { precision: 'range', end: '2099-02-15', dispute: '다툼없음' }), F('B', '2099-03-01')], { scale: 'real', width: 1000 });
  const m = mark(L, 'R')[0], sc = L.scale;
  near(m.range.x0, sc.x(Date.UTC(2098, 10, 1)), 1e-6); near(m.range.x1, sc.x(Date.UTC(2099, 1, 15)), 1e-6);
  assert.strictEqual(L.cards.find(c => c.factId === 'R').dateLabel, '2098. 11. 1. ~ 2099. 2. 15.');
  assert.ok(L.rangeLabels.some(t => t.factId === 'R' && t.label === '~ 2099. 2. 15.'));
});

test('양측 일자 불일치: 점 2개 + 점선 연결, 일치하면 점 1개', () => {
  const L = lay([
    F('X', '2098-12-29', { d: true, dispute: '일부다툼', pDate: { start: '2098-12-29', precision: 'day' }, dDate: { start: '2098-10-31', precision: 'day' } }),
    F('Y', '2098-11-15', { d: true, dispute: '다툼' })
  ], { scale: 'real', width: 1000 });
  assert.strictEqual(mark(L, 'X').length, 2);
  assert.strictEqual(L.links.length, 1);
  const k = L.links[0], sc = L.scale;
  near(k.x1, sc.x(Date.UTC(2098, 11, 29)), 1e-6); near(k.x2, sc.x(Date.UTC(2098, 9, 31)), 1e-6);
  assert.strictEqual(mark(L, 'Y').length, 1); assert.strictEqual(mark(L, 'Y')[0].side, 'pd');
  const cx = L.cards.filter(c => c.factId === 'X');
  assert.deepStrictEqual(cx.map(c => c.dir).sort(), ['down', 'up']);
  assert.ok(cx.find(c => c.side === 'p').y + 78 <= L.axisY && cx.find(c => c.side === 'd').y >= L.axisY, '원고 위, 피고 아래');
});

test('다툼없음: 카드 1장(공통), 미확정 한쪽만: 그쪽에만', () => {
  const L = lay([F('A', '2022-01-01', { d: true, dispute: '다툼없음' }), F('B', '2022-01-05', { noP: true, d: true, dispute: '미확정' })], { scale: 'real', width: 800 });
  const a = L.cards.filter(c => c.factId === 'A'), b = L.cards.filter(c => c.factId === 'B');
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].side, 'a');
  assert.strictEqual(b.length, 1); assert.strictEqual(b[0].side, 'd'); assert.strictEqual(b[0].dir, 'down');
});

test('일자 없는 사실은 skipped 로 빠짐', () => {
  const bad = F('Z', null); bad.date = { start: null, precision: 'day' };
  const L = lay([F('A', '2022-01-01'), bad], { scale: 'real', width: 800 });
  assert.deepStrictEqual(L.skipped, ['Z']); assert.strictEqual(L.count, 1);
});

test('같은 날 15건: 단 배치로 겹침 0, 컨테이너 안', () => {
  const fs = []; for (let i = 0; i < 15; i++) fs.push(F('S' + i, '2022-05-05', { d: i % 2 === 0, dispute: i % 3 ? '다툼' : '다툼없음' }));
  [400, 800, 1280].forEach(w => {
    const L = lay(fs, { scale: 'real', width: w });
    assert.deepStrictEqual(overlaps(L.cards), [], 'w=' + w);
    assert.deepStrictEqual(outside(L), [], 'w=' + w);
    assert.ok(L.tiers.up + L.tiers.down > 2, '단이 쌓여야 함');
  });
});

test('합성 60건/200건: real/even, 여러 폭에서 겹침 0, 밖으로 나감 0', () => {
  [60, 200].forEach(n => {
    const C = genSynth(n);
    ['real', 'even'].forEach(scale => [360, 400, 800, 1280, 2560, 6400, 40000].forEach(w => {
      const L = lay(C.facts, { scale, width: w, cardW: w < 560 ? 136 : 168 });
      const ov = overlaps(L.cards), out = outside(L);
      assert.deepStrictEqual(ov, [], n + '건 ' + scale + ' w=' + w + ' 겹침 ' + ov.length);
      assert.deepStrictEqual(out, [], n + '건 ' + scale + ' w=' + w + ' 밖 ' + out.length);
      assert.strictEqual(L.count, n);
    }));
  });
});

test('합성 60건 real: 1년 공백 압축, 밀집 구간이 넓게 배치', () => {
  const C = genSynth(60);
  const L = lay(C.facts, { scale: 'real', width: 1280 });
  // 2020. 9.~2021. 1. 공백은 연 단위(2021.) 사실의 흐린 구간이 2021. 1. 1.부터 차지하므로 압축 대상이 아니다
  assert.ok(L.breaks.length >= 1, 'breaks=' + L.breaks.length);
  assert.ok(L.breaks.some(b => b.months >= 11), '1년 가까운 공백: ' + L.breaks.map(b => b.label).join(','));
  // 밀집 구간(2021. 2.~3.) 폭이 압축 없는 경우보다 넓음
  const noBrk = lay(C.facts, { scale: 'real', width: 1280, gapDays: 1e6 });
  const w1 = L.scale.x(Date.UTC(2021, 3, 1)) - L.scale.x(Date.UTC(2021, 1, 1));
  const w0 = noBrk.scale.x(Date.UTC(2021, 3, 1)) - noBrk.scale.x(Date.UTC(2021, 1, 1));
  assert.ok(w1 > w0 * 1.2, 'w1=' + w1.toFixed(1) + ' w0=' + w0.toFixed(1));
});

test('카드는 기준점 근처: 줄기 끝이 카드 아래(위)변 안, 기준점과 카드 거리 제한', () => {
  const C = genSynth(60);
  const L = lay(C.facts, { scale: 'real', width: 1280 });
  L.cards.forEach(c => {
    const end = c.stem[c.stem.length - 1];
    assert.ok(end[0] >= c.x && end[0] <= c.x + c.w, c.key + ' 줄기 x');
    near(end[1], c.dir === 'up' ? c.y + c.h : c.y, 1e-6, c.key + ' 줄기 y');
    const dist = c.ax < c.x ? c.x - c.ax : (c.ax > c.x + c.w ? c.ax - c.x - c.w : 0);
    assert.ok(dist <= c.w * 0.9 + 1e-6, c.key + ' 거리 ' + dist);
  });
});

test('눈금 라벨끼리, 생략 라벨과 겹치지 않음', () => {
  const C = genSynth(60);
  ['real', 'even'].forEach(scale => [400, 1280, 8000].forEach(w => {
    const L = lay(C.facts, { scale, width: w });
    const boxes = L.ticks.map(t => [t.x - t.w / 2, t.x + t.w / 2]).concat(L.breaks.filter(b => b.row === 0).map(b => [b.lx - b.w / 2, b.lx + b.w / 2]));
    boxes.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i][0] >= boxes[i - 1][1], scale + ' w=' + w + ' 라벨 겹침');
    boxes.forEach(b => assert.ok(b[0] >= 0 && b[1] <= w, '라벨 범위'));
  }));
});

test('빈 입력: 카드 0, 높이 양수', () => {
  const L = lay([], { scale: 'real', width: 800 });
  assert.strictEqual(L.cards.length, 0); assert.ok(L.height > 0);
});

test('sample_min: 배치 결과 요약', () => {
  const C = require(path.join(R, 'data/sample_min.json'));
  const L = lay(C.facts, { scale: 'real', width: 1240 });
  assert.strictEqual(L.count, 7);
  assert.strictEqual(L.links.length, 1, 'F3 일자 불일치');
  assert.deepStrictEqual(overlaps(L.cards), []);
  const f6 = mark(L, 'F6')[0]; assert.ok(f6.range, 'F6 기간');
  assert.ok(mark(L, 'F2')[0].fuzzy && mark(L, 'F5')[0].fuzzy, 'approx');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
