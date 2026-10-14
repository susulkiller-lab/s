/* 변천 지도 시험용 합성 사건 생성기. 실제 사건이 아닌 가상 값(_dev:true)이다.
   기본: 쟁점 9 x 서면 6, 진술 80건, 판정 40건 (seed 고정이라 매번 같은 결과).
   사용
     node test/gen_synth_map.js                 # 요약 출력
     node test/gen_synth_map.js --json [옵션]    # 사건 JSON 을 표준 출력으로 (옵션: --issues 15 --docs 12 --statements 360 --changes 180 --seed 7)
     require('./gen_synth_map.js').gen({ issues: 15, docs: 12, statements: 360, changes: 180 })
   브라우저에서는 window.SYSynth.gen(...) 로 쓴다.
   포함하는 경우: 미분류 진술(issueIds 빈 배열), 쟁점 2개에 걸친 진술, 같은 제출일 서면(동률), C.docs 배열 순서 뒤섞임,
   진술 없는 서면 1건(서면 7건 이상일 때), toId 없는 미반복, 같은 서면 안의 모순, '이다'로 끝나는 요지. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SYSynth = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var TOPICS = [
    ['기초사실 (계약 체결, 계약금 수수)', '계약 체결일, 대금, 계약금'],
    ['특약 해제조건 성취 여부 (건축 인·허가)', '특약 문언, 건축신고 경위, 반려 통지'],
    ['상수도 인입 공사비', '미급수지역 여부, 공사비 규모'],
    ['기망 취소', '과거 계약 해제 사유, 고지 여부'],
    ['착오 취소', '동기의 표시, 중요 부분, 중과실'],
    ['건축 가능 설명 여부', '홍보글, 현장 설명'],
    ['건축허가 불발의 책임 소재', '보완 요청과 이행'],
    ['비용 분담 합의', '지원금, 소외인 부담'],
    ['잔금 기한과 손해배상', '기한 연장 경위, 내용증명'],
    ['군청 방문과 녹취록', '동석자, 공무원 발언'],
    ['중개인의 설명의무', '중개대상물 확인설명서'],
    ['계약금 반환 범위', '원상회복, 이자'],
    ['지연손해금 기산일', '해제 통지 도달일'],
    ['토지 경계와 면적', '측량 결과, 지적도'],
    ['농지 전용 허가', '전용 가능 면적, 부담금'],
    ['소송비용 부담', '청구 인용 범위'],
    ['반소 청구의 당부', '위약금 약정'],
    ['증거의 신빙성', '녹취 경위, 작성자']
  ];
  /* [요지(평서형, ~다), 원문 인용] — 가상 문장 */
  var TPL = [
    ['계약 체결 당시 매매대금은 {a}억 원이다', '계약 체결 당시 매매대금은 {a}억 원입니다'],
    ['잔금 지급 기한은 {m}월 말일이다', '잔금 지급 기한은 {m}월 말일입니다'],
    ['피고는 현장 설명회에서 건축이 가능하다고 설명하였다', '피고는 현장 설명회에서 건축이 가능하다고 설명하였습니다'],
    ['원고는 보완 요청을 받은 뒤 {n}일 안에 서류를 제출하였다', '원고는 보완 요청을 받은 뒤 {n}일 안에 서류를 제출하였습니다'],
    ['해당 토지는 상수도 미급수지역이다', '해당 토지는 상수도 미급수지역입니다'],
    ['인입 공사비는 약 {n}천만 원이 소요된다', '인입 공사비는 약 {n}천만 원이 소요됩니다'],
    ['중개인은 계약 조건을 따로 설명하지 않았다', '중개인은 계약 조건을 따로 설명하지 않았습니다'],
    ['군청 방문에는 양측이 함께 참석하였다', '군청 방문에는 양측이 함께 참석하였습니다'],
    ['특약 조항의 해제조건은 성취되지 않았다', '특약 조항의 해제조건은 성취되지 않았습니다'],
    ['피고는 과거 계약 해제 사실을 알리지 않았다', '피고는 과거 계약 해제 사실을 알리지 않았습니다'],
    ['원고는 계약 당시 건축 목적을 분명히 밝혔다', '원고는 계약 당시 건축 목적을 분명히 밝혔습니다'],
    ['비용 분담 합의는 소외인과 사이에서만 이루어졌다', '비용 분담 합의는 소외인과 사이에서만 이루어졌습니다'],
    ['통화 녹음에는 공사비 초과를 인정하는 발언이 있다', '통화 녹음에는 공사비 초과를 인정하는 발언이 있습니다'],
    ['반려 통지는 {m}월 중순에 도달하였다', '반려 통지는 {m}월 중순에 도달하였습니다'],
    ['계약금은 이미 전액 지급되었다', '계약금은 이미 전액 지급되었습니다'],
    ['피고의 손해는 계약 해제와 무관하다', '피고의 손해는 계약 해제와 무관합니다'],
    ['이 사건 특약은 예문에 불과하다', '이 사건 특약은 예문에 불과합니다'],
    ['원고의 착오는 중대한 과실에 의한 것이다', '원고의 착오는 중대한 과실에 의한 것입니다'],
    ['보완 서류 목록은 문자로 전달되었다', '보완 서류 목록은 문자로 전달되었습니다'],
    ['피고는 인허가 진행 상황을 수시로 확인하였다', '피고는 인허가 진행 상황을 수시로 확인하였습니다'],
    ['녹취록의 발언자는 담당 공무원이 아니다', '녹취록의 발언자는 담당 공무원이 아닙니다'],
    ['내용증명은 기한 경과 후 발송되었다', '내용증명은 기한 경과 후 발송되었습니다'],
    ['원고가 먼저 계약 해제를 통보하였다', '원고가 먼저 계약 해제를 통보하였습니다'],
    ['토지 일부는 농지 전용 허가가 필요한 상태이다', '토지 일부는 농지 전용 허가가 필요한 상태입니다'],
    ['측량 결과 실제 면적은 계약 면적보다 {n}평 적다', '측량 결과 실제 면적은 계약 면적보다 {n}평 적습니다'],
    ['위약금 약정은 손해배상액의 예정이다', '위약금 약정은 손해배상액의 예정입니다']
  ];
  var DAY = 86400000;
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }

  function gen(opt) {
    var o = Object.assign({ issues: 9, docs: 6, statements: 80, changes: 40, seed: 20261004 }, opt || {});
    var rnd = mulberry32(o.seed);
    function ri(n) { return Math.floor(rnd() * n); }
    function pick(a) { return a[ri(a.length)]; }

    var issues = [];
    for (var i = 0; i < o.issues; i++) {
      var tp = TOPICS[i % TOPICS.length];
      issues.push({ id: 'I' + i, name: tp[0] + (i >= TOPICS.length ? ' ' + (Math.floor(i / TOPICS.length) + 1) : ''), elements: tp[1] });
    }
    var docs = [], t0 = Date.UTC(2099, 2, 2);
    for (var d = 0; d < o.docs; d++) {
      var side = d % 2 === 0 ? '원고' : '피고';
      var kind = d === 0 ? '소장' : d === 1 ? '답변서' : '준비서면';
      var date = t0 + d * 41 * DAY;
      if (o.docs >= 4 && d === o.docs - 1) date = t0 + (d - 1) * 41 * DAY;   // 마지막 두 서면은 같은 제출일(동률)
      docs.push({
        id: 'D' + (d + 1), kind: kind, side: side,
        submitter: side === '원고' ? '원고 소송대리인 법무법인 가상' : '피고 소송대리인 변호사 가상',
        filedDate: iso(date), authoredDate: null, fileName: 'D' + (d + 1) + '_' + kind + '.pdf', source: 'file',
        pageCount: 2 + ri(5), pages: []
      });
    }
    var emptyDoc = o.docs >= 7 ? docs[3].id : null;   // 진술 없는 서면 1건
    var usable = docs.filter(function (x) { return x.id !== emptyDoc; });

    var stmts = [], byPage = {};
    for (var s = 0; s < o.statements; s++) {
      var dc = usable[s < usable.length ? s : ri(usable.length)];
      var tpl = pick(TPL), a = 1 + ri(9), m = 1 + ri(12), n = 2 + ri(28);
      var fill = function (x) { return x.replace('{a}', a).replace('{m}', m).replace('{n}', n); };
      var issueIds;
      var r = rnd();
      if (r < 0.06) issueIds = [];
      else if (r < 0.12 && o.issues > 1) { var i1 = ri(o.issues), i2 = (i1 + 1 + ri(o.issues - 1)) % o.issues; issueIds = ['I' + i1, 'I' + i2]; }
      else issueIds = ['I' + ri(o.issues)];
      var page = 1 + ri(dc.pageCount);
      var st = {
        id: 'S' + String(s + 1).padStart(3, '0'), docId: dc.id, page: page, item: (1 + ri(5)) + '.' + '가나다라'.charAt(ri(4)) + '.',
        issueIds: issueIds, side: dc.side, gist: fill(tpl[0]), quote: fill(tpl[1]),
        evidence: rnd() < 0.4 ? [(dc.side === '원고' ? '갑' : '을') + (1 + ri(15)) + (rnd() < 0.3 ? '-' + (1 + ri(3)) : '')] : [],
        factIds: []
      };
      stmts.push(st);
      var pk = dc.id + ':' + page;
      (byPage[pk] = byPage[pk] || []).push(st.quote);
    }
    docs.forEach(function (dc) {
      for (var p = 1; p <= dc.pageCount; p++) {
        var qs = byPage[dc.id + ':' + p] || [];
        dc.pages.push({ n: p, text: '(가상 서면 ' + dc.id + ' 제' + p + '쪽) ' + qs.join(' 또한 ') + (qs.length ? ' ' : '') + '이상은 시험용 가상 문장입니다.', status: 'text' });
      }
    });

    var order = {}; docs.forEach(function (x, k) { order[x.id] = k; });
    function shares(a, b) { return a.issueIds.filter(function (x) { return b.issueIds.indexOf(x) >= 0; })[0] || null; }
    var same = [], cross = [], sameDoc = [];
    stmts.forEach(function (a) {
      stmts.forEach(function (b) {
        if (a === b) return;
        var iss = shares(a, b);
        if (!iss) return;
        if (a.side === b.side && order[a.docId] < order[b.docId]) same.push([a, b, iss]);
        if (a.side === b.side && a.docId === b.docId && a.id < b.id) sameDoc.push([a, b, iss]);
        if (a.side !== b.side && order[a.docId] < order[b.docId]) cross.push([a, b, iss]);
      });
    });
    var plan = { '유지': 5, '보충': 6, '변경': 7, '번복': 5, '철회': 3, '모순': 4, '미반복': 4, '자백후보': 6 };
    var total = 0; Object.keys(plan).forEach(function (k) { total += plan[k]; });
    var scale = o.changes / total, want = {}, sum = 0;
    Object.keys(plan).forEach(function (k) { want[k] = Math.floor(plan[k] * scale); sum += want[k]; });
    var ks = Object.keys(plan), z = 0;
    while (sum < o.changes) { want[ks[z % ks.length]]++; sum++; z++; }

    var changes = [], used = {};
    function takePair(list) {
      for (var tries = 0; tries < 400 && list.length; tries++) {
        var p = list[ri(list.length)], k = p[0].id + '>' + p[1].id;
        if (!used[k]) { used[k] = 1; return p; }
      }
      return null;
    }
    var cid = 0;
    function push(type, scope, from, to, iss, review, toDocId) {
      cid++;
      var fd = from.docId, td = to ? to.docId : toDocId;
      var ch = {
        id: 'C' + String(cid).padStart(3, '0'), issueId: iss, scope: scope, fromId: from.id, toId: to ? to.id : null, type: type,
        basis: '가상 근거: ' + fd + ' 제' + from.page + '쪽' + (to ? '과 ' + td + ' 제' + to.page + '쪽의 서술을 대조함' : ' 이후 ' + td + '에서 해당 쟁점 서술이 없음'),
        review: review
      };
      if (!to) ch.toDocId = toDocId;
      changes.push(ch);
    }
    ks.forEach(function (type) {
      for (var c = 0; c < want[type]; c++) {
        var review = type === '자백후보' ? true : rnd() < 0.35;
        if (type === '자백후보') {
          var pc = takePair(cross); if (pc) push(type, 'cross', pc[0], pc[1], pc[2], true);
        } else if (type === '미반복') {
          // 설계서 3.5: toId:null, toDocId = 앞 주장을 다루지 않은 이후 같은 편 서면
          var f = null, later = [];
          for (var tr = 0; tr < 200 && !f; tr++) {
            var cand = stmts[ri(stmts.length)];
            if (!cand.issueIds.length || used[cand.id + '>omit']) continue;
            later = docs.filter(function (x) {
              return x.side === cand.side && order[x.id] > order[cand.docId] && x.id !== emptyDoc;
            });
            if (later.length) f = cand;
          }
          if (f) { used[f.id + '>omit'] = 1; push(type, 'same', f, null, f.issueIds[0], review, later[0].id); }
        } else if (type === '모순' && c === 0 && sameDoc.length) {
          var pd = takePair(sameDoc); if (pd) push(type, 'same', pd[0], pd[1], pd[2], review);
        } else {
          var ps = takePair(same); if (ps) push(type, 'same', ps[0], ps[1], ps[2], review);
        }
      }
    });
    // C.docs 배열은 일부러 뒤섞는다(docsInOrder 가 제출일·id 순으로 정렬해야 함)
    var shuffled = docs.slice();
    for (var q = shuffled.length - 1; q > 0; q--) { var w = ri(q + 1), tmp = shuffled[q]; shuffled[q] = shuffled[w]; shuffled[w] = tmp; }
    return {
      _dev: true,
      _note: '합성 데이터(변천 지도 시험용). 실제 사건이 아니며 모든 문장은 가상이다.',
      id: 'c_synth_' + o.issues + 'x' + o.docs, title: '합성 사건 ' + o.issues + 'x' + o.docs, caseNo: '2099가합99999', court: '○○지방법원',
      ourSide: '원고', parties: { '원고': '갑', '피고': '을' }, margins: { top: 45, bottom: 20, left: 30, right: 30 },
      docs: shuffled, issues: issues, statements: stmts, changes: changes, facts: [], updatedAt: '2099-12-31T00:00:00.000Z', schema: 1
    };
  }
  return { gen: gen, TPL: TPL };
});

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  var argv = process.argv.slice(2), opt = {};
  for (var i = 0; i < argv.length; i++) {
    var mm = /^--(issues|docs|statements|changes|seed)$/.exec(argv[i]);
    if (mm) opt[mm[1]] = Number(argv[++i]);
  }
  var C = module.exports.gen(opt);
  if (argv.indexOf('--json') >= 0) process.stdout.write(JSON.stringify(C, null, 1) + '\n');
  else {
    var cnt = {}; C.changes.forEach(function (c) { cnt[c.type] = (cnt[c.type] || 0) + 1; });
    console.log('쟁점 ' + C.issues.length + ', 서면 ' + C.docs.length + ', 진술 ' + C.statements.length + ', 판정 ' + C.changes.length, JSON.stringify(cnt));
  }
}
