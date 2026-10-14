/* 사건 연표 - 주장 변천 지도 (담당: 변천 지도)
   공개 API (설계서 4.1)
     SY.Viz.map(el, C, opts) -> ctrl
       opts: { onExport(text, filename), selected?: [changeId], onSelectionChange?(ids) }
       ctrl: { update(partialOpts), setCase(C), open(changeId), close(), getSelected(), setSelected(ids), destroy() }
     SY.Viz.rebuttalText(C, changeIds[]) -> string   (순수 텍스트, 마크다운·HTML 없음)
   시험용 보조: SY.Viz.map.model(C) -> 격자 데이터(행·열·칸·배지 위치). 화면과 단위 시험이 같은 계산을 쓴다.
   정의 시점에는 common.js 를 참조하지 않는다(사용 시점에 SY.* 사용). */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};
  var Viz = SY.Viz = SY.Viz || {};

  var UNC = '__unc';                      // 미분류 행 id
  var VISIBLE_MAX = 3;                    // 칸에 기본으로 보이는 진술 수
  var CANDIDATE = { '변경': 1, '번복': 1, '철회': 1, '모순': 1, '자백후보': 1, '미반복': 1 };
  var CROSS_NOTE = '후보이며 변론조서로 진술 여부 확인 필요';
  var REVIEW_HEAD = '※ 검토 필요 표시된 항목은 원문 대조 후 사용하십시오.';
  var MEMO_HEAD = '검토 메모 (내부 확인용입니다. 서면에 그대로 붙여 넣지 마십시오.)';
  var DEFS = {
    '유지': '같은 취지 반복', '보충': '앞 진술에 사실·근거를 덧붙임',
    '변경': '같은 사실에 대한 서술이 일부 달라짐(일자, 금액, 표현, 주체 등)', '번복': '앞 진술과 정반대 취지로 바뀜',
    '철회': '명시적으로 거두어들임', '모순': '같은 편의 두 진술이 양립하지 않음',
    '자백후보': '상대 주장 사실을 인정하는 취지의 기재(후보)', '미반복': '앞서 주장했으나 후속 서면에서 다루지 않음(철회 아님)'
  };

  /* ---------- 작은 도우미 ---------- */
  function esc(s) { return SY.esc(s); }
  function natCmp(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }
  function isCross(ch) { return !!ch && (ch.scope === 'cross' || ch.type === '자백후보'); }
  function isTakeable(ch) { return !!ch && (CANDIDATE[ch.type] === 1 || isCross(ch)); }
  function level(ch) { var l = SY.REL && SY.REL.level ? SY.REL.level[ch.type] : null; return l == null ? 0 : l; }
  function pageNo(p) {
    if (p == null || p === '') return null;
    var n = Number(p);
    return isFinite(n) && n > 0 ? n : null;
  }
  /* 주제 조사: 받침 있으면 '은', 없으면 '는' ('원고는', '피고는') */
  function topicOf(side) {
    var s = String(side || '').trim() || '당사자';
    var c = s.charCodeAt(s.length - 1);
    var batchim = c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0;
    return s + (batchim ? '은' : '는');
  }
  function docLabel(doc) {
    if (!doc) return '서면';
    var kind = doc.kind || '서면';
    if (doc.filedDate && SY.date.fmtKo(doc.filedDate, 'day')) return SY.docName({ filedDate: doc.filedDate, kind: kind });
    return String(doc.kind || doc.fileName || doc.id || '서면');
  }
  function at(doc, page) { var n = pageNo(page); return docLabel(doc) + (n ? ' 제' + n + '쪽' : ''); }
  function atTo(fromDoc, toDoc, page) {
    var n = pageNo(page);
    var name = fromDoc && toDoc && fromDoc.id === toDoc.id ? '같은 서면' : docLabel(toDoc);
    return name + (n ? ' 제' + n + '쪽' : '');
  }
  function sideCls(side) { return side === '원고' ? 'sp' : side === '피고' ? 'sd' : 'sx'; }
  function normQ(s) { return String(s || '').normalize('NFC').replace(/\s+/g, '').toLowerCase(); }

  /* ---------- 격자 데이터 ---------- */
  function buildModel(C) {
    C = C || {};
    var docs = SY.docsInOrder({ docs: (C.docs || []).filter(function (d) { return d && d.id; }) });
    var docsById = SY.byId(docs), docIdx = {};
    docs.forEach(function (d, i) { docIdx[d.id] = i; });
    var rows = [], rowsById = {};
    (C.issues || []).forEach(function (it) {
      if (!it || !it.id || rowsById[it.id] || it.id === UNC) return;
      var r = { id: it.id, name: it.name || it.id, elements: it.elements || '', unc: false, cells: {} };
      rows.push(r); rowsById[it.id] = r;
    });
    var unc = { id: UNC, name: '미분류', elements: '쟁점이 지정되지 않은 진술', unc: true, cells: {} };
    function cellOf(row, docId) {
      return row.cells[docId] || (row.cells[docId] = { rowId: row.id, docId: docId, stmts: [], changes: [], byStmt: {}, loose: [], outs: [] });
    }
    var stmtsById = {}, stmtRows = {}, unknownIssueRefs = 0, noDoc = [], stmtCount = 0;
    (C.statements || []).forEach(function (s) {
      if (!s || !s.id) return;
      stmtsById[s.id] = s;
      if (!docsById[s.docId]) { noDoc.push(s.id); return; }
      var ids = [], raw = Array.isArray(s.issueIds) ? s.issueIds : [];
      raw.forEach(function (id) {
        if (rowsById[id]) { if (ids.indexOf(id) < 0) ids.push(id); } else unknownIssueRefs++;
      });
      var rowIds = ids.length ? ids : [UNC];
      stmtRows[s.id] = rowIds;
      stmtCount++;
      rowIds.forEach(function (rid) { cellOf(rid === UNC ? unc : rowsById[rid], s.docId).stmts.push(s); });
    });
    rowsById[UNC] = unc;

    /* 배지 위치: toId 진술의 칸(쟁점은 change.issueId 우선). 미반복은 toId:null 이고 (issueId, toDocId) 칸(설계서 3.5).
       toDocId 가 없는 옛 자료의 미반복은 앞 진술 칸에 둔다(atFrom). */
    var changes = [], changesById = {}, placement = {}, fromCell = {}, orphans = [], typeCounts = {}, reviewCount = 0;
    (C.changes || []).forEach(function (ch) {
      if (!ch || !ch.id || changesById[ch.id]) return;
      changesById[ch.id] = ch;
      var to = ch.toId ? stmtsById[ch.toId] : null, from = ch.fromId ? stmtsById[ch.fromId] : null;
      var anchor = null, atFrom = false, loose = false, rid = null, docId = null;
      if (to && stmtRows[to.id]) {
        anchor = to;
      } else if (!ch.toId && ch.toDocId && docsById[ch.toDocId] && ((rowsById[ch.issueId] && ch.issueId !== UNC) || (from && stmtRows[from.id]))) {
        loose = true;
        docId = ch.toDocId;
        rid = rowsById[ch.issueId] && ch.issueId !== UNC ? ch.issueId : stmtRows[from.id][0];
      } else if (!ch.toId && from && stmtRows[from.id]) {
        anchor = from; atFrom = true;
      }
      if (!anchor && !loose) { orphans.push(ch.id); return; }
      if (anchor) {
        var rs = stmtRows[anchor.id];
        rid = rs.indexOf(ch.issueId) >= 0 ? ch.issueId : rs[0];
        docId = anchor.docId;
      }
      var cell = cellOf(rowsById[rid], docId);
      cell.changes.push(ch);
      if (anchor) (cell.byStmt[anchor.id] = cell.byStmt[anchor.id] || []).push(ch);
      else cell.loose.push(ch);
      placement[ch.id] = { rowId: rid, docId: docId, stmtId: anchor ? anchor.id : null, atFrom: atFrom, loose: loose };
      if (from && stmtRows[from.id] && !atFrom) {
        var frs = stmtRows[from.id];
        var frid = frs.indexOf(rid) >= 0 ? rid : (frs.indexOf(ch.issueId) >= 0 ? ch.issueId : frs[0]);
        fromCell[ch.id] = { rowId: frid, docId: from.docId, stmtId: from.id };
        cellOf(rowsById[frid], from.docId).outs.push(ch);
      }
      changes.push(ch);
      typeCounts[ch.type] = (typeCounts[ch.type] || 0) + 1;
      if (ch.review === true) reviewCount++;
    });
    if (Object.keys(unc.cells).length) rows.push(unc);
    var srt = function (a, b) { return level(b) - level(a) || natCmp(a.id, b.id); };
    rows.forEach(function (r) {
      Object.keys(r.cells).forEach(function (k) {
        var c = r.cells[k];
        c.stmts.sort(function (a, b) {
          var pa = pageNo(a.page), pb = pageNo(b.page);
          if (pa !== pb) return (pa == null ? 1e9 : pa) - (pb == null ? 1e9 : pb);
          return natCmp(a.id, b.id);
        });
        c.changes.sort(srt);
        c.loose.sort(srt);
        Object.keys(c.byStmt).forEach(function (sid) { c.byStmt[sid].sort(srt); });
      });
    });
    return {
      docs: docs, docsById: docsById, docIdx: docIdx, rows: rows, rowsById: rowsById,
      stmtsById: stmtsById, stmtRows: stmtRows, stmtCount: stmtCount,
      changes: changes, changesById: changesById, placement: placement, fromCell: fromCell,
      orphans: orphans, noDoc: noDoc, unknownIssueRefs: unknownIssueRefs,
      typeCounts: typeCounts, reviewCount: reviewCount,
      issueCount: rows.filter(function (r) { return !r.unc; }).length,
      hasUnclassified: rows.length > 0 && rows[rows.length - 1].unc === true
    };
  }

  /* ---------- 반박 재료 문형 ---------- */
  /* 미반복은 to 진술이 없고 toDoc 은 change.toDocId 의 서면(없으면 null → '이후 제출한 서면') */
  function sentenceOf(ch, from, fromDoc, to, toDoc) {
    var q = SY.quotative;
    if (isCross(ch)) {
      return '[검토 메모] ' + topicOf(to.side || toDoc.side) + ' ' + at(toDoc, to.page) + '에서 ' + q(to.gist) +
        ' 기재하여 상대방 주장(' + at(fromDoc, from.page) + ')을 인정하는 취지로 보이나, 해당 서면이 변론기일에 진술되었는지 변론조서로 확인하지 않았으므로 자백 여부는 검토가 필요함.';
    }
    var head = topicOf(from.side || fromDoc.side) + ' ' + at(fromDoc, from.page) + '에서 ' + q(from.gist) + ' ';
    switch (ch.type) {
      case '변경':
      case '번복':
        return head + '주장하였다가, ' + atTo(fromDoc, toDoc, to.page) + '에서는 ' + q(to.gist) + ' 주장하였습니다.';
      case '모순':
        return head + '주장하면서도, ' + atTo(fromDoc, toDoc, to.page) + '에서는 ' + q(to.gist) + ' 주장하였습니다.';
      case '철회':
        return head + '주장하였으나, ' + atTo(fromDoc, toDoc, to.page) + '에서 이를 철회하였습니다.';
      case '미반복':
        return head + '주장하였으나, ' + (toDoc && !(fromDoc && toDoc.id === fromDoc.id) ? docLabel(toDoc) : '이후 제출한 서면') +
          '에서는 이에 관하여 아무런 언급을 하지 않고 있습니다.';
    }
    return null;
  }

  function rebuttalText(C, changeIds) {
    C = C || {};
    var ids = Array.isArray(changeIds) ? changeIds : (changeIds == null ? [] : [changeIds]);
    if (!ids.length) return '';
    var chById = SY.byId(C.changes), stById = SY.byId(C.statements), docById = SY.byId(C.docs);
    var docOrder = {}; SY.docsInOrder({ docs: (C.docs || []).filter(Boolean) }).forEach(function (d, i) { docOrder[d.id] = i; });
    var issueIdx = {}, issueName = {};
    (C.issues || []).forEach(function (it, i) { if (it && it.id && issueIdx[it.id] == null) { issueIdx[it.id] = i; issueName[it.id] = it.name || it.id; } });
    var seen = {}, items = [], skipped = 0;
    ids.forEach(function (id, n) {
      id = String(id);
      if (seen[id]) return;
      seen[id] = 1;
      var ch = chById[id];
      if (!ch) { skipped++; return; }
      if (!isTakeable(ch)) return;                       // 유지·보충 등은 반박 재료 후보가 아니다
      var cross = isCross(ch);
      var omit = !cross && ch.type === '미반복';
      var from = stById[ch.fromId], to = !omit && ch.toId ? stById[ch.toId] : null;
      var fromDoc = from && docById[from.docId];
      var toDoc = omit ? (ch.toDocId ? docById[ch.toDocId] || null : null) : (to && docById[to.docId]);
      if (!from || !fromDoc || !from.gist || (!omit && (!to || !toDoc || !to.gist))) { skipped++; return; }
      var line = sentenceOf(ch, from, fromDoc, to, toDoc);
      if (!line) { skipped++; return; }
      if (ch.review === true) line += ' (검토 필요)';
      var iid = ch.issueId != null && issueIdx[ch.issueId] != null ? ch.issueId : null;
      if (!iid) {
        [].concat((to && to.issueIds) || [], from.issueIds || []).some(function (x) { if (issueIdx[x] != null) { iid = x; return true; } return false; });
      }
      var anchorDoc = to ? to.docId : (toDoc ? toDoc.id : from.docId), anchorPage = to ? to.page : (toDoc ? null : from.page);
      items.push({
        line: line, cross: cross, review: ch.review === true, issue: iid || UNC,
        k1: iid ? issueIdx[iid] : 1e6, k2: docOrder[anchorDoc] != null ? docOrder[anchorDoc] : 1e6,
        k3: pageNo(anchorPage) || 0, k4: n
      });
    });
    if (!items.length && !skipped) return '';
    items.sort(function (a, b) { return a.k1 - b.k1 || a.k2 - b.k2 || a.k3 - b.k3 || a.k4 - b.k4; });
    var out = ['반박 재료' + (C.title ? ' - ' + C.title : '') + (C.caseNo ? ' (' + C.caseNo + ')' : '')];
    if (items.some(function (x) { return x.review; })) out.push(REVIEW_HEAD);
    if (skipped) out.push('※ 연결된 진술이나 서면을 찾지 못한 판정 ' + skipped + '건은 제외하였습니다.');
    var main = items.filter(function (x) { return !x.cross; }), memo = items.filter(function (x) { return x.cross; });
    var cur = null;
    main.forEach(function (x) {
      if (x.issue !== cur) { cur = x.issue; out.push(''); out.push('[쟁점] ' + (x.issue === UNC ? '미분류' : issueName[x.issue])); }
      out.push(x.line);
    });
    if (memo.length) {
      out.push('');
      out.push(MEMO_HEAD);
      memo.forEach(function (x) { out.push(x.line); });
    }
    return out.join('\n');
  }

  /* ---------- 화면 ---------- */
  function map(el, C, opts) {
    if (!el || !el.ownerDocument) throw new Error('SY.Viz.map: 붙일 요소(el)가 필요합니다.');
    if (el.__syMap && typeof el.__syMap.destroy === 'function') el.__syMap.destroy();
    var doc = el.ownerDocument, win = doc.defaultView || root;
    var o = Object.assign({}, opts || {});
    var uid = SY.uid('mp');
    var S = {
      C: C || {}, m: null, side: '전체', types: null, reviewOnly: false, query: '',
      sel: new Set((o.selected || []).map(String)), open: new Set(),
      dw: null, trigger: null, preview: false, msgTimer: 0, qTimer: 0, alive: true
    };
    var rootEl = doc.createElement('div');
    rootEl.className = 'sy-map';
    el.innerHTML = '';
    el.appendChild(rootEl);

    function $(sel) { return rootEl.querySelector(sel); }
    function $$(sel) { return Array.prototype.slice.call(rootEl.querySelectorAll(sel)); }
    function cssEsc(s) { return win.CSS && win.CSS.escape ? win.CSS.escape(String(s)) : String(s).replace(/["\\\]\[]/g, '\\$&'); }
    function key(rowId, docId) { return rowId + '|' + docId; }
    function allTypes() {
      var t = (SY.REL.types || []).slice();
      Object.keys(S.m.typeCounts).forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); });
      return t;
    }
    function ourLabel(side) {
      var our = S.C.ourSide;
      if (!our || SY.SIDES.indexOf(our) < 0 || SY.SIDES.indexOf(side) < 0) return '';
      return side === our ? '우리 측' : '상대방';
    }

    /* ----- 데이터 다시 읽기 ----- */
    function rebuild() {
      S.m = buildModel(S.C);
      if (!S.types) S.types = new Set(allTypes());
      else allTypes().forEach(function (t) { if (!(t in (S.knownTypes || {}))) S.types.add(t); });
      S.knownTypes = {}; allTypes().forEach(function (t) { S.knownTypes[t] = 1; });
      var before = S.sel.size;
      S.sel.forEach(function (id) { if (!isTakeable(S.m.changesById[id]) || !S.m.placement[id]) S.sel.delete(id); });
      if (S.dw && !(S.m.rowsById[S.dw.rowId] && S.m.rowsById[S.dw.rowId].cells[S.dw.docId])) S.dw = null;
      renderAll();
      if (before !== S.sel.size) notifySel();
    }

    /* ----- 빈 상태 ----- */
    function emptyHtml() {
      var nd = S.m.docs.length;
      var legend = SY.REL.types.map(function (t) {
        return '<li><span class="rel ' + SY.REL.css[t] + '"><span aria-hidden="true">' + esc(SY.REL.glyph[t]) + '</span> ' + esc(t) + '</span> <span class="mp-def">' + esc(DEFS[t] || '') + '</span></li>';
      }).join('');
      return '<section class="mp-empty-state" aria-labelledby="' + uid + '-et">' +
        '<h3 id="' + uid + '-et" class="mp-h">주장 변천 지도가 아직 비어 있습니다</h3>' +
        '<p>' + (nd ? '서면 ' + nd + '건이 있으나 아직 추출된 진술이 없습니다. ' : '아직 올린 서면이 없습니다. ') +
        '“자료”에서 서면을 올리고, “쟁점”을 확정한 뒤 “진술”에서 진술 추출과 변화 판정을 마치면 이곳에 다음이 나타납니다.</p>' +
        '<ul class="mp-empty-list">' +
        '<li>세로는 쟁점, 가로는 서면(제출일 순)인 격자. 칸마다 그 서면이 그 쟁점에 관하여 한 진술의 요지와 쪽수가 들어갑니다.</li>' +
        '<li>앞 서면과 비교한 변화 판정 배지. 배지를 누르면 앞·뒤 진술의 원문 인용을 나란히 비교합니다.</li>' +
        '<li>변경·번복·철회·모순·미반복·자백후보 판정을 골라 반박 재료 문장으로 복사하거나 파일로 저장하는 기능.</li>' +
        '</ul>' +
        '<h4 class="mp-h4">배지 읽는 법</h4><ul class="mp-legend">' + legend + '</ul>' +
        '<p class="mp-muted">자백후보는 상대 주장을 인정하는 취지의 기재일 뿐이며, 변론기일에 진술된 서면인지 변론조서로 확인해야 합니다.</p>' +
        '</section>';
    }

    /* ----- 전체 골격 ----- */
    function renderAll() {
      if (!S.m.stmtCount) { rootEl.innerHTML = emptyHtml(); return; }
      var sideName = uid + '-side';
      rootEl.innerHTML =
        '<div class="mp-top">' +
          '<p class="mp-sum" id="' + uid + '-sum"></p>' +
          '<div class="mp-filters">' +
            '<fieldset class="mp-seg"><legend class="mp-sr">측</legend>' +
              ['전체', '원고', '피고'].map(function (v) {
                return '<label><input type="radio" name="' + sideName + '" value="' + v + '"' + (S.side === v ? ' checked' : '') + '><span>' + v + '</span></label>';
              }).join('') +
            '</fieldset>' +
            (S.m.changes.length ? '<label class="mp-chk"><input type="checkbox" class="mp-revonly"' + (S.reviewOnly ? ' checked' : '') + '> 검토 필요만</label>' : '') +
            '<label class="mp-search"><span class="mp-sr">쟁점 검색</span><input type="search" class="mp-q" placeholder="쟁점 검색" value="' + esc(S.query) + '" autocomplete="off"></label>' +
          '</div>' +
          '<div class="mp-chips" role="group" aria-label="변화 유형 걸러 보기"' + (S.m.changes.length ? '' : ' hidden') + '></div>' +
        '</div>' +
        '<div class="mp-notes"></div>' +
        '<div class="mp-body">' +
          '<div class="mp-scroll" role="region" aria-label="주장 변천 지도 격자" tabindex="0"></div>' +
          '<div class="mp-scrim" hidden data-act="close"></div>' +
          '<aside class="mp-dw" hidden aria-label="비교 서랍"></aside>' +
        '</div>' +
        '<div class="mp-bar" role="region" aria-label="반박 재료 담기"></div>';
      renderChips();
      renderNotes();
      renderGrid();
      renderBar();
      if (S.dw) renderDrawer(false);
    }

    function renderChips() {
      var box = $('.mp-chips'); if (!box) return;
      var counts = S.m.typeCounts;
      box.innerHTML = '<span class="mp-lbl" aria-hidden="true">변화 유형</span>' + allTypes().map(function (t) {
        var on = S.types.has(t), css = SY.REL.css[t] || 'keep';
        return '<button type="button" class="mp-chip" data-type="' + esc(t) + '" aria-pressed="' + on + '">' +
          '<span class="rel ' + css + '"><span aria-hidden="true">' + esc(SY.REL.glyph[t] || '') + '</span> ' + esc(t) +
          ' <span class="mp-n">' + (counts[t] || 0) + '</span></span></button>';
      }).join('') +
      '<span class="mp-chip-acts"><button type="button" class="mp-link" data-act="types-all">모두</button>' +
      '<button type="button" class="mp-link" data-act="types-cand">반박 후보만</button></span>';
    }

    function renderNotes() {
      var box = $('.mp-notes'); if (!box) return;
      var m = S.m, notes = [];
      if (!m.changes.length) notes.push('아직 변화 판정이 없습니다. “진술”에서 변화 판정을 실행하면 칸마다 유지·보충·변경·번복 등의 배지가 붙고, 반박 재료로 담을 수 있습니다.');
      if (!m.issueCount) notes.push('쟁점이 아직 확정되지 않아 모든 진술이 “미분류” 행에 있습니다. “쟁점”에서 쟁점을 확정하면 쟁점별 행으로 나뉩니다.');
      if (m.orphans.length) notes.push('연결된 진술을 찾지 못한 판정 ' + m.orphans.length + '건은 지도에 표시하지 않았습니다.');
      if (m.noDoc.length) notes.push('서면 정보를 찾지 못한 진술 ' + m.noDoc.length + '건은 지도에 표시하지 않았습니다.');
      if (m.unknownIssueRefs) notes.push('목록에 없는 쟁점을 가리키는 진술 연결 ' + m.unknownIssueRefs + '건은 무시하였습니다(다른 쟁점이 없으면 미분류로 보입니다).');
      box.innerHTML = notes.map(function (t) { return '<p class="mp-note">' + esc(t) + '</p>'; }).join('');
    }

    /* ----- 걸러 보기 ----- */
    function visibleDocs() { return S.side === '전체' ? S.m.docs : S.m.docs.filter(function (d) { return d.side === S.side; }); }
    function visibleRows() {
      var q = normQ(S.query);
      if (!q) return S.m.rows;
      return S.m.rows.filter(function (r) { return normQ(r.name + ' ' + (r.unc ? '' : r.elements)).indexOf(q) >= 0; });
    }
    function chVisible(ch) { return S.types.has(ch.type) && (!S.reviewOnly || ch.review === true); }

    /* ----- 격자 ----- */
    function colHead(d) {
      var sc = sideCls(d.side), our = ourLabel(d.side);
      return '<th scope="col" class="mp-colh ' + sc + '" data-doc="' + esc(d.id) + '">' +
        '<div class="mp-colh-side"><span class="mp-sidetag ' + sc + '">' + esc(d.side || '측 미상') + '</span>' +
        (our ? '<span class="mp-our">' + our + '</span>' : '') + '</div>' +
        '<div class="mp-colh-name">' + esc(docLabel(d)) + '</div>' +
        (d.submitter ? '<div class="mp-colh-sub">' + esc(d.submitter) + '</div>' : '') +
        '</th>';
    }
    function badgeHtml(ch, where) {
      var css = 'rel ' + (SY.REL.css[ch.type] || 'keep') + (ch.review === true ? ' review' : '');
      var lab = ch.type + (ch.review === true ? ', 검토 필요' : '') + '. 판정 비교 보기';
      var take = '';
      if (isTakeable(ch)) {
        var on = S.sel.has(ch.id);
        take = '<label class="mp-take' + (on ? ' on' : '') + '" title="반박 재료에 담기">' +
          '<input type="checkbox" data-take="' + esc(ch.id) + '"' + (on ? ' checked' : '') +
          ' aria-label="반박 재료에 담기: ' + esc(ch.type + ', ' + where) + '"><span aria-hidden="true">담기</span></label>';
      }
      return '<span class="mp-chg"><button type="button" class="' + css + ' mp-badge" data-chg="' + esc(ch.id) + '" aria-label="' + esc(lab) + '">' +
        '<span aria-hidden="true">' + esc(SY.REL.glyph[ch.type] || '·') + '</span> ' + esc(ch.type) + '</button>' + take + '</span>';
    }
    function cellHtml(row, d, active, dimOn, curKey) {
      var k = key(row.id, d.id), cell = row.cells[d.id];
      // 진술도 없고 보이는 미반복 배지(loose)도 없으면 빈 칸
      var loose = cell ? cell.loose.filter(chVisible) : [];
      if (!cell || (!cell.stmts.length && !loose.length)) {
        return '<td class="mp-cell mp-empty' + (dimOn ? ' mp-dim' : '') + '" data-key="' + esc(k) + '"><span class="mp-sr">진술 없음</span></td>';
      }
      var isAct = active.has(k), openC = S.open.has(k);
      var extra = 0, nVisible = 0;
      var looseHtml = loose.length
        ? '<li class="mp-st mp-st-omit"><span class="mp-omit-t">이 서면에서 다루지 않은 앞 주장</span>' +
          '<span class="mp-chgs">' + loose.map(function (ch) { return badgeHtml(ch, docLabel(d)); }).join('') + '</span></li>'
        : '';
      var items = cell.stmts.map(function (s, i) {
        var chs = (cell.byStmt[s.id] || []).filter(chVisible);
        var hide = i >= VISIBLE_MAX && !chs.length;
        if (hide) extra++; else nVisible++;
        var n = pageNo(s.page);
        var where = docLabel(d) + (n ? ' 제' + n + '쪽' : '');
        return '<li class="mp-st' + (hide ? ' mp-extra' : '') + '" data-st="' + esc(s.id) + '">' +
          (n ? '<span class="mp-pg">' + n + '쪽</span>' : '') +
          '<span class="mp-gist">' + esc(s.gist || '(요지 없음)') + '</span>' +
          (chs.length ? '<span class="mp-chgs">' + chs.map(function (ch) { return badgeHtml(ch, where); }).join('') + '</span>' : '') +
          '</li>';
      }).join('');
      var cls = 'mp-cell' + (dimOn && !isAct ? ' mp-dim' : '') + (openC ? ' mp-open' : '') + (curKey === k ? ' mp-cur' : '');
      return '<td class="' + cls + '" data-key="' + esc(k) + '" tabindex="0">' +
        '<ul class="mp-sts">' + looseHtml + items + '</ul>' +
        (extra ? '<button type="button" class="mp-more" aria-expanded="' + openC + '" data-n="' + extra + '">' + (openC ? '접기' : '+' + extra + '건 더보기') + '</button>' : '') +
        '</td>';
    }
    /* 걸러 보기 상태에서 보이는 행·열, 판정이 걸친 칸(active), 행별 판정 수 */
    function gridState() {
      var m = S.m, docs = visibleDocs(), rows = visibleRows();
      var docVis = {}; docs.forEach(function (d) { docVis[d.id] = 1; });
      var rowVis = {}; rows.forEach(function (r) { rowVis[r.id] = 1; });
      var active = new Set(), rowCount = {}, shown = 0;
      m.changes.forEach(function (ch) {
        var p = m.placement[ch.id];
        if (!p || !chVisible(ch) || !docVis[p.docId]) return;
        active.add(key(p.rowId, p.docId));
        var f = m.fromCell[ch.id];
        if (f) active.add(key(f.rowId, f.docId));
        rowCount[p.rowId] = (rowCount[p.rowId] || 0) + 1;
        if (rowVis[p.rowId]) shown++;
      });
      return { docs: docs, rows: rows, active: active, rowCount: rowCount, shown: shown,
        dimOn: m.changes.length > 0, curKey: S.dw ? key(S.dw.rowId, S.dw.docId) : null };
    }
    function rowHeadHtml(r, cnt) {
      return '<th scope="row" class="mp-rowh' + (r.unc ? ' mp-unc' : '') + '" data-row="' + esc(r.id) + '">' +
        '<div class="mp-iname">' + esc(r.name) + '</div>' +
        (r.elements ? '<div class="mp-ielem">' + esc(r.elements) + '</div>' : '') +
        (cnt ? '<div class="mp-icount">판정 ' + cnt + '건</div>' : '') + '</th>';
    }
    var cache = { cells: {}, heads: {} };   // 칸·행 머리의 마지막 마크업(부분 갱신용)
    /* 전체 다시 그리기: 처음, 사건 교체, 측·검색 변경 */
    function renderGrid() {
      var box = $('.mp-scroll'); if (!box) return;
      var g = gridState();
      renderSummary(g.rows, g.docs, g.shown);
      var sl = box.scrollLeft, st = box.scrollTop;
      cache = { cells: {}, heads: {} };
      if (!g.docs.length || !g.rows.length) {
        box.innerHTML = '<div class="mp-nomatch"><p>' + (!g.docs.length ? '선택한 측(' + esc(S.side) + ')의 서면이 없습니다.' : '검색어 “' + esc(S.query) + '”에 맞는 쟁점이 없습니다.') + '</p>' +
          '<button type="button" class="mp-btn" data-act="reset">걸러 보기 초기화</button></div>';
        return;
      }
      var h = ['<table class="mp-grid"><caption class="mp-sr">주장 변천 지도. 세로는 쟁점, 가로는 서면(제출일 순). 칸에는 진술 요지와 쪽수, 변화 판정 배지가 있습니다.</caption>',
        '<thead><tr><th scope="col" class="mp-corner"><span>쟁점</span><span class="mp-corner-sub">서면(제출일 순) →</span></th>'];
      g.docs.forEach(function (d) { h.push(colHead(d)); });
      h.push('</tr></thead><tbody>');
      g.rows.forEach(function (r) {
        var rh = rowHeadHtml(r, g.rowCount[r.id] || 0);
        cache.heads[r.id] = rh;
        h.push('<tr>' + rh);
        g.docs.forEach(function (d) {
          var c = cellHtml(r, d, g.active, g.dimOn, g.curKey);
          cache.cells[key(r.id, d.id)] = c;
          h.push(c);
        });
        h.push('</tr>');
      });
      h.push('</tbody></table>');
      box.innerHTML = h.join('');
      box.scrollLeft = sl; box.scrollTop = st;
    }
    /* 부분 갱신: 유형 칩·검토 필요만. 마크업이 달라진 칸과 행 머리만 바꿔 큰 격자에서도 다시 배치할 양을 줄인다. */
    function refreshCells() {
      var box = $('.mp-scroll'), tbl = box && box.querySelector('table.mp-grid');
      if (!tbl) { renderGrid(); return; }
      var g = gridState();
      renderSummary(g.rows, g.docs, g.shown);
      var tds = {}, ths = {};
      Array.prototype.forEach.call(tbl.querySelectorAll('td[data-key]'), function (td) { tds[td.getAttribute('data-key')] = td; });
      Array.prototype.forEach.call(tbl.querySelectorAll('th[data-row]'), function (th) { ths[th.getAttribute('data-row')] = th; });
      g.rows.forEach(function (r) {
        var rh = rowHeadHtml(r, g.rowCount[r.id] || 0);
        if (cache.heads[r.id] !== rh && ths[r.id]) { ths[r.id].outerHTML = rh; cache.heads[r.id] = rh; }
        g.docs.forEach(function (d) {
          var k = key(r.id, d.id), c = cellHtml(r, d, g.active, g.dimOn, g.curKey);
          if (cache.cells[k] !== c && tds[k]) { tds[k].outerHTML = c; cache.cells[k] = c; }
        });
      });
    }
    function renderSummary(rows, docs, shown) {
      var el2 = $('.mp-sum'); if (!el2) return;
      var m = S.m;
      el2.textContent = '쟁점 ' + m.issueCount + ' · 서면 ' + m.docs.length + ' · 진술 ' + m.stmtCount + ' · 판정 ' + m.changes.length +
        (m.reviewCount ? '(검토 필요 ' + m.reviewCount + ')' : '') +
        (m.changes.length ? ' · 지금 보이는 판정 ' + shown : '') +
        (rows.length !== m.rows.length || docs.length !== m.docs.length ? ' · 걸러 보기: 행 ' + rows.length + ', 열 ' + docs.length : '');
    }

    /* ----- 비교 서랍 ----- */
    function stmtCard(st) {
      var d = S.m.docsById[st.docId];
      var side = st.side || (d && d.side) || '';
      var sc = sideCls(side), n = pageNo(st.page);
      var ev = (st.evidence || []).map(function (e) { return SY.fmtEvidence(e); }).filter(Boolean);
      return '<div class="mp-card ' + sc + '">' +
        '<div class="mp-card-meta"><span class="mp-sidetag ' + sc + '">' + esc(side || '측 미상') + '</span>' +
        '<span class="mp-card-doc">' + esc(docLabel(d)) + '</span>' +
        (n ? '<span class="mp-card-pg">제' + n + '쪽</span>' : '') +
        (st.item ? '<span class="mp-card-item"><span class="mp-k">항목</span> ' + esc(st.item) + '</span>' : '') + '</div>' +
        '<p class="mp-card-gist"><span class="mp-k">요지</span> ' + esc(st.gist || '(요지 없음)') + '</p>' +
        (st.quote ? '<div class="mp-k">원문 인용</div><blockquote class="mp-quote">' + esc(st.quote) + '</blockquote>' : '<p class="mp-muted">원문 인용이 없습니다.</p>') +
        (ev.length ? '<div class="mp-card-ev"><span class="mp-k">증거</span> ' + esc(ev.join(', ')) + '</div>' : '') +
        '</div>';
    }
    function compareHtml(ch) {
      var m = S.m, from = m.stmtsById[ch.fromId], to = ch.toId ? m.stmtsById[ch.toId] : null, cross = isCross(ch);
      var css = 'rel ' + (SY.REL.css[ch.type] || 'keep') + (ch.review === true ? ' review' : '');
      var omit = !cross && ch.type === '미반복' && !to;
      var labA = cross ? '상대방 주장' : '앞 진술', labB = cross ? '인정 취지의 기재' : omit ? '뒤 서면' : '뒤 진술';
      var take = isTakeable(ch)
        ? '<label class="mp-take mp-take-lg' + (S.sel.has(ch.id) ? ' on' : '') + '"><input type="checkbox" data-take="' + esc(ch.id) + '"' + (S.sel.has(ch.id) ? ' checked' : '') + '><span>반박 재료에 담기</span></label>'
        : '<p class="mp-muted">유지·보충 판정은 반박 재료 후보가 아니어서 담기 표시를 두지 않습니다.</p>';
      var bHtml;
      if (to) bHtml = stmtCard(to);
      else if (omit) {
        var tdoc = ch.toDocId ? m.docsById[ch.toDocId] : null, tsc = sideCls(tdoc && tdoc.side);
        bHtml = '<div class="mp-card mp-card-omit ' + tsc + '">' +
          (tdoc ? '<div class="mp-card-meta"><span class="mp-sidetag ' + tsc + '">' + esc(tdoc.side || '측 미상') + '</span><span class="mp-card-doc">' + esc(docLabel(tdoc)) + '</span></div>' : '') +
          '<p class="mp-omit-box">' + (tdoc ? '이 서면에서는 해당 쟁점의 이 주장을 다루지 않음' : '이후 제출한 서면에서 해당 쟁점의 이 주장을 다루지 않음(뒤 서면 정보 없음)') + '</p></div>';
      }
      else bHtml = '<p class="mp-none">연결된 뒤 진술을 찾지 못하였습니다.</p>';
      return '<div class="mp-cmp">' +
        '<section class="mp-cside mp-ca" aria-label="' + labA + '"><h4 class="mp-h4">' + labA + '</h4>' + (from ? stmtCard(from) : '<p class="mp-none">연결된 앞 진술을 찾지 못하였습니다.</p>') + '</section>' +
        '<section class="mp-mid" aria-label="판정">' +
          '<h4 class="mp-h4">판정</h4>' +
          '<div><span class="' + css + '"><span aria-hidden="true">' + esc(SY.REL.glyph[ch.type] || '·') + '</span> ' + esc(ch.type) + '</span></div>' +
          '<div class="mp-scope">' + (cross ? '상대방 주장과 대조' : '같은 편 진술 비교') + '</div>' +
          (DEFS[ch.type] ? '<div class="mp-def">' + esc(DEFS[ch.type]) + '</div>' : '') +
          (cross ? '<p class="mp-admnote">' + CROSS_NOTE + '</p>' : '') +
          '<dl class="mp-dl"><dt>판정 근거</dt><dd>' + esc(ch.basis || '(근거 기재 없음)') + '</dd>' +
          '<dt>검토 필요</dt><dd>' + (ch.review === true ? '<span class="mp-flag">검토 필요</span> 원문 대조 후 사용하십시오.' : '표시 없음') + '</dd></dl>' +
          take +
        '</section>' +
        '<section class="mp-cside mp-cb" aria-label="' + labB + '"><h4 class="mp-h4">' + labB + '</h4>' + bHtml + '</section>' +
        '</div>';
    }
    function renderDrawer(focus) {
      var dw = $('.mp-dw'), scrim = $('.mp-scrim');
      if (!dw) return;
      var m = S.m, row = m.rowsById[S.dw.rowId], d = m.docsById[S.dw.docId], cell = row && row.cells[S.dw.docId];
      if (!row || !d || !cell) { closeDrawer(); return; }
      var cur = null;
      if (S.dw.changeId) cur = cell.changes.filter(function (c) { return c.id === S.dw.changeId; })[0] || null;
      if (!cur && cell.changes.length) cur = cell.changes.filter(chVisible)[0] || cell.changes[0];
      S.dw.changeId = cur ? cur.id : null;
      var sc = sideCls(d.side);
      var tabs = cell.changes.length > 1
        ? '<div class="mp-dw-tabs" role="group" aria-label="이 칸의 판정">' + cell.changes.map(function (c) {
            return '<button type="button" class="rel ' + (SY.REL.css[c.type] || 'keep') + ' mp-tab" data-chg="' + esc(c.id) + '" aria-pressed="' + (cur && c.id === cur.id) + '">' +
              '<span aria-hidden="true">' + esc(SY.REL.glyph[c.type] || '·') + '</span> ' + esc(c.type) + '</button>';
          }).join('') + '</div>'
        : '';
      var outs = cell.outs.length
        ? '<div class="mp-dw-outs"><h4 class="mp-h4">이 칸의 진술과 비교된 뒤 판정</h4><ul>' + cell.outs.map(function (c) {
            var p = m.placement[c.id], td = p && m.docsById[p.docId];
            return '<li><button type="button" class="mp-link" data-chg="' + esc(c.id) + '"><span class="rel ' + (SY.REL.css[c.type] || 'keep') + '"><span aria-hidden="true">' + esc(SY.REL.glyph[c.type] || '·') + '</span> ' + esc(c.type) + '</span> ' + esc(docLabel(td)) + '</button></li>';
          }).join('') + '</ul></div>'
        : '';
      var stList = '<details class="mp-dw-st"' + (cur ? '' : ' open') + '><summary>이 칸의 진술 ' + cell.stmts.length + '건</summary>' +
        (cell.stmts.length ? '<ol class="mp-dw-stl">' + cell.stmts.map(function (s) { return '<li>' + stmtCard(s) + '</li>'; }).join('') + '</ol>' : '<p class="mp-muted">이 칸에는 진술이 없습니다.</p>') +
        '</details>';
      dw.innerHTML = '<div class="mp-dw-in">' +
        '<div class="mp-dw-head"><div class="mp-dw-titles"><div class="mp-dw-kicker">' + esc(row.name) + '</div>' +
        '<h3 class="mp-dw-title" tabindex="-1" id="' + uid + '-dwt"><span class="mp-sidetag ' + sc + '">' + esc(d.side || '측 미상') + '</span> ' + esc(docLabel(d)) + '</h3></div>' +
        '<button type="button" class="mp-btn mp-dw-x" data-act="close" aria-label="비교 서랍 닫기">닫기</button></div>' +
        tabs +
        (cur ? compareHtml(cur) : '<p class="mp-muted mp-dw-nochg">이 칸에는 변화 판정이 없습니다. 아래에서 이 칸의 진술 원문을 볼 수 있습니다.</p>') +
        stList + outs +
        '</div>';
      dw.setAttribute('aria-labelledby', uid + '-dwt');
      dw.hidden = false;
      if (scrim) scrim.hidden = false;
      rootEl.classList.add('mp-dw-on');
      $$('td.mp-cur').forEach(function (t) { t.classList.remove('mp-cur'); });
      var td = $('td[data-key="' + cssEsc(key(S.dw.rowId, S.dw.docId)) + '"]');
      if (td) td.classList.add('mp-cur');
      if (td && focus) revealCell(td);
      if (focus) {
        var t = $('#' + cssEsc(uid + '-dwt'));
        if (t) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
        dw.scrollTop = 0;
      }
    }
    /* 서랍이 열리며 격자 폭이 줄어도 선택한 칸이 격자 컨테이너 안에 보이게 한다(페이지는 움직이지 않음). */
    function revealCell(td) {
      var box = $('.mp-scroll'); if (!box) return;
      var rh = box.querySelector('th.mp-rowh'), hd = box.querySelector('thead');
      var sw = rh ? rh.offsetWidth : 0, sh = hd ? hd.offsetHeight : 0;
      var b = box.getBoundingClientRect(), t = td.getBoundingClientRect();
      if (t.left < b.left + sw) box.scrollLeft -= b.left + sw - t.left + 8;
      else if (t.right > b.right) box.scrollLeft += Math.min(t.right - b.right + 8, t.left - b.left - sw - 8);
      if (t.top < b.top + sh) box.scrollTop -= b.top + sh - t.top + 8;
      else if (t.bottom > b.bottom) box.scrollTop += Math.min(t.bottom - b.bottom + 8, t.top - b.top - sh - 8);
    }
    function openKey(k, changeId, trigger, keepTrigger) {
      var i = k.lastIndexOf('|');
      S.dw = { rowId: k.slice(0, i), docId: k.slice(i + 1), changeId: changeId || null };
      if (!keepTrigger) S.trigger = trigger || doc.activeElement;
      renderDrawer(true);
    }
    function openChange(id, trigger, keepTrigger) {
      var p = S.m.placement[id];
      if (!p) return false;
      openKey(key(p.rowId, p.docId), id, trigger, keepTrigger);
      return true;
    }
    function closeDrawer() {
      var dw = $('.mp-dw'), scrim = $('.mp-scrim');
      var lastKey = S.dw ? key(S.dw.rowId, S.dw.docId) : null, lastChg = S.dw && S.dw.changeId;
      S.dw = null;
      if (dw) { dw.hidden = true; dw.innerHTML = ''; }
      if (scrim) scrim.hidden = true;
      rootEl.classList.remove('mp-dw-on');
      $$('td.mp-cur').forEach(function (t) { t.classList.remove('mp-cur'); });
      var back = S.trigger && S.trigger.isConnected && rootEl.contains(S.trigger) ? S.trigger : null;
      if (!back && lastChg) back = $('.mp-scroll [data-chg="' + cssEsc(lastChg) + '"]');
      if (!back && lastKey) back = $('td[data-key="' + cssEsc(lastKey) + '"]');
      S.trigger = null;
      if (back) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
    }

    /* ----- 앞 진술 강조 ----- */
    function highlight(id, on) {
      var f = S.m && S.m.fromCell[id];
      if (!f) return;
      var td = $('td[data-key="' + cssEsc(key(f.rowId, f.docId)) + '"]');
      if (!td) return;
      td.classList.toggle('mp-from-hl', on);
      var li = td.querySelector('li[data-st="' + cssEsc(f.stmtId) + '"]');
      if (li) li.classList.toggle('mp-st-hl', on);
    }

    /* ----- 반박 재료 막대 ----- */
    function ids() {
      var arr = [];
      S.sel.forEach(function (id) { arr.push(id); });
      return arr;
    }
    function notifySel() { if (typeof o.onSelectionChange === 'function') { try { o.onSelectionChange(ids()); } catch (e) { /* 호출자 오류는 무시 */ } } }
    function renderBar() {
      var bar = $('.mp-bar'); if (!bar) return;
      var n = S.sel.size, hidden = 0;
      S.sel.forEach(function (id) { var ch = S.m.changesById[id]; if (ch && !chVisible(ch)) hidden++; });
      var canSave = typeof o.onExport === 'function';
      var oldMsg = $('.mp-msg');
      var keepMsg = oldMsg ? esc(oldMsg.textContent) : '', keepWarn = !!(oldMsg && oldMsg.classList.contains('warn'));
      bar.innerHTML =
        '<div class="mp-bar-row">' +
          '<div class="mp-bar-info"><span class="mp-bar-count">' + (n ? '반박 재료 ' + n + '건 담김' : '담긴 반박 재료가 없습니다') + '</span>' +
          (n && hidden ? '<span class="mp-bar-hint">걸러 보기로 가려진 ' + hidden + '건 포함</span>' : '') +
          (!n ? '<span class="mp-bar-hint">변경·번복·철회·모순·미반복·자백후보 배지 옆 “담기”를 체크하면 이곳에 모입니다.</span>' : '') + '</div>' +
          '<div class="mp-bar-btns">' +
            '<button type="button" class="mp-btn" data-act="preview" aria-expanded="' + S.preview + '"' + (n ? '' : ' disabled') + '>' + (S.preview ? '미리보기 닫기' : '미리보기') + '</button>' +
            '<button type="button" class="mp-btn primary" data-act="copy"' + (n ? '' : ' disabled') + '>복사</button>' +
            (canSave ? '<button type="button" class="mp-btn" data-act="save"' + (n ? '' : ' disabled') + '>파일로 저장</button>' : '') +
            '<button type="button" class="mp-btn ghost" data-act="clear"' + (n ? '' : ' disabled') + '>비우기</button>' +
          '</div>' +
        '</div>' +
        '<div class="mp-msg' + (keepWarn ? ' warn' : '') + '" role="status" aria-live="polite">' + keepMsg + '</div>' +
        '<div class="mp-prev"' + (S.preview && n ? '' : ' hidden') + '><label class="mp-sr" for="' + uid + '-ta">반박 재료 미리보기</label>' +
          '<textarea id="' + uid + '-ta" readonly spellcheck="false" rows="8"></textarea></div>';
      if (S.preview && n) $('.mp-prev textarea').value = rebuttalText(S.C, ids());
    }
    function msg(text, sticky) {
      var box = $('.mp-msg'); if (!box) return;
      box.textContent = text;
      box.classList.toggle('warn', !!sticky);
      clearTimeout(S.msgTimer);
      if (!sticky) S.msgTimer = setTimeout(function () { if (S.alive && box.isConnected) box.textContent = ''; }, 6000);
    }
    function setTaken(id, on) {
      if (on) S.sel.add(id); else S.sel.delete(id);
      $$('input[data-take="' + cssEsc(id) + '"]').forEach(function (inp) {
        inp.checked = on;
        if (inp.parentNode && inp.parentNode.classList) inp.parentNode.classList.toggle('on', on);
      });
      renderBar();
      notifySel();
    }
    function copyNow() {
      var text = rebuttalText(S.C, ids()), n = S.sel.size;
      if (!text) return;
      var okMsg = '반박 재료 ' + n + '건을 클립보드에 복사하였습니다.';
      var p = null;
      try {
        var nav = win.navigator;
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') p = nav.clipboard.writeText(text);
      } catch (e) { p = null; }
      if (p && typeof p.then === 'function') p.then(function () { msg(okMsg); }, function () { fallbackCopy(text, okMsg); });
      else fallbackCopy(text, okMsg);
    }
    function fallbackCopy(text, okMsg) {
      if (!S.alive) return;
      S.preview = true;
      renderBar();
      var ta = $('.mp-prev textarea');
      if (!ta) return;
      ta.value = text;
      try { ta.focus({ preventScroll: false }); } catch (e) { ta.focus(); }
      ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { /* 일부 브라우저 */ }
      var ok = false;
      try { ok = typeof doc.execCommand === 'function' && doc.execCommand('copy') === true; } catch (e) { ok = false; }
      if (ok) msg(okMsg);
      else msg('이 화면에서는 클립보드 접근이 막혀 있어 아래 글을 선택해 두었습니다. Ctrl+C(휴대폰은 길게 눌러 복사)로 복사하십시오.', true);
    }
    function saveNow() {
      if (typeof o.onExport !== 'function') return;
      var text = rebuttalText(S.C, ids());
      if (!text) return;
      var fail = function (err) {
        var code = err && err.code;
        if (code === 'declined') msg('파일 저장을 취소하셨습니다.');
        else msg('파일 저장에 실패하였습니다' + (code ? '(' + code + ')' : '') + '. “복사”를 이용해 주십시오.', true);
      };
      try {
        var r = o.onExport(text, '반박재료.txt');
        if (r && typeof r.then === 'function') r.then(function () { msg('반박재료.txt 저장을 요청하였습니다.'); }, fail);
        else msg('반박재료.txt 저장을 요청하였습니다.');
      } catch (err) { fail(err); }
    }

    /* ----- 사건 처리 ----- */
    function onClick(e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var act = t.closest('[data-act]');
      if (act && rootEl.contains(act)) { doAct(act.getAttribute('data-act'), act); return; }
      if (t.closest('label.mp-take') || (t.matches && t.matches('input[data-take]'))) return;
      var chip = t.closest('.mp-chip[data-type]');
      if (chip) { toggleType(chip.getAttribute('data-type')); return; }
      var b = t.closest('[data-chg]');
      if (b) {
        var inDw = !!t.closest('.mp-dw');
        openChange(b.getAttribute('data-chg'), b, inDw && S.dw);
        return;
      }
      var more = t.closest('.mp-more');
      if (more) { toggleMore(more); return; }
      if (t.closest('summary')) return;
      var td = t.closest('td.mp-cell[data-key]');
      if (td && !td.classList.contains('mp-empty')) { openKey(td.getAttribute('data-key'), null, td); }
    }
    function doAct(a, btn) {
      switch (a) {
        case 'close': closeDrawer(); break;
        case 'reset':
          S.side = '전체'; S.query = ''; S.reviewOnly = false; S.types = new Set(allTypes());
          renderAll(); break;
        case 'types-all': S.types = new Set(allTypes()); renderChips(); refreshCells(); renderBar(); break;
        case 'types-cand':
          S.types = new Set(allTypes().filter(function (t) { return CANDIDATE[t] === 1; }));
          renderChips(); refreshCells(); renderBar(); break;
        case 'preview': S.preview = !S.preview; renderBar(); break;
        case 'copy': copyNow(); break;
        case 'save': saveNow(); break;
        case 'clear':
          S.sel.clear(); S.preview = false;
          $$('input[data-take]').forEach(function (inp) { inp.checked = false; if (inp.parentNode.classList) inp.parentNode.classList.remove('on'); });
          renderBar(); notifySel(); msg('담긴 반박 재료를 비웠습니다.');
          var c = $('[data-act="copy"]'); if (c) c.blur();
          break;
      }
      void btn;
    }
    function toggleType(t) {
      if (S.types.has(t)) S.types.delete(t); else S.types.add(t);
      var chip = $('.mp-chip[data-type="' + cssEsc(t) + '"]');
      if (chip) chip.setAttribute('aria-pressed', String(S.types.has(t)));
      refreshCells(); renderBar();
    }
    function toggleMore(btn) {
      var td = btn.closest('td'); if (!td) return;
      var k = td.getAttribute('data-key'), on = !S.open.has(k);
      if (on) S.open.add(k); else S.open.delete(k);
      td.classList.toggle('mp-open', on);
      btn.setAttribute('aria-expanded', String(on));
      btn.textContent = on ? '접기' : '+' + btn.getAttribute('data-n') + '건 더보기';
    }
    function onChange(e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('input[data-take]')) { setTaken(t.getAttribute('data-take'), t.checked); return; }
      if (t.matches('.mp-seg input[type=radio]')) { S.side = t.value; renderGrid(); renderBar(); return; }
      if (t.matches('.mp-revonly')) { S.reviewOnly = t.checked; refreshCells(); renderBar(); }
    }
    function onInput(e) {
      var t = e.target;
      if (!t || !t.matches || !t.matches('.mp-q')) return;
      clearTimeout(S.qTimer);
      S.qTimer = setTimeout(function () { if (!S.alive) return; S.query = t.value; renderGrid(); }, 120);
    }
    function onKey(e) {
      if (e.key === 'Escape' && S.dw) { e.preventDefault(); closeDrawer(); return; }
      var t = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && t && t.matches && t.matches('td.mp-cell[data-key]')) {
        e.preventDefault();
        openKey(t.getAttribute('data-key'), null, t);
      }
    }
    function onOver(e) {
      var b = e.target && e.target.closest && e.target.closest('.mp-scroll [data-chg]');
      if (b) highlight(b.getAttribute('data-chg'), e.type === 'mouseover' || e.type === 'focusin');
    }
    rootEl.addEventListener('click', onClick);
    rootEl.addEventListener('change', onChange);
    rootEl.addEventListener('input', onInput);
    rootEl.addEventListener('keydown', onKey);
    rootEl.addEventListener('mouseover', onOver);
    rootEl.addEventListener('mouseout', onOver);
    rootEl.addEventListener('focusin', onOver);
    rootEl.addEventListener('focusout', onOver);

    rebuild();

    var ctrl = {
      update: function (partial) {
        if (!partial) return;
        Object.keys(partial).forEach(function (k) { o[k] = partial[k]; });
        if (partial.selected) { S.sel = new Set(partial.selected.map(String)); rebuild(); }
        else renderBar();
      },
      setCase: function (C2) { S.C = C2 || {}; rebuild(); },
      open: function (changeId) { return openChange(String(changeId), null); },
      close: function () { if (S.dw) closeDrawer(); },
      getSelected: function () { return ids(); },
      setSelected: function (list) { S.sel = new Set((list || []).map(String)); rebuild(); notifySel(); },
      destroy: function () {
        S.alive = false;
        clearTimeout(S.msgTimer); clearTimeout(S.qTimer);
        rootEl.removeEventListener('click', onClick);
        rootEl.removeEventListener('change', onChange);
        rootEl.removeEventListener('input', onInput);
        rootEl.removeEventListener('keydown', onKey);
        rootEl.removeEventListener('mouseover', onOver);
        rootEl.removeEventListener('mouseout', onOver);
        rootEl.removeEventListener('focusin', onOver);
        rootEl.removeEventListener('focusout', onOver);
        if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
        if (el.__syMap === ctrl) el.__syMap = null;
      }
    };
    el.__syMap = ctrl;
    return ctrl;
  }

  map.model = buildModel;
  Viz.map = map;
  Viz.rebuttalText = rebuttalText;
})(typeof window !== 'undefined' ? window : globalThis);
