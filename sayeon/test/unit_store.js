/* SY.Store 단위 시험 (node). 실행: cd $R && node test/unit_store.js
 * - tools/split_case.js 산출물과 Store.saveCase 가 db 에 쓴 문서가 같은지
 * - 왕복(save -> load) 동일성, 200,000바이트 분할, 큰 쪽 조각내기, 바뀐 묶음만 쓰기, 남는 묶음 지우기
 * - 읽기 전용, 일부 묶음 누락, 일시 오류 재시도, 한도 초과, localStorage 폴백 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const { execFileSync } = require('child_process');

const R = path.resolve(__dirname, '..');
require(path.join(R, 'src/common.js'));
require(path.join(R, 'src/store.js'));
const { installMockClaude } = require('./mock_claude.js');
const SY = globalThis.SY;
const Store = SY.Store;
const SAMPLE = JSON.parse(fs.readFileSync(path.join(R, 'data/sample_min.json'), 'utf8'));

let passed = 0, failed = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); passed++; results.push('통과  ' + name); }
  catch (e) { failed++; results.push('실패  ' + name + '\n      ' + (e && (e.stack || e.message || JSON.stringify(e)))); }
}
function fresh(opts) {
  Store._reset();
  delete globalThis.__mock;
  try { delete globalThis.claude; } catch (e) { /* ignore */ }
  installMockClaude(Object.assign({ useDelay: 0 }, opts || {}));
  return globalThis.__mock;
}
function sets(mock) { return mock.log.filter((l) => l.cap === 'db' && l.op === 'set'); }
function dels(mock) { return mock.log.filter((l) => l.cap === 'db' && l.op === 'delete'); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }
/* 비교용: updatedAt 은 저장 시각으로 바뀌고, schema 가 없던 사건에는 설계서 3.1 기본값 1 이 붙는다. */
function stripVolatile(C) {
  const o = clone(C);
  delete o.updatedAt;
  if (o.schema == null) o.schema = 1;
  return o;
}
const KO = '원고는 피고와 매매계약을 체결하고 계약금을 지급하였습니다. ';

