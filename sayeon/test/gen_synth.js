/* 타임라인 시험용 합성 사건 생성기 (실제 사건 아님).
 * genSynth(n=60, seed=7) -> C (CONTRACT 3장 형태)
 * 기본 60건: 2020~2023, 2021. 2.~3. 두 달에 15건 밀집, 2021. 12.~2023. 1. 약 1년 공백, 2020. 9.~2021. 1. 공백.
 * 정밀도(day/approx/month/year/range), 양측 일자 불일치, 긴 표제, 근거 진술 없음, 자백후보, 미반복(toId:null, toDocId) 포함.
 * node: require('./gen_synth.js')(60) / 브라우저: window.genSynth(60)
 * CLI: node test/gen_synth.js 60 > /tmp/x.json */
(function (root) {
  'use strict';
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  var DAY = 86400000;
  function iso(t) { return new Date(t).toISOString().slice(0, 10); }
  function U(y, m, d) { return Date.UTC(y, m - 1, d); }

  function genSynth(n, seed) {
    n = n || 60;
    var r = rng(seed || 7);
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    function between(a, b) { return a + Math.floor(r() * ((b - a) / DAY + 1)) * DAY; }
    var segs = [
      { a: U(2020, 3, 1), b: U(2020, 8, 31), w: 10 },
      { a: U(2021, 2, 1), b: U(2021, 3, 31), w: 15 },   // 두 달 밀집
      { a: U(2021, 4, 10), b: U(2021, 11, 30), w: 15 },
      { a: U(2023, 1, 15), b: U(2023, 11, 30), w: 20 }  // 2021. 12. ~ 2023. 1. 공백
    ];
    var counts = segs.map(function (s) { return Math.round(n * s.w / 60); });
    counts[counts.length - 1] += n - counts.reduce(function (x, y) { return x + y; }, 0);
    var dates = [];
    segs.forEach(function (s, i) { for (var k = 0; k < counts[i]; k++) dates.push(between(s.a, s.b)); });
    dates.sort(function (a, b) { return a - b; });

    var docs = [
      { id: 'D1', kind: '소장', side: '원고', filedDate: '2024-01-10' },
      { id: 'D2', kind: '답변서', side: '피고', filedDate: '2024-03-05' },
      { id: 'D3', kind: '준비서면', side: '원고', filedDate: '2024-05-02' },
      { id: 'D4', kind: '준비서면', side: '피고', filedDate: '2024-07-01' },
      { id: 'D5', kind: '준비서면', side: '원고', filedDate: '2024-09-03' },
      { id: 'D6', kind: '준비서면', side: '피고', filedDate: '2024-11-05' }
    ];
    var pageTexts = {}, seq = {};
    docs.forEach(function (d) { pageTexts[d.id] = [[], [], [], []]; seq[d.id] = 0; d.submitter = d.side + ' 소송대리인'; d.fileName = d.id + '.pdf'; d.source = 'file'; });
    var issues = [
      { id: 'I0', name: '기초사실(합성)', elements: '계약, 대금' },
      { id: 'I1', name: '합성 쟁점 하나', elements: '요건 가' },
      { id: 'I2', name: '합성 쟁점 둘', elements: '요건 나' },
      { id: 'I3', name: '합성 쟁점 셋', elements: '요건 다' },
      { id: 'I4', name: '합성 쟁점 넷', elements: '요건 라' }
    ];
    var nouns = ['계약 체결', '계약금 지급', '잔금 기한 연장', '현장 방문', '설계 변경 요청', '인허가 신청', '보완 요구 통지', '내용증명 발송',
      '통화 내용', '공사 착수', '하자 통지', '대금 일부 지급', '합의서 작성', '현장 측량', '반려 통지', '중개인 설명'];
    var statements = [], changes = [], facts = [], cseq = 0;
    function addStmt(docId, side, fid, issueId, text, ev) {
      var d = docs.filter(function (x) { return x.id === docId; })[0];
      var page = 1 + Math.floor(r() * 4);
      var no = ++seq[docId];
      var id = 'S' + docId.slice(1) + '-' + ('00' + no).slice(-3);
      var quote = side + '은 합성 사실 ' + fid + '에 관하여 ' + text + '라고 기재합니다';
      pageTexts[docId][page - 1].push(quote + '.');
      statements.push({ id: id, docId: docId, page: page, item: no + '.', issueIds: [issueId], side: side,
        gist: '합성 사실 ' + fid + '에 관하여 ' + text + '이다', quote: quote, evidence: ev || [], factIds: [fid] });
      return id;
    }
    function ev(side) {
      var k = Math.floor(r() * 3), out = [], p = side === '원고' ? '갑' : '을';
      for (var i = 0; i < k; i++) out.push(p + (1 + Math.floor(r() * 25)) + (r() < 0.3 ? '-' + (1 + Math.floor(r() * 4)) : ''));
      return out;
    }
    dates.forEach(function (t, i) {
      var fid = 'F' + ('0' + (i + 1)).slice(-2);
      var noun = pick(nouns);
      var title = i % 7 === 3 ? noun + ' 관련 경위와 당사자 사이 의사 확인 및 후속 조치에 관한 긴 표제 시험 ' + (i + 1) : '합성 ' + noun + ' ' + (i + 1);
      var x = r(), prec = x < 0.62 ? 'day' : x < 0.76 ? 'approx' : x < 0.84 ? 'month' : x < 0.87 ? 'year' : 'range';
      if (prec === 'year' && i % 2) prec = 'month';
      var date = { start: iso(t), end: null, precision: prec, label: '' };
      if (prec === 'month') date.start = iso(t).slice(0, 7) + '-01';
      if (prec === 'year') date.start = iso(t).slice(0, 4) + '-01-01';
      if (prec === 'range') date.end = iso(t + (10 + Math.floor(r() * 110)) * DAY);
      var y = r(), disp = y < 0.3 ? '다툼없음' : y < 0.55 ? '일부다툼' : y < 0.8 ? '다툼' : '미확정';
      var issueId = pick(issues).id;
      var pStmts = [], dStmts = [], noStmt = i % 9 === 4;
      var hasP = disp !== '미확정' || r() < 0.7;
      var hasD = disp === '일부다툼' || disp === '다툼' || (disp === '다툼없음' && r() < 0.6) || (disp === '미확정' && !hasP);
      var pDoc = pick(['D1', 'D1', 'D3']), dDoc = pick(['D2', 'D2', 'D4']);
      var pev = ev('원고'), dev = ev('피고');
      if (hasP && !noStmt) pStmts.push(addStmt(pDoc, '원고', fid, issueId, noun + ' 사실이 있었다는 취지', pev));
      if (hasD && !noStmt) dStmts.push(addStmt(dDoc, '피고', fid, issueId, noun + ' 경위가 다르다는 취지', dev));
      var plaintiff = hasP ? { text: '원고 측 합성 서술: ' + noun, stmtIds: pStmts.slice(), evidence: pev } : null;
      var defendant = hasD ? { text: '피고 측 합성 서술: ' + noun, stmtIds: dStmts.slice(), evidence: dev } : null;
      if (plaintiff && defendant && (disp === '일부다툼' || disp === '다툼') && prec === 'day' && r() < 0.35) {
        plaintiff.date = { start: iso(t), precision: 'day' };
        defendant.date = { start: iso(t + (r() < 0.5 ? -1 : 1) * (5 + Math.floor(r() * 50)) * DAY), precision: 'day' };
      }
      // 변화 판정
      if (pStmts.length && r() < 0.45) {
        var later = addStmt(pDoc === 'D1' ? 'D3' : 'D5', '원고', fid, issueId, noun + ' 사실을 다시 정리한 취지', []);
        plaintiff.stmtIds.push(later);
        var ty = pick(['유지', '보충', '변경', '번복', '모순', '철회']);
        changes.push({ id: 'C' + (++cseq), issueId: issueId, scope: 'same', fromId: pStmts[0], toId: later, type: ty,
          basis: '합성 판정 근거: 앞 서면과 뒤 서면의 서술 비교', review: r() < 0.3 });
      } else if (pStmts.length && pDoc === 'D1' && r() < 0.35) {
        changes.push({ id: 'C' + (++cseq), issueId: issueId, scope: 'same', fromId: pStmts[0], toId: null, toDocId: 'D3', type: '미반복',
          basis: '합성 판정 근거: 이후 서면에서 이 주장을 다루지 않음', review: r() < 0.5 });
      }
      if (pStmts.length && dStmts.length && disp === '다툼없음') {
        changes.push({ id: 'C' + (++cseq), issueId: issueId, scope: 'cross', fromId: pStmts[0], toId: dStmts[0], type: '자백후보',
          basis: '합성 판정 근거: 피고 서면에 원고 주장 사실을 인정하는 취지의 기재가 있음', review: true });
      }
      facts.push({ id: fid, title: title, date: date, plaintiff: plaintiff, defendant: defendant, dispute: disp, issueIds: [issueId], note: '' });
    });
    docs.forEach(function (d) {
      d.pages = pageTexts[d.id].map(function (lines, k) { return { n: k + 1, text: lines.join(' ') || '(빈 쪽)', status: 'text' }; });
      d.pageCount = d.pages.length;
    });
    return {
      _dev: true, _note: '합성 데이터(실제 사건 아님). 타임라인 배치 시험용.',
      id: 'c_synth' + n, title: '합성 사건 ' + n + '건', caseNo: '2099가합00000', court: '○○지방법원', ourSide: '원고',
      parties: { '원고': '갑', '피고': '을' }, margins: { top: 45, bottom: 20, left: 30, right: 30 },
      docs: docs, issues: issues, statements: statements, changes: changes, facts: facts, updatedAt: '2099-01-01T00:00:00Z', schema: 1
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = genSynth;
  else root.genSynth = genSynth;
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    process.stdout.write(JSON.stringify(genSynth(+process.argv[2] || 60, +process.argv[3] || 7), null, 1));
  }
})(typeof window !== 'undefined' ? window : globalThis);
