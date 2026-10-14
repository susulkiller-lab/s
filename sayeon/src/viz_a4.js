/* 사건 연표 - A4 별지 타임라인 (SY.Viz.a4, SY.Viz.toPngBlob)
   - 흑백 고정 SVG 문자열을 만든다. 레이아웃 계산과 SVG 생성은 순수 함수라 DOM 없이(node 포함) 동작한다.
   - 단위: SVG 사용자 단위 1 = 1mm. figure 는 width="{W}mm" height="{H}mm" + viewBox="0 0 W H" 로 본문 폭에 정확히 맞춘다.
   - 글자 폭은 측정할 수 없으므로 보수적으로 추정한다(한글·기호 1em, 영숫자 0.6em, 대문자 0.8em, 공백·문장부호 0.4em).
   - 색은 쓰지 않는다. fill/stroke 는 #000, #fff, 회색조(#c8c8c8, #555555, #b0b0b0), none 만. */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};
  SY.Viz = SY.Viz || {};

  var PT = 0.3528;                       // 1pt = 0.3528mm
  var FONT = "Batang, 바탕, AppleMyungjo, 'Noto Serif KR', serif";
  var DEF_MARGINS = { top: 45, bottom: 20, left: 30, right: 30 };   // 하단 20은 프로그램 기본값(법정 수치 아님)
  var SHEET_W = 210, SHEET_H = 297;
  var INK = '#000', PAPER = '#fff', BAND = '#c8c8c8', RANGE = '#555555', GUIDE = '#b0b0b0';
  var PALETTE = [INK, PAPER, BAND, RANGE, GUIDE, 'none'];
  var LH = 1.3;                          // 그림 안 글줄 높이(글자 크기 배수)
  var FN_LH = 1.35;                      // 각주 글줄 높이
  var G = {                              // 도형 치수(mm)
    legInset: 1.2,      // 꺾임·연결선 세로 다리의 x (좌우 끝에서 안쪽)
    rc: 2.5,            // 꺾임 둥근 모서리 반지름
    lineInset: 3.5,     // 다리에서 시간선 슬롯 영역까지
    stem: 6.5,          // 시간선에서 글상자 가장자리까지
    stemGap: 0.9,       // 줄기 끝과 글상자 사이 여유
    rP: 1.15,           // 원고 빈 원 반지름
    rA: 1.3,            // 다툼 없는 사실 채운 원 반지름
    dD: 1.4,            // 피고 빈 마름모 반대각선
    lineW: 0.45, thin: 0.3,
    rowGap: 4,          // 줄 사이 빈칸
    gapLabelH: 7.5,     // 줄 경계·쪽 경계에 긴 공백 표기가 들어갈 때의 빈칸
    leadH: 3.5,         // 둘째 쪽 이후 첫 줄 위 진입선 구간
    curveLane: 4.2,     // 일자 불일치 점선 곡선이 지나는 높이(시간선 위)
    minAbove: 5, minBelow: 5.8,
    waveHalf: 3,
    colGap: 1.6,        // 이웃 글상자 사이 최소 간격
    edge: 0.4           // 좌우 끝에 붙는 글자·도형의 안쪽 여유(글꼴 대체 시 글자 상자가 조금 밖으로 나가는 것 방지)
  };
  var DISPUTE_GLYPH = { '일부다툼': '△', '다툼': '▲', '미확정': '□' };
  var DISPUTE_NAME = { '일부다툼': '일부 다툼', '다툼': '다툼', '미확정': '미확정' };

  /* ---------- 숫자·글자 폭 ---------- */
  function r2(x) { return Math.round(x * 100) / 100; }
  function chars(s) { return Array.from(String(s == null ? '' : s)); }
  function charEm(ch) {
    var c = ch.codePointAt(0);
    if (c < 0x80) {
      if (ch === ' ' || '.,:;\'"`!|()[]{}'.indexOf(ch) >= 0) return 0.4;
      if ((c >= 65 && c <= 90) || 'mw@%&#'.indexOf(ch) >= 0) return 0.8;
      return 0.6;
    }
    return 1;
  }
  function textEm(s) { var w = 0; chars(s).forEach(function (ch) { w += charEm(ch); }); return w; }
  function textW(s, fs) { return textEm(s) * fs; }

  /* 단어(공백) 단위로 접고, 한 단어가 줄보다 길면 글자 단위로 자른다. maxLines 를 넘으면 마지막 줄 끝을 '…'로 줄인다. */
  function wrap(str, maxW, fs, maxLines, firstIndentW) {
    str = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
    var lines = [], cur = '';
    function limit() { return maxW - (lines.length === 0 ? (firstIndentW || 0) : 0); }
    if (!str) return { lines: [], truncated: false };
    str.split(' ').forEach(function (w) {
      var cand = cur ? cur + ' ' + w : w;
      if (textW(cand, fs) <= limit()) { cur = cand; return; }
      if (cur) { lines.push(cur); cur = ''; if (textW(w, fs) <= limit()) { cur = w; return; } }
      chars(w).forEach(function (ch) {
        if (!cur || textW(cur + ch, fs) <= limit()) cur += ch;
        else { lines.push(cur); cur = ch; }
      });
    });
    if (cur) lines.push(cur);
    var truncated = false;
    if (maxLines && lines.length > maxLines) {
      truncated = true;
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1], lim = maxW - (maxLines === 1 ? (firstIndentW || 0) : 0);
      while (last.length && textW(last + '…', fs) > lim) last = chars(last).slice(0, -1).join('');
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
    }
    return { lines: lines, truncated: truncated };
  }

  /* ---------- SVG 조각 ---------- */
  function el(name, attrs, inner) { return SY.svg.el(name, attrs, inner); }
  function pathD(parts) { return parts.map(function (p) { return typeof p === 'number' ? r2(p) : p; }).join(' '); }
  function shape(name, attrs) { attrs['data-shape'] = '1'; return el(name, attrs); }
  function strokePath(d, w, dash, extra) {
    return shape('path', Object.assign({ d: d, fill: 'none', stroke: INK, 'stroke-width': w, 'stroke-dasharray': dash || null, 'stroke-linecap': dash ? null : 'round' }, extra || {}));
  }
  function textEl(x, y, segs, attrs) {
    var inner = segs.map(function (s) {
      return '<tspan' + SY.svg.attr({ 'font-size': r2(s.fs), 'font-weight': s.bold ? 'bold' : null }) + '>' + SY.esc(s.t) + '</tspan>';
    }).join('');
    return el('text', Object.assign({ x: r2(x), y: r2(y), fill: INK }, attrs || {}), inner);
  }
  function tri(tipX, tipY, dirX, dirY, len, half) {   // 꼭짓점이 (tipX,tipY), 방향 (dirX,dirY) 인 채운 삼각형
    var bx = tipX - dirX * len, by = tipY - dirY * len, px = -dirY * half, py = dirX * half;
    return shape('path', { d: pathD(['M', tipX, tipY, 'L', bx + px, by + py, 'L', bx - px, by - py, 'Z']), fill: INK, stroke: 'none' });
  }
  function wavePath(x0, y0, horizontal, len) {        // 물결(4 반주기)
    var n = 4, step = len / n, amp = 1.1, d = ['M', x0, y0], i;
    for (i = 0; i < n; i++) {
      var s = i % 2 === 0 ? -1 : 1;
      if (horizontal) d.push('Q', x0 + step * (i + 0.5), y0 + s * amp, x0 + step * (i + 1), y0);
      else d.push('Q', x0 + s * amp, y0 + step * (i + 0.5), x0, y0 + step * (i + 1));
    }
    return strokePath(pathD(d), G.lineW);
  }

  /* ---------- 날짜 ---------- */
  function spanOf(d) { return d ? SY.date.span(d) : null; }
  function isoOf(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function sameDate(a, b) {
    var sa = spanOf(a), sb = spanOf(b);
    if (!sa || !sb) return false;
    return sa.start === sb.start && sa.end === sb.end && (a.precision || 'day') === (b.precision || 'day');
  }

  /* ---------- 옵션 ---------- */
  function normalize(C, opts, warn) {
    var o = Object.assign({ layout: 'S', mode: 'submit', showEvidence: true, fontScale: 1, itemsPerRow: 'auto',
      footnoteMax: 140, gapDays: 120, figureHeight: 'body', sheetGuides: true }, opts || {});
    o.layout = o.layout === 'Z' ? 'Z' : 'S';
    o.mode = o.mode === 'internal' ? 'internal' : 'submit';
    var k = Number(o.fontScale);
    if (!isFinite(k) || k <= 0) k = 1;
    if (k < 1) { warn('글자 크기 배율 ' + k + '은(는) 인쇄 최소 크기(표제 8.5pt, 각주 8pt)보다 작아 1로 맞췄습니다'); k = 1; }
    if (k > 1.6) { warn('글자 크기 배율은 1.6까지만 적용했습니다'); k = 1.6; }
    o.k = k;
    var m = Object.assign({}, DEF_MARGINS, (C && C.margins) || {}, o.margins || {});
    Object.keys(DEF_MARGINS).forEach(function (key) {
      var v = Number(m[key]);
      if (!isFinite(v) || v < 0) { warn('여백 ' + key + ' 값이 올바르지 않아 기본값 ' + DEF_MARGINS[key] + 'mm로 바꿨습니다'); v = DEF_MARGINS[key]; }
      m[key] = v;
    });
    if (SHEET_W - m.left - m.right < 80 || SHEET_H - m.top - m.bottom < 80) {
      warn('여백이 너무 커서 본문이 80mm보다 작아지므로 기본 여백(위 45, 아래 20, 좌우 30mm)으로 바꿨습니다');
      m = Object.assign({}, DEF_MARGINS);
    }
    o.m = m;
    o.footnoteMax = Math.max(20, Number(o.footnoteMax) || 140);
    o.gapDays = Math.max(1, Number(o.gapDays) || 120);
    return o;
  }

  /* ---------- 사실 -> 지점 ---------- */
  function collect(C, o, ctx) {
    var our = C.ourSide === '피고' ? '피고' : '원고';
    var ourKey = our === '피고' ? 'defendant' : 'plaintiff';
    var fromMs = o.from ? SY.date.parseISO(o.from) : null, toMs = o.to ? SY.date.parseISO(o.to) : null;
    var facts = (C.facts || []).filter(function (f) {
      if (!f) return false;
      if (o.issueId && (f.issueIds || []).indexOf(o.issueId) < 0) return false;
      if (fromMs != null || toMs != null) {
        // 사실의 일자(또는 양측 각자의 일자) 중 하나라도 기간과 겹치면 포함
        return [f.date, f.plaintiff && f.plaintiff.date, f.defendant && f.defendant.date].some(function (d) {
          var s = spanOf(d);
          return s && (fromMs == null || s.end >= fromMs) && (toMs == null || s.start <= toMs);
        });
      }
      return true;
    });
    var items = [];
    facts.forEach(function (f) {
      var parts = [];
      var agreed = f.dispute === '다툼없음';
      if (agreed) {
        var src, ev;
        if (o.mode === 'submit') {
          src = f[ourKey];
          ev = (src && src.evidence) || [];
          if (!src || !String(src.text || '').trim()) ctx.warn(f.id + ': 다툼 없는 사실이지만 우리 측 서술이 없어 각주에 표제만 넣었습니다');
        } else {
          src = (f.plaintiff && String(f.plaintiff.text || '').trim()) ? f.plaintiff : f.defendant;
          ev = uniq(((f.plaintiff && f.plaintiff.evidence) || []).concat((f.defendant && f.defendant.evidence) || []));
        }
        var d0 = (f.date && f.date.start) ? f.date : ((f.plaintiff && f.plaintiff.date) || (f.defendant && f.defendant.date));
        parts.push({ kind: 'a', date: d0, text: src ? String(src.text || '') : '', evidence: ev });
      } else {
        [['plaintiff', 'p', '원고'], ['defendant', 'd', '피고']].forEach(function (s) {
          var side = f[s[0]];
          if (!side) return;
          if (o.mode === 'submit' && s[2] !== our) return;
          var d = (side.date && side.date.start) ? side.date : f.date;
          parts.push({ kind: s[1], side: s[2], date: d, text: String(side.text || ''), evidence: side.evidence || [] });
        });
      }
      parts = parts.filter(function (p) {
        if (spanOf(p.date)) return true;
        ctx.warn(f.id + ': 일자가 없거나 형식이 맞지 않아 연표에서 뺐습니다');
        return false;
      });
      if (!parts.length) return;
      var fs0 = spanOf(f.date) || spanOf(parts[0].date);
      items.push({ fact: f, parts: parts, key: fs0.start });
    });
    items.sort(function (a, b) {
      return (a.key - b.key) || String(a.fact.id).localeCompare(String(b.fact.id), 'en', { numeric: true });
    });
    items.forEach(function (it, i) {
      it.no = i + 1;
      it.mark = SY.circled(it.no);
      it.tagged = it.parts.length === 2;                       // 원/피 두 갈래
      it.mismatch = it.tagged && !sameDate(it.parts[0].date, it.parts[1].date);
    });
    return { items: items, our: our, ourKey: ourKey };
  }
  function uniq(a) { var s = {}; return a.filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }); }

  /* ---------- 글상자 ---------- */
  function evidenceShort(list) {
    if (!list || !list.length) return { text: '', abbreviated: false };
    if (list.length <= 4) return { text: list.join(', '), abbreviated: false };
    return { text: list.slice(0, 3).join(', ') + ' 외 ' + (list.length - 3), abbreviated: true };
  }
  function makeLabel(ctx, it, part, pos, withTitle) {
    var fs = ctx.fs, col = ctx.colW, lines = [];
    var mark = it.mark + (it.tagged ? (part.kind === 'p' ? '원' : '피') : '');
    var date = SY.date.label(part.date);
    var markW = textW(mark, fs.num), spW = textW(' ', fs.small);
    // 일자는 중간에서 끊지 않는다. 기간은 '~' 뒤에서만 나눈다. 번호 옆에 다 들어가지 않으면 번호 다음 줄로 내린다.
    var pieces = date.indexOf(' ~ ') > 0 ? [date.split(' ~ ')[0] + ' ~', date.split(' ~ ').slice(1).join(' ~ ')] : [date];
    function pushDate(s) {
      wrap(s, col, fs.small, 2).lines.forEach(function (l) { lines.push({ segs: [{ t: l, fs: fs.small }], fs: fs.small, w: textW(l, fs.small) }); });
    }
    if (markW + spW + textW(pieces[0], fs.small) <= col) {
      lines.push({ segs: [{ t: mark, fs: fs.num, bold: true }, { t: ' ' + pieces[0], fs: fs.small }], fs: fs.num, w: markW + spW + textW(pieces[0], fs.small) });
      pieces.slice(1).forEach(pushDate);
    } else {
      lines.push({ segs: [{ t: mark, fs: fs.num, bold: true }], fs: fs.num, w: markW });
      pieces.forEach(pushDate);
    }
    if (withTitle) {
      var title = String(it.fact.title || '').trim();
      var glyph = (ctx.o.mode === 'internal' && part.kind !== 'a') ? DISPUTE_GLYPH[it.fact.dispute] : '';
      var t = (glyph ? glyph + ' ' : '') + title;
      if (t) {
        var tw = wrap(t, col, fs.title, 3);
        if (tw.truncated) ctx.warnOnce('title:' + it.fact.id, it.mark + '(' + it.fact.id + '): 표제가 길어 3줄로 줄였습니다');
        tw.lines.forEach(function (l) { lines.push({ segs: [{ t: l, fs: fs.title }], fs: fs.title, w: textW(l, fs.title), title: true }); });
      }
    }
    var ev = evidenceShort(ctx.o.showEvidence ? part.evidence : []);
    part.evAbbrev = ev.abbreviated;
    if (ev.text) {
      // 증거번호는 항목 단위로 접는다("갑8 외 3"이 갈라지지 않게). 두 줄을 넘으면 마지막 줄 끝을 '…'로.
      var toks = ev.text.split(', '), evLines = [], cur = '';
      toks.forEach(function (t, ti) {
        var piece = t + (ti < toks.length - 1 ? ',' : '');
        var cand = cur ? cur + ' ' + piece : piece;
        if (!cur || textW(cand, fs.small) <= col) cur = cand; else { evLines.push(cur); cur = piece; }
      });
      if (cur) evLines.push(cur);
      evLines = [].concat.apply([], evLines.map(function (l) { return textW(l, fs.small) <= col ? [l] : wrap(l, col, fs.small).lines; }));
      if (evLines.length > 2) { evLines = evLines.slice(0, 2); evLines[1] = wrap(evLines[1] + ' …', col, fs.small, 1).lines[0]; part.evAbbrev = true; }
      evLines.forEach(function (l) { lines.push({ segs: [{ t: l, fs: fs.small }], fs: fs.small, w: textW(l, fs.small) }); });
    }
    var h = 0;
    lines.forEach(function (l) { l.top = h; h += LH * l.fs; });
    return { pos: pos, kind: part.kind, lines: lines, h: h };
  }

  /* ---------- 각주(지점 부분별로 미리 접어 둔다) ---------- */
  function makeFootnotePart(ctx, it, part) {
    var o = ctx.o, max = o.footnoteMax;
    var body = String(part.text || '').replace(/\s+/g, ' ').trim();
    var n = chars(body).length;
    if (n > max) {
      body = chars(body).slice(0, max).join('') + '…';
      ctx.warn('각주 ' + it.mark + (part.kind === 'a' ? '' : '(' + part.side + ')') + ': ' + n + '자 중 ' + max + '자까지만 실었습니다');
    }
    if (!body) body = String(it.fact.title || '').trim();
    var prefix = '';
    if (o.mode === 'internal' && part.kind !== 'a') {
      prefix = part.side + (it.mismatch ? '(' + SY.date.label(part.date) + ')' : '') + ': ';
    }
    var suffix = '';
    if (o.showEvidence && part.evAbbrev && part.evidence && part.evidence.length) suffix = ' (' + part.evidence.join(', ') + ')';
    var str = prefix + body + suffix;
    var lines = wrap(str, ctx.W - G.edge - ctx.fnIndent, ctx.fs.small).lines;
    return { str: str, lines: lines };
  }

  /* ---------- 범례 ---------- */
  function legendItems(ctx, pts, waves, curves) {
    var has = {}, disp = {};
    pts.forEach(function (pt) {
      pt.parts.forEach(function (p) {
        has[p.kind] = 1;
        var pr = p.date.precision || 'day';
        if (pr === 'approx') has.approx = 1;
        if (pr === 'range' && p.date.end) has.range = 1;
        if (p.kind !== 'a' && DISPUTE_GLYPH[pt.item.fact.dispute]) disp[pt.item.fact.dispute] = 1;
      });
    });
    var L = [];
    if (has.a) L.push({ sym: 'a', text: '다툼 없는 사실' });
    if (has.p) L.push({ sym: 'p', text: '원고 주장' });
    if (has.d) L.push({ sym: 'd', text: '피고 주장' });
    if (curves) L.push({ sym: 'curve', text: '같은 사실의 양측 일자 연결' });
    if (has.approx) L.push({ sym: 'approx', text: '○○경(어림 일자)' });
    if (has.range) L.push({ sym: 'range', text: '기간' });
    if (waves) L.push({ sym: 'wave', text: '긴 공백' });
    if (ctx.o.mode === 'internal') {
      ['일부다툼', '다툼', '미확정'].forEach(function (k) { if (disp[k]) L.push({ sym: 'glyph', glyph: DISPUTE_GLYPH[k], text: DISPUTE_NAME[k] }); });
    }
    L.push({ sym: 'note', text: '※ 지점 간격은 순서 기준이며 시간에 비례하지 않습니다' });
    return L;
  }
  function layoutLegend(ctx, items, top) {
    var fs = ctx.fs.small, lh = fs * LH + 0.6, x0 = 0.8, x = x0, line = 0, out = [];
    items.forEach(function (it) {
      var symW = it.sym === 'note' ? 0 : (it.sym === 'glyph' ? textW(it.glyph, fs) : (it.sym === 'curve' || it.sym === 'range' || it.sym === 'wave' ? 6 : 3.2));
      var w = symW + (symW ? 1.2 : 0) + textW(it.text, fs);
      if (x > x0 && x + w > ctx.W - G.edge) { line++; x = x0; }
      out.push({ it: it, x: x, symW: symW, line: line, top: top + line * lh });
      x += w + 4;
    });
    return { items: out, bottom: top + (line + 1) * lh, lh: lh };
  }

  /* ---------- 쪽 측정(배치 계산) ---------- */
  function measurePage(ctx, rowsPts, pageIdx) {
    var fs = ctx.fs, W = ctx.W, y = 0;
    var flat = [].concat.apply([], rowsPts);
    var header = { baseline: fs.head * 0.98 + 0.1 };
    y = fs.head * LH + 0.6;
    var rl = rangeLabelOf(flat);
    var titleW = textW(ctx.title + ' (99/99) (계속)', fs.head);
    header.rangeOwnLine = titleW + 6 + 2 * G.edge + textW(rl, fs.small) > W;
    if (header.rangeOwnLine) { header.rangeBaseline = y + fs.small * 0.98; y += fs.small * LH; }
    y += 0.8;
    // 줄 안·줄 경계의 긴 공백, 일자 불일치 곡선 존재 여부(범례용)
    var waves = 0, curves = 0;
    rowsPts.forEach(function (pts, ri) {
      pts.forEach(function (pt, k) { if (pt.gapBefore && (k > 0 || ri > 0 || pageIdx > 0)) waves++; });
      var seen = {};
      pts.forEach(function (pt) { if (pt.item.mismatch) { seen[pt.item.no] = (seen[pt.item.no] || 0) + 1; if (seen[pt.item.no] === 2) curves++; } });
    });
    var legend = layoutLegend(ctx, legendItems(ctx, flat, waves, curves), y);
    y = legend.bottom + 1.2;
    var lead = null;
    if (pageIdx > 0) {
      lead = { top: y, gap: flat[0].gapBefore, h: flat[0].gapBefore ? G.gapLabelH : G.leadH };
      y += lead.h;
    } else y += 1;
    var rows = [];
    rowsPts.forEach(function (pts, ri) {
      var dir = (ctx.o.layout === 'S' && ri % 2 === 1) ? -1 : 1;
      var above = G.minAbove, below = G.minBelow;
      pts.forEach(function (pt) {
        pt.labels.forEach(function (lb) {
          if (lb.pos === 'above') above = Math.max(above, G.stem + lb.h);
          else below = Math.max(below, G.stem + lb.h);
        });
      });
      var gapTop = null, gapH = 0, gapBefore = null;
      if (ri > 0) { gapBefore = pts[0].gapBefore; gapH = gapBefore ? G.gapLabelH : G.rowGap; gapTop = y; y += gapH; }
      var row = { dir: dir, pts: pts, top: y, above: above, below: below, y: y + above, gapTop: gapTop, gapH: gapH, gapBefore: gapBefore };
      row.xs = pts.map(function (pt, k) { return dir === 1 ? ctx.xs + (k + 0.5) * ctx.slotW : ctx.xe - (k + 0.5) * ctx.slotW; });
      y = row.y + below;
      row.bottom = y;
      rows.push(row);
    });
    // 각주
    var fn = footnotesOf(ctx, flat);
    y += 3;
    var fnTop = y;
    y += 1.6;
    var fnLine = fs.small * FN_LH;
    fn.forEach(function (e) { e.top = y; y += e.nLines * fnLine + 0.4; });
    var contentBottom = y;
    y += fs.small * LH + 1;          // "(계속)" 자리(마지막 쪽이면 실제로는 비워 둔다)
    return { header: header, rangeLabel: rl, legend: legend, lead: lead, rows: rows, fnTop: fnTop, footnotes: fn, fnLine: fnLine,
      contentBottom: contentBottom, height: y, pageIdx: pageIdx, flat: flat, waves: waves, curves: curves };
  }
  function rangeLabelOf(pts) {
    var lo = Infinity, hi = -Infinity;
    pts.forEach(function (pt) { pt.parts.forEach(function (p) { var s = spanOf(p.date); lo = Math.min(lo, s.start); hi = Math.max(hi, s.end); }); });
    if (!isFinite(lo)) return '';
    var a = SY.date.fmtKo(isoOf(lo), 'day'), b = SY.date.fmtKo(isoOf(hi), 'day');
    return a === b ? a : a + ' ~ ' + b;
  }
  function footnotesOf(ctx, flat) {
    var by = {}, order = [];
    flat.forEach(function (pt) {
      var e = by[pt.item.no];
      if (!e) { e = by[pt.item.no] = { no: pt.item.no, mark: pt.item.mark, item: pt.item, parts: [] }; order.push(e); }
      pt.parts.forEach(function (p) { if (e.parts.indexOf(p) < 0) e.parts.push(p); });
    });
    order.sort(function (a, b) { return a.no - b.no; });
    order.forEach(function (e) {
      e.parts.sort(function (a, b) { return 'apd'.indexOf(a.kind) - 'apd'.indexOf(b.kind); });
      e.nLines = 0;
      e.parts.forEach(function (p) { e.nLines += Math.max(1, p.fn.lines.length); });
      e.text = e.parts.map(function (p) { return p.fn.str; }).join(' / ');
    });
    return order;
  }

  /* ---------- 배치 전체 (순수 함수) ---------- */
  function layout(C, opts) {
    var warnings = [], once = {};
    var ctx = { warn: function (m) { warnings.push(m); }, warnOnce: function (k, m) { if (!once[k]) { once[k] = 1; warnings.push(m); } } };
    C = C || {};
    var o = ctx.o = normalize(C, opts, ctx.warn);
    var m = o.m, W = ctx.W = SHEET_W - m.left - m.right, H = ctx.H = SHEET_H - m.top - m.bottom;
    var k = o.k;
    var fs = ctx.fs = { title: 8.5 * PT * k, small: 8 * PT * k, num: 9 * PT * k, head: 10.5 * PT * k };
    ctx.title = o.title != null && String(o.title).trim() ? String(o.title).trim() : (C.caseNo ? '별지 사건 연표' : '사건 연표');
    var xL = ctx.xL = G.legInset, xR = ctx.xR = W - G.legInset;
    ctx.xs = xL + G.lineInset; ctx.xe = xR - G.lineInset;
    var L = ctx.xe - ctx.xs;
    var n = parseInt(o.itemsPerRow, 10);
    if (!(n >= 1)) n = Math.max(2, Math.min(8, Math.floor(L / (27 * k))));
    n = Math.max(1, Math.min(12, n));
    ctx.n = n; ctx.slotW = L / n; ctx.colW = ctx.slotW - G.colGap;
    if (ctx.colW < 18 * k) warnings.push('한 줄 지점 수(' + n + ')가 많아 글상자 폭이 ' + r2(ctx.colW) + 'mm로 좁습니다. 표제가 여러 줄로 접히거나 잘릴 수 있습니다');

    var col = collect(C, o, ctx);
    ctx.our = col.our;
    var items = col.items;
    var maxMark = 0;
    items.forEach(function (it) { maxMark = Math.max(maxMark, textW(it.mark, fs.small)); });
    ctx.fnIndent = G.edge + Math.max(textW('①', fs.small), maxMark) + 1.2;

    // 지점(슬롯) 만들기: 같은 일자의 원/피는 한 슬롯(위·아래), 일자가 다르면 각자 슬롯
    var agreedPos = ctx.our === '원고' ? 'below' : 'above';
    var points = [];
    items.forEach(function (it) {
      if (it.tagged && !it.mismatch) {
        var p = it.parts[0], d = it.parts[1];
        var ourIsP = ctx.our === '원고';
        points.push({ item: it, kind: 'pair', parts: [p, d], date: p.date });
        points[points.length - 1].labelSpec = [{ part: p, pos: 'above', title: ourIsP }, { part: d, pos: 'below', title: !ourIsP }];
      } else {
        it.parts.forEach(function (p) {
          var pos = p.kind === 'a' ? agreedPos : (p.kind === 'p' ? 'above' : 'below');
          points.push({ item: it, kind: p.kind, parts: [p], date: p.date, labelSpec: [{ part: p, pos: pos, title: true }] });
        });
      }
    });
    points.forEach(function (pt) { pt.span = spanOf(pt.date); });
    points.sort(function (a, b) {
      return (a.span.start - b.span.start) || (a.item.no - b.item.no) || ('apdpair'.indexOf(a.kind) - 'apdpair'.indexOf(b.kind));
    });
    var runEnd = -Infinity;     // 앞 지점들 중 가장 늦은 끝(긴 기간이 덮고 있으면 공백이 아니다)
    points.forEach(function (pt, i) {
      pt.index = i;
      pt.labels = pt.labelSpec.map(function (s) { return makeLabel(ctx, pt.item, s.part, s.pos, s.title); });
      delete pt.labelSpec;
      if (i > 0) {
        var days = SY.date.days(runEnd, pt.span.start);
        if (days > o.gapDays) pt.gapBefore = { days: days, months: Math.max(1, Math.round(days / 30.44)) };
      }
      runEnd = Math.max(runEnd, pt.span.end);
    });
    items.forEach(function (it) { it.parts.forEach(function (p) { p.fn = makeFootnotePart(ctx, it, p); }); });

    // 쪽 나누기: 줄을 하나씩 더해 보고 본문 높이 H 를 넘으면 다음 쪽으로
    var pages = [], i = 0;
    while (i < points.length) {
      var rowsPts = [], pm = null;
      while (i < points.length) {
        var take = Math.min(n, points.length - i);
        var trial = rowsPts.concat([points.slice(i, i + take)]);
        var tm = measurePage(ctx, trial, pages.length);
        if (tm.height <= H) { rowsPts = trial; pm = tm; i += take; continue; }
        if (rowsPts.length) {
          // 줄 전체가 안 들어가면 지점 수를 줄여(한 줄의 절반까지) 남은 공간을 채운 뒤 쪽을 넘긴다
          var fitted = false, minTake = Math.max(2, Math.ceil(n / 2));
          while (take > minTake && !fitted) {
            take--;
            trial = rowsPts.concat([points.slice(i, i + take)]);
            tm = measurePage(ctx, trial, pages.length);
            if (tm.height <= H) { rowsPts = trial; pm = tm; i += take; fitted = true; }
          }
          break;
        }
        while (take > 1) {
          take--;
          tm = measurePage(ctx, [points.slice(i, i + take)], pages.length);
          if (tm.height <= H) break;
        }
        rowsPts = [points.slice(i, i + take)]; pm = tm; i += take;
        if (tm.height > H) warnings.push((pages.length + 1) + '쪽: 본문 높이(' + r2(H) + 'mm)가 작아 내용이 넘칩니다. 여백이나 글자 크기를 줄여 주십시오');
        break;
      }
      pages.push(pm);
    }
    pages.forEach(function (pm, pi) { pm.total = pages.length; pm.last = pi === pages.length - 1; });
    if (!items.length) warnings.push('표시할 사실이 없습니다(걸러 보기 조건이나 제출용/내부용 선택을 확인해 주십시오)');
    return {
      ctx: ctx, o: o, W: W, H: H, n: n, slotW: ctx.slotW, colW: ctx.colW, fs: fs, margins: m,
      items: items, points: points, pages: pages, warnings: warnings,
      numbering: items.map(function (it) { return { no: it.no, mark: it.mark, factId: it.fact.id }; })
    };
  }

  /* ---------- 그리기 ---------- */
  function renderPageInner(model, pm) {
    var ctx = model.ctx, o = model.o, fs = ctx.fs, W = ctx.W, out = [];
    var figH = o.figureHeight === 'content' ? (pm.last ? pm.contentBottom + 1 : pm.height) : ctx.H;
    figH = r2(Math.min(figH, Math.max(ctx.H, pm.height)));
    out.push(el('rect', { x: 0, y: 0, width: r2(W), height: figH, fill: PAPER, 'data-bg': '1' }));

    // 머리글
    var head = [{ t: ctx.title + ' (' + (pm.pageIdx + 1) + '/' + pm.total + ')', fs: fs.head, bold: true }];
    if (pm.pageIdx > 0) head.push({ t: ' (계속)', fs: fs.small });
    out.push(textEl(G.edge, pm.header.baseline, head, { 'data-grp': 'head' }));
    if (pm.rangeLabel) {
      out.push(textEl(W - G.edge, pm.header.rangeOwnLine ? pm.header.rangeBaseline : pm.header.baseline, [{ t: pm.rangeLabel, fs: fs.small }],
        { 'text-anchor': 'end', 'data-grp': 'range' }));
    }
    // 범례
    pm.legend.items.forEach(function (li, idx) {
      var it = li.it, cy = li.top + pm.legend.lh / 2 - 0.3, x = li.x, grp = 'leg' + idx;
      var tb = li.top + fs.small * 0.98;
      if (it.sym === 'a') out.push(shape('circle', { cx: r2(x + 1.6), cy: r2(cy), r: G.rA, fill: INK, stroke: 'none' }));
      if (it.sym === 'p') out.push(shape('circle', { cx: r2(x + 1.6), cy: r2(cy), r: G.rP, fill: PAPER, stroke: INK, 'stroke-width': G.thin }));
      if (it.sym === 'd') out.push(shape('path', { d: diamondD(x + 1.6, cy), fill: PAPER, stroke: INK, 'stroke-width': G.thin }));
      if (it.sym === 'curve') out.push(strokePath(pathD(['M', x, cy + 1, 'Q', x + 3, cy - 2.2, x + 6, cy + 1]), G.thin, '0.6 0.6'));
      if (it.sym === 'approx') out.push(shape('rect', { x: r2(x), y: r2(cy - 0.9), width: 3.2, height: 1.8, rx: 0.9, fill: BAND, stroke: 'none' }));
      if (it.sym === 'range') out.push(rangeShape(x + 3, cy, 3));
      if (it.sym === 'wave') out.push(wavePath(x, cy, true, 6));
      if (it.sym === 'glyph') out.push(textEl(x, tb, [{ t: it.glyph, fs: fs.small }], { 'data-grp': grp }));
      out.push(textEl(x + li.symW + (li.symW ? 1.2 : 0), tb, [{ t: it.text, fs: fs.small }], { 'data-grp': grp }));
    });

    var xs = ctx.xs, xe = ctx.xe, xL = ctx.xL, xR = ctx.xR, rc = G.rc;
    var dashConn = '1.5 1';
    var rows = pm.rows;

    // 진입선(둘째 쪽부터)
    if (pm.lead) {
      var y0 = rows[0].y, lt = pm.lead.top, dashed = o.layout === 'Z' ? dashConn : null;
      if (pm.lead.gap) {
        var wy0 = lt + 0.6, wl = 6;
        out.push(strokePath(pathD(['M', xL, wy0 + wl, 'V', y0 - rc]), G.lineW, dashed));
        out.push(wavePath(xL, wy0, false, wl));
        out.push(textEl(xL + 2.4, lt + pm.lead.h / 2 + fs.small * 0.35, [{ t: '약 ' + pm.lead.gap.months + '개월', fs: fs.small }], { 'data-grp': 'leadgap' }));
      } else {
        out.push(strokePath(pathD(['M', xL, lt + 0.3, 'V', y0 - rc]), G.lineW, dashed));
      }
      out.push(strokePath(pathD(['M', xL, y0 - rc, 'A', rc, rc, 0, 0, 0, xL + rc, y0]), G.lineW, dashed));
      if (o.layout === 'Z') {
        out.push(strokePath(pathD(['M', xL + rc, y0, 'H', xs - 1.6]), G.lineW, dashed));
        out.push(tri(xs, y0, 1, 0, 1.8, 1.1));
      }
    }

    rows.forEach(function (row, ri) {
      var y = row.y, dir = row.dir, lastRow = ri === rows.length - 1;
      var firstX = row.xs[0], lastX = row.xs[row.xs.length - 1];
      // 시간선 시작·끝
      var x0, x1;
      if (o.layout === 'S') {
        if (ri === 0) x0 = pm.lead ? xL + rc : xs;
        else x0 = dir === 1 ? xL + rc : xR - rc;
        x1 = lastRow ? lastX + dir * ctx.slotW / 2 : (dir === 1 ? xR - rc : xL + rc);
      } else {
        x0 = xs;
        x1 = lastRow ? lastX + ctx.slotW / 2 : xe;
      }
      if (lastRow) x1 = Math.max(xs, Math.min(xe, x1));
      // 흐린 구간(경)
      row.pts.forEach(function (pt, k) {
        if (pt.parts.some(function (p) { return (p.date.precision || 'day') === 'approx'; })) {
          out.push(shape('rect', { x: r2(row.xs[k] - 3), y: r2(y - 0.9), width: 6, height: 1.8, rx: 0.9, fill: BAND, stroke: 'none' }));
        }
      });
      // 물결·화살표
      var breaks = [], chevrons = [];
      for (var k = 1; k < row.pts.length; k++) {
        var mid = (row.xs[k - 1] + row.xs[k]) / 2;
        if (row.pts[k].gapBefore) breaks.push({ mid: mid, gap: row.pts[k].gapBefore });
        else chevrons.push(mid);
      }
      var lo = Math.min(x0, x1), hi = Math.max(x0, x1), segs = [], cur = lo;
      breaks.slice().sort(function (a, b) { return a.mid - b.mid; }).forEach(function (b) {
        segs.push([cur, b.mid - G.waveHalf]); cur = b.mid + G.waveHalf;
      });
      segs.push([cur, hi]);
      // 마지막 줄 끝 화살촉 자리만큼 선을 줄인다
      segs.forEach(function (s) {
        var a = s[0], b = s[1];
        if (lastRow && dir === 1 && b === hi) b -= 1.0;
        if (lastRow && dir === -1 && a === lo) a += 1.0;
        if (b - a > 0.05) out.push(strokePath(pathD(['M', a, y, 'H', b]), G.lineW));
      });
      breaks.forEach(function (b) {
        out.push(wavePath(b.mid - G.waveHalf, y, true, 2 * G.waveHalf));
        out.push(textEl(b.mid, y + 1.3 + fs.small * 0.98, [{ t: '약 ' + b.gap.months + '개월', fs: fs.small }], { 'text-anchor': 'middle', 'data-grp': 'gap' + ri + '_' + r2(b.mid) }));
      });
      chevrons.forEach(function (cx) { out.push(tri(cx + dir * 1.0, y, dir, 0, 2.0, 1.0)); });
      if (pm.pageIdx === 0 && ri === 0) out.push(strokePath(pathD(['M', xs, y - 1.5, 'V', y + 1.5]), G.lineW));
      if (lastRow) out.push(tri(dir === 1 ? hi : lo, y, dir, 0, 2.0, 1.2));

      // 기간 막대
      row.pts.forEach(function (pt, k) {
        if (pt.parts.some(function (p) { return p.date.precision === 'range' && p.date.end; })) {
          out.push(rangeShape(row.xs[k], y, Math.min(0.28 * ctx.slotW, 7)));
        }
      });
      // 같은 줄 안의 일자 불일치 점선 곡선
      var byNo = {};
      row.pts.forEach(function (pt, k) {
        if (!pt.item.mismatch) return;
        var e = byNo[pt.item.no] = byNo[pt.item.no] || {};
        e[pt.kind] = row.xs[k];
      });
      Object.keys(byNo).forEach(function (no) {
        var e = byNo[no];
        if (e.p == null || e.d == null) return;
        var xP = e.p, xD = e.d, s = xD > xP ? 1 : -1, yA = y - G.curveLane, yc = y - G.rP - 0.2;
        var d = pathD(['M', xP + s * G.rP, yc, 'C', xP + s * 3, yc, xP + s * 3, yA, xP + s * 5, yA,
          'L', xD - s * 3, yA, 'Q', xD, yA, xD, y + 0.2]);
        out.push(strokePath(d, G.thin, '0.6 0.6', { 'data-curve': no }));
      });
      // 표지·줄기·글상자
      row.pts.forEach(function (pt, k) {
        var x = row.xs[k];
        pt.labels.forEach(function (lb, li) {
          var grp = 'p' + pt.index + lb.pos;
          var up = lb.pos === 'above';
          var markerEdge;
          if (lb.kind === 'a') markerEdge = G.rA;
          else if (lb.kind === 'p') markerEdge = 2 * G.rP + 0.2;
          else markerEdge = 2 * G.dD + 0.2;
          var s0 = up ? y - markerEdge : y + markerEdge, s1 = up ? y - G.stem + G.stemGap : y + G.stem - G.stemGap;
          out.push(strokePath(pathD(['M', x, s0, 'V', s1]), G.thin, lb.kind === 'd' ? '0.8 0.6' : null));
          var top = up ? y - G.stem - lb.h : y + G.stem;
          lb.lines.forEach(function (ln) {
            out.push(textEl(x, top + ln.top + ln.fs * 0.98, ln.segs, { 'text-anchor': 'middle', 'data-grp': grp, 'data-maxw': r2(ctx.colW) }));
          });
        });
        // 표지는 줄기 위에 그린다
        pt.parts.forEach(function (p) {
          if (p.kind === 'a') out.push(shape('circle', { cx: r2(x), cy: r2(y), r: G.rA, fill: INK, stroke: 'none', 'data-k': 'a' }));
          if (p.kind === 'p') out.push(shape('circle', { cx: r2(x), cy: r2(y - G.rP - 0.2), r: G.rP, fill: PAPER, stroke: INK, 'stroke-width': G.thin, 'data-k': 'p' }));
          if (p.kind === 'd') out.push(shape('path', { d: diamondD(x, y + G.dD + 0.2), fill: PAPER, stroke: INK, 'stroke-width': G.thin, 'data-k': 'd' }));
        });
      });

      // 다음 줄로 잇기
      if (!lastRow) {
        var nx = rows[ri + 1], y2 = nx.y;
        if (o.layout === 'S') {
          var xv = dir === 1 ? xR : xL, sw = dir === 1 ? 1 : 0, hx = dir === 1 ? xR - rc : xL + rc;
          out.push(strokePath(pathD(['M', hx, y, 'A', rc, rc, 0, 0, sw, xv, y + rc]), G.lineW));
          out.push(strokePath(pathD(['M', xv, y2 - rc, 'A', rc, rc, 0, 0, sw, hx, y2]), G.lineW));
          if (nx.gapBefore) {
            var wy = nx.gapTop + nx.gapH / 2 - 3;
            out.push(strokePath(pathD(['M', xv, y + rc, 'V', wy]), G.lineW));
            out.push(wavePath(xv, wy, false, 6));
            out.push(strokePath(pathD(['M', xv, wy + 6, 'V', y2 - rc]), G.lineW));
            out.push(textEl(dir === 1 ? xv - 2.4 : xv + 2.4, nx.gapTop + nx.gapH / 2 + fs.small * 0.35, [{ t: '약 ' + nx.gapBefore.months + '개월', fs: fs.small }],
              { 'text-anchor': dir === 1 ? 'end' : 'start', 'data-grp': 'rgap' + ri }));
          } else {
            out.push(strokePath(pathD(['M', xv, y + rc, 'V', y2 - rc]), G.lineW));
            var ym = nx.gapTop + nx.gapH / 2;
            out.push(tri(xv, ym + 1.0, 0, 1, 2.0, 1.0));
          }
        } else {
          var gy = nx.gapTop + (nx.gapBefore ? 1.6 : nx.gapH / 2);
          out.push(strokePath(pathD(['M', xe, y, 'H', xR - rc]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xR - rc, y, 'A', rc, rc, 0, 0, 1, xR, y + rc]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xR, y + rc, 'V', gy - rc]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xR, gy - rc, 'A', rc, rc, 0, 0, 1, xR - rc, gy]), G.lineW, dashConn));
          if (nx.gapBefore) {
            var cxm = W / 2;
            out.push(strokePath(pathD(['M', xR - rc, gy, 'H', cxm + G.waveHalf]), G.lineW, dashConn));
            out.push(wavePath(cxm - G.waveHalf, gy, true, 2 * G.waveHalf));
            out.push(strokePath(pathD(['M', cxm - G.waveHalf, gy, 'H', xL + rc]), G.lineW, dashConn));
            out.push(textEl(cxm, gy + 1.2 + fs.small * 0.98, [{ t: '약 ' + nx.gapBefore.months + '개월', fs: fs.small }], { 'text-anchor': 'middle', 'data-grp': 'rgap' + ri }));
          } else {
            out.push(strokePath(pathD(['M', xR - rc, gy, 'H', xL + rc]), G.lineW, dashConn));
          }
          out.push(strokePath(pathD(['M', xL + rc, gy, 'A', rc, rc, 0, 0, 0, xL, gy + rc]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xL, gy + rc, 'V', y2 - rc]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xL, y2 - rc, 'A', rc, rc, 0, 0, 0, xL + rc, y2]), G.lineW, dashConn));
          out.push(strokePath(pathD(['M', xL + rc, y2, 'H', xs - 1.6]), G.lineW, dashConn));
          out.push(tri(xs, y2, 1, 0, 1.8, 1.1));
        }
      }
    });

    // 각주
    out.push(strokePath(pathD(['M', G.edge, pm.fnTop, 'H', Math.min(35, W - G.edge)]), 0.25));
    pm.footnotes.forEach(function (e) {
      var y = e.top, grp = 'fn' + e.no;
      out.push(textEl(G.edge, y + fs.small * 0.98, [{ t: e.mark, fs: fs.small, bold: true }], { 'data-grp': grp }));
      e.parts.forEach(function (p) {
        var ls = p.fn.lines.length ? p.fn.lines : [''];
        ls.forEach(function (l) {
          if (l) out.push(textEl(ctx.fnIndent, y + fs.small * 0.98, [{ t: l, fs: fs.small }], { 'data-grp': grp, 'data-maxw': r2(W - G.edge - ctx.fnIndent) }));
          y += pm.fnLine;
        });
      });
    });
    if (!pm.last) {
      var fy = o.figureHeight === 'content' ? pm.contentBottom + 1 + fs.small * 0.98 : figH - fs.small * 0.3;
      out.push(textEl(W - G.edge, fy, [{ t: '(계속)', fs: fs.small }], { 'text-anchor': 'end', 'data-grp': 'cont' }));
    }
    return { inner: out.join(''), figH: figH };
  }
  function diamondD(cx, cy) {
    var d = G.dD;
    return pathD(['M', cx, cy - d, 'L', cx + d, cy, 'L', cx, cy + d, 'L', cx - d, cy, 'Z']);
  }
  function rangeShape(cx, cy, a) {
    return strokePath(pathD(['M', cx - a, cy, 'H', cx + a]), 1.3, null, { stroke: RANGE, 'stroke-linecap': 'butt' }) +
      strokePath(pathD(['M', cx - a, cy - 1.1, 'V', cy + 1.1, 'M', cx + a, cy - 1.1, 'V', cy + 1.1]), G.thin);
  }
  function svgRoot(wMm, hMm, inner, extra) {
    return '<svg' + SY.svg.attr(Object.assign({ xmlns: 'http://www.w3.org/2000/svg', width: r2(wMm) + 'mm', height: r2(hMm) + 'mm',
      viewBox: '0 0 ' + r2(wMm) + ' ' + r2(hMm), 'font-family': FONT }, extra || {})) + '>' + inner + '</svg>';
  }

  /* ---------- 공개 API ---------- */
  SY.Viz.a4 = function (C, opts) {
    var model = layout(C, opts);
    var o = model.o, m = model.margins, W = model.W, H = model.H;
    var pages = model.pages.map(function (pm) {
      var r = renderPageInner(model, pm);
      var figure = svgRoot(W, r.figH, r.inner, { 'data-sy': 'a4-figure', 'data-page': pm.pageIdx + 1 });
      var guides = o.sheetGuides ? el('rect', { x: m.left, y: m.top, width: r2(W), height: r2(H), fill: 'none', stroke: GUIDE, 'stroke-width': 0.2, 'stroke-dasharray': '1.5 1' }) : '';
      var sheet = svgRoot(SHEET_W, SHEET_H,
        el('rect', { x: 0, y: 0, width: SHEET_W, height: SHEET_H, fill: PAPER }) + guides +
        // 중첩 <svg> 대신 <g transform> 으로 얹는다(바깥 CSS 의 svg { width:100% } 같은 규칙이 안쪽 그림 크기를 바꾸지 못하게)
        el('g', { transform: 'translate(' + r2(m.left) + ' ' + r2(m.top) + ')', 'data-sy': 'a4-body' }, r.inner),
        { 'data-sy': 'a4-sheet', 'data-page': pm.pageIdx + 1 });
      return {
        figure: figure, sheet: sheet,
        footnotes: pm.footnotes.map(function (e) { return { no: e.no, mark: e.mark, text: e.text }; }),
        rangeLabel: pm.rangeLabel, widthMm: r2(W), heightMm: r.figH, contentHeightMm: r2(pm.last ? pm.contentBottom : pm.height),
        factIds: uniq(pm.flat.map(function (pt) { return pt.item.fact.id; })),
        rows: pm.rows.length
      };
    });
    return {
      pages: pages, widthMm: r2(W), heightMm: r2(H), sheetWidthMm: SHEET_W, sheetHeightMm: SHEET_H,
      margins: Object.assign({}, m), itemsPerRow: model.n, numbering: model.numbering, warnings: model.warnings.slice()
    };
  };
  /* 시험·진단용: 배치 모델(순수 계산 결과). 화면 코드는 쓰지 않아도 된다. */
  SY.Viz.a4.layout = layout;
  SY.Viz.a4._est = { textW: textW, wrap: wrap, PT: PT, FONT: FONT, PALETTE: PALETTE.slice() };

  /* ---------- PNG ---------- */
  var CRC_TABLE = null;
  function crc32(bytes, start, end) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
    }
    var crc = 0xFFFFFFFF;
    for (var i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  /* PNG 바이트에 pHYs(해상도) 덩이를 넣는다. 워드·한글이 그림을 원래 mm 크기로 넣을 수 있게 하기 위함. */
  function pngSetDpi(u8, dpi) {
    var sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (var s = 0; s < 8; s++) if (u8[s] !== sig[s]) return u8;
    var ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21);
    var dv = new DataView(chunk.buffer);
    dv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4);       // 'pHYs'
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
    dv.setUint32(17, crc32(chunk, 4, 17));
    // 기존 pHYs 가 있으면 빼고, IHDR 바로 뒤에 넣는다
    var pos = 8, keep = [], ihdrEnd = -1;
    var view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (pos + 8 <= u8.length) {
      var len = view.getUint32(pos), type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
      var end = pos + 12 + len;
      if (type === 'IHDR') ihdrEnd = end;
      if (type !== 'pHYs') keep.push([pos, end]);
      pos = end;
      if (type === 'IEND') break;
    }
    if (ihdrEnd < 0) return u8;
    var total = 8 + 21;
    keep.forEach(function (r) { total += r[1] - r[0]; });
    var outB = new Uint8Array(total), w = 0;
    outB.set(u8.subarray(0, 8), 0); w = 8;
    keep.forEach(function (r) {
      outB.set(u8.subarray(r[0], r[1]), w); w += r[1] - r[0];
      if (r[1] === ihdrEnd) { outB.set(chunk, w); w += 21; }
    });
    return outB;
  }
  SY.Viz.a4._pngSetDpi = pngSetDpi;
  SY.Viz.a4._crc32 = crc32;

  function svgSizeMm(svg) {
    var tag = /<svg\b[^>]*>/.exec(svg);
    if (!tag) return null;
    var w = /\swidth="([\d.]+)mm"/.exec(tag[0]), h = /\sheight="([\d.]+)mm"/.exec(tag[0]);
    return w && h ? { w: parseFloat(w[1]), h: parseFloat(h[1]) } : null;
  }
  /* SVG 문자열 -> 흰 바탕 PNG Blob. 브라우저 전용(Image, canvas). dpi 기본 300.
     widthMm/heightMm 를 주지 않으면 SVG 의 mm 크기를 쓴다. 준 값의 가로세로 비가 SVG 와 1% 넘게 다르면 찌그러짐을 막기 위해 SVG 크기를 쓴다. */
  SY.Viz.toPngBlob = function (svgString, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (typeof document === 'undefined' || typeof Image === 'undefined') { reject(new Error('PNG 변환은 브라우저에서만 할 수 있습니다')); return; }
      var svg = String(svgString || '');
      if (!/^\s*<svg\b/.test(svg)) { reject(new Error('SVG 문자열이 아닙니다')); return; }
      var dpi = Number(opts.dpi) > 0 ? Number(opts.dpi) : 300;
      var own = svgSizeMm(svg), wMm = Number(opts.widthMm), hMm = Number(opts.heightMm);
      if (!(wMm > 0) || !(hMm > 0)) { if (!own) { reject(new Error('SVG 크기(mm)를 알 수 없습니다')); return; } wMm = own.w; hMm = own.h; }
      else if (own && Math.abs(wMm / hMm - own.w / own.h) > 0.01 * (own.w / own.h)) { wMm = own.w; hMm = own.h; }
      var wpx = Math.round(wMm / 25.4 * dpi), hpx = Math.round(hMm / 25.4 * dpi);
      // 이미지 고유 크기를 목표 픽셀로 바꿔 벡터 그대로 래스터화되게 한다
      var src = svg.replace(/<svg\b[^>]*>/, function (t) {
        return t.replace(/\swidth="[^"]*"/, ' width="' + wpx + '"').replace(/\sheight="[^"]*"/, ' height="' + hpx + '"');
      });
      var img = new Image(), done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('SVG 이미지를 읽는 데 시간이 너무 걸립니다')); } }, 20000);
      img.onload = function () {
        if (done) return;
        try {
          var cv = document.createElement('canvas');
          cv.width = wpx; cv.height = hpx;
          var g = cv.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, wpx, hpx);
          g.drawImage(img, 0, 0, wpx, hpx);
          cv.toBlob(function (b) {
            if (!b) { done = true; clearTimeout(timer); reject(new Error('PNG 를 만들지 못했습니다(캔버스 크기 한도 초과일 수 있습니다)')); return; }
            b.arrayBuffer().then(function (buf) {
              done = true; clearTimeout(timer);
              resolve(new Blob([pngSetDpi(new Uint8Array(buf), dpi)], { type: 'image/png' }));
            }, function () { done = true; clearTimeout(timer); resolve(b); });
          }, 'image/png');
        } catch (e) { done = true; clearTimeout(timer); reject(e); }
      };
      img.onerror = function () { if (!done) { done = true; clearTimeout(timer); reject(new Error('SVG 를 이미지로 읽지 못했습니다')); } };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
