/* 사건 연표 - 화면 타임라인 (담당: 화면 타임라인)
 * 공개 API (CONTRACT 4.1)
 *   SY.Viz.timeline(el, C, opts) -> ctrl { update(partialOpts), zoomBy(factor), fit(), select(factId), destroy() }
 *   SY.Viz.factDetail(el, C, factId, opts?) -> { destroy() }
 * 시험용 순수함수 (DOM 비의존, node 에서 common.js 다음에 로드해 시험)
 *   SY.Viz._layout(facts, { scale, width, cardW, cardH, ... }) -> 배치 결과
 * common.js(SY.date, SY.esc, SY.REL ...)는 정의 시점이 아니라 호출 시점에 참조한다. */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};
  var Viz = SY.Viz = SY.Viz || {};
  var DAY = 86400000;
  var MAXW = 400000;            // 확대 시 캔버스 최대 폭(px)

  /* ================= 순수 배치 계산 ================= */
  var LDEF = {
    scale: 'real', width: 1000,
    cardW: 168, cardH: 78, tierGap: 12, axisGap: 40, topPad: 12, botPad: 12,
    pad: 28,            // 시간축 양 끝 여백
    edge: 6,            // 카드가 캔버스 가장자리에서 떨어지는 최소 거리
    gapX: 8,            // 같은 단 카드 사이 최소 간격
    maxShift: null,     // 카드를 기준점에서 오른쪽으로 밀 수 있는 최대 거리(기본 cardW*0.9)
    breakW: 44,         // 생략 구간(물결선) 폭
    gapDays: 120,       // 공백 압축 기준 1: 이 일수 초과
    gapFrac: 0.08,      // 공백 압축 기준 2: 전체 기간의 이 비율 초과 (둘 중 큰 값)
    breakMarginDays: 15,// 생략 구간 양옆에 실제 비율로 남기는 일수
    approxDays: 7,      // '○○경'의 흐린 구간 반폭(일)
    evenFuzzPx: 12, minFuzzPx: 10,
    agreedSide: 'balance' // 다툼없음 카드: 'balance'(덜 붐비는 쪽) | 'up' | 'down'
  };
  var SIDE_ORD = { p: 0, a: 1, d: 2 };
  var LANE_DY = [0, -7, 7, -14, 14];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function numSort(a, b) { return a - b; }
  function textW(s, fs) {
    var w = 0; s = String(s);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += c >= 0x1100 ? fs : (c === 32 ? fs * 0.32 : fs * 0.6);
    }
    return w;
  }

  /* 날짜 객체 -> 시간선 기준점. t: 기준 시각, lo/hi: 차지하는 구간, fz: 흐린 구간, rg: 기간 */
  function anchorOf(d, o) {
    if (!d || !d.start) return null;
    var sp = SY.date.span(d);
    if (!sp) return null;
    var p = SY.PRECISION.indexOf(sp.precision) >= 0 ? sp.precision : 'day';
    var a = { t: sp.start, p: p, fz: null, rg: null, label: SY.date.label(d), endIso: d.end || null };
    if (p === 'range') {
      if (sp.end > sp.start) a.rg = [sp.start, sp.end];
    } else if (p === 'approx') {
      a.fz = [sp.start - o.approxDays * DAY, sp.start + o.approxDays * DAY];
    } else if (p === 'month' || p === 'year') {
      var dt = new Date(sp.start), y = dt.getUTCFullYear(), m = dt.getUTCMonth();
      var s = p === 'month' ? Date.UTC(y, m, 1) : Date.UTC(y, 0, 1);
      var e = p === 'month' ? Date.UTC(y, m + 1, 1) : Date.UTC(y + 1, 0, 1);
      var pe = SY.date.parseISO(d.end);
      if (pe != null && pe + DAY > e) e = pe + DAY;
      a.fz = [s, e];
      a.t = s + Math.round((e - s) / 2 / DAY) * DAY;   // 구간 가운데에 점
    }
    a.lo = a.rg ? a.rg[0] : (a.fz ? a.fz[0] : a.t);
    a.hi = a.rg ? a.rg[1] : (a.fz ? a.fz[1] : a.t);
    return a;
  }
  function sameAnchor(a, b) { return a.t === b.t && a.lo === b.lo && a.hi === b.hi && a.p === b.p; }

  /* 사실 -> 표시 항목. 다툼없음은 'a'(축 위 한 점), 그 외 원고 'p'(위)/피고 'd'(아래) */
  function collect(facts, o) {
    var items = [], skipped = [];
    facts.forEach(function (f, fi) {
      if (!f) return;
      var disp = SY.DISPUTE.indexOf(f.dispute) >= 0 ? f.dispute : '미확정';
      var main = anchorOf(f.date, o);
      var sides = [];
      if (disp === '다툼없음') {
        var src = f.plaintiff || f.defendant || null;
        var a = main || anchorOf(src && src.date, o);
        if (a) sides.push({ side: 'a', anc: a, nar: src });
      } else {
        if (f.plaintiff) { var ap = anchorOf(f.plaintiff.date, o) || main; if (ap) sides.push({ side: 'p', anc: ap, nar: f.plaintiff }); }
        if (f.defendant) { var ad = anchorOf(f.defendant.date, o) || main; if (ad) sides.push({ side: 'd', anc: ad, nar: f.defendant }); }
        if (!f.plaintiff && !f.defendant && main) sides.push({ side: 'a', anc: main, nar: null });
      }
      if (!sides.length) { skipped.push(f.id); return; }
      items.push({ f: f, fi: fi, disp: disp, sides: sides });
    });
    return { items: items, skipped: skipped };
  }

  function domainOf(items) {
    var iv = [], keys = [];
    items.forEach(function (it) {
      it.sides.forEach(function (s) {
        var a = s.anc;
        iv.push([a.lo, a.hi]);
        keys.push(a.t);
        if (a.rg) keys.push(a.rg[1]);
      });
    });
    keys.sort(numSort);
    var uk = [];
    keys.forEach(function (k) { if (!uk.length || uk[uk.length - 1] !== k) uk.push(k); });
    return { iv: iv, keys: uk };
  }

  /* 구간별 선형 척도. segs: [{t0,t1,x0,x1,brk}] 로 x(t), t(x) 양방향 변환 */
  function mkScale(segs, breaks, mode, width, unit) {
    var n = segs.length, first = segs[0], last = segs[n - 1];
    function find(v, k0, k1) {
      var lo = 0, hi = n - 1;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (segs[mid][k1] < v) lo = mid + 1; else hi = mid; }
      return segs[lo];
    }
    return {
      mode: mode, segs: segs, breaks: breaks, width: width, unit: unit,
      t0: first.t0, t1: last.t1,
      x: function (t) {
        if (t <= first.t0) return first.x0;
        if (t >= last.t1) return last.x1;
        var s = find(t, 't0', 't1');
        return s.t1 === s.t0 ? s.x0 : s.x0 + (t - s.t0) / (s.t1 - s.t0) * (s.x1 - s.x0);
      },
      t: function (x) {
        if (x <= first.x0) return first.t0;
        if (x >= last.x1) return last.t1;
        var s = find(x, 'x0', 'x1');
        return s.x1 === s.x0 ? s.t0 : s.t0 + (x - s.x0) / (s.x1 - s.x0) * (s.t1 - s.t0);
      }
    };
  }

  function buildScale(dom, mode, width, o) {
    var pad = Math.min(o.pad, width / 4), avail = Math.max(1, width - 2 * pad);
    var segs = [], breaks = [];
    if (!dom.keys.length) return mkScale([{ t0: 0, t1: 0, x0: width / 2, x1: width / 2 }], [], mode, width, 0);
    if (mode === 'even') {
      var k = dom.keys;
      if (k.length === 1) return mkScale([{ t0: k[0], t1: k[0], x0: width / 2, x1: width / 2 }], [], 'even', width, avail);
      var step = avail / (k.length - 1);
      for (var i = 0; i < k.length - 1; i++) segs.push({ t0: k[i], t1: k[i + 1], x0: pad + i * step, x1: pad + (i + 1) * step });
      return mkScale(segs, [], 'even', width, step);
    }
    var iv = dom.iv.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var m = [];
    iv.forEach(function (r) {
      if (m.length && r[0] <= m[m.length - 1][1]) m[m.length - 1][1] = Math.max(m[m.length - 1][1], r[1]);
      else m.push([r[0], r[1]]);
    });
    var tMin = m[0][0], tMax = m[m.length - 1][1];
    if (tMax <= tMin) return mkScale([{ t0: tMin, t1: tMin, x0: width / 2, x1: width / 2 }], [], 'real', width, 0);
    var spanDays = (tMax - tMin) / DAY;
    var thr = Math.max(o.gapDays, o.gapFrac * spanDays) * DAY;
    var gaps = [];
    for (var j = 1; j < m.length; j++) {
      var g = m[j][0] - m[j - 1][1];
      if (g > thr) {
        var mg = Math.min(o.breakMarginDays * DAY, g * 0.15);
        gaps.push([m[j - 1][1] + mg, m[j][0] - mg]);
      }
    }
    var nB = gaps.length;
    var bw = nB ? Math.min(o.breakW, avail * 0.35 / nB) : 0;
    var normal = tMax - tMin;
    gaps.forEach(function (gp) { normal -= gp[1] - gp[0]; });
    var pxPerMs = (avail - nB * bw) / normal;
    var x = pad, t = tMin;
    gaps.forEach(function (gp) {
      var x1 = x + (gp[0] - t) * pxPerMs;
      segs.push({ t0: t, t1: gp[0], x0: x, x1: x1 });
      segs.push({ t0: gp[0], t1: gp[1], x0: x1, x1: x1 + bw, brk: true });
      breaks.push({ x0: x1, x1: x1 + bw, t0: gp[0], t1: gp[1], days: Math.round((gp[1] - gp[0]) / DAY) });
      x = x1 + bw; t = gp[1];
    });
    segs.push({ t0: t, t1: tMax, x0: x, x1: x + (tMax - t) * pxPerMs });
    return mkScale(segs, breaks, 'real', width, pxPerMs * DAY);
  }

  function tickTimes(t0, t1, unit) {
    var out = [], d = new Date(t0), y = d.getUTCFullYear(), m = d.getUTCMonth(), t, k;
    if (unit === 'day' || unit === 'week') {
      t = Date.UTC(y, m, d.getUTCDate()); if (t < t0) t += DAY;
      for (; t <= t1 && out.length < 50000; t += DAY) {
        var dd = new Date(t).getUTCDate();
        if (unit === 'day' || dd === 1 || dd === 8 || dd === 15 || dd === 22) out.push(t);
      }
    } else if (unit === 'month' || unit === 'quarter') {
      var st = unit === 'month' ? 1 : 3, mm = m - (m % st);
      for (k = 0; k < 100000; k++) { t = Date.UTC(y, mm + k * st, 1); if (t > t1) break; if (t >= t0) out.push(t); }
    } else {
      var ys = unit === 'year' ? 1 : (unit === 'year2' ? 2 : 5), yy = y - (((y % ys) + ys) % ys);
      for (k = 0; k < 10000; k++, yy += ys) { t = Date.UTC(yy, 0, 1); if (t > t1) break; if (t >= t0) out.push(t); }
    }
    return out;
  }
  function tickLabel(t, unit) {
    var d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, dd = d.getUTCDate();
    if (unit === 'day' || unit === 'week') return dd === 1 ? y + '. ' + m + '. 1.' : m + '. ' + dd + '.';
    if (unit === 'month' || unit === 'quarter') return y + '. ' + m + '.';
    return y + '.';
  }
  function placeLabels(cands, occupied, width, gap) {
    var out = [], lastR = -Infinity;
    cands.sort(function (a, b) { return a.x - b.x; }).forEach(function (c) {
      var l = c.x - c.w / 2, r = c.x + c.w / 2;
      if (l < 2 || r > width - 2 || l < lastR + gap) return;
      for (var i = 0; i < occupied.length; i++) if (l < occupied[i][1] + gap && r > occupied[i][0] - gap) return;
      out.push(c); lastR = r;
    });
    return out;
  }
  function makeTicks(sc, dom, width, occupied) {
    var fs = 11, cands = [], seen = {};
    if (sc.mode === 'real') {
      var pd = sc.unit, U = 60;
      if (!pd) return [];
      var unit = pd >= U ? 'day' : pd * 7 >= U ? 'week' : pd * 30.44 >= U ? 'month' : pd * 91.3 >= U ? 'quarter' :
        pd * 365.25 >= U ? 'year' : pd * 730.5 >= U ? 'year2' : 'year5';
      sc.segs.forEach(function (s) {
        if (s.brk) return;
        tickTimes(s.t0, s.t1, unit).forEach(function (t) {
          if (seen[t]) return; seen[t] = 1;
          var d = new Date(t), lab = tickLabel(t, unit);
          var major = (unit === 'day' || unit === 'week') ? d.getUTCDate() === 1 : (unit === 'month' || unit === 'quarter') ? d.getUTCMonth() === 0 : true;
          cands.push({ x: sc.x(t), t: t, label: lab, major: major, w: textW(lab, fs) });
        });
      });
    } else {
      var prev = null;
      dom.keys.forEach(function (t) {
        var d = new Date(t), ym = d.getUTCFullYear() * 12 + d.getUTCMonth();
        if (ym === prev) return;
        var major = prev == null || Math.floor(prev / 12) !== d.getUTCFullYear();
        prev = ym;
        var lab = d.getUTCFullYear() + '. ' + (d.getUTCMonth() + 1) + '.';
        cands.push({ x: sc.x(t), t: t, label: lab, major: major, w: textW(lab, fs) });
      });
    }
    return placeLabels(cands, occupied, width, 10);
  }

  /* 배치 계산 본체 */
  Viz._layout = function (facts, opt) {
    var o = Object.assign({}, LDEF, opt || {});
    for (var key in LDEF) if (o[key] == null && key !== 'maxShift') o[key] = LDEF[key];
    var width = Math.max(120, +o.width || LDEF.width);
    var mode = o.scale === 'even' ? 'even' : 'real';
    var cardW = Math.max(60, Math.min(o.cardW, width - 2 * o.edge));
    var cardH = o.cardH;
    var maxShift = o.maxShift != null ? o.maxShift : cardW * 0.9;
    var col = collect(facts || [], o);
    var dom = domainOf(col.items);
    var sc = buildScale(dom, mode, width, o);
    var marks = [], links = [], cards = [];

    col.items.forEach(function (it) {
      var f = it.f, groups = [], xs = {};
      it.sides.forEach(function (s) {
        var g = null;
        for (var i = 0; i < groups.length; i++) if (sameAnchor(groups[i].anc, s.anc)) g = groups[i];
        if (g) g.sides.push(s.side); else groups.push({ anc: s.anc, sides: [s.side] });
      });
      groups.forEach(function (g) {
        var a = g.anc, mx = sc.x(a.t);
        var mk = { factId: f.id, side: g.sides.join(''), x: mx, t: a.t, dispute: it.disp, precision: a.p, fuzzy: null, range: null };
        if (a.fz) {
          var x0, x1;
          if (mode === 'real') { x0 = sc.x(a.fz[0]); x1 = sc.x(a.fz[1]); }
          else { var hw = clamp(sc.unit * 0.4, 4, o.evenFuzzPx); x0 = mx - hw; x1 = mx + hw; }
          x0 = Math.min(x0, mx - o.minFuzzPx / 2); x1 = Math.max(x1, mx + o.minFuzzPx / 2);
          mk.fuzzy = { x0: x0, x1: x1 };
        }
        if (a.rg) {
          var endLab = a.endIso ? SY.date.fmtKo(a.endIso, 'day') : '';
          mk.range = { x0: mx, x1: Math.max(mx + 2, sc.x(a.rg[1])), lane: 0, dy: 0, endLabel: endLab };
        }
        marks.push(mk);
        g.sides.forEach(function (s) { xs[s] = mx; });
      });
      if (groups.length === 2 && xs.p != null && xs.d != null) links.push({ factId: f.id, x1: xs.p, x2: xs.d });
      it.sides.forEach(function (s) {
        var nar = s.nar || {};
        cards.push({
          key: f.id + ':' + s.side, factId: f.id, side: s.side, ax: xs[s.side], fi: it.fi,
          dispute: it.disp, title: String(f.title || ''), dateLabel: s.anc.label,
          evidence: (nar.evidence || []).slice(), text: String(nar.text || ''), precision: s.anc.p
        });
      });
    });

    /* 기간 막대 차선 */
    var rl = [];
    marks.filter(function (m) { return m.range; }).sort(function (a, b) { return a.range.x0 - b.range.x0; }).forEach(function (m) {
      var l = 0; while (l < rl.length && rl[l] > m.range.x0 - 2) l++;
      rl[l] = m.range.x1; m.range.lane = l; m.range.dy = LANE_DY[l % LANE_DY.length];
    });

    /* 카드 단 배치: 기준점 순서로 각 카드를 가장 낮은 단에 넣어 본다. 한 단 안의 위치는
       '기준점 가운데 정렬에서 벗어난 거리 제곱합 최소 + 겹침 없음 + 캔버스 안' 문제의 최적해(등위회귀 PAVA)로 정하고,
       어느 카드든 maxShift 보다 멀리 밀려야 하면 그 단은 불가로 보고 다음 단으로 간다. */
    var tiers = { up: [], down: [] }, cnt = { up: 0, down: 0 };
    cards.sort(function (a, b) { return a.ax - b.ax || a.fi - b.fi || SIDE_ORD[a.side] - SIDE_ORD[b.side]; });
    var maxRight = width - o.edge, pitch = cardW + o.gapX, loX = o.edge, hiX = maxRight - cardW;
    function pack(Ls) {
      var n = Ls.length, U = hiX - (n - 1) * pitch;
      if (U < loX - 1e-6) return null;
      var bv = [], bw = [];
      for (var i = 0; i < n; i++) {
        var v = Ls[i] - i * pitch, w = 1;
        while (bv.length && bv[bv.length - 1] > v) { var pv = bv.pop(), pw = bw.pop(); v = (pv * pw + v * w) / (pw + w); w += pw; }
        bv.push(v); bw.push(w);
      }
      var xs = [], k = 0;
      for (var b = 0; b < bv.length; b++) { var z = clamp(bv[b], loX, U); for (var j = 0; j < bw[b]; j++, k++) xs.push(z + k * pitch); }
      for (var q = 0; q < n; q++) if (Math.abs(xs[q] - Ls[q]) > maxShift + 1e-6) return null;
      return xs;
    }
    function tryFit(arr, L) {
      for (var t = 0; t < arr.length; t++) {
        var xs = pack(arr[t].L.concat([L]));
        if (xs) return { tier: t, xs: xs };
      }
      return { tier: arr.length, xs: [L] };
    }
    cards.forEach(function (c, i) {
      var L = clamp(c.ax - cardW / 2, loX, hiX);
      var dir = c.side === 'p' ? 'up' : (c.side === 'd' ? 'down' : null);
      var fu = null, fd = null;
      if (!dir) {
        if (o.agreedSide === 'up' || o.agreedSide === 'down') dir = o.agreedSide;
        else {
          fu = tryFit(tiers.up, L); fd = tryFit(tiers.down, L);
          dir = fu.tier < fd.tier ? 'up' : (fd.tier < fu.tier ? 'down' : (cnt.up <= cnt.down ? 'up' : 'down'));
        }
      }
      var ft = dir === 'up' && fu ? fu : (dir === 'down' && fd ? fd : tryFit(tiers[dir], L));
      var tr = tiers[dir][ft.tier] || (tiers[dir][ft.tier] = { L: [], cards: [] });
      tr.L.push(L); tr.cards.push(c);
      tr.cards.forEach(function (cc, k) { cc.x = ft.xs[k]; });
      cnt[dir]++;
      c.dir = dir; c.tier = ft.tier; c.w = cardW; c.h = cardH; c.order = i;
    });

    var nUp = tiers.up.length, nDown = tiers.down.length, tierH = cardH + o.tierGap;
    var axisY = o.topPad + o.axisGap + (nUp ? nUp * tierH - o.tierGap : 0);
    var height = axisY + o.axisGap + (nDown ? nDown * tierH - o.tierGap : 0) + o.botPad;
    cards.forEach(function (c) {
      c.y = c.dir === 'up' ? axisY - o.axisGap - cardH - c.tier * tierH : axisY + o.axisGap + c.tier * tierH;
      var cx = clamp(c.ax, c.x + 10, c.x + c.w - 10);
      var edgeY = c.dir === 'up' ? c.y + cardH : c.y;
      var ay = c.dir === 'up' ? axisY - 6 : axisY + 6;
      if (Math.abs(cx - c.ax) < 0.5) c.stem = [[c.ax, ay], [c.ax, edgeY]];
      else {
        var off = c.tier === 0 ? 12 : o.tierGap / 2;
        var ey = c.dir === 'up' ? edgeY + off : edgeY - off;
        c.stem = [[c.ax, ay], [c.ax, ey], [cx, edgeY]];
      }
    });

    /* 생략 구간 라벨, 눈금, 기간 끝 라벨 */
    var occupied = [], brks = sc.breaks.map(function (b) {
      var months = Math.round(b.days / 30.44);
      var label = months >= 1 ? '약 ' + months + '개월 생략' : '약 ' + b.days + '일 생략';
      return { x0: b.x0, x1: b.x1, t0: b.t0, t1: b.t1, days: b.days, months: months, label: label, w: textW(label, 11), row: 0 };
    });
    var lastR = [-Infinity, -Infinity];
    brks.forEach(function (b) {
      var cx = clamp((b.x0 + b.x1) / 2, b.w / 2 + 2, width - b.w / 2 - 2);
      b.lx = cx;
      b.row = (cx - b.w / 2 < lastR[0] + 6) ? 1 : 0;
      lastR[b.row] = cx + b.w / 2;
      occupied.push([cx - b.w / 2, cx + b.w / 2]);
    });
    var ticks = makeTicks(sc, dom, width, occupied);
    var rcands = [];
    marks.forEach(function (m) {
      if (!m.range || !m.range.endLabel || m.range.x1 - m.range.x0 < 40) return;
      var lab = '~ ' + m.range.endLabel;
      var lw = textW(lab, 11);
      rcands.push({ x: clamp(m.range.x1, lw / 2 + 3, width - lw / 2 - 3), label: lab, w: lw, factId: m.factId, dy: m.range.dy });
    });
    var rangeLabels = placeLabels(rcands, [], width, 6);

    return {
      mode: mode, width: width, height: height, axisY: axisY, cardW: cardW, cardH: cardH,
      tierGap: o.tierGap, axisGap: o.axisGap,
      tiers: { up: nUp, down: nDown }, scale: sc, domain: dom,
      cards: cards, marks: marks, links: links, breaks: brks, ticks: ticks, rangeLabels: rangeLabels,
      skipped: col.skipped, count: col.items.length, opts: o
    };
  };
  Viz._buildScale = function (dom, mode, width, opt) { return buildScale(dom, mode, width, Object.assign({}, LDEF, opt || {})); };

  /* ================= 공용 표시 조각 ================= */
  var DISP_CLS = { '다툼없음': 'agree', '일부다툼': 'part', '다툼': 'disp', '미확정': 'open' };
  function f1(n) { return Math.round(n * 10) / 10; }
  function dispShape(d, x, y, r) {
    var c = DISP_CLS[d] || 'open';
    x = f1(x); y = f1(y);
    var circ = '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>';
    if (c === 'agree') return '<g class="mk mk-agree">' + circ + '</g>';
    if (c === 'part') return '<g class="mk mk-part">' + circ + '<path d="M' + x + ' ' + f1(y - r) + 'A' + r + ' ' + r + ' 0 0 0 ' + x + ' ' + f1(y + r) + 'Z"/></g>';
    if (c === 'disp') { var k = f1(r * 0.7); return '<g class="mk mk-disp">' + circ + '<line x1="' + f1(x - k) + '" y1="' + f1(y + k) + '" x2="' + f1(x + k) + '" y2="' + f1(y - k) + '"/></g>'; }
    return '<g class="mk mk-open">' + circ + '</g>';
  }
  function dispIcon(d) {
    return '<svg class="sy-tl-ic" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true" focusable="false">' + dispShape(d, 0, 0, 5) + '</svg>';
  }
  Viz._dispIcon = dispIcon;

  /* ================= 화면 타임라인 ================= */
  var instSeq = 0;
  var SIDE_NAME = { p: '원고 주장', d: '피고 주장', a: '양측 일치' };
  var LEGEND_SIDE = { p: '원고 주장(시간선 위)', d: '피고 주장(시간선 아래)', a: '다툼 없는 사실(공통)' };

  function legendHTML() {
    var li = SY.DISPUTE.map(function (d) { return '<li>' + dispIcon(d) + '<span>' + d + '</span></li>'; });
    ['p', 'd', 'a'].forEach(function (s) { li.push('<li><span class="sy-tl-sw ' + s + '" aria-hidden="true"></span><span>' + LEGEND_SIDE[s] + '</span></li>'); });
    li.push('<li><svg class="sy-tl-ic wide" width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false"><rect class="lg-fz" x="1" y="3" width="26" height="8" rx="3"/><circle class="lg-dot" cx="14" cy="7" r="2.5"/></svg><span>○○경·월·연 단위(흐린 구간)</span></li>');
    li.push('<li><svg class="sy-tl-ic wide" width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false"><line class="lg-rg" x1="4" y1="7" x2="24" y2="7"/><circle class="lg-dot" cx="4" cy="7" r="2.5"/><circle class="lg-dot" cx="24" cy="7" r="2.5"/></svg><span>기간(막대)</span></li>');
    li.push('<li><svg class="sy-tl-ic wide" width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false"><path class="lg-link" d="M3 11 Q14 0 25 11"/></svg><span>양측 주장 일자가 다름</span></li>');
    li.push('<li><svg class="sy-tl-ic wide" width="28" height="14" viewBox="0 0 28 14" aria-hidden="true" focusable="false"><path class="lg-brk" d="M2 7 Q5.5 2 9 7 T16 7 T23 7 T27 7"/></svg><span>긴 공백 생략(물결선)</span></li>');
    return '<ul class="sy-tl-lg">' + li.join('') + '</ul>' +
      '<p class="sy-tl-help">카드를 누르거나 Enter로 선택하면 오른쪽 창에 근거 서면과 주장 변천이 나타납니다. ' +
      '←→ 또는 Tab으로 이동하고 Home·End로 처음과 끝으로 갑니다. Esc는 선택 해제입니다. ' +
      '확대·축소는 버튼, Ctrl+휠, +·− 키로 하고, 끌거나 스크롤해 옮깁니다. 아래 미니맵을 끌어 보고 싶은 기간을 지정할 수 있습니다.</p>';
  }

  function tmpl() {
    return '' +
      '<div class="sy-tl-bar" role="toolbar" aria-label="타임라인 보기 도구">' +
        '<div class="sy-tl-grp" role="group" aria-label="척도">' +
          '<button type="button" class="sy-tl-btn" data-act="scale" data-v="real" aria-pressed="false" title="실제 날짜 간격에 비례해 배치합니다. 긴 공백은 물결선으로 줄입니다">실제 간격</button>' +
          '<button type="button" class="sy-tl-btn" data-act="scale" data-v="even" aria-pressed="false" title="날짜 순서대로 같은 간격으로 배치합니다">순서 등간격</button>' +
        '</div>' +
        '<div class="sy-tl-grp" role="group" aria-label="확대와 축소">' +
          '<button type="button" class="sy-tl-btn" data-act="zoom-out">축소</button>' +
          '<button type="button" class="sy-tl-btn" data-act="zoom-in">확대</button>' +
          '<button type="button" class="sy-tl-btn" data-act="fit" title="전체 기간을 한 화면에 맞춥니다">맞춤</button>' +
        '</div>' +
        '<div class="sy-tl-grp sy-tl-range" role="group" aria-label="기간 지정">' +
          '<label class="sy-tl-lbl"><span>시작</span><input type="date" data-in="from"></label>' +
          '<label class="sy-tl-lbl"><span>종료</span><input type="date" data-in="to"></label>' +
          '<button type="button" class="sy-tl-btn" data-act="clear-range">기간 해제</button>' +
        '</div>' +
        '<span class="sy-tl-status" role="status" aria-live="polite"></span>' +
      '</div>' +
      '<details class="sy-tl-legend"><summary>범례와 조작법</summary>' + legendHTML() + '</details>' +
      '<div class="sy-tl-vp" role="region" aria-label="사건 연표. 가운데 시간선, 위쪽은 원고 주장, 아래쪽은 피고 주장, 선 위의 점은 다툼 없는 사실입니다">' +
        '<div class="sy-tl-canvas">' +
          '<svg class="sy-tl-svg" aria-hidden="true" focusable="false"></svg>' +
          '<svg class="sy-tl-over" aria-hidden="true" focusable="false"></svg>' +
          '<div class="sy-tl-cards" role="group" aria-label="사실 카드. 좌우 화살표 또는 Tab으로 이동하고 Enter로 선택합니다"></div>' +
        '</div>' +
      '</div>' +
      '<div class="sy-tl-empty" hidden></div>' +
      '<div class="sy-tl-mini" tabindex="0" role="group" aria-label="전체 기간 미니맵. 끌어서 보이는 구간을 옮기거나 새 구간을 지정합니다. 좌우 화살표로 옮깁니다">' +
        '<svg aria-hidden="true" focusable="false"></svg>' +
      '</div>';
  }

  function raf(fn) { return (root.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(fn); }
  function caf(id) { (root.cancelAnimationFrame || clearTimeout)(id); }
  function pts(arr) { return arr.map(function (p) { return f1(p[0]) + ',' + f1(p[1]); }).join(' '); }
  function squiggle(x0, x1, y, amp) {
    var w = x1 - x0; if (w < 6) return 'M' + f1(x0) + ' ' + f1(y) + 'L' + f1(x1) + ' ' + f1(y);
    var n = Math.max(2, Math.round(w / 8)), st = w / n, d = 'M' + f1(x0) + ' ' + f1(y);
    for (var i = 0; i < n; i++) d += 'Q' + f1(x0 + (i + 0.5) * st) + ' ' + f1(y + (i % 2 ? amp : -amp)) + ' ' + f1(x0 + (i + 1) * st) + ' ' + f1(y);
    return d;
  }

  function filterFacts(C, o) {
    var from = SY.date.parseISO(o.from), to = SY.date.parseISO(o.to);
    if (to != null) to += DAY - 1;
    return (C.facts || []).filter(function (f) {
      if (!f) return false;
      if (o.issueId && (f.issueIds || []).indexOf(o.issueId) < 0) return false;
      if (from == null && to == null) return true;
      var spans = [f.date, f.plaintiff && f.plaintiff.date, f.defendant && f.defendant.date].map(function (d) { return d ? SY.date.span(d) : null; }).filter(Boolean);
      if (!spans.length) return true;
      return spans.some(function (s) { return (from == null || s.end >= from) && (to == null || s.start <= to); });
    });
  }
  Viz._filterFacts = filterFacts;

  Viz.timeline = function (el, C, opts) {
    if (!el) throw new Error('SY.Viz.timeline: 컨테이너가 없습니다');
    C = C || {};
    var o = Object.assign({ scale: 'real', issueId: null, from: null, to: null, selectedId: null, onSelect: null, onChange: null }, opts || {});
    if (o.scale !== 'even') o.scale = 'real';
    var uid = 'sytl' + (++instSeq);
    var st = {
      zoom: 1, maxZoom: 1, L: null, facts: [], sel: o.selectedId || null, hot: null, rove: null,
      rendered: null, cardEls: {}, cardByKey: {}, cardsByFact: {}, marksByFact: {}, orderIdx: {},
      vw: 0, dead: false, rafScroll: 0, rafZoom: 0, rafResize: 0, pz: null, drag: null, mmDrag: null, mmScale: null
    };
    el.innerHTML = '';
    var rootEl = document.createElement('div');
    rootEl.className = 'sy-tl';
    rootEl.innerHTML = tmpl();
    el.appendChild(rootEl);
    function q(s) { return rootEl.querySelector(s); }
    var bar = q('.sy-tl-bar'), legend = q('.sy-tl-legend'), vp = q('.sy-tl-vp'), canvas = q('.sy-tl-canvas'),
      svg = q('.sy-tl-svg'), cardsEl = q('.sy-tl-cards'), over = q('.sy-tl-over'), emptyEl = q('.sy-tl-empty'),
      mmBox = q('.sy-tl-mini'), mm = q('.sy-tl-mini svg'), statusEl = q('.sy-tl-status'),
      inFrom = q('[data-in=from]'), inTo = q('[data-in=to]');
    if ((el.clientWidth || 0) >= 560) legend.open = true;

    var issueById = SY.byId(C.issues || []);
    var allRange = SY.factRange(C);
    if (allRange) {
      var iso = function (t) { return new Date(t).toISOString().slice(0, 10); };
      inFrom.min = inTo.min = iso(allRange.start); inFrom.max = inTo.max = iso(allRange.end);
    }

    function layoutOpts(narrow) { return { cardW: narrow ? 136 : 168, cardH: 78 }; }
    function emit(p) { if (typeof o.onChange === 'function') { try { o.onChange(p); } catch (e) { if (root.console) console.error(e); } } }

    /* ---------- 배치 ---------- */
    function relayout(keep) {
      if (st.dead) return;
      var vw = vp.clientWidth;
      if (!vw || !st.facts.length) { st.vw = vw; if (!st.facts.length) showEmpty(); return; }
      var narrow = (rootEl.clientWidth || vw) < 560;
      rootEl.classList.toggle('is-narrow', narrow);
      st.vw = vw;
      st.lopts = layoutOpts(narrow);
      var oldAxisOff = st.L ? st.L.axisY - vp.scrollTop : null;
      // 확대 한도: 실제 간격은 하루 80px, 등간격은 한 칸 카드 3장 폭
      var base = buildScale(domainFor(), o.scale, vw, Object.assign({}, LDEF, st.lopts));
      var mz = base.unit > 0 ? (o.scale === 'real' ? 80 / base.unit : (st.lopts.cardW * 3) / base.unit) : 1;
      st.maxZoom = clamp(mz, 1, MAXW / vw);
      st.zoom = clamp(st.zoom, 1, st.maxZoom);
      if (st.autoZoom) { st.autoZoom = false; st.zoom = pickZoom(vw); }
      var W = Math.max(vw, Math.min(MAXW, Math.round(vw * st.zoom)));
      st.L = Viz._layout(st.facts, Object.assign({}, st.lopts, { scale: o.scale, width: W }));
      indexLayout();
      canvas.style.width = W + 'px';
      canvas.style.height = st.L.height + 'px';
      [svg, over].forEach(function (s) { s.setAttribute('width', W); s.setAttribute('height', st.L.height); s.setAttribute('viewBox', '0 0 ' + W + ' ' + st.L.height); });
      if (keep && keep.t != null) vp.scrollLeft = st.L.scale.x(keep.t) - keep.off;
      else if (keep && keep.left != null) vp.scrollLeft = keep.left;
      if (keep && keep.v === 'center' || oldAxisOff == null) vp.scrollTop = Math.max(0, st.L.axisY - vp.clientHeight / 2);
      else vp.scrollTop = st.L.axisY - oldAxisOff;
      st.rendered = null;
      renderLayers(true);
      renderMini();
      syncControls();
    }
    var domCache = null;
    function domainFor() {
      if (!domCache) domCache = domainOf(collect(st.facts, LDEF).items);
      return domCache;
    }
    /* 처음 보기: 한쪽 단 수가 TIER_TARGET 이하가 되는 가장 작은 확대 단계(사실이 적으면 전체 맞춤과 같다) */
    var TIER_TARGET = 6, ZOOM_STEPS = [1, 1.25, 1.6, 2, 2.5, 3.2, 4, 5, 6.4, 8, 10, 13, 16, 20];
    function pickZoom(vw) {
      for (var i = 0; i < ZOOM_STEPS.length; i++) {
        var z = ZOOM_STEPS[i];
        if (z > st.maxZoom) return st.maxZoom;
        var Lz = Viz._layout(st.facts, Object.assign({}, st.lopts, { scale: o.scale, width: Math.round(vw * z) }));
        if (Math.max(Lz.tiers.up, Lz.tiers.down) <= TIER_TARGET) return z;
      }
      return Math.min(st.maxZoom, ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    }
    function indexLayout() {
      var L = st.L;
      st.cardByKey = {}; st.cardsByFact = {}; st.marksByFact = {}; st.orderIdx = {}; st.linksByFact = {};
      L.cards.forEach(function (c, i) {
        st.cardByKey[c.key] = c; st.orderIdx[c.key] = i;
        (st.cardsByFact[c.factId] = st.cardsByFact[c.factId] || []).push(c);
      });
      L.marks.forEach(function (m) { (st.marksByFact[m.factId] = st.marksByFact[m.factId] || []).push(m); });
      L.links.forEach(function (k) { st.linksByFact[k.factId] = k; });
      if (st.rove && !st.cardByKey[st.rove]) st.rove = null;
    }

    /* ---------- 그리기 (보이는 구간 + 좌우 한 화면만) ---------- */
    function windowRange() {
      var vw = vp.clientWidth, sl = vp.scrollLeft, W = st.L.width;
      if (W <= vw * 3) return { lo: -1, hi: W + 1, all: true };
      return { lo: sl - vw, hi: sl + vw * 2, all: false };
    }
    function inR(a, b, r) { return b >= r.lo && a <= r.hi; }

    function renderLayers(force) {
      var L = st.L; if (!L || st.dead) return;
      var vw = vp.clientWidth, sl = vp.scrollLeft;
      if (!force && st.rendered && (st.rendered.all || (sl >= st.rendered.lo + vw * 0.25 && sl + vw <= st.rendered.hi - vw * 0.25))) return;
      var r = windowRange(); st.rendered = r;
      var A = L.axisY, H = L.height, W = L.width, out = [];
      out.push('<defs>' + ['p', 'd', 'a'].map(function (s) {
        return '<linearGradient id="' + uid + '-fz-' + s + '" x1="0" x2="1" y1="0" y2="0">' +
          '<stop offset="0" class="fzs fzs-' + s + '" style="stop-opacity:.04"/><stop offset=".5" class="fzs fzs-' + s + '" style="stop-opacity:.42"/><stop offset="1" class="fzs fzs-' + s + '" style="stop-opacity:.04"/></linearGradient>';
      }).join('') + '</defs>');
      // 생략 구간 바탕과 축
      var xs = 0;
      L.breaks.forEach(function (b) {
        out.push('<rect class="brk-bg" x="' + f1(b.x0) + '" y="0" width="' + f1(b.x1 - b.x0) + '" height="' + H + '"/>');
        out.push('<line class="ax" x1="' + f1(xs) + '" y1="' + A + '" x2="' + f1(b.x0) + '" y2="' + A + '"/>');
        out.push('<path class="brk" d="' + squiggle(b.x0, b.x1, A, 5) + '"/>');
        xs = b.x1;
      });
      out.push('<line class="ax" x1="' + f1(xs) + '" y1="' + A + '" x2="' + W + '" y2="' + A + '"/>');
      L.breaks.forEach(function (b) {
        out.push('<text class="brk-l" x="' + f1(b.lx) + '" y="' + (A + 23 + b.row * 12) + '" text-anchor="middle">' + SY.esc(b.label) + '</text>');
      });
      L.ticks.forEach(function (t) {
        if (!inR(t.x - 40, t.x + 40, r)) return;
        out.push('<line class="tk' + (t.major ? ' mj' : '') + '" x1="' + f1(t.x) + '" y1="' + (A - 4) + '" x2="' + f1(t.x) + '" y2="' + (A + 4) + '"/>' +
          '<text class="tkl' + (t.major ? ' mj' : '') + '" x="' + f1(t.x) + '" y="' + (A + 23) + '" text-anchor="middle">' + SY.esc(t.label) + '</text>');
      });
      // 줄기
      L.cards.forEach(function (c) {
        if (!inR(Math.min(c.x, c.ax), Math.max(c.x + c.w, c.ax), r)) return;
        out.push('<polyline class="stem s-' + c.side + (c.tier ? ' tx' : '') + '" points="' + pts(c.stem) + '"/>');
      });
      // 흐린 구간, 기간 막대
      L.marks.forEach(function (m) {
        var sd = m.side.length > 1 ? 'a' : m.side;
        if (m.fuzzy && inR(m.fuzzy.x0, m.fuzzy.x1, r)) {
          out.push('<rect class="fz" x="' + f1(m.fuzzy.x0) + '" y="' + (A - 7) + '" width="' + f1(m.fuzzy.x1 - m.fuzzy.x0) + '" height="14" rx="4" fill="url(#' + uid + '-fz-' + sd + ')"/>');
        }
        if (m.range && inR(m.range.x0, m.range.x1, r)) {
          var y = A + m.range.dy;
          out.push('<g class="rg rg-' + sd + '" data-f="' + SY.esc(m.factId) + '"><line x1="' + f1(m.range.x0) + '" y1="' + y + '" x2="' + f1(m.range.x1) + '" y2="' + y + '"/>' +
            '<circle cx="' + f1(m.range.x0) + '" cy="' + y + '" r="3"/><circle cx="' + f1(m.range.x1) + '" cy="' + y + '" r="3"/></g>');
        }
      });
      L.links.forEach(function (k) {
        var a = Math.min(k.x1, k.x2), b = Math.max(k.x1, k.x2);
        if (!inR(a, b, r)) return;
        var h = Math.min(18, 6 + (b - a) * 0.08);
        out.push('<path class="lnk" d="M' + f1(k.x1) + ' ' + (A - 4) + ' Q' + f1((k.x1 + k.x2) / 2) + ' ' + f1(A - 4 - h * 2) + ' ' + f1(k.x2) + ' ' + (A - 4) + '"/>');
      });
      L.rangeLabels.forEach(function (t) {
        if (!inR(t.x - t.w, t.x + t.w, r)) return;
        out.push('<text class="rg-l" x="' + f1(t.x) + '" y="' + (A - 12 + Math.min(0, t.dy)) + '" text-anchor="middle">' + SY.esc(t.label) + '</text>');
      });
      // 다툼 표지(점)와 누름 영역
      L.marks.forEach(function (m) {
        if (!inR(m.x - 8, m.x + 8, r)) return;
        out.push(dispShape(m.dispute, m.x, A, 5.5));
        out.push('<circle class="hit" data-f="' + SY.esc(m.factId) + '" cx="' + f1(m.x) + '" cy="' + A + '" r="9"/>');
      });
      svg.innerHTML = out.join('');
      renderCards(r);
      renderOverlay();
    }

    function cardAria(c) {
      var ev = c.evidence.length ? ', 증거 ' + c.evidence.map(SY.fmtEvidence).join(', ') : '';
      var who = c.side === 'a' ? (c.dispute === '다툼없음' ? '다툼 없는 사실' : '사실') : SIDE_NAME[c.side];
      return who + ', ' + c.dateLabel + ', ' + c.title + ', ' + c.dispute + ev;
    }
    function renderCards(r) {
      var L = st.L, sl = vp.scrollLeft, html = [], keep = {};
      var active = document.activeElement && cardsEl.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
      if (active) keep[active] = 1;
      if (st.sel) (st.cardsByFact[st.sel] || []).forEach(function (c) { keep[c.key] = 1; });
      var list = L.cards.filter(function (c) { return keep[c.key] || inR(c.x, c.x + c.w, r); });
      var rove = st.rove && list.some(function (c) { return c.key === st.rove; }) ? st.rove : null;
      if (!rove) {
        var vis = list.filter(function (c) { return c.x + c.w > sl && c.x < sl + vp.clientWidth; });
        var selC = st.sel && (st.cardsByFact[st.sel] || [])[0];
        rove = selC && list.indexOf(selC) >= 0 ? selC.key : (vis[0] || list[0] || {}).key || null;
      }
      list.forEach(function (c) {
        var sel = st.sel === c.factId;
        html.push('<button type="button" class="sy-tl-card ' + c.side + (sel ? ' is-sel' : '') + (c.precision !== 'day' ? ' pr-' + c.precision : '') + '"' +
          ' data-k="' + SY.esc(c.key) + '" data-f="' + SY.esc(c.factId) + '" tabindex="' + (c.key === rove ? 0 : -1) + '"' +
          ' aria-pressed="' + (sel ? 'true' : 'false') + '" aria-label="' + SY.esc(cardAria(c)) + '"' +
          (c.text ? ' title="' + SY.esc(c.text) + '"' : '') +
          ' style="left:' + f1(c.x) + 'px;top:' + f1(c.y) + 'px;width:' + c.w + 'px;height:' + c.h + 'px">' +
          '<span class="dt">' + SY.esc(c.dateLabel) + '</span>' +
          '<span class="ttl">' + SY.esc(c.title) + '</span>' +
          '<span class="ft"><span class="ds ds-' + (DISP_CLS[c.dispute] || 'open') + '">' + dispIcon(c.dispute) + c.dispute + '</span>' +
          (c.evidence.length ? '<span class="ev">' + SY.esc(c.evidence.join(', ')) + '</span>' : '') + '</span>' +
          '</button>');
      });
      cardsEl.innerHTML = html.join('');
      st.cardEls = {};
      Array.prototype.forEach.call(cardsEl.children, function (b) { st.cardEls[b.getAttribute('data-k')] = b; });
      st.rove = rove;
      if (active && st.cardEls[active]) st.cardEls[active].focus({ preventScroll: true });
    }

    function renderOverlay() {
      var L = st.L; if (!L) { over.innerHTML = ''; return; }
      var out = [], A = L.axisY;
      [['hot', st.hot], ['sel', st.sel]].forEach(function (p) {
        var fid = p[1]; if (!fid || (p[0] === 'hot' && fid === st.sel)) return;
        (st.cardsByFact[fid] || []).forEach(function (c) { out.push('<polyline class="ov-stem ' + p[0] + '" points="' + pts(c.stem) + '"/>'); });
        var k = st.linksByFact[fid];
        if (k) {
          var h = Math.min(18, 6 + Math.abs(k.x2 - k.x1) * 0.08);
          out.push('<path class="ov-lnk ' + p[0] + '" d="M' + f1(k.x1) + ' ' + (A - 4) + ' Q' + f1((k.x1 + k.x2) / 2) + ' ' + f1(A - 4 - h * 2) + ' ' + f1(k.x2) + ' ' + (A - 4) + '"/>');
        }
        (st.marksByFact[fid] || []).forEach(function (m) { out.push('<circle class="ov-ring ' + p[0] + '" cx="' + f1(m.x) + '" cy="' + A + '" r="9.5"/>'); });
      });
      over.innerHTML = out.join('');
    }

    /* ---------- 미니맵 ---------- */
    function renderMini() {
      var L = st.L, w = mmBox.clientWidth, h = 40;
      if (!L || !w) { mm.innerHTML = ''; return; }
      st.mmW = w;
      st.mmScale = buildScale(L.domain, o.scale, w, Object.assign({}, LDEF, st.lopts, { pad: 8, breakW: 14 }));
      var s = st.mmScale, out = [];
      mm.setAttribute('width', w); mm.setAttribute('height', h); mm.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      out.push('<rect class="mm-bg" x="0" y="0" width="' + w + '" height="' + h + '"/>');
      var xs = 0;
      s.breaks.forEach(function (b) { out.push('<line class="mm-ax" x1="' + f1(xs) + '" y1="20" x2="' + f1(b.x0) + '" y2="20"/><path class="mm-brk" d="' + squiggle(b.x0, b.x1, 20, 3) + '"/>'); xs = b.x1; });
      out.push('<line class="mm-ax" x1="' + f1(xs) + '" y1="20" x2="' + w + '" y2="20"/>');
      L.marks.forEach(function (m) {
        var x = f1(s.x(m.t)), sel = m.factId === st.sel ? ' sel' : '';
        if (m.side === 'a' || m.side.length > 1) out.push('<circle class="mm-m a' + sel + '" cx="' + x + '" cy="20" r="2.5"/>');
        if (m.side.indexOf('p') >= 0) out.push('<rect class="mm-m p' + sel + '" x="' + f1(x - 1) + '" y="5" width="2" height="11"/>');
        if (m.side.indexOf('d') >= 0) out.push('<rect class="mm-m d' + sel + '" x="' + f1(x - 1) + '" y="24" width="2" height="11"/>');
      });
      out.push('<rect class="mm-win" x="0" y="1" width="' + w + '" height="' + (h - 2) + '" rx="3"/>');
      out.push('<rect class="mm-brush" x="0" y="1" width="0" height="' + (h - 2) + '" visibility="hidden"/>');
      mm.innerHTML = out.join('');
      st.mmWin = mm.querySelector('.mm-win'); st.mmBrush = mm.querySelector('.mm-brush');
      drawMiniWin();
    }
    function viewTimes() {
      var sl = vp.scrollLeft, vw = vp.clientWidth, L = st.L;
      return { t0: L.scale.t(sl), t1: L.scale.t(sl + vw), atStart: sl <= 1, atEnd: sl + vw >= L.width - 1 };
    }
    function drawMiniWin() {
      if (!st.mmWin || !st.mmScale || !st.L) return;
      var v = viewTimes(), s = st.mmScale;
      var x0 = v.atStart ? 0 : s.x(v.t0), x1 = v.atEnd ? st.mmW : s.x(v.t1);
      if (x1 - x0 < 6) { var c = (x0 + x1) / 2; x0 = c - 3; x1 = c + 3; }
      st.mmWin.setAttribute('x', f1(Math.max(0, x0)));
      st.mmWin.setAttribute('width', f1(Math.max(6, Math.min(st.mmW, x1) - Math.max(0, x0))));
    }

    /* ---------- 상태, 빈 화면, 컨트롤 ---------- */
    function showEmpty() {
      var hasAny = (C.facts || []).length > 0;
      var filtered = hasAny && !st.facts.length;
      var msg;
      if (!hasAny) {
        msg = '<p class="sy-tl-empty-h">아직 표시할 사실이 없습니다.</p>' +
          '<p>진술 추출과 사실 구성 단계를 마치면 이곳에 사건의 사실이 날짜 순서대로 나타납니다. ' +
          '가운데 시간선 위의 점은 다툼 없는 사실, 선 위쪽 카드는 원고 주장, 아래쪽 카드는 피고 주장입니다. ' +
          '카드를 누르면 오른쪽 창에서 근거 서면의 쪽과 인용 원문, 증거번호, 양측 주장의 변천을 볼 수 있습니다.</p>';
      } else if (filtered) {
        msg = '<p class="sy-tl-empty-h">선택한 조건에 맞는 사실이 없습니다.</p>' +
          '<p>' + (o.from || o.to ? '지정한 기간을 넓히거나 기간을 해제해 주십시오. ' : '') + (o.issueId ? '다른 쟁점을 고르거나 전체 쟁점으로 바꾸어 보십시오.' : '') + '</p>' +
          (o.from || o.to ? '<button type="button" class="sy-tl-btn" data-act="clear-range">기간 해제</button>' : '');
      } else {
        msg = '<p class="sy-tl-empty-h">일자를 읽을 수 있는 사실이 없습니다.</p><p>사실의 일자 정보를 확인해 주십시오.</p>';
      }
      emptyEl.innerHTML = msg;
      emptyEl.hidden = false;
      vp.hidden = true; mmBox.hidden = true;
      bar.hidden = !hasAny; legend.hidden = !hasAny;
      cardsEl.innerHTML = ''; svg.innerHTML = ''; over.innerHTML = '';
      st.L = null;
      syncControls();
    }
    function hideEmpty() { emptyEl.hidden = true; vp.hidden = false; mmBox.hidden = false; bar.hidden = false; legend.hidden = false; }

    function syncControls() {
      Array.prototype.forEach.call(rootEl.querySelectorAll('[data-act=scale]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === o.scale ? 'true' : 'false'); });
      var zo = q('[data-act=zoom-out]'), zi = q('[data-act=zoom-in]');
      zo.disabled = !st.L || st.zoom <= 1.0001; zi.disabled = !st.L || st.zoom >= st.maxZoom - 1e-6;
      inFrom.value = o.from || ''; inTo.value = o.to || '';
      q('.sy-tl-range [data-act=clear-range]').disabled = !(o.from || o.to);
      var total = (C.facts || []).length, shown = st.L ? st.L.count : 0, parts = [];
      parts.push(shown === total ? '사실 ' + total + '건' : '사실 ' + total + '건 중 ' + shown + '건 표시');
      if (o.issueId) { var is = issueById[o.issueId]; parts.push('쟁점: ' + (is ? is.name : o.issueId)); }
      if (st.L && st.L.skipped.length) parts.push('일자 없음 ' + st.L.skipped.length + '건 제외');
      if (st.L && st.zoom > 1.0001) parts.push('확대 ' + Math.round(st.zoom * 100) + '%');
      statusEl.textContent = parts.join(' · ');
    }

    function refilter(keepZoom) {
      st.facts = filterFacts(C, o);
      domCache = null;
      if (!keepZoom) { st.zoom = 1; st.autoZoom = true; }
      if (!st.facts.length) { showEmpty(); return; }
      hideEmpty();
      st.L = null;
      relayout({ left: 0, v: 'center' });
      if (st.sel && st.cardsByFact[st.sel]) reveal(st.sel);
    }

    /* ---------- 선택, 이동 ---------- */
    function setSel(fid, user, scroll) {
      fid = fid || null;
      st.sel = fid;
      Object.keys(st.cardEls).forEach(function (k) {
        var b = st.cardEls[k], on = b.getAttribute('data-f') === fid;
        b.classList.toggle('is-sel', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (fid && st.cardsByFact[fid]) st.rove = st.cardsByFact[fid][0].key;
      if (scroll && fid && st.cardsByFact[fid]) reveal(fid);
      renderOverlay();
      if (st.L) renderMini();
      if (user && typeof o.onSelect === 'function') o.onSelect(fid);
    }
    function ensureVisible(c) {
      var m = 16, sl = vp.scrollLeft, stp = vp.scrollTop, vw = vp.clientWidth, vh = vp.clientHeight;
      var nl = sl, nt = stp;
      if (c.w + 2 * m > vw) nl = c.x - m; else if (c.x < sl + m) nl = c.x - m; else if (c.x + c.w > sl + vw - m) nl = c.x + c.w - vw + m;
      if (c.y < stp + m) nt = c.y - m; else if (c.y + c.h > stp + vh - m) nt = c.y + c.h - vh + m;
      if (nl !== sl) vp.scrollLeft = nl;
      if (nt !== stp) vp.scrollTop = nt;
    }
    function reveal(fid) {
      var cs = st.cardsByFact[fid]; if (!cs || !cs.length) return;
      ensureVisible(cs[0]);
      renderLayers(false);
    }
    function focusCard(key) {
      var c = st.cardByKey[key]; if (!c) return;
      ensureVisible(c);
      st.rove = key;
      renderLayers(false);
      var b = st.cardEls[key];
      if (!b) { renderLayers(true); b = st.cardEls[key]; }
      if (b) {
        Object.keys(st.cardEls).forEach(function (k) { st.cardEls[k].tabIndex = k === key ? 0 : -1; });
        b.focus({ preventScroll: true });
      }
    }

    /* ---------- 확대·축소 ---------- */
    function zoomTo(z, off) {
      if (!st.L) return;
      z = clamp(z, 1, st.maxZoom);
      if (Math.abs(z - st.zoom) < 1e-4) return;
      if (off == null) off = vp.clientWidth / 2;
      var t = st.L.scale.t(vp.scrollLeft + off);
      st.zoom = z;
      relayout({ t: t, off: off });
    }
    function queueZoom(z, off) {
      st.pz = { z: z, off: off };
      if (!st.rafZoom) st.rafZoom = raf(function () { st.rafZoom = 0; var p = st.pz; st.pz = null; if (p) zoomTo(p.z, p.off); });
    }
    function zoomToRange(t0, t1) {
      if (!st.L) return;
      if (t1 < t0) { var tmp = t0; t0 = t1; t1 = tmp; }
      var vw = vp.clientWidth, target = Math.max(40, vw - 32), dom = st.L.domain, lo = 1, hi = st.maxZoom;
      var op = Object.assign({}, LDEF, st.lopts);
      var span = function (z) { var s = buildScale(dom, o.scale, Math.round(vw * z), op); return s.x(t1) - s.x(t0); };
      if (t1 - t0 <= 0 || span(hi) <= target) lo = hi;
      else if (span(1) >= target) lo = 1;
      else for (var i = 0; i < 40; i++) { var mid = Math.sqrt(lo * hi); if (span(mid) < target) lo = mid; else hi = mid; }
      st.zoom = lo;
      relayout({ t: t0, off: 16 });
      if (t1 - t0 <= 0 || st.L.scale.x(t1) - st.L.scale.x(t0) < vw - 32) {
        vp.scrollLeft = (st.L.scale.x(t0) + st.L.scale.x(t1)) / 2 - vw / 2;
      }
    }

    /* ---------- 이벤트 ---------- */
    function onBar(e) {
      var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
      var act = b.getAttribute('data-act');
      if (act === 'scale') { var v = b.getAttribute('data-v'); if (v !== o.scale) { setScale(v); emit({ scale: v }); } }
      else if (act === 'zoom-in') zoomTo(st.zoom * 1.6);
      else if (act === 'zoom-out') zoomTo(st.zoom / 1.6);
      else if (act === 'fit') fit();
      else if (act === 'clear-range') { o.from = null; o.to = null; refilter(); emit({ from: null, to: null }); }
    }
    rootEl.addEventListener('click', function (e) {
      if (e.target.closest('.sy-tl-bar') || e.target.closest('.sy-tl-empty')) onBar(e);
    });
    function setScale(v) {
      if (v !== 'real' && v !== 'even') return;
      var keep = null;
      if (st.L) { var off = vp.clientWidth / 2; keep = { t: st.L.scale.t(vp.scrollLeft + off), off: off }; }
      o.scale = v;
      if (st.facts.length) relayout(keep); else syncControls();
    }
    function onDate() {
      var f = inFrom.value || null, t = inTo.value || null;
      if (f && t && f > t) { var x = f; f = t; t = x; }
      o.from = f; o.to = t;
      refilter();
      emit({ from: f, to: t });
    }
    inFrom.addEventListener('change', onDate);
    inTo.addEventListener('change', onDate);

    cardsEl.addEventListener('click', function (e) {
      var b = e.target.closest('.sy-tl-card'); if (!b) return;
      st.rove = b.getAttribute('data-k');
      setSel(b.getAttribute('data-f'), true, false);
    });
    svg.addEventListener('click', function (e) {
      var h = e.target.closest('[data-f]'); if (!h) return;
      var fid = h.getAttribute('data-f');
      setSel(fid, true, true);
      var cs = st.cardsByFact[fid]; if (cs) focusCard(cs[0].key);
    });
    cardsEl.addEventListener('keydown', function (e) {
      var b = e.target.closest('.sy-tl-card'); if (!b || !st.L) return;
      var k = b.getAttribute('data-k'), idx = st.orderIdx[k], n = st.L.cards.length, to = null, c = st.cardByKey[k];
      switch (e.key) {
        case 'ArrowRight': to = idx + 1; break;
        case 'ArrowLeft': to = idx - 1; break;
        case 'Home': to = 0; break;
        case 'End': to = n - 1; break;
        case 'ArrowUp': case 'ArrowDown': {
          var want = e.key === 'ArrowUp' ? 'up' : 'down';
          var same = (st.cardsByFact[c.factId] || []).filter(function (x) { return x.dir === want && x.key !== k; })[0];
          var best = same || null;
          if (!best) {
            var cands = st.L.cards.filter(function (x) { return want === 'up' ? (x.dir === 'up' && (c.dir === 'down' || x.tier > c.tier)) : (x.dir === 'down' ? (c.dir === 'up' || x.tier > c.tier) : (c.dir === 'up' && x.tier < c.tier)); });
            var cx = c.x + c.w / 2, bd = Infinity;
            cands.forEach(function (x) { var d = Math.abs(x.x + x.w / 2 - cx) + Math.abs(x.y - c.y) * 0.5; if (d < bd) { bd = d; best = x; } });
          }
          if (best) { e.preventDefault(); focusCard(best.key); }
          return;
        }
        case 'Tab': to = e.shiftKey ? idx - 1 : idx + 1; if (to < 0 || to >= n) return; break;
        case 'Escape': if (st.sel) { e.preventDefault(); setSel(null, true, false); } return;
        case '+': case '=': e.preventDefault(); zoomTo(st.zoom * 1.6, c.ax - vp.scrollLeft); focusCard(k); return;
        case '-': case '_': e.preventDefault(); zoomTo(st.zoom / 1.6, c.ax - vp.scrollLeft); focusCard(k); return;
        case '0': e.preventDefault(); fit(); focusCard(k); return;
        default: return;
      }
      e.preventDefault();
      focusCard(st.L.cards[clamp(to, 0, n - 1)].key);
    });
    cardsEl.addEventListener('focusin', function (e) {
      var b = e.target.closest('.sy-tl-card'); if (!b) return;
      st.rove = b.getAttribute('data-k');
      var c = st.cardByKey[st.rove]; if (c) ensureVisible(c);
      st.hot = b.getAttribute('data-f'); renderOverlay();
    });
    cardsEl.addEventListener('focusout', function () { st.hot = null; renderOverlay(); });
    cardsEl.addEventListener('pointerover', function (e) {
      var b = e.target.closest('.sy-tl-card'); var f = b ? b.getAttribute('data-f') : null;
      if (f !== st.hot) { st.hot = f; renderOverlay(); }
    });
    cardsEl.addEventListener('pointerleave', function () { if (st.hot) { st.hot = null; renderOverlay(); } });

    vp.addEventListener('scroll', function () {
      if (st.rafScroll) return;
      st.rafScroll = raf(function () { st.rafScroll = 0; if (!st.L) return; renderLayers(false); drawMiniWin(); });
    }, { passive: true });
    vp.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey) || !st.L) return;
      e.preventDefault();
      var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.002));
      var r = vp.getBoundingClientRect();
      queueZoom((st.pz ? st.pz.z : st.zoom) * f, e.clientX - r.left - vp.clientLeft);
    }, { passive: false });
    vp.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.pointerType === 'touch' || !st.L) return;
      st.drag = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop, id: e.pointerId, moved: false };
    });
    vp.addEventListener('pointermove', function (e) {
      var d = st.drag; if (!d || e.pointerId !== d.id) return;
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      if (!d.moved) { d.moved = true; try { vp.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ } rootEl.classList.add('is-panning'); }
      vp.scrollLeft = d.sl - dx; vp.scrollTop = d.st - dy;
    });
    function endDrag() { var d = st.drag; st.drag = null; if (d && d.moved) rootEl.classList.remove('is-panning'); }
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
    vp.addEventListener('keydown', function (e) {
      if (e.target !== vp || !st.L) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(st.zoom * 1.6); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(st.zoom / 1.6); }
      else if (e.key === '0') { e.preventDefault(); fit(); }
    });

    function mmX(e) { return e.clientX - mm.getBoundingClientRect().left; }
    mmBox.addEventListener('pointerdown', function (e) {
      if (!st.L || e.button !== 0 || !st.mmWin) return;
      var x = mmX(e), wx0 = +st.mmWin.getAttribute('x'), wx1 = wx0 + (+st.mmWin.getAttribute('width'));
      st.mmDrag = (x >= wx0 && x <= wx1 && st.zoom > 1.0001) ? { mode: 'move', off: x - wx0, id: e.pointerId } : { mode: 'brush', x0: x, x1: x, id: e.pointerId };
      try { mmBox.setPointerCapture(e.pointerId); } catch (_) { /* 무시 */ }
      e.preventDefault();
    });
    mmBox.addEventListener('pointermove', function (e) {
      var d = st.mmDrag; if (!d || e.pointerId !== d.id) return;
      var x = mmX(e);
      if (d.mode === 'move') {
        var nx = x - d.off;
        vp.scrollLeft = nx <= 0 ? 0 : st.L.scale.x(st.mmScale.t(nx));
      } else {
        d.x1 = clamp(x, 0, st.mmW);
        st.mmBrush.setAttribute('visibility', 'visible');
        st.mmBrush.setAttribute('x', f1(Math.min(d.x0, d.x1)));
        st.mmBrush.setAttribute('width', f1(Math.abs(d.x1 - d.x0)));
      }
    });
    function mmEnd(e) {
      var d = st.mmDrag; if (!d) return; st.mmDrag = null;
      if (d.mode !== 'brush' || !st.L) return;
      st.mmBrush.setAttribute('visibility', 'hidden');
      if (e && e.type === 'pointercancel') return;
      var a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1);
      if (b - a >= 6) zoomToRange(st.mmScale.t(a), st.mmScale.t(b));
      else vp.scrollLeft = st.L.scale.x(st.mmScale.t(a)) - vp.clientWidth / 2;
    }
    mmBox.addEventListener('pointerup', mmEnd);
    mmBox.addEventListener('pointercancel', mmEnd);
    mmBox.addEventListener('keydown', function (e) {
      if (!st.L) return;
      var vw = vp.clientWidth;
      if (e.key === 'ArrowLeft') { e.preventDefault(); vp.scrollLeft -= vw * 0.25; }
      else if (e.key === 'ArrowRight') { e.preventDefault(); vp.scrollLeft += vw * 0.25; }
      else if (e.key === 'Home') { e.preventDefault(); vp.scrollLeft = 0; }
      else if (e.key === 'End') { e.preventDefault(); vp.scrollLeft = st.L.width; }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomTo(st.zoom * 1.6); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomTo(st.zoom / 1.6); }
    });

    var ro = null;
    function onResize() {
      if (st.rafResize) return;
      st.rafResize = raf(function () {
        st.rafResize = 0;
        if (st.dead || !st.facts.length) return;
        var vw = vp.clientWidth;
        if (!vw) return;
        if (vw !== st.vw || !st.L) {
          var keep = null;
          if (st.L) { var off = vw / 2; keep = { t: st.L.scale.t(vp.scrollLeft + Math.min(off, st.vw / 2)), off: off }; }
          relayout(keep);
        } else if (mmBox.clientWidth !== st.mmW) renderMini();
      });
    }
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(onResize); ro.observe(el); }
    else root.addEventListener('resize', onResize);

    function fit() { if (!st.L) return; st.zoom = 1; relayout({ left: 0 }); }

    /* ---------- 시작 ---------- */
    refilter();
    if (st.sel) setSel(st.sel, false, true);

    var ctrl = {
      update: function (p) {
        p = p || {};
        if ('onSelect' in p) o.onSelect = p.onSelect;
        if ('onChange' in p) o.onChange = p.onChange;
        var re = false;
        if ('issueId' in p && (p.issueId || null) !== o.issueId) { o.issueId = p.issueId || null; re = true; }
        if ('from' in p && (p.from || null) !== o.from) { o.from = p.from || null; re = true; }
        if ('to' in p && (p.to || null) !== o.to) { o.to = p.to || null; re = true; }
        if ('scale' in p && p.scale !== o.scale && (p.scale === 'real' || p.scale === 'even')) {
          if (re) o.scale = p.scale; else setScale(p.scale);
        }
        if (re) refilter();
        if ('selectedId' in p) setSel(p.selectedId, false, true);
        else syncControls();
      },
      zoomBy: function (f) { zoomTo(st.zoom * (+f || 1)); },
      fit: fit,
      select: function (fid) { setSel(fid, false, true); },
      destroy: function () {
        st.dead = true;
        if (ro) ro.disconnect(); else root.removeEventListener('resize', onResize);
        [st.rafScroll, st.rafZoom, st.rafResize].forEach(function (id) { if (id) caf(id); });
        el.innerHTML = '';
      },
      /* 시험·진단용(공개 API 아님) */
      _debug: function () { return { layout: st.L, zoom: st.zoom, maxZoom: st.maxZoom, rendered: st.rendered, opts: Object.assign({}, o) }; }
    };
    return ctrl;
  };

  /* ================= 우측 창: 사실 상세 ================= */
  Viz.factDetail = function (el, C, factId, opts) {
    if (!el) throw new Error('SY.Viz.factDetail: 컨테이너가 없습니다');
    opts = opts || {};
    C = C || {};
    var E = SY.esc;
    var f = null;
    (C.facts || []).forEach(function (x) { if (x && x.id === factId) f = x; });
    var closeBtn = typeof opts.onClose === 'function' ? '<button type="button" class="sy-fd-close" data-act="close" aria-label="상세 창 닫기">닫기</button>' : '';
    function bind() {
      var b = el.querySelector('[data-act=close]');
      if (b) b.addEventListener('click', function () { opts.onClose(); });
      return { destroy: function () { el.innerHTML = ''; } };
    }
    if (!f) {
      el.innerHTML = '<div class="sy-fd sy-fd-empty" role="note">' + closeBtn +
        '<p class="sy-fd-empty-h">' + (factId ? '선택한 사실을 찾을 수 없습니다.' : '사실을 선택해 주십시오.') + '</p>' +
        '<p>타임라인에서 카드나 점을 고르면 이곳에 그 사실의 일자와 다툼 여부, 원고와 피고의 서술과 증거번호, ' +
        '근거 서면의 쪽과 인용 원문, 양측 주장 변천 이력이 나타납니다.</p></div>';
      return bind();
    }
    var docs = SY.byId(C.docs || []), stm = SY.byId(C.statements || []), issues = SY.byId(C.issues || []);
    var dord = {}; SY.docsInOrder(C).forEach(function (d, i) { dord[d.id] = i; });
    var linked = {}, missing = [];
    [['원고', f.plaintiff], ['피고', f.defendant]].forEach(function (p) {
      ((p[1] && p[1].stmtIds) || []).forEach(function (id) { if (stm[id]) linked[id] = stm[id]; else missing.push(id); });
    });
    (C.statements || []).forEach(function (s) { if (s && (s.factIds || []).indexOf(f.id) >= 0) linked[s.id] = s; });
    var bySide = { '원고': [], '피고': [], '기타': [] };
    Object.keys(linked).forEach(function (id) { var s = linked[id]; (bySide[s.side] || bySide['기타']).push(s); });
    function sOrd(a, b) {
      var da = dord[a.docId] != null ? dord[a.docId] : 1e9, db = dord[b.docId] != null ? dord[b.docId] : 1e9;
      return da - db || (+a.page || 0) - (+b.page || 0) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
    }
    Object.keys(bySide).forEach(function (k) { bySide[k].sort(sOrd); });
    function docLabel(s) {
      var d = docs[s.docId];
      return (d ? SY.docName(d) : '서면 정보 없음(' + s.docId + ')') + (s.page != null ? ' 제' + s.page + '쪽' : '');
    }
    function evList(arr) { return (arr || []).map(function (e) { return E(SY.fmtEvidence(e)); }).join(', '); }
    function stmtItem(s) {
      return '<li class="sy-fd-stmt">' +
        '<div class="sy-fd-src">' + E(docLabel(s)) + (s.item ? '<span class="sy-fd-item"> · ' + E(s.item) + '</span>' : '') + '</div>' +
        '<blockquote class="sy-fd-q">' + E(s.quote) + '</blockquote>' +
        ((s.evidence || []).length ? '<div class="sy-fd-ev">호증: ' + evList(s.evidence) + '</div>' : '') +
        '</li>';
    }
    var disp = SY.DISPUTE.indexOf(f.dispute) >= 0 ? f.dispute : '미확정';
    var head = [];
    head.push('<header class="sy-fd-head">' + closeBtn + '<h3 class="sy-fd-title">' + E(f.title || '(표제 없음)') + '</h3>');
    var dl = [];
    dl.push('<span class="sy-fd-dlab">일자</span> ' + E(SY.date.label(f.date) || '일자 없음'));
    var pd = f.plaintiff && f.plaintiff.date, dd = f.defendant && f.defendant.date;
    if (pd || dd) {
      var pl = pd ? SY.date.label(pd) : '', dlb = dd ? SY.date.label(dd) : '';
      if (pl && dlb && pl !== dlb) dl.push('<span class="sy-fd-dsplit">원고 주장 ' + E(pl) + ' / 피고 주장 ' + E(dlb) + '</span>');
      else if (pl && pl !== SY.date.label(f.date)) dl.push('<span class="sy-fd-dsplit">원고 주장 ' + E(pl) + '</span>');
      else if (dlb && dlb !== SY.date.label(f.date)) dl.push('<span class="sy-fd-dsplit">피고 주장 ' + E(dlb) + '</span>');
    }
    head.push('<p class="sy-fd-date">' + dl.join(' ') + '</p>');
    var chips = ['<span class="sy-fd-chip disp disp-' + DISP_CLS[disp] + '">' + dispIcon(disp) + E(disp) + '</span>'];
    (f.issueIds || []).forEach(function (id) {
      var is = issues[id];
      chips.push('<span class="sy-fd-chip iss" title="' + E(is ? is.elements || '' : '쟁점 목록에 없는 id') + '">' + (is ? '쟁점 ' + E(is.name) : E(id) + ' (쟁점 목록에 없음)') + '</span>');
    });
    head.push('<div class="sy-fd-chips">' + chips.join('') + '</div>');
    if (f.note) head.push('<p class="sy-fd-note"><span class="sy-fd-dlab">메모</span> ' + E(f.note) + '</p>');
    if (!Object.keys(linked).length) head.push('<p class="sy-fd-warn" role="note">근거 진술 없음: 이 사실과 연결된 진술(서면·쪽·인용)이 없습니다. 진술 탭에서 연결을 확인해 주십시오.</p>');
    if (missing.length) head.push('<p class="sy-fd-warn" role="note">연결된 진술 ' + E(missing.join(', ')) + '을(를) 진술 목록에서 찾을 수 없습니다.</p>');
    head.push('</header>');

    function sideSec(cls, name, nar, list) {
      var h = '<section class="sy-fd-side ' + cls + '" aria-label="' + name + ' 서술">' + '<h4>' + name + ' 서술</h4>';
      if (nar) {
        h += '<p class="sy-fd-text">' + E(nar.text || '(서술 문구 없음)') + '</p>';
        if ((nar.evidence || []).length) h += '<p class="sy-fd-ev">증거: ' + evList(nar.evidence) + '</p>';
      } else {
        h += '<p class="sy-fd-none">이 사실에 연결된 ' + name + ' 서술이 없습니다.</p>';
      }
      h += '<h5>근거 진술</h5>';
      h += list.length ? '<ol class="sy-fd-stmts">' + list.map(stmtItem).join('') + '</ol>' : '<p class="sy-fd-none">근거 진술 없음</p>';
      return h + '</section>';
    }
    var body = [];
    body.push(sideSec('p', '원고', f.plaintiff, bySide['원고']));
    body.push(sideSec('d', '피고', f.defendant, bySide['피고']));
    if (bySide['기타'].length) body.push('<section class="sy-fd-side x"><h4>기타 진술</h4><ol class="sy-fd-stmts">' + bySide['기타'].map(stmtItem).join('') + '</ol></section>');

    // 양측 주장 변천 이력
    // 미반복은 toId:null + toDocId(앞 주장을 다루지 않은 이후 서면). 다른 유형은 toId.
    var chs = (C.changes || []).filter(function (c) { return c && ((c.fromId != null && linked[c.fromId]) || (c.toId != null && linked[c.toId])); });
    function fd(id) { var s = id != null ? stm[id] : null, d = s && docs[s.docId]; return d ? String(d.filedDate || '') : ''; }
    function toDate(c) {
      if (c.toId != null) return fd(c.toId);
      var d = c.toDocId != null ? docs[c.toDocId] : null;
      return d ? String(d.filedDate || '') : '';
    }
    chs.sort(function (a, b) {
      var am = [fd(a.fromId), toDate(a)].sort(), bm = [fd(b.fromId), toDate(b)].sort();
      return am[1].localeCompare(bm[1]) || am[0].localeCompare(bm[0]) || String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
    });
    function sideCls(side) { return side === '원고' ? 'p' : side === '피고' ? 'd' : 'x'; }
    function sref(id) {
      if (id == null) return '<span class="sy-fd-none">진술 정보 없음</span>';
      var s = stm[id];
      if (!s) return '진술 ' + E(id) + '(목록에 없음)';
      return '<span class="sy-fd-who ' + sideCls(s.side) + '">' + E(s.side || '') + '</span> ' + E(docLabel(s));
    }
    /* 뒤 진술이 없는 판정(미반복 등): 서면 칸 안내로 표시 */
    function toRef(c) {
      if (c.toId != null) return sref(c.toId);
      var d = c.toDocId != null ? docs[c.toDocId] : null;
      if (d) return '<span class="sy-fd-who ' + sideCls(d.side) + '">' + E(d.side || '') + '</span> ' + E(SY.docName(d)) +
        ' <span class="sy-fd-nostmt">(이 서면에는 앞 주장에 대응하는 진술이 없습니다)</span>';
      if (c.toDocId != null) return '<span class="sy-fd-nostmt">서면 ' + E(c.toDocId) + '(서면 목록에 없음)에는 앞 주장에 대응하는 진술이 없습니다</span>';
      return '<span class="sy-fd-nostmt">뒤 서면 정보가 없습니다</span>';
    }
    var hist = '<section class="sy-fd-hist" aria-label="양측 주장 변천 이력"><h4>양측 주장 변천 이력</h4>';
    if (!chs.length) hist += '<p class="sy-fd-none">이 사실의 진술과 연결된 변화 판정이 없습니다.</p>';
    else {
      hist += '<ol class="sy-fd-chgs">' + chs.map(function (c) {
        var t = SY.REL.types.indexOf(c.type) >= 0 ? c.type : null;
        var cls = t ? SY.REL.css[t] : 'keep';
        var badge = '<span class="rel ' + cls + (c.review ? ' review' : '') + '"><span aria-hidden="true">' + E(t ? SY.REL.glyph[t] : '?') + '</span>' + E(t || String(c.type || '유형 없음')) + '</span>';
        var adm = t === '자백후보' ? '<span class="sy-fd-adm">후보이며 변론조서로 진술 여부 확인 필요</span>' : '';
        var scope = c.scope === 'cross' ? '상대 주장과 비교' : '같은 편 진술 비교';
        var s1 = c.fromId != null ? stm[c.fromId] : null, s2 = c.toId != null ? stm[c.toId] : null;
        return '<li class="sy-fd-chg">' +
          '<div class="sy-fd-chg-top">' + badge + adm + '</div>' +
          '<div class="sy-fd-chg-path"><span class="sy-fd-scope">' + scope + '</span> ' + sref(c.fromId) + ' <span aria-hidden="true">→</span><span class="sr"> 에서 </span> ' + toRef(c) + '</div>' +
          (s1 && s1.gist ? '<div class="sy-fd-gist"><span class="sy-fd-dlab">앞</span> ' + E(s1.gist) + '</div>' : '') +
          (s2 && s2.gist ? '<div class="sy-fd-gist"><span class="sy-fd-dlab">뒤</span> ' + E(s2.gist) + '</div>' : '') +
          (c.basis ? '<p class="sy-fd-basis"><span class="sy-fd-dlab">판정 근거</span> ' + E(c.basis) + '</p>' : '') +
          '</li>';
      }).join('') + '</ol>';
    }
    hist += '</section>';
    body.push(hist);
    el.innerHTML = '<article class="sy-fd" aria-label="' + E('사실 상세: ' + (f.title || '')) + '">' + head.join('') + body.join('') + '</article>';
    return bind();
  };
})(typeof window !== 'undefined' ? window : globalThis);
