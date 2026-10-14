/* 사건 연표 - 저장(SY.Store). 설계서 4.2, 5.2.
 * db 능력이 있으면 db 에, 없으면 메모리 + localStorage 에 같은 배치로 저장한다.
 *   cases/{caseId}                       메타(본문 제외 서면 목록, 쟁점, counts, parts 색인 등)
 *   cases/{caseId}/parts/{partId}        pages_{docId}_{seq} | statements_{seq} | changes_{seq} | facts_{seq} | rejected_{seq}
 * 각 문서는 직렬화 200,000바이트 이하. saveCase 는 해시가 바뀐 묶음만 쓴다.
 * 브라우저와 node(tools/split_case.js, 단위 시험) 양쪽에서 읽힌다. 정의 시점에 다른 모듈을 가정하지 않는다. */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};

  var LIMIT = 200000;               // 문서 하나의 직렬화 상한(바이트). db 상한 256KiB 보다 여유를 둔다.
  var LS_PREFIX = 'sayeon.v1:';     // localStorage 폴백 키 머리
  var SEG_BAD = /[^A-Za-z0-9_\-.~:@+]/g;
  var BIG = { docs: 1, statements: 1, changes: 1, facts: 1, rejected: 1 };
  var LIST_KINDS = ['statements', 'changes', 'facts', 'rejected'];

  /* ---------- 순수 함수 ---------- */
  function utf8Bytes(s) {
    s = String(s);
    var n = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) n += 1;
      else if (c < 0x800) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        var d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { n += 4; i++; } else n += 3;
      } else n += 3;
    }
    return n;
  }
  function isBinary(v) {
    if (typeof Blob !== 'undefined' && v instanceof Blob) return true;
    if (typeof ArrayBuffer !== 'undefined' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))) return true;
    if (typeof ImageBitmap !== 'undefined' && v instanceof ImageBitmap) return true;
    return false;
  }
  /* JSON 으로 저장할 수 있는 값만 남긴다(Blob, 함수, undefined 제거). 입력은 바꾸지 않는다. */
  function clean(v) {
    if (v === null) return null;
    var t = typeof v;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'number') return isFinite(v) ? v : null;
    if (t !== 'object') return undefined;
    if (isBinary(v)) return undefined;
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(function (x) { var c = clean(x); return c === undefined ? null : c; });
    var o = {};
    Object.keys(v).forEach(function (k) { var c = clean(v[k]); if (c !== undefined) o[k] = c; });
    return o;
  }
  /* 키 순서와 무관한 직렬화(해시용). */
  function canon(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
      .map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
  }
  /* cyrb53 변형, 16진 16자리 */
  function hash(str) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('00000000' + (h2 >>> 0).toString(16)).slice(-8) + ('00000000' + (h1 >>> 0).toString(16)).slice(-8);
  }
  function hashBody(body) { return hash(canon(body)); }
  function metaHash(meta) {
    var m = {};
    Object.keys(meta || {}).forEach(function (k) { if (k !== 'updatedAt') m[k] = meta[k]; });
    return hash(canon(m));
  }
  /* db 경로 조각으로 쓸 수 있게 바꾼다(허용 문자 밖은 ~XX). 본문에는 원래 id 를 그대로 둔다. */
  function safeSeg(id) {
    var s = String(id == null ? '' : id).replace(SEG_BAD, function (c) {
      return '~' + c.charCodeAt(0).toString(16);
    });
    if (s === '' || s === '.' || s === '..') s = '~' + s;
    return s;
  }
  function serr(code, message, extra) {
    var e = { code: code, message: message };
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  /* 순서대로 담되 직렬화 크기가 LIMIT 를 넘지 않게 묶는다. */
  function packList(kind, items, docId) {
    var base = { kind: kind };
    if (docId != null) base.docId = docId;
    base.seq = 99999;
    base[kind === 'pages' ? 'pages' : 'items'] = [];
    var overhead = utf8Bytes(JSON.stringify(base));
    var room = LIMIT - overhead - 16;
    var chunks = [], cur = [], size = 0;
    items.forEach(function (it) {
      var b = utf8Bytes(JSON.stringify(it)) + 1;
      if (b > room) throw serr('item_too_large', kind + ' 항목 하나가 저장 한도를 넘습니다.', { kind: kind });
      if (size + b > room && cur.length) { chunks.push(cur); cur = []; size = 0; }
      cur.push(it); size += b;
    });
    if (cur.length) chunks.push(cur);
    return { chunks: chunks, room: room };
  }
  /* 쪽 하나가 너무 크면(쪽 구분 없는 긴 붙여넣기 등) 글을 조각(seg/segs)으로 나눈다. */
  function splitBigPages(pages, room) {
    var out = [];
    pages.forEach(function (p) {
      var b = utf8Bytes(JSON.stringify(p)) + 1;
      if (b <= room || typeof p.text !== 'string') { out.push(p); return; }
      var head = {}; Object.keys(p).forEach(function (k) { if (k !== 'text') head[k] = p[k]; });
      var headBytes = utf8Bytes(JSON.stringify(head)) + 40;
      var budget = Math.max(1000, Math.floor((room - headBytes) * 0.9));
      var cps = Array.from(p.text), pieces = [], buf = '', bb = 0;
      for (var i = 0; i < cps.length; i++) {
        // JSON 이스케이프까지 고려한 바이트(따옴표, 역슬래시, 제어문자는 늘어난다)
        var cb = utf8Bytes(JSON.stringify(cps[i])) - 2;
        if (bb + cb > budget && buf) { pieces.push(buf); buf = ''; bb = 0; }
        buf += cps[i]; bb += cb;
      }
      if (buf || !pieces.length) pieces.push(buf);
      pieces.forEach(function (t, k) {
        var q = {}; Object.keys(head).forEach(function (key) { q[key] = head[key]; });
        q.text = t; q.seg = k; q.segs = pieces.length;
        out.push(q);
      });
    });
    return out;
  }
  function joinSegPages(pages) {
    var out = [];
    pages.forEach(function (p) {
      if (p && typeof p.segs === 'number' && typeof p.seg === 'number') {
        var last = out[out.length - 1];
        if (p.seg > 0 && last && last.__seg === p.seg - 1 && last.n === p.n) {
          last.text += p.text || ''; last.__seg = p.seg;
          if (p.seg === p.segs - 1) delete last.__seg;
          return;
        }
        var q = {}; Object.keys(p).forEach(function (k) { if (k !== 'seg' && k !== 'segs') q[k] = p[k]; });
        q.text = p.text || '';
        if (p.seg < p.segs - 1) q.__seg = p.seg;
        out.push(q);
        return;
      }
      out.push(p);
    });
    out.forEach(function (p) { if (p && p.__seg !== undefined) delete p.__seg; });
    return out;
  }

  /* C -> { caseId, meta, metaHash, parts:[{id, body, hash, bytes}] }. 입력 C 는 바꾸지 않는다. */
  function split(C, opt) {
    opt = opt || {};
    if (!C || C.id == null || C.id === '') throw serr('invalid_case', '사건 id가 없습니다.');
    var caseId = String(C.id);
    var parts = [];
    function add(id, body) {
      var s = JSON.stringify(body);
      var bytes = utf8Bytes(s);
      if (bytes > LIMIT) throw serr('part_too_large', '저장 묶음이 한도를 넘었습니다: ' + id, { partId: id });
      parts.push({ id: id, body: body, hash: hashBody(body), bytes: bytes });
    }
    (C.docs || []).forEach(function (d) {
      if (!d) return;
      var pages = (d.pages || []).map(function (p) { return clean(p); }).filter(function (p) { return p != null; });
      if (!pages.length) return;
      var probe = packList('pages', [], d.id);
      var pk = packList('pages', splitBigPages(pages, probe.room), d.id);
      pk.chunks.forEach(function (ch, seq) {
        add('pages_' + safeSeg(d.id) + '_' + seq, { kind: 'pages', docId: d.id, seq: seq, pages: ch });
      });
    });
    LIST_KINDS.forEach(function (kind) {
      var items = (C[kind] || []).map(function (x) { return clean(x); }).filter(function (x) { return x != null; });
      if (!items.length) return;
      packList(kind, items).chunks.forEach(function (ch, seq) {
        add(kind + '_' + seq, { kind: kind, seq: seq, items: ch });
      });
    });

    var meta = {};
    Object.keys(C).forEach(function (k) {
      if (BIG[k] || k === 'parts' || k === 'counts') return;
      var c = clean(C[k]); if (c !== undefined) meta[k] = c;
    });
    meta.id = caseId;
    meta.docs = (C.docs || []).filter(Boolean).map(function (d) {
      var o = {};
      Object.keys(d).forEach(function (k) {
        if (k === 'pages' || k === 'rawBlob') return;
        var c = clean(d[k]); if (c !== undefined) o[k] = c;
      });
      return o;
    });
    var pageTotal = 0;
    (C.docs || []).forEach(function (d) { pageTotal += d && d.pages ? d.pages.length : 0; });
    meta.counts = {
      docs: meta.docs.length, pages: pageTotal,
      issues: (C.issues || []).length, statements: (C.statements || []).length,
      changes: (C.changes || []).length, facts: (C.facts || []).length
    };
    if (meta.schema == null) meta.schema = 1;
    meta.updatedAt = C.updatedAt || opt.now || new Date().toISOString();
    meta.parts = parts.map(function (p) { return { id: p.id, h: p.hash }; });
    var mb = utf8Bytes(JSON.stringify(meta));
    if (mb > LIMIT) throw serr('meta_too_large', '사건 메타(서면 목록·쟁점)가 저장 한도를 넘었습니다. 서면 수를 줄여 주세요.', { bytes: mb });
    return { caseId: caseId, meta: meta, metaHash: metaHash(meta), metaBytes: mb, parts: parts };
  }

  /* 메타 + 묶음들 -> C. 없는 묶음은 missing 으로 알린다(깨지지 않음). */
  function join(meta, partsById) {
    partsById = partsById || {};
    var m = JSON.parse(JSON.stringify(meta || {}));
    var index = Array.isArray(m.parts) ? m.parts : [];
    delete m.parts; delete m.counts;
    var missing = [], pagesBy = {}, lists = {};
    LIST_KINDS.forEach(function (k) { lists[k] = []; });
    // 묶음을 (종류, 서면)별로 모은 뒤 seq 순으로 잇는다.
    var groups = {}, groupOrder = [];
    index.forEach(function (p) {
      if (!p || !p.id) return;
      var b = partsById[p.id];
      if (!b || typeof b !== 'object') { missing.push(p.id); return; }
      var g = b.kind === 'pages' ? 'pages\u0000' + String(b.docId) : String(b.kind);
      if (!groups[g]) { groups[g] = []; groupOrder.push(g); }
      groups[g].push(b);
    });
    groupOrder.forEach(function (g) {
      groups[g].sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
      groups[g].forEach(function (body) {
        var b = JSON.parse(JSON.stringify(body));
        if (b.kind === 'pages') {
          var k = String(b.docId);
          (pagesBy[k] = pagesBy[k] || []).push.apply(pagesBy[k], Array.isArray(b.pages) ? b.pages : []);
        } else if (lists[b.kind]) {
          lists[b.kind].push.apply(lists[b.kind], Array.isArray(b.items) ? b.items : []);
        }
      });
    });
    var C = m;
    C.docs = (Array.isArray(m.docs) ? m.docs : []).map(function (d) {
      var o = d || {};
      o.pages = joinSegPages(pagesBy[String(o.id)] || []);
      return o;
    });
    C.statements = lists.statements;
    C.changes = lists.changes;
    C.facts = lists.facts;
    if (lists.rejected.length) C.rejected = lists.rejected;
    if (!Array.isArray(C.issues)) C.issues = [];
    return { C: C, missing: missing };
  }

  /* ---------- 저장소 백엔드 ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  function dbBackend(db) {
    // 일시 오류(unavailable)는 짧게 한 번, 예산 초과(resource_exhausted)는 길게 한 번만 다시 시도한다.
    function call(fn) {
      var tried = false;
      function once() {
        var p;
        try { p = fn(); } catch (e) {
          return Promise.reject(serr('bad_path', '저장 경로가 잘못되었습니다: ' + (e && e.message)));
        }
        return Promise.resolve(p).catch(function (e) {
          var code = e && e.code;
          if (!tried && (code === 'unavailable' || code === 'resource_exhausted')) {
            tried = true;
            return sleep(code === 'unavailable' ? 300 + Math.random() * 600 : 1500 + Math.random() * 1000).then(once);
          }
          throw e;
        });
      }
      return once();
    }
    return {
      kind: 'db',
      get: function (path) {
        return call(function () { return db.doc(path).get(); }).then(function (s) {
          return s && s.exists ? s.data() : null;
        });
      },
      set: function (path, body) { return call(function () { return db.doc(path).set(body); }); },
      del: function (path) { return call(function () { return db.doc(path).delete(); }); },
      list: function (col) {
        return call(function () { return db.collection(col).limit(1000).get(); }).then(function (q) {
          return (q && q.docs ? q.docs : []).filter(function (d) { return d.exists; })
            .map(function (d) { return { id: d.id, data: d.data() }; });
        });
      }
    };
  }

  function localBackend(notify) {
    var mem = {}, ls = null, persistent = false;
    try {
      ls = root.localStorage;
      if (ls) {
        var probe = LS_PREFIX + '__probe';
        ls.setItem(probe, '1'); ls.removeItem(probe);
        persistent = true;
        for (var i = 0; i < ls.length; i++) {
          var key = ls.key(i);
          if (key && key.indexOf(LS_PREFIX) === 0) {
            try { mem[key.slice(LS_PREFIX.length)] = JSON.parse(ls.getItem(key)); } catch (e) { /* 깨진 항목은 건너뜀 */ }
          }
        }
      }
    } catch (e) { ls = null; persistent = false; }
    var be = {
      kind: 'local',
      persistent: function () { return persistent; },
      get: function (path) { return Promise.resolve(mem[path] ? clone(mem[path]) : null); },
      set: function (path, body) {
        mem[path] = clone(body);
        if (ls && persistent) {
          try { ls.setItem(LS_PREFIX + path, JSON.stringify(body)); }
          catch (e) { persistent = false; notify('local_full'); }
        }
        return Promise.resolve();
      },
      del: function (path) {
        delete mem[path];
        if (ls) { try { ls.removeItem(LS_PREFIX + path); } catch (e) { /* 무시 */ } }
        return Promise.resolve();
      },
      list: function (col) {
        var pre = col + '/', out = [];
        Object.keys(mem).forEach(function (k) {
          if (k.indexOf(pre) === 0 && k.slice(pre.length).indexOf('/') < 0) out.push({ id: k.slice(pre.length), data: clone(mem[k]) });
        });
        out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
        return Promise.resolve(out);
      }
    };
    return be;
  }

  /* ---------- 상태 ---------- */
  var S = {
    initP: null, backend: null, mode: null, canWrite: false, writeKnown: false,
    reason: '', revoked: false, persistent: false, known: {}, chains: {}, listeners: []
  };
  function status() {
    return {
      mode: S.mode, canWrite: !!S.canWrite, persistent: !!S.persistent,
      reason: S.reason, revoked: !!S.revoked
    };
  }
  function emit() {
    var st = status();
    S.listeners.slice().forEach(function (fn) { try { fn(st); } catch (e) { /* 듣는 쪽 오류 무시 */ } });
  }
  function onLocalEvent(kind) {
    if (kind === 'local_full') { S.persistent = false; S.reason = 'local_full'; emit(); }
  }
  function markReadOnly(reason) {
    if (!S.canWrite && S.reason === reason) return;
    S.canWrite = false; S.reason = reason; emit();
  }

  async function init() {
    var cl = root.claude, db = null, user = null;
    if (cl && typeof cl.use === 'function') {
      try { db = await cl.use('db'); } catch (e) { db = null; }
      if (db) { try { user = await cl.use('user'); } catch (e) { user = null; } }
    }
    if (db) {
      S.backend = dbBackend(db); S.mode = 'db'; S.persistent = true;
      var can = null;
      if (user && typeof user.can === 'function') {
        try { can = await user.can('data.write'); } catch (e) { can = null; }
      }
      // null 은 "알려 주지 않음": 쓰기를 허용해 두고 실제 거절이 오면 읽기 전용으로 바꾼다(db.d.ts 지침).
      S.canWrite = can !== false; S.writeKnown = can !== null;
      S.reason = can === false ? 'no_write' : '';
    } else {
      S.backend = localBackend(onLocalEvent); S.mode = 'local';
      S.persistent = S.backend.persistent();
      S.canWrite = true; S.writeKnown = true;
      S.reason = !cl ? 'no_claude' : (S.persistent ? 'no_db' : 'no_storage');
    }
    emit();
    return status();
  }

  function ensureInit() { if (!S.initP) S.initP = init(); return S.initP; }

  function mapWriteError(e, body) {
    var code = e && e.code;
    if (code === 'invalid_argument') {
      var bytes = body ? utf8Bytes(JSON.stringify(body)) : 0;
      if (bytes <= LIMIT) { markReadOnly('no_write'); return serr('read_only', '쓰기 권한이 없어 저장하지 못했습니다. 읽기 전용으로 전환합니다.'); }
      return serr('too_large', '저장 묶음이 너무 큽니다.');
    }
    if (code === 'revoked') { S.revoked = true; markReadOnly('revoked'); return serr('revoked', '저장소를 더 이상 쓸 수 없습니다. 새로고침해 주세요.'); }
    if (code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') {
      markReadOnly('unavailable'); return serr('unavailable', '이 화면에서는 저장소를 쓸 수 없습니다.');
    }
    if (code === 'quota_exceeded') return serr('quota_exceeded', '저장 공간 한도에 도달했습니다. 쓰지 않는 사건을 지운 뒤 다시 시도해 주세요.');
    if (code === 'resource_exhausted') return serr('resource_exhausted', '저장 요청이 너무 잦습니다. 잠시 뒤 다시 시도해 주세요.');
    if (code === 'bad_path') return e;
    return serr(code || 'unavailable', '일시적인 문제로 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  }
  async function write(path, body) {
    try { await S.backend.set(path, body); }
    catch (e) { throw mapWriteError(e, body); }
  }
  async function runLimited(items, n, fn) {
    var i = 0, errs = [];
    async function worker() {
      while (i < items.length) {
        var it = items[i++];
        try { await fn(it); } catch (e) { errs.push(e); if (errs.length === 1) i = items.length; }
      }
    }
    var ws = [];
    for (var k = 0; k < Math.min(n, items.length); k++) ws.push(worker());
    await Promise.all(ws);
    if (errs.length) throw errs[0];
  }
  function indexOfMeta(meta) {
    var parts = {};
    (meta && Array.isArray(meta.parts) ? meta.parts : []).forEach(function (p) { if (p && p.id) parts[p.id] = p.h; });
    return { metaHash: meta ? metaHash(meta) : null, parts: parts };
  }

  async function doSave(C, opts) {
    opts = opts || {};
    await ensureInit();
    if (S.revoked) throw serr('revoked', '저장소를 더 이상 쓸 수 없습니다. 새로고침해 주세요.');
    if (!S.canWrite) throw serr('read_only', '읽기 전용이라 저장할 수 없습니다.');
    if (C && C._partial && !opts.force) throw serr('partial_case', '일부 묶음을 읽지 못한 사건이라 저장하지 않았습니다. 다시 읽은 뒤 저장해 주세요.');
    var sp = split(C);
    var id = sp.caseId, base = 'cases/' + safeSeg(id);
    var known = S.known[id];
    if (!known) {
      var old = null;
      try { old = await S.backend.get(base); } catch (e) { old = null; }
      known = indexOfMeta(old);
    }
    var newIds = {};
    sp.parts.forEach(function (p) { newIds[p.id] = 1; });
    var changed = sp.parts.filter(function (p) { return known.parts[p.id] !== p.hash; });
    var stale = Object.keys(known.parts).filter(function (pid) { return !newIds[pid]; });
    if (!changed.length && !stale.length && known.metaHash === sp.metaHash) {
      return { unchanged: true, written: 0, deleted: 0, updatedAt: C.updatedAt || null };
    }
    var now = new Date().toISOString();
    sp.meta.updatedAt = now;
    if (typeof opts.onProgress === 'function') opts.onProgress(0, changed.length + 1);
    var done = 0;
    // 묶음 먼저, 메타는 마지막(메타 색인이 아직 쓰지 않은 묶음을 가리키지 않게)
    await runLimited(changed, 2, async function (p) {
      await write(base + '/parts/' + p.id, p.body);
      done++;
      if (typeof opts.onProgress === 'function') opts.onProgress(done, changed.length + 1);
    });
    await write(base, sp.meta);
    C.updatedAt = now;
    var kp = {};
    sp.parts.forEach(function (p) { kp[p.id] = p.hash; });
    S.known[id] = { metaHash: sp.metaHash, parts: kp };
    var deleted = 0;
    for (var i = 0; i < stale.length; i++) {
      try { await S.backend.del(base + '/parts/' + stale[i]); deleted++; } catch (e) { /* 남은 묶음은 색인에 없으므로 읽지 않는다 */ }
    }
    return { unchanged: false, written: changed.length + 1, deleted: deleted, updatedAt: now };
  }

  var Store = {
    LIMIT: LIMIT,
    init: function () { return ensureInit(); },
    status: status,
    onStatus: function (fn) {
      S.listeners.push(fn);
      return function () { S.listeners = S.listeners.filter(function (f) { return f !== fn; }); };
    },
    listCases: async function () {
      await ensureInit();
      var rows = await S.backend.list('cases');
      return rows.filter(function (r) { return r.data && typeof r.data === 'object'; }).map(function (r) {
        var m = r.data;
        return {
          id: m.id != null ? String(m.id) : r.id, title: m.title || '', caseNo: m.caseNo || '',
          court: m.court || '', updatedAt: m.updatedAt || '', counts: m.counts || {}
        };
      }).sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); });
    },
    loadCase: async function (id) {
      await ensureInit();
      var base = 'cases/' + safeSeg(id);
      var meta = await S.backend.get(base);
      if (!meta) throw serr('not_found', '사건을 찾지 못했습니다.');
      var index = Array.isArray(meta.parts) ? meta.parts : [];
      var found = {};
      if (index.length) {
        try {
          (await S.backend.list(base + '/parts')).forEach(function (d) { found[d.id] = d.data; });
        } catch (e) {
          if (e && e.code === 'revoked') { S.revoked = true; markReadOnly('revoked'); throw serr('revoked', '저장소를 더 이상 쓸 수 없습니다.'); }
        }
        var need = index.filter(function (p) { return p && !found[p.id]; });
        await runLimited(need, 3, async function (p) {
          try { var b = await S.backend.get(base + '/parts/' + p.id); if (b) found[p.id] = b; } catch (e) { /* 빈 묶음으로 남김 */ }
        });
      }
      var res = join(meta, found);
      var C = res.C;
      // 실제로 읽은 내용 기준으로 "알려진 상태"를 기록한다(다른 사람이 고친 묶음은 다음 저장에서 다시 쓴다)
      var kp = {};
      index.forEach(function (p) { if (p && found[p.id]) kp[p.id] = hashBody(found[p.id]); });
      S.known[String(meta.id != null ? meta.id : id)] = { metaHash: metaHash(meta), parts: kp };
      if (res.missing.length) {
        Object.defineProperty(C, '_partial', { value: true, enumerable: false, configurable: true, writable: true });
      }
      Object.defineProperty(C, '_missing', { value: res.missing, enumerable: false, configurable: true, writable: true });
      return C;
    },
    saveCase: function (C, opts) {
      var id = C && C.id != null ? String(C.id) : '';
      var prev = S.chains[id] || Promise.resolve();
      var p = prev.catch(function () {}).then(function () { return doSave(C, opts); });
      S.chains[id] = p;
      return p;
    },
    deleteCase: async function (id) {
      await ensureInit();
      if (!S.canWrite) throw serr('read_only', '읽기 전용이라 지울 수 없습니다.');
      var base = 'cases/' + safeSeg(id);
      var meta = null;
      try { meta = await S.backend.get(base); } catch (e) { meta = null; }
      var ids = {};
      (meta && Array.isArray(meta.parts) ? meta.parts : []).forEach(function (p) { if (p && p.id) ids[p.id] = 1; });
      try { (await S.backend.list(base + '/parts')).forEach(function (d) { ids[d.id] = 1; }); } catch (e) { /* 색인만으로 진행 */ }
      var all = Object.keys(ids);
      // 메타를 먼저 지워 목록에서 사라지게 하고, 묶음은 그다음 지운다.
      try { await S.backend.del(base); } catch (e) { throw mapWriteError(e, null); }
      await runLimited(all, 2, async function (pid) {
        try { await S.backend.del(base + '/parts/' + pid); } catch (e) { /* 남은 묶음은 색인이 없어 읽히지 않는다 */ }
      });
      delete S.known[String(id)];
      return { deleted: all.length + 1 };
    },
    /* 순수 함수(시딩 도구, 시험용) */
    split: split, join: join, clean: clean, canon: canon, hash: hash, hashBody: hashBody,
    metaHash: metaHash, utf8Bytes: utf8Bytes, safeSeg: safeSeg,
    _reset: function () {
      S.initP = null; S.backend = null; S.mode = null; S.canWrite = false; S.writeKnown = false;
      S.reason = ''; S.revoked = false; S.persistent = false; S.known = {}; S.chains = {};
    }
  };
  SY.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
