/* 시험용 가짜 window.claude. 능력 타입 정의(artifact-capabilities 0.2.67: claude/db/sample/mcp/downloads/user/assets.d.ts)의 호출 모양을 따른다.
 *
 * Playwright: await page.addInitScript(installMockClaude, opts)
 * node     : installMockClaude(opts)  -> globalThis.claude, globalThis.__mock
 *
 * opts = {
 *   caps: { db, sample, mcp, downloads, user, assets }   // false 면 use(name) 이 null (기본 모두 true)
 *   noClaude: false        // true 면 window.claude 자체를 만들지 않는다(아티팩트 밖에서 연 경우)
 *   canWrite: true|false|null   // user.can('data.write') 응답. false 면 db 쓰기가 invalid_argument 로 거절되고 use('assets') 는 null
 *   seed: { 'cases/c1': {...}, ... }   // db 초기 문서
 *   downloads: 'accept'|'decline'      // 저장 확인 창 응답
 *   useDelay: 5            // use() 응답 지연(ms)
 *   latency: 0             // db 호출 지연(ms)
 * }
 * 시험 코드는 window.__mock 으로 기록과 조작 기능에 접근한다:
 *   __mock.log[]           {cap, op, path?, bytes?}
 *   __mock.downloads[]     {filename, bytes, kind, mime}
 *   __mock.dumpDb()        {path: body}
 *   __mock.failNext(op, code)   다음 db 호출(op: get|set|update|delete|query) 하나를 code 로 거절
 *   __mock.sampleHandler = (input, options) => string | object   (sample.json 은 object 를 그대로 돌려줌)
 *   __mock.mcpHandler = (server, tool, input) => CallToolResult
 *   __mock.downloadsMode = 'accept'|'decline'
 */
