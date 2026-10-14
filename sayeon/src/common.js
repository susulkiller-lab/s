/* 사건 연표 - 공용 유틸리티 (SY). 모든 모듈이 이 파일에 의존한다. 수정 금지: 필요하면 기획자(메인 세션)에게 요청. */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};

  /* ---------- 상수 ---------- */
  SY.SIDES = ['원고', '피고'];
  // 변화 판정 유형 (정의는 CONTRACT.md 3.5 참조)
  SY.REL = {
    types: ['유지', '보충', '변경', '번복', '철회', '모순', '자백후보', '미반복'],
    // 화면 표시 강도: 0 중립, 1 주의, 2 경고, 3 핵심(반박 재료 후보)
    level: { '유지': 0, '보충': 0, '미반복': 1, '변경': 1, '철회': 2, '번복': 3, '모순': 3, '자백후보': 3 },
    // 흑백 출력/색맹 대응용 기호 (색에만 의존하지 않는다)
    glyph: { '유지': '＝', '보충': '＋', '변경': '△', '번복': '⇄', '철회': '×', '모순': '≠', '자백후보': '◎', '미반복': '…' },
    css: { '유지': 'keep', '보충': 'add', '변경': 'chg', '번복': 'rev', '철회': 'wd', '모순': 'con', '자백후보': 'adm', '미반복': 'omit' }
  };
  SY.DISPUTE = ['다툼없음', '일부다툼', '다툼', '미확정'];
  SY.PRECISION = ['day', 'month', 'year', 'approx', 'range'];

  /* ---------- 문자열 ---------- */
  SY.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  SY.uid = function (prefix) {
    return (prefix || 'x') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  };
  var CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿';
  SY.circled = function (n) { return n >= 1 && n <= 50 ? CIRC.charAt(n - 1) : '(' + n + ')'; };

  /* 원문 인용 대조용 정규화: 공백, 따옴표 변형, 말줄임, 괄호 종류 차이를 지운다. */
  SY.norm = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFC')
      .replace(/[‘’‚‛′'`]/g, "'")
      .replace(/[“”„‟″"]/g, '"')
      .replace(/[·•‧・]/g, '.')
      .replace(/[\s ​　]+/g, '')
      .replace(/[“”‘’"'`]/g, '')
      .toLowerCase();
  };
  /* 인용이 원문 쪽 텍스트 안에 그대로 있는지. pageTexts: {n: text}. 쪽 경계 걸침은 인접 쪽 합본으로 재시도. */
  SY.verifyQuote = function (quote, pageTexts, page) {
    var q = SY.norm(quote);
    if (q.length < 4) return { ok: false, reason: 'too_short' };
    var n = Number(page), t = pageTexts[n] != null ? SY.norm(pageTexts[n]) : null;
    if (t != null && t.indexOf(q) >= 0) return { ok: true, page: n };
    var keys = Object.keys(pageTexts).map(Number).sort(function (a, b) { return a - b; });
    var i, k, a;
    for (i = 0; i < keys.length; i++) {            // 1차: 한 쪽 안에서 찾기(다음 쪽 단독 일치가 쪽 걸침으로 오판되지 않게)
      k = keys[i]; a = SY.norm(pageTexts[k]);
      if (a.indexOf(q) >= 0) return { ok: true, page: k, moved: k !== n };
    }
    for (i = 0; i < keys.length; i++) {            // 2차: 인접 두 쪽에 걸친 인용
      k = keys[i];
      if (pageTexts[k + 1] != null && (SY.norm(pageTexts[k]) + SY.norm(pageTexts[k + 1])).indexOf(q) >= 0)
        return { ok: true, page: k, spans: true, moved: k !== n };
    }
    return { ok: false, reason: 'not_found' };
  };
  /* 주민등록번호 등 민감정보 가림 (송신·저장 전에 선택 적용) */
  SY.maskSensitive = function (s) {
    return String(s == null ? '' : s)
      .replace(/(\d{6})\s*-\s*[1-4]\d{6}/g, '$1-*******')
      .replace(/(\d{2,3})-(\d{3,4})-(\d{4})(?!\d)/g, function (m, a, b, c) { return a + '-' + b + '-' + '****'; });
  };

  /* ---------- 날짜 ---------- */
  var DAY = 86400000;
  SY.date = {
    parseISO: function (iso) {
      if (!iso) return null;
      var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(iso));
      if (!m) return null;
      return Date.UTC(+m[1], (m[2] ? +m[2] : 1) - 1, m[3] ? +m[3] : 1);
    },
    /* '2022. 10. 3.' / '2022. 10.경' / '2022.' 형태 */
    fmtKo: function (iso, precision) {
      var m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(String(iso || ''));
      if (!m) return '';
      var y = +m[1], mo = m[2] ? +m[2] : 0, d = m[3] ? +m[3] : 0;
      if (precision === 'year' || (!mo)) return y + '.';
      if (precision === 'month' || (!d)) return y + '. ' + mo + '.';
      return y + '. ' + mo + '. ' + d + '.';
    },
    /* date 객체 {start,end,precision,label} -> 표시 문자열. label 이 있으면 label 우선. */
    label: function (d) {
      if (!d) return '';
      if (d.label) return d.label;
      var p = d.precision || 'day';
      if (p === 'range' && d.end) return SY.date.fmtKo(d.start, 'day') + ' ~ ' + SY.date.fmtKo(d.end, 'day');
      var s = SY.date.fmtKo(d.start, p === 'approx' ? 'day' : p);
      return p === 'approx' ? s.replace(/\.$/, '') + '.경' : s;
    },
    /* 시간선 위의 [시작, 끝] (ms). 점은 시작=끝. approx 는 흐린 구간 +-pad 일을 별도 반환. */
    span: function (d) {
      var s = SY.date.parseISO(d && d.start);
      if (s == null) return null;
      var e = SY.date.parseISO(d.end);
      var p = d.precision || 'day';
      if (p === 'month' && e == null) { var dt = new Date(s); e = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0); }
      if (p === 'year' && e == null) { var dy = new Date(s); e = Date.UTC(dy.getUTCFullYear(), 11, 31); }
      return { start: s, end: e == null ? s : e, precision: p, fuzzy: p === 'approx' || p === 'month' || p === 'year' };
    },
    days: function (a, b) { return Math.round((b - a) / DAY); },
    DAY: DAY
  };

  /* ---------- 사건 데이터 도우미 ---------- */
  /* 서면을 제출일 순으로. 같은 날이면 id 순. */
  SY.docsInOrder = function (C) {
    return (C.docs || []).slice().sort(function (a, b) {
      return String(a.filedDate).localeCompare(String(b.filedDate)) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
    });
  };
  SY.byId = function (arr) { var m = {}; (arr || []).forEach(function (x) { m[x.id] = x; }); return m; };
  /* 서면 약칭: '2023. 6. 7.자 답변서' */
  SY.docName = function (doc) {
    return SY.date.fmtKo(doc.filedDate, 'day') + '자 ' + doc.kind;
  };
  /* 사건 전체 날짜 범위 (ms) */
  SY.factRange = function (C) {
    var lo = Infinity, hi = -Infinity;
    (C.facts || []).forEach(function (f) {
      [f.date, f.plaintiff && f.plaintiff.date, f.defendant && f.defendant.date].forEach(function (d) {
        var s = SY.date.span(d); if (!s) return;
        lo = Math.min(lo, s.start); hi = Math.max(hi, s.end);
      });
    });
    return isFinite(lo) ? { start: lo, end: hi } : null;
  };

  /* ---------- 증거번호, 문형 ---------- */
  /* '갑 제13호증' -> '갑13', '을 제3호증의 1' -> '을3-1', '갑 제10호증의 1' -> '갑10-1', '을3-6' -> '을3-6'. 못 알아보면 null. */
  SY.normEvidence = function (s) {
    var t = String(s == null ? '' : s).replace(/\s+/g, '');
    var m = /^(갑|을|병|정)제?(\d+)호?증?(?:의(\d+))?(?:[-](\d+))?$/.exec(t);
    if (!m) return null;
    var sub = m[3] || m[4];
    return m[1] + m[2] + (sub ? '-' + sub : '');
  };
  /* 호증 표시 변환: '갑13' -> '갑 제13호증', '을3-1' -> '을 제3호증의 1' */
  SY.fmtEvidence = function (e) {
    var m = /^(갑|을|병|정)(\d+)(?:-(\d+))?$/.exec(e || '');
    if (!m) return e || '';
    return m[1] + ' 제' + m[2] + '호증' + (m[3] ? '의 ' + m[3] : '');
  };
  /* 평서형 요지('...다')를 인용 조사와 이어 붙인다: '미급수지역이다' -> '미급수지역이라고', '없다' -> '없다고' */
  SY.quotative = function (gist) {
    var g = String(gist || '').trim().replace(/[.。]+$/, '');
    if (/이다$/.test(g)) return g.replace(/이다$/, '이라고');
    if (/다$/.test(g)) return g + '고';
    return g + '라고';
  };

  /* ---------- SVG 문자열 빌더 (A4 출력용) ---------- */
  SY.svg = {
    attr: function (o) {
      var s = '';
      for (var k in o) if (o[k] != null && o[k] !== false) s += ' ' + k + '="' + SY.esc(o[k]) + '"';
      return s;
    },
    el: function (name, attrs, inner) {
      return '<' + name + SY.svg.attr(attrs || {}) + (inner == null ? '/>' : '>' + inner + '</' + name + '>');
    },
    text: function (x, y, str, attrs) {
      var a = Object.assign({ x: x, y: y }, attrs || {});
      return SY.svg.el('text', a, SY.esc(str));
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
