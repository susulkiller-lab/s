/* 사건 연표 - 자료 올리기 (SY.Ingest). 담당: 자료 올리기. 설계서 4.3, 5.
   공개 API
     SY.Ingest.mount(el, { getCase, onDocs, rules, setRules }) -> ctrl
     SY.Ingest.classifyName(fileName[, rules]) -> { caseNo, date, kind, role, submitter, seq, title, reason, ... }
   보조(순수 함수, node 단위 시험 대상)
     splitPages, stripWatermark, judgeScan, parseDriveRef, listDriveFolder, guessSide, learnSides,
     dedupeKey, normalizeRules, getRules, setRules, b64ToBlob
   정의 시점에는 DOM, CDN 라이브러리(pdf.js, mammoth, jszip), claude 능력을 가정하지 않는다(사용 시점에 검사). */
(function (root) {
  'use strict';
  var SY = root.SY = root.SY || {};
  var I = SY.Ingest = SY.Ingest || {};

  /* ---------- 상수 ---------- */
  var CDN = {
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    mammoth: 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  };
  I.CDN = CDN;
  var DRIVE_SERVER = 'Google Drive';
  var FOLDER_MIME = 'application/vnd.google-apps.folder';
  var LS_KEY = 'sayeon.ingest.rules.v1';
  var PAGE_SIZE = 50;            // 자료함 한 화면 행 수
  var IMG_LONG = 1600;           // 스캔 쪽 그림의 긴 변(px)
  var SCAN_AVG = 40;             // 쪽당 평균 글자 수(공백 제외, 머리글 제거 후)가 이보다 적으면 스캔본
  var PAGE_MIN = 5;              // 텍스트 서면 안에서도 글자가 이보다 적은 쪽은 그림 쪽(needsOcr)으로 본다
  var DRIVE_SCAN_MIN = 50;       // 드라이브 본문(쪽 구분 없음) 전체 글자 수가 이보다 적으면 스캔본
  var MAX_LIST_CALLS = 400;      // 드라이브 목록 반복 호출 안전장치
  var SIDES = ['원고', '피고'];

  var DEFAULT_RULES = {
    include: ['소장', '답변서', '준비서면', '반소장', '항소장', '항소이유서', '변론요지서', '청구취지 및 청구원인 변경신청서', '참고서면'],
    record: ['변론조서', '변론준비기일조서', '판결', '화해권고결정', '조정조서', '이행권고결정'],
    exclude: ['서증', '첨부', '증거설명서', '증거신청', '문서제출명령', '사실조회', '보정명령', '송달', '위임장', '독촉', '멀티미디어'],
    ourCounsel: []
  };
  /* 서면 종류만으로 정해지는 측(민사 절차상 제출 주체). 사용자가 확정한다. */
  var KIND_SIDE = { '소장': '원고', '청구취지및청구원인변경신청서': '원고', '답변서': '피고', '반소장': '피고' };
  var KIND_SUGGEST = ['소장', '답변서', '준비서면', '반소장', '항소장', '항소이유서', '변론요지서', '청구취지 및 청구원인 변경신청서', '참고서면', '변론조서', '판결', '화해권고결정'];
  var EXT_KIND = { pdf: 'pdf', docx: 'docx', hwpx: 'hwpx', txt: 'text', md: 'text', markdown: 'text', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', hwp: 'hwp', doc: 'doc' };
  var KNOWN_EXT_RE = /\.(pdf|docx?|hwpx?|txt|md|markdown|png|jpe?g|webp|gif|tiff?|bmp|heic|zip|xlsx?|pptx?|rtf|odt)$/i;
  var SPLIT_LABEL = { formfeed: '폼피드 문자', marker: "'=== p.3 ===' 표시", pageno: "'- 3 -' 쪽번호 줄", blank: '빈 줄 3개 이상', none: '나누지 않음(한 쪽)' };
  I.SPLIT_LABEL = SPLIT_LABEL;
  var ROLE_LABEL = { brief: '서면', record: '기록', skip: '제외', unknown: '미정' };

  /* ---------- 작은 도우미 ---------- */
  function esc(s) { return SY.esc ? SY.esc(s) : String(s == null ? '' : s); }
  function compact(s) { return String(s == null ? '' : s).normalize('NFC').replace(/[\s\u00a0\u200b\u3000]+/g, ''); }
  function compactLen(s) { return compact(s).length; }
  function extOf(name) { var m = /\.([A-Za-z0-9]{1,8})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; }
  function baseName(name) { var s = String(name || ''); var i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i >= 0 ? s.slice(i + 1) : s; }
  function stripExt(name) { return String(name || '').replace(KNOWN_EXT_RE, ''); }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function ymd(y, m, d) {
    y = Number(y); m = Number(m); d = Number(d);
    if (!isFinite(y) || !isFinite(m) || !isFinite(d)) return null;
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }
  function uniq(arr) { var seen = {}, out = []; arr.forEach(function (x) { var k = compact(x); if (k && !seen[k]) { seen[k] = 1; out.push(x); } }); return out; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tick() { return sleep(0); }
  function short(s, n) { s = String(s == null ? '' : s).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); n = n || 160; return s.length > n ? s.slice(0, n) + '…' : s; }
  function ierr(code, message, extra) { var e = new Error(message); e.ingest = true; e.code = code; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; }
  function isAbort(e, signal) { return (signal && signal.aborted) || (e && (e.name === 'AbortError' || e.code === 'cancelled' || e.code === 'aborted')); }
  function asObject(p) {
    if (typeof p === 'string') { try { return JSON.parse(p); } catch (e) { return p; } }
    return p == null ? {} : p;
  }
  function withTimeout(promise, ms, code) {
    var t;
    return Promise.race([promise, new Promise(function (_, rej) { t = setTimeout(function () { rej(ierr(code || 'timeout', '시간 초과')); }, ms); })])
      .then(function (v) { clearTimeout(t); return v; }, function (e) { clearTimeout(t); throw e; });
  }

  /* ---------- 분류 규칙 ---------- */
  function listOf(v) {
    if (typeof v === 'string') v = v.split(/[,，\n]/);
    return Array.isArray(v) ? uniq(v.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(Boolean)) : [];
  }
  I.DEFAULT_RULES = DEFAULT_RULES;
  I.normalizeRules = function (r) {
    r = r || {};
    function pick(k) { return Object.prototype.hasOwnProperty.call(r, k) ? listOf(r[k]) : DEFAULT_RULES[k].slice(); }
    return { include: pick('include'), record: pick('record'), exclude: pick('exclude'), ourCounsel: pick('ourCounsel') };
  };
  var currentRules = I.normalizeRules(DEFAULT_RULES);
  I.getRules = function () { return JSON.parse(JSON.stringify(currentRules)); };
  I.setRules = function (r) { currentRules = I.normalizeRules(r); return I.getRules(); };

  /* 가장 긴 낱말이 이긴다. 길이가 같으면 제외 > 기록 > 서면. */
  function matchRole(text, rules) {
    var t = compact(text);
    if (!t) return null;
    var lists = [['exclude', 'skip', 0], ['record', 'record', 1], ['include', 'brief', 2]];
    var best = null;
    lists.forEach(function (L) {
      (rules[L[0]] || []).forEach(function (k) {
        var kk = compact(k);
        if (!kk || t.indexOf(kk) < 0) return;
        if (!best || kk.length > best.len || (kk.length === best.len && L[2] < best.pri)) best = { role: L[1], list: L[0], keyword: k, len: kk.length, pri: L[2] };
      });
    });
    return best;
  }
  function reasonOf(b) {
    return { exclude: '제외 규칙', record: '기록 규칙', include: '서면 규칙' }[b.list] + " '" + b.keyword + "'";
  }
  function findDate(stem) {
    var m = /\((\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})\)/.exec(stem);
    if (m) return ymd(m[1], m[2], m[3]);
    m = /(?:^|\D)((?:19|20)\d{2})[.\-_ ]\s?(\d{1,2})[.\-_ ]\s?(\d{1,2})(?!\d)/.exec(stem);
    if (m) return ymd(m[1], m[2], m[3]);
    m = /(?:^|\D)((?:19|20)\d{2})(\d{2})(\d{2})(?!\d)/.exec(stem);
    if (m) return ymd(m[1], m[2], m[3]);
    return null;
  }
  var ECOURT_RE = /^(?:(\d{2,4}[가-힣]{1,5}\d{1,8})_)?\((\d{2}|\d{4})\.(\d{1,2})\.(\d{1,2})\)\s*(.+?)_(?:(서증|첨부)_)?(\d{5,7})\.(.*)$/;
  var EVID_RE = /^(갑|을|병|정)\s*(?:제\s*)?\d+/;
  /* 전자소송 파일명: 사건번호_(yy.mm.dd)서면종류_NNNNNN.제목_제출자.pdf
     서증: 사건번호_(yy.mm.dd)서면종류_서증_NNNNNN.갑3-3_제목_제출자.pdf, 첨부: ..._첨부_NNNNNN.제목_제출자.pdf */
  I.classifyName = function (fileName, rules) {
    rules = rules ? I.normalizeRules(rules) : currentRules;
    var name = baseName(fileName).normalize('NFC').trim();
    var stem = stripExt(name);
    var out = { caseNo: null, date: null, kind: '', role: 'unknown', submitter: null, seq: null, title: stem, reason: '', format: 'generic', sub: null, evidence: null, keyword: null };
    var m = ECOURT_RE.exec(stem), b = null;
    if (m) {
      out.format = 'ecourt';
      out.caseNo = m[1] || null;
      out.date = ymd(m[2], m[3], m[4]);
      out.kind = m[5].trim();
      out.sub = m[6] || null;
      out.seq = m[7];
      var parts = m[8].split('_');
      if (parts.length >= 2) out.submitter = parts.pop().trim() || null;
      if (out.sub === '서증' && parts.length >= 2 && EVID_RE.test(parts[0])) out.evidence = parts.shift().trim();
      else if (out.sub === '서증' && parts.length === 1 && EVID_RE.test(parts[0])) out.evidence = parts[0].trim();
      out.title = parts.join('_').trim() || out.kind;
      if (out.sub === '서증') { out.role = 'skip'; out.keyword = '서증'; out.reason = '서증(증거) 파일'; return out; }
      if (out.sub === '첨부') { out.role = 'skip'; out.keyword = '첨부'; out.reason = '첨부 서류'; return out; }
      b = matchRole(out.kind, rules) || matchRole(out.title, rules);
    } else {
      out.date = findDate(stem);
      var lead = stem.replace(/^[\d._\-\s()]+/, '');
      if (/^(갑|을|병|정)\s*(?:제\s*)?\d+(?:\s*호증)?(?:[-의\s]\s*\d+)?(?:[_\s.]|$)/.test(lead)) {
        out.role = 'skip'; out.keyword = '호증'; out.reason = '증거(호증) 파일로 보임';
        return out;
      }
      b = matchRole(stem, rules);
      if (b && b.list !== 'exclude') out.kind = b.keyword;
    }
    if (b) { out.role = b.role; out.keyword = b.keyword; out.reason = reasonOf(b); }
    else { out.role = 'unknown'; out.reason = '분류 규칙에 맞는 낱말이 없습니다. 직접 정해 주십시오.'; }
    return out;
  };

  /* ---------- 쪽 구분 ---------- */
  var MARK_SRC = '^[ \\t]*={2,}[ \\t]*p(?:age)?\\.?[ \\t]*(\\d{1,4})[ \\t]*={2,}[ \\t]*$';
  var PAGENO_SRC = '^[ \\t]*[-\u2013\u2014][ \\t]*(\\d{1,4})[ \\t]*[-\u2013\u2014][ \\t]*$';
  var BLANK_SRC = '\\n(?:[ \\t\\u00a0\\u3000]*\\n){3,}';
  function trimBlank(s) { return String(s).replace(/^(?:[ \t\u3000]*\n)+/, '').replace(/\s+$/, ''); }
  function splitBy(t, m) {
    var re, x, idx, pages, i;
    if (m === 'formfeed') {
      if (t.indexOf('\f') < 0) return null;
      pages = t.split('\f');
      while (pages.length > 1 && !pages[pages.length - 1].trim()) pages.pop();
      return pages.map(trimBlank);
    }
    if (m === 'marker') {
      re = new RegExp(MARK_SRC, 'gim'); idx = [];
      while ((x = re.exec(t))) idx.push({ s: x.index, e: x.index + x[0].length });
      if (!idx.length) return null;
      pages = [];
      for (i = 0; i < idx.length; i++) pages.push(t.slice(idx[i].e, i + 1 < idx.length ? idx[i + 1].s : t.length));
      var pre = t.slice(0, idx[0].s);
      if (pre.trim()) pages[0] = pre.replace(/\s+$/, '') + '\n' + trimBlank(pages[0]);
      return pages.map(trimBlank);
    }
    if (m === 'pageno') {
      re = new RegExp(PAGENO_SRC, 'gm'); pages = []; var last = 0, found = 0;
      while ((x = re.exec(t))) { pages.push(t.slice(last, x.index)); last = x.index + x[0].length; found++; }
      if (!found) return null;
      var tail = t.slice(last);
      if (tail.trim()) pages.push(tail);
      if (pages.length > 1 && !pages[0].trim()) pages.shift();
      return pages.map(trimBlank);
    }
    if (m === 'blank') {
      re = new RegExp(BLANK_SRC);
      if (!re.test(t)) return null;
      return t.split(new RegExp(BLANK_SRC, 'g')).filter(function (p) { return p.trim(); }).map(trimBlank);
    }
    if (m === 'none') return [trimBlank(t)];
    return null;
  }
  /* method: 'auto'(폼피드 > 표시 > 쪽번호 > 빈 줄) | 'auto-strict'(빈 줄 규칙 제외) | 'formfeed' | 'marker' | 'pageno' | 'blank' | 'none' */
  I.splitPages = function (text, method) {
    var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    if (!t.trim()) return { pages: [], method: 'empty' };
    method = method || 'auto';
    var order = method === 'auto' ? ['formfeed', 'marker', 'pageno', 'blank'] : method === 'auto-strict' ? ['formfeed', 'marker', 'pageno'] : [method];
    for (var i = 0; i < order.length; i++) {
      var pages = splitBy(t, order[i]);
      if (pages && pages.length > 1) return { pages: pages, method: order[i] };
    }
    return { pages: [trimBlank(t)], method: 'none' };
  };

  /* ---------- 전자소송 머리글(워터마크) ---------- */
  var WM_LINE_RE = /^[ \t 　]*개인정보[ \t]*유출[ \t]*주의[^\n\f]*제출자[^\n\f]*(?:\n|$)/gm; // 폼피드(쪽 구분)는 남긴다
  var WM_INLINE_RE = /개인정보[ \t]*유출[ \t]*주의[ \t]*제출자[ \t]*:[^\n\f]*?다운로드[ \t]*일시[ \t]*:[ \t]*\d{4}\.[ \t]*\d{1,2}\.[ \t]*\d{1,2}\.?(?:[ \t]+\d{1,2}:\d{2}(?::\d{2})?)?/g;
  var WM_HEAD_RE = /개인정보\s*유출\s*주의\s*제출자\s*:\s*([^,\n]+?)\s*,\s*제출\s*일시\s*:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/;
  /* 전자소송에서 내려받은 PDF 의 '개인정보유출주의 제출자:..., 제출일시:..., 출력자:..., 다운로드일시:...' 줄을 걷어 낸다.
     머리글에서 제출자·제출일을 읽어 header 로 돌려준다(출력자 이름은 버린다). */
  I.stripWatermark = function (text) {
    var t = String(text == null ? '' : text), removed = 0, header = null;
    var h = WM_HEAD_RE.exec(t);
    if (h) header = { submitter: h[1].trim(), filedDate: ymd(h[2], h[3], h[4]) };
    t = t.replace(WM_LINE_RE, function () { removed++; return ''; });
    t = t.replace(WM_INLINE_RE, function () { removed++; return ''; });
    return { text: t, header: header, removed: removed };
  };
  /* 쪽별 텍스트(머리글 제거 후)로 스캔본 판정. */
  I.judgeScan = function (pageTexts) {
    var counts = (pageTexts || []).map(compactLen);
    var n = Math.max(1, counts.length), total = counts.reduce(function (a, b) { return a + b; }, 0);
    var avg = total / n, scan = avg < SCAN_AVG;
    return { scan: scan, avg: avg, total: total, counts: counts, perPage: counts.map(function (c) { return scan || c < PAGE_MIN; }) };
  };
  I.SCAN_AVG = SCAN_AVG; I.PAGE_MIN = PAGE_MIN; I.DRIVE_SCAN_MIN = DRIVE_SCAN_MIN;
  /* 쪽 구분 없는 본문(드라이브 read_file_content)이 사실상 비었는지 */
  I.isEmptyBody = function (text) { return compactLen(I.stripWatermark(text).text) < DRIVE_SCAN_MIN; };

  /* ---------- 구글 드라이브 ---------- */
  var ID_RE = '([A-Za-z0-9_-]{10,})';
  /* 링크·ID -> { id, type:'folder'|'file'|'unknown' } | null */
  I.parseDriveRef = function (s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    var m;
    if ((m = new RegExp('/folders/' + ID_RE).exec(s))) return { id: m[1], type: 'folder' };
    if ((m = new RegExp('/file/(?:u/\\d+/)?d/' + ID_RE).exec(s))) return { id: m[1], type: 'file' };
    if ((m = new RegExp('docs\\.google\\.com/[^?#]*?/d/' + ID_RE).exec(s))) return { id: m[1], type: 'file' };
    if ((m = new RegExp('[?&]id=' + ID_RE).exec(s))) return { id: m[1], type: 'unknown' };
    if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return { id: s, type: 'unknown' };
    return null;
  };
  function normDriveFile(o) {
    o = asObject(o);
    if (o && typeof o === 'object' && o.file && typeof o.file === 'object') o = o.file;
    if (!o || typeof o !== 'object') o = {};
    var title = String(o.title || o.name || '');
    var size = o.fileSize != null ? Number(o.fileSize) : o.size != null ? Number(o.size) : null;
    return {
      id: o.id || o.fileId || null, title: title, mimeType: String(o.mimeType || ''),
      ext: String(o.fileExtension || extOf(title) || '').toLowerCase(), size: isFinite(size) ? size : null,
      modifiedTime: o.modifiedTime || '', parentId: o.parentId || null, viewUrl: o.viewUrl || o.webViewLink || ''
    };
  }
  I.normDriveFile = normDriveFile;
  function defaultSearchInput(folderId, token) {
    var o = { query: "parentId = '" + folderId + "'", pageSize: 100, excludeContentSnippets: true };
    if (token) o.pageToken = token;
    return o;
  }
  /* 폴더 목록을 끝까지 모은다. call(tool, input) -> Promise<payload>.
     끝 조건: nextPageToken 없음(빈 객체 {} 포함), 같은 토큰 반복, 호출 한도, 중지 신호. */
  I.listDriveFolder = async function (call, folderId, opts) {
    opts = opts || {};
    if (!/^[A-Za-z0-9_-]+$/.test(String(folderId || ''))) throw ierr('bad_id', '폴더 ID 형식이 아닙니다.');
    var maxCalls = opts.maxCalls || MAX_LIST_CALLS;
    var build = opts.buildInput || defaultSearchInput;
    var queue = [{ id: folderId, path: '' }], seenFolder = {}, seenFile = {};
    seenFolder[folderId] = 1;
    var files = [], folders = [], calls = 0, skippedFolders = 0;
    function done(stopped) { return { files: files, folders: folders, calls: calls, stopped: stopped, skippedFolders: skippedFolders }; }
    while (queue.length) {
      var f = queue.shift(), token = null, seenTok = {};
      for (;;) {
        if (opts.signal && opts.signal.aborted) return done('cancelled');
        if (calls >= maxCalls) return done('limit');
        var p = asObject(await call('search_files', build(f.id, token)));
        calls++;
        var list = p && Array.isArray(p.files) ? p.files : [];
        list.forEach(function (raw) {
          var x = normDriveFile(raw);
          if (!x.id || seenFile[x.id]) return;
          seenFile[x.id] = 1;
          x.path = f.path;
          if (x.mimeType === FOLDER_MIME) {
            folders.push(x);
            if (opts.recursive && !seenFolder[x.id]) { seenFolder[x.id] = 1; queue.push({ id: x.id, path: f.path + (x.title || x.id) + '/' }); }
            else if (!opts.recursive) skippedFolders++;
          } else files.push(x);
        });
        if (opts.onProgress) opts.onProgress({ files: files.length, folders: folders.length, calls: calls });
        var next = p && typeof p.nextPageToken === 'string' && p.nextPageToken ? p.nextPageToken : null;
        if (!next || seenTok[next]) break;
        seenTok[next] = 1;
        token = next;
      }
    }
    return done(null);
  };
  I.b64ToBlob = function (b64, type) {
    var s = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(s), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  };

  /* ---------- 측 추정 ---------- */
  /* entries: [{submitter, side, from}] -> { 제출자(공백 제거): {side, from} }. 양쪽으로 갈리는 제출자는 버린다. */
  I.learnSides = function (entries) {
    var map = {}, bad = {};
    (entries || []).forEach(function (e) {
      var k = compact(e && e.submitter);
      if (!k || SIDES.indexOf(e.side) < 0) return;
      if (map[k] && map[k].side !== e.side) bad[k] = 1;
      else if (!map[k]) map[k] = { side: e.side, from: e.from || '' };
    });
    Object.keys(bad).forEach(function (k) { delete map[k]; });
    return map;
  };
  /* info: {kind, submitter}. 확신이 없으면 '미정'. 확정은 사용자가 자료함에서 한다. */
  I.guessSide = function (info, C, learned, rules) {
    rules = rules || currentRules;
    info = info || {};
    var sub = compact(info.submitter), parties = (C && C.parties) || {};
    if (sub) {
      for (var i = 0; i < SIDES.length; i++) {
        var pn = compact(parties[SIDES[i]]);
        if (pn.length >= 2 && sub.indexOf(pn) >= 0) return { side: SIDES[i], why: '제출자가 ' + SIDES[i] + ' 당사자(' + parties[SIDES[i]] + ')입니다' };
      }
      var hasP = /원고/.test(sub), hasD = /피고/.test(sub);
      if (hasP !== hasD) return { side: hasP ? '원고' : '피고', why: '제출자 표시에 ' + (hasP ? '원고' : '피고') + '가 있습니다' };
      var our = C && SIDES.indexOf(C.ourSide) >= 0 ? C.ourSide : null;
      if (our) {
        var hit = (rules.ourCounsel || []).filter(function (n) { var c = compact(n); return c.length >= 2 && sub.indexOf(c) >= 0; })[0];
        if (hit) return { side: our, why: '우리 측 대리인(' + hit + ')입니다' };
      }
      var l = learned && learned[sub];
      if (l && l.side) return { side: l.side, why: '같은 제출자의 ' + (l.from || '다른 서면') + '에 따른 추정입니다' };
    }
    var ks = KIND_SIDE[compact(info.kind)];
    if (ks) return { side: ks, why: '서면 종류(' + info.kind + ')에 따른 추정입니다' };
    return { side: '미정', why: '' };
  };
  I.dedupeKey = function (o) {
    return compact(o && o.name).toLowerCase() + '|' + (o && o.size != null ? o.size : '') + '|' + ((o && o.filedDate) || '');
  };

  /* ====================================================================
     브라우저 전용: 라이브러리 적재, 파일 읽기
     ==================================================================== */
  var scriptPromises = {};
  function loadScript(src) {
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(); };
      s.onerror = function () { delete scriptPromises[src]; rej(ierr('script_load', src)); };
      (document.head || document.documentElement).appendChild(s);
    });
    return scriptPromises[src];
  }
  var LIB_LABEL = { pdf: 'PDF', mammoth: 'DOCX', jszip: 'HWPX' };
  function libError(name) {
    return ierr('lib_' + name, LIB_LABEL[name] + ' 처리 모듈을 불러오지 못했습니다(외부 스크립트가 막혔을 수 있습니다). 화면을 새로 고친 뒤 다시 시도해 주십시오. 계속 안 되면 서면 본문을 복사해 텍스트 붙여넣기로 넣어 주십시오.');
  }
  async function ensureLib(name, url, get) {
    if (get()) return get();
    try { await loadScript(url); } catch (e) { throw libError(name); }
    if (!get()) throw libError(name);
    return get();
  }

  /* pdf.js: 1) 작업자 스레드(cdnjs 주소. pdf.js 가 교차 출처면 blob 래퍼로 감싸고, 실패하면 스스로 메인 스레드 가짜 작업자로 바꾼다)
             2) 작업자가 응답하지 않으면(보안 정책으로 막힘 등) 작업자 스크립트를 화면 스레드에 직접 올려 다시 시도
             3) 그래도 안 되면 명확한 오류와 대체 경로 안내 */
  var pdfState = { mode: null, worker: null, note: '' };
  I.pdfMode = function () { return pdfState.mode; };
  async function ensurePdfjs() {
    var lib = await ensureLib('pdf', CDN.pdf, function () { return root.pdfjsLib && root.pdfjsLib.getDocument ? root.pdfjsLib : null; });
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
    return lib;
  }
  async function getPdfWorker(lib) {
    if (pdfState.worker && !pdfState.worker.destroyed) return pdfState.worker;
    var w = new lib.PDFWorker({ name: 'sy-ingest' });
    try {
      await withTimeout(w.promise, pdfState.mode === 'main' ? 60000 : 15000, 'pdf_worker_timeout');
    } catch (e) {
      try { w.destroy(); } catch (e2) { /* 무시 */ }
      if (pdfState.mode === 'main') throw pdfWorkerError();
      try { await loadScript(CDN.pdfWorker); } catch (e3) { throw pdfWorkerError(); }
      pdfState.mode = 'main';
      w = new lib.PDFWorker({ name: 'sy-ingest-main' });
      try { await withTimeout(w.promise, 60000, 'pdf_worker_timeout'); } catch (e4) { try { w.destroy(); } catch (e5) { /* 무시 */ } throw pdfWorkerError(); }
    }
    pdfState.mode = w._webWorker ? 'worker' : 'main';
    pdfState.note = pdfState.mode === 'main' ? 'PDF 작업자 스레드를 쓸 수 없어 화면 스레드에서 처리합니다. 큰 파일은 느릴 수 있습니다.' : '';
    pdfState.worker = w;
    return w;
  }
  function pdfWorkerError() {
    return ierr('pdf_worker', 'PDF 처리 모듈(작업자)을 준비하지 못했습니다. 이 환경의 보안 설정이 막고 있을 수 있습니다. 화면을 새로 고친 뒤 다시 시도하시고, 계속 안 되면 DOCX로 저장해 올리거나 본문을 텍스트로 붙여넣어 주십시오.');
  }
  function joinTextItems(items) {
    var out = '', lastY = null;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (typeof it.str !== 'string') continue;
      var y = it.transform ? it.transform[5] : null;
      var hgt = it.height || 8;
      if (out && lastY != null && y != null && Math.abs(y - lastY) > hgt * 0.6 && out.charAt(out.length - 1) !== '\n') out += '\n';
      out += it.str;
      if (it.hasEOL) out += '\n';
      if (y != null) lastY = y;
    }
    return out;
  }
  var renderCanvas = null;
  async function renderPageJpeg(page) {
    var vp1 = page.getViewport({ scale: 1 });
    var scale = Math.min(4, IMG_LONG / Math.max(vp1.width, vp1.height));
    var vp = page.getViewport({ scale: scale });
    var c = renderCanvas || (renderCanvas = document.createElement('canvas'));
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    var ctx = c.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff'; // 그림 바탕(화면 테마와 무관한 종이색)
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
    if (!blob) throw ierr('render', '쪽 그림을 만들지 못했습니다.');
    return blob;
  }
  /* PDF -> { pages:[{n,text,status,image?}], header, notes } */
  async function readPdf(blob, opts) {
    opts = opts || {};
    var signal = opts.signal, progress = opts.onProgress || function () {};
    var data = new Uint8Array(await blob.arrayBuffer());
    var lib = await ensurePdfjs();
    progress('PDF 준비');
    var worker = await getPdfWorker(lib);
    var task = lib.getDocument({ data: data, worker: worker, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    var onAbort = function () { try { task.destroy(); } catch (e) { /* 무시 */ } };
    if (signal) signal.addEventListener('abort', onAbort);
    var pdf;
    try {
      pdf = await withTimeout(task.promise, 90000, 'pdf_timeout');
    } catch (e) {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (isAbort(e, signal)) throw ierr('aborted', '중지했습니다.');
      if (e && e.name === 'PasswordException') throw ierr('pdf_password', '암호가 걸린 PDF입니다. 암호를 풀어 다시 저장한 뒤 올려 주십시오.');
      if (e && (e.name === 'InvalidPDFException' || e.name === 'MissingPDFException')) throw ierr('pdf_invalid', 'PDF 파일을 열 수 없습니다(파일이 손상되었거나 일부만 받아졌을 수 있습니다).');
      if (e && e.code === 'pdf_timeout') { onAbort(); throw ierr('pdf_timeout', 'PDF를 여는 데 너무 오래 걸려 멈췄습니다. 파일을 나누어 올리거나 다시 시도해 주십시오.'); }
      throw ierr('pdf_open', 'PDF를 열지 못했습니다: ' + short(e && e.message));
    }
    try {
      var n = pdf.numPages, texts = [], header = null;
      for (var i = 1; i <= n; i++) {
        if (signal && signal.aborted) throw ierr('aborted', '중지했습니다.');
        var page = await pdf.getPage(i);
        var tc = await page.getTextContent();
        var sw = I.stripWatermark(joinTextItems(tc.items));
        if (!header && sw.header) header = sw.header;
        texts.push(sw.text);
        page.cleanup();
        progress('글자 ' + i + '/' + n + '쪽', i / n * 0.5);
        if (i % 4 === 0) await tick();
      }
      var j = I.judgeScan(texts);
      var pages = texts.map(function (t, k) { return { n: k + 1, text: j.perPage[k] ? '' : trimBlank(t), status: j.perPage[k] ? 'needsOcr' : 'text' }; });
      var need = pages.filter(function (p) { return p.status === 'needsOcr'; });
      for (var q = 0; q < need.length; q++) {
        if (signal && signal.aborted) throw ierr('aborted', '중지했습니다.');
        var pg = await pdf.getPage(need[q].n);
        need[q].image = await renderPageJpeg(pg);
        pg.cleanup();
        progress('쪽 그림 ' + (q + 1) + '/' + need.length, 0.5 + (q + 1) / need.length * 0.5);
        await tick();
      }
      var notes = [];
      if (pdfState.note) notes.push(pdfState.note);
      return { pages: pages, header: header, notes: notes };
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      try { await pdf.destroy(); } catch (e) { /* 무시 */ }
    }
  }
  I._readPdf = readPdf; // 시험용
  function textResult(text, method, extraNotes) {
    var sw = I.stripWatermark(text);
    var sp = I.splitPages(sw.text, method || 'auto-strict');
    if (!sp.pages.length || !compactLen(sp.pages.join(''))) throw ierr('empty', '파일에 읽을 글자가 없습니다.');
    var notes = (extraNotes || []).slice();
    notes.push(sp.method === 'none' ? '쪽 구분 표시가 없어 한 쪽으로 두었습니다.' : '쪽 구분: ' + SPLIT_LABEL[sp.method] + '(' + sp.pages.length + '쪽)');
    return { pages: sp.pages.map(function (t, i) { return { n: i + 1, text: t, status: 'text' }; }), header: sw.header, notes: notes };
  }
  async function readTextFile(file) {
    var buf = await file.arrayBuffer(), text, notes = [];
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) {
      try { text = new TextDecoder('euc-kr').decode(buf); notes.push('UTF-8이 아니어서 EUC-KR(완성형)으로 읽었습니다.'); }
      catch (e2) { text = new TextDecoder('utf-8').decode(buf); }
    }
    return textResult(text.replace(/^\uFEFF/, ''), 'auto', notes);
  }
  async function readDocx(file) {
    var mammoth = await ensureLib('mammoth', CDN.mammoth, function () { return root.mammoth && root.mammoth.extractRawText ? root.mammoth : null; });
    var r;
    try { r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() }); }
    catch (e) { throw ierr('docx', 'DOCX 파일을 읽지 못했습니다(파일 손상 또는 다른 형식). PDF로 저장해 올려 주십시오.'); }
    return textResult(r.value || '', 'auto-strict', ['DOCX에는 쪽 정보가 없어 쪽 구분 표시가 있을 때만 나눕니다.']);
  }
  var HWPX_SKIP = { secPr: 1, header: 1, footer: 1, pageNum: 1, pageHiding: 1, colPr: 1, linesegarray: 1 };
  async function readHwpx(file) {
    var JSZip = await ensureLib('jszip', CDN.jszip, function () { return root.JSZip && root.JSZip.loadAsync ? root.JSZip : null; });
    var zip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); }
    catch (e) { throw ierr('hwpx', 'HWPX 압축을 풀지 못했습니다. 한글에서 PDF로 저장해 올려 주십시오.'); }
    var names = Object.keys(zip.files).filter(function (n) { return /^Contents\/section\d+\.xml$/i.test(n); })
      .sort(function (a, b) { return Number(/(\d+)\.xml$/i.exec(a)[1]) - Number(/(\d+)\.xml$/i.exec(b)[1]); });
    if (!names.length) throw ierr('hwpx_nosection', 'HWPX 안에서 본문(Contents/section*.xml)을 찾지 못했습니다. 한글에서 PDF로 저장해 올려 주십시오.');
    var pages = [''];
    function cur(s) { pages[pages.length - 1] += s; }
    function textOfT(t) {
      var s = '';
      for (var c = t.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) s += c.data;
        else if (c.nodeType === 1) {
          var ln = c.localName;
          if (ln === 'tab') s += '\t';
          else if (ln === 'lineBreak') s += '\n';
          else if (ln === 'nbSpace' || ln === 'fwSpace') s += ' ';
          else s += c.textContent || '';
        }
      }
      return s;
    }
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var ln = c.localName;
        if (HWPX_SKIP[ln]) continue;
        if (ln === 'p') {
          if (c.getAttribute('pageBreak') === '1' && pages[pages.length - 1].trim()) pages.push('');
          walk(c);
          cur('\n');
        } else if (ln === 't') cur(textOfT(c));
        else walk(c);
      }
    }
    for (var i = 0; i < names.length; i++) {
      var xml = await zip.file(names[i]).async('string');
      var doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw ierr('hwpx_xml', 'HWPX 본문 형식을 해석하지 못했습니다. 한글에서 PDF로 저장해 올려 주십시오.');
      walk(doc.documentElement);
    }
    var out = pages.map(trimBlank).filter(function (p) { return p.trim(); });
    if (!out.length) throw ierr('empty', 'HWPX에서 글자를 찾지 못했습니다. 한글에서 PDF로 저장해 올려 주십시오.');
    var notes = ['HWPX는 최선 노력으로 읽었습니다. 표·글상자 안 글자는 순서가 바뀔 수 있습니다.'];
    notes.push(out.length > 1 ? '문서의 쪽 나누기 표시로 ' + out.length + '쪽으로 나눴습니다.' : '쪽 나누기 표시가 없어 한 쪽으로 두었습니다.');
    var sw = I.stripWatermark(out.join('\f'));
    return { pages: sw.text.split('\f').map(function (t, k) { return { n: k + 1, text: trimBlank(t), status: 'text' }; }), header: sw.header, notes: notes };
  }
  async function readImage(blob) {
    var image = blob, notes = ['이미지는 분석 단계에서 글자 인식(OCR)을 거칩니다.'];
    var bmp = null;
    try { bmp = await createImageBitmap(blob); }
    catch (e) { throw ierr('image', '이미지를 열지 못했습니다(지원하지 않는 그림 형식일 수 있습니다). PNG나 JPG로 저장해 올려 주십시오.'); }
    var long = Math.max(bmp.width, bmp.height);
    if (long > IMG_LONG || !/^image\/(jpeg|png)$/.test(blob.type || '')) {
      var s = Math.min(1, IMG_LONG / long);
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
      var ctx = c.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      image = await new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.85); });
      if (!image) throw ierr('image', '이미지를 줄이지 못했습니다.');
    }
    if (bmp.close) bmp.close();
    return { pages: [{ n: 1, text: '', status: 'needsOcr', image: image }], header: null, notes: notes };
  }
  function unsupportedMsg(ext) {
    if (ext === 'hwp') return '한글(.hwp) 파일은 읽을 수 없습니다. 한글에서 PDF나 DOCX로 저장해 올려 주십시오.';
    if (ext === 'doc') return '예전 워드(.doc) 형식은 읽을 수 없습니다. 워드에서 DOCX나 PDF로 저장해 올려 주십시오.';
    return '지원하지 않는 형식입니다' + (ext ? '(.' + ext + ')' : '') + '. PDF, DOCX, HWPX, TXT·MD, 이미지(PNG·JPG) 파일을 올려 주십시오.';
  }
  I.unsupportedMsg = unsupportedMsg;
  function driveKindOf(d) {
    var mt = d.mimeType || '', ext = d.ext || '';
    if (mt === FOLDER_MIME) return 'folder';
    if (mt === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (/^image\//.test(mt) || EXT_KIND[ext] === 'image') return 'image';
    if (ext === 'hwp' || /x-hwp|haansofthwp|vnd\.hancom\.hwp$/.test(mt)) return 'hwp';
    if (ext === 'doc' || mt === 'application/msword') return 'doc';
    return 'text';
  }

  /* 드라이브 오류 코드별 안내 (mcp.d.ts McpErrorCode) */
  var PAGE_LEVEL = { not_granted: 1, capability_disabled: 1, capability_removed: 1 };
  function driveMsg(e, ctx) {
    var code = (e && e.code) || 'upstream_error', S = DRIVE_SERVER;
    var alt = ' 그동안은 파일·폴더 올리기를 이용해 주십시오.';
    switch (code) {
      case 'needs_reauth': return S + ' 연결이 만료되었습니다. claude.ai 설정 → 커넥터에서 ' + S + '를 다시 연결해 주십시오.' + alt;
      case 'server_not_connected': return S + ' 커넥터가 연결되어 있지 않습니다. claude.ai 설정 → 커넥터에서 ' + S + '를 추가해 주십시오.' + alt;
      case 'selection_required': return S + ' 커넥터가 둘 이상 연결되어 있어 하나를 골라야 합니다. 화면에 뜨는 선택 안내에서 하나를 고른 뒤 다시 시도해 주십시오.';
      case 'server_not_found': return '연결해 둔 ' + S + ' 커넥터를 찾을 수 없습니다. claude.ai 설정 → 커넥터를 확인해 주십시오.' + alt;
      case 'server_unavailable': return S + '가 잠시 응답하지 않습니다. 잠시 뒤 다시 시도해 주십시오.';
      case 'not_in_manifest': return '이 화면에서 ' + S + ' 사용이 허락되지 않았습니다(허락을 거절했거나 이 페이지에서 꺼 두셨습니다).' + alt;
      case 'blocked_by_policy': return '조직 정책으로 ' + S + ' 기능이 막혀 있습니다. 관리자에게 문의해 주십시오.' + alt;
      case 'approval_required': return '조직 정책상 호출마다 승인이 필요한 기능이라 이 화면에서는 쓸 수 없습니다.' + alt;
      case 'tool_error': return toolErrMsg(e, ctx);
      case 'bad_request': case 'transform_error': return '요청 형식이 맞지 않아 실행되지 않았습니다(프로그램 문제): ' + short(e && e.message) + alt;
      case 'cancelled': case 'aborted': return '중지했습니다.';
      case 'rate_limited': return '호출이 너무 잦습니다. 잠시 뒤 다시 시도해 주십시오.';
      case 'not_granted': case 'capability_disabled': case 'capability_removed': return '이 화면에는 구글 드라이브 연결 권한이 없습니다.' + alt;
      case 'consent_required': return S + ' 사용 허락이 필요합니다. 다시 시도하시면 허락을 묻습니다.';
      case 'user_changed': return '로그인한 계정이 바뀌었습니다. 화면을 새로 고쳐 주십시오.';
      default: return S + ' 연결 중 오류가 났습니다: ' + short(e && e.message) + alt;
    }
  }
  function toolErrMsg(e, ctx) {
    var m = String((e && e.message) || '');
    var big = /(too\s*large|exceed|limit|maximum|max\b|size|truncat|token|한도|초과|용량|크기)/i.test(m);
    if (ctx === 'download') return big ? '파일이 커서 드라이브 연결로 원본을 받을 수 없습니다(결과 크기 한도). 이 파일은 파일 올리기 경로로 대신 올려 주십시오.' : '드라이브가 원본 파일을 돌려주지 못했습니다(' + short(m, 100) + '). 이 파일은 파일 올리기 경로로 대신 올려 주십시오.';
    if (ctx === 'read') return big ? '본문이 커서 드라이브 연결로 읽을 수 없습니다. 이 파일은 파일 올리기 경로로 대신 올려 주십시오.' : '드라이브가 본문을 읽지 못했습니다(' + short(m, 100) + '). 이 파일은 파일 올리기 경로로 대신 올려 주십시오.';
    return '드라이브가 오류를 알려 왔습니다: ' + short(m, 120) + ' 링크가 맞는지, 이 계정으로 열 수 있는 폴더·파일인지 확인해 주십시오.';
  }
  I.driveMsg = driveMsg;
  var MCP_CODES = { needs_reauth: 1, server_not_connected: 1, selection_required: 1, server_not_found: 1, server_unavailable: 1, not_in_manifest: 1, blocked_by_policy: 1, approval_required: 1, tool_error: 1, bad_request: 1, cancelled: 1, rate_limited: 1, upstream_error: 1, not_granted: 1, capability_disabled: 1, capability_removed: 1, transform_error: 1, consent_required: 1, user_changed: 1 };
  function errText(e, ctx) {
    if (!e) return '알 수 없는 오류입니다.';
    if (e.ingest) return e.message;
    if (e.code && MCP_CODES[e.code]) return driveMsg(e, ctx);
    return '읽지 못했습니다: ' + short(e.message || String(e));
  }

  /* ====================================================================
     화면
     ==================================================================== */
  I.mount = function (el, opts) {
    opts = opts || {};
    if (!el) throw new Error('SY.Ingest.mount: el 이 없습니다.');
    var P = SY.uid ? SY.uid('ing') : 'ing_' + Date.now().toString(36);
    var items = [], byKey = {}, queue = [], running = null, destroyed = false;
    var view = { filter: 'all', q: '', page: 0 };
    var drive = { mcp: undefined, probed: false, off: false, schemas: {}, schemaTried: false, ac: null, listing: false };
    var keepAvailable = false;

    /* 규칙: opts.rules > localStorage > 기본값 */
    (function initRules() {
      var r = null;
      if (opts.rules && typeof opts.rules === 'object') r = opts.rules;
      else { try { var s = root.localStorage && root.localStorage.getItem(LS_KEY); if (s) r = JSON.parse(s); } catch (e) { r = null; } }
      currentRules = I.normalizeRules(r || DEFAULT_RULES);
    })();

    function safeCase() { try { return (opts.getCase && opts.getCase()) || {}; } catch (e) { return {}; } }

    el.innerHTML = template();
    el.classList.add('sy-ing-host');
    var $ = function (sel) { return el.querySelector(sel); };
    var $$ = function (sel) { return Array.prototype.slice.call(el.querySelectorAll(sel)); };
    var tbody = $('[data-el="tbody"]');
    var liveText = $('[data-el="progress"]'), announcer = $('[data-el="announce"]');

    function template() {
      var tabs = [['paste', '텍스트 붙여넣기'], ['file', '파일'], ['folder', '폴더'], ['drive', '구글 드라이브']];
      var kinds = KIND_SUGGEST.map(function (k) { return '<option value="' + esc(k) + '"></option>'; }).join('');
      return '' +
        '<section class="sy-ing" aria-labelledby="' + P + '-h">' +
        '<datalist id="' + P + '-kinds">' + kinds + '</datalist>' +
        '<header class="sy-ing-head"><h2 class="sy-ing-title" id="' + P + '-h">자료 올리기</h2>' +
        '<p class="sy-ing-sub">원본 서면을 편한 방법으로 올리면 아래 자료함에 모입니다. 자료함에서 분류·측·제출일을 확인한 뒤 “분석에 추가”를 눌러 주십시오.</p></header>' +
        '<div class="sy-ing-tabs" role="tablist" aria-label="올리는 방법">' +
        tabs.map(function (t) {
          var on = t[0] === 'file';
          return '<button type="button" role="tab" class="sy-ing-tab" id="' + P + '-tab-' + t[0] + '" data-tab="' + t[0] + '" aria-controls="' + P + '-panel-' + t[0] + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">' + t[1] + '</button>';
        }).join('') + '</div>' +
        panelPaste() + panelFile() + panelFolder() + panelDrive() +
        '<div class="sy-ing-opts">' +
        '<label class="sy-ing-check"><input type="checkbox" data-opt="mask" checked> 주민등록번호 형태 가리기</label>' +
        '<label class="sy-ing-check" data-el="keepwrap" hidden><input type="checkbox" data-opt="keep"> 원본 보관 <span class="sy-ing-muted">(원본 파일을 사건 자료로 함께 저장)</span></label>' +
        '</div>' +
        rulesBox() +
        '<div class="sy-ing-progress" data-el="progressbar" hidden><span data-el="progress"></span> <button type="button" class="sy-ing-btn sm" data-act="stop-read">읽기 중지</button></div>' +
        '<div class="sy-ing-sr" aria-live="polite" data-el="announce"></div>' +
        '<section class="sy-ing-box" aria-labelledby="' + P + '-boxh">' +
        '<div class="sy-ing-boxhead"><h3 id="' + P + '-boxh" class="sy-ing-h3">자료함</h3><span class="sy-ing-muted" data-el="boxcount"></span></div>' +
        '<div class="sy-ing-toolbar">' +
        '<div class="sy-ing-filters" role="group" aria-label="분류로 걸러 보기" data-el="filters"></div>' +
        '<label class="sy-ing-search"><span class="sy-ing-sr">자료함 검색</span><input type="search" data-el="q" placeholder="파일명·종류·제출자 검색"></label>' +
        '</div>' +
        '<div class="sy-ing-empty" data-el="empty">아직 올린 자료가 없습니다. 위에서 텍스트를 붙여넣거나 파일·폴더·구글 드라이브에서 서면을 가져오면 이곳에 파일별 분류와 상태가 나타납니다.</div>' +
        '<div class="sy-ing-tablewrap" data-el="tablewrap" hidden><table class="sy-ing-table"><thead><tr>' +
        '<th scope="col" class="c-check"><input type="checkbox" data-el="selall" aria-label="보이는 항목 모두 선택"></th>' +
        '<th scope="col">파일</th><th scope="col">분류</th><th scope="col">서면 종류</th><th scope="col">측</th><th scope="col">제출자</th><th scope="col">제출일</th><th scope="col" class="c-pages">쪽수</th><th scope="col">상태</th><th scope="col"><span class="sy-ing-sr">작업</span></th>' +
        '</tr></thead><tbody data-el="tbody"></tbody></table></div>' +
        '<nav class="sy-ing-pager" data-el="pager" aria-label="자료함 쪽 넘기기" hidden></nav>' +
        '</section>' +
        '<footer class="sy-ing-foot"><div class="sy-ing-foot-msg" data-el="footmsg" role="status"></div>' +
        '<button type="button" class="sy-ing-btn primary" data-act="add" disabled>분석에 추가</button></footer>' +
        '</section>';
    }
    function panelWrap(id, inner) {
      var on = id === 'file';
      return '<div class="sy-ing-panel" role="tabpanel" id="' + P + '-panel-' + id + '" aria-labelledby="' + P + '-tab-' + id + '"' + (on ? '' : ' hidden') + '>' + inner + '</div>';
    }
    function panelPaste() {
      return panelWrap('paste',
        '<div class="sy-ing-grid">' +
        '<label class="sy-ing-field"><span>서면 종류</span><input data-p="kind" list="' + P + '-kinds" placeholder="예: 준비서면"></label>' +
        '<label class="sy-ing-field"><span>측</span><select data-p="side"><option value="미정">미정</option><option value="원고">원고</option><option value="피고">피고</option></select></label>' +
        '<label class="sy-ing-field"><span>제출자</span><input data-p="submitter" placeholder="예: 원고 소송대리인"></label>' +
        '<label class="sy-ing-field"><span>제출일</span><input type="date" data-p="filedDate"></label>' +
        '<label class="sy-ing-field"><span>쪽 구분</span><select data-p="split"><option value="auto">자동 인식</option>' +
        ['formfeed', 'marker', 'pageno', 'blank', 'none'].map(function (k) { return '<option value="' + k + '">' + esc(SPLIT_LABEL[k]) + '</option>'; }).join('') +
        '</select></label></div>' +
        '<label class="sy-ing-field wide"><span>서면 전문</span><textarea data-p="text" rows="9" placeholder="서면 전문을 붙여넣어 주십시오. 쪽 구분은 폼피드 문자, 빈 줄 3개, ‘- 3 -’ 같은 쪽번호 줄, ‘=== p.3 ===’ 표시를 알아봅니다."></textarea></label>' +
        '<div class="sy-ing-pv" data-el="pastepv" aria-live="polite"></div>' +
        '<div class="sy-ing-row-btns"><button type="button" class="sy-ing-btn" data-act="paste-add">자료함에 넣기</button><span class="sy-ing-msg" data-el="pastemsg" role="status"></span></div>');
    }
    function panelFile() {
      return panelWrap('file',
        '<div class="sy-ing-drop" data-drop="file"><p class="sy-ing-drop-t">여기에 파일을 끌어다 놓으십시오</p>' +
        '<p class="sy-ing-muted">PDF, DOCX, HWPX, TXT·MD, 이미지(PNG·JPG). 여러 개를 한꺼번에 올릴 수 있습니다. 한글(.hwp)은 PDF나 DOCX로 저장해 올려 주십시오.</p>' +
        '<button type="button" class="sy-ing-btn" data-act="pick-file">파일 고르기</button>' +
        '<input type="file" multiple class="sy-ing-hidden-input" data-el="fileinput" tabindex="-1" aria-hidden="true"></div>');
    }
    function panelFolder() {
      return panelWrap('folder',
        '<div class="sy-ing-drop" data-drop="folder"><p class="sy-ing-drop-t">여기에 폴더를 끌어다 놓으십시오</p>' +
        '<p class="sy-ing-muted">하위 폴더까지 모두 읽고, 전자소송 파일명(사건번호_(yy.mm.dd)서면종류_번호.제목_제출자.pdf)으로 서면·기록·제외를 나눕니다. 서면만 먼저 선택되며 내용은 선택한 파일만 읽습니다.</p>' +
        '<button type="button" class="sy-ing-btn" data-act="pick-folder">폴더 고르기</button>' +
        '<input type="file" webkitdirectory directory multiple class="sy-ing-hidden-input" data-el="folderinput" tabindex="-1" aria-hidden="true"></div>' +
        '<p class="sy-ing-msg" data-el="foldermsg" role="status"></p>');
    }
    function panelDrive() {
      return panelWrap('drive',
        '<div data-el="driveon">' +
        '<p class="sy-ing-muted">연결된 Google Drive 커넥터로 폴더나 파일을 가져옵니다. 처음 쓰실 때 허락을 묻는 창이 뜰 수 있습니다.</p>' +
        '<label class="sy-ing-field wide"><span>폴더 또는 파일 링크(또는 ID)</span><input type="text" data-el="driveref" placeholder="https://drive.google.com/drive/folders/..." autocomplete="off" spellcheck="false"></label>' +
        '<div class="sy-ing-checks"><label class="sy-ing-check"><input type="checkbox" data-el="driverec"> 하위 폴더 포함</label>' +
        '<label class="sy-ing-check"><input type="checkbox" data-el="drivepdf"> PDF는 원본을 내려받아 쪽별로 읽기 <span class="sy-ing-muted">(쪽 번호가 정확해지지만 느리고, 큰 파일은 실패할 수 있습니다)</span></label></div>' +
        '<div class="sy-ing-row-btns"><button type="button" class="sy-ing-btn" data-act="drive-list">목록 가져오기</button>' +
        '<button type="button" class="sy-ing-btn" data-act="drive-stop" hidden>중지</button></div>' +
        '<p class="sy-ing-msg" data-el="drivemsg" role="status"></p></div>' +
        '<div class="sy-ing-off" data-el="driveoff" hidden></div>');
    }
    function rulesBox() {
      return '<details class="sy-ing-rules" data-el="rules"><summary>분류 규칙 고치기 <span class="sy-ing-muted">(폴더·드라이브 파일명)</span></summary>' +
        '<p class="sy-ing-muted">파일명의 서면 종류(없으면 제목)에 아래 낱말이 들어 있으면 그 분류로 나눕니다. 여러 규칙에 걸리면 더 긴 낱말을 따릅니다. 쉼표나 줄바꿈으로 구분합니다. 서증·첨부 표시가 있는 파일은 항상 제외입니다.</p>' +
        '<div class="sy-ing-rulegrid">' +
        '<label class="sy-ing-field"><span>서면(분석 대상, 기본 선택)</span><textarea rows="3" data-rule="include"></textarea></label>' +
        '<label class="sy-ing-field"><span>기록(목록에 두되 기본 선택 해제)</span><textarea rows="3" data-rule="record"></textarea></label>' +
        '<label class="sy-ing-field"><span>제외</span><textarea rows="3" data-rule="exclude"></textarea></label>' +
        '<label class="sy-ing-field"><span>우리 측 대리인 이름(측 추정용)</span><textarea rows="3" data-rule="ourCounsel" placeholder="예: 법무법인 ○○"></textarea></label>' +
        '</div><div class="sy-ing-row-btns"><button type="button" class="sy-ing-btn" data-act="rules-apply">규칙 적용</button>' +
        '<button type="button" class="sy-ing-btn" data-act="rules-reset">기본값으로</button><span class="sy-ing-msg" data-el="rulesmsg" role="status"></span></div></details>';
    }

    /* ---------- 탭 ---------- */
    function selectTab(id, focus) {
      $$('[role="tab"]').forEach(function (b) {
        var on = b.getAttribute('data-tab') === id;
        b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      $$('[role="tabpanel"]').forEach(function (p) { p.hidden = p.id !== P + '-panel-' + id; });
      if (id === 'drive') probeDrive();
    }
    $('[role="tablist"]').addEventListener('click', function (e) {
      var b = e.target.closest('[role="tab"]'); if (b) selectTab(b.getAttribute('data-tab'));
    });
    $('[role="tablist"]').addEventListener('keydown', function (e) {
      var tabs = $$('[role="tab"]'), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      var j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
      if (j < 0) return;
      e.preventDefault(); selectTab(tabs[j].getAttribute('data-tab'), true);
    });

    /* ---------- 원본 보관(assets): 첫 사용자 조작 뒤에 확인 ---------- */
    function armAssets() {
      var fired = false;
      function go() {
        if (fired) return; fired = true;
        el.removeEventListener('pointerdown', go, true); el.removeEventListener('keydown', go, true);
        checkAssets();
      }
      el.addEventListener('pointerdown', go, true); el.addEventListener('keydown', go, true);
    }
    async function checkAssets() {
      var ok = false;
      if (typeof opts.canKeepOriginals === 'boolean') ok = opts.canKeepOriginals;
      else {
        var c = root.claude;
        if (c && typeof c.use === 'function') { try { ok = !!(await c.use('assets')); } catch (e) { ok = false; } }
      }
      keepAvailable = ok;
      $('[data-el="keepwrap"]').hidden = !ok;
    }
    armAssets();
    function maskOn() { var c = $('[data-opt="mask"]'); return !c || c.checked; }
    function keepOn() { var c = $('[data-opt="keep"]'); return keepAvailable && !!(c && c.checked); }
    function shown(t) { return maskOn() ? SY.maskSensitive(t) : t; }

    /* ---------- 항목 ---------- */
    function announce(msg) { announcer.textContent = ''; setTimeout(function () { announcer.textContent = msg; }, 30); }
    function selectable(it) { return !it.added && it.read !== 'error' && it.read !== 'unsupported'; }
    function newItem(o) {
      var it = {
        key: (SY.uid ? SY.uid('it') : 'it_' + Math.random().toString(36).slice(2)), source: o.source, name: o.name, path: o.path || '', size: o.size == null ? null : o.size,
        file: o.file || null, drive: o.drive || null, ext: o.ext || extOf(o.name), cls: o.cls,
        role: o.cls.role, kind: o.cls.kind || '', side: '미정', sideWhy: '', submitter: o.cls.submitter || '', filedDate: o.cls.date || '',
        checked: o.cls.role === 'brief', read: 'idle', progress: '', status: null, pages: null, rawBlob: null,
        error: null, notes: [], added: false, docId: null, open: false, invalid: {}, edited: {}, urls: []
      };
      return it;
    }
    function existingDup(it) {
      var k = I.dedupeKey(it);
      for (var i = 0; i < items.length; i++) {
        var o = items[i];
        if (I.dedupeKey(o) === k) return true;
        if (it.drive && o.drive && it.drive.id === o.drive.id) return true;
      }
      return false;
    }
    function inCase(it) {
      var C = safeCase();
      return (C.docs || []).some(function (d) { return d.fileName && compact(d.fileName) === compact(it.name) && (d.filedDate || '') === (it.filedDate || ''); });
    }
    function pushItem(it) {
      if (existingDup(it)) return false;
      if (inCase(it)) { it.checked = false; it.notes.push('이미 사건에 들어 있는 서면과 파일명·제출일이 같습니다.'); }
      items.push(it); byKey[it.key] = it;
      return true;
    }
    function isJunk(name) { return /^\./.test(name) || /^(thumbs\.db|desktop\.ini)$/i.test(name) || /^~\$/.test(name); }

    function addFileEntries(list, source) {
      var added = 0, dup = 0, junk = 0, counts = { brief: 0, record: 0, skip: 0, unknown: 0 };
      list.forEach(function (x) {
        var f = x.file, name = f.name;
        if (isJunk(name)) { junk++; return; }
        var ext = extOf(name), cls = I.classifyName(name);
        var it = newItem({ source: source, name: name, path: x.path || '', size: f.size, file: f, ext: ext, cls: cls });
        var kind = EXT_KIND[ext];
        if (!kind || kind === 'hwp' || kind === 'doc') { it.read = 'unsupported'; it.error = unsupportedMsg(ext); it.checked = false; }
        if (!pushItem(it)) { dup++; return; }
        added++; counts[it.role]++;
      });
      afterAdd();
      var msg = (source === 'folder' ? '폴더에서 ' : '') + added + '개 파일을 자료함에 넣었습니다' +
        (source === 'folder' ? ' (서면 ' + counts.brief + ', 기록 ' + counts.record + ', 제외 ' + counts.skip + ', 미정 ' + counts.unknown + ')' : '') + '.' +
        (dup ? ' 이미 있는 파일 ' + dup + '개는 건너뛰었습니다.' : '') + (junk ? ' 시스템 파일 ' + junk + '개는 무시했습니다.' : '');
      announce(msg);
      return { added: added, dup: dup, junk: junk, counts: counts, message: msg };
    }
    function afterAdd() {
      recomputeSides();
      items.forEach(function (it) { if (it.checked && it.read === 'idle') enqueue(it); });
      renderBox();
    }

    /* ---------- 측 추정 ---------- */
    function recomputeSides() {
      var C = safeCase(), entries = [];
      items.forEach(function (it) { if (it.edited.side && SIDES.indexOf(it.side) >= 0) entries.push({ submitter: it.submitter, side: it.side, from: '직접 정한 측' }); });
      (C.docs || []).forEach(function (d) { entries.push({ submitter: d.submitter, side: d.side, from: '기존 ' + (d.kind || '서면') }); });
      items.forEach(function (it) {
        var ks = KIND_SIDE[compact(it.kind)];
        if (ks && it.submitter && it.role !== 'skip') entries.push({ submitter: it.submitter, side: ks, from: it.kind + '(' + ks + ')' });
      });
      var learned = I.learnSides(entries);
      items.forEach(function (it) {
        if (it.edited.side) return;
        var g = I.guessSide({ kind: it.kind, submitter: it.submitter }, C, learned, currentRules);
        it.side = g.side; it.sideWhy = g.why;
      });
    }

    /* ---------- 읽기 대기열 ---------- */
    function enqueue(it) {
      if (!it || it.read === 'reading' || it.read === 'queued' || it.read === 'unsupported' || it.added) return;
      if (it.read === 'done' && !it.forcePages) return;
      it.read = 'queued'; it.error = null;
      queue.push(it);
      pump();
    }
    async function pump() {
      if (running || destroyed) { updateProgress(); return; }
      var it = queue.shift();
      if (!it) { updateProgress(); updateFoot(); return; }
      if (!byKey[it.key] || (!it.checked && !it.forcePages)) { it.read = it.pages ? 'done' : 'idle'; patchRow(it); return pump(); }
      var ac = new AbortController();
      running = { item: it, ac: ac };
      var stash = it.forcePages && it.pages ? { pages: it.pages, status: it.status, notes: it.notes.slice() } : null;
      it.read = 'reading'; it.progress = '';
      patchRow(it); updateProgress(); updateFoot();
      try {
        var r = await readItem(it, ac.signal, function (msg) { it.progress = msg; patchStatus(it); updateProgress(); });
        if (!byKey[it.key]) throw ierr('aborted', '삭제됨');
        applyResult(it, r);
        it.read = 'done';
        announce(it.name + ' 읽기 완료: ' + it.pages.length + '쪽');
      } catch (e) {
        if (stash) {
          it.pages = stash.pages; it.status = stash.status; it.notes = stash.notes; it.read = 'done';
          if (!isAbort(e, ac.signal)) it.notes.push('쪽 나누기 실패: ' + errText(e, 'download'));
        } else if (isAbort(e, ac.signal)) {
          it.read = 'idle'; it.checked = false; it.notes = ['읽기를 중지했습니다. 다시 선택하면 처음부터 읽습니다.'];
        } else {
          it.read = 'error'; it.checked = false; it.error = errText(e, e && e.ctx);
          announce(it.name + ' 읽기 실패');
        }
      }
      it.forcePages = false; it.progress = '';
      running = null;
      if (byKey[it.key]) { recomputeSides(); patchAllVisible(); }
      updateCounts();
      pump();
    }
    function stopReading() {
      queue.forEach(function (it) { it.read = it.pages ? 'done' : 'idle'; it.checked = it.pages ? it.checked : false; it.forcePages = false; });
      queue = [];
      if (running) running.ac.abort();
      patchAllVisible(); updateProgress(); updateFoot();
    }
    function applyResult(it, r) {
      it.pages = r.pages;
      var nScan = r.pages.filter(function (p) { return p.status === 'needsOcr'; }).length;
      it.status = nScan === 0 ? 'text' : nScan === r.pages.length ? 'scan' : 'mixed';
      it.notes = (r.notes || []).slice();
      if (nScan) it.notes.push((nScan === r.pages.length ? '스캔본입니다. ' : '그림으로 된 쪽이 있습니다. ') + nScan + '쪽은 분석 단계에서 글자 인식(OCR)을 거칩니다.');
      if (r.rawBlob) it.rawBlob = r.rawBlob;
      if (r.header) {
        var filled = [];
        if (r.header.submitter && !it.submitter && !it.edited.submitter) { it.submitter = r.header.submitter; filled.push('제출자'); }
        if (r.header.filedDate && !it.filedDate && !it.edited.filedDate) { it.filedDate = r.header.filedDate; filled.push('제출일'); }
        if (filled.length) it.notes.push(filled.join('·') + '를 전자소송 머리글에서 읽었습니다.');
      }
    }
    async function readItem(it, signal, progress) {
      if (it.source === 'drive') return readDriveItem(it, signal, progress);
      var kind = EXT_KIND[it.ext];
      if (kind === 'pdf') return readPdf(it.file, { signal: signal, onProgress: progress });
      if (kind === 'docx') { progress('DOCX'); return readDocx(it.file); }
      if (kind === 'hwpx') { progress('HWPX'); return readHwpx(it.file); }
      if (kind === 'text') return readTextFile(it.file);
      if (kind === 'image') { progress('이미지'); return readImage(it.file); }
      throw ierr('unsupported', unsupportedMsg(it.ext));
    }

    /* ---------- 구글 드라이브 ---------- */
    async function getMcp() {
      if (drive.mcp !== undefined) return drive.mcp;
      var c = root.claude;
      if (!c || typeof c.use !== 'function') { drive.mcp = null; return null; }
      try { drive.mcp = await c.use('mcp'); } catch (e) { drive.mcp = null; }
      return drive.mcp;
    }
    function driveMsgEl(msg, tone) { var m = $('[data-el="drivemsg"]'); m.textContent = msg || ''; m.setAttribute('data-tone', tone || ''); }
    function setDriveOff(msg) {
      drive.off = true;
      $('[data-el="driveon"]').hidden = true;
      var off = $('[data-el="driveoff"]');
      off.hidden = false;
      off.innerHTML = '<p class="sy-ing-off-t">구글 드라이브 경로를 쓸 수 없습니다</p><p>' + esc(msg) + '</p>' +
        '<p><button type="button" class="sy-ing-btn" data-act="goto-file">파일 올리기로 가기</button> <button type="button" class="sy-ing-btn" data-act="goto-folder">폴더 올리기로 가기</button></p>';
    }
    async function probeDrive() {
      if (drive.probed) return;
      drive.probed = true;
      var m = await getMcp();
      if (!m) { setDriveOff('이 화면에서는 커넥터 연결 기능(mcp)을 쓸 수 없습니다. 사건 연표를 claude.ai 안에서 열었는지, 이 페이지에 커넥터 사용이 허락되었는지 확인해 주십시오. 그동안은 파일이나 폴더 올리기를 이용해 주십시오.'); return; }
      try {
        var lt = await m.listTools(DRIVE_SERVER);
        var s = ((lt && lt.servers) || []).filter(function (x) { return x.server === DRIVE_SERVER; })[0];
        if (!s) driveMsgEl(driveMsg({ code: 'server_not_connected' }), 'warn');
        else if (s.authStatus === 'needs_reauth') driveMsgEl(driveMsg({ code: 'needs_reauth' }), 'warn');
      } catch (e) {
        if (e && PAGE_LEVEL[e.code]) setDriveOff(driveMsg(e));
        else driveMsgEl(driveMsg(e, 'probe'), 'warn');
      }
    }
    function payloadOf(res) {
      if (!res || typeof res !== 'object') return res;
      if (res.payload !== undefined) return asObject(res.payload);
      var c = res.content && res.content[0];
      if (c && c.type === 'text') return asObject(c.text);
      return res;
    }
    async function driveCall(tool, input, signal, nocache) {
      var m = await getMcp();
      if (!m) throw { code: 'not_granted', message: 'mcp 없음' };
      var callOpts = { signal: signal };
      if (nocache) callOpts.cache = false;
      async function once() { return payloadOf(await m.callTool(DRIVE_SERVER, tool, input, callOpts)); }
      try { return await once(); }
      catch (e) {
        if (e && e.retryable && !(signal && signal.aborted)) {
          await sleep(Math.min(60000, e.retryAfterMs || (400 + Math.random() * 900)));
          return once();
        }
        throw e;
      }
    }
    async function loadSchemas() {
      if (drive.schemaTried) return;
      drive.schemaTried = true;
      var m = await getMcp();
      if (!m || typeof m.describeTool !== 'function') return;
      var got = 0;
      await Promise.all(['search_files', 'get_file_metadata', 'read_file_content', 'download_file_content'].map(function (t) {
        return m.describeTool(DRIVE_SERVER, t).then(function (d) {
          var props = d && d.inputSchema && d.inputSchema.properties;
          if (props && typeof props === 'object') { drive.schemas[t] = Object.keys(props); got++; }
        }, function () { /* 스키마 없음: 관측한 형태로 진행 */ });
      }));
      if (!got) drive.schemaTried = false; // 허락 전이면 다음 목록 때 다시 시도
    }
    function argName(tool, cands) {
      var p = drive.schemas[tool];
      if (!p) return cands[0];
      for (var i = 0; i < cands.length; i++) if (p.indexOf(cands[i]) >= 0) return cands[i];
      return cands[0];
    }
    function fileArgs(tool, id) { var o = {}; o[argName(tool, ['fileId', 'file_id', 'id'])] = id; return o; }
    function searchInput(folderId, token) {
      var p = drive.schemas.search_files, o = {};
      o[argName('search_files', ['query', 'q'])] = "parentId = '" + folderId + "'";
      var ps = argName('search_files', ['pageSize', 'page_size', 'limit']);
      if (!p || p.indexOf(ps) >= 0) o[ps] = 100;
      if (!p || p.indexOf('excludeContentSnippets') >= 0) o.excludeContentSnippets = true;
      if (token) o[argName('search_files', ['pageToken', 'page_token', 'cursor'])] = token;
      return o;
    }
    function setListing(on) {
      drive.listing = on;
      $('[data-act="drive-list"]').disabled = on;
      $('[data-act="drive-stop"]').hidden = !on;
    }
    async function driveList() {
      if (drive.listing) return;
      var ref = I.parseDriveRef($('[data-el="driveref"]').value);
      if (!ref) { driveMsgEl('링크나 ID를 알아보지 못했습니다. 드라이브에서 “링크 복사”로 받은 주소(…/drive/folders/… 또는 …/file/d/…)를 붙여넣어 주십시오.', 'error'); return; }
      var m = await getMcp();
      if (!m) { setDriveOff('이 화면에서는 커넥터 연결 기능(mcp)을 쓸 수 없습니다. 파일이나 폴더 올리기를 이용해 주십시오.'); return; }
      drive.ac = new AbortController();
      var signal = drive.ac.signal;
      setListing(true);
      driveMsgEl('Google Drive에 연결하는 중입니다…', '');
      try {
        await loadSchemas();
        var type = ref.type, meta = null;
        if (type !== 'folder') {
          driveMsgEl('파일 정보를 확인하는 중입니다…', '');
          meta = normDriveFile(await driveCall('get_file_metadata', fileArgs('get_file_metadata', ref.id), signal));
          if (!meta.id) meta.id = ref.id;
          type = meta.mimeType === FOLDER_MIME ? 'folder' : 'file';
          await loadSchemas();
        }
        if (type === 'folder') {
          var rec = $('[data-el="driverec"]').checked;
          var res = await I.listDriveFolder(function (tool, inp) { return driveCall(tool, inp, signal); }, ref.id, {
            recursive: rec, signal: signal, buildInput: searchInput, maxCalls: MAX_LIST_CALLS,
            onProgress: function (p) { driveMsgEl('목록을 가져오는 중입니다: 파일 ' + p.files + '건' + (p.folders ? ', 하위 폴더 ' + p.folders + '개' : '') + ' (' + p.calls + '회 호출)', ''); }
          });
          var r = addDriveFiles(res.files);
          var tail = res.stopped === 'cancelled' ? ' 중지하여 여기까지만 가져왔습니다.' : res.stopped === 'limit' ? ' 호출 한도(' + MAX_LIST_CALLS + '회)에 닿아 여기까지만 가져왔습니다.' : '';
          var sub = res.skippedFolders ? ' 하위 폴더 ' + res.skippedFolders + '개는 건너뛰었습니다(“하위 폴더 포함”을 켜면 함께 가져옵니다).' : '';
          driveMsgEl('파일 ' + res.files.length + '건을 찾았습니다(' + res.calls + '회 호출). ' + r.message + sub + tail, res.stopped ? 'warn' : 'ok');
        } else {
          var r2 = addDriveFiles([meta]);
          driveMsgEl(r2.message, 'ok');
        }
      } catch (e) {
        if (isAbort(e, signal)) driveMsgEl('중지했습니다.', 'warn');
        else if (e && PAGE_LEVEL[e.code]) setDriveOff(driveMsg(e));
        else driveMsgEl(errText(e, 'list'), 'error');
      } finally { setListing(false); }
    }
    function addDriveFiles(list) {
      var added = 0, dup = 0, counts = { brief: 0, record: 0, skip: 0, unknown: 0 };
      list.forEach(function (d) {
        var dk = driveKindOf(d);
        if (dk === 'folder') return;
        var name = d.title || d.id;
        var cls = I.classifyName(name);
        var it = newItem({ source: 'drive', name: name, path: d.path || '', size: d.size, drive: { id: d.id, mimeType: d.mimeType, ext: d.ext, viewUrl: d.viewUrl, kind: dk }, ext: d.ext || extOf(name), cls: cls });
        if (dk === 'hwp' || dk === 'doc') { it.read = 'unsupported'; it.error = unsupportedMsg(dk); it.checked = false; }
        if (!pushItem(it)) { dup++; return; }
        added++; counts[it.role]++;
      });
      afterAdd();
      var msg = added + '건을 자료함에 넣었습니다(서면 ' + counts.brief + ', 기록 ' + counts.record + ', 제외 ' + counts.skip + ', 미정 ' + counts.unknown + ').' + (dup ? ' 이미 있는 ' + dup + '건은 건너뛰었습니다.' : '');
      announce(msg);
      return { added: added, dup: dup, message: msg };
    }
    async function driveDownload(it, signal) {
      var p;
      try { p = await driveCall('download_file_content', fileArgs('download_file_content', it.drive.id), signal, true); }
      catch (e) { if (e && typeof e === 'object') e.ctx = 'download'; throw e; }
      p = asObject(p);
      var b64 = p && typeof p === 'object' ? (p.content || p.data || p.base64 || (p.file && p.file.content)) : null;
      if (!b64 || typeof b64 !== 'string') throw ierr('drive_download_empty', '드라이브에서 원본 파일 내용을 받지 못했습니다. 이 파일은 파일 올리기 경로로 대신 올려 주십시오.');
      try { return I.b64ToBlob(b64, (p && p.mimeType) || it.drive.mimeType || 'application/pdf'); }
      catch (e2) { throw ierr('drive_download_bad', '받은 원본이 잘렸거나 손상되었습니다(결과 크기 한도일 수 있습니다). 이 파일은 파일 올리기 경로로 대신 올려 주십시오.'); }
    }
    async function readDrivePdfBlob(it, signal, progress) {
      progress('원본 받는 중');
      var blob = await driveDownload(it, signal);
      var r;
      try { r = await readPdf(blob, { signal: signal, onProgress: progress }); }
      catch (e) {
        if (e && e.code === 'pdf_invalid') throw ierr('drive_download_bad', '드라이브에서 받은 PDF를 열 수 없습니다(결과 크기 한도로 잘렸을 수 있습니다). 이 파일은 파일 올리기 경로로 대신 올려 주십시오.');
        throw e;
      }
      r.rawBlob = blob;
      return r;
    }
    async function readDriveItem(it, signal, progress) {
      var dk = it.drive.kind;
      if (dk === 'hwp' || dk === 'doc') throw ierr('unsupported', unsupportedMsg(dk));
      if (dk === 'image') { progress('원본 받는 중'); var ib = await driveDownload(it, signal); var ir = await readImage(ib); ir.rawBlob = ib; return ir; }
      var wantPages = dk === 'pdf' && (it.forcePages || $('[data-el="drivepdf"]').checked);
      if (wantPages) {
        try {
          var rp = await readDrivePdfBlob(it, signal, progress);
          rp.notes.unshift('원본 PDF를 내려받아 쪽별로 읽었습니다.');
          return rp;
        } catch (e) {
          if (isAbort(e, signal) || it.forcePages) { if (e && typeof e === 'object' && !e.ctx) e.ctx = 'download'; throw e; }
          var why = errText(e, 'download');
          progress('본문만 읽는 중');
          var tr = await readDriveText(it, signal, progress, true);
          tr.notes.unshift('원본을 받지 못해 본문만 읽었습니다(' + why + ')');
          return tr;
        }
      }
      return readDriveText(it, signal, progress, false);
    }
    async function readDriveText(it, signal, progress, noScanFallback) {
      progress('본문 읽는 중');
      var p;
      try { p = await driveCall('read_file_content', fileArgs('read_file_content', it.drive.id), signal, true); }
      catch (e) { if (e && typeof e === 'object') e.ctx = 'read'; throw e; }
      var text = typeof p === 'string' ? p : p && typeof p === 'object' ? (p.fileContent != null ? p.fileContent : (p.content || p.text || '')) : '';
      text = String(text || '');
      if (I.isEmptyBody(text)) {
        if (it.drive.kind !== 'pdf' || noScanFallback) throw ierr('drive_empty', '드라이브가 돌려준 본문이 비어 있습니다. 이 파일은 파일 올리기 경로로 올려 주십시오.');
        progress('스캔본으로 보여 원본 받는 중');
        var r = await readDrivePdfBlob(it, signal, progress);
        if (!r.header) r.header = I.stripWatermark(text).header;
        r.notes.unshift('드라이브 본문에 글자가 없어(전자소송 머리글뿐) 스캔본으로 보고 원본 PDF를 받아 쪽 그림을 만들었습니다.');
        return r;
      }
      var res = textResult(text, 'auto-strict', []);
      if (res.pages.length === 1 && it.drive.kind === 'pdf') {
        res.notes = ['드라이브 본문에는 쪽 구분이 없어 한 쪽으로 두었습니다. 쪽 번호가 필요하면 “쪽 나누기”를 눌러 원본을 받아 쪽별로 읽으십시오.'];
        it.canSplit = true;
      }
      return res;
    }

    /* ---------- 텍스트 붙여넣기 ---------- */
    function pasteVals() {
      var g = function (k) { return $('[data-p="' + k + '"]'); };
      return { kind: g('kind').value.trim(), side: g('side').value, submitter: g('submitter').value.trim(), filedDate: g('filedDate').value, split: g('split').value, text: g('text').value };
    }
    var pvTimer = null;
    function pastePreview() {
      var v = pasteVals(), pv = $('[data-el="pastepv"]');
      if (!v.text.trim()) { pv.innerHTML = ''; return; }
      var sp = I.splitPages(I.stripWatermark(v.text).text, v.split);
      var head = '<p class="sy-ing-pv-h">인식된 쪽 수: <strong data-el="pastecount">' + sp.pages.length + '</strong>쪽 · 구분: ' + esc(sp.method === 'none' ? '구분 표시 없음(한 쪽)' : SPLIT_LABEL[sp.method]) + '</p>';
      var list = sp.pages.slice(0, 6).map(function (t, i) { return '<li><span class="pgn">' + (i + 1) + '쪽</span> ' + esc(short(shown(t), 70)) + '</li>'; }).join('');
      pv.innerHTML = head + '<ol class="sy-ing-pv-list">' + list + '</ol>' + (sp.pages.length > 6 ? '<p class="sy-ing-muted">외 ' + (sp.pages.length - 6) + '쪽</p>' : '');
    }
    function pasteAdd() {
      var v = pasteVals(), msg = $('[data-el="pastemsg"]');
      if (!v.text.trim()) { msg.textContent = '서면 전문을 붙여넣어 주십시오.'; msg.setAttribute('data-tone', 'error'); $('[data-p="text"]').focus(); return; }
      var sw = I.stripWatermark(v.text), sp = I.splitPages(sw.text, v.split);
      var kind = v.kind || '';
      var name = '붙여넣기_' + (kind || '서면') + (v.filedDate ? '_' + v.filedDate : '') + '.txt';
      var cls = I.classifyName(kind || '');
      var it = newItem({ source: 'paste', name: name, size: v.text.length, ext: 'txt', cls: { role: cls.role === 'record' ? 'record' : 'brief', kind: kind, submitter: v.submitter || (sw.header && sw.header.submitter) || '', date: v.filedDate || (sw.header && sw.header.filedDate) || '', reason: '직접 붙여넣은 서면' } });
      it.cls.reason = '직접 붙여넣은 서면';
      it.checked = true;
      it.pages = sp.pages.map(function (t, i) { return { n: i + 1, text: t, status: 'text' }; });
      it.read = 'done'; it.status = 'text';
      it.notes = [sp.method === 'none' ? '쪽 구분 표시가 없어 한 쪽으로 두었습니다.' : '쪽 구분: ' + SPLIT_LABEL[sp.method] + '(' + sp.pages.length + '쪽)'];
      if (SIDES.indexOf(v.side) >= 0) { it.side = v.side; it.edited.side = true; }
      if (v.kind) it.edited.kind = true;
      if (!pushItem(it)) { msg.textContent = '같은 내용이 이미 자료함에 있습니다.'; msg.setAttribute('data-tone', 'warn'); return; }
      afterAdd();
      $('[data-p="text"]').value = '';
      pastePreview();
      msg.textContent = '자료함에 넣었습니다(' + it.pages.length + '쪽). 아래 자료함에서 확인해 주십시오.';
      msg.setAttribute('data-tone', 'ok');
      announce(msg.textContent);
    }

    /* ---------- 파일·폴더 입력과 끌어다 놓기 ---------- */
    function filesFromInput(input) {
      return Array.prototype.slice.call(input.files || []).map(function (f) {
        var rp = f.webkitRelativePath || '';
        var path = rp ? rp.slice(0, rp.length - f.name.length) : '';
        return { file: f, path: path };
      });
    }
    $('[data-el="fileinput"]').addEventListener('change', function (e) {
      var list = filesFromInput(e.target); e.target.value = '';
      if (list.length) addFileEntries(list, 'file');
    });
    $('[data-el="folderinput"]').addEventListener('change', function (e) {
      var list = filesFromInput(e.target); e.target.value = '';
      if (list.length) { var r = addFileEntries(list, 'folder'); folderMsg(r.message, 'ok'); }
      else folderMsg('폴더 안에 파일이 없습니다.', 'warn');
    });
    function folderMsg(t, tone) { var m = $('[data-el="foldermsg"]'); m.textContent = t; m.setAttribute('data-tone', tone || ''); }
    function readEntries(reader) { return new Promise(function (res, rej) { reader.readEntries(res, rej); }); }
    function entryFile(entry) { return new Promise(function (res, rej) { entry.file(res, rej); }); }
    async function collectDrop(dt) {
      var entries = [], items0 = dt.items, i;
      if (items0 && items0.length && typeof items0[0].webkitGetAsEntry === 'function') {
        for (i = 0; i < items0.length; i++) { if (items0[i].kind !== 'file') continue; var en = items0[i].webkitGetAsEntry(); if (en) entries.push(en); }
      }
      var plain = Array.prototype.slice.call(dt.files || []);
      if (!entries.length) return { list: plain.map(function (f) { return { file: f, path: '' }; }), hadDir: false };
      var out = [], hadDir = false, seen = 0;
      async function walk(entry, prefix) {
        if (entry.isFile) { try { out.push({ file: await entryFile(entry), path: prefix }); } catch (e) { /* 읽기 실패 파일은 건너뜀 */ } seen++; if (seen % 50 === 0) folderMsg('폴더를 읽는 중입니다: 파일 ' + seen + '개', ''); }
        else if (entry.isDirectory) {
          hadDir = true;
          var reader = entry.createReader(), batch;
          do { batch = await readEntries(reader); for (var k = 0; k < batch.length; k++) await walk(batch[k], prefix + entry.name + '/'); } while (batch.length); // 한 번에 100개 한도 대응
        }
      }
      for (i = 0; i < entries.length; i++) await walk(entries[i], '');
      return { list: out, hadDir: hadDir };
    }
    $$('[data-drop]').forEach(function (zone) {
      ['dragenter', 'dragover'].forEach(function (t) { zone.addEventListener(t, function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; zone.classList.add('is-over'); }); });
      ['dragleave', 'dragend'].forEach(function (t) { zone.addEventListener(t, function (e) { if (!zone.contains(e.relatedTarget)) zone.classList.remove('is-over'); }); });
      zone.addEventListener('drop', function (e) {
        e.preventDefault(); zone.classList.remove('is-over');
        var dt = e.dataTransfer; if (!dt) return;
        var p = collectDrop(dt); // items 는 이벤트 안에서 동기적으로 꺼낸 뒤 비동기로 훑는다
        p.then(function (r) {
          if (!r.list.length) { folderMsg('놓은 항목에서 파일을 찾지 못했습니다.', 'warn'); return; }
          var source = r.hadDir || zone.getAttribute('data-drop') === 'folder' ? 'folder' : 'file';
          var res = addFileEntries(r.list, source);
          if (source === 'folder') folderMsg(res.message, 'ok');
        }, function () { folderMsg('끌어다 놓은 항목을 읽지 못했습니다. “폴더 고르기” 버튼을 이용해 주십시오.', 'error'); });
      });
    });

    /* ---------- 규칙 편집 ---------- */
    function fillRules() {
      ['include', 'record', 'exclude', 'ourCounsel'].forEach(function (k) { $('[data-rule="' + k + '"]').value = (currentRules[k] || []).join(', '); });
    }
    fillRules();
    function saveRules() {
      try { if (root.localStorage) root.localStorage.setItem(LS_KEY, JSON.stringify(currentRules)); } catch (e) { /* 저장 불가 환경: 이번 화면에서만 적용 */ }
      if (typeof opts.setRules === 'function') { try { opts.setRules(I.getRules()); } catch (e) { /* 껍데기 오류는 무시 */ } }
    }
    function reclassify() {
      var changed = 0;
      items.forEach(function (it) {
        if (it.source === 'paste') return;
        var cls = I.classifyName(it.name);
        it.cls = cls;
        if (!it.edited.kind && cls.kind) it.kind = cls.kind;
        if (it.edited.role) return;
        if (it.role !== cls.role) changed++;
        it.role = cls.role;
        if (!it.edited.checked && selectable(it)) it.checked = cls.role === 'brief';
      });
      afterAdd();
      return changed;
    }
    function applyRules(r) {
      currentRules = I.normalizeRules(r);
      saveRules(); fillRules();
      var n = reclassify();
      var m = $('[data-el="rulesmsg"]');
      m.textContent = '규칙을 적용했습니다. 분류가 바뀐 파일 ' + n + '건.'; m.setAttribute('data-tone', 'ok');
    }

    /* ---------- 자료함 표 ---------- */
    function filtered() {
      var q = compact(view.q).toLowerCase();
      return items.filter(function (it) {
        if (view.filter === 'problem') { if (!(it.read === 'error' || it.read === 'unsupported')) return false; }
        else if (view.filter !== 'all' && it.role !== view.filter) return false;
        if (q) { var hay = compact(it.name + ' ' + it.kind + ' ' + it.submitter + ' ' + it.path).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
        return true;
      });
    }
    function sortItems() {
      items.sort(function (a, b) {
        return String(a.filedDate || '9999').localeCompare(String(b.filedDate || '9999')) || String(a.cls.seq || '').localeCompare(String(b.cls.seq || '')) || a.name.localeCompare(b.name, 'ko');
      });
    }
    function updateCounts() {
      var c = { all: items.length, brief: 0, record: 0, skip: 0, unknown: 0, problem: 0 };
      items.forEach(function (it) { c[it.role]++; if (it.read === 'error' || it.read === 'unsupported') c.problem++; });
      var defs = [['all', '전체'], ['brief', '서면'], ['record', '기록'], ['skip', '제외'], ['unknown', '미정'], ['problem', '문제']];
      $('[data-el="filters"]').innerHTML = defs.map(function (d) {
        if (d[0] === 'problem' && !c.problem && view.filter !== 'problem') return '';
        return '<button type="button" class="sy-ing-chip" data-filter="' + d[0] + '" aria-pressed="' + (view.filter === d[0]) + '">' + d[1] + ' <span class="n">' + c[d[0]] + '</span></button>';
      }).join('');
      var sel = items.filter(function (it) { return it.checked && !it.added; }).length;
      $('[data-el="boxcount"]').textContent = items.length ? '총 ' + items.length + '건 · 선택 ' + sel + '건' : '';
      updateFoot();
    }
    function renderBox() {
      sortItems();
      var list = filtered();
      var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      if (view.page >= pages) view.page = pages - 1;
      var slice = list.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
      var focusInfo = focusKey();
      $('[data-el="empty"]').hidden = items.length > 0;
      $('[data-el="tablewrap"]').hidden = items.length === 0;
      tbody.innerHTML = slice.length ? slice.map(rowHtml).join('') : '<tr class="sy-ing-none"><td colspan="10">조건에 맞는 항목이 없습니다.</td></tr>';
      var pager = $('[data-el="pager"]');
      pager.hidden = list.length <= PAGE_SIZE;
      if (!pager.hidden) {
        pager.innerHTML = '<button type="button" class="sy-ing-btn sm" data-page="prev"' + (view.page === 0 ? ' disabled' : '') + '>이전</button>' +
          '<span class="sy-ing-muted">' + (view.page * PAGE_SIZE + 1) + '–' + Math.min(list.length, (view.page + 1) * PAGE_SIZE) + ' / ' + list.length + '건</span>' +
          '<button type="button" class="sy-ing-btn sm" data-page="next"' + (view.page >= pages - 1 ? ' disabled' : '') + '>다음</button>';
      }
      var sa = $('[data-el="selall"]'), selc = slice.filter(selectable);
      var on = selc.filter(function (it) { return it.checked; }).length;
      sa.checked = selc.length > 0 && on === selc.length; sa.indeterminate = on > 0 && on < selc.length; sa.disabled = !selc.length;
      updateCounts();
      restoreFocus(focusInfo);
    }
    function focusKey() {
      var a = document.activeElement;
      if (!a || !tbody.contains(a)) return null;
      var tr = a.closest('tr[data-key]');
      return tr ? { key: tr.getAttribute('data-key'), f: a.getAttribute('data-f'), act: a.getAttribute('data-act') } : null;
    }
    function restoreFocus(fi) {
      if (!fi) return;
      var tr = tbody.querySelector('tr[data-key="' + fi.key + '"]'); if (!tr) return;
      var t = fi.f ? tr.querySelector('[data-f="' + fi.f + '"]') : fi.act ? tr.querySelector('[data-act="' + fi.act + '"]') : null;
      if (t) t.focus();
    }
    function srcLabel(it) { return { paste: '붙여넣기', file: '파일', folder: '폴더', drive: '드라이브' }[it.source] || ''; }
    function statusOf(it) {
      if (it.added) return ['added', '추가됨'];
      if (it.read === 'unsupported') return ['unsup', '미지원'];
      if (it.read === 'error') return ['error', '오류'];
      if (it.read === 'reading') return ['busy', '읽는 중' + (it.progress ? ' ' + it.progress : '')];
      if (it.read === 'queued') return ['busy', '대기'];
      if (it.read !== 'done') return ['idle', '읽기 전'];
      if (it.status === 'scan') return ['scan', '스캔본'];
      if (it.status === 'mixed') return ['scan', '일부 스캔'];
      return ['text', '텍스트 OK'];
    }
    function statusHtml(it) {
      var st = statusOf(it);
      var s = '<span class="sy-ing-st st-' + st[0] + '">' + esc(st[1]) + '</span>';
      if (it.error) s += '<div class="sy-ing-err">' + esc(it.error) + '</div>';
      else if (it.read === 'done' && it.status && it.status !== 'text') s += '<div class="sy-ing-muted">글자 인식 필요 ' + it.pages.filter(function (p) { return p.status === 'needsOcr'; }).length + '쪽</div>';
      if (it.added && it.docId) s += '<div class="sy-ing-muted">' + esc(it.docId) + '</div>';
      return s;
    }
    function actsHtml(it) {
      var s = '';
      if (it.pages || it.notes.length) s += '<button type="button" class="sy-ing-btn sm" data-act="preview" aria-expanded="' + !!it.open + '">' + (it.open ? '닫기' : '보기') + '</button>';
      if (it.read === 'error') s += '<button type="button" class="sy-ing-btn sm" data-act="reread">다시 읽기</button>';
      if (it.source === 'drive' && it.canSplit && !it.added && it.read === 'done' && it.pages && it.pages.length === 1) s += '<button type="button" class="sy-ing-btn sm" data-act="split">쪽 나누기</button>';
      if (!it.added) s += '<button type="button" class="sy-ing-btn sm ghost" data-act="remove" aria-label="자료함에서 빼기: ' + esc(it.name) + '">빼기</button>';
      return s;
    }
    function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    function rowHtml(it) {
      var dis = !selectable(it), nm = esc(it.name), inv = it.invalid || {};
      var meta = [srcLabel(it), it.path, it.cls.evidence ? it.cls.evidence : ''].filter(Boolean).map(esc).join(' · ');
      var sideCls = it.side === '원고' ? 'p' : it.side === '피고' ? 'd' : 'u';
      var guess = !it.edited.side && it.side !== '미정' ? '<span class="sy-ing-guess" title="' + esc(it.sideWhy) + '">추정</span>' : '';
      return '<tr class="sy-ing-row' + (it.added ? ' is-added' : '') + '" data-key="' + it.key + '">' +
        '<td class="c-check" data-label="선택"><input type="checkbox" data-f="checked"' + (it.checked ? ' checked' : '') + (dis ? ' disabled' : '') + ' aria-label="분석에 넣기: ' + nm + '"></td>' +
        '<td class="c-name" data-label="파일"><div class="fname" title="' + nm + '">' + nm + '</div>' + (meta ? '<div class="sy-ing-muted">' + meta + '</div>' : '') + '<div class="sy-ing-why">' + esc(it.cls.reason) + '</div></td>' +
        '<td class="c-role" data-label="분류"><select data-f="role" data-role="' + it.role + '" aria-label="분류: ' + nm + '"' + (it.added ? ' disabled' : '') + '>' + opt('brief', '서면', it.role) + opt('record', '기록', it.role) + opt('skip', '제외', it.role) + opt('unknown', '미정', it.role) + '</select></td>' +
        '<td class="c-kind" data-label="서면 종류"><input data-f="kind" list="' + P + '-kinds" value="' + esc(it.kind) + '" aria-label="서면 종류: ' + nm + '"' + (inv.kind ? ' aria-invalid="true"' : '') + (it.added ? ' disabled' : '') + '></td>' +
        '<td class="c-side" data-label="측"><select data-f="side" data-side="' + sideCls + '" aria-label="측: ' + nm + '"' + (inv.side ? ' aria-invalid="true"' : '') + (it.added ? ' disabled' : '') + '>' + opt('미정', '미정', it.side) + opt('원고', '원고', it.side) + opt('피고', '피고', it.side) + '</select>' + guess + '</td>' +
        '<td class="c-sub" data-label="제출자"><input data-f="submitter" value="' + esc(it.submitter) + '" aria-label="제출자: ' + nm + '"' + (it.added ? ' disabled' : '') + '></td>' +
        '<td class="c-date" data-label="제출일"><input type="date" data-f="filedDate" value="' + esc(it.filedDate) + '" aria-label="제출일: ' + nm + '"' + (inv.filedDate ? ' aria-invalid="true"' : '') + (it.added ? ' disabled' : '') + '></td>' +
        '<td class="c-pages" data-label="쪽수" data-cell="pages">' + (it.pages ? it.pages.length : '–') + '</td>' +
        '<td class="c-status" data-label="상태" data-cell="status">' + statusHtml(it) + '</td>' +
        '<td class="c-acts" data-cell="acts">' + actsHtml(it) + '</td></tr>' +
        (it.open ? '<tr class="sy-ing-pvrow" data-pv="' + it.key + '"><td colspan="10">' + previewHtml(it) + '</td></tr>' : '');
    }
    function previewHtml(it) {
      var s = '';
      if (it.notes.length) s += '<ul class="sy-ing-notes">' + it.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
      if (!it.pages) return s || '<p class="sy-ing-muted">아직 읽지 않았습니다.</p>';
      revokeUrls(it);
      var pgs = it.pages.slice(0, 3).map(function (p) {
        if (p.status === 'needsOcr' && p.image) {
          var u = URL.createObjectURL(p.image); it.urls.push(u);
          return '<figure class="sy-ing-pg"><figcaption>' + p.n + '쪽(그림)</figcaption><img src="' + u + '" alt="' + p.n + '쪽 그림" loading="lazy"></figure>';
        }
        return '<div class="sy-ing-pg"><div class="sy-ing-muted">' + p.n + '쪽</div><pre>' + esc(short(shown(p.text), 500)) + '</pre></div>';
      }).join('');
      return s + '<div class="sy-ing-pgs">' + pgs + '</div>' + (it.pages.length > 3 ? '<p class="sy-ing-muted">외 ' + (it.pages.length - 3) + '쪽</p>' : '');
    }
    function revokeUrls(it) { (it.urls || []).forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* 무시 */ } }); it.urls = []; }
    function patchStatus(it) {
      var tr = tbody.querySelector('tr[data-key="' + it.key + '"]'); if (!tr) return;
      tr.querySelector('[data-cell="status"]').innerHTML = statusHtml(it);
    }
    function setIfIdle(node, prop, val) { if (node && document.activeElement !== node && node[prop] !== val) node[prop] = val; }
    function patchRow(it) {
      var tr = tbody.querySelector('tr[data-key="' + it.key + '"]'); if (!tr) return;
      var cb = tr.querySelector('[data-f="checked"]'); cb.checked = !!it.checked; cb.disabled = !selectable(it);
      var role = tr.querySelector('[data-f="role"]'); setIfIdle(role, 'value', it.role); role.setAttribute('data-role', it.role);
      setIfIdle(tr.querySelector('[data-f="kind"]'), 'value', it.kind);
      setIfIdle(tr.querySelector('[data-f="submitter"]'), 'value', it.submitter);
      setIfIdle(tr.querySelector('[data-f="filedDate"]'), 'value', it.filedDate);
      var side = tr.querySelector('[data-f="side"]'); setIfIdle(side, 'value', it.side);
      side.setAttribute('data-side', it.side === '원고' ? 'p' : it.side === '피고' ? 'd' : 'u');
      var g = side.parentNode.querySelector('.sy-ing-guess');
      var want = !it.edited.side && it.side !== '미정';
      if (want && !g) side.insertAdjacentHTML('afterend', '<span class="sy-ing-guess" title="' + esc(it.sideWhy) + '">추정</span>');
      else if (!want && g) g.remove();
      else if (g) g.title = it.sideWhy;
      tr.querySelector('[data-cell="pages"]').textContent = it.pages ? it.pages.length : '–';
      tr.querySelector('[data-cell="status"]').innerHTML = statusHtml(it);
      var acts = tr.querySelector('[data-cell="acts"]'), ah = actsHtml(it);
      if (acts.innerHTML !== ah && !acts.contains(document.activeElement)) acts.innerHTML = ah;
    }
    function patchAllVisible() { items.forEach(patchRow); updateCounts(); }
    function setChecked(it, on, byUser) {
      if (!selectable(it)) return;
      it.checked = on; if (byUser) it.edited.checked = true;
      if (on && (it.read === 'idle')) enqueue(it);
    }

    tbody.addEventListener('change', function (e) {
      var t = e.target, f = t.getAttribute('data-f'); if (!f) return;
      var tr = t.closest('tr[data-key]'), it = tr && byKey[tr.getAttribute('data-key')]; if (!it) return;
      if (f === 'checked') { setChecked(it, t.checked, true); }
      else if (f === 'role') {
        it.role = t.value; it.edited.role = true; delete it.invalid.role;
        if (selectable(it)) { if (it.role === 'brief') setChecked(it, true); else if (it.role === 'skip' || it.role === 'unknown') it.checked = false; }
      } else if (f === 'side') { it.side = t.value; it.edited.side = SIDES.indexOf(t.value) >= 0; delete it.invalid.side; t.removeAttribute('aria-invalid'); }
      else if (f === 'kind') { it.kind = t.value.trim(); it.edited.kind = true; delete it.invalid.kind; t.removeAttribute('aria-invalid'); }
      else if (f === 'submitter') { it.submitter = t.value.trim(); it.edited.submitter = true; }
      else if (f === 'filedDate') { it.filedDate = t.value; it.edited.filedDate = true; delete it.invalid.filedDate; t.removeAttribute('aria-invalid'); }
      recomputeSides();
      patchAllVisible();
    });
    tbody.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var tr = b.closest('tr[data-key]'), it = tr && byKey[tr.getAttribute('data-key')]; if (!it) return;
      var act = b.getAttribute('data-act');
      if (act === 'preview') { it.open = !it.open; if (!it.open) revokeUrls(it); renderBox(); }
      else if (act === 'reread') { it.read = 'idle'; it.error = null; it.checked = true; enqueue(it); patchRow(it); }
      else if (act === 'split') { it.forcePages = true; it.read = 'done'; enqueue(it); patchRow(it); }
      else if (act === 'remove') {
        if (running && running.item === it) running.ac.abort();
        queue = queue.filter(function (x) { return x !== it; });
        revokeUrls(it); delete byKey[it.key];
        items = items.filter(function (x) { return x !== it; });
        renderBox(); announce(it.name + '을(를) 자료함에서 뺐습니다.');
      }
    });
    $('[data-el="filters"]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-filter]'); if (!b) return;
      view.filter = b.getAttribute('data-filter'); view.page = 0; renderBox();
      var nb = $('[data-filter="' + view.filter + '"]'); if (nb) nb.focus();
    });
    var qTimer = null;
    $('[data-el="q"]').addEventListener('input', function (e) {
      clearTimeout(qTimer); var v = e.target.value;
      qTimer = setTimeout(function () { view.q = v; view.page = 0; renderBox(); }, 150);
    });
    $('[data-el="pager"]').addEventListener('click', function (e) {
      var b = e.target.closest('[data-page]'); if (!b) return;
      view.page += b.getAttribute('data-page') === 'next' ? 1 : -1; renderBox();
      var nb = $('[data-page="' + b.getAttribute('data-page') + '"]'); if (nb && !nb.disabled) nb.focus();
    });
    $('[data-el="selall"]').addEventListener('change', function (e) {
      var list = filtered().slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);
      list.forEach(function (it) { setChecked(it, e.target.checked, true); });
      patchAllVisible(); renderBox();
    });

    /* ---------- 진행 표시, 하단 ---------- */
    function updateProgress() {
      var bar = $('[data-el="progressbar"]');
      if (!running && !queue.length) { bar.hidden = true; liveText.textContent = ''; return; }
      bar.hidden = false;
      var s = running ? '읽는 중: ' + running.item.name + (running.item.progress ? ' (' + running.item.progress + ')' : '') : '';
      if (queue.length) s += (s ? ' · ' : '') + '대기 ' + queue.length + '건';
      liveText.textContent = s;
    }
    function footMsg(t, tone) { var m = $('[data-el="footmsg"]'); m.textContent = t || ''; m.setAttribute('data-tone', tone || ''); }
    var footSticky = null;
    function updateFoot() {
      var sel = items.filter(function (it) { return it.checked && !it.added && selectable(it); });
      var pending = sel.filter(function (it) { return it.read !== 'done'; });
      var btn = $('[data-act="add"]');
      btn.disabled = !sel.length || pending.length > 0;
      btn.textContent = sel.length ? '선택한 ' + sel.length + '건 분석에 추가' : '분석에 추가';
      if (footSticky) return;
      if (!items.length) footMsg('');
      else if (!sel.length) footMsg('분석에 넣을 서면을 자료함에서 선택해 주십시오.');
      else if (pending.length) footMsg('선택한 ' + sel.length + '건 중 ' + pending.length + '건을 읽는 중입니다. 다 읽은 뒤 추가할 수 있습니다.');
      else footMsg('선택한 ' + sel.length + '건을 확인했으면 “분석에 추가”를 눌러 주십시오.');
    }
    function buildDoc(it, id, mask) {
      var doc = {
        id: id, kind: it.kind, side: SIDES.indexOf(it.side) >= 0 ? it.side : null, submitter: it.submitter || '',
        filedDate: it.filedDate, authoredDate: null, fileName: it.name, source: it.source,
        pageCount: it.pages.length,
        pages: it.pages.map(function (p) {
          var o = { n: p.n, text: mask ? SY.maskSensitive(p.text || '') : (p.text || ''), status: p.status };
          if (p.image) o.image = p.image;
          return o;
        }),
        rawBlob: it.rawBlob || it.file || null,
        role: it.role === 'record' ? 'record' : 'brief'
      };
      if (it.drive) { doc.driveFileId = it.drive.id; if (it.drive.viewUrl) doc.viewUrl = it.drive.viewUrl; }
      return doc;
    }
    async function onAdd() {
      var sel = items.filter(function (it) { return it.checked && !it.added && selectable(it); });
      if (!sel.length) return;
      if (sel.some(function (it) { return it.read !== 'done'; })) { updateFoot(); return; }
      var problems = [];
      sel.forEach(function (it) {
        it.invalid = {};
        if (!String(it.kind || '').trim()) it.invalid.kind = 1;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(it.filedDate || '')) it.invalid.filedDate = 1;
        if (it.role === 'brief' && SIDES.indexOf(it.side) < 0) it.invalid.side = 1;
        if (it.role !== 'brief' && it.role !== 'record') it.invalid.role = 1;
        if (Object.keys(it.invalid).length) problems.push(it);
      });
      if (problems.length) {
        var what = [];
        if (problems.some(function (x) { return x.invalid.kind; })) what.push('서면 종류');
        if (problems.some(function (x) { return x.invalid.side; })) what.push('측');
        if (problems.some(function (x) { return x.invalid.filedDate; })) what.push('제출일');
        if (problems.some(function (x) { return x.invalid.role; })) what.push('분류(서면 또는 기록)');
        footSticky = true;
        footMsg('정해지지 않은 칸이 있는 항목이 ' + problems.length + '건 있습니다(' + what.join(', ') + '). 표시된 칸을 채운 뒤 다시 눌러 주십시오.', 'error');
        setTimeout(function () { footSticky = null; }, 6000);
        view.filter = 'all'; view.q = ''; $('[data-el="q"]').value = '';
        sortItems();
        var idx = filtered().indexOf(problems[0]);
        view.page = Math.max(0, Math.floor(idx / PAGE_SIZE));
        renderBox();
        var tr = tbody.querySelector('tr[data-key="' + problems[0].key + '"]');
        var bad = tr && tr.querySelector('[aria-invalid="true"]');
        if (bad) bad.focus();
        else if (tr && problems[0].invalid.role) tr.querySelector('[data-f="role"]').focus();
        return;
      }
      var C = safeCase(), nmax = 0;
      (C.docs || []).forEach(function (d) { var m = /^D(\d+)$/.exec(d.id || ''); if (m) nmax = Math.max(nmax, Number(m[1])); });
      var ordered = sel.slice().sort(function (a, b) { return a.filedDate.localeCompare(b.filedDate) || String(a.cls.seq || '').localeCompare(String(b.cls.seq || '')) || a.name.localeCompare(b.name, 'ko'); });
      var mask = maskOn();
      var docs = ordered.map(function (it) { return buildDoc(it, 'D' + (++nmax), mask); });
      var btn = $('[data-act="add"]');
      btn.disabled = true;
      try {
        if (typeof opts.onDocs === 'function') await opts.onDocs(docs, { keepOriginals: keepOn(), masked: mask });
        ordered.forEach(function (it, k) { it.added = true; it.checked = false; it.docId = docs[k].id; });
        footSticky = true; setTimeout(function () { footSticky = null; }, 5000);
        footMsg(docs.length + '건을 분석 목록에 넘겼습니다.', 'ok');
        announce(docs.length + '건을 분석 목록에 넘겼습니다.');
      } catch (e) {
        footSticky = true; setTimeout(function () { footSticky = null; }, 8000);
        footMsg('넘기지 못했습니다: ' + short(e && e.message), 'error');
      }
      renderBox();
    }

    /* ---------- 공통 클릭 ---------- */
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]'); if (!b || tbody.contains(b)) return;
      var act = b.getAttribute('data-act');
      if (act === 'pick-file') $('[data-el="fileinput"]').click();
      else if (act === 'pick-folder') $('[data-el="folderinput"]').click();
      else if (act === 'paste-add') pasteAdd();
      else if (act === 'drive-list') driveList();
      else if (act === 'drive-stop') { if (drive.ac) drive.ac.abort(); }
      else if (act === 'stop-read') stopReading();
      else if (act === 'add') onAdd();
      else if (act === 'goto-file') selectTab('file', true);
      else if (act === 'goto-folder') selectTab('folder', true);
      else if (act === 'rules-apply') {
        var r = {}; ['include', 'record', 'exclude', 'ourCounsel'].forEach(function (k) { r[k] = $('[data-rule="' + k + '"]').value; });
        applyRules(r);
      } else if (act === 'rules-reset') applyRules(DEFAULT_RULES);
    });
    $('[data-p="text"]').addEventListener('input', function () { clearTimeout(pvTimer); pvTimer = setTimeout(pastePreview, 200); });
    $('[data-p="split"]').addEventListener('change', pastePreview);
    $('[data-p="kind"]').addEventListener('change', function () {
      var sideSel = $('[data-p="side"]'), k = KIND_SIDE[compact(this.value)];
      if (k && sideSel.value === '미정') sideSel.value = k;
    });
    $('[data-opt="mask"]').addEventListener('change', function () { pastePreview(); items.forEach(function (it) { if (it.open) it.open = true; }); renderBox(); });
    $('[data-el="driveref"]').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); driveList(); } });
    if (root.claude == null || typeof root.claude.use !== 'function') {
      // 아티팩트 런타임이 없는 화면: 클릭 전에도 이유를 알 수 있게 미리 표시(능력 호출은 하지 않는다)
      drive.mcp = null;
    }

    renderBox();

    return {
      addFiles: function (fileList, source) { return addFileEntries(Array.prototype.slice.call(fileList || []).map(function (f) { return { file: f, path: '' }; }), source === 'folder' ? 'folder' : 'file'); },
      items: function () { return items.slice(); },
      busy: function () { return !!running || queue.length > 0 || drive.listing; },
      setRules: function (r) { applyRules(r); },
      getRules: function () { return I.getRules(); },
      refresh: function () { recomputeSides(); renderBox(); },
      selectTab: function (id) { selectTab(id); },
      destroy: function () {
        destroyed = true; stopReading(); if (drive.ac) drive.ac.abort();
        items.forEach(revokeUrls); el.innerHTML = ''; el.classList.remove('sy-ing-host');
      }
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