function installMockClaude(opts) {
  'use strict';
  opts = opts || {};
  var W = typeof window !== 'undefined' ? window : globalThis;
  var caps = Object.assign({ db: true, sample: true, mcp: true, downloads: true, user: true, assets: true }, opts.caps || {});
  var canWrite = opts.canWrite === undefined ? true : opts.canWrite;
  var mock = W.__mock = {
    opts: opts, log: [], downloads: [], sampleCalls: [], mcpCalls: [], assets: [],
    sampleHandler: null, mcpHandler: null, downloadsMode: opts.downloads || 'accept', _fail: []
  };
  if (opts.noClaude) return;

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  function bytesOf(s) {
    s = String(s);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }
  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }
  function err(code, message) { return { code: code, message: message || code }; }

  /* ---------------- db ---------------- */
  var store = {};
  Object.keys(opts.seed || {}).forEach(function (p) { store[p] = JSON.parse(JSON.stringify(opts.seed[p])); });
  var SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
  function checkPath(path, wantEven) {
    if (typeof path !== 'string' || !path) throw new TypeError('path must be a non-empty string');
    if (bytesOf(path) > 1000) throw new TypeError('path longer than 1000 bytes');
    var segs = path.split('/');
    if (segs.length > 16) throw new TypeError('more than 16 segments');
    segs.forEach(function (s) {
      if (!s || !SEG.test(s) || s === '.' || s === '..' || bytesOf(s) > 200) throw new TypeError('bad segment: ' + s);
    });
    if ((segs.length % 2 === 0) !== wantEven) {
      throw new TypeError((wantEven ? 'document' : 'collection') + ' path needs an ' + (wantEven ? 'even' : 'odd') + ' number of segments, got ' + segs.length);
    }
    return segs;
  }
  function takeFail(op) {
    for (var i = 0; i < mock._fail.length; i++) {
      if (mock._fail[i].op === op) { var f = mock._fail.splice(i, 1)[0]; return err(f.code, 'injected ' + f.code); }
    }
    return null;
  }
  mock.failNext = function (op, code) { mock._fail.push({ op: op, code: code }); };
  mock.dumpDb = function () { return JSON.parse(JSON.stringify(store)); };
  mock.setCanWrite = function (v) { canWrite = v; };
  var listeners = [];
  function notify() { listeners.slice().forEach(function (l) { try { l(); } catch (e) { /* ignore */ } }); }
  function depth(v, d) {
    if (d > 32) return d;
    if (v && typeof v === 'object') {
      var m = d;
      Object.keys(v).forEach(function (k) { m = Math.max(m, depth(v[k], d + 1)); });
      return m;
    }
    return d;
  }
  function snap(path) {
    var id = path.split('/').pop();
    var has = Object.prototype.hasOwnProperty.call(store, path);
    var body = has ? deepFreeze(JSON.parse(JSON.stringify(store[path]))) : undefined;
    return Object.freeze({
      id: id, exists: has,
      data: function () { return body; },
      metadata: Object.freeze({ fromCache: false, hasPendingWrites: false })
    });
  }
  function checkBody(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return err('invalid_argument', 'body must be a plain object');
    var s;
    try { s = JSON.stringify(data); } catch (e) { return err('invalid_argument', 'body not JSON'); }
    if (bytesOf(s) > 262144) return err('invalid_argument', 'document over 256 KiB');
    if (depth(data, 0) > 32) return err('invalid_argument', 'document deeper than 32 levels');
    return null;
  }
  function writeAllowed() { return canWrite !== false; }
  function docRef(path) {
    checkPath(path, true);
    var ref = {
      id: path.split('/').pop(), path: path,
      get: function () {
        mock.log.push({ cap: 'db', op: 'get', path: path });
        var f = takeFail('get');
        return delay(opts.latency).then(function () { if (f) throw f; return snap(path); });
      },
      set: function (data) {
        var f = takeFail('set');
        var bad = checkBody(data);
        var b = bad ? 0 : bytesOf(JSON.stringify(data));
        mock.log.push({ cap: 'db', op: 'set', path: path, bytes: b });
        return delay(opts.latency).then(function () {
          if (f) throw f;
          if (bad) throw bad;
          if (!writeAllowed()) throw err('invalid_argument', 'write below the minimum level for this path');
          store[path] = JSON.parse(JSON.stringify(data));
          notify();
        });
      },
      update: function (data) {
        var f = takeFail('update');
        mock.log.push({ cap: 'db', op: 'update', path: path });
        return delay(opts.latency).then(function () {
          if (f) throw f;
          if (!writeAllowed()) throw err('invalid_argument', 'write below the minimum level for this path');
          if (!Object.prototype.hasOwnProperty.call(store, path)) throw err('invalid_argument', 'update requires an existing document');
          var merge = function (a, b) {
            Object.keys(b).forEach(function (k) {
              if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) merge(a[k], b[k]);
              else a[k] = JSON.parse(JSON.stringify(b[k]));
            });
          };
          merge(store[path], data);
          notify();
        });
      },
      delete: function () {
        var f = takeFail('delete');
        mock.log.push({ cap: 'db', op: 'delete', path: path });
        return delay(opts.latency).then(function () {
          if (f) throw f;
          if (!writeAllowed()) throw err('invalid_argument', 'write below the minimum level for this path');
          delete store[path];
          notify();
        });
      },
      acquire: function (o) {
        return delay(opts.latency).then(function () {
          return { acquired: true, version: 1, expiresAt: new Date(Date.now() + ((o && o.ttlMs) || 30000)).toISOString(), holder: o && o.holder };
        });
      },
      onSnapshot: function (next, error) {
        var alive = true;
        var fire = function () { if (alive) next(snap(path)); };
        listeners.push(fire);
        setTimeout(fire, 0);
        return function () { alive = false; listeners = listeners.filter(function (l) { return l !== fire; }); };
      },
      collection: function (sub) { return colRef(path + '/' + sub); }
    };
    return Object.freeze(ref);
  }
  function makeQuery(col, filters, order, lim) {
    function run() {
      var depthN = col.split('/').length + 1, pre = col + '/';
      var docs = Object.keys(store).filter(function (k) { return k.indexOf(pre) === 0 && k.split('/').length === depthN; });
      docs = docs.filter(function (k) {
        return filters.every(function (f) {
          var v = store[k][f.field];
          switch (f.op) {
            case '==': return v === f.value;
            case '!=': return v !== f.value;
            case '<': return v < f.value;
            case '<=': return v <= f.value;
            case '>': return v > f.value;
            case '>=': return v >= f.value;
            case 'in': return f.value.indexOf(v) >= 0;
            case 'not-in': return f.value.indexOf(v) < 0;
            case 'array-contains': return Array.isArray(v) && v.indexOf(f.value) >= 0;
            default: return false;
          }
        });
      });
      docs.sort(function (a, b) {
        if (order) {
          var x = store[a][order.field], y = store[b][order.field];
          if (x === undefined && y !== undefined) return 1;
          if (y === undefined && x !== undefined) return -1;
          var c = x < y ? -1 : x > y ? 1 : 0;
          return order.dir === 'desc' ? -c : c;
        }
        return a < b ? -1 : a > b ? 1 : 0;
      });
      if (lim) docs = docs.slice(0, lim);
      var snaps = docs.map(snap);
      return Object.freeze({
        docs: snaps, size: snaps.length, empty: snaps.length === 0,
        docChanges: function () { return snaps.map(function (d, i) { return { type: 'added', doc: d, oldIndex: -1, newIndex: i }; }); },
        metadata: Object.freeze({ fromCache: false, hasPendingWrites: false })
      });
    }
    var q = {
      where: function (field, op, value) {
        if (filters.length >= 10) throw new TypeError('too many filters');
        return makeQuery(col, filters.concat([{ field: field, op: op, value: value }]), order, lim);
      },
      orderBy: function (field, dir) { return makeQuery(col, filters, { field: field, dir: dir || 'asc' }, lim); },
      limit: function (n) {
        if (!(n >= 1 && n <= 1000)) throw new TypeError('limit must be 1-1000');
        return makeQuery(col, filters, order, n);
      },
      get: function () {
        mock.log.push({ cap: 'db', op: 'query', path: col });
        var f = takeFail('query');
        return delay(opts.latency).then(function () { if (f) throw f; return run(); });
      },
      onSnapshot: function (next) {
        var alive = true;
        var fire = function () { if (alive) next(run()); };
        listeners.push(fire);
        setTimeout(fire, 0);
        return function () { alive = false; listeners = listeners.filter(function (l) { return l !== fire; }); };
      }
    };
    return q;
  }
  function colRef(path) {
    checkPath(path, false);
    var q = makeQuery(path, [], null, 0);
    var c = Object.assign({}, q, {
      path: path,
      doc: function (id) { return docRef(path + '/' + (id || ('m' + Math.random().toString(36).slice(2, 12)))); },
      add: function (data) { var r = c.doc(); return r.set(data).then(function () { return r; }); }
    });
    return Object.freeze(c);
  }
  var dbNs = Object.freeze({ doc: docRef, collection: colRef });

  /* ---------------- sample ---------------- */
  function sampleCall(isJson) {
    return function (input, options) {
      options = options || {};
      var text = typeof input === 'string' ? input : JSON.stringify(input);
      mock.sampleCalls.push({ json: isJson, bytes: bytesOf(text), images: options.images ? (options.images.length || 1) : 0 });
      mock.log.push({ cap: 'sample', op: isJson ? 'json' : 'text' });
      return new Promise(function (resolve, reject) {
        if (options.signal && options.signal.aborted) return reject(err('cancelled'));
        if (bytesOf(text) > 262144) return reject(err('prompt_too_large'));
        var t = setTimeout(function () {
          var out;
          try { out = mock.sampleHandler ? mock.sampleHandler(input, options) : (isJson ? {} : '확인했습니다.'); }
          catch (e) { return reject(e && e.code ? e : err('upstream_error', String(e))); }
          Promise.resolve(out).then(function (v) {
            if (options.signal && options.signal.aborted) return reject(err('cancelled'));
            var s = typeof v === 'string' ? v : JSON.stringify(v);
            if (typeof options.onText === 'function') { try { options.onText({ text: s, delta: s }); } catch (e) { /* 무시 */ } }
            if (isJson) {
              if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return reject({ code: 'invalid_json', message: 'no JSON', text: v }); } }
              resolve(v);
            } else resolve({ text: s, truncated: false, modelTierApplied: options.modelTier || 'default' });
          }, function (e) { reject(e && e.code ? e : err('upstream_error')); });
        }, opts.sampleDelay || 10);
        if (options.signal) options.signal.addEventListener('abort', function () { clearTimeout(t); reject(err('cancelled')); });
      });
    };
  }
  var sampleFn = sampleCall(false);
  sampleFn.json = sampleCall(true);
  sampleFn.limits = function () {
    return Promise.resolve({
      maxPromptBytes: 262144,
      images: { maxCount: 20, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }
    });
  };
  Object.freeze(sampleFn);

  /* ---------------- mcp ---------------- */
  var mcpNs = Object.freeze({
    listTools: function (server) {
      var servers = opts.mcpServers || [];
      if (server) servers = servers.filter(function (s) { return s.server === server; });
      return Promise.resolve({ servers: servers });
    },
    callTool: function (server, tool, input, o) {
      mock.mcpCalls.push({ server: server, tool: tool, input: input });
      mock.log.push({ cap: 'mcp', op: 'callTool', path: server + '/' + tool });
      return delay(5).then(function () {
        if (o && o.signal && o.signal.aborted) throw err('cancelled');
        if (!mock.mcpHandler) throw { code: 'server_not_connected', message: 'no connector', server: server };
        return mock.mcpHandler(server, tool, input);
      });
    },
    watchTool: function (server, tool, input, handler) {
      if (typeof handler !== 'function') throw new TypeError('handler must be a function');
      var alive = true;
      setTimeout(function () { if (alive) handler({ type: 'error', error: { code: 'server_not_connected', message: 'no connector', server: server } }); }, 0);
      return function () { alive = false; };
    },
    invalidate: function () { return Promise.resolve(); },
    server: function (name) { return Promise.reject({ code: 'server_not_connected', message: 'no connector', server: name }); },
    describeTool: function () { return Promise.reject({ code: 'bad_request', message: 'no schema' }); }
  });

  /* ---------------- downloads ---------------- */
  var ALLOW = 'gif png jpg jpeg webp mp4 webm txt json md docx pptx epub csv ttf html svg pdf xlsx zip'.split(' ');
  var dlNs = Object.freeze({
    save: function (req) {
      req = req || {};
      return delay(5).then(function () {
        var name = req.filename;
        if (typeof name !== 'string' || !name || name.length > 512) throw err('bad_request', 'bad filename');
        var m = /\.([A-Za-z0-9]+)$/.exec(name);
        if (!m || ALLOW.indexOf(m[1].toLowerCase()) < 0) throw err('rejected_extension', 'extension not allowed');
        var d = req.data, kind, bytes, mime = '';
        if (typeof d === 'string') { kind = 'string'; bytes = bytesOf(d); }
        else if (typeof Blob !== 'undefined' && d instanceof Blob) { kind = 'blob'; bytes = d.size; mime = d.type; }
        else if (d instanceof ArrayBuffer) { kind = 'arraybuffer'; bytes = d.byteLength; }
        else if (d && ArrayBuffer.isView(d)) { kind = 'view'; bytes = d.byteLength; }
        else throw err('bad_request', 'bad data');
        if (!bytes) throw err('bad_request', 'empty data');
        mock.log.push({ cap: 'downloads', op: 'save', path: name, bytes: bytes });
        if (mock.downloadsMode === 'decline') throw err('declined', 'viewer declined');
        if (mock.downloadsMode === 'rate_limited') throw err('rate_limited', 'prompt already open');
        mock.downloads.push({ filename: name, bytes: bytes, kind: kind, mime: mime });
        return { status: 'saved' };
      });
    }
  });

  /* ---------------- user ---------------- */
  var uid = opts.userId === undefined ? 'u_mocktester' : opts.userId;
  var me = Object.freeze({
    id: uid, name: opts.userName || '', avatarUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', color: '#5b6b8c',
    email: null, isOwner: opts.isOwner !== false, canEdit: canWrite !== false
  });
  var userNs = Object.freeze({
    isOwner: function () { return Promise.resolve(opts.isOwner !== false); },
    canEdit: function () { return Promise.resolve(canWrite !== false); },
    can: function (name) {
      if (canWrite === null) return Promise.resolve(null);
      if (name === 'data.write' || name === 'files.write' || name === 'assets.write') return Promise.resolve(canWrite !== false);
      return Promise.resolve(false);
    },
    me: function () { return Promise.resolve(me); },
    id: function () { return Promise.resolve(uid); },
    profiles: function (ids) {
      var out = {};
      (typeof ids === 'string' ? [ids] : ids || []).forEach(function (i) {
        out[i] = { id: i, name: '', avatarUrl: me.avatarUrl, color: me.color, email: null, isMe: i === uid, guest: false };
      });
      return Promise.resolve(out);
    },
    name: function () { return Promise.resolve(me.name); },
    avatarUrl: function () { return Promise.resolve(uid ? me.avatarUrl : null); },
    search: function () { return Promise.resolve([]); },
    email: function () { return Promise.resolve(null); }
  });

  /* ---------------- assets ---------------- */
  var assetStore = {};
  var assetsNs = Object.freeze({
    upload: function (blob, o) {
      return delay(5).then(function () {
        if (!(typeof Blob !== 'undefined' && blob instanceof Blob) || !blob.size) throw err('invalid_request', 'not a blob');
        var id = '';
        for (var i = 0; i < 32; i++) id += '0123456789abcdef'.charAt(Math.floor(Math.random() * 16));
        var rec = { id: id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: (o && o.type) || blob.type || 'application/octet-stream', createdAt: new Date().toISOString() };
        assetStore[id] = rec; mock.assets.push(rec);
        mock.log.push({ cap: 'assets', op: 'upload', bytes: blob.size });
        return { id: rec.id, url: rec.url, sizeBytes: rec.sizeBytes, contentType: rec.contentType };
      });
    },
    list: function () {
      var a = Object.keys(assetStore).map(function (k) { return assetStore[k]; });
      return Promise.resolve({ assets: a, usage: { files: a.length, bytes: a.reduce(function (s, x) { return s + x.sizeBytes; }, 0), maxFiles: 1000, maxBytes: 1 << 30 } });
    },
    delete: function (ref) {
      var id = String(ref || '').replace(/^\/_blob\//, '');
      var had = !!assetStore[id]; delete assetStore[id];
      return Promise.resolve({ deleted: had });
    }
  });

  /* ---------------- claude.use ---------------- */
  var ns = { db: dbNs, sample: sampleFn, mcp: mcpNs, downloads: dlNs, user: userNs, assets: assetsNs };
  var memo = {};
  var claude = Object.freeze({
    use: function (name) {
      if (memo[name]) return memo[name];
      var on = Object.prototype.hasOwnProperty.call(ns, name) && caps[name] !== false;
      if (name === 'assets' && canWrite === false) on = false;   // writer-only
      mock.log.push({ cap: 'use', op: name, path: on ? 'granted' : 'null' });
      var p = delay(opts.useDelay == null ? 5 : opts.useDelay).then(function () { return on ? ns[name] : null; });
      if (on) memo[name] = p;
      return p;
    }
  });
  try {
    Object.defineProperty(W, 'claude', { value: claude, configurable: true, writable: false });
  } catch (e) { W.claude = claude; }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { installMockClaude: installMockClaude };