(async () => {
  await t('split_case 산출물 == Store.saveCase 가 쓴 db 문서', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-split-'));
    const C = clone(SAMPLE);
    C.updatedAt = '2099-10-01T00:00:00.000Z';
    const tmpIn = path.join(out, 'in.json');
    fs.writeFileSync(tmpIn, JSON.stringify(C));
    execFileSync('node', [path.join(R, 'tools/split_case.js'), tmpIn, path.join(out, 'o')], { stdio: 'pipe' });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'o/manifest.json'), 'utf8'));
    const mock = fresh();
    await Store.init();
    await Store.saveCase(clone(C));
    const db = mock.dumpDb();
    assert.strictEqual(Object.keys(db).length, manifest.length, 'db 문서 수와 manifest 수');
    manifest.forEach((m) => {
      const p = m.collection + '/' + m.doc_id;
      const file = JSON.parse(fs.readFileSync(path.join(out, 'o', m.file), 'utf8'));
      assert.ok(db[p], '없는 문서 ' + p);
      if (m.collection === 'cases') { delete file.updatedAt; const d = clone(db[p]); delete d.updatedAt; assert.deepStrictEqual(d, file); }
      else assert.deepStrictEqual(db[p], file, p);
    });
    assert.strictEqual(manifest[manifest.length - 1].collection, 'cases', '메타가 마지막');
  });

  await t('split_case 시딩 -> Store.loadCase 왕복 동일', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-seed-'));
    execFileSync('node', [path.join(R, 'tools/split_case.js'), path.join(R, 'data/sample_min.json'), out], { stdio: 'pipe' });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    const seed = {};
    manifest.forEach((m) => { seed[m.collection + '/' + m.doc_id] = JSON.parse(fs.readFileSync(path.join(out, m.file), 'utf8')); });
    fresh({ seed });
    const list = await Store.listCases();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'c_dev');
    assert.strictEqual(list[0].counts.statements, SAMPLE.statements.length);
    const C = await Store.loadCase('c_dev');
    assert.deepStrictEqual(stripVolatile(C), stripVolatile(SAMPLE));
    assert.strictEqual(C._partial, undefined);
  });

  await t('바뀌지 않으면 쓰지 않고, 바뀐 묶음만 쓴다', async () => {
    const mock = fresh();
    const C = clone(SAMPLE);
    const r1 = await Store.saveCase(C);
    assert.strictEqual(r1.unchanged, false);
    const n1 = sets(mock).length;
    assert.strictEqual(n1, 8, '처음 저장: 묶음 7 + 메타 1');
    const r2 = await Store.saveCase(C);
    assert.strictEqual(r2.unchanged, true);
    assert.strictEqual(sets(mock).length, n1, '두 번째 저장은 0건');
    C.statements[0].gist = '바뀐 요지이다';
    await Store.saveCase(C);
    const w = sets(mock).slice(n1).map((x) => x.path);
    assert.deepStrictEqual(w.sort(), ['cases/c_dev', 'cases/c_dev/parts/statements_0'].sort());
    // 불러온 뒤 저장해도 0건(키 순서가 달라도 해시는 같다)
    const L = await Store.loadCase('c_dev');
    const before = sets(mock).length;
    const r3 = await Store.saveCase(L);
    assert.strictEqual(r3.unchanged, true);
    assert.strictEqual(sets(mock).length, before);
  });

  await t('큰 사건: 모든 문서 200,000바이트 이하, 왕복 동일, 큰 쪽은 조각으로', async () => {
    const mock = fresh();
    const C = clone(SAMPLE);
    C.id = 'c_big';
    for (let d = 0; d < 3; d++) {
      const pages = [];
      for (let n = 1; n <= 120; n++) pages.push({ n, text: (KO + n + ' "인용" \\ 역슬래시\n').repeat(60), status: 'text' });
      C.docs.push({ id: 'DX' + d, kind: '준비서면', side: '피고', filedDate: '2099-10-0' + (d + 1), pageCount: pages.length, pages });
    }
    // 쪽 구분 없는 긴 붙여넣기(쪽 하나 ~700KB), 이모지 아닌 4바이트 문자도 섞음
    C.docs.push({ id: 'D 붙여넣기/1', kind: '참고서면', side: '원고', filedDate: '2099-11-01', pages: [{ n: 1, text: (KO + '𠀀"\\\t').repeat(9000), status: 'manual' }] });
    for (let i = 0; i < 3000; i++) C.statements.push({ id: 'SX' + i, docId: 'DX0', page: 1, issueIds: ['I2'], side: '피고', gist: '요지' + i + '이다', quote: KO.repeat(3), evidence: ['을' + i], factIds: [] });
    await Store.saveCase(C);
    const db = mock.dumpDb();
    let maxB = 0;
    Object.keys(db).forEach((k) => { maxB = Math.max(maxB, Buffer.byteLength(JSON.stringify(db[k]), 'utf8')); });
    assert.ok(maxB <= 200000, '최대 ' + maxB);
    const pageParts = Object.keys(db).filter((k) => k.indexOf('/parts/pages_DX0_') > 0);
    assert.ok(pageParts.length >= 2, '쪽 묶음이 여러 개여야 함: ' + pageParts.length);
    const stParts = Object.keys(db).filter((k) => k.indexOf('/parts/statements_') > 0);
    assert.ok(stParts.length >= 2, '진술 묶음이 여러 개여야 함');
    const weird = Object.keys(db).filter((k) => k.indexOf('/parts/pages_D~20') > 0);
    assert.ok(weird.length >= 3, '이상한 서면 id 도 경로로 쓸 수 있어야 하고, 큰 쪽은 3개 이상 조각: ' + weird.length);
    const L = await Store.loadCase('c_big');
    assert.deepStrictEqual(stripVolatile(L), stripVolatile(C));
    console.log('      (큰 사건: 문서 ' + Object.keys(db).length + '개, 최대 ' + maxB + '바이트)');
  });

  await t('줄어든 묶음은 지운다', async () => {
    const mock = fresh();
    const C = clone(SAMPLE);
    for (let i = 0; i < 2500; i++) C.statements.push({ id: 'SY' + i, docId: 'D1', page: 1, issueIds: [], side: '원고', gist: '요지이다', quote: KO.repeat(2), evidence: [], factIds: [] });
    await Store.saveCase(C);
    const many = Object.keys(mock.dumpDb()).filter((k) => k.indexOf('/statements_') > 0).length;
    assert.ok(many >= 2);
    C.statements = C.statements.slice(0, 8);
    await Store.saveCase(C);
    const left = Object.keys(mock.dumpDb()).filter((k) => k.indexOf('/statements_') > 0);
    assert.deepStrictEqual(left, ['cases/c_dev/parts/statements_0']);
    assert.strictEqual(dels(mock).length, many - 1);
  });

  await t('Blob 등 저장 불가 값은 빼고 저장, 원본 C 는 그대로', async () => {
    const mock = fresh();
    const C = clone(SAMPLE);
    const blob = new Blob(['x'], { type: 'image/png' });
    C.docs[0].rawBlob = blob;
    C.docs[0].pages[0].image = blob;
    await Store.saveCase(C);
    const db = mock.dumpDb();
    assert.ok(!('rawBlob' in db['cases/c_dev'].docs[0]));
    assert.ok(!('image' in db['cases/c_dev/parts/pages_D1_0'].pages[0]));
    assert.strictEqual(C.docs[0].pages[0].image, blob);
    assert.ok(!('pages' in db['cases/c_dev'].docs[0]), '메타에는 본문 없음');
  });

  await t('일부 묶음 누락: 깨지지 않고 _partial 표시, 저장은 거절(force 면 허용)', async () => {
    const mock = fresh();
    await Store.saveCase(clone(SAMPLE));
    const db = mock.dumpDb();
    delete db['cases/c_dev/parts/statements_0'];
    delete db['cases/c_dev/parts/pages_D2_0'];
    fresh({ seed: db });
    const C = await Store.loadCase('c_dev');
    assert.strictEqual(C._partial, true);
    assert.deepStrictEqual(C._missing.slice().sort(), ['pages_D2_0', 'statements_0']);
    assert.strictEqual(C.statements.length, 0);
    assert.strictEqual(C.docs[1].pages.length, 0);
    assert.strictEqual(C.facts.length, SAMPLE.facts.length);
    await assert.rejects(Store.saveCase(C), (e) => e.code === 'partial_case');
    await Store.saveCase(C, { force: true });
  });

  await t('읽기 전용: can("data.write") false', async () => {
    fresh({ canWrite: false, seed: {} });
    const st = await Store.init();
    assert.strictEqual(st.mode, 'db');
    assert.strictEqual(st.canWrite, false);
    await assert.rejects(Store.saveCase(clone(SAMPLE)), (e) => e.code === 'read_only');
  });

  await t('읽기 전용: can() null 이고 실제 쓰기가 거절되면 읽기 전용으로 전환', async () => {
    const mock = fresh({ canWrite: null });
    const st = await Store.init();
    assert.strictEqual(st.canWrite, true);
    let seen = null;
    Store.onStatus((s) => { seen = s; });
    mock.setCanWrite(false);
    await assert.rejects(Store.saveCase(clone(SAMPLE)), (e) => e.code === 'read_only');
    assert.ok(seen && seen.canWrite === false && seen.reason === 'no_write');
  });

  await t('일시 오류(unavailable)는 한 번 다시 시도', async () => {
    const mock = fresh();
    mock.failNext('set', 'unavailable');
    await Store.saveCase(clone(SAMPLE));
    assert.ok(mock.dumpDb()['cases/c_dev']);
  });

  await t('한도 초과(quota_exceeded)는 코드로 알림', async () => {
    const mock = fresh();
    mock.failNext('set', 'quota_exceeded');
    await assert.rejects(Store.saveCase(clone(SAMPLE)), (e) => e.code === 'quota_exceeded' && /한도/.test(e.message));
  });

  await t('사건 삭제: 메타와 묶음 모두', async () => {
    const mock = fresh();
    await Store.saveCase(clone(SAMPLE));
    const D = clone(SAMPLE); D.id = 'c_other'; D.title = '다른 사건'; D.updatedAt = '2000-01-01T00:00:00Z';
    await Store.saveCase(D);
    let list = await Store.listCases();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[1].id, 'c_dev', '최근 수정 순(새로 저장한 c_other 도 updatedAt 이 지금으로 바뀜)');
    await Store.deleteCase('c_dev');
    list = await Store.listCases();
    assert.deepStrictEqual(list.map((x) => x.id), ['c_other']);
    assert.ok(!Object.keys(mock.dumpDb()).some((k) => k.indexOf('cases/c_dev') === 0));
  });

  await t('db 없음(claude 없음) -> local 모드, localStorage 에 같은 배치로 보관', async () => {
    const mem = {};
    globalThis.localStorage = {
      get length() { return Object.keys(mem).length; },
      key(i) { return Object.keys(mem)[i]; },
      getItem(k) { return k in mem ? mem[k] : null; },
      setItem(k, v) { mem[k] = String(v); },
      removeItem(k) { delete mem[k]; }
    };
    fresh({ noClaude: true });
    const st = await Store.init();
    assert.strictEqual(st.mode, 'local');
    assert.strictEqual(st.reason, 'no_claude');
    assert.strictEqual(st.persistent, true);
    await Store.saveCase(clone(SAMPLE));
    assert.ok(mem['sayeon.v1:cases/c_dev']);
    assert.ok(mem['sayeon.v1:cases/c_dev/parts/statements_0']);
    Store._reset();
    const L = await Store.loadCase('c_dev');
    assert.deepStrictEqual(stripVolatile(L), stripVolatile(SAMPLE));
    // db 능력만 없는 경우
    fresh({ caps: { db: false } });
    const st2 = await Store.init();
    assert.strictEqual(st2.mode, 'local');
    assert.strictEqual(st2.reason, 'no_db');
    delete globalThis.localStorage;
  });

  await t('localStorage 가득 참 -> 메모리로 계속, 상태 알림', async () => {
    globalThis.localStorage = {
      length: 0, key() { return null; }, getItem() { return null; },
      setItem(k) { if (k.indexOf('__probe') < 0) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } },
      removeItem() {}
    };
    fresh({ noClaude: true });
    let seen = null;
    Store.onStatus((s) => { seen = s; });
    await Store.saveCase(clone(SAMPLE));
    assert.ok(seen && seen.persistent === false && seen.reason === 'local_full');
    const L = await Store.loadCase('c_dev');
    assert.strictEqual(L.statements.length, SAMPLE.statements.length);
    delete globalThis.localStorage;
  });

  await t('mock db: 경로 문법 위반은 TypeError, 256KiB 초과는 invalid_argument', async () => {
    fresh();
    const db = await globalThis.claude.use('db');
    assert.throws(() => db.doc('cases'), TypeError);
    assert.throws(() => db.collection('cases/x'), TypeError);
    await assert.rejects(db.doc('a/b').set({ t: 'x'.repeat(270000) }), (e) => e.code === 'invalid_argument');
  });

  results.forEach((r) => console.log(r));
  console.log(`\n${passed}건 통과, ${failed}건 실패`);
  process.exitCode = failed ? 1 : 0;
})();
