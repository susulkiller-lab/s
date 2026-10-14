/* 사건 연표 - 껍데기(SY.App). 설계서 6.
 * 헤더(사건 선택, 새 사건), 탭(자료, 쟁점, 진술, 연표, 변천 지도, A4 별지), 빈 상태, 쟁점 편집, 분석 실행(단계별 확인),
 * 진술 검수, 각 모듈 마운트, 파일 저장(downloads). 다른 모듈(SY.Ingest, SY.Pipeline, SY.Viz)은 사용 시점에 확인한다.
 * 능력은 load 시 claude.use() 로 있는지만 확인하고, 실제 호출(sample, downloads, assets, mcp)은 사용자 클릭 뒤에만 한다. */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};
  if (typeof root.document === 'undefined') return;
  var D = root.document;

  var TABS = [
    { key: 'docs', label: '자료' }, { key: 'issues', label: '쟁점' }, { key: 'stmts', label: '진술' },
    { key: 'timeline', label: '연표' }, { key: 'map', label: '변천 지도' }, { key: 'a4', label: 'A4 별지' }
  ];
  var STAGES = [
    { key: 'docs', label: '서면 확인' }, { key: 'issues', label: '쟁점 확정' }, { key: 'extract', label: '진술 추출' },
    { key: 'review', label: '검수' }, { key: 'judge', label: '변화 판정' }, { key: 'facts', label: '사실 구성' },
    { key: 'viz', label: '시각화' }
  ];
  var RUN_ORDER = ['transcribe', 'extract', 'judge', 'facts'];
  var RUN_LABEL = { transcribe: '스캔본 옮겨 적기', extract: '진술 추출', judge: '변화 판정', facts: '사실 구성' };
  var LS = { last: 'sayeon.lastCase', ack: 'sayeon.privacyAck.v1', rules: 'sayeon.shell.ingestRules.v1', a4: 'sayeon.a4prefs.v1', tab: 'sayeon.tab' };
  var DEF_MARGINS = { top: 45, bottom: 20, left: 30, right: 30 };
  var REJECT_REASON = { not_found: '원문에서 찾지 못함', too_short: '인용이 너무 짧음' };
  var SAMPLE_ERR = {
    cancelled: '중지했습니다. 끝난 서면까지의 결과는 저장되었습니다.',
    rate_limited: 'Claude 사용 한도나 호출 빈도 제한에 걸렸습니다. 잠시 뒤 다시 실행해 주십시오.',
    not_granted: 'Claude 사용이 허용되지 않았습니다. 이 화면에서는 분석을 쓸 수 없습니다.',
    sampling_disabled: '이 계정 또는 조직에서는 Claude 분석을 쓸 수 없습니다.',
    not_declared: '이 아티팩트에서는 Claude 분석을 쓸 수 없습니다.',
    capability_disabled: '이 화면에서는 Claude 분석을 쓸 수 없습니다.',
    capability_removed: '이 화면에서는 Claude 분석을 쓸 수 없습니다.',
    prompt_too_large: '서면이 너무 길어 한 번에 보낼 수 없습니다. 서면을 나눠 올려 주십시오.',
    images_unavailable: '이 화면에서는 이미지를 Claude 로 보낼 수 없어 스캔본을 옮겨 적을 수 없습니다. 텍스트 층이 있는 PDF 로 다시 올려 주십시오.',
    image_rejected: '스캔본 그림이 거부되었습니다(형식 또는 크기). 다른 파일로 다시 올려 주십시오.',
    session_expired: '로그인이 만료되었습니다. 다시 로그인한 뒤 실행해 주십시오.',
    refused: 'Claude 가 이 요청을 처리하지 않았습니다. 내용을 나눠 다시 시도해 주십시오.',
    empty_completion: 'Claude 가 빈 응답을 보냈습니다. 다시 실행해 주십시오.',
    invalid_json: 'Claude 응답을 해석하지 못했습니다. 다시 실행해 주십시오.',
    upstream_error: '일시적인 연결 문제로 멈췄습니다. 다시 실행해 주십시오.',
    read_only: '읽기 전용이라 분석 결과를 저장할 수 없어 멈췄습니다.'
  };
  var SAMPLE_GONE = { not_granted: 1, sampling_disabled: 1, not_declared: 1, capability_disabled: 1, capability_removed: 1 };

  /* ---------------- 상태 ---------------- */
  var A = {
    started: false, ready: false, C: null, cases: [], tab: 'docs', st: null,
    caps: { sample: undefined, downloads: undefined, mcp: undefined, assets: undefined }, capsReady: false, sampleDenied: false,
    panels: {}, rev: 0,
    ingestHost: null, ingestCtrl: null, ingestCaseId: null, tlCtrl: null, fdCtrl: null, fdEl: null, sideEl: null, mapCtrl: null,
    save: { timer: 0, dirty: false },
    run: null, issueRun: null, docRuns: {}, lastRunMsg: null,
    runEl: null, stmtListEl: null, stmtUl: null, docListEl: null, issueStatusEl: null, a4View: null, a4res: null,
    ack: false, ui: null
  };
  var readyResolve;
  var readyP = new Promise(function (r) { readyResolve = r; });

  function freshUi() {
    var pref = {};
    try { pref = JSON.parse(lsGet(LS.a4) || '{}') || {}; } catch (e) { pref = {}; }
    return {
      stmt: { doc: '', issue: '', q: '', shown: 100 },
      runSel: {},
      mapSel: [],
      tl: { scale: 'real', issueId: '', from: null, to: null, selectedId: null },
      a4: {
        layout: pref.layout === 'Z' ? 'Z' : 'S', mode: 'submit', page: 0, scope: 'current',
        target: pref.target === 'figure' ? 'figure' : 'sheet', issueId: '', from: '', to: '',
        showEvidence: pref.showEvidence !== false, fontScale: Number(pref.fontScale) > 0 ? Number(pref.fontScale) : 1
      }
    };
  }
  A.ui = freshUi();

  /* ---------------- 작은 도우미 ---------------- */
  function $(sel) { return D.querySelector(sel); }
  function h(tag, attrs) {
    var el = D.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'readOnly') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c.nodeType ? c : D.createTextNode(String(c)));
  }
  function btn(label, fn, cls, attrs) {
    return h('button', Object.assign({ type: 'button', class: 'sy-btn' + (cls ? ' ' + cls : ''), onclick: fn }, attrs || {}), label);
  }
  function note(tone, content) { return h('div', { class: 'sy-note' + (tone ? ' ' + tone : ''), role: tone === 'flag' ? 'alert' : null }, content); }
  function field(label, input, hint) {
    return h('label', { class: 'sy-field' }, h('span', null, label), input, hint ? h('small', { class: 'sy-muted' }, hint) : null);
  }
  function selectEl(options, value, attrs) {
    var s = h('select', Object.assign({ class: 'sy-input' }, attrs || {}));
    options.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
    s.value = value == null ? '' : value;
    return s;
  }
  function lsGet(k) { try { return root.localStorage ? root.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) {
    try { if (root.localStorage) { if (v == null) root.localStorage.removeItem(k); else root.localStorage.setItem(k, v); } } catch (e) { /* 저장 안 됨: 편의 기능일 뿐 */ }
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function errMsg(e) { return (e && e.message) ? e.message : String((e && e.code) || e || '알 수 없는 오류'); }
  function ro() { return !A.st || !A.st.canWrite; }
  /* 서면 분류: Ingest 는 role 'brief'|'record'(|'unknown'), side '원고'|'피고'|null 을 넘긴다. role 이 없으면(시딩 자료) 서면으로 본다. */
  function roleOf(d) { return !d ? 'brief' : d.role === 'record' ? 'record' : d.role === 'unknown' ? 'unknown' : 'brief'; }
  function sideOk(d) { return !!d && (d.side === '원고' || d.side === '피고'); }
  function isBrief(d) { return !!d && roleOf(d) !== 'record'; }
  function needsAssign(d) { return roleOf(d) === 'unknown' || (roleOf(d) === 'brief' && !sideOk(d)); }
  function isTarget(d) { return roleOf(d) === 'brief' && sideOk(d); }
  function byId(arr) { var m = {}; (arr || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; }); return m; }
  function docLabel(d) {
    if (!d) return '서면';
    return d.filedDate && SY.date ? SY.docName(d) : (d.kind || d.fileName || '서면');
  }
  function caseLabel(c) { return (c.title || '이름 없는 사건') + (c.caseNo ? ' (' + c.caseNo + ')' : ''); }
  function safeFileName(s) {
    return String(s || '사건').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || '사건';
  }
  function fileBase() { var C = A.C || {}; return safeFileName(C.caseNo || C.title || '사건'); }
  function docNum(C, d) {
    var m = /^D(\d+)$/.exec(d && d.id || '');
    if (m) return Number(m[1]);
    var i = SY.docsInOrder(C).indexOf(d);
    return i >= 0 ? i + 1 : 0;
  }
  function maxDocNum(C) {
    var n = 0;
    (C.docs || []).forEach(function (d) { var m = /^D(\d+)$/.exec(d.id || ''); if (m) n = Math.max(n, Number(m[1])); });
    return n;
  }
  function pageStats(d) {
    var s = { text: 0, ocr: 0, manual: 0, needsOcr: 0, noImage: 0 };
    (d.pages || []).forEach(function (p) {
      var k = p && p.status in s ? p.status : 'text';
      s[k]++;
      if (k === 'needsOcr' && !p.image) s.noImage++;
    });
    return s;
  }

  /* ---------------- 토스트, 대화 상자 ---------------- */
  function toast(msg, opt) {
    opt = opt || {};
    var box = $('#sy-toasts'); if (!box) return;
    var t = h('div', { class: 'sy-toast', 'data-tone': opt.tone || '', role: opt.tone === 'error' ? 'alert' : 'status' }, h('span', { class: 'sy-toast-msg' }, msg));
    if (opt.action) t.appendChild(h('button', { type: 'button', onclick: function () { t.remove(); opt.action.fn(); } }, opt.action.label));
    t.appendChild(h('button', { type: 'button', 'aria-label': '알림 닫기', onclick: function () { t.remove(); } }, '닫기'));
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () { t.remove(); }, opt.ms || (opt.action ? 10000 : 5500));
  }
  function dialog(o) {
    return new Promise(function (resolve) {
      var prev = D.activeElement, done = false;
      var tid = 'syd-' + Math.random().toString(36).slice(2, 8);
      var box = h('div', { class: 'sy-modal' + (o.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid });
      var back = h('div', { class: 'sy-modal-back' }, box);
      function close(v) {
        if (done) return; done = true;
        D.removeEventListener('keydown', onKey, true);
        back.remove();
        if (prev && prev.focus && prev.isConnected) { try { prev.focus(); } catch (e) { /* 무시 */ } }
        resolve(v);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
        if (e.key === 'Tab') {
          var f = Array.prototype.filter.call(box.querySelectorAll('button, input, select, textarea, [tabindex="0"]'), function (x) { return !x.disabled && x.offsetParent !== null; });
          if (!f.length) return;
          if (e.shiftKey && D.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && D.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        }
      }
      box.appendChild(h('h2', { class: 'sy-modal-h', id: tid }, o.title));
      box.appendChild(h('div', { class: 'sy-modal-b' }, o.body));
      var foot = h('div', { class: 'sy-modal-f' });
      (o.actions || [{ label: '닫기', value: null }]).forEach(function (a) {
        foot.appendChild(btn(a.label, function () {
          if (typeof a.handler === 'function') {
            Promise.resolve(a.handler()).then(function (r) { if (r === false) return; close(r === undefined ? a.value : r); });
          } else close(a.value);
        }, (a.primary ? 'primary' : '') + (a.danger ? ' danger' : '')));
      });
      box.appendChild(foot);
      back.addEventListener('mousedown', function (e) { if (e.target === back) close(null); });
      D.addEventListener('keydown', onKey, true);
      (D.body || D.documentElement).appendChild(back);
      var first = box.querySelector('input:not([readonly]), select, textarea:not([readonly])') || foot.querySelector('.primary') || foot.querySelector('button');
      if (first) first.focus();
    });
  }
  function confirmBox(title, text, okLabel, danger) {
    return dialog({
      title: title, body: [].concat(text).map(function (t) { return h('p', null, t); }),
      actions: [{ label: '취소', value: false }, { label: okLabel || '확인', value: true, primary: !danger, danger: !!danger }]
    }).then(function (v) { return !!v; });
  }

  /* ---------------- 능력 확인(호출 없음) ---------------- */
  async function detectCaps() {
    var cl = root.claude, names = ['sample', 'downloads', 'mcp', 'assets'];
    if (!cl || typeof cl.use !== 'function') { names.forEach(function (n) { A.caps[n] = null; }); A.capsReady = true; return; }
    await Promise.all(names.map(async function (n) {
      try { A.caps[n] = await cl.use(n); } catch (e) { A.caps[n] = null; }
    }));
    A.capsReady = true;
  }

  /* ---------------- 사건 데이터 준비 ---------------- */
  function defaultProgress() {
    return { docsConfirmed: false, issuesConfirmed: false, extractedDocIds: [], reviewConfirmed: false, changesJudged: false, factsBuilt: false, stmtRev: 0, judgedRev: null, factsRev: null };
  }
  function prepareCase(C) {
    ['docs', 'issues', 'statements', 'changes', 'facts'].forEach(function (k) { if (!Array.isArray(C[k])) C[k] = []; });
    C.docs.forEach(function (d) { if (!Array.isArray(d.pages)) d.pages = []; });
    if (!C.parties || typeof C.parties !== 'object') C.parties = { '원고': '', '피고': '' };
    if (!C.margins || typeof C.margins !== 'object') C.margins = Object.assign({}, DEF_MARGINS);
    if (C.ourSide !== '원고' && C.ourSide !== '피고') C.ourSide = '원고';
    var dp = defaultProgress();
    if (!C.progress || typeof C.progress !== 'object') {
      // 진행 기록이 없는 사건(시딩한 샘플 등): 있는 데이터로 단계를 추정한다
      var has = C.statements.length > 0;
      C.progress = Object.assign(dp, {
        docsConfirmed: has, issuesConfirmed: has && C.issues.length > 0,
        extractedDocIds: has ? C.docs.filter(isBrief).map(function (d) { return d.id; }) : [],
        reviewConfirmed: has && (C.changes.length > 0 || C.facts.length > 0),
        changesJudged: C.changes.length > 0, factsBuilt: C.facts.length > 0,
        judgedRev: C.changes.length > 0 ? 0 : null, factsRev: C.facts.length > 0 ? 0 : null
      });
    } else {
      Object.keys(dp).forEach(function (k) { if (C.progress[k] === undefined) C.progress[k] = dp[k]; });
      if (!Array.isArray(C.progress.extractedDocIds)) C.progress.extractedDocIds = [];
    }
    return C;
  }
  function stageState(C) {
    var p = C.progress, briefs = C.docs.filter(isBrief);
    var unassigned = briefs.filter(needsAssign);
    var ocrPending = briefs.filter(function (d) { return pageStats(d).needsOcr > 0; });
    var notExtracted = briefs.filter(function (d) { return p.extractedDocIds.indexOf(d.id) < 0; });
    var done = {
      docs: briefs.length > 0 && !!p.docsConfirmed && ocrPending.length === 0 && unassigned.length === 0,
      issues: !!p.issuesConfirmed && C.issues.length > 0,
      extract: briefs.length > 0 && notExtracted.length === 0 && p.extractedDocIds.length > 0,
      review: !!p.reviewConfirmed && C.statements.length > 0,
      judge: !!p.changesJudged,
      facts: !!p.factsBuilt,
      viz: !!p.factsBuilt && C.facts.length > 0
    };
    var cur = null;
    for (var i = 0; i < STAGES.length; i++) if (!done[STAGES[i].key]) { cur = STAGES[i].key; break; }
    return { done: done, cur: cur, briefs: briefs, unassigned: unassigned, ocrPending: ocrPending, notExtracted: notExtracted };
  }
  function stageBar(C) {
    var s = stageState(C);
    return h('ol', { class: 'sy-stages', 'aria-label': '분석 단계' }, STAGES.map(function (st, i) {
      var d = s.done[st.key], cur = s.cur === st.key;
      return h('li', { class: 'sy-stage' + (d ? ' done' : cur ? ' cur' : ''), 'aria-current': cur ? 'step' : null },
        h('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)), st.label,
        h('span', { class: 's' }, d ? (st.key === 'viz' ? '볼 수 있음' : '완료') : cur ? '지금 단계' : ''));
    }));
  }

  /* ---------------- 저장 ---------------- */
  function setSaveState(text, tone) {
    var el = $('#sy-save-state'); if (!el) return;
    el.textContent = text || '';
    el.setAttribute('data-tone', tone || '');
  }
  function touch(kind) {
    A.rev++;
    if (kind === 'stmts' && A.C) A.C.progress.stmtRev = (A.C.progress.stmtRev || 0) + 1;
    scheduleSave();
  }
  function scheduleSave(ms) {
    if (!A.C) return;
    if (ro()) { setSaveState('읽기 전용: 바꾼 내용은 저장되지 않습니다', 'warn'); return; }
    clearTimeout(A.save.timer);
    A.save.dirty = true;
    setSaveState('저장 대기', '');
    A.save.timer = setTimeout(function () { saveNow(); }, ms == null ? 700 : ms);
  }
  async function saveNow(force) {
    clearTimeout(A.save.timer); A.save.timer = 0;
    var C = A.C;
    if (!C || ro()) return { ok: false, code: 'read_only' };
    A.save.dirty = false;
    setSaveState('저장 중', '');
    try {
      var r = await SY.Store.saveCase(C, force ? { force: true } : undefined);
      if (force && C._partial) { C._partial = false; renderNotices(); }
      setSaveState((A.st && A.st.mode === 'local' ? '이 브라우저에 저장됨 ' : '저장됨 ') + hhmm(new Date()), 'ok');
      var row = A.cases.filter(function (c) { return c.id === C.id; })[0];
      if (row) { row.title = C.title; row.caseNo = C.caseNo; row.updatedAt = C.updatedAt; }
      else A.cases.unshift({ id: C.id, title: C.title, caseNo: C.caseNo, updatedAt: C.updatedAt, counts: {} });
      return { ok: true, result: r };
    } catch (e) {
      A.save.dirty = true;
      var code = e && e.code;
      setSaveState(code === 'partial_case' ? '저장 안 함(일부를 읽지 못함)' : '저장 실패', 'error');
      if (code === 'partial_case') renderNotices();
      else if (code !== 'read_only') toast(errMsg(e), { tone: 'error', action: { label: '다시 시도', fn: function () { saveNow(); } } });
      return { ok: false, code: code, error: e };
    }
  }
  async function flushSave() {
    if ((A.save.timer || A.save.dirty) && A.C && !ro()) await saveNow();
  }

  /* ---------------- 헤더, 알림 띠 ---------------- */
  function renderHeader() {
    var sel = $('#sy-case-select'), nb = $('#sy-new-case');
    if (!sel || !nb) return;
    sel.innerHTML = '';
    var list = A.cases.slice();
    if (A.C && !list.some(function (c) { return c.id === A.C.id; })) list.unshift({ id: A.C.id, title: A.C.title, caseNo: A.C.caseNo });
    if (!list.length) { sel.appendChild(h('option', { value: '' }, A.ready ? '사건 없음' : '불러오는 중')); sel.disabled = true; }
    else {
      list.forEach(function (c) { sel.appendChild(h('option', { value: c.id }, caseLabel(c))); });
      sel.value = A.C ? A.C.id : '';
      sel.disabled = !!A.run;
    }
    nb.disabled = !A.ready || ro() || !!A.run;
    nb.title = ro() ? '읽기 전용이라 새 사건을 만들 수 없습니다' : '';
  }
  function renderNotices() {
    var box = $('#sy-notices'); if (!box) return;
    box.innerHTML = '';
    var st = A.st || {};
    if (st.revoked) box.appendChild(note('flag', '저장소를 더 이상 쓸 수 없습니다. 새로고침해 주십시오. 지금 화면에서 바꾼 내용은 저장되지 않습니다.'));
    else if (st.mode === 'db' && !st.canWrite) {
      box.appendChild(note('warn', [h('strong', null, '읽기 전용입니다. '),
        '내용을 볼 수만 있고, 바꾼 내용은 저장되지 않습니다. 새 사건, 자료 올리기, 분석은 쓸 수 없습니다. 저장하려면 이 아티팩트의 편집 권한(참여자 이상)이 필요합니다.']));
    }
    if (st.mode === 'local') {
      if (st.reason === 'no_claude') box.appendChild(note('', 'claude.ai 밖에서 열려 공용 저장소, Claude 분석, 파일 저장, 구글 드라이브를 쓸 수 없습니다. 자료는 이 브라우저에만 보관됩니다.'));
      else if (st.reason === 'no_db') box.appendChild(note('', '이 화면에서는 공용 저장소(db)를 쓸 수 없어 이 브라우저에만 저장합니다. 다른 기기나 다른 사람과 공유되지 않습니다.'));
      if (!st.persistent) box.appendChild(note('warn', '이 브라우저에 저장할 수 없어(저장 공간 부족 또는 차단) 새로고침하면 바꾼 내용이 사라집니다. 자료 탭의 "사건 파일로 내보내기"로 보관해 두십시오.'));
    }
    if (A.C && A.C._partial) {
      box.appendChild(note('flag', ['이 사건의 자료 묶음 ' + ((A.C._missing || []).length) + '개를 읽지 못했습니다. 이 상태에서는 저장하지 않습니다. ',
        btn('다시 읽기', function () { openCase(A.C.id); }, 'sm'),
        ro() ? null : btn('읽은 만큼만 저장', forceSave, 'sm danger')]));
    }
  }
  async function forceSave() {
    var ok = await confirmBox('읽은 만큼만 저장', '읽지 못한 묶음의 내용(쪽 원문, 진술, 판정, 사실 일부)은 저장소에서 지워집니다. 계속할까요?', '저장', true);
    if (ok) await saveNow(true);
  }

  /* ---------------- 빈 상태 ---------------- */
  function envItems() {
    var st = A.st || {}, c = A.caps, known = A.capsReady;
    function cap(v, yes, no) { return !known ? '확인 중' : v ? yes : no; }
    return [
      ['저장', st.mode === 'db' ? '공용 저장소(이 아티팩트를 여는 사람과 공유)' : '이 브라우저에만'],
      ['쓰기', st.canWrite ? '가능' : '읽기 전용'],
      ['Claude 분석', cap(c.sample && !A.sampleDenied, '쓸 수 있음(사용자 구독 사용량 차감)', '쓸 수 없음')],
      ['파일 저장', cap(c.downloads, 'PNG·SVG·TXT 저장 가능', '쓸 수 없음')],
      ['구글 드라이브', cap(c.mcp, '자료 탭에서 연결 확인', '쓸 수 없음')],
      ['원본 보관', cap(c.assets, '쓸 수 있음', '쓸 수 없음(편집 권한자만)')]
    ];
  }
  function renderEmpty() {
    hideTabs();
    var main = $('#sy-main'); if (!main) return;
    main.innerHTML = '';
    var steps = [
      ['자료', '서면 원본을 붙여넣거나 파일·폴더·구글 드라이브에서 올립니다. 서면마다 제출일·제출자·쪽수를 확인합니다.'],
      ['쟁점', '쟁점 초안을 만들고 이름과 관련 요건사실을 고쳐 확정합니다.'],
      ['진술', '서면마다 진술을 원문 인용·쪽수와 함께 뽑아 검수합니다. 원문과 맞지 않는 인용은 저장하지 않습니다.'],
      ['변천 지도', '쟁점별로 각 측 주장이 서면 순서에 따라 유지·변경·번복되었는지 봅니다. 자백은 후보로만 표시합니다.'],
      ['연표', '다툼 없는 사실은 시간선 위에, 원고 주장은 위쪽, 피고 주장은 아래쪽에 놓아 봅니다.'],
      ['A4 별지', '서면에 붙일 흑백 별지 연표를 S자 또는 Z자 배치로 만들어 PNG·SVG 로 저장합니다.']
    ];
    main.appendChild(h('section', { class: 'sy-empty', 'aria-labelledby': 'sy-empty-h' },
      h('h1', { id: 'sy-empty-h' }, '아직 사건이 없습니다'),
      h('p', { class: 'sy-empty-lead' }, '법원 기록(소장, 답변서, 준비서면 등)의 원본을 올리면 서면 작성에 쓸 연표와 주장 변천 자료를 만듭니다. 새 사건을 만들면 아래 순서로 진행합니다.'),
      h('ol', { class: 'sy-steps' }, steps.map(function (s) { return h('li', null, h('div', null, h('strong', null, s[0]), h('span', null, s[1]))); })),
      h('div', { class: 'sy-row' },
        btn('새 사건', newCase, 'primary', { disabled: !A.ready || ro() }),
        ro() && A.ready ? h('span', { class: 'sy-muted' }, '읽기 전용이라 새 사건을 만들 수 없습니다.') : null),
      h('ul', { class: 'sy-env', 'aria-label': '이 화면에서 쓸 수 있는 기능' }, envItems().map(function (x) { return h('li', null, h('b', null, x[0]), x[1]); })),
      h('p', { class: 'sy-muted' }, '이 도구는 서면 작성을 돕는 정리 도구입니다. 법률 판단을 대신하지 않으며, 자백은 후보로만, 해석이 필요한 판정은 "검토 필요"로 표시합니다.')
    ));
  }

  /* ---------------- 사건 열기, 새 사건 ---------------- */
  async function refreshCases() {
    try { A.cases = await SY.Store.listCases(); }
    catch (e) { A.cases = []; toast('사건 목록을 읽지 못했습니다: ' + errMsg(e), { tone: 'error' }); }
  }
  function destroyAll() {
    destroyTl(); destroyMap();
    if (A.ingestCtrl && typeof A.ingestCtrl.destroy === 'function') { try { A.ingestCtrl.destroy(); } catch (e) { /* 무시 */ } }
    A.ingestCtrl = null; A.ingestHost = null; A.ingestCaseId = null;
  }
  async function openCase(id) {
    if (A.run || A.issueRun || Object.keys(A.docRuns).length) { toast('분석이 끝난 뒤 사건을 바꿀 수 있습니다.'); renderHeader(); return; }
    await flushSave();
    destroyAll();
    var main = $('#sy-main');
    main.innerHTML = '';
    main.appendChild(h('p', { class: 'sy-loading' }, '사건을 불러오는 중입니다.'));
    try {
      var C = prepareCase(await SY.Store.loadCase(id));
      A.C = C; A.rev++;
      lsSet(LS.last, id);
      A.ui = freshUi(); A.lastRunMsg = null;
      setSaveState('');
      renderCase();
    } catch (e) {
      toast('사건을 열지 못했습니다: ' + errMsg(e), { tone: 'error' });
      if (A.C) renderCase(); else renderEmpty();
    }
    renderHeader(); renderNotices();
  }
  function caseForm(v) {
    v = v || {};
    var parties = v.parties || {};
    var f = {
      title: h('input', { class: 'sy-input', value: v.title || '', placeholder: '예: 홍길동 계약금반환', 'aria-required': 'true' }),
      caseNo: h('input', { class: 'sy-input', value: v.caseNo || '', placeholder: '예: 2023가단12345' }),
      court: h('input', { class: 'sy-input', value: v.court || '', placeholder: '예: ○○지방법원' }),
      ourSide: selectEl([['원고', '원고'], ['피고', '피고']], v.ourSide || '원고'),
      p: h('input', { class: 'sy-input', value: parties['원고'] || '' }),
      d: h('input', { class: 'sy-input', value: parties['피고'] || '' })
    };
    return {
      body: [h('div', { class: 'sy-grid2' },
        field('사건 이름', f.title), field('사건번호', f.caseNo), field('법원', f.court), field('우리 측', f.ourSide),
        field('원고', f.p), field('피고', f.d)),
        h('p', { class: 'sy-muted' }, '사건 이름만 꼭 적으면 됩니다. 나머지는 나중에 자료 탭의 사건 정보에서 고칠 수 있습니다.')],
      read: function () {
        if (!f.title.value.trim()) { f.title.setAttribute('aria-invalid', 'true'); f.title.focus(); return false; }
        return {
          title: f.title.value.trim(), caseNo: f.caseNo.value.trim(), court: f.court.value.trim(), ourSide: f.ourSide.value,
          parties: { '원고': f.p.value.trim(), '피고': f.d.value.trim() }
        };
      }
    };
  }
  async function newCase() {
    if (ro()) { toast('읽기 전용이라 새 사건을 만들 수 없습니다.'); return; }
    if (A.run || A.issueRun || Object.keys(A.docRuns).length) { toast('분석이 끝난 뒤 새 사건을 만들 수 있습니다.'); return; }
    var form = caseForm();
    var data = await dialog({ title: '새 사건', body: form.body, actions: [{ label: '취소', value: null }, { label: '만들기', primary: true, handler: form.read }] });
    if (!data) return;
    await flushSave();
    destroyAll();
    var C = prepareCase(Object.assign({ id: SY.uid('c') }, data, {
      margins: Object.assign({}, DEF_MARGINS), docs: [], issues: [{ id: 'I0', name: '기초사실', elements: '' }],
      statements: [], changes: [], facts: [], progress: defaultProgress(), updatedAt: new Date().toISOString(), schema: 1
    }));
    A.C = C; A.rev++; A.ui = freshUi(); A.tab = 'docs'; A.lastRunMsg = null;
    lsSet(LS.last, C.id);
    renderCase(); renderHeader(); renderNotices();
    var r = await saveNow();
    if (r.ok) toast('새 사건을 만들었습니다. 자료 올리기에서 서면을 추가해 주십시오.');
    renderHeader();
  }
  async function editCaseInfo() {
    var C = A.C, form = caseForm(C);
    var data = await dialog({ title: '사건 정보', body: form.body, actions: [{ label: '취소', value: null }, { label: '반영', primary: true, handler: form.read }] });
    if (!data) return;
    Object.assign(C, data);
    touch('meta'); renderHeader(); renderPanel('docs');
  }
  async function deleteCurrentCase() {
    var C = A.C;
    var ok = await confirmBox('사건 삭제', ['"' + caseLabel(C) + '" 사건과 그 안의 서면 원문, 진술, 판정, 사실을 모두 지웁니다. 되돌릴 수 없습니다.', '보관이 필요하면 먼저 "사건 파일로 내보내기"를 눌러 주십시오.'], '삭제', true);
    if (!ok) return;
    clearTimeout(A.save.timer); A.save.timer = 0; A.save.dirty = false;
    try { await SY.Store.deleteCase(C.id); }
    catch (e) { toast('지우지 못했습니다: ' + errMsg(e), { tone: 'error' }); return; }
    destroyAll(); A.C = null; lsSet(LS.last, null);
    await refreshCases();
    toast('사건을 지웠습니다.');
    if (A.cases.length) await openCase(A.cases[0].id);
    else { renderHeader(); renderNotices(); renderEmpty(); }
  }
  function exportCase() {
    var data = JSON.stringify(SY.Store.clean(A.C), null, 1);
    saveFile(fileBase() + '_사건자료.json', data);
  }

  /* ---------------- 탭 ---------------- */
  function hideTabs() { var nav = $('#sy-tabs'); if (nav) { nav.hidden = true; nav.innerHTML = ''; } }
  function renderCase() {
    var nav = $('#sy-tabs'); nav.hidden = false; nav.innerHTML = '';
    TABS.forEach(function (t) {
      nav.appendChild(h('button', {
        type: 'button', role: 'tab', class: 'sy-tab', id: 'sy-tab-' + t.key, 'aria-controls': 'sy-panel-' + t.key,
        'aria-selected': 'false', tabindex: '-1', 'data-tab': t.key, onclick: function () { setTab(t.key); }
      }, t.label));
    });
    nav.onkeydown = function (e) {
      var i = TABS.map(function (t) { return t.key; }).indexOf(A.tab);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].key;
        setTab(n); var b = $('#sy-tab-' + n); if (b) b.focus();
      }
    };
    var main = $('#sy-main'); main.innerHTML = '';
    A.panels = {};
    TABS.forEach(function (t) {
      var p = h('section', { id: 'sy-panel-' + t.key, role: 'tabpanel', 'aria-labelledby': 'sy-tab-' + t.key, class: 'sy-panel', hidden: true });
      A.panels[t.key] = p; main.appendChild(p);
    });
    var saved = lsGet(LS.tab);
    setTab(TABS.some(function (t) { return t.key === A.tab; }) ? A.tab : (saved || 'docs'));
  }
  function setTab(key) {
    if (!A.C || !A.panels[key]) return;
    if (A.tab !== key) { if (A.tab === 'timeline') destroyTl(); if (A.tab === 'map') destroyMap(); }
    A.tab = key; lsSet(LS.tab, key);
    TABS.forEach(function (t) {
      var b = $('#sy-tab-' + t.key);
      if (b) { b.setAttribute('aria-selected', String(t.key === key)); b.tabIndex = t.key === key ? 0 : -1; }
      A.panels[t.key].hidden = t.key !== key;
    });
    renderPanel(key);
  }
  function renderPanel(key) {
    var p = A.panels[key];
    if (!A.C || !p) return;
    try { RENDER[key](p); }
    catch (e) {
      if (root.console) console.error(e);
      p.innerHTML = '';
      p.appendChild(note('flag', '이 화면을 그리는 중 문제가 생겼습니다: ' + errMsg(e)));
    }
  }
  function refreshActive() { if (A.C && A.panels[A.tab]) renderPanel(A.tab); }

  /* ================= 자료 탭 ================= */
  function renderDocs(p) {
    var C = A.C;
    p.innerHTML = '';
    var info = h('div', { class: 'sy-card sy-caseinfo' },
      h('div', null, h('h2', { class: 'sy-h2' }, C.title || '이름 없는 사건'),
        h('dl', null,
          h('dt', null, '사건번호'), h('dd', null, C.caseNo || '-'),
          h('dt', null, '법원'), h('dd', null, C.court || '-'),
          h('dt', null, '원고'), h('dd', null, (C.parties['원고'] || '-') + (C.ourSide === '원고' ? ' (우리 측)' : '')),
          h('dt', null, '피고'), h('dd', null, (C.parties['피고'] || '-') + (C.ourSide === '피고' ? ' (우리 측)' : '')))),
      h('div', { class: 'sy-row end' },
        ro() ? null : btn('사건 정보 고치기', editCaseInfo, 'sm'),
        btn('사건 파일로 내보내기', exportCase, 'sm', { disabled: A.capsReady && !A.caps.downloads, title: '사건 자료 전체를 JSON 파일로 저장합니다' }),
        ro() ? null : btn('사건 삭제', deleteCurrentCase, 'sm danger')));
    p.appendChild(info);
    A.docListEl = h('div', { class: 'sy-card', id: 'sy-doclist' });
    fillDocList();
    var ing = h('div', { class: 'sy-card' });
    if (ro()) ing.appendChild(note('', '읽기 전용이라 자료를 올릴 수 없습니다.'));
    else if (!SY.Ingest || typeof SY.Ingest.mount !== 'function') ing.appendChild(note('warn', '자료 올리기 기능을 불러오지 못했습니다. 새로고침해 주십시오.'));
    else { ensureIngest(); ing.appendChild(A.ingestHost); }
    if (C.docs.length) { p.appendChild(A.docListEl); p.appendChild(ing); }
    else { p.appendChild(ing); p.appendChild(A.docListEl); }
  }
  function ensureIngest() {
    if (A.ingestCtrl && A.ingestCaseId === A.C.id && A.ingestHost) return;
    if (A.ingestCtrl && typeof A.ingestCtrl.destroy === 'function') { try { A.ingestCtrl.destroy(); } catch (e) { /* 무시 */ } }
    A.ingestHost = h('div', { class: 'sy-ingest-host' });
    var rules = null;
    try { rules = JSON.parse(lsGet(LS.rules) || 'null'); } catch (e) { rules = null; }
    try {
      A.ingestCtrl = SY.Ingest.mount(A.ingestHost, {
        getCase: function () { return A.C; },
        onDocs: onIngestDocs,
        rules: rules || undefined,
        setRules: function (r) { lsSet(LS.rules, JSON.stringify(r)); }
      });
      A.ingestCaseId = A.C.id;
    } catch (e) {
      if (root.console) console.error(e);
      A.ingestCtrl = null;
      A.ingestHost.appendChild(note('flag', '자료 올리기 화면을 여는 중 문제가 생겼습니다: ' + errMsg(e)));
    }
  }
  var ASSET_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', md: 'text/markdown' };
  async function keepOriginals(docs) {
    var assets = A.caps.assets;
    if (!assets) return 0;
    var n = 0;
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i], b = d.rawBlob;
      if (!b || typeof Blob === 'undefined' || !(b instanceof Blob) || !b.size) continue;
      var ext = (/\.([A-Za-z0-9]+)$/.exec(d.fileName || '') || [])[1];
      var type = ASSET_TYPES[String(ext || '').toLowerCase()];
      if (!type) continue;   // docx, hwpx 등은 보관 형식 밖
      try {
        var r = await assets.upload(b, { type: type });
        d.original = { assetId: r.id, contentType: r.contentType, sizeBytes: r.sizeBytes };
        n++;
      } catch (e) {
        var code = e && e.code;
        toast('원본 보관 실패(' + (d.fileName || d.id) + '): ' + ({ too_large: '파일이 너무 큽니다', quota_or_state: '보관 공간이 가득 찼습니다', rate_limited: '요청이 너무 잦습니다', unsupported_type: '보관할 수 없는 형식입니다' }[code] || code || '알 수 없는 오류'), { tone: 'error' });
        if (code === 'capability_disabled' || code === 'not_granted' || code === 'capability_removed') { A.caps.assets = null; break; }
      }
    }
    return n;
  }
  async function onIngestDocs(docs, info) {
    var C = A.C;
    if (!C) throw new Error('열린 사건이 없습니다');
    if (ro()) throw new Error('읽기 전용이라 추가할 수 없습니다');
    var used = {}, nmax = maxDocNum(C), added = [];
    C.docs.forEach(function (d) { used[d.id] = 1; });
    (docs || []).forEach(function (d0) {
      var d = Object.assign({}, d0);
      if (!d.id || used[d.id]) d.id = 'D' + (++nmax);
      used[d.id] = 1;
      if (!Array.isArray(d.pages)) d.pages = [];
      if (d.pageCount == null) d.pageCount = d.pages.length;
      if (info && info.masked != null) d.masked = !!info.masked;
      added.push(d);
    });
    if (!added.length) return;
    var kept = info && info.keepOriginals ? await keepOriginals(added) : 0;
    C.docs = C.docs.concat(added);
    touch('docs');
    await saveNow();
    fillDocList();
    if (A.tab === 'docs' && A.docListEl && !A.docListEl.isConnected) renderPanel('docs');
    var started = C.progress.extractedDocIds.length > 0;
    var un = added.filter(needsAssign).length;
    toast('서면 ' + added.length + '건을 사건에 넣었습니다.' + (kept ? ' 원본 ' + kept + '건을 보관했습니다.' : '') +
      (un ? ' 측이나 분류가 정해지지 않은 ' + un + '건은 서면 목록의 "고치기"로 정해 주어야 분석할 수 있습니다.' : '') +
      (started ? ' 서면 목록의 "이 서면만 추가 분석"으로 새 서면만 분석할 수 있습니다.' : ''));
  }
  function fillDocList() {
    var card = A.docListEl; if (!card) return;
    var C = A.C, s = stageState(C), pr = C.progress;
    card.innerHTML = '';
    card.appendChild(h('div', { class: 'sy-row' }, h('h2', { class: 'sy-h2' }, '서면 목록'), h('span', { class: 'sy-muted' }, C.docs.length + '건(제출일 순)')));
    if (!C.docs.length) {
      card.appendChild(h('p', { class: 'sy-muted' }, '아직 서면이 없습니다. "자료 올리기"에서 서면을 올리고 자료함에서 "분석에 추가"를 누르면 여기에 제출일·제출자·쪽수·상태가 나타납니다.'));
      return;
    }
    if (s.ocrPending.length) {
      var pages = 0; s.ocrPending.forEach(function (d) { pages += pageStats(d).needsOcr; });
      card.appendChild(note('warn', ['스캔본 서면 ' + s.ocrPending.length + '건(' + pages + '쪽)은 진술 추출 전에 글로 옮겨 적어야 합니다. ',
        btn('진술 탭에서 옮겨 적기', function () { setTab('stmts'); }, 'sm')]));
    }
    if (s.unassigned.length) {
      card.appendChild(note('warn', '측(원고/피고)이나 분류(서면/기록)가 정해지지 않은 서면이 ' + s.unassigned.length + '건 있습니다. "고치기"로 정하기 전에는 분석에 넣을 수 없습니다.'));
    }
    if (!pr.docsConfirmed && s.briefs.length) {
      card.appendChild(note('', ['1단계 서면 확인: 제출일·서면 종류·측·제출자가 맞는지 확인해 주십시오. 틀린 칸은 "고치기"로 바꿉니다. ',
        ro() ? null : btn('서면 확인 완료', confirmDocs, 'sm primary')]));
    }
    var stCount = {};
    C.statements.forEach(function (x) { stCount[x.docId] = (stCount[x.docId] || 0) + 1; });
    var started = pr.extractedDocIds.length > 0;
    var tbody = h('tbody');
    SY.docsInOrder(C).forEach(function (d) {
      var ps = pageStats(d), status = [];
      if (!isBrief(d)) status.push(h('span', { class: 'sy-badge' }, '기록(진술 추출 안 함)'));
      if (roleOf(d) === 'unknown') status.push(h('span', { class: 'sy-badge flag' }, '분류 미정'));
      else if (needsAssign(d)) status.push(h('span', { class: 'sy-badge flag' }, '측 미정'));
      if (ps.needsOcr) status.push(h('span', { class: 'sy-badge warn' }, '스캔본 ' + ps.needsOcr + '쪽 남음'));
      if (ps.ocr) status.push(h('span', { class: 'sy-badge' }, '옮겨 적음 ' + ps.ocr + '쪽'));
      if (ps.manual) status.push(h('span', { class: 'sy-badge' }, '직접 고침 ' + ps.manual + '쪽'));
      if (!ps.needsOcr && isBrief(d)) status.push(h('span', { class: 'sy-badge ok' }, '텍스트'));
      if (ps.noImage) status.push(h('span', { class: 'sy-badge flag', title: '새로고침 뒤에는 스캔 그림이 남지 않습니다' }, '그림 없음 ' + ps.noImage + '쪽'));
      if (d.original) status.push(h('span', { class: 'sy-badge' }, '원본 보관'));
      var extracted = pr.extractedDocIds.indexOf(d.id) >= 0;
      var run = A.docRuns[d.id];
      var acts = [btn('원문 보기', function () { viewDoc(d.id); }, 'sm')];
      if (!ro()) acts.push(btn('고치기', function () { editDoc(d.id); }, 'sm'));
      if (run) {
        acts.push(h('span', { class: 'sy-muted' }, (run.msg || '분석 중') + ' ' + Math.round((run.frac || 0) * 100) + '%'));
        acts.push(btn('중지', function () { run.ctl.abort(); }, 'sm'));
      } else if (started && isBrief(d) && !extracted && !ro()) {
        acts.push(btn('이 서면만 추가 분석', function () { addDocAnalysis(d.id); }, 'sm primary', {
          disabled: !canAnalyze() || !pr.issuesConfirmed || needsAssign(d),
          title: needsAssign(d) ? '먼저 "고치기"로 측과 분류를 정해 주십시오' : !pr.issuesConfirmed ? '먼저 쟁점을 확정해 주십시오' : '' }));
      }
      if (!ro()) acts.push(btn('삭제', function () { deleteDoc(d.id); }, 'sm danger'));
      tbody.appendChild(h('tr', null,
        h('td', { class: 'num' }, d.filedDate ? SY.date.fmtKo(d.filedDate, 'day') : '-'),
        h('td', null, h('div', null, d.kind || '-'), h('div', { class: 'sy-muted' }, d.fileName || '')),
        h('td', null, h('span', { class: 'sy-badge ' + (d.side === '원고' ? 'p' : d.side === '피고' ? 'd' : '') }, d.side || '측 미정'), ' ', d.submitter || ''),
        h('td', { class: 'num' }, String(d.pageCount != null ? d.pageCount : (d.pages || []).length)),
        h('td', null, status),
        h('td', { class: 'num' }, isBrief(d) ? (extracted ? (stCount[d.id] || 0) + '건' : (started ? '미분석' : '-')) : '-'),
        h('td', { class: 'acts' }, acts)));
    });
    card.appendChild(h('div', { class: 'sy-tablewrap', role: 'region', 'aria-label': '서면 목록 표', tabindex: '0' },
      h('table', { class: 'sy-table' },
        h('thead', null, h('tr', null, ['제출일', '서면', '측·제출자', '쪽수', '상태', '진술', '작업'].map(function (t) { return h('th', { scope: 'col' }, t); }))),
        tbody)));
  }
  function confirmDocs() {
    var C = A.C;
    if (!C.docs.filter(isBrief).length) { toast('분석할 서면이 없습니다.'); return; }
    var un = C.docs.filter(needsAssign);
    if (un.length) { toast('측이나 분류가 정해지지 않은 서면 ' + un.length + '건을 먼저 "고치기"로 정해 주십시오.', { tone: 'error' }); return; }
    C.progress.docsConfirmed = true;
    touch('docs');
    toast('서면 확인을 마쳤습니다.' + (C.progress.issuesConfirmed ? '' : ' 다음은 쟁점 확정입니다.'), C.progress.issuesConfirmed ? null : { action: { label: '쟁점 탭으로', fn: function () { setTab('issues'); } } });
    refreshActive();
  }
  async function viewDoc(docId) {
    var C = A.C, d = byId(C.docs)[docId]; if (!d) return;
    var areas = [];
    var list = h('div', { class: 'sy-pages' }, (d.pages || []).map(function (pg) {
      var ta = h('textarea', { class: 'sy-input', readOnly: ro(), 'aria-label': '제' + pg.n + '쪽 원문' });
      ta.value = pg.text || '';
      areas.push([pg, ta]);
      var stTxt = { text: '텍스트', ocr: '옮겨 적음(대조 필요)', needsOcr: '스캔본(아직 옮겨 적지 않음)', manual: '직접 고침' }[pg.status] || pg.status || '텍스트';
      return h('div', { class: 'sy-page' }, h('div', { class: 'sy-page-h' }, h('strong', null, '제' + pg.n + '쪽'), h('span', { class: 'sy-muted' }, stTxt)), ta);
    }));
    var body = [h('p', { class: 'sy-muted' }, (d.fileName || '') + ' · ' + (d.pages || []).length + '쪽. ' +
      (ro() ? '' : '옮겨 적은 글이 원본과 다르면 여기서 고칠 수 있습니다. 고친 쪽은 "직접 고침"으로 표시되고, 진술 인용은 고친 글과 다시 대조됩니다.')), list];
    if (!(d.pages || []).length) body.push(note('', '이 서면에는 쪽 원문이 없습니다.'));
    var acts = ro() ? [{ label: '닫기', value: null }] : [{ label: '닫기', value: null }, { label: '고친 내용 반영', value: 'save', primary: true }];
    var r = await dialog({ title: docLabel(d) + ' 원문', body: body, wide: true, actions: acts });
    if (r !== 'save') return;
    var changed = 0;
    areas.forEach(function (x) {
      if ((x[0].text || '') !== x[1].value) { x[0].text = x[1].value; x[0].status = x[1].value.trim() ? 'manual' : x[0].status; changed++; }
    });
    if (changed) { touch('docs'); toast(changed + '쪽을 고쳤습니다.'); refreshActive(); }
  }
  async function editDoc(docId) {
    var C = A.C, d = byId(C.docs)[docId]; if (!d) return;
    var f = {
      kind: h('input', { class: 'sy-input', value: d.kind || '' }),
      side: selectEl([['', '정하지 않음'], ['원고', '원고'], ['피고', '피고']], sideOk(d) ? d.side : ''),
      submitter: h('input', { class: 'sy-input', value: d.submitter || '' }),
      filedDate: h('input', { class: 'sy-input', type: 'date', value: d.filedDate || '' }),
      role: selectEl([['unknown', '정하지 않음'], ['brief', '서면(진술 추출)'], ['record', '기록(대조용, 추출 안 함)']], roleOf(d))
    };
    var r = await dialog({
      title: '서면 정보 고치기',
      body: [h('div', { class: 'sy-grid2' }, field('서면 종류', f.kind), field('측', f.side), field('제출자', f.submitter), field('제출일', f.filedDate, '접수·제출일(전자소송 제출일시 기준)'), field('분류', f.role))],
      actions: [{ label: '취소', value: null }, {
        label: '반영', primary: true, handler: function () {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(f.filedDate.value)) { f.filedDate.setAttribute('aria-invalid', 'true'); f.filedDate.focus(); return false; }
          if (!f.kind.value.trim()) { f.kind.setAttribute('aria-invalid', 'true'); f.kind.focus(); return false; }
          if (f.role.value === 'brief' && !f.side.value) { f.side.setAttribute('aria-invalid', 'true'); f.side.focus(); return false; }
          return true;
        }
      }]
    });
    if (!r) return;
    d.kind = f.kind.value.trim(); d.side = f.side.value || null; d.submitter = f.submitter.value.trim(); d.filedDate = f.filedDate.value;
    d.role = f.role.value === 'record' ? 'record' : f.role.value === 'unknown' ? 'unknown' : 'brief';
    touch('docs'); refreshActive();
  }
  async function deleteDoc(docId) {
    var C = A.C, d = byId(C.docs)[docId]; if (!d) return;
    var sids = {}; C.statements.forEach(function (s) { if (s.docId === docId) sids[s.id] = 1; });
    var nS = Object.keys(sids).length;
    var nC = C.changes.filter(function (c) { return sids[c.fromId] || sids[c.toId] || c.toDocId === docId; }).length;
    var ok = await confirmBox('서면 삭제', docLabel(d) + '을(를) 지웁니다. 이 서면에서 뽑은 진술 ' + nS + '건과 관련 변화 판정 ' + nC + '건도 함께 지워집니다. 사실은 남기고 근거 연결만 뺍니다.', '삭제', true);
    if (!ok) return;
    C.docs = C.docs.filter(function (x) { return x.id !== docId; });
    C.statements = C.statements.filter(function (s) { return !sids[s.id]; });
    C.changes = C.changes.filter(function (c) { return !(sids[c.fromId] || sids[c.toId] || c.toDocId === docId); });
    pruneFactLinks(sids);
    if (C.rejected) C.rejected = C.rejected.filter(function (x) { return x.docId !== docId; });
    C.progress.extractedDocIds = C.progress.extractedDocIds.filter(function (x) { return x !== docId; });
    touch('stmts'); refreshActive();
    toast(docLabel(d) + '을(를) 지웠습니다.');
  }
  function pruneFactLinks(sids) {
    A.C.facts.forEach(function (f) {
      ['plaintiff', 'defendant'].forEach(function (k) {
        if (f[k] && Array.isArray(f[k].stmtIds)) f[k].stmtIds = f[k].stmtIds.filter(function (id) { return !sids[id]; });
      });
    });
  }

  /* ================= 쟁점 탭 ================= */
  function nextIssueId(C) {
    var n = 0;
    C.issues.forEach(function (i) { var m = /^I(\d+)$/.exec(i.id || ''); if (m) n = Math.max(n, Number(m[1])); });
    return 'I' + (n + 1);
  }
  function issueStatusNote() {
    var C = A.C;
    return C.progress.issuesConfirmed
      ? note('ok', '쟁점이 확정되었습니다. 진술 추출은 이 쟁점 목록의 id 에만 진술을 연결합니다. 쟁점을 고치면 다시 확정해야 합니다.')
      : note('warn', '쟁점이 아직 확정되지 않았습니다. 이름과 관련 요건사실을 확인한 뒤 "쟁점 확정"을 눌러 주십시오. 확정 전에는 진술 추출을 시작할 수 없습니다.');
  }
  function unconfirmIssues() {
    var C = A.C;
    if (C.progress.issuesConfirmed) {
      C.progress.issuesConfirmed = false;
      if (A.issueStatusEl) { var n = issueStatusNote(); A.issueStatusEl.replaceWith(n); A.issueStatusEl = n; }
    }
  }
  function renderIssues(p) {
    var C = A.C;
    p.innerHTML = '';
    p.appendChild(stageBar(C));
    var head = h('div', { class: 'sy-card' });
    head.appendChild(h('h2', { class: 'sy-h2' }, '쟁점'));
    head.appendChild(h('p', { class: 'sy-muted' }, '진술은 확정된 쟁점에만 연결됩니다. 초안을 만들거나 직접 추가한 뒤 이름과 관련 요건사실을 고치고 "쟁점 확정"을 눌러 주십시오. I0 은 기초사실용입니다.'));
    A.issueStatusEl = issueStatusNote();
    head.appendChild(A.issueStatusEl);
    var hasText = C.docs.some(function (d) { return isBrief(d) && (d.pages || []).some(function (pg) { return (pg.text || '').trim(); }); });
    var why = !canAnalyze() ? analyzeBlocker() : !hasText ? '초안을 만들려면 먼저 자료 탭에서 글이 있는 서면을 추가해 주십시오.' : '';
    var row = h('div', { class: 'sy-row' },
      btn('쟁점 초안 만들기', draftIssues, '', { disabled: !!why || !!A.issueRun || ro() }),
      btn('쟁점 추가', addIssue, '', { disabled: ro() }),
      C.issues.some(function (i) { return i.id === 'I0'; }) ? null : btn('기초사실(I0) 추가', addI0, '', { disabled: ro() }),
      h('span', { class: 'sy-spacer' }),
      btn('쟁점 확정', confirmIssues, 'primary', { disabled: ro() || !C.issues.length }));
    head.appendChild(row);
    if (why && !ro()) head.appendChild(h('p', { class: 'sy-muted' }, why));
    if (A.issueRun) {
      head.appendChild(h('div', { class: 'sy-progress' },
        h('progress', { max: '1', value: String(A.issueRun.frac || 0) }),
        h('div', { class: 'sy-row' }, h('span', { class: 'msg' }, A.issueRun.msg || '쟁점 초안을 만드는 중입니다'), btn('중지', function () { A.issueRun.ctl.abort(); }, 'sm'))));
    }
    p.appendChild(head);
    var listCard = h('div', { class: 'sy-card' });
    var cnt = {};
    C.statements.forEach(function (s) { (s.issueIds || []).forEach(function (i) { cnt[i] = (cnt[i] || 0) + 1; }); });
    if (!C.issues.length) listCard.appendChild(h('p', { class: 'sy-muted' }, '쟁점이 없습니다. "쟁점 초안 만들기" 또는 "쟁점 추가"를 눌러 주십시오.'));
    var ul = h('ol', { class: 'sy-issues' });
    C.issues.forEach(function (it, idx) {
      var name = h('input', { class: 'sy-input', value: it.name || '', placeholder: '쟁점 이름', disabled: ro(), 'aria-label': it.id + ' 쟁점 이름', 'data-issue-name': it.id });
      var el = h('textarea', { class: 'sy-input', placeholder: '관련 요건사실(예: 계약 체결일, 대금, 해제 사유)', disabled: ro(), 'aria-label': it.id + ' 관련 요건사실' });
      el.value = it.elements || '';
      name.addEventListener('input', function () { it.name = name.value; name.removeAttribute('aria-invalid'); unconfirmIssues(); touch('issues'); });
      el.addEventListener('input', function () { it.elements = el.value; unconfirmIssues(); touch('issues'); });
      ul.appendChild(h('li', { class: 'sy-issue' },
        h('div', { class: 'sy-issue-id' }, it.id),
        h('div', { class: 'sy-issue-f' }, name, el, h('div', { class: 'sy-issue-meta' }, '연결된 진술 ' + (cnt[it.id] || 0) + '건')),
        ro() ? h('div') : h('div', { class: 'sy-issue-acts' },
          btn('위로', function () { moveIssue(idx, -1); }, 'sm', { disabled: idx === 0, 'aria-label': it.id + ' 위로' }),
          btn('아래로', function () { moveIssue(idx, 1); }, 'sm', { disabled: idx === C.issues.length - 1, 'aria-label': it.id + ' 아래로' }),
          btn('삭제', function () { deleteIssue(it.id); }, 'sm danger', { 'aria-label': it.id + ' 삭제' }))));
    });
    listCard.appendChild(ul);
    var known = byId(C.issues), orphan = 0;
    C.statements.forEach(function (s) { if ((s.issueIds || []).some(function (i) { return !known[i]; })) orphan++; });
    if (orphan) listCard.appendChild(note('warn', '목록에 없는 쟁점 id 를 가리키는 진술이 ' + orphan + '건 있습니다. 진술 탭에서 "미분류"로 보이며 쟁점을 다시 고를 수 있습니다.'));
    p.appendChild(listCard);
  }
  function addIssue() {
    var C = A.C, id = nextIssueId(C);
    C.issues.push({ id: id, name: '', elements: '' });
    unconfirmIssues(); touch('issues'); renderPanel('issues');
    var inp = D.querySelector('[data-issue-name="' + id + '"]'); if (inp) inp.focus();
  }
  function addI0() {
    A.C.issues.unshift({ id: 'I0', name: '기초사실', elements: '' });
    unconfirmIssues(); touch('issues'); renderPanel('issues');
  }
  function moveIssue(i, dir) {
    var L = A.C.issues, j = i + dir;
    if (j < 0 || j >= L.length) return;
    var t = L[i]; L[i] = L[j]; L[j] = t;
    touch('issues'); renderPanel('issues');
    var b = D.querySelectorAll('.sy-issue')[j]; if (b) { var x = b.querySelector('button'); if (x) x.focus(); }
  }
  async function deleteIssue(id) {
    var C = A.C;
    var nS = C.statements.filter(function (s) { return (s.issueIds || []).indexOf(id) >= 0; }).length;
    var nC = C.changes.filter(function (c) { return c.issueId === id; }).length;
    if (nS || nC) {
      var ok = await confirmBox('쟁점 삭제', id + ' 쟁점을 지웁니다. 연결된 진술 ' + nS + '건에서 이 쟁점이 빠지고(다른 쟁점이 없으면 미분류), 이 쟁점의 변화 판정 ' + nC + '건이 지워집니다.', '삭제', true);
      if (!ok) return;
    }
    C.issues = C.issues.filter(function (i) { return i.id !== id; });
    C.statements.forEach(function (s) { if (s.issueIds) s.issueIds = s.issueIds.filter(function (x) { return x !== id; }); });
    C.facts.forEach(function (f) { if (f.issueIds) f.issueIds = f.issueIds.filter(function (x) { return x !== id; }); });
    C.changes = C.changes.filter(function (c) { return c.issueId !== id; });
    unconfirmIssues(); touch('stmts'); renderPanel('issues');
  }
  function confirmIssues() {
    var C = A.C;
    var bad = C.issues.filter(function (i) { return !String(i.name || '').trim(); });
    if (bad.length) {
      toast('이름이 빈 쟁점이 있습니다: ' + bad.map(function (i) { return i.id; }).join(', '), { tone: 'error' });
      var inp = D.querySelector('[data-issue-name="' + bad[0].id + '"]');
      if (inp) { inp.setAttribute('aria-invalid', 'true'); inp.focus(); }
      return;
    }
    C.progress.issuesConfirmed = true;
    touch('issues'); renderPanel('issues');
    toast('쟁점을 확정했습니다.', { action: { label: '진술 탭으로', fn: function () { setTab('stmts'); } } });
  }
  function normalizeIssue(x, i) {
    return { id: String(x && x.id || ('I' + (i + 1))), name: String(x && x.name || ''), elements: String(x && x.elements || '') };
  }
  async function draftIssues() {
    if (!(await ensureAnalyzeReady())) return;
    var C = A.C, ctl = new AbortController();
    A.issueRun = { ctl: ctl, msg: '쟁점 초안을 만드는 중입니다', frac: 0 };
    renderPanel('issues'); renderHeader();
    try {
      var list = await SY.Pipeline.draftIssues(C, {
        signal: ctl.signal, sample: A.caps.sample,
        onProgress: function (m, f) {
          if (!A.issueRun) return;
          A.issueRun.msg = m || A.issueRun.msg; A.issueRun.frac = Number(f) || 0;
          var pg = A.panels.issues && A.panels.issues.querySelector('.sy-progress');
          if (pg) { pg.querySelector('progress').value = A.issueRun.frac; pg.querySelector('.msg').textContent = A.issueRun.msg; }
        }
      });
      if (!Array.isArray(list) || !list.length) { toast('초안을 만들지 못했습니다(빈 결과). 직접 추가해 주십시오.'); return; }
      var custom = C.issues.some(function (i) { return i.id !== 'I0' || (i.elements || '').trim() || (i.name && i.name !== '기초사실'); });
      if (custom) {
        var ok = await confirmBox('쟁점 초안', '초안 ' + list.length + '개로 지금 쟁점 목록을 바꿀까요? 지금 목록은 사라집니다.', '초안으로 바꾸기');
        if (!ok) return;
      }
      C.issues = list.map(normalizeIssue);
      C.progress.issuesConfirmed = false;
      touch('issues');
      toast('쟁점 초안 ' + list.length + '개를 넣었습니다. 고친 뒤 "쟁점 확정"을 눌러 주십시오.');
    } catch (e) {
      var t = runErrText(e);
      toast(t, { tone: e && e.code === 'cancelled' ? '' : 'error' });
    } finally {
      A.issueRun = null;
      if (A.tab === 'issues') renderPanel('issues');
      renderHeader();
    }
  }

  /* ================= 분석 공통 ================= */
  function canAnalyze() {
    return !ro() && A.capsReady && !!A.caps.sample && !A.sampleDenied && !!SY.Pipeline;
  }
  function analyzeBlocker() {
    if (ro()) return '읽기 전용이라 분석할 수 없습니다.';
    if (!A.capsReady) return 'Claude 분석을 쓸 수 있는지 확인하는 중입니다.';
    if (!A.caps.sample || A.sampleDenied) return '이 화면에서는 Claude 분석을 쓸 수 없습니다. 이미 분석된 결과 보기와 직접 편집만 할 수 있습니다.';
    if (!SY.Pipeline) return '분석 기능을 불러오지 못했습니다. 새로고침해 주십시오.';
    return '';
  }
  function busy() { return !!(A.run || A.issueRun || Object.keys(A.docRuns).length); }
  async function ensureAnalyzeReady() {
    var why = analyzeBlocker();
    if (why) { toast(why); return false; }
    if (busy()) { toast('이미 분석이 진행 중입니다.'); return false; }
    var ok = await privacyAck();
    if (ok && typeof SY.Pipeline.init === 'function' && !(typeof SY.Pipeline.available === 'function' && SY.Pipeline.available())) {
      try { await SY.Pipeline.init(A.caps.sample); } catch (e) { /* opts.sample 로도 넘긴다 */ }
    }
    return ok;
  }
  async function privacyAck() {
    if (A.ack || lsGet(LS.ack) === '1') { A.ack = true; return true; }
    var ok = await dialog({
      title: '분석 전에 확인해 주십시오',
      body: [
        h('p', null, '분석을 시작하면 서면 내용이 Claude 로 전송되고, 사용자의 구독 사용량이 차감됩니다.'),
        h('p', null, '주민등록번호 형태는 자료를 올릴 때 기본으로 가려집니다(자료 올리기의 "주민등록번호 형태 가리기"). 그 밖의 개인정보는 가려지지 않으니 필요하면 올리기 전에 지워 주십시오.'),
        h('p', { class: 'sy-muted' }, '이 안내는 이 브라우저에서 한 번만 보여 드립니다.')
      ],
      actions: [{ label: '취소', value: false }, { label: '확인하고 계속', value: true, primary: true }]
    });
    if (ok) { A.ack = true; lsSet(LS.ack, '1'); }
    return !!ok;
  }
  function runErrText(e) {
    var code = e && e.code;
    if (SAMPLE_GONE[code]) { A.sampleDenied = true; }
    if (SAMPLE_ERR[code]) return SAMPLE_ERR[code];
    if (e && e.message) return '분석 중 문제가 생겼습니다: ' + e.message;
    if (code && SY.Pipeline && typeof SY.Pipeline.errorText === 'function') return SY.Pipeline.errorText(code);
    return '분석 중 문제가 생겼습니다: ' + errMsg(e);
  }
  function fixStmtIds(list, d) {
    var C = A.C, used = {}, num = docNum(C, d), seq = 0;
    C.statements.forEach(function (s) { if (s.docId !== d.id) used[s.id] = 1; });
    var re = new RegExp('^S' + num + '-(\\d+)$');
    list.forEach(function (s) { var m = re.exec(s.id || ''); if (m) seq = Math.max(seq, Number(m[1])); });
    return list.map(function (s) {
      if (!s.id || used[s.id]) {
        var o = Object.assign({}, s);
        o.id = 'S' + num + '-' + ('00' + (++seq)).slice(-3);
        while (used[o.id]) o.id = 'S' + num + '-' + ('00' + (++seq)).slice(-3);
        s = o;
      }
      used[s.id] = 1;
      return s;
    });
  }
  /* Pipeline.transcribe 는 doc.pages 를 직접 고치고 {done, failed} 를 돌려준다. */
  function applyTranscribe(d, r) {
    if (r && Array.isArray(r.pages)) d.pages = r.pages;
    d.pageCount = (d.pages || []).length || d.pageCount;
    if (r && Array.isArray(r.failed) && r.failed.length) {
      toast(docLabel(d) + ': ' + r.failed.length + '쪽은 옮겨 적지 못했습니다(' + r.failed.map(function (x) { return '제' + x.n + '쪽'; }).slice(0, 6).join(', ') + '). 원문 보기에서 직접 적거나 다시 실행해 주십시오.', { tone: 'error' });
    }
  }
  function mergeById(cur, add) {
    var idx = {}, out = cur.slice();
    out.forEach(function (x, i) { if (x && x.id != null) idx[x.id] = i; });
    add.forEach(function (x) { if (x && x.id != null && idx[x.id] != null) out[idx[x.id]] = x; else { idx[x && x.id] = out.length; out.push(x); } });
    return out;
  }
  function mergeExtract(d, r) {
    var C = A.C;
    var st = (r && Array.isArray(r.statements) ? r.statements : []).map(function (s) { return Object.assign({ docId: d.id }, s); });
    var rej = (r && Array.isArray(r.rejected) ? r.rejected : []).map(function (x) { return Object.assign({ docId: d.id }, x); });
    C.statements = C.statements.filter(function (s) { return s.docId !== d.id; }).concat(fixStmtIds(st, d));
    if (SY.Pipeline && typeof SY.Pipeline._sortStatements === 'function') { try { C.statements = SY.Pipeline._sortStatements(C, C.statements); } catch (e) { /* 순서만 */ } }
    C.rejected = (C.rejected || []).filter(function (x) { return x.docId !== d.id; }).concat(rej);
    if (C.progress.extractedDocIds.indexOf(d.id) < 0) C.progress.extractedDocIds.push(d.id);
    return { added: st.length, rejected: rej.length };
  }
  function mergeAddDoc(d, r) {
    var C = A.C, out = { statements: 0, changes: 0, facts: 0 };
    if (r && r.case && Array.isArray(r.case.statements)) {
      // addDocument 는 작업 사본(r.case)에 병합 결과를 담아 돌려준다(서면 객체는 공유).
      var W = r.case;
      C.statements = W.statements.slice();
      if (Array.isArray(W.changes)) C.changes = W.changes.slice();
      if (Array.isArray(W.facts)) C.facts = W.facts.slice();
      C.rejected = (C.rejected || []).filter(function (x) { return x.docId !== d.id; })
        .concat((r.rejected || []).map(function (x) { return Object.assign({ docId: d.id }, x); }));
      out.statements = (r.statements || []).length;
      out.changes = (r.changes || []).length;
      out.facts = (r.factsUpdated || []).length + (r.factsAdded || []).length;
      if (C.progress.extractedDocIds.indexOf(d.id) < 0) C.progress.extractedDocIds.push(d.id);
      return out;
    }
    if (r && typeof r === 'object') {
      if (Array.isArray(r.statements)) {
        var own = r.statements.every(function (s) { return !s.docId || s.docId === d.id; });
        if (own) out.statements = mergeExtract(d, { statements: r.statements, rejected: r.rejected || [] }).added;
        else { C.statements = mergeById(C.statements, r.statements); out.statements = r.statements.filter(function (s) { return s.docId === d.id; }).length; }
      }
      if (Array.isArray(r.changes)) { out.changes = r.changes.length; C.changes = mergeById(C.changes, r.changes); }
      if (Array.isArray(r.facts)) { out.facts = r.facts.length; C.facts = mergeById(C.facts, r.facts); }
    }
    if (out.statements === 0) out.statements = C.statements.filter(function (s) { return s.docId === d.id; }).length;
    if (C.progress.extractedDocIds.indexOf(d.id) < 0) C.progress.extractedDocIds.push(d.id);
    return out;
  }
  async function addDocAnalysis(docId) {
    var C = A.C, d = byId(C.docs)[docId];
    if (!d) return;
    if (!C.progress.issuesConfirmed) { toast('먼저 쟁점 탭에서 쟁점을 확정해 주십시오.'); return; }
    if (needsAssign(d)) { toast('먼저 "고치기"로 이 서면의 측과 분류를 정해 주십시오.'); return; }
    if (!SY.Pipeline || typeof SY.Pipeline.addDocument !== 'function') { toast('추가 분석 기능을 불러오지 못했습니다.'); return; }
    if (!(await ensureAnalyzeReady())) return;
    var ctl = new AbortController(), run = A.docRuns[docId] = { ctl: ctl, msg: '준비 중', frac: 0 };
    var prog = function (m, f) { run.msg = m || run.msg; run.frac = Number(f) || 0; fillDocList(); };
    fillDocList(); renderHeader();
    try {
      // 스캔본 쪽이 있으면 addDocument 가 먼저 옮겨 적는다(서면 객체를 직접 고침).
      var r = await SY.Pipeline.addDocument(C, docId, { signal: ctl.signal, onProgress: prog, sample: A.caps.sample });
      if (r && r.transcribed) applyTranscribe(d, r.transcribed);
      var n = mergeAddDoc(d, r);
      touch('stmts');
      var sv = await saveNow();
      if (!sv.ok && ro()) throw { code: 'read_only' };
      toast(docLabel(d) + ' 추가 분석을 마쳤습니다. 진술 ' + n.statements + '건을 검수해 주십시오.', { action: { label: '진술 보기', fn: function () { A.ui.stmt.doc = docId; setTab('stmts'); } } });
    } catch (e) {
      toast(runErrText(e), { tone: e && e.code === 'cancelled' ? '' : 'error' });
    } finally {
      delete A.docRuns[docId];
      fillDocList(); renderHeader();
      if (A.tab !== 'docs') refreshActive();
    }
  }

  /* ================= 진술 탭 ================= */
  function renderStmts(p) {
    p.innerHTML = '';
    p.appendChild(stageBar(A.C));
    A.runEl = h('div', { class: 'sy-card', id: 'sy-runpanel' });
    p.appendChild(A.runEl);
    fillRunPanel();
    A.stmtListEl = h('div', { class: 'sy-card', id: 'sy-stmtlist' });
    p.appendChild(A.stmtListEl);
    fillStmtList();
  }
  function stageOptions() {
    var C = A.C, s = stageState(C), pr = C.progress, out = [];
    if (s.ocrPending.length) {
      var pages = 0, noImg = 0;
      s.ocrPending.forEach(function (d) { var ps = pageStats(d); pages += ps.needsOcr; noImg += ps.noImage; });
      out.push({ key: 'transcribe', detail: s.ocrPending.length + '건 ' + pages + '쪽', warn: noImg ? '스캔 그림이 없는 쪽 ' + noImg + '개(새로고침 전에 올린 서면)는 옮겨 적을 수 없습니다. 자료 탭에서 그 서면을 다시 올려 주십시오.' : '' });
    }
    var exReason = s.unassigned.length ? '측·분류가 정해지지 않은 서면 ' + s.unassigned.length + '건을 자료 탭에서 정해 주십시오'
      : !pr.docsConfirmed ? '서면 확인(1단계)을 먼저 마쳐 주십시오' : !pr.issuesConfirmed ? '쟁점을 먼저 확정해 주십시오' : '';
    out.push({ key: 'extract', detail: s.notExtracted.length ? '아직 뽑지 않은 서면 ' + s.notExtracted.length + '건' : '모든 서면에서 뽑음', disabled: !!exReason || !s.notExtracted.length, reason: exReason });
    var hasSt = C.statements.length > 0 || (s.notExtracted.length > 0 && !exReason);
    var staleJ = pr.changesJudged && pr.judgedRev != null && pr.judgedRev !== pr.stmtRev;
    var staleF = pr.factsBuilt && pr.factsRev != null && pr.factsRev !== pr.stmtRev;
    out.push({ key: 'judge', detail: pr.changesJudged ? (staleJ ? '판정 뒤 진술이 바뀜(다시 실행 가능)' : '판정 ' + C.changes.length + '건 있음(다시 실행하면 바뀜)') : '쟁점별·서면 순서별 비교', disabled: !hasSt, reason: hasSt ? '' : '진술이 있어야 합니다' });
    out.push({ key: 'facts', detail: pr.factsBuilt ? (staleF ? '구성 뒤 진술이 바뀜(다시 실행 가능)' : '사실 ' + C.facts.length + '건 있음(다시 실행하면 바뀜)') : '일자·양측 서술·다툼 여부', disabled: !hasSt, reason: hasSt ? '' : '진술이 있어야 합니다' });
    out.forEach(function (o) {
      if (A.ui.runSel[o.key] === undefined) {
        A.ui.runSel[o.key] = o.key === 'transcribe' || o.key === 'extract' ? true :
          o.key === 'judge' ? (!pr.changesJudged || staleJ) : (!pr.factsBuilt || staleF);
      }
      o.checked = !o.disabled && !!A.ui.runSel[o.key];
    });
    return out;
  }
  function fallbackEstimate(keys) {
    var C = A.C, s = stageState(C), calls = 0, images = 0;
    keys.forEach(function (k) {
      if (k === 'transcribe') s.ocrPending.forEach(function (d) { var n = pageStats(d).needsOcr; images += n; calls += n; });
      if (k === 'extract') calls += s.notExtracted.length;
      if (k === 'judge') calls += Math.max(1, C.issues.length);
      if (k === 'facts') calls += Math.max(1, Math.ceil(C.statements.length / 60));
    });
    return { calls: calls, images: images, note: '대략적인 추정입니다' };
  }
  function estimateText(keys, cb) {
    if (!keys.length) { cb('실행할 단계를 골라 주십시오.'); return; }
    var r = null;
    try { if (SY.Pipeline && typeof SY.Pipeline.estimate === 'function') r = SY.Pipeline.estimate(A.C, keys); } catch (e) { r = null; }
    Promise.resolve(r).then(function (v) {
      if (!v || typeof v.calls !== 'number') v = fallbackEstimate(keys);
      var nt = String(v.note || '').replace(/^\s*예상 호출[^.]*\.\s*/, '').trim();
      if (nt && !/[.]$/.test(nt)) nt += '.';
      cb('예상 Claude 호출 약 ' + v.calls + '회' + (v.images ? '(그림 ' + v.images + '장 포함)' : '') + '.' + (nt ? ' ' + nt : '') +
        (/차감/.test(nt) ? '' : ' 호출마다 사용자의 구독 사용량이 차감됩니다.'));
    }, function () { var v = fallbackEstimate(keys); cb('예상 Claude 호출 약 ' + v.calls + '회. ' + v.note + '.'); });
  }
  function fillRunPanel() {
    var card = A.runEl; if (!card) return;
    var C = A.C, s = stageState(C), pr = C.progress;
    card.innerHTML = '';
    card.appendChild(h('h2', { class: 'sy-h2' }, '분석 실행'));
    if (A.run) { fillRunning(card); return; }
    var why = analyzeBlocker();
    if (!s.briefs.length) card.appendChild(note('', ['먼저 자료 탭에서 서면을 추가해 주십시오. ', btn('자료 탭으로', function () { setTab('docs'); }, 'sm')]));
    else if (!pr.docsConfirmed) card.appendChild(note('warn', ['1단계 서면 확인: 자료 탭에서 서면 목록(제출일·종류·제출자)을 확인해 주십시오. ', btn('자료 탭으로', function () { setTab('docs'); }, 'sm'), ro() ? null : btn('서면 확인 완료', confirmDocs, 'sm primary')]));
    if (s.briefs.length && !pr.issuesConfirmed) card.appendChild(note('warn', ['2단계 쟁점 확정: 쟁점을 확정해야 진술 추출을 시작할 수 있습니다. ', btn('쟁점 탭으로', function () { setTab('issues'); }, 'sm')]));
    if (s.done.extract && !pr.reviewConfirmed && C.statements.length && !ro()) {
      card.appendChild(note('', ['4단계 검수: 아래 진술 목록에서 쟁점·요지·인용을 확인하고, 틀린 진술은 지우거나 쟁점을 바꾼 뒤 눌러 주십시오. ', btn('검수 완료', confirmReview, 'sm primary')]));
    }
    if (A.lastRunMsg) card.appendChild(note(A.lastRunMsg.tone, A.lastRunMsg.text));
    if (why) { card.appendChild(note('', why)); }
    if (!s.briefs.length) return;
    var opts = stageOptions();
    var box = h('div', { class: 'sy-run-opts', role: 'group', 'aria-label': '실행할 단계' });
    var est = h('p', { class: 'sy-run-est', 'aria-live': 'polite' });
    var runBtn = btn('실행', startRun, 'primary', { disabled: !!why });
    function selKeys() { return RUN_ORDER.filter(function (k) { var o = opts.filter(function (x) { return x.key === k; })[0]; return o && !o.disabled && A.ui.runSel[k]; }); }
    function refreshEst() { var k = selKeys(); runBtn.disabled = !!why || !k.length; estimateText(k, function (t) { est.textContent = t; }); }
    opts.forEach(function (o) {
      var cb = h('input', { type: 'checkbox', checked: o.checked, disabled: o.disabled || !!why });
      cb.addEventListener('change', function () { A.ui.runSel[o.key] = cb.checked; refreshEst(); });
      box.appendChild(h('label', { title: o.reason || '' }, cb, RUN_LABEL[o.key], h('span', { class: 'sy-muted' }, '(' + (o.reason || o.detail) + ')')));
    });
    card.appendChild(box);
    opts.forEach(function (o) { if (o.warn) card.appendChild(note('warn', o.warn)); });
    card.appendChild(est);
    card.appendChild(h('div', { class: 'sy-row' }, runBtn, btn('중지', null, '', { disabled: true }),
      h('span', { class: 'sy-muted' }, '단계마다 멈추고 확인을 받은 뒤 다음 단계로 넘어갑니다.')));
    refreshEst();
  }
  function fillRunning(card) {
    var r = A.run;
    card.appendChild(h('p', null, h('strong', null, (r.idx + 1) + '/' + r.keys.length + ' ' + RUN_LABEL[r.keys[r.idx]]), r.pause ? ' 끝남' : ' 진행 중'));
    var bar = h('progress', { max: '1', value: String(r.pause ? 1 : (r.frac || 0)) });
    var msg = h('span', { class: 'msg' }, r.pause ? '' : (r.msg || '진행 중입니다'));
    r.barEl = bar; r.msgEl = msg;
    card.appendChild(h('div', { class: 'sy-progress' }, bar, msg));
    if (r.pause) {
      card.appendChild(h('div', { class: 'sy-pause', role: 'group', 'aria-label': '다음 단계 확인' },
        h('p', null, r.pause.text),
        h('div', { class: 'sy-row' },
          btn(r.pause.goLabel, function () { r.pause.resolve(true); }, 'primary'),
          btn('여기서 멈춤', function () { r.pause.resolve(false); }))));
    } else {
      card.appendChild(h('div', { class: 'sy-row' }, btn('실행', null, 'primary', { disabled: true }), btn('중지', function () { r.ctl.abort(); r.msg = '중지하는 중입니다'; if (r.msgEl) r.msgEl.textContent = r.msg; })));
    }
  }
  function runProgress(msg, frac) {
    var r = A.run; if (!r) return;
    if (msg) r.msg = msg;
    if (frac != null) r.frac = Math.max(0, Math.min(1, Number(frac) || 0));
    if (r.barEl && r.barEl.isConnected) { r.barEl.value = r.frac; r.msgEl.textContent = r.msg; }
  }
  function pauseBetween(prev, next) {
    return new Promise(function (resolve) {
      var t;
      if (prev === 'transcribe') t = '스캔본 옮겨 적기가 끝났습니다. 자료 탭의 "원문 보기"에서 옮겨 적은 글을 확인할 수 있습니다. 다음 단계는 ' + RUN_LABEL[next] + '입니다.';
      else if (prev === 'extract') t = '진술 추출이 끝났습니다. 아래 진술 목록에서 쟁점·요지·인용을 검수해 주십시오(4단계). 검수를 마쳤으면 다음 단계(' + RUN_LABEL[next] + ')로 넘어갑니다.';
      else if (prev === 'judge') t = '변화 판정이 끝났습니다. 변천 지도 탭에서 판정을 확인할 수 있습니다. 다음 단계는 ' + RUN_LABEL[next] + '입니다.';
      else t = RUN_LABEL[prev] + '이(가) 끝났습니다. 다음 단계는 ' + RUN_LABEL[next] + '입니다.';
      A.run.pause = {
        text: t, goLabel: prev === 'extract' ? '검수 완료하고 계속' : '계속',
        resolve: function (go) {
          A.run.pause = null;
          if (go && prev === 'extract') { A.C.progress.reviewConfirmed = true; touch('review'); }
          if (A.tab === 'stmts') { fillRunPanel(); }
          resolve(go);
        }
      };
      if (A.tab === 'stmts') { renderPanel('stmts'); } else toast(RUN_LABEL[prev] + '이(가) 끝났습니다. 진술 탭에서 확인 후 계속해 주십시오.', { action: { label: '진술 탭으로', fn: function () { setTab('stmts'); } } });
    });
  }
  async function startRun() {
    var opts = stageOptions();
    var keys = RUN_ORDER.filter(function (k) { var o = opts.filter(function (x) { return x.key === k; })[0]; return o && !o.disabled && A.ui.runSel[k]; });
    if (!keys.length) { toast('실행할 단계를 골라 주십시오.'); return; }
    if (!(await ensureAnalyzeReady())) return;
    var ctl = new AbortController();
    A.run = { ctl: ctl, keys: keys, idx: 0, msg: '시작하는 중입니다', frac: 0, pause: null };
    A.lastRunMsg = null;
    fillRunPanel(); renderHeader();
    var stopped = false;
    try {
      for (var i = 0; i < keys.length; i++) {
        if (i > 0) {
          var go = await pauseBetween(keys[i - 1], keys[i]);
          if (!go) { stopped = true; break; }
        }
        A.run.idx = i; A.run.frac = 0; A.run.msg = '';
        if (A.tab === 'stmts') fillRunPanel();
        await runStage(keys[i], ctl.signal);
        if (ctl.signal.aborted) { stopped = true; break; }
      }
      var last = keys[keys.length - 1];
      A.lastRunMsg = stopped
        ? { tone: '', text: '여기서 멈췄습니다. 끝난 단계의 결과는 저장되었습니다.' }
        : { tone: 'ok', text: '선택한 단계를 모두 마쳤습니다.' + (last === 'extract' ? ' 아래 진술 목록을 검수해 주십시오.' : last === 'facts' ? ' 연표·변천 지도·A4 별지 탭에서 결과를 볼 수 있습니다.' : '') };
    } catch (e) {
      A.lastRunMsg = { tone: e && e.code === 'cancelled' ? '' : 'flag', text: runErrText(e) };
    } finally {
      A.run = null;
      await flushSave();
      renderHeader();
      if (A.tab === 'stmts') renderPanel('stmts');
    }
  }
  async function saveOrStop() {
    var r = await saveNow();
    if (!r.ok && ro()) throw { code: 'read_only' };
  }
  async function runStage(k, signal) {
    var C = A.C, P = SY.Pipeline, i, d, r, docs;
    function opts(base, span) {
      return { signal: signal, sample: A.caps.sample, onProgress: function (m, f) { runProgress(m, base + span * Math.max(0, Math.min(1, Number(f) || 0))); } };
    }
    if (k === 'transcribe') {
      docs = stageState(C).ocrPending;
      for (i = 0; i < docs.length; i++) {
        if (signal.aborted) return;
        d = docs[i];
        runProgress(docLabel(d) + ' 옮겨 적는 중', i / docs.length);
        r = await P.transcribe(C, d.id, opts(i / docs.length, 1 / docs.length));
        applyTranscribe(d, r);
        touch('docs'); await saveOrStop();
      }
    } else if (k === 'extract') {
      docs = SY.docsInOrder(C).filter(function (x) { return isTarget(x) && C.progress.extractedDocIds.indexOf(x.id) < 0; });
      for (i = 0; i < docs.length; i++) {
        if (signal.aborted) return;
        d = docs[i];
        runProgress(docLabel(d) + ' 진술 추출 중 (' + (i + 1) + '/' + docs.length + ')', i / docs.length);
        r = await P.extractStatements(C, d.id, opts(i / docs.length, 1 / docs.length));
        mergeExtract(d, r);
        C.progress.reviewConfirmed = false;
        touch('stmts'); await saveOrStop();
        if (A.tab === 'stmts') fillStmtList();
      }
    } else if (k === 'judge') {
      runProgress('변화 판정 중', 0);
      // 전체 다시 판정: 기존 판정을 비운 사본으로 부른다(Pipeline.runAll 과 같은 방식)
      r = await P.judgeChanges(Object.assign({}, C, { changes: [] }), opts(0, 1));
      if (Array.isArray(r)) C.changes = r.slice();
      C.progress.changesJudged = true; C.progress.judgedRev = C.progress.stmtRev;
      touch('changes'); await saveOrStop();
    } else if (k === 'facts') {
      runProgress('사실 구성 중', 0);
      r = await P.buildFacts(Object.assign({}, C, { facts: [] }), opts(0, 1));
      if (Array.isArray(r)) {
        C.facts = r.slice();
        if (typeof P._linkFactIds === 'function') { var ls = P._linkFactIds(C.statements, C.facts); if (Array.isArray(ls)) C.statements = ls; }
      }
      C.progress.factsBuilt = true; C.progress.factsRev = C.progress.stmtRev;
      touch('facts'); await saveOrStop();
    }
    runProgress('끝났습니다', 1);
  }
  function confirmReview() {
    A.C.progress.reviewConfirmed = true;
    touch('review'); renderPanel('stmts');
    toast('검수를 마쳤습니다. 변화 판정과 사실 구성을 실행할 수 있습니다.');
  }

  /* --- 진술 목록 --- */
  function verifyStmt(s, d) {
    if (!d) return { ok: false, reason: 'no_doc' };
    var pt = {};
    (d.pages || []).forEach(function (pg) { pt[pg.n] = pg.text || ''; });
    try { return SY.verifyQuote(s.quote || '', pt, s.page); } catch (e) { return { ok: false, reason: 'error' }; }
  }
  function verifyBadge(v) {
    if (v.ok && v.spans) return h('span', { class: 'sy-badge ok' }, '원문 일치(쪽에 걸침)');
    if (v.ok && v.moved) return h('span', { class: 'sy-badge warn' }, '원문은 제' + v.page + '쪽에 있음');
    if (v.ok) return h('span', { class: 'sy-badge ok' }, '원문 일치');
    if (v.reason === 'no_doc') return h('span', { class: 'sy-badge flag' }, '서면 없음');
    if (v.reason === 'too_short') return h('span', { class: 'sy-badge flag' }, '인용이 너무 짧음');
    return h('span', { class: 'sy-badge flag' }, '원문에서 찾지 못함');
  }
  function fillStmtList() {
    var card = A.stmtListEl; if (!card) return;
    var C = A.C, f = A.ui.stmt, issues = byId(C.issues);
    card.innerHTML = '';
    var unc = C.statements.filter(function (s) { return !(s.issueIds || []).some(function (i) { return issues[i]; }); }).length;
    var rej = (C.rejected || []).length;
    card.appendChild(h('div', { class: 'sy-row' },
      h('h2', { class: 'sy-h2' }, '진술 목록'),
      h('span', { class: 'sy-muted' }, '전체 ' + C.statements.length + '건 · 미분류 ' + unc + '건 · 원문 대조 실패(저장 안 함) ' + rej + '건'),
      rej ? btn('대조 실패 보기', showRejected, 'sm') : null));
    if (!C.statements.length) {
      card.appendChild(h('p', { class: 'sy-muted' }, '아직 진술이 없습니다. 위 "분석 실행"에서 진술 추출을 실행하면 서면·쪽·쟁점·요지·원문 인용이 여기에 나타납니다. 원문과 대조되지 않은 인용은 저장하지 않습니다.'));
      return;
    }
    var docs = SY.docsInOrder(C);
    var fDoc = selectEl([['', '모든 서면']].concat(docs.filter(isBrief).map(function (d) { return [d.id, docLabel(d)]; })), f.doc, { 'aria-label': '서면으로 걸러 보기' });
    var fIss = selectEl([['', '모든 쟁점'], ['__unc', '미분류']].concat(C.issues.map(function (i) { return [i.id, i.id + ' ' + (i.name || '')]; })), f.issue, { 'aria-label': '쟁점으로 걸러 보기' });
    var fQ = h('input', { type: 'search', class: 'sy-input', value: f.q, placeholder: '요지·인용 검색', 'aria-label': '진술 검색' });
    var count = h('span', { class: 'sy-muted', 'aria-live': 'polite' });
    fDoc.addEventListener('change', function () { f.doc = fDoc.value; f.shown = 100; renderItems(); });
    fIss.addEventListener('change', function () { f.issue = fIss.value; f.shown = 100; renderItems(); });
    var qt = 0;
    fQ.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { f.q = fQ.value; f.shown = 100; renderItems(); }, 200); });
    card.appendChild(h('div', { class: 'sy-filters' }, fDoc, fIss, fQ, count));
    var ul = h('ul', { class: 'sy-stmts' });
    var more = h('div', { class: 'sy-more' });
    card.appendChild(ul); card.appendChild(more);
    function renderItems() {
      var order = {}; docs.forEach(function (d, i) { order[d.id] = i; });
      var q = (f.q || '').trim();
      var list = C.statements.filter(function (s) {
        if (f.doc && s.docId !== f.doc) return false;
        if (f.issue === '__unc') { if ((s.issueIds || []).some(function (i) { return issues[i]; })) return false; }
        else if (f.issue && (s.issueIds || []).indexOf(f.issue) < 0) return false;
        if (q && (String(s.gist || '') + ' ' + String(s.quote || '')).indexOf(q) < 0) return false;
        return true;
      }).sort(function (a, b) {
        return ((order[a.docId] != null ? order[a.docId] : 1e9) - (order[b.docId] != null ? order[b.docId] : 1e9)) || ((+a.page || 0) - (+b.page || 0)) ||
          String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
      });
      count.textContent = list.length + '건 표시';
      ul.innerHTML = '';
      var dm = byId(C.docs);
      list.slice(0, f.shown).forEach(function (s) { ul.appendChild(stmtItem(s, dm)); });
      more.innerHTML = '';
      if (list.length > f.shown) more.appendChild(btn('더 보기(' + (list.length - f.shown) + '건 남음)', function () { f.shown += 100; renderItems(); }, 'sm'));
    }
    A.stmtUl = ul;
    renderItems();
  }
  function stmtItem(s, dm) {
    var C = A.C, d = dm[s.docId], issues = byId(C.issues);
    var li = h('li', { class: 'sy-stmt ' + (s.side === '원고' ? 'p' : s.side === '피고' ? 'd' : ''), 'data-id': s.id });
    function redraw() { var n = stmtItem(s, byId(A.C.docs)); li.replaceWith(n); }
    li.appendChild(h('div', { class: 'sy-stmt-h' },
      h('span', { class: 'src' }, d ? docLabel(d) : '서면 없음(' + s.docId + ')'),
      s.page != null ? h('span', null, '제' + s.page + '쪽') : null,
      s.item ? h('span', null, s.item) : null,
      h('span', { class: 'sy-badge ' + (s.side === '원고' ? 'p' : s.side === '피고' ? 'd' : '') }, s.side || '측 미상'),
      verifyBadge(verifyStmt(s, d)),
      h('span', { class: 'sy-muted' }, s.id),
      h('span', { class: 'sy-spacer' }),
      ro() ? null : btn('삭제', function () { deleteStmt(s.id, li); }, 'sm ghost', { 'aria-label': s.id + ' 진술 삭제' })));
    li.appendChild(h('p', { class: 'sy-stmt-gist' }, s.gist || '(요지 없음)'));
    if (s.quote) li.appendChild(h('blockquote', { class: 'sy-stmt-q' }, s.quote));
    var foot = h('div', { class: 'sy-stmt-f' }, h('span', { class: 'sy-muted' }, '쟁점'));
    var ids = s.issueIds || [];
    if (!ids.some(function (i) { return issues[i]; })) foot.appendChild(h('span', { class: 'sy-chip unc' }, h('span', null, '미분류')));
    ids.forEach(function (iid) {
      var it = issues[iid];
      foot.appendChild(h('span', { class: 'sy-chip' }, h('span', { title: it ? it.name : '목록에 없는 쟁점' }, iid + ' ' + (it ? it.name : '(없는 쟁점)')),
        ro() ? null : h('button', { type: 'button', 'aria-label': iid + ' 쟁점 빼기', onclick: function () { s.issueIds = ids.filter(function (x) { return x !== iid; }); touch('stmts'); redraw(); } }, '빼기')));
    });
    if (!ro()) {
      var add = selectEl([['', '쟁점 더하기']].concat(C.issues.filter(function (i) { return ids.indexOf(i.id) < 0; }).map(function (i) { return [i.id, i.id + ' ' + (i.name || '')]; })), '', { class: 'sy-input sy-addissue', 'aria-label': s.id + ' 쟁점 더하기' });
      add.addEventListener('change', function () { if (!add.value) return; s.issueIds = ids.filter(function (x) { return issues[x]; }).concat([add.value]); touch('stmts'); redraw(); });
      foot.appendChild(add);
    }
    if ((s.evidence || []).length) foot.appendChild(h('span', { class: 'sy-muted' }, '증거 ' + s.evidence.map(function (e) { return SY.fmtEvidence(e); }).join(', ')));
    li.appendChild(foot);
    return li;
  }
  function deleteStmt(id, li) {
    var C = A.C, idx = -1;
    C.statements.forEach(function (s, i) { if (s.id === id) idx = i; });
    if (idx < 0) return;
    var stmt = C.statements[idx];
    var removedCh = C.changes.filter(function (c) { return c.fromId === id || c.toId === id; });
    var factPrev = [];
    C.facts.forEach(function (f) {
      ['plaintiff', 'defendant'].forEach(function (k) {
        if (f[k] && Array.isArray(f[k].stmtIds) && f[k].stmtIds.indexOf(id) >= 0) factPrev.push([f[k], f[k].stmtIds.slice()]);
      });
    });
    C.statements.splice(idx, 1);
    C.changes = C.changes.filter(function (c) { return removedCh.indexOf(c) < 0; });
    var m = {}; m[id] = 1; pruneFactLinks(m);
    touch('stmts');
    if (li) li.remove();
    toast(id + ' 진술을 지웠습니다' + (removedCh.length ? '(관련 판정 ' + removedCh.length + '건 포함)' : '') + '.', {
      action: {
        label: '되돌리기', fn: function () {
          C.statements.splice(Math.min(idx, C.statements.length), 0, stmt);
          C.changes = C.changes.concat(removedCh);
          factPrev.forEach(function (x) { x[0].stmtIds = x[1]; });
          touch('stmts');
          if (A.tab === 'stmts') fillStmtList();
        }
      }
    });
  }
  function showRejected() {
    var C = A.C, dm = byId(C.docs);
    var list = h('ul', { class: 'sy-rejlist' }, (C.rejected || []).map(function (x) {
      var d = dm[x.docId];
      return h('li', null,
        h('div', { class: 'sy-stmt-h' }, h('span', { class: 'src' }, d ? docLabel(d) : (x.docId || '')), x.page != null ? h('span', null, '제' + x.page + '쪽') : null,
          h('span', { class: 'sy-badge flag' }, REJECT_REASON[x.reason] || x.reason || '대조 실패')),
        x.gist ? h('p', { class: 'sy-stmt-gist' }, x.gist) : null,
        x.quote ? h('blockquote', { class: 'sy-stmt-q' }, x.quote) : null);
    }));
    dialog({ title: '원문 대조에 실패한 진술', wide: true, body: [h('p', { class: 'sy-muted' }, '아래 진술은 인용이 서면 원문과 맞지 않아 저장하지 않았습니다. 필요하면 원문을 확인해 직접 정리해 주십시오.'), list] });
  }

  /* ================= 연표 탭 ================= */
  function destroyTl() {
    if (A.tlCtrl && typeof A.tlCtrl.destroy === 'function') { try { A.tlCtrl.destroy(); } catch (e) { /* 무시 */ } }
    if (A.fdCtrl && typeof A.fdCtrl.destroy === 'function') { try { A.fdCtrl.destroy(); } catch (e) { /* 무시 */ } }
    A.tlCtrl = null; A.fdCtrl = null; A.fdEl = null; A.sideEl = null;
  }
  function emptyView(p, text, tab, label) {
    p.appendChild(h('div', { class: 'sy-card' }, h('p', { class: 'sy-muted' }, text), tab ? btn(label, function () { setTab(tab); }, 'sm') : null));
  }
  function renderTimeline(p) {
    destroyTl();
    p.innerHTML = '';
    var C = A.C, ui = A.ui.tl;
    if (!C.facts.length) { emptyView(p, '사실 구성 단계가 끝나면 연표가 나타납니다. 가운데 시간선 위에 다툼 없는 사실, 위쪽에 원고 주장, 아래쪽에 피고 주장이 놓입니다.', 'stmts', '진술 탭으로'); return; }
    if (!SY.Viz || typeof SY.Viz.timeline !== 'function') { p.appendChild(note('warn', '연표 기능을 불러오지 못했습니다. 새로고침해 주십시오.')); return; }
    var iss = selectEl([['', '모든 쟁점']].concat(C.issues.map(function (i) { return [i.id, i.id + ' ' + (i.name || '')]; })), ui.issueId, { 'aria-label': '쟁점으로 걸러 보기' });
    iss.addEventListener('change', function () { ui.issueId = iss.value; if (A.tlCtrl) A.tlCtrl.update({ issueId: ui.issueId || null }); });
    p.appendChild(h('div', { class: 'sy-tl-top' }, h('label', { class: 'sy-row' }, h('span', { class: 'sy-muted' }, '쟁점'), iss),
      h('span', { class: 'sy-muted' }, '척도(실제 간격·순서 등간격), 확대·축소, 기간은 연표 위 도구에서 바꿉니다.')));
    var host = h('div', { class: 'sy-tl-host' });
    var fd = h('div', { class: 'sy-fd-host' });
    var side = h('aside', { class: 'sy-tl-side', 'aria-label': '사실 상세' },
      h('div', { class: 'sy-tl-side-h' }, h('strong', null, '사실 상세'), btn('닫기', function () { selectFact(null, true); }, 'sm')), fd);
    p.appendChild(h('div', { class: 'sy-tl-layout' }, host, side));
    A.fdEl = fd; A.sideEl = side;
    try {
      A.tlCtrl = SY.Viz.timeline(host, C, {
        scale: ui.scale, issueId: ui.issueId || null, from: ui.from, to: ui.to, selectedId: ui.selectedId,
        onSelect: function (id) { selectFact(id, false); },
        onChange: function (chg) { if (chg) ['scale', 'from', 'to'].forEach(function (k) { if (k in chg) ui[k] = chg[k]; }); }
      });
    } catch (e) {
      if (root.console) console.error(e);
      host.appendChild(note('flag', '연표를 그리는 중 문제가 생겼습니다: ' + errMsg(e)));
    }
    renderDetail(ui.selectedId);
  }
  function selectFact(id, fromShell) {
    A.ui.tl.selectedId = id || null;
    if (fromShell && A.tlCtrl) { try { A.tlCtrl.select(id || null); } catch (e) { /* 무시 */ } }
    renderDetail(id);
    if (A.sideEl) A.sideEl.classList.toggle('open', !!id);
  }
  function renderDetail(id) {
    if (!A.fdEl || !SY.Viz || typeof SY.Viz.factDetail !== 'function') return;
    if (A.fdCtrl && typeof A.fdCtrl.destroy === 'function') { try { A.fdCtrl.destroy(); } catch (e) { /* 무시 */ } }
    try { A.fdCtrl = SY.Viz.factDetail(A.fdEl, A.C, id || null, {}); }
    catch (e) { A.fdEl.innerHTML = ''; A.fdEl.appendChild(note('flag', '사실 상세를 그리는 중 문제가 생겼습니다: ' + errMsg(e))); }
  }

  /* ================= 변천 지도 탭 ================= */
  function destroyMap() {
    if (A.mapCtrl && typeof A.mapCtrl.destroy === 'function') { try { A.mapCtrl.destroy(); } catch (e) { /* 무시 */ } }
    A.mapCtrl = null;
  }
  function renderMap(p) {
    destroyMap();
    p.innerHTML = '';
    var C = A.C;
    if (!C.statements.length) { emptyView(p, '진술 추출이 끝나면 쟁점(세로) × 서면(가로) 격자로 주장 변천 지도가 나타납니다.', 'stmts', '진술 탭으로'); return; }
    if (!SY.Viz || typeof SY.Viz.map !== 'function') { p.appendChild(note('warn', '변천 지도 기능을 불러오지 못했습니다. 새로고침해 주십시오.')); return; }
    if (!C.progress.changesJudged) p.appendChild(note('', '아직 변화 판정을 실행하지 않아 배지가 없습니다. 진술 탭에서 변화 판정을 실행하면 유지·변경·번복 등이 표시됩니다.'));
    var host = h('div', { class: 'sy-map-host' });
    p.appendChild(host);
    var canSave = !A.capsReady || !!A.caps.downloads;
    try {
      var mopts = {
        selected: A.ui.mapSel.slice(),
        onSelectionChange: function (ids) { A.ui.mapSel = (ids || []).slice(); }
      };
      if (canSave) {
        // Viz.map 은 Promise 거절의 code 로 취소(declined)와 실패를 나눠 안내한다.
        mopts.onExport = function (text, filename) {
          return saveFile(fileBase() + '_' + (filename || '반박재료.txt'), text).then(function (r) { if (!r.ok) throw { code: r.code }; return r; });
        };
      }
      A.mapCtrl = SY.Viz.map(host, C, mopts);
    } catch (e) {
      if (root.console) console.error(e);
      host.appendChild(note('flag', '변천 지도를 그리는 중 문제가 생겼습니다: ' + errMsg(e)));
    }
  }

  /* ================= A4 별지 탭 ================= */
  function saveA4Prefs() {
    var a = A.ui.a4;
    lsSet(LS.a4, JSON.stringify({ layout: a.layout, target: a.target, showEvidence: a.showEvidence, fontScale: a.fontScale }));
  }
  function segGroup(label, items, value, onPick) {
    var g = h('div', { class: 'sy-seg', role: 'group', 'aria-label': label });
    items.forEach(function (it) {
      g.appendChild(h('button', { type: 'button', 'aria-pressed': String(it[0] === value), 'data-v': it[0], onclick: function () {
        Array.prototype.forEach.call(g.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === it[0])); });
        onPick(it[0]);
      } }, it[1]));
    });
    return g;
  }
  function a4ModeNote() {
    var C = A.C;
    return A.ui.a4.mode === 'submit'
      ? note('ok', '제출용: 다툼 없는 사실과 우리 측(' + C.ourSide + ') 주장만 들어갑니다. 상대방 서술은 포함되지 않습니다.')
      : note('warn', '내부용: 양측 서술이 모두 들어갑니다. 서면에 그대로 넣기 전 확인하세요.');
  }
  function renderA4(p) {
    p.innerHTML = '';
    var C = A.C, ui = A.ui.a4;
    if (!C.facts.length) { emptyView(p, '사실 구성 단계가 끝나면 서면에 끼워 넣을 A4 별지 연표(흑백)를 만들 수 있습니다.', 'stmts', '진술 탭으로'); return; }
    if (!SY.Viz || typeof SY.Viz.a4 !== 'function') { p.appendChild(note('warn', 'A4 별지 기능을 불러오지 못했습니다. 새로고침해 주십시오.')); return; }
    var m = Object.assign({}, DEF_MARGINS, C.margins || {});
    var ctl = h('div', { class: 'sy-a4-ctl' });
    var view = h('div', { class: 'sy-a4-view' });
    A.a4View = view;
    // 배치
    ctl.appendChild(h('fieldset', null, h('legend', null, '배치'),
      segGroup('배치', [['S', 'S자 배치'], ['Z', 'Z자 배치']], ui.layout, function (v) { ui.layout = v; saveA4Prefs(); renderA4View(); }),
      h('p', { class: 'sy-muted' }, 'S자는 둘째 줄을 오른쪽에서 왼쪽으로 꺾어 잇고, Z자는 모든 줄을 왼쪽에서 오른쪽으로 읽습니다.')));
    // 용도
    var modeBox = h('div', { class: 'sy-a4-modenote' }, a4ModeNote());
    ctl.appendChild(h('fieldset', null, h('legend', null, '용도'),
      segGroup('용도', [['submit', '제출용'], ['internal', '내부용']], ui.mode, function (v) {
        ui.mode = v; modeBox.innerHTML = ''; modeBox.appendChild(a4ModeNote()); renderA4View();
      }), modeBox));
    // 여백
    var widthNote = h('p', { class: 'sy-muted' });
    var mIn = {};
    function mInput(k, label) {
      var inp = h('input', { class: 'sy-input', type: 'number', min: '0', max: '80', step: '1', value: String(m[k]), inputmode: 'numeric', 'aria-label': '여백 ' + label + '(mm)' });
      mIn[k] = inp;
      var t = 0;
      inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(applyMargins, 350); });
      return field(label, inp);
    }
    function applyMargins() {
      var nm = {}, bad = false;
      ['top', 'left', 'right', 'bottom'].forEach(function (k) {
        var v = Number(mIn[k].value);
        var okv = mIn[k].value !== '' && isFinite(v) && v >= 0 && v <= 80;
        mIn[k].setAttribute('aria-invalid', okv ? 'false' : 'true');
        if (!okv) bad = true; else nm[k] = v;
      });
      if (!bad && 210 - nm.left - nm.right < 80) { bad = true; mIn.left.setAttribute('aria-invalid', 'true'); mIn.right.setAttribute('aria-invalid', 'true'); }
      if (bad) { widthNote.textContent = '여백은 0~80mm, 본문 폭은 80mm 이상이어야 합니다.'; return; }
      C.margins = nm;
      widthNote.textContent = '본문 폭 ' + (210 - nm.left - nm.right) + 'mm. 아래 여백 20mm 는 프로그램 기본값입니다(법정 수치 아님).';
      if (!ro()) touch('meta');
      renderA4View();
    }
    widthNote.textContent = '본문 폭 ' + (210 - m.left - m.right) + 'mm. 아래 여백 20mm 는 프로그램 기본값입니다(법정 수치 아님).';
    ctl.appendChild(h('fieldset', null, h('legend', null, '여백(mm)'),
      h('div', { class: 'sy-margins' }, mInput('top', '위'), mInput('left', '왼쪽'), mInput('right', '오른쪽'), mInput('bottom', '아래')), widthNote));
    // 범위
    var iss = selectEl([['', '모든 쟁점']].concat(C.issues.map(function (i) { return [i.id, i.id + ' ' + (i.name || '')]; })), ui.issueId, { 'aria-label': '쟁점' });
    iss.addEventListener('change', function () { ui.issueId = iss.value; ui.page = 0; renderA4View(); });
    var from = h('input', { class: 'sy-input', type: 'date', value: ui.from, 'aria-label': '시작일' });
    var to = h('input', { class: 'sy-input', type: 'date', value: ui.to, 'aria-label': '종료일' });
    from.addEventListener('change', function () { ui.from = from.value; ui.page = 0; renderA4View(); });
    to.addEventListener('change', function () { ui.to = to.value; ui.page = 0; renderA4View(); });
    ctl.appendChild(h('fieldset', null, h('legend', null, '범위'), field('쟁점', iss), h('div', { class: 'sy-grid2' }, field('시작일', from), field('종료일', to))));
    // 표시
    var ev = h('input', { type: 'checkbox', checked: ui.showEvidence });
    ev.addEventListener('change', function () { ui.showEvidence = ev.checked; saveA4Prefs(); renderA4View(); });
    var fs = selectEl([['0.9', '작게'], ['1', '보통'], ['1.15', '크게'], ['1.3', '아주 크게']], String(ui.fontScale), { 'aria-label': '글자 크기' });
    fs.addEventListener('change', function () { ui.fontScale = Number(fs.value) || 1; saveA4Prefs(); renderA4View(); });
    ctl.appendChild(h('fieldset', null, h('legend', null, '표시'),
      h('label', { class: 'sy-row' }, ev, '증거번호 표시'), field('글자 크기', fs)));
    // 저장
    var dlOk = !A.capsReady || !!A.caps.downloads;
    var scope = selectEl([['current', '현재 쪽'], ['all', '전체 쪽']], ui.scope, { 'aria-label': '저장 범위' });
    scope.addEventListener('change', function () { ui.scope = scope.value; });
    var target = selectEl([['sheet', '별지 한 장(A4, 여백 포함)'], ['figure', '그림만(본문 폭)']], ui.target, { 'aria-label': '저장 대상' });
    target.addEventListener('change', function () { ui.target = target.value; saveA4Prefs(); renderA4View(); });
    var bPng = btn('PNG 저장', function () { saveA4('png'); }, 'primary', { disabled: !dlOk, 'data-a4save': 'png' });
    var bSvg = btn('SVG 저장', function () { saveA4('svg'); }, '', { disabled: !dlOk, 'data-a4save': 'svg' });
    ctl.appendChild(h('fieldset', null, h('legend', null, '저장'),
      h('div', { class: 'sy-grid2' }, field('범위', scope), field('대상', target)),
      h('div', { class: 'sy-row', style: 'margin-top:8px' }, bPng, bSvg),
      dlOk ? h('p', { class: 'sy-muted' }, 'PNG 는 300dpi 로 만듭니다. 전체 쪽은 zip 파일 하나로 저장합니다.') : note('', '이 화면에서는 파일 저장을 쓸 수 없습니다.')));
    p.appendChild(h('div', { class: 'sy-a4' }, ctl, view));
    renderA4View();
  }
  function a4Opts() {
    var ui = A.ui.a4, C = A.C;
    return {
      layout: ui.layout, mode: ui.mode, margins: Object.assign({}, DEF_MARGINS, C.margins || {}),
      issueId: ui.issueId || null, from: ui.from || null, to: ui.to || null,
      showEvidence: !!ui.showEvidence, fontScale: ui.fontScale || 1, figureHeight: 'content'
    };
  }
  function renderA4View() {
    var view = A.a4View; if (!view) return;
    var ui = A.ui.a4;
    view.innerHTML = '';
    var res;
    try { res = SY.Viz.a4(A.C, a4Opts()); }
    catch (e) { A.a4res = null; view.appendChild(note('flag', 'A4 별지를 만드는 중 문제가 생겼습니다: ' + errMsg(e))); return; }
    A.a4res = res;
    var pages = (res && res.pages) || [];
    if (!pages.length) { view.appendChild(note('', '조건에 맞는 사실이 없습니다. 쟁점·기간 범위를 확인해 주십시오.')); return; }
    if (ui.page >= pages.length) ui.page = pages.length - 1;
    if (ui.page < 0) ui.page = 0;
    var pg = pages[ui.page];
    view.appendChild(h('div', { class: 'sy-pager', role: 'group', 'aria-label': '쪽 넘기기' },
      btn('이전 쪽', function () { ui.page--; renderA4View(); }, 'sm', { disabled: ui.page === 0 }),
      h('span', { class: 'lbl', 'aria-live': 'polite' }, (ui.page + 1) + ' / ' + pages.length + '쪽' + (pg.rangeLabel ? ' · ' + pg.rangeLabel : '')),
      btn('다음 쪽', function () { ui.page++; renderA4View(); }, 'sm', { disabled: ui.page >= pages.length - 1 })));
    var paper = h('div', { class: 'sy-paper', role: 'img', 'aria-label': 'A4 별지 ' + (ui.page + 1) + '쪽 미리보기' });
    paper.innerHTML = ui.target === 'figure' ? pg.figure : pg.sheet;
    view.appendChild(paper);
    if ((res.warnings || []).length) {
      view.appendChild(note('warn', [h('strong', null, '확인할 점 '), h('ul', null, res.warnings.map(function (w) { return h('li', null, typeof w === 'string' ? w : (w && (w.text || w.message)) || String(w)); }))]));
    }
  }
  async function saveA4(fmt) {
    var res = A.a4res, ui = A.ui.a4;
    if (!res || !res.pages || !res.pages.length) return;
    var btns = D.querySelectorAll('[data-a4save]');
    Array.prototype.forEach.call(btns, function (b) { b.disabled = true; });
    var modeLabel = ui.mode === 'submit' ? '제출용' : '내부용';
    var idxs = ui.scope === 'all' ? res.pages.map(function (x, i) { return i; }) : [ui.page];
    var files = [];
    try {
      for (var k = 0; k < idxs.length; k++) {
        var i = idxs[k], pg = res.pages[i];
        var svg = ui.target === 'figure' ? pg.figure : pg.sheet;
        var size = ui.target === 'figure' ? { widthMm: pg.widthMm, heightMm: pg.heightMm } : { widthMm: res.sheetWidthMm || 210, heightMm: res.sheetHeightMm || 297 };
        var name = fileBase() + '_별지_' + ui.layout + '자_' + modeLabel + (ui.target === 'figure' ? '_그림' : '') + '_' + (i + 1) + '쪽.' + fmt;
        var data = fmt === 'png'
          ? await SY.Viz.toPngBlob(svg, Object.assign({ dpi: 300 }, size))
          : '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
        files.push({ name: name, data: data });
      }
    } catch (e) {
      toast('그림 파일을 만들지 못했습니다: ' + errMsg(e), { tone: 'error' });
      Array.prototype.forEach.call(btns, function (b) { b.disabled = false; });
      return;
    }
    try {
      if (files.length === 1) await saveFile(files[0].name, files[0].data);
      else if (root.JSZip) {
        var zip = new root.JSZip();
        files.forEach(function (f) { zip.file(f.name, f.data); });
        var blob = await zip.generateAsync({ type: 'blob' });
        await saveFile(fileBase() + '_별지_' + ui.layout + '자_' + modeLabel + '_전체' + files.length + '쪽_' + fmt + '.zip', blob);
      } else {
        for (var j = 0; j < files.length; j++) {
          var r = await saveFile(files[j].name, files[j].data);
          if (!r.ok) break;
        }
      }
    } finally {
      Array.prototype.forEach.call(D.querySelectorAll('[data-a4save]'), function (b) { b.disabled = A.capsReady && !A.caps.downloads; });
    }
  }

  /* ================= 파일 저장 ================= */
  var DL_MSG = {
    declined: '저장을 취소했습니다.',
    rate_limited: '이미 열린 저장 확인 창이 있습니다. 그 창을 닫은 뒤 다시 시도해 주십시오.',
    rejected_extension: '이 형식은 저장할 수 없습니다.',
    extension_not_enabled: '이 화면에서는 이 형식을 저장할 수 없습니다.',
    too_large: '파일이 너무 큽니다. 한 쪽씩 저장해 주십시오.',
    bad_request: '파일을 만들지 못했습니다(잘못된 요청).',
    transform_error: '파일을 만들지 못했습니다.',
    request_unknown: '저장 요청이 만료되었습니다.'
  };
  async function saveFile(filename, data) {
    var name = safeFileName(filename);
    var dl = A.caps.downloads;
    if (dl === undefined) {
      var cl = root.claude;
      try { dl = cl && typeof cl.use === 'function' ? await cl.use('downloads') : null; } catch (e) { dl = null; }
      A.caps.downloads = dl;
    }
    if (!dl) { toast('이 화면에서는 파일 저장을 쓸 수 없습니다.', { tone: 'error' }); return { ok: false, code: 'unavailable' }; }
    try {
      var r = await dl.save({ filename: name, data: data });
      if (!r || r.status !== 'delivered') toast('"' + name + '" 저장을 요청했습니다.');
      return { ok: true, status: r && r.status };
    } catch (e) {
      var code = (e && e.code) || 'unavailable';
      if (DL_MSG[code]) toast(DL_MSG[code], { tone: code === 'declined' ? '' : 'error' });
      else {
        // unavailable, not_granted, capability_* 와 모르는 코드: 이 화면에서 저장 기능을 숨긴다
        A.caps.downloads = null;
        toast('이 화면에서는 파일 저장을 쓸 수 없습니다.', { tone: 'error' });
        if (A.tab === 'a4' || A.tab === 'map') setTimeout(refreshActive, 0);
      }
      return { ok: false, code: code };
    }
  }

  var RENDER = { docs: renderDocs, issues: renderIssues, stmts: renderStmts, timeline: renderTimeline, map: renderMap, a4: renderA4 };

  /* ================= 시작 ================= */
  async function start() {
    if (A.started) return readyP;
    A.started = true;
    var nb = $('#sy-new-case'), sel = $('#sy-case-select');
    if (!nb || !sel) { readyResolve(); return readyP; }
    nb.addEventListener('click', newCase);
    sel.addEventListener('change', function () { var id = sel.value; if (id && (!A.C || id !== A.C.id)) openCase(id); });
    root.addEventListener('pagehide', function () { if ((A.save.timer || A.save.dirty) && A.C && !ro()) saveNow(); });
    var capsP = detectCaps().then(function () {
      renderNotices();
      if (!A.C) { if (A.ready) renderEmpty(); }
      else if (A.tab !== 'timeline') refreshActive();
    });
    try { A.st = await SY.Store.init(); }
    catch (e) { A.st = { mode: 'local', canWrite: false, persistent: false, reason: 'error' }; toast('저장소를 열지 못했습니다: ' + errMsg(e), { tone: 'error' }); }
    SY.Store.onStatus(function (st) {
      var was = ro();
      A.st = st; renderNotices(); renderHeader();
      if (was !== ro()) { if (ro()) setSaveState('읽기 전용: 바꾼 내용은 저장되지 않습니다', 'warn'); if (A.C) refreshActive(); else renderEmpty(); }
    });
    A.ready = true;
    await refreshCases();
    var last = lsGet(LS.last);
    var pick = A.cases.filter(function (c) { return c.id === last; })[0] || A.cases[0];
    if (pick) await openCase(pick.id);
    else { renderHeader(); renderNotices(); renderEmpty(); }
    if (ro()) setSaveState('읽기 전용', 'warn');
    await capsP;
    readyResolve();
    return readyP;
  }

  SY.App = {
    ready: readyP,
    start: start,
    saveFile: saveFile,
    getCase: function () { return A.C; },
    openCase: openCase,
    refreshCases: async function () { await refreshCases(); renderHeader(); if (!A.C && A.cases.length) await openCase(A.cases[0].id); else if (!A.C) renderEmpty(); },
    setTab: setTab,
    currentTab: function () { return A.tab; },
    saveNow: saveNow,
    markChanged: function (kind) { touch(kind || 'meta'); refreshActive(); },
    selectFact: function (id) { selectFact(id, true); },
    status: function () { return { store: A.st, caps: { sample: !!A.caps.sample, downloads: !!A.caps.downloads, mcp: !!A.caps.mcp, assets: !!A.caps.assets }, capsReady: A.capsReady, readOnly: ro(), running: busy() }; }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);
})(typeof window !== 'undefined' ? window : globalThis);
