/* A4 별지 시험용 합성 사건(사실 60건). 실제 사건이 아닌 가상 값이며 화면·배치 시험에만 쓴다.
   - 2020~2023, 2021. 3.~4. 두 달에 16건 몰림, 2020. 5.~10. 중순, 2022. 2.~9. 긴 공백
   - 다툼없음 / 일부다툼 / 다툼 / 미확정(원고만·피고만) 혼합, 양측 일자 불일치 6건, approx·range·month 정밀도 혼합
   - 원고 서술은 "원고측서술", 피고 서술은 "피고측서술"로 시작해 제출용 필터 누출 검사에 쓴다
   - 140자를 넘는 서술, 20자를 넘는 표제, 증거 6건짜리, 특수문자(&, <) 포함
   node: require('./gen_synth_a4.js')(seed, ourSide) / 브라우저: window.genSynthA4(seed, ourSide)
   CLI: node test/gen_synth_a4.js [seed] [원고|피고] > out.json */
(function (root) {
  'use strict';
  function rng(seed) {   // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var NOUN = ['계약서', '현장', '통화', '문자', '송금', '설계도', '견적서', '내용증명', '보완 요청', '회신', '측량', '인허가 서류', '공사비', '잔금', '중개사무소', '군청', '녹취', '합의서', '영수증', '사진'];
  var VERB = ['확인', '수령', '발송', '협의', '요청', '전달', '제출', '검토', '재설명', '이의 제기'];
  var TITLE = ['현장 방문', '계약서 작성', '잔금 협의', '보완 요청', '견적서 수령', '내용증명 발송', '측량 실시', '인허가 서류 제출', '공사비 통화', '합의서 초안', '중개사무소 면담', '군청 방문', '사진 촬영', '송금'];
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(ms) { var d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  var DAY = 86400000;

  function gen(seed, ourSide) {
    var r = rng(seed == null ? 20240607 : seed);
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    function between(a, b) { return a + Math.floor(r() * (b - a + 1)); }
    function sentence(min, max) {
      var s = '', target = between(min, max);
      while (s.length < target) s += (s ? ', ' : '') + pick(NOUN) + ' ' + pick(VERB);
      return s.length > max ? s.slice(0, max) : s;
    }
    // 일자 60개: 2020~2023 고르게 + 2021. 3.~4. 16건 몰림 + 2022. 2.~9. 비움
    var dates = [];
    var t0 = Date.UTC(2020, 0, 10), t1 = Date.UTC(2023, 11, 20);
    var cl0 = Date.UTC(2021, 2, 1), cl1 = Date.UTC(2021, 3, 30);
    var hole0 = Date.UTC(2022, 1, 1), hole1 = Date.UTC(2022, 8, 30);
    var hole2 = Date.UTC(2020, 4, 1), hole3 = Date.UTC(2020, 9, 15);
    for (var i = 0; i < 16; i++) dates.push(cl0 + Math.floor(r() * (cl1 - cl0) / DAY) * DAY);
    while (dates.length < 60) {
      var t = t0 + Math.floor(r() * (t1 - t0) / DAY) * DAY;
      if (t >= hole0 && t <= hole1) continue;
      if (t >= hole2 && t <= hole3) continue;
      if (t >= cl0 && t <= cl1) continue;
      dates.push(t);
    }
    dates.sort(function (a, b) { return a - b; });
    var disputes = [];
    for (i = 0; i < 18; i++) disputes.push('다툼없음');
    for (i = 0; i < 14; i++) disputes.push('일부다툼');
    for (i = 0; i < 14; i++) disputes.push('다툼');
    for (i = 0; i < 14; i++) disputes.push(i % 2 ? '미확정P' : '미확정D');
    for (i = disputes.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), tmp = disputes[i]; disputes[i] = disputes[j]; disputes[j] = tmp; }
    var gN = 1, eN = 1, mismatchLeft = 6;
    var facts = dates.map(function (ms, idx) {
      var id = 'F' + pad(idx + 1);
      var dsp = disputes[idx];
      var prec = 'day', end = null, roll = r();
      if (roll < 0.13) prec = 'approx';
      else if (roll < 0.21) { prec = 'range'; end = iso(ms + between(10, 60) * DAY); }
      else if (roll < 0.27) prec = 'month';
      var start = iso(ms);
      if (prec === 'month') start = start.slice(0, 7) + '-01';
      var date = { start: start, end: end, precision: prec, label: '' };
      var title = pick(TITLE) + (r() < 0.5 ? ' ' + pick(['및 확인', '경위', '관련 연락', '후 재협의', '요청 회신']) : '');
      if (idx % 11 === 5) title = '현장 방문 후 인허가 서류 보완 요청과 견적서 재수령 경위';   // 20자 초과
      if (idx === 7) title = '자재 단가표 <갑> & 견적';                                         // 특수문자
      function evs(prefix, n) { var a = []; for (var k = 0; k < n; k++) a.push(prefix + (prefix === '갑' ? gN++ : eN++) + (r() < 0.2 ? '-' + between(1, 3) : '')); return a; }
      var pText = '원고측서술 ' + id + ': ' + sentence(idx % 9 === 2 ? 150 : 18, idx % 9 === 2 ? 190 : 110);
      var dText = '피고측서술 ' + id + ': ' + sentence(idx % 10 === 4 ? 150 : 18, idx % 10 === 4 ? 180 : 100);
      if (idx === 7) dText = '피고측서술 ' + id + ': 단가표 A&B <원본> 은 사본과 다르다';
      var pl = { text: pText, stmtIds: [], evidence: evs('갑', idx % 13 === 3 ? 6 : between(0, 2)) };
      var df = { text: dText, stmtIds: [], evidence: evs('을', between(0, 2)) };
      var f = { id: id, title: title, date: date, plaintiff: null, defendant: null, dispute: '', issueIds: ['I' + between(1, 5)], note: '' };
      if (dsp === '다툼없음') { f.dispute = '다툼없음'; f.plaintiff = pl; f.defendant = df; }
      else if (dsp === '미확정P') { f.dispute = '미확정'; f.plaintiff = pl; }
      else if (dsp === '미확정D') { f.dispute = '미확정'; f.defendant = df; }
      else {
        f.dispute = dsp; f.plaintiff = pl; f.defendant = df;
        if (mismatchLeft > 0 && prec === 'day' && r() < 0.45) {
          mismatchLeft--;
          var shift = (mismatchLeft % 2 === 0 ? -1 : 1) * (mismatchLeft < 3 ? between(40, 120) : between(3, 20));
          pl.date = { start: start, precision: 'day' };
          df.date = { start: iso(ms + shift * DAY), precision: 'day' };
          f.note = '양측 일자 불일치(합성)';
        }
      }
      return f;
    });
    return {
      _dev: true,
      _note: '합성 시험 데이터(A4 별지용). 실제 사건이 아니다.',
      id: 'c_synth_a4', title: '합성 사건 60건', caseNo: '2099가합00060', court: '○○지방법원',
      ourSide: ourSide === '피고' ? '피고' : '원고',
      parties: { '원고': '갑', '피고': '을' },
      docs: [], statements: [], changes: [],
      issues: [1, 2, 3, 4, 5].map(function (n) { return { id: 'I' + n, name: '쟁점 ' + n, elements: '' }; }),
      facts: facts, updatedAt: '2099-01-01T00:00:00Z', schema: 1
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = gen;
    if (require.main === module) {
      var a = process.argv.slice(2);
      process.stdout.write(JSON.stringify(gen(a[0] ? Number(a[0]) : undefined, a[1]), null, 1));
    }
  } else root.genSynthA4 = gen;
})(typeof window !== 'undefined' ? window : globalThis);
